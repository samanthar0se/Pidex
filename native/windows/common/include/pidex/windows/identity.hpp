#pragma once

#include "pidex/windows/error.hpp"
#include <Windows.h>
#include <optional>
#include <string_view>

namespace pidex::windows {

// Returns no value only when the token is the exact owning, elevated,
// administrator, non-AppContainer identity. This check must precede mutation.
[[nodiscard]] std::optional<native_error> validate_owning_token(
    HANDLE token, std::wstring_view owning_sid) noexcept;

}  // namespace pidex::windows
