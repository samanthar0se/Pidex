#pragma once

#include <node_api.h>

namespace pidex::windows::addon {

napi_value write_diagnostic_event(napi_env env, napi_callback_info info);

}  // namespace pidex::windows::addon
