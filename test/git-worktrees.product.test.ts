import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import WebSocket from "ws";
import { adaptersFor } from "../packages/adapters/src/index.js";
import { GitWorktreeManager } from "../packages/host/src/git-worktrees.js";
import { startHost } from "../packages/host/src/host.js";
import {
  controlWebSocketUrl,
  negotiateControl,
  nextControlMessage,
} from "./control-client.js";

const execFileAsync = promisify(execFile);

test("Git worktree discovery validates existing choices and creates detached managed worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-git-worktrees-"));
  const repository = join(root, "repository");
  const existing = join(root, "existing");
  const dataDir = join(repository, ".pidex-data");
  try {
    await git(root, ["init", repository]);
    await git(repository, ["config", "user.email", "pidex@example.invalid"]);
    await git(repository, ["config", "user.name", "Pidex Test"]);
    await writeFile(join(repository, "README.md"), "Pidex\n");
    await git(repository, ["add", "README.md"]);
    await git(repository, ["commit", "-m", "initial"]);
    await git(repository, ["worktree", "add", "--detach", existing, "HEAD"]);

    const manager = new GitWorktreeManager(dataDir);
    const project = {
      projectId: "project",
      name: "Project",
      path: repository,
    };
    const catalog = await manager.list(project);
    assert.equal(catalog.available, true);
    assert.equal(catalog.projectCheckout?.path, await realpath(repository));
    assert.deepEqual(catalog.worktrees.map(item => item.path), [
      await realpath(existing),
    ]);

    const selected = await manager.selectExisting(project, existing);
    assert.equal(selected.path, await realpath(existing));
    assert.equal(selected.kind, "worktree");
    assert.equal(selected.managed, false);

    const managed = await manager.createManaged(project, "session-one");
    assert.equal(managed.workspace.kind, "worktree");
    assert.equal(managed.workspace.managed, true);
    assert.equal((await stat(managed.workspace.path!)).isDirectory(), true);
    const { stdout } = await git(managed.workspace.path!, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    assert.equal(stdout.trim(), "HEAD");

    await managed.cleanup();
    await assert.rejects(stat(managed.workspace.path!));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Host creates and reuses Git worktrees as durable Session Workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "pidex-host-worktrees-"));
  const repository = join(root, "repository");
  const dataDir = join(root, "data");
  await git(root, ["init", repository]);
  await git(repository, ["config", "user.email", "pidex@example.invalid"]);
  await git(repository, ["config", "user.name", "Pidex Test"]);
  await writeFile(join(repository, "README.md"), "Pidex\n");
  await git(repository, ["add", "README.md"]);
  await git(repository, ["commit", "-m", "initial"]);

  const host = await startHost({
    dataDir,
    port: 0,
    authorization: "test-device",
    adapters: adaptersFor("deterministic"),
    initialCatalog: {
      projects: [{ projectId: "project", name: "Project", path: repository }],
    },
  });
  try {
    const discovered = await fetch(
      `${host.origin}/api/projects/project/worktrees`,
    ).then(response => response.json()) as {
      available: boolean;
      worktrees: Array<{ path: string }>;
    };
    assert.equal(discovered.available, true);
    assert.deepEqual(discovered.worktrees, []);

    const first = await connect(host.origin);
    first.send(JSON.stringify({
      type: "session.create",
      commandId: "create-managed",
      projectId: "project",
      worktree: { kind: "new" },
    }));
    assert.equal((await nextControlMessage(first)).type, "command.outcome");
    const firstChange = await nextControlMessage(first);
    assert.equal(firstChange.type, "host.change-set");
    if (firstChange.type !== "host.change-set") {
      throw new Error("expected managed Session change");
    }
    const managedSession = firstChange.changes[0]?.session;
    assert.ok(managedSession?.workspaceId);
    first.close();

    const afterCreation = await fetch(
      `${host.origin}/api/projects/project/worktrees`,
    ).then(response => response.json()) as {
      worktrees: Array<{ path: string }>;
    };
    assert.equal(afterCreation.worktrees.length, 1);
    const managedPath = afterCreation.worktrees[0]!.path;
    assert.equal((await stat(managedPath)).isDirectory(), true);

    const second = await connect(host.origin);
    second.send(JSON.stringify({
      type: "session.create",
      commandId: "reuse-managed",
      projectId: "project",
      worktree: { kind: "existing", path: managedPath },
    }));
    assert.equal((await nextControlMessage(second)).type, "command.outcome");
    const secondChange = await nextControlMessage(second);
    assert.equal(secondChange.type, "host.change-set");
    if (secondChange.type !== "host.change-set") {
      throw new Error("expected reused Session change");
    }
    assert.equal(
      secondChange.changes[0]?.session?.workspaceId,
      managedSession.workspaceId,
    );
    second.close();

    const catalogSocket = new WebSocket(controlWebSocketUrl(host.origin), {
      headers: { authorization: "Bearer test-device" },
    });
    const catalog = await negotiateControl(catalogSocket);
    assert.equal(
      catalog.workspaces.find(item =>
        item.workspaceId === managedSession.workspaceId
      )?.path,
      managedPath,
    );
    catalogSocket.close();
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function connect(origin: string): Promise<WebSocket> {
  const socket = new WebSocket(controlWebSocketUrl(origin), {
    headers: { authorization: "Bearer test-device" },
  });
  await negotiateControl(socket);
  return socket;
}

async function git(cwd: string, args: string[]) {
  return await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}
