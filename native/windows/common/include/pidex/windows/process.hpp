#pragma once

#include "pidex/windows/error.hpp"

#include <Windows.h>

#include <filesystem>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace pidex::windows {

struct contained_process_request final {
  std::filesystem::path executable;
  std::filesystem::path working_directory;
  std::vector<std::wstring> arguments;
  std::map<std::wstring, std::wstring, std::less<>> environment;
};

struct process_exit_evidence final {
  std::optional<DWORD> exit_code;
  bool job_empty;
  bool explicitly_terminated;
  std::optional<native_error> teardown_failure;
};

class managed_process final {
 public:
  ~managed_process() noexcept;
  managed_process(const managed_process&) = delete;
  managed_process& operator=(const managed_process&) = delete;
  managed_process(managed_process&&) noexcept;
  managed_process& operator=(managed_process&&) noexcept;

  [[nodiscard]] DWORD process_id() const noexcept;
  [[nodiscard]] std::variant<process_exit_evidence, native_error> evidence()
      const noexcept;
  [[nodiscard]] std::optional<native_error> terminate(
      unsigned int exit_code = 1) noexcept;
  [[nodiscard]] std::optional<native_error> close() noexcept;

 private:
  struct state;
  explicit managed_process(std::unique_ptr<state> state) noexcept;
  std::unique_ptr<state> state_;

  friend std::variant<managed_process, native_error> spawn_contained(
      const contained_process_request&) noexcept;
};

// Returns only after the process has been resumed inside a fresh Job. Any
// failure returns after terminating the still-suspended partial process and
// closing every acquired handle.
[[nodiscard]] std::variant<managed_process, native_error> spawn_contained(
    const contained_process_request& request) noexcept;

}  // namespace pidex::windows
