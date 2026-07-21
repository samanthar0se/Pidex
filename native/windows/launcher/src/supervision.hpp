#pragma once

#include "pidex/windows/process.hpp"

#include <filesystem>
#include <optional>

namespace pidex::windows::launcher {

[[nodiscard]] std::optional<managed_process> start_supervised_daemon(
    const std::filesystem::path& executable,
    const std::filesystem::path& working_directory,
    const std::filesystem::path& history) noexcept;

}  // namespace pidex::windows::launcher
