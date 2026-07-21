#include "pidex/windows/error.hpp"

namespace pidex::windows {

native_error win32_error(const std::string_view operation,
                         const native_error_category category,
                         const unsigned long code,
                         const bool retryable) noexcept {
  // Localized system messages can contain sensitive paths or names. Policy gets
  // only stable fields; callers may supply a separately reviewed coarse detail.
  return {
      .operation = std::string(operation),
      .category = category,
      .domain = native_error_domain::win32,
      .code = static_cast<std::int64_t>(code),
      .retryable = retryable,
      .redacted_detail = "native operation failed",
  };
}

}  // namespace pidex::windows
