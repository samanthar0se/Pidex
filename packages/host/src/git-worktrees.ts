import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  ProjectSummary,
  WorkspaceSummary,
} from "../../protocol/src/status.js";

const execFileAsync = promisify(execFile);

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  isProjectCheckout: boolean;
}

export interface ProjectWorktrees {
  projectId: string;
  available: boolean;
  reason?: string;
  projectCheckout?: GitWorktree;
  worktrees: GitWorktree[];
}

interface CreatedManagedWorktree {
  workspace: WorkspaceSummary;
  cleanup(): Promise<void>;
}

/** Owns bounded Git inspection and managed-worktree filesystem mutations. */
export class GitWorktreeManager {
  readonly #managedRoot: string;

  constructor(dataDir: string) {
    this.#managedRoot = resolve(dataDir, "worktrees");
  }

  async list(project: ProjectSummary): Promise<ProjectWorktrees> {
    if (!project.path) {
      return {
        projectId: project.projectId,
        available: false,
        reason: "Project has no configured checkout path.",
        worktrees: [],
      };
    }

    try {
      const projectPath = await realpath(project.path);
      const { stdout } = await runGit(projectPath, [
        "worktree",
        "list",
        "--porcelain",
      ]);
      const discovered = parseWorktreeList(stdout);
      const worktrees = await Promise.all(discovered.map(async item => ({
        ...item,
        path: await realpath(item.path),
        isProjectCheckout: false,
      })));
      for (const item of worktrees) {
        item.isProjectCheckout = samePath(item.path, projectPath);
      }
      const projectCheckout = worktrees.find(item => item.isProjectCheckout);
      return {
        projectId: project.projectId,
        available: Boolean(projectCheckout),
        ...(projectCheckout
          ? { projectCheckout }
          : { reason: "Configured Project path is not a Git worktree." }),
        worktrees: worktrees.filter(item => !item.isProjectCheckout),
      };
    } catch (error) {
      return {
        projectId: project.projectId,
        available: false,
        reason: gitFailureReason(error),
        worktrees: [],
      };
    }
  }

  async selectExisting(
    project: ProjectSummary,
    requestedPath: string,
  ): Promise<WorkspaceSummary> {
    const catalog = await this.list(project);
    if (!catalog.available) {
      throw new Error("project-worktrees-unavailable");
    }
    const requested = await realpath(requestedPath).catch(() => requestedPath);
    const selected = catalog.worktrees.find(item =>
      samePath(item.path, requested)
    );
    if (!selected) {
      throw new Error("unknown-project-worktree");
    }
    return workspaceFor(project.projectId, selected, false);
  }

  async createManaged(
    project: ProjectSummary,
    sessionId: string,
  ): Promise<CreatedManagedWorktree> {
    const catalog = await this.list(project);
    if (!catalog.available || !catalog.projectCheckout || !project.path) {
      throw new Error("project-worktrees-unavailable");
    }

    const projectDirectory = safeSegment(project.projectId);
    const target = resolve(this.#managedRoot, projectDirectory, sessionId);
    assertContained(this.#managedRoot, target);
    await mkdir(resolve(target, ".."), { recursive: true });
    await runGit(project.path, ["worktree", "add", "--detach", target, "HEAD"]);

    let cleaned = false;
    return {
      workspace: workspaceFor(project.projectId, {
        path: target,
        head: catalog.projectCheckout.head,
        branch: null,
      }, true),
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        assertContained(this.#managedRoot, target);
        await runGit(project.path!, ["worktree", "remove", "--force", target])
          .catch(async () => {
            await rm(target, { recursive: true, force: true });
            await runGit(project.path!, ["worktree", "prune"]).catch(() => {});
          });
      },
    };
  }
}

function parseWorktreeList(output: string): Array<Omit<GitWorktree, "isProjectCheckout">> {
  const records = output.trim().split(/\r?\n\r?\n/).filter(Boolean);
  return records.flatMap(record => {
    let path: string | undefined;
    let head: string | undefined;
    let branch: string | null = null;
    let prunable = false;
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      } else if (line === "prunable" || line.startsWith("prunable ")) {
        prunable = true;
      }
    }
    return path && head && !prunable ? [{ path, head, branch }] : [];
  });
}

function workspaceFor(
  projectId: string,
  worktree: Omit<GitWorktree, "isProjectCheckout">,
  managed: boolean,
): WorkspaceSummary {
  const digest = createHash("sha256")
    .update(normalizePathForComparison(worktree.path))
    .digest("hex")
    .slice(0, 24);
  return {
    workspaceId: `workspace_git_${digest}`,
    projectId,
    name: worktree.branch ?? basename(worktree.path),
    path: worktree.path,
    kind: "worktree",
    managed,
  };
}

async function runGit(cwd: string, args: string[]) {
  return await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function safeSegment(value: string): string {
  const segment = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return segment || "project";
}

function assertContained(root: string, target: string): void {
  if (!isAbsolute(target)) throw new Error("managed-worktree-path-not-absolute");
  const relation = relative(resolve(root), resolve(target));
  if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("managed-worktree-path-outside-root");
  }
}

function samePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function normalizePathForComparison(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function gitFailureReason(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    if (String(error.code) === "ENOENT") return "Git is not installed or not on PATH.";
  }
  return "Project path is not an available Git worktree.";
}
