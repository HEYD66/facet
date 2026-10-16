# 千面 Android 架构验证版

## 交接入口

- [交接说明](docs/交接说明.md)：当前交付范围、真实验收、已知限制、接手顺序与回滚。
- [开发文档](docs/开发文档.md)：进程架构、网络与数据结构、构建、测试和内核升级。
- 交接压缩包中的 `先读我.md` 为独立入口；`verification/` 保存本阶段报告，`artifacts/` 保存 APK。压缩包不包含用户数据或签名私钥。
- 以下历史验收路径是原开发机上的位置；接手时以交接包内的报告为准，项目目录可以迁移。

当前版本为 `0.2.0-prototype`（ARM64 调试 APK）。本目录为独立安卓客户端原型，不复用 Electron 窗口。包名 `com.facet.browser.prototype`，与桌面资料分离。当前 APK 使用调试签名，尚未作为正式版本发布。

## 当前实现

- 原生 Java 界面和系统 WebView，最低 Android 9（API 28）。
- 两个固定实例分别由 `:profile1`、`:profile2` 进程承载，初始化 WebView 前设置不同 `setDataDirectorySuffix`。
- 每个进程独立 Cookie、网站持久存储，以及各自的代理/最近网址偏好。
- 保留无认证 HTTP / SOCKS5 手动代理入口；新增每实例独立 Mihomo、节点库、节点链接和 YAML / JSON 导入。节点库中选择节点才启用，不会导入后自动改当前网络。代理通过 AndroidX WebKit `ProxyController` 应用，内核就绪且覆盖回调完成后才加载页面。
- 支持解析 SS、VMess、VLESS、Trojan、Hysteria2、TUIC、AnyTLS 和 SOCKS5 常见链接；YAML / JSON 支持含 proxies 的列表及 HTTP 节点。使用安全 YAML 加载器，只导入白名单节点参数，忽略订阅中的 DNS、TUN、规则和其他顶层设置，拒绝外部插件和链式节点。单次内容最多 2 MiB，节点库最多 500 项。并非所有分享链接变体与扩展参数都受支持。
- 订阅下载可选系统网络或当前实例代理。选择失败不会自动换其他下载网络；系统网络仍受手机 VPN/TUN 影响。校验 HTTPS 证书、限制响应与解压大小和重定向，不允许 HTTPS 降级。订阅 URL 不长期保存，目前为下载导入，不含定时更新。
- 每实例 Mihomo 仅监听回环地址，随机代理/控制端口，控制端口使用随机令牌；全部网页代理流量匹配所选节点。内核启动失败或意外退出时阻止加载，不自动使用系统网络。
- 指定代理不添加 DIRECT 候选，并移除默认本机绕过规则。代理不可用时应显示错误；是否实际不回退必须经设备测试确认。
- 不接受错误证书；网页没有 Java/Node 桥接权限；主界面禁止初始化 WebView，浏览实例 Activity 不向其他应用导出。
- 仅调试 APK 开启 WebView 调试，正式构建的网页调试不启用。

尚未实现指纹覆盖、UA/时区方案、任意数量实例、完整节点编辑/删除、订阅定时更新、备份/重置、扩展、后台保活和完整日志导出。带认证的 HTTP/SOCKS5 节点可通过 YAML/JSON 交给 Mihomo，手动代理文本入口不支持认证；认证节点尚未做完整真机矩阵验收。固定双实例用于验证进程隔离，后续增加任意实例需要重新评估进程槽位与内存限制。Android 可以回收后台进程，不能将后台页面描述为永远运行。当前只是浏览与网络架构原型，不代表已实现指纹浏览器。

## 构建

电脑现有 SDK、Java 和 Gradle 足够编译：

```powershell
.\android\build.ps1
```

