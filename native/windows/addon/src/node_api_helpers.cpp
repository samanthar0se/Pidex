#include "node_api_helpers.hpp"

namespace pidex::windows::addon {

void check(const napi_status status) {
  if (status != napi_ok) {
    napi_fatal_error("pidex_windows", NAPI_AUTO_LENGTH,
                     "Node-API initialization failed", NAPI_AUTO_LENGTH);
  }
}

napi_value text(napi_env env, const char* value) {
  napi_value result{};
  check(napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result));
  return result;
}

void property(napi_env env, napi_value object, const char* name,
              napi_value value) {
  check(napi_set_named_property(env, object, name, value));
}

void integer_property(napi_env env, napi_value object, const char* name,
                      const int value) {
  napi_value result{};
  check(napi_create_int32(env, value, &result));
  property(env, object, name, result);
}

napi_value resolved_promise(napi_env env, napi_value value) {
  napi_deferred deferred{};
  napi_value promise{};
  check(napi_create_promise(env, &deferred, &promise));
  check(napi_resolve_deferred(env, deferred, value));
  return promise;
}

napi_value rejected_promise(napi_env env, napi_value error) {
  napi_deferred deferred{};
  napi_value promise{};
  check(napi_create_promise(env, &deferred, &promise));
  check(napi_reject_deferred(env, deferred, error));
  return promise;
}

std::wstring argument_text(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value argument{};
  check(napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr));
  size_t length = 0;
  check(napi_get_value_string_utf16(env, argument, nullptr, 0, &length));
  std::wstring result(length + 1, L'\0');
  check(napi_get_value_string_utf16(
      env, argument, reinterpret_cast<char16_t*>(result.data()), length + 1,
      &length));
  result.resize(length);
  return result;
}

}  // namespace pidex::windows::addon
