#include "local_control.hpp"

#include "pidex/windows/local_pipe.hpp"

#include <optional>

namespace pidex::windows::launcher {

DWORD WINAPI serve_local_control(void* raw_context) noexcept {
  auto& context = *static_cast<local_control_context*>(raw_context);
  for (;;) {
    const BOOL connected = ConnectNamedPipe(context.pipe, nullptr)
                               ? TRUE
                               : GetLastError() == ERROR_PIPE_CONNECTED;
    if (!connected) {
      if (GetLastError() == ERROR_OPERATION_ABORTED) break;
      continue;
    }

    authenticated_pipe_peer peer{};
    if (!authenticate_pipe_peer(context.pipe, context.owning_sid, std::nullopt,
                                peer)) {
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

}  // namespace pidex::windows::launcher