脚本允许传入 `-SdkPath`、`-JavaPath`、`-GradleCache`、`-GradleExecutable`；默认复用当前电脑 D 盘配置。项目路径由脚本目录计算。Android 缓存和新组件放在 D 盘；环境变量仅在构建期间修改并恢复。构建使用 AGP 8.13.2 / compileSdk 36 / AndroidX WebKit 1.9.0，优先使用已校验的 Gradle 8.13，放在 D 盘 GradleCache/distributions；现有 9.2.1 仅作回退。Windows 中文目录下的 JUnit 工作进程曾无法加载测试类，单元测试会将编译结果和依赖复制到 D 盘 Gradle 缓存中的独立目录后运行，保持源码原目录。中文路径检查通过 `android.overridePathCheck=true` 放行，若后续引入原生代码需要另行验证工具链兼容。

构建前 `setup-core.cjs` 核对官方 Android ARM64 发行文件与源码哈希，准备 APK 内置可执行文件和 GPL 附件；不编译或改写 Mihomo 内核。

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。内核通过 APK 原生库目录安装为 `libfacet_mihomo.so`，不执行应用可写目录中的下载程序。APK 内附 `assets/mihomo/LICENSE`、`ARTIFACT.json` 和对应版本源码 `source.tgz`。`android/tests/verify-apk.ps1` 对最终 APK 中的这四份资源逐一核对哈希。

安装：`adb install -r <APK绝对路径>`。小米等设备可能需要在手机上确认 USB 安装；安装失败不等于已安装。不要通过自动修改手机安全设置绕过确认。

## 真机验收

```powershell
& .\android\tests\build-input-helper.ps1
node android/tests/device-smoke.cjs
node android/tests/core-device.cjs
& .\android\tests\verify-apk.ps1
```

必须先安装本原型并解锁手机。输入辅助工具使用现有 SDK 的 UiAutomator，在本原型输入框中执行无障碍文本填写，不改变手机输入法；它不会打进产品 APK。多个 ADB 设备时以环境变量 `FACET_DEVICE` 精确指定；可用 `FACET_ADB` 指定 ADB 路径。脚本直接连接 WebView 的页面 CDP，不要求系统 WebView 支持完整桌面浏览器调试接口。脚本只控制本原型和自行创建的本机测试页面，用临时 USB 端口映射连接两个本机代理和直连源站：

1. 两实例实际经过不同代理，访问同源网页。
2. Cookie、localStorage 不串用。
3. 强制停止本原型、重新启动后，网址、代理和网站资料独立保留。
4. 坏代理导致加载失败，直连源站没有收到回退请求。
5. 用户明确切换系统网络后正常访问直连源站。

报告和截图保存到脚本输出的临时目录，退出移除本次 ADB 映射。它不是所有协议、DNS/WebRTC/UDP 无泄露保证，也不代表第三方网站登录兼容测试。脚本会停止本原型，不能在里面存有正式账号后随意运行。

## 0.2 阶段验收（2026-10-16）

- `assembleDebug`、10 项 JVM 单元测试、Android Lint 通过；Lint 仍有文案国际化、旧 API 等告警。
- 真机内核专项 8 项通过：应用沙箱中的真实 HTTP 转发、控制端口鉴权、关闭后立即重开、双独立内核（含真实 Shadowsocks 加密链路）、重启恢复、两种订阅下载网络、取消后不入库、异常内核退出阻止加载且不影响另一实例。
- 原有双实例/手动代理/数据隔离/重启/坏代理不回退的 5 项真机回归也通过。基础回归报告：`C:\Users\24719\AppData\Local\Temp\facet-android-test-9bt8Qv\report.json`。
- 内核专项报告：`C:\Users\24719\AppData\Local\Temp\facet-android-test-M2oORF\report.json`。测试使用本机可控上游和临时凭据，结束后恢复原节点库及偏好，不把测试节点留给用户。
- 最终 APK 为 0.2.0-prototype，SHA256 `36B42AB74D35297C968F8CA4965DEC3255C1A0FD48EDBBF0B918E34143FADD97`。APK v2 签名、内置内核与 GPL 附件哈希均通过校验。
- 已验证 release 合并清单不含调试接收器。正式 release 签名、Android 其他版本、其他 ABI 和公网机场节点矩阵尚未验收。
- “系统网络”下载指不使用实例代理的直连请求，手机 VPN/TUN 仍可接管；不额外采用 WiFi HTTP 代理。取消在进入保存阶段前阻止入库，已发出的下载连接可能继续到返回或超时。

