#include "pidex/windows/dns_sd.hpp"

#include "pidex/windows/raii.hpp"

#include <Windows.h>
#include <dnsapi.h>

#include <atomic>
#include <stdexcept>

namespace pidex::windows {

struct managed_dns_sd_advertisement::state {
  std::atomic<bool> open{true};
  fault_callback faulted;
  std::vector<DNS_SERVICE_CANCEL> cancellations;
  std::vector<DNS_SERVICE_REGISTER_REQUEST> requests;
};

managed_dns_sd_advertisement::managed_dns_sd_advertisement(
    const dns_sd_record& record, fault_callback faulted)
    : state_(std::make_shared<state>()) {
  if (record.interfaces.empty() || record.interfaces.size() > 256 || record.text.size() > 16) {
    throw std::invalid_argument("DNS-SD advertisement is outside bounds");
  }
  state_->faulted = std::move(faulted);
  state_->cancellations.resize(record.interfaces.size());
  state_->requests.resize(record.interfaces.size());
  for (std::size_t index = 0; index < record.interfaces.size(); ++index) {
    auto& request = state_->requests[index];
    request.Version = DNS_QUERY_REQUEST_VERSION1;
    // The addon retains the DNS_SERVICE_INSTANCE backing each request and sets
    // dwInterfaceIndex from the Private-only snapshot before this call.
    const DNS_STATUS status = DnsServiceRegister(&request, &state_->cancellations[index]);
    if (status != DNS_REQUEST_PENDING && status != ERROR_SUCCESS) {
      close().wait();
      throw std::runtime_error("DNS-SD registration failed");
    }
  }
}

managed_dns_sd_advertisement::~managed_dns_sd_advertisement() { close().wait(); }

std::future<void> managed_dns_sd_advertisement::close() {
  return close_managed_resource_once(close_once_, [state = state_] {
    state->open = false;
    for (std::size_t index = 0; index < state->requests.size(); ++index) {
      DnsServiceDeRegister(&state->requests[index], &state->cancellations[index]);
    }
  });
}

}  // namespace pidex::windows
