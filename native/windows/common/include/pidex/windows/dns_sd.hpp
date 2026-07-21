#pragma once

#include "pidex/windows/private_network.hpp"

#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace pidex::windows {

struct dns_sd_record {
  std::wstring hostname;
  unsigned short port{};
  std::wstring instance_name;
  std::vector<std::wstring> text;
  std::vector<private_network_interface> interfaces;
};

class managed_dns_sd_advertisement final {
 public:
  using fault_callback = std::function<void(long)>;
  managed_dns_sd_advertisement(const dns_sd_record& record, fault_callback faulted);
  ~managed_dns_sd_advertisement();
  managed_dns_sd_advertisement(const managed_dns_sd_advertisement&) = delete;
  managed_dns_sd_advertisement& operator=(const managed_dns_sd_advertisement&) = delete;
  std::future<void> close();

 private:
  struct state;
  std::shared_ptr<state> state_;
  std::once_flag close_once_;
};

}  // namespace pidex::windows
