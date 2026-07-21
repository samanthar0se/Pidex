#include <node_api.h>

#include "diagnostics.hpp"
#include "node_api_helpers.hpp"
#include "storage.hpp"

namespace pidex::windows::addon {

napi_value self_test(napi_env env, napi_callback_info) {
  napi_value undefined{};
  check(napi_get_undefined(env, &undefined));
  return resolved_promise(env, undefined);
}

napi_value initialize(napi_env env, napi_value exports) {
  napi_value descriptor{};
  check(napi_create_object(env, &descriptor));
  integer_property(env, descriptor, "schemaVersion", 1);
  property(env, descriptor, "architecture", text(env, "x64"));
  integer_property(env, descriptor, "nodeApi", NAPI_VERSION);
  property(env, descriptor, "abi", text(env, "napi-10"));
  integer_property(env, descriptor, "addonGeneration", PIDEX_ADDON_GENERATION);
  integer_property(env, descriptor, "schemaGeneration", PIDEX_SCHEMA_GENERATION);
  property(env, descriptor, "releaseId", text(env, PIDEX_RELEASE_ID));

  napi_value names{};
  check(napi_create_array_with_length(env, 3, &names));
  check(napi_set_element(env, names, 0, text(env, "selfTest")));
  check(napi_set_element(env, names, 1, text(env, "inspectStoragePath")));
  check(napi_set_element(env, names, 2, text(env, "writeDiagnosticEvent")));
  property(env, descriptor, "exports", names);
  property(env, exports, "descriptor", descriptor);

  napi_value function{};
  check(napi_create_function(env, "selfTest", NAPI_AUTO_LENGTH, self_test, nullptr, &function));
  property(env, exports, "selfTest", function);
  check(napi_create_function(env, "inspectStoragePath", NAPI_AUTO_LENGTH,
                             inspect_storage_path, nullptr, &function));
  property(env, exports, "inspectStoragePath", function);
  check(napi_create_function(env, "writeDiagnosticEvent", NAPI_AUTO_LENGTH,
                             write_diagnostic_event, nullptr, &function));
  property(env, exports, "writeDiagnosticEvent", function);
  return exports;
}

}  // namespace pidex::windows::addon

NAPI_MODULE(pidex_windows, pidex::windows::addon::initialize)
