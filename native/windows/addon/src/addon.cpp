#include <node_api.h>

namespace {

void check(const napi_status status) {
  if (status != napi_ok) napi_fatal_error("pidex_windows", NAPI_AUTO_LENGTH, "Node-API initialization failed", NAPI_AUTO_LENGTH);
}

napi_value text(napi_env env, const char* value) {
  napi_value result{};
  check(napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result));
  return result;
}

void property(napi_env env, napi_value object, const char* name, napi_value value) {
  check(napi_set_named_property(env, object, name, value));
}

void integer_property(napi_env env, napi_value object, const char* name, const int value) {
  napi_value result{};
  check(napi_create_int32(env, value, &result));
  property(env, object, name, result);
}

napi_value self_test(napi_env env, napi_callback_info) {
  napi_deferred deferred{};
  napi_value promise{};
  check(napi_create_promise(env, &deferred, &promise));
  napi_value undefined{};
  check(napi_get_undefined(env, &undefined));
  check(napi_resolve_deferred(env, deferred, undefined));
  return promise;
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
  check(napi_create_array_with_length(env, 1, &names));
  check(napi_set_element(env, names, 0, text(env, "selfTest")));
  property(env, descriptor, "exports", names);
  property(env, exports, "descriptor", descriptor);

  napi_value function{};
  check(napi_create_function(env, "selfTest", NAPI_AUTO_LENGTH, self_test, nullptr, &function));
  property(env, exports, "selfTest", function);
  return exports;
}

}  // namespace

NAPI_MODULE(pidex_windows, initialize)
