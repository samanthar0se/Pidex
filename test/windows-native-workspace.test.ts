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

test("the per-instance pipe rejects squatting, remote access, and unauthenticated tokens", async () => {
  const [cmake, pipeSource] = await Promise.all([
    readNativeFile("common/CMakeLists.txt"),
    readNativeFile("common/src/local_pipe.cpp"),
  ]);
  assert.match(cmake, /local_pipe\.cpp/);
  assert.match(pipeSource, /FILE_FLAG_FIRST_PIPE_INSTANCE/);
  assert.match(pipeSource, /PIPE_REJECT_REMOTE_CLIENTS/);
  assert.match(pipeSource, /ImpersonateNamedPipeClient/);
  assert.match(pipeSource, /OpenThreadToken/);
  assert.match(pipeSource, /validate_owning_token/);
  assert.match(pipeSource, /GetNamedPipeClientProcessId/);
  assert.ok(
    pipeSource.indexOf("validate_owning_token") <
      pipeSource.indexOf("peer.process_id = process_id"),
  );
});

test("the per-instance pipe reports a failed impersonation revert before token errors", async () => {
  const pipeSource = await readNativeFile("common/src/local_pipe.cpp");

  assert.ok(
    pipeSource.indexOf("if (!reverted)") <
      pipeSource.indexOf("if (!opened)"),
  );
});

test("the Windows addon has one raw Node-API entry point without V8 or libuv", async () => {
  const [workspaceCmake, addonCmake, addonSource] = await Promise.all([
    readNativeFile("CMakeLists.txt"),
    readNativeFile("addon/CMakeLists.txt"),
    readNativeFile("addon/src/addon.cpp"),
  ]);

  assert.match(workspaceCmake, /add_subdirectory\(addon\)/);
  assert.match(addonCmake, /OUTPUT_NAME "pidex_windows"/);
  assert.match(addonCmake, /SUFFIX "\.node"/);
  assert.match(addonSource, /NAPI_MODULE/);
  assert.match(addonSource, /napi_create_promise/);
  assert.doesNotMatch(addonSource, /\bv8\b|uv\.h|node-addon-api/i);
});
