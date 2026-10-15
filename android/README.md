# 千面 Android 架构验证版

本目录为独立安卓客户端原型，不复用 Electron 窗口。包名 `com.facet.browser.prototype`，与桌面资料分离。当前 APK 使用调试签名，尚未作为正式版本发布。

## 当前实现

- 原生 Java 界面和系统 WebView，最低 Android 9（API 28）。
- 两个固定实例分别由 `:profile1`、`:profile2` 进程承载，初始化 WebView 前设置不同 `setDataDirectorySuffix`。
- 每个进程独立 Cookie、网站持久存储，以及各自的代理/最近网址偏好。
- 代理通过 AndroidX WebKit `ProxyController` 应用，只在回调后加载初始页面。支持无认证 HTTP / SOCKS5 地址；留空使用系统网络。
- 指定代理不添加 DIRECT 候选，并移除默认本机绕过规则。代理不可用时应显示错误；是否实际不回退必须经设备测试确认。
- 不接受错误证书；网页没有 Java/Node 桥接权限；主界面禁止初始化 WebView，浏览实例 Activity 不向其他应用导出。
- 仅调试 APK 开启 WebView 调试，正式构建的网页调试不启用。

尚未实现指纹覆盖、UA/时区方案、Mihomo 节点/订阅、代理密码认证、任意数量实例、备份/重置、扩展、后台保活和完整日志导出。固定双实例用于验证进程隔离，后续增加任意实例需要重新评估进程槽位与内存限制。Android 可以回收后台进程，不能将后台页面描述为永远运行。当前只是浏览与网络架构原型，不代表已实现指纹浏览器。

## 构建

电脑现有 SDK、Java 和 Gradle 足够编译：

```powershell
.\android\build.ps1
```

脚本允许传入 `-SdkPath`、`-JavaPath`、`-GradleCache`、`-GradleExecutable`；默认复用当前电脑 D 盘配置。项目路径由脚本目录计算。Android 缓存和新组件放在 D 盘；环境变量仅在构建期间修改并恢复。构建使用 AGP 8.13.2 / compileSdk 36 / AndroidX WebKit 1.9.0，现有 Gradle 9.2.1 可执行当前构建。中文路径检查通过 `android.overridePathCheck=true` 放行，若后续引入原生代码需要另行验证工具链兼容。

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。

安装：`adb install -r <APK绝对路径>`。小米等设备可能需要在手机上确认 USB 安装；安装失败不等于已安装。不要通过自动修改手机安全设置绕过确认。

## 真机验收

```powershell
& .\android\tests\build-input-helper.ps1
node android/tests/device-smoke.cjs
```

必须先安装本原型并解锁手机。输入辅助工具使用现有 SDK 的 UiAutomator，在本原型输入框中执行无障碍文本填写，不改变手机输入法；它不会打进产品 APK。多个 ADB 设备时以环境变量 `FACET_DEVICE` 精确指定；可用 `FACET_ADB` 指定 ADB 路径。脚本直接连接 WebView 的页面 CDP，不要求系统 WebView 支持完整桌面浏览器调试接口。脚本只控制本原型和自行创建的本机测试页面，用临时 USB 端口映射连接两个本机代理和直连源站：

1. 两实例实际经过不同代理，访问同源网页。
2. Cookie、localStorage 不串用。
3. 强制停止本原型、重新启动后，网址、代理和网站资料独立保留。
4. 坏代理导致加载失败，直连源站没有收到回退请求。
5. 用户明确切换系统网络后正常访问直连源站。

报告和截图保存到脚本输出的临时目录，退出移除本次 ADB 映射。它不是所有协议、DNS/WebRTC/UDP 无泄露保证，也不代表第三方网站登录兼容测试。脚本会停止本原型，不能在里面存有正式账号后随意运行。

## 已执行结果（2026-10-16）

已连接 Android 12 / ARM64 真机，系统 WebView 99.0.4844.88。APK 构建、APK v2 签名校验、安装及 Android Lint 通过（仍有硬编码中文文案、较旧依赖等告警）。首次 USB 安装被系统拒绝，用户允许后成功安装。

真机完整验收 5 项通过：不同代理真实请求、同源 Cookie/localStorage 隔离、强制停止后独立恢复、坏代理失败且直连源站零请求、明确选择系统网络后直连成功。报告 `C:\Users\24719\AppData\Local\Temp\facet-android-test-aHI6ri\report.json`，首页截图同目录 `prototype.png`，均为本机验收产物，不随应用发布。

DOM storage 异步写盘，测试在写入后等待 6.5 秒再强制停止；首次立即强停测试曾丢失刚写入的 localStorage。当前不能保证写入后瞬间断电/强杀无丢失。每次测试使用新测试域名，避免上次运行的 Cookie 影响结果。最终两个实例的测试代理均清空，最近网址恢复为 `https://example.com/`。

本次 APK 大小 976260 字节，SHA256 `CB7B47AEFDEE6A6E4B1AC3F93E42ECDFF677A222B081039D5658EF4F07912FB3`。SOCKS5 配置入口已实现，本轮网络验收仅覆盖 HTTP 代理；HTTPS 公网站点、真实账号、WebRTC、UDP 和不同系统版本仍需后续验证。手机旧 WebView 与桌面 Chromium 的兼容范围不同。

## 回滚

改动前 Git 检查点 `5f917ce`。本目录与桌面运行数据独立；撤销安卓相关新增文件即可恢复源码。卸载包名 `com.facet.browser.prototype` 会清除原型自己的数据，先确认需要保留的资料。桌面未提交的 toString 修改和订阅代理草稿应原样保留。

## 官方依据

- [WebView 数据目录隔离](https://developer.android.com/reference/android/webkit/WebView#setDataDirectorySuffix(java.lang.String))
- [按进程设置代理](https://developer.android.com/reference/androidx/webkit/ProxyController)
- [ProxyConfig](https://developer.android.com/reference/androidx/webkit/ProxyConfig.Builder)
