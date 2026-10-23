# 验证入口与历史记录

## 2026-10-23：扩展加载警告去重与单元测试全绿

- 依据只读统计正式 `runtime-output.json`：5000 行中 1157 行（23.1%）为重复的 `ExtensionLoadWarning`；统计时去掉了网址和凭据，未改动正式数据。
- `tests/process-warnings.test.cjs` 5 项；`.local-dev/extension-warning-probe/probe-dedup.cjs` 在真实 Electron 中把两个扩展各加载到 3 个会话，运行输出只有 2 条警告头、丢弃 4 条重复。正式入口 `test:cdp-workers` 通过；`test:browser-tabs` 12 项、`test:extension-defaults` 通过。
- 全部 `tests/*.test.cjs`：403 项，402 通过、0 失败、1 项 POSIX 专用跳过（此前 `experience.test.cjs` 4 项因夹具缺少 `applyDefaults` / `library.get` 失败）。

## 2026-10-23：0x80000003 根因（低完整性目录标签，不是 D 盘）

- 现象：本机从项目目录直接运行 `node_modules\electron\dist\electron.exe --version` 或 `release\build-*\win-unpacked\Facet.exe`，立即以 0x80000003 退出，无输出。此前的记录写作“D 盘路径”，这是误判。
- 对照：同一运行时复制到 `D:\FacetDiag-*`、`D:\AProgram\FacetDiag-*`、`D:\FacetDiag中文-*` 均正常（v44.9.3）；复制到 `D:\AProgram\arena\` 下任一位置都崩溃。C 盘副本正常，给它加上 `(OI)(CI)low` 完整性标签后崩溃，改回 medium 后恢复。中文路径、盘符、NVMe 磁盘、NTFS 与 8.3 短名称都不是原因。
- 根因：`D:\AProgram\arena`、`QQ分析`、`内核拆解`、`正常研究` 带有可继承的 `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`，以及自定义 SID `S-1-4-885347220-671684212` 的写入许可和 Everyone 拒绝删除子项；未查到是哪个工具设置的，非 Windows 默认。exe 继承低标签，ELECTRON_RUN_AS_NODE 下实测进程完整性为 `S-1-16-4096`（Low），对照目录为 `S-1-16-8192`（Medium）。同期 `D:\AProgram\内核拆解` 下的 ungoogled-chromium 也有 0x80000003 记录，同一原因。
- 用户影响：默认安装目录不受影响。把 10-23 14:17 构建的 `win-unpacked` 复制到 `D:\FacetDiag-20261023\` 后，`test:installed` **26 项全部通过**（原构建目录启动即 0x80000003）。未运行 NSIS 安装向导，以免覆盖本机已安装版本的卸载登记。
- 改动：`scripts/electron-runtime.cjs` 在 0x80000003 时读取原运行时的实际完整性级别，提示具体原因，回退逻辑不变；`launcher.test.cjs` 13 项通过。打包验收原先依赖 PowerShell 7（本机未安装），改为缺少 `pwsh.exe` 时回退到 Windows PowerShell 5.1；窗口属性脚本去掉 .NET 5 才有的 `Convert.ToHexString`。
- 诊断脚本在 `.local-dev/d-drive-breakpoint/`；排查用的运行时副本已删除。

## 2026-10-23：宫格省资源模式缩略图

- 修复前复现：`grid-electron` 在“从未显示过的格子获得缩略图”超时（与 `.local-dev/navigation-regression-artifacts/grid-baseline.json` 记录一致）。诊断脚本 `.local-dev/grid-thumb-probe/` 确认：未显示过的网页 `capturePage` 立即返回 0×0，关闭节流或移到窗口外显示都无效；在本格原位显示约11ms后得到 692×389（553×311 格 × DPR 1.25）首帧，再隐藏并节流仍可截图，像素为页面绿色主体与右下蓝块。
- 修复后：`grid-electron` 16项、`grid-live-stress-electron` 8项、`grid-transition-electron` 4项、`background-tabs-policy`（3组，`completed:true`）、`minimized-rendering` 7项通过；`check` 345个脚本、`test:control-api` 1项、`git diff --check` 通过。均使用隔离临时数据和本机 HTTP 页面，未接触正式实例、代理或 DNS。
- 弹窗遮挡保护有反向验证：去掉 `overlay` 判断后新增用例以“no thumbnail while covered”失败。
- 边界：只修复省资源模式缩略图；原生网页短暂原位显示期间页面会收到一次 `visibilitychange`。未验证公网重页面首帧超过1.5秒的情形（会在10秒后重试）。`browser-tabs` 收藏菜单原生高度超时已在下一节修复。

## 2026-10-23：原生菜单浮层停在首帧

- 复现：诊断脚本 `.local-dev/overlay-height-probe/probe.cjs` 在硬件加速/软件渲染 × 正常/非激活显示下，浮层 View 高 573（第二次打开 407），网页 `innerHeight` 始终 216，rAF 计数停在1；`probe2.cjs` 对照 `invalidate`、重设尺寸、隐藏再显示均无效，只有重新 `setBackgroundThrottling(false)` 恢复（400ms 内 26 帧、视口 407）。
- 修复后：`test:browser-tabs` 11项、`test:quick-links` 16项、`test:privacy-sites` 7项、`test:extensions-electron` 15项、`test:navigation-background` 6组通过；修复前 `browser-tabs` 在“favorites menu native height”超时。`quick-links` 在 HEAD 上停在“direct quick navigation”，原因是点击坐标在菜单长高前计算，已改为等浮层稳定后再点。
- 均使用隔离临时数据与本机 HTTP 页面，未接触正式实例、代理或 DNS；正式应用未重启。

## 2026-10-23：DSH 执行引擎候选构建 v0.2.20

- 修改前检查点：806f21c，保留扩展默认启用及后台标签修复。现有用户进程未重启，正式数据、代理和DNS未被测试改写。
- 官方引擎：DeepSeek Harness 0.2.1-rc.2，使用真实 AgentLoop、工具注册、Session 和 Cordis 插件；provider、权限、网页/实例工具与系统加密会话继续由千面提供。
- 已通过：check、test:control-api、diff --check、test:packaging（4项）、test:ai-agent、test:ai-browser、test:ai-dsh、test:ai-memory、test:ai-sessions、test:ai-recovery、test:ai-stop 和 test:creation-lifecycle。会话、停止、恢复、记忆及DSH待办包含全新进程验证；网页测试使用真实Electron、DOM、CDP和本机HTTP/SSE协议服务。
- 实际已配置模型验收：deepseek-flash通过4轮官方DSH调用，观察隔离本机页面、执行一次isTrusted=true的真实点击、再次观察并报告随机校验码；网页计数与HTTP服务端计数均为1，结果加密保存后可读取。未发送真实账号页面或正式实例数据。
- 最终打包验收：v0.2.20真实Facet.exe的26项检查全部通过，包含内置说明书读取、网页观察、最终回复及独立进程恢复DSH工具历史；同时覆盖原有代理、存储隔离、扩展、宫格、API、重置和正常退出。最终基础门禁为check（344个脚本）、test:control-api（1项）及diff --check。发现并修复electron-builder漏收DSH peer依赖；最终ASAR包含全部23个官方包，161个实际应用源码逐一校验一致，不以开发模式通过代替ASAR验证。
- 回归中发现并修复：任务结束与发送点击之间的竞态、立即补充图片传递、未知工具/参数失败未纳入无进展保护、截图历史衔接；后台视口为空改用整页读取，不据此判断断网。
- 构建使用既有校验一致的原生组件，未强行覆盖运行中加载的.node文件。本机D盘路径仍会触发既有的STATUS_BREAKPOINT（10-23 更正：原因是项目目录的低完整性标签，不是盘符，见文首）；打包程序通过逐文件哈希一致的C盘临时副本验收，未关闭Chromium沙盒。安装器本身未覆盖安装到当前生产环境。
- 安装包、SHA256、上游MIT版权和固定依赖均已生成/保留；个人记录、运行配置和测试凭据不进入应用包。生产依赖审计为0漏洞；未覆盖所有模型服务、所有网站和跨设备长期运行，不把模型协议夹具当作通用智能或网站兼容性证明。
- 本轮仅准备本地候选安装包，未推送或发布GitHub Release。回滚应保留现有数据，再恢复检查点代码并执行npm.cmd ci；不要使用git reset --hard清理用户工作。旧版不会显示新增待办，回退前先保存重要任务。

## 历史记录


更新：2026-10-22。当前源码版本 v0.2.18 发布候选。下方原始记录是各阶段历史证据；命令编号、数量和阻塞状态不能当作今天的全量结果。

## 2026-10-22：扩展启停后自动恢复

- `npm.cmd run test:extension-configure`：两个独立 Electron 进程，11 项真实验证。覆盖实际鼠标操作与 IPC、启用后的内容脚本、停用后真实卸载、同状态不重启、批量混合运行状态、无关页面不重建、确认校验、保存失败及原配置恢复、实际损坏扩展导致的恢复失败提示、退出期间不重新启动，以及跨进程 Cookie / 网站存储 / 扩展存储 / 启用列表持久化。停止失败为定向故障注入，保存失败使用真实目录冲突，启动失败使用损坏的真实清单；不把故障注入当作正常扩展业务验证。
- `npm.cmd run test:extensions-electron`：15 项通过，涵盖既有扩展导入、逐实例隔离、真实全选/取消全选、更新、移除、视口与菜单、独立代理及夜间布局。同步更新旧测试中“应用后应停止”的预期，并等待自动恢复完成；手动写入损坏包的用例先停止实例，确保真实触发加载。
- 静态与接口门禁：`check` 301 个脚本通过，`test:control-api` 1 项、`test:extensions` 16 项及 `git diff --check` 通过。扩展中心界面回归 9 项通过（真实 Chromium、模拟 IPC，仅作为界面回归；业务由上述真实 Electron 验证）。本机未安装 Playwright 默认浏览器，界面测试通过 `PW_CHROMIUM` 使用已有 Chrome，没有下载或替换运行环境。
- 本地证据与修改前备份：`.local-dev/extensions-auto-resume-20261022/`（不提交）。使用隔离临时数据目录和本机测试页面，没有修改用户的实际实例、代理或 Cookie。
- 当前安装包未重新构建，不能据此认为原有 `release/` 中的包已含本项功能；源码主进程需重启后加载。

## 2026-10-22 续修：新建及重置后的自适应黑边

- 复现用户反馈：前一版仅将自适应宽高分别封顶到模拟屏幕，没有把页面呈现适配回原生区域；模拟屏幕小于宿主时会留边。新增边角像素断言在修复前实际失败，原先“逻辑尺寸正确且逻辑边角能点”的测试不足以证明铺满。
- 修复：按宿主宽高比计算不超过模拟屏幕的逻辑视口，用独立呈现倍率铺满；最多有不足一个逻辑像素的整数取整裁切。DPR、页面 zoom、种子和已保存环境不改写。原生视图尺寸由 Electron 保持，避免模拟 DPR 不同于系统缩放时重设渲染表面造成裁切或留边。AI 点击/输入接受大于 1 的呈现倍率；固定视口和宫格仍保留既有等比缩小策略。
- 真实 Electron：`test:viewport-screen` 20 组，含 DPR 1 / 1.25 / 2 与五种宽高组合；验证三处原生边缘像素、系统桌面合成截图、真实鼠标点击、DPR/屏幕上限、输入内容与页面身份不因缩放重建。另有几何边界遍历，包含浮点取整可能超出模拟屏幕 1 像素的回归。
- `test:instance-reset-electron` 5 组通过：真实界面重置生成新 ID 和随机环境后，将实际视图放大到超过新屏幕，右下角绘制与原生点击通过；仍检查 Cookie/localStorage 清除、语言/时区对齐、单项/批量草稿清理及磁盘重读。`test:viewport-bookmarks`、`test:grid-transition-electron`、`test:devtools-electron` 和 `test:ai-browser` 通过；AI 新增放大视口的点击、输入及跨站 iframe 操作。
- 全量 `tests/*.test.cjs`：343 项，342 通过、0 失败、1 项 Windows 不适用的 POSIX 检查跳过。`check` 299 scripts、`test:control-api` 1/1、`git diff --check` 通过。
- 新生成 v0.2.18 成品包 `test:installed` 24 项通过，新增小模拟屏幕/DPR 1 在本机系统 125% 缩放下的实际绘制、原生点击和配置未改写检查；同时保留代理、隔离、扩展、API、日志、重置、整进程重启和 AI 会话持久化等成品验收。148 个源码与 17 份白名单手册一致；安装 EXE 实际解出的 107 个文件，与受测副本逐一同哈希。SHA256 和更新元数据一致，私有开发文件未入包。
- 独立临时数据，未重启或重置用户真实实例。沿用前节已确认的 D 盘构建目录启动限制，在 C 盘同哈希副本验收；未完成安装向导实装、其他机器或跨显示器 DPI 切换验收。本轮未推送或公开发布。回滚检查点 `a970df2`，可单独撤销本次修复提交；原始日志、截图及审计保存在 Git 忽略的 `.local-dev/viewport-fill-20261021/` 与测试报告列明的临时目录。

## 2026-10-21 v0.2.18 发布前回归

- 全量 `tests/*.test.cjs`：340 项，339 通过、0 失败、1 项 POSIX 专用检查在 Windows 跳过。另行 `check` 298 scripts、`test:control-api` 1/1 和 `git diff --check` 通过。早期并发打包时网卡盘点超时，低负载单独复测 9/9、全量复测均通过，未为通过测试而修改网络逻辑。
- 真实 Electron 专项通过：自适应屏幕边界、固定视口/DPR 与收藏夹（11 组）、重置（4 组）、宫格切换、AI 网页操作与失败恢复、扩展生命周期（15 组）、扩展 debugger、F12、toString / API 行为、OffscreenCanvas 和详细诊断采集。所有业务均使用独立临时 profile 和受控网页；AI 的模型端为本机确定性 HTTP/SSE 协议夹具，不代表第三方模型推理效果。
- `test:fingerprint-contexts` 首次启动、全新进程重启及外部 CDP 三轮各 40 项，`complete:true`；`test:cdp-workers` 17 组流程通过，含多客户端、双实例存储隔离、重连、配置变更、F12 和整应用重启。
- 更新过期测试夹具：补齐当前生命周期依赖；重置按新实例 ID 验证，加入出口语言/时区检查；扩展更新按“更新并重启”验证；收藏夹按当前表单操作并等待短时通知遮挡结束。没有为旧测试恢复已废弃 UI 或绕过生产网络安全策略。
- 旧 `test:electron` 综合脚本未通过：初始等待依赖停止实例仍有顶部页签；继续诊断后，其本机订阅下载又被当前 SSRF 策略正确阻止，后续还引用旧订阅表单。保留原脚本及失败记录，没有将其记作通过；本轮改用下面的成品包专项验证当前生产 UI/IPC 与业务。该历史脚本仍需单独维护。
- 新生成的 v0.2.18 成品包 `test:installed` **23 项通过**：真实生产入口、原生图标/任务栏、直连及 Mihomo 网页、默认 DNS 不落配置、六个检测入口、F12、存储隔离、实时宫格、API 认证/跳转/持久化、扩展框架/标签/数据隔离、失败请求采集、退出回收、全新进程重读、重置语言/时区及网站/扩展数据清除、AI 会话管理和重启、关闭 API。
- 本机限制：D 盘原构建目录直接启动触发 Windows `0x80000003`；旧版 v0.2.17 原构建目录使用独立临时数据启动，也出现相同退出码，本轮尚未确定底层原因（10-23 已查明：构建目录继承了项目文件夹的低完整性标签，见文首）。将新版同一构建完整复制到本机 C 盘后完成上述 23 项检查。107 个包文件逐一核对哈希一致，不把 D 盘原路径失败写成成功；未完成 NSIS 安装向导实装或其他机器验收。
- 打包核验：148 个生产源码文件与受测源码逐一一致；运行时 package.json 仅由构建器移除开发脚本和 devDependencies，其他字段一致；17 份白名单手册与当前文件一致；私有开发目录、历史验收文档、测试及未接线订阅代理草稿未入包。安装包 SHA256、更新元数据的版本/文件名/SHA512 一致。7-Zip 完整性检查通过（附带嵌入归档尾部数据告警），再从安装 EXE 实际解出 107 个文件，与受测成品逐一核对哈希一致。安装包及回归原始证据放在 Git 忽略的 `release/`、`.local-dev/release-prep-20261021/`，不提交个人配置。
- 未对用户正在运行的千面主进程或真实实例做重启/重置；本轮未验证所有第三方网站、验证码、账号、扩展、所有代理线路或长期多实例压力。发布候选与测试通过不代表已推送 GitHub 或公开 Release。

## 2026-10-21 自适应视口屏幕边界修复

- 旧行为实测：本机原生网页视口达到 2034×1067，实例配置模拟屏幕为 1920×1080，横向超过模拟屏幕 114 像素。
- 修复：启用硬件覆盖时，自适应网页视口宽高分别封顶到配置的模拟屏幕；小窗口仍自适应。宫格视口使用相同上限。页面缩放仍为 1、DPR 保留配置，未改实例存储的环境尺寸。
- `test:viewport-screen`：大窗口视口上限、小窗口自适应、DPR 1.25、真实右下角鼠标点击、调整窗口后的文档/输入状态保留及宫格视口检查通过。测试仅使用临时目录和本机 HTTP fixture。
- 此修复处理网页布局视口与模拟屏幕尺寸不一致，不代表网页验证码或风控验证结果；没有重启用户运行中的应用。修改主进程后需重启应用才会加载新代码。

## 2026-10-21 兼容性优化：网页重写 JavaScript 辅助方法

- 原生/注入实际对照发现：网页替换 `WeakMap.has/get/set`、`WeakSet.has/add`、`Math` 方法、`Reflect.get/construct`、`Array.slice`、`Function.apply` 或部分构造器后，注入的 toString、画布、WebGL、离线音频和布局读取会意外调用网页方法，出现额外异常，或静默退回未处理的导出结果。原生浏览器 API 不依赖这些被替换的方法。
- 修复：在注入初始化时保留内部需要的原生方法与构造器引用，后续通过保留的 Reflect.apply 调用；网页自身的替换仍保留，固定种子和实例环境配置不变。没有添加 Chrome API 假实现、伪造 HTTP Client Hints 或篡改 GPU 能力上限。
- `fingerprint-tostring-electron.cjs`：9 组检查通过，新增页面与同源 iframe 各 19 项、Dedicated Worker 14 项原生对照。测试先在未修改实现上失败，再在修复后通过；核对网页方法调用次数为零、输出/错误与原生一致。保留方法描述符、非法 receiver、参数转换、导航、重复注入和停用检查。
- `test:fingerprint-offscreen` 4 组通过；`test:fingerprint-contexts` 三轮各 40 项通过；`test:cdp-workers` 17 项流程 / 34 次 SharedWorker 首段采样通过。`check` 297 scripts、`test:control-api` 1/1、`test:fingerprint` 13/13 和差异空白检查通过。
- 真实 `ip.net.coffee/cloudflare/` 复测：隔离会话复用运行实例的环境参数与同一代理，不复制原登录、扩展或 Cookie；非交互验证服务端 PASS（本次 36 ms），托管模式仍需点击，未代点。不能把本次兼容修复写成免点击成功，亦未确定 Cloudflare 对托管模式作此决定的具体原因。
- 本机核对即时 about:blank iframe 和 srcdoc 首段未发现所测 CPU/内存/触点/屏幕/语言漏覆盖，语言请求头与页面及 Worker 保持同一配置。HTTP Client Hints、完整 GPU / WebGPU 能力、Chrome 专属 API 仍有原生实现差异，不属于已修复范围。
- 使用独立临时数据，用户主进程与实例未重启。回滚检查点 `b2d1e86`；本次提交可单独撤销，原始复测记录在 Git 忽略的 `.local-dev/cf-version-compare/intrinsics-report.json`。

## 2026-10-21 回归修复：私有调试管道改变手动浏览状态

- 原因：新增 `--remote-debugging-pipe` 后，Chromium 同时启用 AutomationControlled，正常手动浏览的原生 `navigator.webdriver` 变为 `true`。前序本机字段测试漏测了该项。
- 修复：建立私有管道时，在普通启动中合并 `disable-blink-features=AutomationControlled`，保留已有禁用项及原生 webdriver getter。显式指定 `--enable-automation` 或 `--headless` 时不覆盖启动意图；没有添加检测站域名特判，也没有移除 SharedWorker 初始化协调。
- 真实网页旧新对照：同一实例环境参数、同一正在运行的本机代理，使用隔离会话访问 `https://ip.net.coffee/cloudflare/`。15:58 检查点 `6495038` 和 Canvas 修复版 `4404175` 的非交互验证取得服务端 PASS；私有管道版 `96f41ad` 出现 webdriver=true 与 600010；本次修复后 webdriver=false，非交互验证恢复服务端 PASS（该次响应 29 ms）。托管验证显示“需要点击确认”，未代点，不能记为托管验证通过。600* 本身是通用挑战失败码，定位依赖本次版本对照，而非错误码单独归因。
- `test:cdp-workers`：17 项流程、34 次 SharedWorker 首段采样通过，补充原生 webdriver 描述符和跨源 iframe 第一条脚本断言；双客户端、重连、环境切换和全新进程重启持续检查 webdriver=false。
- `test:fingerprint-contexts`：首次启动、重启和外部 CDP 三轮各 40 项通过；页面及真正独立进程的跨站 iframe 首段、导航后读数新增 webdriver=false 检查。另行原生启动对照验证普通模式 false、显式 automation 模式 true，原有禁用项保留。
- `check` 297 scripts、`test:control-api` 1/1、`test:packaging` 3/3 和 `git diff --check` 通过。未生成安装包。真实网页对照没有复制原账号 Cookie 或扩展；结果不代表所有节点、所有验证码或原账号状态均通过。用户应用未重启，需加载新版主进程后生效。
- 回滚基线 `96f41ad`；仅撤销本次提交即可保留此前 SharedWorker / 外部 CDP 修复。真实网页原始对照报告保存在 Git 忽略的 `.local-dev/cf-version-compare/`，不随项目发布。

## 2026-10-21 续做：外部 Playwright 与 SharedWorker 初始化协调

- 正式入口复现：外部 Playwright Browser 连接会在内部环境初始化结束前恢复 SharedWorker，导致第一条脚本读到原生信息，后续读数才被覆盖。仅页面 WebSocket 的通过结果不足以排除此问题。
- 修复：Chromium 保持私有命名管道；外部原配置端口由本机 CDP 网关监听，各客户端拥有独立 Browser 会话。目标附着事件和恢复/分离操作等待该目标环境初始化；内部监听忽略外部会话，防止交叉恢复。没有增加另一个 Chromium TCP 调试端口。
- `test:cdp-workers`：正式 `main.cjs` / API / 两个真实 Playwright 客户端，16 项流程检查、34 次 SharedWorker 首段采样通过；含双实例、真实 Chromium UA 与 UA-CH、Cookie / localStorage 隔离、5 秒以上命令、CDP 错误码、Host / Origin 校验、重连、配置变更、F12 共存、正常退出、整应用重启和旧命令行端口 0 入口。隔离 profile（包括临时令牌）在测试结束时删除，仅保留无凭据 JSON 报告。
- `test:fingerprint-contexts`：首次启动、持久化后重启、开启外部 Playwright 三轮，各 40 项检查通过。含跨站 OOPIF、Dedicated / Blob / module / 嵌套 / Service / Shared Worker、首段字段、OffscreenCanvas、配置切换与 SharedWorker 初始化故意失败后的报错、恢复执行和后续重新注入。
- `test:extension-debugger-electron` 与 `test:devtools-electron` 各 5 项通过；前者验证扩展调试桥，正式入口专项另验证外部 CDP 与 F12 共存。基础检查、控制 API 和打包资源检查通过，未生成新安装包。
- 仅当前 Windows x64 / Electron 44.4.5 / Chromium 152 验证；受控本机网页不代表第三方验证码通过率、所有自定义 UA 或完整 GPU 覆盖。原生 `/json/protocol` 与前端页面托管未在网关实现。用户正在运行的应用和真实实例未重启或修改。
- 回滚检查点 `ee30e1b`，前序 SharedWorker 修复 `e127cef` 保留；本次结果单独提交，回滚仅撤销该提交，不重置真实用户数据。

## 2026-10-21 指纹上下文与 API 行为修复（源码，未发布）

- `test:fingerprint-contexts`：首次启动和全新 Electron 进程重启两轮通过已实现范围断言。两个并发实例的首段页面、Dedicated / Blob / module / 嵌套 Worker、网站 Service Worker、真正独立进程的跨站 iframe、iframe 内 Worker 和跨站导航读数对齐。实例重启、变更 CPU、仅变更时区、关闭再开启覆盖，以及其他实例不受影响均通过。
- 必须保留限制：报告 `complete:false`；两实例的 SharedWorker 仍返回原生 UA / CPU / 内存 / 语言 / WebGL。未修改 Worker URL 或默认开放外部 CDP。不能把本节写成所有 Worker 或所有检测网站通过。
- API 行为：透明画布、空 Canvas 导出、非法 receiver 与单次参数转换、WebGL 未启用扩展的错误码、AudioBuffer 引用/写入/copy、离线渲染稳定性及 complete/Promise/copy 一致、静音、空矩形均通过。后续已补 OffscreenCanvas 导出噪声一致性，范围见下节。
- `test:fingerprint` 13/13；`test:fingerprint-electron` 两轮保存/隔离/重启通过；`fingerprint-tostring-electron.cjs` 7 组真实 API / 描述符 / 导航 / 停用检查通过，新增离线音频构造器与渲染方法对照。
- `test:extension-debugger-electron` 5 项、`test:devtools-electron` 5 项、`test:extensions` 16/16 通过。前两项在开启指纹覆盖的实例内验证扩展调试及 F12 开关后 Worker 仍正常。
- 使用临时数据与本机服务器，保留每次的 JSON 报告；未重启用户应用或操作真实账号，未修改 DNS、代理或编译内核。Simprint 仅记录待办。当前 Windows / Electron 44.4.5；其他系统、所有自定义 UA、第三方验证码与长期负载未完成验收。
- 最低基础检查和控制 API 通过；回滚检查点 `d69ee20`，最终变更应单独提交，不使用破坏式重置覆盖其他工作。

### 同日续做：OffscreenCanvas 导出与 SharedWorker 入口

- `test:fingerprint-offscreen`：真实原生基线与覆盖后对照，4 组检查通过。PNG / JPEG / WebP 与无效 MIME 回退、质量参数、参数读取/转换顺序与次数、冻结选项对象、已撤销 Proxy、抛出对象身份、同步/异步错误、零尺寸、分离、DOM 所有权和跨域污染均保留原生行为；调用后清空画布不改变导出快照，转换选项期间绘图会体现在快照中。
- 原画布内容不变；替换网站侧构造器/getContext/drawImage/putImageData 和覆盖 width/height getter 不会被内部导出调用。保留 sRGB / Display P3 和 unorm8 / float16 原生编码，浮点像素不会被加上字节量级噪声。
- 页面与 Dedicated Worker 的 PNG 字节一致，HTML 画布转移到 Worker 后仍能正常导出。WebGL / WebGL2 的默认缓冲及保留缓冲导出均含预期噪声。`test:fingerprint-contexts` 增加所有已实现上下文 PNG 字节断言，以及 SharedWorker 顶层首读和导出差异记录；两实例、导航、配置切换、实例重启和全新进程重启两轮各 31 项检查通过，`complete:false` 保留。
- SharedWorker 仍未修复：独立入口探针中的 `setAutoAttach` 未暂停其首段；`autoAttachRelated` 仅支持 Browser target，页面请求 Browser target 为 `Not allowed`；SharedWorker 预加载注册被拒绝。手动附着成功时首读已经发生。没有将探针的全局目标发现接入生产。
- 限制：无上下文、bitmaprenderer 或未跟踪上下文保留原生导出，不保证噪声一致性；高频大画布、任意 HDR、完整 GPU 能力和所有第三方检测站未验收。保留原生校验会多编码一个副本，增加单次导出的计算与瞬时内存开销，不增加代理或常驻浏览器进程。
- 本次检查点 `6495038`；不打包、不推送、不重启真实用户应用。
- 本轮回归：`check` 291 scripts、`test:control-api` 1/1、`test:fingerprint` 13/13；指纹 UI 保存/全新进程重启两轮、toString 7 组、扩展 debugger 5 项、F12 开发者工具 5 项通过。JSON 报告仅放隔离测试目录，不纳入 Git。

## 2026-10-14 详细日志修复验收

- `test:diagnostics` 9/9：真实本机连接重置、TLS 证书拒绝、HTTP 错误、部分响应超时、导入与失败保留原配置；输出脱敏、截断、损坏文件保留、跨重启读取及实际 JSON 导出。
- `test:diagnostics-electron` 7/7：真实 Electron 主页面与 fetch 失败、HTTP 503、Mihomo 输出、节点检测及备用目标失败关联、控制界面错误、UI → IPC → 文件导出、全新进程重读及退出清理。仅原生保存路径由测试适配器指定，未模拟业务采集或文件写入。
- `test:subscription` 13/13，`test:hardening` 137 通过/1 跳过，`test:core` 13/13，`test:node-network` 9/9；基础检查与控制 API 通过。
- 使用独立临时数据及本机故障服务器，没有修改真实用户数据或网络。未验证所有机场或所有设备；旧日志缺失不能补回。

## 当前验证方式

| 范围 | 命令 | 证据边界 |
| --- | --- | --- |
| 最低基础检查 | `npm.cmd run check`、`npm.cmd run test:control-api`、`git diff --check` | 语法/桥接边界/API 回归，不证明所有业务功能 |
| 下载/源管理/安全 | `test:subscription`、`test:library`、`test:hardening` | 主要为受控请求与本机夹具，不证明所有机场可用 |
| 节点准备/内核 | `test:node-network`、`test:node-network-electron`、`test:core`、`test:process-host` | 公网、TUN、多网卡另记录实际条件 |
| 浏览网络与隐私 | `test:browser-network`、`test:webrtc` | 受控解析/浏览器回归，不保证所有协议与扩展无泄露 |
| 扩展 | `test:extensions`、`test:extensions-electron`、`test:extension-debugger-electron`、`test:extension-popup-electron` | 必须区分加载成功和真实插件功能 |
| 常用扩展 API | `test:extension-compat`、`test:extension-compat-policy`、`test:extension-native` | 自动专项、原生保存/权限生命周期与通知真人点击分别报告 |
| 指纹库/窗口图标 | `test:fingerprint`、`test:fingerprint-electron`、`test:window-identity` | 真实页面/重启及 Win32 图标与任务栏属性；不代表所有检测网站或设备 |
| 实例操作/UI | `test:electron`、`test:instance-reset-electron`、`test:devtools-electron`、`test:grid-transition-electron`、`test:viewport-bookmarks` | 独立测试数据；页面/存储/真实点击和进程结果需一起检查 |
| 迁移/删除 | `test:instance-archive`、`test:instance-transfer`、`test:export-delete` | 真实生成归档、复读校验、原数据与异常恢复 |
| 日志/更新/打包 | `test:diagnostics`、`test:diagnostics-electron`、`test:updates`、`test:packaging`、`test:installed` | 新构建要新验收，不能借旧包结果 |

以上为 `npm.cmd run <脚本名>`；不是每次全部重跑。按照实际修改的风险和必须通过的项目门禁选择，不把未运行项写成通过。

v0.2.12 发行时：check 210 个脚本、control-api 1 项、packaging 3 项、updates 15 项及打包程序隔离验收 15 项通过；exe PE/版本/打包源码/清单校验一致，发布四附件和远端 SHA256 核对完成。D 盘测试目录启动异常后，用 C 盘完整复制且 88 文件哈希一致的程序验收；没有运行安装向导，不等于多设备安装测试。安装版升级 Star 弹窗也加载包内代码验证过。

已知测试环境边界：部分 Playwright UI 测试需匹配其浏览器版本；`test:experience` 历史有夹具缺少 `isDevToolsOpened` 的失败记录，未在本次文档整理中修复。详见 [项目手册](PROJECT.md)。

本次项目文档整理会核验文件、链接、脚本名称、基础检查和文档与实际源码一致性；不会重启用户应用或宣称新增网络草稿已验收。

---

# 历史：0.2.0 实测交接

## 已验证

- Windows Node 24.18.0 / Electron 44.4.5：14 脚本语法和边界检查通过。
- Windows 核心与真实 Mihomo 合成测试：7/7。
- Windows Electron 集成：14/14，最终版本连续三轮通过；最终三轮退出无 IPC destroyed 异常。
- Linux Electron 集成：14/14；浏览器静态预览：5/5。

桌面测试实际创建 WebContentsView，读取真实页面中的 Cookie、localStorage、navigator.language 和 Intl 时区，不是纯 mock。使用受控的本机 HTTP 页面和本机 HTTP CONNECT 上游验证代理路径，没有使用真实账号、用户节点或公网 IP 查询服务。

## 覆盖

1. 无节点直连及真实网页。
2. 两实例 Cookie/localStorage 隔离，停止重开保留存储。
3. 语言/时区按实例生效，网页没有 Node/控制桥。
4. 真实 UI 的标签切换、浏览区域位置和环境保存 IPC。
5. 代理缺节点拒绝启动；真实 Electron→Mihomo→本机上游链路。
6. 意外内核退出销毁对应浏览区域，代理设置不回退 DIRECT。
7. 六个直连实例通过启动队列加载本机 HTML。
8. 重复并发启动不创建重复会话，删除不影响其他实例，正常退出清理视图和内核。

六实例合成页面的 Electron 工作集汇总约 0.94–0.97 GiB，来自 app.getAppMetrics() 的工作集之和，是瞬时值且可能包含共享页重复统计。不是私有内存，不含真实重网页工作负载，也不是 15 实例性能证明。

## 本轮修复

- 创建 WebContentsView 后先加载受控本地初始化页，再设置 CDP 环境，避免在尚无渲染目标时等待。
- 仅 session Accept-Language 不会改变 navigator.language：增加保留原生 UA/UA-CH 的 CDP 语言覆盖。
- Windows ShunCode 继承 ELECTRON_RUN_AS_NODE：启动脚本显式清除此变量，避免 Electron 被当作 Node。
- 退出时迟到 IPC：检查窗口、webContents 和 disposing 状态，安全拒绝已关闭控制界面的调用。
- Windows 上 requestAnimationFrame 可能因窗口遮挡暂停，导致 native view 没有 bounds：改为同步测量发送布局，不依赖动画帧。
- 存储先完成磁盘原子提交再替换内存状态。

## 内核

官方 MetaCubeX/mihomo v1.19.31，compatible x64。
Windows 压缩包 SHA256：93d14e9a13b49b2f2d256202d02cc8d14a7c4695edf084cae0f941986bc9c218。
Windows exe SHA256：1fa8055e03596fc35167f70e9ecd1890517d38d960a39177445746a1b0defc2b。
随项目保留 LICENSE、上游 tag 源码归档、版本/来源/hash 元数据。尚未制作公开分发安装器；发布前仍需检查完整第三方依赖许可和源码提供义务。

## 尚未验证或限制

- 15 个真实实例、6–15 个代理核心同时运行及长期内存稳定性。
- 用户真实节点/订阅兼容性、真实公网出口、完整 DNS/WebRTC 泄漏。
- 系统强制终止和断电清理；正常退出已测，尚未引入 Windows Job Object。
- 导入节点凭证保存在本机文件，尚未加密；不要分享用户数据目录。
- 摄像头、麦克风、地理位置权限默认拒绝；暂不提供完整权限管理。
- 基础环境调整不是完整指纹伪装，不承诺不可检测。

旧安装包不参与新工程运行，不覆盖旧程序。验证脚本使用独立临时用户目录。

## 订阅链接增量验证

新增主进程 HTTP(S) 订阅下载、Clash/Mihomo YAML/JSON 导入、原始链接本机保存与手动更新。Windows 订阅专用测试 7/7，原核心 7/7，扩展后的 Electron 集成 17/17。覆盖 HTTP 状态、重定向循环、压缩响应/解压上限、超时、HTML 响应拒绝、拒绝将 DIRECT/策略组当成代理节点、旧节点数组兼容、令牌不进入快照，以及真实 IPC 导入/刷新。

真实 IPC 验证确认：下载/解析失败时当前运行实例和旧源文件保持不变；成功才停止目标实例；其他实例不受影响；直连模式不被自动切换；刷新使用本机保存的原始订阅链接。上述14项三轮是订阅接入前的核心基线，本次新增后为17项，不能混称17项已跑三轮。

用户尚未提供真实订阅，本轮仅使用本机合成订阅服务验证。没有读取用户的节点或订阅令牌。

## 全局多订阅与诊断增量

Windows 首轮：check 20 个脚本、library 4/4、subscription 7/7、core 7/7、Electron 24/24，errors 为空。包含真实 UI 保存两个订阅、目标实例分配、错误更新保留数据，以及经独立 Mihomo/专用 Electron 会话执行连通性、IP 查询与 5 MB 下载。追加批量/取消/失败封闭回归后，最终 Windows Electron 27/27、errors=[]（cmd_39e7adbc756ef876ca34b70ff9e3a4b27e541cfb687e4d65）。切换诊断代理后再次关闭旧连接，防止连接池沿用旧代理；批量测试等待预算匹配逐节点超时。结果见 tests/electron-results-win32.json。

检测服务在自动测试中替换为合成 HTTP 上游（不访问用户节点、不会消费真实订阅流量）；这不代表 Cloudflare/ipwho.is 公网可用性或用户真实出口已经验收。生产检测目标固定为 HTTPS，正常证书验证。

## 长列表界面修复与删除操作验收

用户截图暴露旧布局把订阅表单/结果区域 flex 压缩并裁切；旧24/27项主要覆盖小样本和接口，不能证明长列表可用。现代理管理使用文档滚动、节点表限高滚动，顶部固定任务进度/取消。

Windows cmd_bb58bf160efcb3a962e642c3d2c886e1914eda2bb5caf0aa exit0：check20、library5/5、subscription7/7、core7/7、Electron32/32，errors=[]。新增43节点在960×700、1280×800、1560×1000的布局几何断言，并通过真实鼠标事件点击勾选、批删、单删、恢复、订阅导入和顶部取消；确保控件中心未被遮挡。节点删除持久排除、重启及刷新后仍排除，支持显式恢复，不改实例副本。测试截图 proxy-management-win32.png 为合成测试窗口，不含用户数据。

## IPv6 限制修复

移除运行配置 ipv6:false，改为允许 IPv6；IPv4 回环监听、单代理 MATCH 规则不变，无 DIRECT 回退。新增固定错误分类的凭证脱敏断言及真实 Mihomo 到 ::1 上游的受控转发测试。Windows core10/10、library5/5、subscription7/7 已通过。IPv6 测试只证明本地回环代理可用，不证明用户公网 IPv6、节点域名 AAAA 或其真实失败原因；截图节点名称带 IPv6 也不等于已核实服务器地址族。

## 紧凑节点表与同行结果

最新需求替代此前独立结果区：行高目标36px，协议与名称同行，操作按钮25px；连通性/延迟、IP、下载速度独立列，仅更新结果单元格。按来源ID+节点名+类型匹配，错误/地区/时间保留在悬停提示，检测中状态也按来源区分。
Windows 首轮 check21、Electron34/34（cmd_0aef7bdbabdfa81d86a29bc8326919949e0a894705c2e555 exit0），包含43节点三尺寸行高<=42px、混合来源和多类型同行结果、失败详情、真实鼠标操作。

紧凑表第二轮 cmd_d60e5cec2dd733a6d50709c3c063d98e4dd65aeef96fdbd9 同样34/34、errors=[]，已查看实际截图。取消操作在同行显示“已取消”，不混称节点失败。结果仅本次应用运行保留，删除/更新来源后需重测。

## 管理能力与高级环境扩展验证

新增 workspace 单元测试5项：收藏与IP备忘持久化、不复制凭证、全局日志脱敏与1000条上限、环境参数校验、CDP调用及订阅提示/差异统计。Windows core10、library5、subscription7均通过。

Windows 首次完整扩展 Electron42/42、errors=[]：cmd_586a560c92c8cb1b393bfba9e6e84faa52645ceeb28ba372 exit0。除旧34项外验证真实鼠标收藏/IP备忘、日志筛选/摘要与导出、网页实际UA/platform/900×700/DPR1.5/CPU4/暗色与减少动画/固定定位，3个并发真实Mihomo分别得到3个不同合成IP、并发取消全部回收、主检测服务503后备用204、提示条目默认拒测、订阅折叠。剪贴板写入与导出对话框在测试中拦截，不需用户操作；其余走生产IPC和真实浏览器。

修复测试发现的Windows快速启停偶发端口绑定冲突：随机独立端口、TCP/UDP预检、进程内保留及回收冷却、仅绑定失败有限重试；控制API采用独立直连HTTP而非共享连接池，启动检查响应取消信号。

公开IP服务在测试中用本机受控上游替代，不验证用户真实节点或服务商配置，也不证明6路重负载性能、15实例长期稳定或完整防泄漏。高级字段是浏览器覆盖值，不是物理硬件变更。

最终完整复测：cmd_cf07ed8d2bbb90153696f03f014dc616fb56fc6bfb57a157 exit0，check25 / workspace5 / core10 / library5 / subscription7 / Electron42全部通过，errors=[]。新增日志来源/任务精确筛选，收紧侧栏间距；保留运行实例、不强制重启。此前独立完整复测cmd_3b8303e12821436707604c3e7b4c59376833475b750e6d51同样全部通过。

## 参考指纹与一次性IP时区（2026-09-27）

Windows全套命令cmd_28013ba822f3942bb422031655fc460a2c5f0e54d4f0ddf4 exit0：check29、fingerprint5、workspace5、core10、library5、subscription7、Electron46全部通过（errors=[]）。此前cmd_76a4bc1345dbcece00eaf313e91165b4a623b7f508965835也通过Electron46。本轮新增5项离线用例与4组浏览器用例，合计32项单元测试。

实际浏览器验证：生产随机按钮先填表不保存；默认Canvas/WebGL/音频/布局关闭；语言与时区不随机；内存报告4GB、屏幕和可用高度生效；开启后Canvas输出不同且重复读取稳定，音频扰动不重复累加、布局偏移范围正确；WebGL真实上下文查询返回所选厂商/渲染器（本轮无不可用跳过）；停止重启种子和结果保持；关闭覆盖并重启恢复原生Canvas输出。测试发现未启用CDP Page域时文档起始注入不执行，已加Page.enable后真实验证生效，不能只以API返回成功作为证据。

时区验证：本机受控HTTP服务返回Europe/Berlin，真实隔离Mihomo合成上游返回Asia/Tokyo；代理节点不存在时拒绝且不回退直连；创建弹窗真实鼠标选择全局代理源/节点后同步并保存，新建直连同样按查询保存；环境页按钮只填时区、不保存；无效响应保留创建默认时区并记录警告；临时内核全部回收。未访问用户真实订阅或测试第三方IP数据库的准确性。

界面截图tests/fingerprint-options-win32.png。参考目录只读；无重启生产实例。公开发行授权核查、跨进程iframe/Worker/OffscreenCanvas、15实例长期公网负载与防泄漏均未验收，不承诺完整硬件仿真或不可检测。

最终全宽布局复测：cmd_2349d7468ef4a1ee99494f3fabf4491d90b27443038001b0 exit0，check29及Electron46全部通过，errors=[]；截图已人工复核。

## UX前两批最终Windows回归（2026-09-27）

cmd_f8b7a9f4d27b034e4f5c60bb9f73acbdb2860e3117bf49b1 exit0：check33、38项单元/内核测试、Electron52全部通过，errors=[]。新增真实生产IPC用例包括无修改/无效配置不停止实例、随机撤销、草稿保护及保存范围、分配目标保持与任务日志、创建后启动失败重试同一实例、三窗口尺寸固定保存栏。

此前cmd_aa5322414a41df151d4f3e8e63e7e6eb9b774a1161ace79f失败在旧测试仍查找span；生产控件改为可点击button后，测试已按.node-result-value修订。另有11组真实Chromium控件测试（模拟IPC/runtime）与Linux Electron52通过，只作为补充证据。

详细状态与未验证边界见UX-DELIVERY-STATUS.md。未读取真实订阅、未强制重启生产、未改旧asar或参考归档。

## 固定视口/IP收藏最终回归（2026-09-27）

cmd_b6aa278741cb46992a4f0f38056964d7f91ecbf6ec679213 exit0：check36、单元/内核42、专项11、完整Electron53，errors=[]。专项覆盖固定视口与原生125%缩放下DPR1/2鼠标坐标、三个尺寸、实例切换，以及收藏状态/IPv6/备注/剪贴板/确认批删与持久化。六预设原生HTML校验允许DPR1.25。

重复回归曾停滞在立即删除新实例；已加固关闭顺序，增加异步销毁顺序单元测试与三个真实立即启动/删除循环。最终Windows整套通过。此前单次52通过不代替最终53项报告。

辅助Linux42+53+11、Chromium模拟IPC12组通过。测试窗口关闭Windows原生遮挡优化，生产不变；原生DIP取整容差1像素。Windows六本地HTML实例workingSetKiB 1532352，不是15实例长期负载指标。详细排查及截图边界见VIEWPORT-IP-BOOKMARKS.md。没有测试真实订阅或关闭生产窗口。

## 统一收藏夹与随机窗口保护（2026-09-27）

Windows cmd_b40b8303102eab57534cd7b9eb1c1ae7d0e25dcd1254cdd3 exit0：check37、单元/内核43、视口/IP专项11、完整Electron54。最终紧凑样式/选择上限复测cmd_8f907eaf276f705017f394ac9ee9e783f4114927be8dc250 exit0/check37/Electron54，errors=[]。收藏夹真实鼠标测速/查询IP/收藏IP/目标分配和来源/已分配展示已测。Chromium模拟IPC15组补充随机不改窗口参数及隐藏选择总数100上限。测试为受控本地代理，不代表真实订阅或公网测速。

统一收藏夹最终分栏路由修订验证：cmd_030523290331e6017aa3bed317a47feb2443d49acf14048d exit0，check37、专项11、Electron54。独立data-favorite-tab已防止误触实例路由，真实点击断言保持代理管理且controller.activeId为null。

## 标题栏快捷网站（2026-09-27）

cmd_5ff597003ebcf2703420f5464a912ad3054e8298cf8e2d5c exit0：check40、单元/内核46、快捷网站专项9，errors=[]。真实鼠标覆盖管理CRUD/排序/持久化、非法协议、原生视图遮挡与恢复、同一WebContents导航及跨实例存储隔离、真实Mihomo路由和代理失败拒绝直连、20个长标题三尺寸布局。

cmd_5a3dcb5d399b61b7fabc8c03075a6a627065ece489f35d6d exit0：旧专项11、完整Electron54。Chromium模拟IPC15组通过。未自动访问默认公网网站，未触碰生产配置或重启生产窗口。截图与边界见QUICK-LINKS.md。

## 紧凑界面与夜间模式最终验收

连接恢复后确认cmd_92ef4c67d9c4fa847a8211a7aa0625af7a33e418eefaca46 completed/exit0：check41、单元/内核46、快捷/主题14、视口/IP11、完整Electron54，errors=[]。原始Windows报告已逐个核实。本地Chromium15和非内核单元36通过。新增主题不改实例指纹、网络、session或网站媒体偏好；折叠导航保留真实鼠标操作及原生视图适配。生产未重启。截图和测试边界见APPEARANCE.md。

## 夜间占位提示与后续界面审查

Windows最终cmd_49ecad7ad37f0cef93b04e5d73d0191cbb83ffa0c77c6f7a completed/exit0：check42、快捷/主题15、视口/IP11、完整Electron54，三个原始JSON均已核对errors=[]。本地新增界面审查8、原界面15、非内核单元36通过。生产未重启。详见APPEARANCE.md；不代表完整无障碍认证或公网网站验收。

## 扩展接入：仅本地验证（Windows阻塞）

本地最终整链命令extensions-final-verified.txt exit0：check47、单元/内核51、扩展专项11、快捷主题15、视口IP11、完整Electron54、模拟IPC15+8。Linux DPR2专项补充等待CDP viewport工作和原生合成帧，连续三次通过并最终整链通过，没有跳过点击断言。Dark Reader功能探测单列functional=false，不计入通过的扩展兼容性。

本轮远端连接530导致源码未同步，旧Windows报告不代表本轮结果；Windows专项/回归/文档同步/打包/任务终结待连接恢复。没有重启生产或导入扩展到用户实例。


## 扩展接入最终Windows验收

Windows cmd_48244811da3a425df9026b502825ef7985c0a4c71af32aa2 exit0 + cmd_fc244bc32c9f5c423972e5950d8f968e4cc03fbc0c407b34 exit0：check47、extensions5、quick-links15、viewport11、electron54、extensions-electron11，errors=[]。本地链同通过。Dark Reader功能探测functional=false单列，不计入通过。生产未重启。
