#pragma once

#include <Windows.h>

#include <string>

namespace pidex::windows::launcher {

struct local_control_context final {
  HANDLE pipe;
  std::wstring owning_sid;
};

DWORD WINAPI serve_local_control(void* raw_context) noexcept;

}  // namespace pidex::windows::launcher
