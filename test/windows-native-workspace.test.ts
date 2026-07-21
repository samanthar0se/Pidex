import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { z } from "zod";

const root = new URL("../native/windows/", import.meta.url);

const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidate: z.string().min(1),
  architecture: z.literal("x64"),
  languageStandard: z.literal("c++20"),
  msvc: z.strictObject({
    version: semanticVersionSchema,
    toolset: semanticVersionSchema,
    hostArchitecture: z.literal("x64"),
  }),
  windowsSdk: z.strictObject({
    version: z.string().regex(/^10\.0\.\d+\.0$/),
  }),
  cmake: z.strictObject({
    version: semanticVersionSchema,
    url: z.string().url(),
    sha256: sha256Schema,
  }),
  nodeLanes: z
    .array(
      z.strictObject({
        lane: z.enum(["primary", "secondary"]),
        version: semanticVersionSchema,
        nodeApi: z.literal(10),
        headers: z.strictObject({
          url: z.string().regex(/^https:\/\/nodejs\.org\/dist\/v/),
          sha256: sha256Schema,
        }),
      }),
    )
    .length(2),
  compilerOptions: z.array(z.string()),
  linkerOptions: z.array(z.string()),
});

async function readNativeFile(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("the Windows native candidate pins every build input", async () => {
  const candidate = candidateSchema.parse(
    JSON.parse(await readNativeFile("candidate.json")),
  );

  assert.ok(candidate.compilerOptions.includes("/WX"));
  assert.ok(candidate.linkerOptions.includes("/WX"));
  assert.deepEqual(
    candidate.nodeLanes.map(lane => lane.lane),
    ["primary", "secondary"],
  );

  const [workspaceCmake, commonCmake] = await Promise.all([
    readNativeFile("CMakeLists.txt"),
    readNativeFile("common/CMakeLists.txt"),
  ]);
  assert.ok(workspaceCmake.includes(candidate.cmake.version));
  assert.ok(workspaceCmake.includes(candidate.msvc.version));
  assert.ok(workspaceCmake.includes(candidate.windowsSdk.version));
  for (const option of [
    ...candidate.compilerOptions,
    ...candidate.linkerOptions,
  ]) {
    assert.ok(commonCmake.includes(option));
  }
});

test("the Windows common library exposes identity, error, and lifetime primitives", async () => {
  const [commonCmake, identitySource, errorHeader, raiiHeader] =
    await Promise.all([
      readNativeFile("common/CMakeLists.txt"),
      readNativeFile("common/src/identity.cpp"),
      readNativeFile("common/include/pidex/windows/error.hpp"),
      readNativeFile("common/include/pidex/windows/raii.hpp"),
    ]);

  assert.match(commonCmake, /pidex_windows_common/);
  assert.match(identitySource, /TokenUser/);
  assert.match(identitySource, /TokenElevation/);
  assert.match(identitySource, /TokenIsAppContainer/);
  assert.match(identitySource, /CheckTokenMembership/);
  assert.match(errorHeader, /enum class native_error_domain/);
  assert.match(errorHeader, /redacted_detail/);
  assert.doesNotMatch(errorHeader, /FormatMessage/);
  assert.match(raiiHeader, /unique_handle/);
  assert.match(raiiHeader, /unique_com/);
  assert.match(raiiHeader, /unique_registration/);
});

test("a managed process cannot run before its fresh kill-on-close Job contains it", async () => {
  const [commonCmake, processHeader, processSource] = await Promise.all([
    readNativeFile("common/CMakeLists.txt"),
    readNativeFile("common/include/pidex/windows/process.hpp"),
    readNativeFile("common/src/process.cpp"),
  ]);

  assert.match(commonCmake, /src\/process\.cpp/);
  assert.match(processHeader, /spawn_contained/);
  assert.match(processHeader, /class managed_process/);
  assert.match(processHeader, /process_exit_evidence/);
  assert.match(processHeader, /job_empty/);

  const create = processSource.indexOf("CreateProcessW");
  const job = processSource.indexOf("CreateJobObjectW");
  const configure = processSource.indexOf("SetInformationJobObject");
  const assign = processSource.indexOf("AssignProcessToJobObject");
  const resume = processSource.indexOf("ResumeThread");
  assert.ok(create >= 0 && job > create && configure > job);
  assert.ok(assign > configure && resume > assign);
  assert.match(processSource, /CREATE_SUSPENDED/);
  assert.match(processSource, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.doesNotMatch(processSource, /JOB_OBJECT_LIMIT_(?:SILENT_)?BREAKAWAY_OK/);
  assert.match(processSource, /TerminateProcess/);
  assert.match(processSource, /terminate_partial_process/);
  assert.match(processSource, /std::call_once/);
});
