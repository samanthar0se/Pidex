#pragma once

#include <filesystem>
#include <string_view>

namespace pidex::windows::launcher {

void append_launcher_history(const std::filesystem::path& path,
                             std::string_view record) noexcept;

}  // namespace pidex::windows::launcher
