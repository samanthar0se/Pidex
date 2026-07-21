import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyPublishedSourceClosure } from "./source-closure.js";
import {
  isValidSourceInstanceMarker,
  matchesSourceInstanceMarker,
  SOURCE_CHECKOUT_MARKER_FILE,
  SOURCE_PREPARATION_MARKER_FILE,
  type SourceInstanceMarker,
} from "./source-markers.js";

export interface SourceLaunchRuntime {
  isLauncherStopped(): Promise<boolean> | boolean;
  inspectCanonicalOrigin(): Promise<"available" | "collision"> | "available" | "collision";
  invokeStableLauncher(launcherPath: string, releaseId: string): Promise<void> | void;
}

interface SourceLaunchOptions {
  checkoutDirectory: string;
  profileDirectory: string;
  owningSid: string;
  runtime: SourceLaunchRuntime;
}

interface SelectSourceReleaseOptions extends SourceLaunchOptions {
  releaseDirectory: string;
}

interface State { schemaVersion: 1; instanceId: string; owningSid: string }
interface Selection { schemaVersion: 1; activeReleaseId: string; previousReleaseId?: string }

export { selectAndStart as startSourceRelease, selectAndStart as updateSourceRelease };

export async function rollbackSourceRelease(options: SourceLaunchOptions): Promise<void> {
  const instance = resolvePreparedInstance(options);
  await assertSafeToSelect(options.runtime);
  const selection = readSelection(instance.launcherDirectory);
  if (!selection?.previousReleaseId) throw new Error("no predecessor source release is available for rollback");
  await selectAndStart({
    ...options,
    releaseDirectory: join(instance.sourceRoot, "releases", selection.previousReleaseId),
  });
}

async function selectAndStart(options: SelectSourceReleaseOptions): Promise<void> {
  const instance = resolvePreparedInstance(options);
  await assertSafeToSelect(options.runtime);

  const releaseDirectory = resolve(options.releaseDirectory);
  const expectedReleasesRoot = join(instance.sourceRoot, "releases");
  if (dirname(releaseDirectory) !== expectedReleasesRoot) {
    throw new Error("source release belongs to another instance root");
  }
  // This verification is deliberately repeated at activation time rather than
  // trusting publication output supplied by the source builder.
  const evidence = verifyPublishedSourceClosure(releaseDirectory);
  if (basename(releaseDirectory) !== evidence.releaseId) {
    throw new Error("source release selection does not match content identity");
  }

  mkdirSync(instance.launcherDirectory, { recursive: true });
  const current = readSelection(instance.launcherDirectory);
  const stableLauncher = join(instance.launcherDirectory, "pidex-launcher.exe");
  atomicCopy(evidence.launcherPath, stableLauncher);
  atomicJson(join(instance.launcherDirectory, "active-release"), {
    schemaVersion: 1,
    activeReleaseId: evidence.releaseId,
    ...(current?.activeReleaseId && current.activeReleaseId !== evidence.releaseId
      ? { previousReleaseId: current.activeReleaseId }
      : current?.previousReleaseId ? { previousReleaseId: current.previousReleaseId } : {}),
  } satisfies Selection);
  await options.runtime.invokeStableLauncher(stableLauncher, evidence.releaseId);
}

async function assertSafeToSelect(runtime: SourceLaunchRuntime): Promise<void> {
  if (!(await runtime.isLauncherStopped())) {
    throw new Error("stable launcher selection is allowed only while stopped");
  }
  if ((await runtime.inspectCanonicalOrigin()) === "collision") {
    throw new Error("fixed canonical origin collision");
  }
}

function resolvePreparedInstance(options: Pick<SourceLaunchOptions, "checkoutDirectory" | "profileDirectory" | "owningSid">) {
  const marker = readJson<SourceInstanceMarker>(join(resolve(options.checkoutDirectory), SOURCE_CHECKOUT_MARKER_FILE));
  if (!isValidSourceInstanceMarker(marker)) {
    throw new Error("invalid source checkout marker");
  }
  const sourceRoot = join(resolve(options.profileDirectory), "Pidex", "Source", marker.instanceId);
  const state = readJson<State>(join(sourceRoot, "instance.json"));
  if (state.schemaVersion !== 1 || state.instanceId !== marker.instanceId || state.owningSid !== options.owningSid) {
    throw new Error("source checkout is not prepared for the owning Windows identity");
  }
  const preparation = readJson<SourceInstanceMarker>(join(sourceRoot, SOURCE_PREPARATION_MARKER_FILE));
  if (!matchesSourceInstanceMarker(preparation, marker.instanceId)) {
    throw new Error("source checkout is not prepared");
  }
  return { sourceRoot, launcherDirectory: join(sourceRoot, "launcher") };
}

function readSelection(directory: string): Selection | undefined {
  const path = join(directory, "active-release");
  if (!existsSync(path)) return undefined;
  const selection = readJson<Selection>(path);
  if (selection.schemaVersion !== 1 || typeof selection.activeReleaseId !== "string") {
    throw new Error("invalid source release selection");
  }
  return selection;
}

function atomicCopy(source: string, target: string): void {
  const staged = `${target}.${randomUUID()}.stage`;
  try {
    copyFileSync(source, staged);
    renameSync(staged, target);
  } finally {
    rmSync(staged, { force: true });
  }
}

function atomicJson(path: string, value: unknown): void {
  const staged = `${path}.${randomUUID()}.stage`;
  try {
    writeFileSync(staged, `${JSON.stringify(value)}\n`, { flag: "wx" });
    renameSync(staged, path);
  } finally {
    rmSync(staged, { force: true });
  }
}

function readJson<T>(path: string): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; }
  catch (cause) { throw new Error("source checkout is not prepared", { cause }); }
}
