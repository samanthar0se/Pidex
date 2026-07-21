#pragma once

#include <node_api.h>

#include <string>

namespace pidex::windows::addon {

void check(napi_status status);
napi_value text(napi_env env, const char* value);
void property(napi_env env, napi_value object, const char* name,
              napi_value value);
void integer_property(napi_env env, napi_value object, const char* name,
                      int value);
napi_value resolved_promise(napi_env env, napi_value value);
napi_value rejected_promise(napi_env env, napi_value error);
std::wstring argument_text(napi_env env, napi_callback_info info);

}  // namespace pidex::windows::addon
