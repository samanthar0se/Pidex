#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace pidex::windows {

enum class native_error_domain {
  win32,
  hresult,
  dns,
  configret,
  node_api,
};

enum class native_error_category {
  invalid_identity,
  permission_denied,
  invalid_input,
  unavailable,
  conflict,
  resource_exhausted,
  internal,
};

struct native_error final {
  std::string operation;
  native_error_category category;
  native_error_domain domain;
  std::int64_t code;
  bool retryable;
  std::string redacted_detail;
};

[[nodiscard]] native_error win32_error(std::string_view operation,
                                        native_error_category category,
                                        unsigned long code,
                                        bool retryable = false) noexcept;

}  // namespace pidex::windows
