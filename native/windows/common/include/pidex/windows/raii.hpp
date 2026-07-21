#pragma once

#include <Windows.h>
#include <objbase.h>
#include <utility>

namespace pidex::windows {

class unique_handle final {
 public:
  unique_handle() noexcept = default;
  explicit unique_handle(HANDLE value) noexcept : value_(value) {}
  ~unique_handle() noexcept { reset(); }
  unique_handle(const unique_handle&) = delete;
  unique_handle& operator=(const unique_handle&) = delete;
  unique_handle(unique_handle&& other) noexcept : value_(other.release()) {}
  unique_handle& operator=(unique_handle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }
  [[nodiscard]] HANDLE get() const noexcept { return value_; }
  [[nodiscard]] explicit operator bool() const noexcept {
    return value_ != nullptr && value_ != INVALID_HANDLE_VALUE;
  }
  [[nodiscard]] HANDLE release() noexcept { return std::exchange(value_, nullptr); }
  void reset(HANDLE value = nullptr) noexcept {
    if (*this) CloseHandle(value_);
    value_ = value;
  }
 private:
  HANDLE value_{nullptr};
};

template <typename T>
class unique_com final {
 public:
  unique_com() noexcept = default;
  explicit unique_com(T* value) noexcept : value_(value) {}
  ~unique_com() noexcept { reset(); }
  unique_com(const unique_com&) = delete;
  unique_com& operator=(const unique_com&) = delete;
  unique_com(unique_com&& other) noexcept : value_(other.release()) {}
  [[nodiscard]] T* get() const noexcept { return value_; }
  [[nodiscard]] T* release() noexcept { return std::exchange(value_, nullptr); }
  void reset(T* value = nullptr) noexcept {
    if (value_ != nullptr) value_->Release();
    value_ = value;
  }
 private:
  T* value_{nullptr};
};

template <typename T, auto Close>
class unique_registration final {
 public:
  unique_registration() noexcept = default;
  explicit unique_registration(T value) noexcept : value_(value) {}
  ~unique_registration() noexcept { reset(); }
  unique_registration(const unique_registration&) = delete;
  unique_registration& operator=(const unique_registration&) = delete;
  unique_registration(unique_registration&& other) noexcept
      : value_(other.release()) {}
  [[nodiscard]] T get() const noexcept { return value_; }
  [[nodiscard]] T release() noexcept { return std::exchange(value_, T{}); }
  void reset(T value = T{}) noexcept {
    if (value_ != T{}) Close(value_);
    value_ = value;
  }
 private:
  T value_{};
};

}  // namespace pidex::windows
