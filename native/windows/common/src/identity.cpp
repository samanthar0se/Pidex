#include "pidex/windows/identity.hpp"
#include "pidex/windows/raii.hpp"

#include <sddl.h>

#include <cstddef>
#include <string>
#include <vector>

namespace pidex::windows {
namespace {

std::optional<native_error> read_token_information(
    const HANDLE token, const TOKEN_INFORMATION_CLASS information_class,
    std::vector<std::byte>& buffer) noexcept {
  DWORD size = 0;
  GetTokenInformation(token, information_class, nullptr, 0, &size);
  const DWORD size_error = GetLastError();
  if (size_error != ERROR_INSUFFICIENT_BUFFER) {
    return win32_error("GetTokenInformation.size",
                       native_error_category::invalid_identity, size_error);
  }

  buffer.resize(size);
  if (!GetTokenInformation(token, information_class, buffer.data(), size,
                           &size)) {
    return win32_error("GetTokenInformation.value",
                       native_error_category::invalid_identity,
                       GetLastError());
  }

  return std::nullopt;
}

}  // namespace

std::optional<native_error> validate_owning_token(
    HANDLE token, const std::wstring_view owning_sid) noexcept {
  PSID expected_sid = nullptr;
  const std::wstring sid_text(owning_sid);
  if (!ConvertStringSidToSidW(sid_text.c_str(), &expected_sid)) {
    return win32_error("ConvertStringSidToSid",
                       native_error_category::invalid_input, GetLastError());
  }
  unique_registration<HLOCAL, LocalFree> expected_sid_memory(expected_sid);

  std::vector<std::byte> user_buffer;
  if (auto error = read_token_information(token, TokenUser, user_buffer)) {
    return error;
  }
  const auto* user = reinterpret_cast<const TOKEN_USER*>(user_buffer.data());
  if (!EqualSid(user->User.Sid, expected_sid)) {
    return win32_error("TokenUser", native_error_category::invalid_identity,
                       ERROR_ACCESS_DENIED);
  }

  TOKEN_ELEVATION elevation{};
  DWORD returned = 0;
  if (!GetTokenInformation(token, TokenElevation, &elevation,
                           sizeof(elevation), &returned)) {
    return win32_error("TokenElevation",
                       native_error_category::invalid_identity,
                       GetLastError());
  }
  if (elevation.TokenIsElevated == 0) {
    return win32_error("TokenElevation",
                       native_error_category::permission_denied,
                       ERROR_ELEVATION_REQUIRED);
  }

  DWORD app_container = 0;
  if (!GetTokenInformation(token, TokenIsAppContainer, &app_container,
                           sizeof(app_container), &returned)) {
    return win32_error("TokenIsAppContainer",
                       native_error_category::invalid_identity,
                       GetLastError());
  }
  if (app_container != 0) {
    return win32_error("TokenIsAppContainer",
                       native_error_category::permission_denied,
                       ERROR_ACCESS_DENIED);
  }

  BYTE admin_buffer[SECURITY_MAX_SID_SIZE];
  DWORD admin_size = sizeof(admin_buffer);
  if (!CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admin_buffer,
                          &admin_size)) {
    return win32_error("CreateWellKnownSid.administrators",
                       native_error_category::internal, GetLastError());
  }

  BOOL administrator = FALSE;
  if (!CheckTokenMembership(token, admin_buffer, &administrator)) {
    return win32_error("CheckTokenMembership",
                       native_error_category::invalid_identity,
                       GetLastError());
  }
  if (!administrator) {
    return win32_error("CheckTokenMembership",
                       native_error_category::permission_denied,
                       ERROR_ACCESS_DENIED);
  }

  return std::nullopt;
}

}  // namespace pidex::windows
