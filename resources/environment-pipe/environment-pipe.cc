// MIT License. This helper creates two process-local DevTools pipe handles.
// It does not access Chromium internals, alter page code, or listen on TCP.
#define WIN32_LEAN_AND_MEAN
#define NAPI_EXTERN
#define NAPI_VERSION 8
#include <windows.h>
#include <sddl.h>
#include <node_api.h>
#include <string>
#include <vector>

// Resolve stable Node-API exports from the running executable. No node.exe
// import or Electron ABI binding: this also works in the renamed Facet.exe.
#define API_LIST(X) X(napi_get_cb_info) X(napi_get_value_string_utf8) \
 X(napi_throw_error) X(napi_create_string_utf8) X(napi_create_function) \
 X(napi_set_named_property) X(napi_get_undefined)
#define DECL(name) static decltype(&name) p_##name;
API_LIST(DECL)
static HANDLE input = INVALID_HANDLE_VALUE, output = INVALID_HANDLE_VALUE;

static void CloseUnadopted() {
 if (input != INVALID_HANDLE_VALUE) CloseHandle(input);
 if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
 input = output = INVALID_HANDLE_VALUE;
}
static napi_value Fail(napi_env env, const char* message) {
 p_napi_throw_error(env, nullptr, message); return nullptr;
}
static napi_value Create(napi_env env, napi_callback_info info) {
 if (input != INVALID_HANDLE_VALUE) return Fail(env, "Environment pipes already created");
 size_t argc = 1, length = 0; napi_value arg;
 if (p_napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr) != napi_ok || argc != 1)
  return Fail(env, "Expected a private pipe name");
 char buffer[100] = {};
 if (p_napi_get_value_string_utf8(env, arg, buffer, sizeof(buffer), &length) != napi_ok || length >= sizeof(buffer)-1)
  return Fail(env, "Invalid private pipe name");
 const std::string name(buffer, length);
 if (name.rfind("facet-environment-", 0) != 0 || name.size() != 54 || name.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789-") != std::string::npos)
  return Fail(env, "Invalid private pipe name");
 HANDLE token = nullptr; DWORD bytes = 0;
 if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return Fail(env, "Cannot read current process identity");
 GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
 std::vector<unsigned char> data(bytes);
 if (!bytes || !GetTokenInformation(token, TokenUser, data.data(), bytes, &bytes)) {
  CloseHandle(token); return Fail(env, "Cannot read current process identity");
 }
 CloseHandle(token);
 LPWSTR sid = nullptr;
 if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid, &sid))
  return Fail(env, "Cannot encode current process identity");
 const std::wstring sddl = L"D:P(A;;GA;;;" + std::wstring(sid) + L")";
 LocalFree(sid);
 PSECURITY_DESCRIPTOR descriptor = nullptr;
 if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr))
  return Fail(env, "Cannot restrict private pipe access");
 SECURITY_ATTRIBUTES security = {sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
 const std::wstring prefix = L"\\\\.\\pipe\\" + std::wstring(name.begin(), name.end());
 const DWORD access = PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE;
 const DWORD mode = PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS;
 input = CreateNamedPipeW((prefix + L"-in").c_str(), access, mode, 1, 65536, 65536, 0, &security);
 output = CreateNamedPipeW((prefix + L"-out").c_str(), access, mode, 1, 65536, 65536, 0, &security);
 LocalFree(descriptor);
 if (input == INVALID_HANDLE_VALUE || output == INVALID_HANDLE_VALUE) {
  CloseUnadopted(); return Fail(env, "Cannot create private environment pipes");
 }
 const std::string handles = std::to_string(reinterpret_cast<uintptr_t>(input)) + "," + std::to_string(reinterpret_cast<uintptr_t>(output));
 napi_value result;
 if (p_napi_create_string_utf8(env, handles.c_str(), handles.size(), &result) != napi_ok) {CloseUnadopted(); return nullptr;}
 return result;
}
static napi_value Adopt(napi_env env, napi_callback_info) {
 // Chromium owns and closes these handles after startup. Never double-close.
 input = output = INVALID_HANDLE_VALUE;
 napi_value result; p_napi_get_undefined(env, &result); return result;
}
static napi_value Cancel(napi_env env, napi_callback_info) {
 CloseUnadopted(); napi_value result; p_napi_get_undefined(env, &result); return result;
}
NAPI_MODULE_INIT() {
 const auto host = GetModuleHandleW(nullptr);
 #define LOAD(name) p_##name = reinterpret_cast<decltype(p_##name)>(GetProcAddress(host, #name)); if (!p_##name) return nullptr;
 API_LIST(LOAD)
 const napi_callback callbacks[] = {Create, Adopt, Cancel};
 const char* names[] = {"create", "adopt", "cancel"};
 for (size_t i = 0; i < 3; ++i) {
  napi_value fn;
  if (p_napi_create_function(env, names[i], NAPI_AUTO_LENGTH, callbacks[i], nullptr, &fn) != napi_ok ||
      p_napi_set_named_property(env, exports, names[i], fn) != napi_ok) return nullptr;
 }
 return exports;
}
