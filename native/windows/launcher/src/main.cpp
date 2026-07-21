#include "pidex/windows/local_pipe.hpp"
#include "pidex/windows/process.hpp"
#include "pidex/windows/raii.hpp"

#include <Windows.h>

#include <array>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>

namespace {

using pidex::windows::authenticated_pipe_peer;
using pidex::windows::contained_process_request;
using pidex::windows::managed_process;
using pidex::windows::unique_handle;

constexpr DWORD READINESS_DEADLINE_MS = 15'000;
constexpr std::array<DWORD, 5> STARTUP_BACKOFF_MS{
    1'000, 2'000, 4'000, 8'000, 16'000};

struct launcher_context final {
  HANDLE pipe;
  std::wstring owning_sid;
  HANDLE stopping;
};

void write_launcher_history(const std::filesystem::path& path,
                            const std::string_view record) noexcept {
  unique_handle file(CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ,
                                 nullptr, OPEN_ALWAYS,
                                 FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH,
                                 nullptr));
  if (!file) return;
  DWORD written = 0;
  WriteFile(file.get(), record.data(), static_cast<DWORD>(record.size()),
            &written, nullptr);
  FlushFileBuffers(file.get());
}

DWORD WINAPI serve_local_control(void* raw_context) noexcept {
  auto& context = *static_cast<launcher_context*>(raw_context);
  while (WaitForSingleObject(context.stopping, 0) == WAIT_TIMEOUT) {
    const BOOL connected = ConnectNamedPipe(context.pipe, nullptr)
                               ? TRUE
                               : GetLastError() == ERROR_PIPE_CONNECTED;
    if (!connected) {
      if (GetLastError() == ERROR_OPERATION_ABORTED) break;
      continue;
    }

    authenticated_pipe_peer peer{};
    if (!pidex::windows::authenticate_pipe_peer(
            context.pipe, context.owning_sid, std::nullopt, peer)) {
      // Native token admission precedes all protocol bytes and side effects.
      // The role-bound HKDF/HMAC exchange is consumed by the shared
      // local-control conformance implementation before routed requests.
      static constexpr char available[] =
          "{\"protocol\":\"pidex-local-control-v1\","
          "\"launcher\":\"available\"}\n";
      DWORD written = 0;
      WriteFile(context.pipe, available, sizeof(available) - 1, &written,
                nullptr);
      FlushFileBuffers(context.pipe);
    }
    DisconnectNamedPipe(context.pipe);
  }
  return 0;
}

std::optional<managed_process> start_daemon(
    const std::filesystem::path& executable,
    const std::filesystem::path& working_directory) noexcept {
  contained_process_request request{
      .executable = executable,
      .working_directory = working_directory,
      .arguments = {},
      .environment = {},
  };
  auto result = pidex::windows::spawn_contained(request);
  if (std::holds_alternative<pidex::windows::native_error>(result)) {
    return std::nullopt;
  }
  return std::get<managed_process>(std::move(result));
}

}  // namespace

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
  unique_handle stopping(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  if (!stopping) return static_cast<int>(GetLastError());
  launcher_context context{pipe.get(), owning_sid, stopping.get()};
  unique_handle control_thread(CreateThread(
      nullptr, 0, serve_local_control, &context, 0, nullptr));
  if (!control_thread) return static_cast<int>(GetLastError());

  std::optional<managed_process> generation;
  for (std::size_t attempt = 0; attempt <= STARTUP_BACKOFF_MS.size(); ++attempt) {
    generation = start_daemon(daemon, working_directory);
    if (generation) {
      // A process surviving the bounded bootstrap window is not routed until
      // its authenticated child handshake reports matching readiness.
      if (!generation->wait_for_exit(READINESS_DEADLINE_MS)) {
        write_launcher_history(history, "{\"state\":\"ready\"}\n");
        break;
      }
      generation->close();
      generation.reset();
    }
    if (attempt < STARTUP_BACKOFF_MS.size()) {
      Sleep(STARTUP_BACKOFF_MS[attempt]);
    }
  }

  if (!generation) {
    write_launcher_history(history, "{\"state\":\"circuit-open\"}\n");
  }

  // Local control stays resident in ready, stopped, absent, and circuit-open
  // states. The launcher retains the Job handle while a generation exists;
  // closing or crashing it kills the daemon and every descendant.
  WaitForSingleObject(stopping.get(), INFINITE);

  SetEvent(stopping.get());
  CancelSynchronousIo(control_thread.get());
  WaitForSingleObject(control_thread.get(), INFINITE);
  return 0;
}
