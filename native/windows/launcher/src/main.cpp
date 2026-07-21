#include "local_control.hpp"
#include "supervision.hpp"

#include "pidex/windows/local_pipe.hpp"
#include "pidex/windows/raii.hpp"

#include <Windows.h>

#include <filesystem>
#include <string>

using pidex::windows::launcher::local_control_context;
using pidex::windows::launcher::serve_local_control;
using pidex::windows::launcher::start_supervised_daemon;
using pidex::windows::unique_handle;

// Arguments are resolved by the source driver; the launcher never searches
// PATH, interprets Host authority, or selects a different instance/release.
int wmain(const int argc, wchar_t** argv) {
  if (argc != 7) return ERROR_INVALID_PARAMETER;
  const std::wstring instance_id(argv[1]);
  const std::wstring owning_sid(argv[2]);
  const std::wstring pipe_name(argv[3]);
  const std::filesystem::path daemon(argv[4]);
  const std::filesystem::path working_directory(argv[5]);
  const std::filesystem::path history(argv[6]);

  unique_handle singleton(CreateMutexW(
      nullptr, TRUE, (L"Local\\Pidex-Launcher-" + instance_id).c_str()));
  if (!singleton || GetLastError() == ERROR_ALREADY_EXISTS) {
    return ERROR_ALREADY_EXISTS;
  }

  unique_handle pipe;
  if (pidex::windows::create_instance_pipe(pipe_name, owning_sid, pipe)) {
    return ERROR_ACCESS_DENIED;
  }
  local_control_context control_context{pipe.get(), owning_sid};
  unique_handle control_thread(CreateThread(
      nullptr, 0, serve_local_control, &control_context, 0, nullptr));
  if (!control_thread) return static_cast<int>(GetLastError());

  auto daemon_process =
      start_supervised_daemon(daemon, working_directory, history);
  static_cast<void>(daemon_process);

  // Local control stays resident in ready, stopped, absent, and circuit-open
  // states. Retaining the Job handle ensures launcher termination kills the
  // daemon and every descendant.
  Sleep(INFINITE);
  return 0;
}
