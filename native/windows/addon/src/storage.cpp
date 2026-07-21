#include "storage.hpp"

#include "node_api_helpers.hpp"

#include <Windows.h>

#include <array>

namespace pidex::windows::addon {
namespace {

struct drive_type_mapping final {
  UINT windows_type;
  const char* name;
};

constexpr std::array drive_types{
    drive_type_mapping{DRIVE_FIXED, "fixed"},
    drive_type_mapping{DRIVE_REMOVABLE, "removable"},
    drive_type_mapping{DRIVE_REMOTE, "remote"},
    drive_type_mapping{DRIVE_CDROM, "optical"},
    drive_type_mapping{DRIVE_RAMDISK, "ramdisk"},
};

const char* drive_type_name(const UINT windows_type) {
  for (const auto& drive_type : drive_types) {
    if (drive_type.windows_type == windows_type) return drive_type.name;
  }
  return "unknown";
}

}  // namespace

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
    check(napi_create_error(
        env, nullptr, text(env, "storage classification unavailable"),
        &error));
    return rejected_promise(env, error);
  }

  napi_value file_system{};
  check(napi_create_string_utf16(
      env, reinterpret_cast<const char16_t*>(filesystem.data()),
      NAPI_AUTO_LENGTH, &file_system));
  napi_value facts{};
  check(napi_create_object(env, &facts));
  property(env, facts, "fileSystem", file_system);
  property(env, facts, "driveType",
           text(env, drive_type_name(GetDriveTypeW(volume_path.data()))));
  return resolved_promise(env, facts);
}

}  // namespace pidex::windows::addon