## 0.1 阶段历史验收（2026-10-16）

已连接 Android 12 / ARM64 真机，系统 WebView 99.0.4844.88。APK 构建、APK v2 签名校验、安装及 Android Lint 通过（仍有硬编码中文文案、较旧依赖等告警）。首次 USB 安装被系统拒绝，用户允许后成功安装。

真机完整验收 5 项通过：不同代理真实请求、同源 Cookie/localStorage 隔离、强制停止后独立恢复、坏代理失败且直连源站零请求、明确选择系统网络后直连成功。报告 `C:\Users\24719\AppData\Local\Temp\facet-android-test-aHI6ri\report.json`，首页截图同目录 `prototype.png`，均为本机验收产物，不随应用发布。

DOM storage 异步写盘，测试在写入后等待 6.5 秒再强制停止；首次立即强停测试曾丢失刚写入的 localStorage。当前不能保证写入后瞬间断电/强杀无丢失。每次测试使用新测试域名，避免上次运行的 Cookie 影响结果。最终两个实例的测试代理均清空，最近网址恢复为 `https://example.com/`。

0.1 历史 APK 大小 976260 字节，SHA256 `CB7B47AEFDEE6A6E4B1AC3F93E42ECDFF677A222B081039D5658EF4F07912FB3`。SOCKS5 配置入口已实现，本轮网络验收仅覆盖 HTTP 代理；HTTPS 公网站点、真实账号、WebRTC、UDP 和不同系统版本仍需后续验证。手机旧 WebView 与桌面 Chromium 的兼容范围不同。

## 内核、数据与安全边界

- 每实例节点库为 `files/profileN-nodes.json`；所选节点快照与原手动代理保存在对应 `shared_prefs/profileN.xml`。节点凭据仅在应用私有存储中保存，目前没有额外密码加密，不应分享整个数据目录。
- 临时配置位于 `files/core-profileN/runtime.json`，停止时清理。进程记录在启动前校对可执行路径及配置路径，避免盲目结束 PID。每进程串行管理内核所有者，旧 Activity 的延后清理不会停止新 Activity 的内核。
- 原生输出仅提取固定的超时、证书、认证等分类；“查看内核记录”为当前会话最近 100 条阶段记录，不包含原始输出、节点密码、订阅链接或控制令牌，不等于桌面详细诊断包。
- 异常退出测试通过仅调试 APK 中的 `CoreCrashTestReceiver` 进行，受系统 DUMP 权限保护，仅接收固定测试动作，并核对本实例 PID/命令行；正式构建没有该接收器。无需关闭 SELinux 或修改手机安全设置。
- 这套代理未构成系统 TUN，也不保证 WebRTC/UDP/DNS 全路径无泄露。后台运行仍受 Android 回收策略约束，未验证的节点协议不能只凭解析成功称为连通。

## 回滚

0.1 前检查点 `5f917ce`；接入 Android 内核前检查点 `073ee2f`。本目录与桌面运行数据独立；撤销对应 Android 提交可恢复源码。0.2 开始前的旧 APK 为 `android/build/rollback/Facet-Android-0.1.0.apk`，手机原型完整数据备份为同目录 `data-before-0.2.0.tar`（14,602,240 字节，可能含登录资料，不应上传）。备份只保存，未覆盖恢复。旧版不识别新节点模式，降级前必须明确停用新节点并核对旧版手动代理设置，不能在代理运行时直接降级后继续浏览。卸载包名 `com.facet.browser.prototype` 会清除原型自己的数据，先确认需要保留的资料。桌面未提交的 toString 修改和订阅代理草稿应原样保留。

## 官方依据

- [WebView 数据目录隔离](https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String))
- [按进程设置代理](https://developer.android.com/reference/androidx/webkit/ProxyController)
- [ProxyConfig](https://developer.android.com/reference/androidx/webkit/ProxyConfig.Builder)
