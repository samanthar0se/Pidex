#include "pidex/windows/local_pipe.hpp"

#include "pidex/windows/identity.hpp"

#include <sddl.h>

#include <string>

namespace pidex::windows {

std::optional<native_error> create_instance_pipe(
    const std::wstring_view pipe_name, const std::wstring_view owning_sid,
    unique_handle& pipe) noexcept {
  const std::wstring name(pipe_name);
  if (!name.starts_with(LR"(\\.\pipe\pidex-)") || name.size() > 256) {
    return win32_error("CreateNamedPipe.name",
                       native_error_category::invalid_input,
                       ERROR_INVALID_NAME);
  }

  const std::wstring descriptor = L"D:P(A;;GA;;;" +
                                  std::wstring(owning_sid) + L")";
  PSECURITY_DESCRIPTOR raw_descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          descriptor.c_str(), SDDL_REVISION_1, &raw_descriptor, nullptr)) {
    return win32_error("CreateNamedPipe.security",
                       native_error_category::invalid_identity,
                       GetLastError());
  }
  unique_registration<HLOCAL, LocalFree> descriptor_memory(raw_descriptor);
  SECURITY_ATTRIBUTES security{sizeof(security), raw_descriptor, FALSE};

  unique_handle candidate(CreateNamedPipeW(
      name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT |
          PIPE_REJECT_REMOTE_CLIENTS,
      PIPE_UNLIMITED_INSTANCES, 1'048'580, 1'048'580, 0, &security));
  if (!candidate) {
    return win32_error("CreateNamedPipe",
                       native_error_category::permission_denied,
                       GetLastError());
  }
  pipe = std::move(candidate);
  return std::nullopt;
}

std::optional<native_error> authenticate_pipe_peer(
    const HANDLE pipe, const std::wstring_view owning_sid,
    const std::optional<DWORD> expected_process_id,
    authenticated_pipe_peer& peer) noexcept {
  ULONG process_id = 0;
  if (!GetNamedPipeClientProcessId(pipe, &process_id)) {
    return win32_error("GetNamedPipeClientProcessId",
                       native_error_category::invalid_identity,
                       GetLastError());
  }
  if (expected_process_id && process_id != *expected_process_id) {
    return win32_error("NamedPipeClientProcessId",
                       native_error_category::invalid_identity,
                       ERROR_ACCESS_DENIED);
  }
  if (!ImpersonateNamedPipeClient(pipe)) {
    return win32_error("ImpersonateNamedPipeClient",
                       native_error_category::invalid_identity,
                       GetLastError());
  }

  unique_handle token;
  HANDLE raw_token = nullptr;
  const BOOL opened = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE,
                                      &raw_token);
  const DWORD open_error = opened ? ERROR_SUCCESS : GetLastError();
  token.reset(raw_token);
  const BOOL reverted = RevertToSelf();
  if (!reverted) {
    return win32_error("RevertToSelf", native_error_category::internal,
                       GetLastError());
  }
  if (!opened) {
    return win32_error("OpenThreadToken",
                       native_error_category::invalid_identity, open_error);
  }
  if (auto error = validate_owning_token(token.get(), owning_sid)) {
    return error;
  }
  peer.process_id = process_id;
  return std::nullopt;
}

}  // namespace pidex::windows
