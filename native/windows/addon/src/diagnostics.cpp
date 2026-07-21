#include "diagnostics.hpp"

#include "node_api_helpers.hpp"

#include <Windows.h>

namespace pidex::windows::addon {

napi_value write_diagnostic_event(napi_env env, napi_callback_info) {
  HANDLE source = RegisterEventSourceW(nullptr, L"Pidex");
  BOOL written = FALSE;
  if (source != nullptr) {
    const wchar_t* message =
        L"Pidex reported a coarse health finding; inspect structured local "
        L"diagnostics.";
    written = ReportEventW(source, EVENTLOG_WARNING_TYPE, 0, 1, nullptr, 1, 0,
                           &message, nullptr);
    DeregisterEventSource(source);
  }
  napi_value result{};
  check(napi_get_boolean(env, written != FALSE, &result));
  return resolved_promise(env, result);
}

}  // namespace pidex::windows::addon
