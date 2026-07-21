#include "pidex/windows/private_network.hpp"

#include "pidex/windows/raii.hpp"

#include <Windows.h>
#include <iphlpapi.h>
#include <netlistmgr.h>
#include <ws2tcpip.h>

#include <atomic>
#include <chrono>
#include <set>
#include <stdexcept>
#include <thread>

namespace pidex::windows {
namespace {

class scoped_com_apartment final {
 public:
  scoped_com_apartment() : initialized_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {}
  ~scoped_com_apartment() {
    if (SUCCEEDED(initialized_)) CoUninitialize();
  }

  [[nodiscard]] bool available() const {
    return SUCCEEDED(initialized_) || initialized_ == RPC_E_CHANGED_MODE;
  }

 private:
  HRESULT initialized_;
};

bool is_private_network(INetwork* network) {
  NLM_NETWORK_CATEGORY category{};
  return SUCCEEDED(network->GetCategory(&category)) &&
         category == NLM_NETWORK_CATEGORY_PRIVATE;
}

std::wstring guid_text(const GUID& guid) {
  wchar_t value[39]{};
  if (StringFromGUID2(guid, value, static_cast<int>(std::size(value))) == 0) return {};
  return value;
}

std::set<std::wstring> private_adapter_ids(INetworkListManager* manager) {
  std::set<std::wstring> ids;
  IEnumNetworks* networks = nullptr;
  const HRESULT enumerated = manager->GetNetworks(NLM_ENUM_NETWORK_CONNECTED, &networks);
  if (FAILED(enumerated)) throw std::runtime_error("NLM enumeration failed");
  INetwork* network = nullptr;
  ULONG fetched = 0;
  while (networks->Next(1, &network, &fetched) == S_OK) {
    if (is_private_network(network)) {
      IEnumNetworkConnections* connections = nullptr;
      if (SUCCEEDED(network->GetNetworkConnections(&connections))) {
        INetworkConnection* connection = nullptr;
        while (connections->Next(1, &connection, &fetched) == S_OK) {
          GUID adapter{};
          if (SUCCEEDED(connection->GetAdapterId(&adapter))) ids.insert(guid_text(adapter));
          connection->Release();
        }
        connections->Release();
      }
    }
    network->Release();
  }
  networks->Release();
  return ids;
}

std::vector<private_network_interface> enumerate_adapter_addresses(
    const std::set<std::wstring>& admitted) {
  ULONG size = 0;
  const ULONG flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST |
                      GAA_FLAG_SKIP_DNS_SERVER;
  GetAdaptersAddresses(AF_UNSPEC, flags, nullptr, nullptr, &size);
  if (size == 0 || size > 4 * 1024 * 1024) throw std::runtime_error("adapter snapshot is unavailable");
  std::vector<unsigned char> bytes(size);
  auto* addresses = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(bytes.data());
  if (GetAdaptersAddresses(AF_UNSPEC, flags, nullptr, addresses, &size) != NO_ERROR) {
    throw std::runtime_error("adapter snapshot failed");
  }
  std::vector<private_network_interface> result;
  for (auto* adapter = addresses; adapter != nullptr; adapter = adapter->Next) {
    std::wstring adapter_id;
    if (adapter->AdapterName != nullptr) {
      const int count = MultiByteToWideChar(CP_UTF8, 0, adapter->AdapterName, -1, nullptr, 0);
      adapter_id.resize(static_cast<std::size_t>(count > 0 ? count : 0));
      if (count > 1) {
        MultiByteToWideChar(CP_UTF8, 0, adapter->AdapterName, -1, adapter_id.data(), count);
        adapter_id.pop_back();
      }
    }
    if (!adapter_id.empty() && adapter_id.front() != L'{') adapter_id = L"{" + adapter_id + L"}";
    if (!admitted.contains(adapter_id)) continue;
    private_network_interface item{adapter_id,
        adapter->FriendlyName == nullptr ? L"Private interface" : adapter->FriendlyName,
        {}, adapter->IfIndex};
    for (auto* address = adapter->FirstUnicastAddress; address != nullptr; address = address->Next) {
      wchar_t rendered[INET6_ADDRSTRLEN]{};
      const void* bytes_address = address->Address.lpSockaddr->sa_family == AF_INET
          ? static_cast<const void*>(&reinterpret_cast<sockaddr_in*>(address->Address.lpSockaddr)->sin_addr)
          : static_cast<const void*>(&reinterpret_cast<sockaddr_in6*>(address->Address.lpSockaddr)->sin6_addr);
      if (InetNtopW(address->Address.lpSockaddr->sa_family, bytes_address, rendered,
                    static_cast<DWORD>(std::size(rendered))) != nullptr) item.addresses.emplace_back(rendered);
    }
    result.push_back(std::move(item));
  }
  return result;
}

}  // namespace

std::vector<private_network_interface> snapshot_private_interfaces() {
  scoped_com_apartment apartment;
  if (!apartment.available()) throw std::runtime_error("COM is unavailable");

  INetworkListManager* manager = nullptr;
  const HRESULT created = CoCreateInstance(CLSID_NetworkListManager, nullptr,
      CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&manager));
  if (FAILED(created)) throw std::runtime_error("NLM is unavailable");

  std::vector<private_network_interface> result;
  try {
    result = enumerate_adapter_addresses(private_adapter_ids(manager));
  } catch (...) {
    manager->Release();
    throw;
  }
  manager->Release();
  return result;
}

struct managed_network_observer::state {
  std::atomic<bool> open{true};
  change_callback changed;
  fault_callback faulted;
  std::jthread worker;
};

managed_network_observer::managed_network_observer(change_callback changed, fault_callback faulted)
    : state_(std::make_shared<state>()) {
  state_->changed = std::move(changed);
  state_->faulted = std::move(faulted);
  state_->worker = std::jthread([state = state_](std::stop_token stop) {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(initialized)) {
      if (state->open) state->faulted(initialized);
      return;
    }
    std::vector<private_network_interface> prior;
    while (!stop.stop_requested()) {
      try {
        auto current = snapshot_private_interfaces();
        bool changed = current.size() != prior.size();
        for (std::size_t index = 0; !changed && index < current.size(); ++index) {
          changed = current[index].id != prior[index].id ||
                    current[index].addresses != prior[index].addresses;
        }
        if (changed && state->open) state->changed(current);
        prior = std::move(current);
      } catch (...) {
        if (state->open) state->faulted(E_FAIL);
        break;
      }
      for (int tick = 0; tick < 10 && !stop.stop_requested(); ++tick) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
    }
    CoUninitialize();
  });
}

managed_network_observer::~managed_network_observer() { close().wait(); }

std::future<void> managed_network_observer::close() {
  return close_managed_resource_once(close_once_, [state = state_] {
    state->open = false;
    state->worker.request_stop();
    if (state->worker.joinable()) state->worker.join();
  });
}

}  // namespace pidex::windows
