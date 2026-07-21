#pragma once

#include "pidex/windows/error.hpp"
#include "pidex/windows/raii.hpp"

#include <Windows.h>

#include <optional>
#include <string_view>

namespace pidex::windows {

struct authenticated_pipe_peer final {
  DWORD process_id;
};

// Creates the sole local-only server for an instance. FILE_FLAG_FIRST_PIPE_INSTANCE
// turns endpoint squatting into a typed failure rather than joining another pipe.
[[nodiscard]] std::optional<native_error> create_instance_pipe(
    std::wstring_view pipe_name, std::wstring_view owning_sid,
    unique_handle& pipe) noexcept;

// Impersonates a connected client and validates its token before protocol bytes
// are read. expected_process_id binds inherited child bootstrap to its process.
[[nodiscard]] std::optional<native_error> authenticate_pipe_peer(
    HANDLE pipe, std::wstring_view owning_sid,
    std::optional<DWORD> expected_process_id,
    authenticated_pipe_peer& peer) noexcept;

}  // namespace pidex::windows
