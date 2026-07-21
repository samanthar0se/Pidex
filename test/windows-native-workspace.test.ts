import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../native/windows/", import.meta.url);

test("the Windows native candidate pins every build input and security primitive", async () => {
  const candidate = JSON.parse(
    await readFile(new URL("candidate.json", root), "utf8"),
  ) as Record<string, any>;

  assert.equal(candidate.schemaVersion, 1);
  assert.equal(candidate.architecture, "x64");
  assert.equal(candidate.languageStandard, "c++20");
  assert.match(candidate.msvc.version, /^\d+\.\d+\.\d+$/);
  assert.match(candidate.windowsSdk.version, /^10\.0\.\d+\.0$/);
  assert.match(candidate.cmake.version, /^\d+\.\d+\.\d+$/);
  assert.match(candidate.cmake.sha256, /^[a-f0-9]{64}$/);
  assert.ok(candidate.compilerOptions.includes("/WX"));
  assert.ok(candidate.linkerOptions.includes("/WX"));
  assert.equal(candidate.nodeLanes.length, 2);
  for (const lane of candidate.nodeLanes) {
    assert.match(lane.version, /^\d+\.\d+\.\d+$/);
    assert.equal(lane.nodeApi, 10);
    assert.match(lane.headers.sha256, /^[a-f0-9]{64}$/);
    assert.match(lane.headers.url, /^https:\/\/nodejs\.org\/dist\/v/);
  }

  const common = await readFile(new URL("common/CMakeLists.txt", root), "utf8");
  assert.match(common, /pidex_windows_common/);
  const identity = await readFile(new URL("common/src/identity.cpp", root), "utf8");
  assert.match(identity, /TokenUser/);
  assert.match(identity, /TokenElevation/);
  assert.match(identity, /TokenIsAppContainer/);
  assert.match(identity, /CheckTokenMembership/);
  const error = await readFile(new URL("common/include/pidex\/windows\/error.hpp", root), "utf8");
  assert.match(error, /enum class native_error_domain/);
  assert.match(error, /redacted_detail/);
  assert.doesNotMatch(error, /FormatMessage/);
  const raii = await readFile(new URL("common/include/pidex\/windows\/raii.hpp", root), "utf8");
  assert.match(raii, /unique_handle/);
  assert.match(raii, /unique_com/);
  assert.match(raii, /unique_registration/);
});
