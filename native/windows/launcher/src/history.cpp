#include "history.hpp"

#include "pidex/windows/raii.hpp"

#include <Windows.h>

namespace pidex::windows::launcher {

void append_launcher_history(const std::filesystem::path& path,
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

}  // namespace pidex::windows::launcher
