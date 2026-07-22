#include "supervision.hpp"

#include "pidex/windows/raii.hpp"

#include <Windows.h>

#include <filesystem>
#include <string>

using pidex::windows::launcher::start_supervised_daemon;
using pidex::windows::unique_handle;

// Arguments are resolved by the source driver; the launcher never searches
// PATH, interprets Host authority, or selects a different instance/release.
int wmain(const int argc, wchar_t** argv) {
  if (argc != 5) return ERROR_INVALID_PARAMETER;
  const std::wstring instance_id(argv[1]);
  const std::filesystem::path daemon(argv[2]);
  const std::filesystem::path working_directory(argv[3]);
  const std::filesystem::path history(argv[4]);

  unique_handle singleton(CreateMutexW(
      nullptr, TRUE, (L"Local\\Pidex-Launcher-" + instance_id).c_str()));
  if (!singleton || GetLastError() == ERROR_ALREADY_EXISTS) {
    return ERROR_ALREADY_EXISTS;
  }

  auto daemon_process =
      start_supervised_daemon(daemon, working_directory, history);
  static_cast<void>(daemon_process);

  // Retaining the Job handle ensures launcher termination kills the daemon
  // and every descendant.
  Sleep(INFINITE);
  return 0;
}
