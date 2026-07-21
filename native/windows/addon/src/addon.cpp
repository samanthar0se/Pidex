#include <node_api.h>
#include <Windows.h>

#include <array>
#include <string>

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

napi_value resolved_promise(napi_env env, napi_value value) {
  napi_deferred deferred{};
  napi_value promise{};
  check(napi_create_promise(env, &deferred, &promise));
  check(napi_resolve_deferred(env, deferred, value));
  return promise;
}

std::wstring argument_text(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value argument{};
  check(napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr));
  size_t length = 0;
  check(napi_get_value_string_utf16(env, argument, nullptr, 0, &length));
  std::wstring result(length + 1, L'\0');
  check(napi_get_value_string_utf16(env, argument,
      reinterpret_cast<char16_t*>(result.data()), length + 1, &length));
  result.resize(length);
  return result;
}

const char* drive_type_name(const UINT type) {
  switch (type) {
    case DRIVE_FIXED: return "fixed";
    case DRIVE_REMOVABLE: return "removable";
    case DRIVE_REMOTE: return "remote";
    case DRIVE_CDROM: return "optical";
    case DRIVE_RAMDISK: return "ramdisk";
    default: return "unknown";
  }
}

napi_value inspect_storage_path(napi_env env, napi_callback_info info) {
  const auto path = argument_text(env, info);
  std::array<wchar_t, MAX_PATH + 1> volume_path{};
  std::array<wchar_t, MAX_PATH + 1> filesystem{};
  if (!GetVolumePathNameW(path.c_str(), volume_path.data(),
                          static_cast<DWORD>(volume_path.size())) ||
      !GetVolumeInformationW(volume_path.data(), nullptr, 0, nullptr, nullptr,
                             nullptr, filesystem.data(),
                             static_cast<DWORD>(filesystem.size()))) {
    napi_value error{};
    check(napi_create_error(env, nullptr, text(env, "storage classification unavailable"), &error));
    napi_deferred deferred{};
    napi_value promise{};
    check(napi_create_promise(env, &deferred, &promise));
    check(napi_reject_deferred(env, deferred, error));
    return promise;
  }
  napi_value result{};
  check(napi_create_object(env, &result));
  check(napi_create_string_utf16(env,
      reinterpret_cast<const char16_t*>(filesystem.data()), NAPI_AUTO_LENGTH, &result));
  napi_value facts{};
  check(napi_create_object(env, &facts));
  property(env, facts, "fileSystem", result);
  property(env, facts, "driveType", text(env, drive_type_name(GetDriveTypeW(volume_path.data()))));
  return resolved_promise(env, facts);
}

napi_value write_diagnostic_event(napi_env env, napi_callback_info) {
  HANDLE source = RegisterEventSourceW(nullptr, L"Pidex");
  BOOL written = FALSE;
  if (source != nullptr) {
    const wchar_t* message = L"Pidex reported a coarse health finding; inspect structured local diagnostics.";
    written = ReportEventW(source, EVENTLOG_WARNING_TYPE, 0, 1, nullptr, 1, 0,
                           &message, nullptr);
    DeregisterEventSource(source);
  }
  napi_value result{};
  check(napi_get_boolean(env, written != FALSE, &result));
  return resolved_promise(env, result);
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

}  // namespace

NAPI_MODULE(pidex_windows, initialize)
