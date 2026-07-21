#include "supervision.hpp"

#include "history.hpp"

#include <Windows.h>

#include <array>
#include <utility>
#include <variant>

namespace pidex::windows::launcher {
namespace {

constexpr DWORD READINESS_DEADLINE_MS = 15'000;
constexpr std::array<DWORD, 5> STARTUP_BACKOFF_MS{
    1'000, 2'000, 4'000, 8'000, 16'000};

}  // namespace

std::optional<managed_process> start_supervised_daemon(
    const std::filesystem::path& executable,
    const std::filesystem::path& working_directory,
    const std::filesystem::path& history) noexcept {
  std::optional<managed_process> daemon_process;
  for (std::size_t attempt = 0; attempt <= STARTUP_BACKOFF_MS.size(); ++attempt) {
    contained_process_request request{
        .executable = executable,
        .working_directory = working_directory,
        .arguments = {},
        .environment = {},
    };
    auto result = spawn_contained(request);
    if (std::holds_alternative<managed_process>(result)) {
      daemon_process = std::get<managed_process>(std::move(result));
      // A process surviving the bounded bootstrap window is not routed until
      // its authenticated child handshake reports matching readiness.
      if (!daemon_process->wait_for_exit(READINESS_DEADLINE_MS)) {
        append_launcher_history(history, "{\"state\":\"ready\"}\n");
        break;
      }
      daemon_process->close();
      daemon_process.reset();
    }
    if (attempt < STARTUP_BACKOFF_MS.size()) {
      Sleep(STARTUP_BACKOFF_MS[attempt]);
    }
  }

  if (!daemon_process) {
    append_launcher_history(history, "{\"state\":\"circuit-open\"}\n");
  }
  return daemon_process;
}

}  // namespace pidex::windows::launcher
