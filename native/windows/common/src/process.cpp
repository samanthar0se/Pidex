#include "pidex/windows/process.hpp"

#include "pidex/windows/raii.hpp"

#include <algorithm>
#include <iterator>
#include <mutex>
#include <utility>

namespace pidex::windows {
namespace {

int compare_environment_names(const std::wstring& left,
                              const std::wstring& right) noexcept {
  return CompareStringOrdinal(left.c_str(), -1, right.c_str(), -1, TRUE);
}

std::wstring quote_argument(const std::wstring& argument) {
  if (!argument.empty() &&
      argument.find_first_of(L" \t\"") == std::wstring::npos) {
    return argument;
  }
  std::wstring quoted(1, L'\"');
  std::size_t slashes = 0;
  for (const wchar_t character : argument) {
    if (character == L'\\') {
      ++slashes;
    } else if (character == L'\"') {
      quoted.append(slashes * 2 + 1, L'\\');
      quoted.push_back(character);
      slashes = 0;
    } else {
      quoted.append(slashes, L'\\');
      slashes = 0;
      quoted.push_back(character);
    }
  }
  quoted.append(slashes * 2, L'\\');
  quoted.push_back(L'\"');
  return quoted;
}

std::wstring command_line(const contained_process_request& request) {
  std::wstring result = quote_argument(request.executable.native());
  for (const auto& argument : request.arguments) {
    result.push_back(L' ');
    result.append(quote_argument(argument));
  }
  return result;
}

std::vector<wchar_t> environment_block(
    const std::map<std::wstring, std::wstring, std::less<>>& environment) {
  std::vector<std::pair<std::wstring, std::wstring>> entries(
      environment.begin(), environment.end());
  std::ranges::sort(entries, [](const auto& left, const auto& right) {
    return compare_environment_names(left.first, right.first) ==
           CSTR_LESS_THAN;
  });
  std::vector<wchar_t> result;
  for (const auto& [name, value] : entries) {
    result.insert(result.end(), name.begin(), name.end());
    result.push_back(L'=');
    result.insert(result.end(), value.begin(), value.end());
    result.push_back(L'\0');
  }
  if (result.empty()) {
    result.push_back(L'\0');
  }
  result.push_back(L'\0');
  return result;
}

native_error process_error(const std::string_view operation,
                           const DWORD code = GetLastError()) noexcept {
  return win32_error(operation, native_error_category::unavailable, code);
}

void terminate_partial_process(const HANDLE process) noexcept {
  // The process is still suspended and cannot have created descendants.
  if (process != nullptr) {
    TerminateProcess(process, ERROR_PROCESS_ABORTED);
    WaitForSingleObject(process, INFINITE);
  }
}

}  // namespace

struct managed_process::state final {
  unique_handle process;
  unique_handle job;
  DWORD id{};
  mutable std::mutex mutex;
  std::once_flag close_once;
  bool explicitly_terminated{false};
  std::optional<native_error> teardown_failure;
};

managed_process::managed_process(std::unique_ptr<state> state) noexcept
    : state_(std::move(state)) {}

managed_process::~managed_process() noexcept { close(); }
managed_process::managed_process(managed_process&&) noexcept = default;
managed_process& managed_process::operator=(managed_process&&) noexcept =
    default;

DWORD managed_process::process_id() const noexcept {
  return state_ == nullptr ? 0 : state_->id;
}

std::variant<process_exit_evidence, native_error> managed_process::evidence()
    const noexcept {
  if (state_ == nullptr) {
    return win32_error("managed_process.evidence",
                       native_error_category::invalid_input,
                       ERROR_INVALID_HANDLE);
  }
  std::scoped_lock lock(state_->mutex);
  process_exit_evidence result{
      .exit_code = std::nullopt,
      .job_empty = false,
      .explicitly_terminated = state_->explicitly_terminated,
      .teardown_failure = state_->teardown_failure,
  };
  DWORD exit_code = STILL_ACTIVE;
  if (state_->process && GetExitCodeProcess(state_->process.get(), &exit_code) &&
      exit_code != STILL_ACTIVE) {
    result.exit_code = exit_code;
  }
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
  if (state_->job && QueryInformationJobObject(
                         state_->job.get(), JobObjectBasicAccountingInformation,
                         &accounting, sizeof(accounting), nullptr)) {
    result.job_empty = accounting.ActiveProcesses == 0;
  }
  return result;
}

std::optional<native_error> managed_process::terminate(
    const unsigned int exit_code) noexcept {
  if (state_ == nullptr) {
    return std::nullopt;
  }
  std::scoped_lock lock(state_->mutex);
  if (!state_->job) {
    return state_->teardown_failure;
  }
  state_->explicitly_terminated = true;
  if (!TerminateJobObject(state_->job.get(), exit_code)) {
    return process_error("TerminateJobObject");
  }
  return std::nullopt;
}

std::optional<native_error> managed_process::close() noexcept {
  if (state_ == nullptr) {
    return std::nullopt;
  }
  std::call_once(state_->close_once, [this] {
    std::scoped_lock lock(state_->mutex);
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is the lifecycle guarantee. Close the
    // Job first, then retain no process handle after teardown resolves.
    const HANDLE job = state_->job.release();
    if (job != nullptr && !CloseHandle(job)) {
      state_->teardown_failure = process_error("CloseHandle.job");
    }
    const HANDLE process = state_->process.release();
    if (process != nullptr && !CloseHandle(process) &&
        !state_->teardown_failure.has_value()) {
      state_->teardown_failure = process_error("CloseHandle.process");
    }
  });
  return state_->teardown_failure;
}

std::variant<managed_process, native_error> spawn_contained(
    const contained_process_request& request) noexcept {
  try {
    if (!request.executable.is_absolute() ||
        !request.working_directory.is_absolute()) {
      return win32_error("spawn_contained.paths",
                         native_error_category::invalid_input,
                         ERROR_BAD_PATHNAME);
    }
    for (const auto& [name, value] : request.environment) {
      if (name.empty() || name.front() == L'=' ||
          name.find(L'=') != std::wstring::npos ||
          name.find(L'\0') != std::wstring::npos ||
          value.find(L'\0') != std::wstring::npos) {
        return win32_error("spawn_contained.environment",
                           native_error_category::invalid_input,
                           ERROR_INVALID_PARAMETER);
      }
    }
    for (auto left = request.environment.begin();
         left != request.environment.end(); ++left) {
      for (auto right = std::next(left); right != request.environment.end();
           ++right) {
        if (compare_environment_names(left->first, right->first) ==
            CSTR_EQUAL) {
          return win32_error("spawn_contained.environment.duplicate",
                             native_error_category::invalid_input,
                             ERROR_INVALID_PARAMETER);
        }
      }
    }

    auto command = command_line(request);
    auto environment = environment_block(request.environment);
    STARTUPINFOW startup{.cb = sizeof(STARTUPINFOW)};
    PROCESS_INFORMATION information{};
    if (!CreateProcessW(request.executable.c_str(), command.data(), nullptr,
                        nullptr, FALSE,
                        CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                        environment.data(), request.working_directory.c_str(),
                        &startup, &information)) {
      return process_error("CreateProcessW");
    }
    unique_handle process(information.hProcess);
    unique_handle thread(information.hThread);

    unique_handle job(CreateJobObjectW(nullptr, nullptr));
    if (!job) {
      const auto error = process_error("CreateJobObjectW");
      terminate_partial_process(process.get());
      return error;
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation,
                                 &limits, sizeof(limits))) {
      const auto error = process_error("SetInformationJobObject");
      terminate_partial_process(process.get());
      return error;
    }
    if (!AssignProcessToJobObject(job.get(), process.get())) {
      const auto error = process_error("AssignProcessToJobObject");
      terminate_partial_process(process.get());
      return error;
    }
    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) {
      const auto error = process_error("ResumeThread");
      terminate_partial_process(process.get());
      return error;
    }
    if (!CloseHandle(thread.get())) {
      const auto error = process_error("CloseHandle.thread");
      if (TerminateJobObject(job.get(), ERROR_PROCESS_ABORTED)) {
        WaitForSingleObject(process.get(), INFINITE);
      }
      return error;
    }
    static_cast<void>(thread.release());

    auto state = std::make_unique<managed_process::state>();
    state->process = std::move(process);
    state->job = std::move(job);
    state->id = information.dwProcessId;
    return managed_process(std::move(state));
  } catch (...) {
    return win32_error("spawn_contained.memory",
                       native_error_category::resource_exhausted,
                       ERROR_NOT_ENOUGH_MEMORY);
  }
}

}  // namespace pidex::windows
