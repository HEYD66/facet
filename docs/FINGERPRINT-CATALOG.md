# 指纹候选库与组合规则

更新：2026-10-21。当前 v0.2.17 源码补齐部分 Worker / 跨站 iframe 覆盖并修正 API 行为；此修改尚未发布。v0.2.14 修正整套随机的默认视口。适用于 v0.2.13 中的 `library-v1`；旧发行版 v0.2.12 不包含该候选库。仍使用现有 Electron/CDP 与页面 API 覆盖，不代表已经实现原生指纹内核。

## 数据与数量

从用户提供的两份 JSON 样本（10,000 条比特配置、615 条 Cloak 页面采样）只提取 GPU 厂商和型号。去除驱动文件/版本与设备 ID 差异、过滤不匹配的厂商、旧 Direct3D9 格式及异常字符，生成独立的千面目录：

| 项目 | 当前候选 |
| --- | --- |
| GPU 字符串 | 482 条：NVIDIA 188、AMD 228、Intel 66；是规范化候选，不保证等于 482 种独立物理 GPU |
| 屏幕与 DPR 组合 | 13 套，11 种逻辑分辨率；DPR 1 / 1.25 / 1.5 / 2 |
| CPU 线程 | 6 / 8 / 12 / 16 / 20 / 24 / 28 / 32 |
| 内存报告 | 4 / 8 GB，按千面当前校验范围生成 |
| 桌面触摸、色深 | 0 个触点、24 位；不为增加差异而强制轮换 |

保留六个旧设备预设及其 ID。库位于 `src/main/fingerprint-catalog.json`，规则位于 `src/main/fingerprint-catalog.cjs`。源文件名称、行数和 SHA256 用于核对来源，不保留个人绝对路径、账号、代理、订阅、计算机名、MAC、签名或云端加密字段，也不复制第三方生成器代码。

原始资料不由产品重新分发。本地使用授权来自用户提供资料并要求接入；公开分发前仍应确认采样来源及相应数据使用权限。

## 取长补短

1. GPU 厂商与型号作为一个条目选取；不独立拼接。只覆盖 WebGL 厂商/渲染器字符串，不宣称参数上限、扩展及 WebGPU 已对应。
2. 屏幕、DPR、任务栏可用高度作为一组。抽取屏幕不会自动把浏览视口设成屏幕宽高；未手动固定时保持 0×0 自适应。显式固定视口保留，筛选可容纳它的屏幕。
3. CPU 与内存按千面的桌面策略组合：6/8 线程可报 4/8 GB，其他档位报 8 GB。这是候选策略，不是物理硬件定律。
4. 不照搬“Intel 不能接 4K”等样本分组。所有厂商都可选择屏幕池；颜色偏好等使用独立的种子标签，避免序号轮转造成字段绑定。
5. 不复制来源的 Chrome 154、语言、上海时区和触摸点 10。UA 使用当前 Electron 所带 Chromium 版本；语言、时区、固定定位沿用表单或由现有出口同步流程设置。
6. 同一固定种子与同一库版本可复现生成；实际字段完整写入实例。启动只读取保存值，不重新抽取；更换库也不自动改变已保存实例。种子、配置不同不代表检测站不可关联或无法检测。

GPU 厂商先按等概率选择，再在厂商池中选条目；屏幕/CPU 候选等概率选择。样本是产品生成/采样数据，未据此声称真实市场占比，也不套用文档里的账号关联概率。

## 操作与兼容

- **环境配置的一键随机**：扩展 GPU、CPU、内存等候选，保留当前视口、屏幕和 DPR。只填草稿，保存前不停止或修改实例。
- **选择“扩展设备库 · 整套随机”并填入预设**：同时生成屏幕、DPR 和硬件；视口默认自适应，手动固定的宽高保留；保存后启动生效，仍可撤销草稿。
- **新建/批量创建的随机环境**：生成整套库方案；出口语言/时区同步仍按原流程处理。
- **重置环境**：清除网站数据，并重新生成整套屏幕/DPR/硬件，视口恢复自适应；保留代理、名称、备注、语言、时区及原有固定定位策略。已清除的网站数据不可普通撤销。
- 旧版本已保存的大固定视口不自动迁移：可将视口宽、高都改为 0，保存后重新启动实例。无需执行环境重置或清除网站数据。默认原生方案与旧实例不自动迁移。修改源码后，用户正在运行的应用需重启 Electron 主进程才使用新生成器。
- API `fingerprint-preset` 的 `preset` 可用 `library-v1`；`random` 保留原有浏览尺寸保护。输入/输出继续走环境校验。

当前版本生成的 Windows UA 与运行内核一致时，保留原生 Windows UA-CH 数据；显式编辑 UA/平台或旧版本 UA（如实例保存的 UA 在内核升级后落后于运行版本）时，`customMetadata` 从该 UA 自身的 `Chrome/<版本>` 推导 brands 与 fullVersionList，并复用原生 GREASE 项与 OS 字段，让页面的 UA 串、brands、fullVersionList 自洽；非 Chrome 或非 Windows 的自定义 UA 仍沿用清空 UA-CH 的旧策略。关闭参考覆盖后恢复原生方案。

## 2026-10-24 检测对抗：CPU/显卡配套、window.chrome 与自定义 UA 的 UA-CH（源码修改，未发布）

起因：在一个检测页上实测伪装实例，读出三处破绽——(1) `navigator.hardwareConcurrency` 报 24 却配 `Intel(R) UHD Graphics 617`（2018 年超低功耗双核集显），24 线程 + UHD 617 是现实中不存在的机器；(2) `window.chrome` 是空对象（真 Chrome 带 `app`/`csi`/`loadTimes`），是常见的非 Chrome / 自动化标志；(3) 该实例保存的自定义 UA（`Chrome/152.0.7977.130`，比运行内核 `.167` 旧）触发旧策略清空 UA-CH，导致 `navigator.userAgentData.brands` 为空数组——空 brands 本身就是强「被伪造」信号。

- **CPU 与显卡配套**（`fingerprint-catalog.cjs`）：给每个候选显卡按型号判一个粗档 `gpuTier`（low/mid/high，未知归 mid），线程数从该档的池里选（low=[6,8]、mid=[8,12,16,20]、high=[16,20,24,28,32]，三池并集仍是原 8 个线程值）。这样低端/老显卡不会再配 24–32 线程，旗舰不会配 6 线程。显存沿用原逻辑（线程≤8 时 4/8GB，否则 8GB，浏览器本就把 `deviceMemory` 封顶 8）。屏幕与 DPR 这轮未按档位收口，仍从可容纳当前视口的池中等概率选取。
- **window.chrome 外观**（`fingerprint-inject.js`）：仅在窗口（Worker 没有 window.chrome 不处理）补齐 `chrome.app`、`chrome.csi()`、`chrome.loadTimes()`，取值来自本页 `performance` 计时保持自洽，函数的 `toString` 经 `sources` 表返回原生样式字符串，`name`/`length` 与原生一致。`chrome.runtime` 在普通网页本就缺省，不添加。
- **自定义 UA 的 UA-CH 推导**（`fingerprint.cjs` `customMetadata` + `environment.cjs` 接线）：旧策略对任何自定义 UA 直接清空 UA-CH（空 brands）。改为对 Chrome-on-Windows 的自定义/漂移 UA，从 UA 自身的 `Chrome/<major>.<full>` 推导 brands（Chromium 项取 major）与 fullVersionList（Chromium 项取 full），复用原生 GREASE 项、`platform`/`architecture` 等 OS 字段并置 `platform:'Windows'`、`mobile:false`、`model:''`。这样页面的 UA 串、brands、fullVersionList 自洽；仅 full（patch）版本可能与 Service Worker 原生 UA-CH 相差一个补丁号，远比空 brands 隐蔽。非 Chrome / 非 Windows / 缺原生 metadata 的自定义 UA 保持旧的清空行为。注意：运行中的 `5daf8c3` 版本尚无此逻辑，需重启主进程后生效；对已保存旧 UA 的实例，也可直接清掉自定义 UA/平台改回原生元数据（见验证记录）。
- 验证：`tests/fingerprint.test.cjs` 的 2000 种子用例新增配套断言（每个计划的线程数必须落在所选显卡档位的池内，0 例不合理；8 个线程值仍全部出现）；新增 `customMetadata` 用例（漂移 UA 推导出版本匹配的非空 brands、更旧 major 反映到 brand 版本、非 Chrome/非 Windows/缺 metadata 返回 null）；独立 Electron 探针确认运行时 `window.chrome.{app,csi,loadTimes}` 存在且 `toString` 为原生样式、低端显卡（GT 625）配 6 线程。`fingerprint-contexts` / `fingerprint-electron` 的首阶段通过；其 fresh-process-restart / 第二阶段在本机因自定义 HTTPS 主机连接被拒而超时，去掉本次改动后同样复现，属既有环境问题，与本修改无关。

## 已知限制与内核后续

- 字体、媒体设备、语音、WebGPU、完整 WebGL 能力、TLS 均未因导入库而改动。实测发现：宿主已装的 SAPI 语音会按真实系统语言暴露（例如中文 Windows 只有 `Microsoft Huihui/Kangkang/Yaoyao` 中文语音），与伪装的 en-US 出口不一致；伪造一份可用的英文语音列表风险较高（`speechSynthesis.speak` 实际不可用会成为新破绽），留待内核或专项处理。`navigator.languages` 目前只有单个地区码（如 `["en-US"]`），真 Chrome 默认带回退项（`["en-US","en"]`），这轮未改（改动会波及多个 Worker 语言一致性的 Electron 用例）。
- 主页面、同源 iframe、跨站独立进程 iframe、Dedicated Worker、网站 Service Worker 和受测 SharedWorker 的所测设备字段及 OffscreenCanvas PNG 导出已对齐，见下节。bitmaprenderer 导出和完整 GPU 能力等不完整覆盖，不能宣称所有上下文完全一致。
- 当前 Electron 44.4.5 的原生对照和库实例在受控 HTTPS 上均未发送 `Sec-CH-UA-*` 请求头；页面 `navigator.userAgentData` 与 UA 版本一致。不能把 JS 元数据验证写成 HTTP Client Hints 已完整支持。[该版本 Electron 源码](https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_browser_context.cc) 的 `GetClientHintsControllerDelegate` 返回空指针，相关支持需在内核阶段实现。
- UA 字符串报 `Chrome/<版本>`，但 `navigator.userAgentData` 的 brands / fullVersionList 只有 `Chromium`（加 GREASE 项），缺 `Google Chrome` 品牌，这是「是 Chromium/Electron 不是 Chrome」的直接信号。空 brands 的子问题（自定义/漂移 UA 触发清空）已由上节 `customMetadata` 修复——brands 不再为空，但仍只有 Chromium + GREASE。补 `Google Chrome` 这轮仍未做：页面可用 CDP `setUserAgentOverride` 的 `userAgentMetadata` 加上 Google Chrome，但 Service Worker 走的是 preload（不下发 metadata 覆盖），只改页面会造成「页面有 Google Chrome、SW 没有」的跨上下文不一致（项目自有的上下文一致性测试会据此判失败）。要一致需要让每个上下文（含 SW 和 Sec-CH-UA 请求头）都带 Google Chrome，与上一条同属内核阶段。
- 第三方采样中的 Canvas/音频数值不通用，沿用千面现有固定种子扰动，不导入其签名或私有算法。

## 2026-10-21 上下文一致性与 API 行为修复

私有调试管道不应使正常手动浏览变成 webdriver=true。本次在普通启动层禁用管道附带的 AutomationControlled 特征，保留原生 webdriver getter；显式 automation / headless 启动保持调用者意图。页面、跨站 iframe 首段、外部 CDP 连接和重启均有回归断言。真实检测页的非交互验证已恢复服务端 PASS，托管验证等待点击，详见 [验证记录](VERIFICATION.md)。

- iframe / Dedicated Worker 继续由实例页面 CDP 附着。SharedWorker 首段使用应用启动时建立的 Browser 级私有 CDP 管道；只按 Chromium `browserContextId` 关联实例会话，暂停目标后设置原生 UA、语言、时区与注入脚本，再恢复首段执行。Windows x64 专用命名管道本身不监听 TCP；开启外部 CDP 时，由本机网关监听原配置端口并复用该管道，不另开 Chromium TCP 端口。外部附着事件、恢复执行及父会话分离会等待环境初始化，避免 Playwright 提前恢复 SharedWorker。只覆盖网站 Worker，不覆盖扩展 Worker。
- 网站 Service Worker 使用本会话的主世界预加载。CDP 在其启动暂停阶段的 Runtime / Emulation 命令不响应，因此不再将它挂在这条等待链路中。切换环境（含仅时区变化）或开关指纹覆盖时停止旧网站 Worker，保留注册和持久化网站数据。扩展 Service Worker 不执行此覆盖。
- 透明 Canvas 不加噪，色值不从 255 环绕为 0；保留原生 receiver、参数转换和异常。OffscreenCanvas 的 2D 读取和 `convertToBlob` 使用相同固定种子规则。导出先调用原生方法校验原画布，再同步保存加噪副本；原生错误不会变成成功。编码选项只读取和转换一次，源画布不被修改。
- OffscreenCanvas 通过弱引用映射记录已获取的绘图上下文，保留 sRGB / Display P3 和 unorm8 / float16；浮点像素使用归一化噪声，不按字节直接加 1。无上下文、未记录上下文或 bitmaprenderer 等无法可靠克隆的情况保留原生结果，不为了导出而改变源画布的上下文类型。该兜底不保证导出噪声覆盖。
- 不再覆写 `AudioBuffer.getChannelData`：原生引用、手动写入、`copyFromChannel`、空白缓冲均保留。固定种子噪声仅作用于 OfflineAudioContext 渲染结果；在构造时登记完成事件处理，确保页面先注册的事件、返回 Promise 和拷贝读取一致，静音保持零。
- WebGL 先执行原生查询，再覆盖已启用调试扩展所允许的厂商/渲染器字符串；保留未启用扩展的 null / INVALID_ENUM、非法 receiver 的 TypeError 和参数只转换一次。空元素矩形不偏移。

实际验证入口：`npm.cmd run test:fingerprint-contexts`。独立临时 profile、本机受控 HTTPS、两个并发实例，记录首段脚本读数、跨站进程隔离、导航、实例重启、全新进程重启及配置开关切换。检查 UA / 平台 / CPU / 内存 / 语言列表 / 时区 / GPU，生成库方案的 JavaScript UA-CH 和 OffscreenCanvas PNG 字节也与主页面比对。

`npm.cmd run test:fingerprint-offscreen` 单独对照原生与覆盖后的真实导出：PNG / JPEG / WebP、质量与无效 MIME、参数 getter 顺序和次数、调用时快照、透明像素、非法 receiver、零尺寸、转移/分离、DOM 所有权及跨域污染错误。另测页面/Worker 相同输出、DOM 画布转移到 Worker、色彩空间/浮点精度和网站替换辅助方法。为保留原生校验，正常加噪导出会额外编码副本；大画布高频导出有额外 CPU 和瞬时内存开销，未做长期负载验收。

报告中的 `passed` 和 `complete` 只表示该夹具定义的断言通过，`boundaries` 记录夹具发现的差异；不是所有指纹能力完整覆盖的证明。测试不读取或修改真实用户实例；未用第三方注册/验证码成功率作为结果，也未宣称对任意自定义 UA 和所有检测站完整覆盖。当前只在 Windows x64 / Electron 44.4.5 的隔离场景实测。

SharedWorker 使用 Chromium Browser target 的 `Target.setAutoAttach`，通过 Windows 命名管道传入私有调试句柄。隔离测试在 Worker 顶层第一条脚本立即采样，检查注入标记和 UA / CPU / 语言等字段，并覆盖两个实例、环境切换、实例重启、全新进程重启、初始化失败恢复，以及外部 Playwright 持续连接。该底层启动通道仅当前 Windows x64 构建提供；缺失或校验失败时应用会明确报错。尚未在 macOS/Linux、扩展 Worker、所有 WebGL/GPU 能力或第三方风控结果上验证。

`npm.cmd run test:cdp-workers` 使用正式 `main.cjs`、临时数据、本地 API 和两个真实 Playwright 客户端：比对 SharedWorker 第一条脚本的 UA / 平台 / CPU / 内存 / 语言 / 时区，以及后续 UA-CH；验证按 targetId 选择实例、Cookie / localStorage 隔离、长命令、断开重连、F12 共存、配置持久化、正常退出和全新进程重启。UA 使用运行中 Browser.getVersion 的真实 Chromium 版本，不使用 Node 宿主的 Chrome/0.0.0.0 占位值。

前序回归另包含 `test:fingerprint-electron`、`fingerprint-tostring-electron.cjs`、`test:extension-debugger-electron` 和 `test:devtools-electron`，验证生产保存流程、停用、扩展调试事件、Worker 与开发者工具兼容。本次外部 CDP 修复重跑了后两项；加载新主进程和实例后才会生效，源码修复尚未发布。

### 网页脚本兼容性加固（2026-10-21）

注入内部的弱引用映射、参数转换、噪声计算、构造和布局调用使用启动时保存的原生方法。网页后续替换 WeakMap / WeakSet、Math、Reflect、部分构造器和 Function.apply 时，不会再让浏览器 API 意外执行网页辅助方法或抛出额外错误。此优化保留固定种子、已有用户配置和网页自己的方法替换，不等于实现了原生指纹内核。

`node scripts/launch-electron.cjs tests/fingerprint-tostring-electron.cjs` 比较未注入基线与生产注入：页面和 iframe 各 19 项、Dedicated Worker 14 项，并保留描述符、非法 receiver、导航和停用回归。真实检测页非交互服务端 PASS，托管模式仍需点击；没有证据证明本次修改提高免点击通过率。原生 HTTP Client Hints、GPU 能力和 Chrome API 差异继续按已知限制处理，不能直接填入假数据。

## 2026-10-15 视口修复验证

### 2026-10-21 自适应视口不超过模拟屏幕

当实例开启硬件屏幕覆盖且使用自适应视口时，浏览器窗口/DPI 产生的实际网页视口若大于配置的模拟屏幕，超出的宽、高轴会分别限制到屏幕值；窗口较小时仍使用原生自适应尺寸。此处只限制网页布局视口，不缩小页面文字、不改变 Chromium 缩放或保存的实例尺寸；DPR 按实例配置保留。固定视口继续使用原来的等比适配，宫格视口也受模拟屏幕边界约束。

`npm.cmd run test:viewport-screen` 使用独立临时配置与本机页面，验证 1600×1000 窗口下 1280×720 模拟屏幕、自适应小窗口、DPR 1.25、真实右下角鼠标输入、窗口缩放后的输入内容/文档身份保留，以及宫格尺寸。报告位于 `%TEMP%\\facet-viewport-screen-*\\result.json`。这项尺寸一致性修复不证明任意验证码/风控网站会通过，也没有重启用户正在运行的实例；源码改动需重启应用后生效。

公开 v0.2.13 的整套随机曾将随机屏幕宽高填入实际视口。1050 像素宽的浏览区域遇到 3840×2120 视口时，生产适配逻辑缩至约 27%，已在隔离 Electron 中复现。当前源码默认生成 0×0 自适应，保留显式固定尺寸；不自动改写旧实例。

`node scripts/launch-electron.cjs tests/random-viewport-electron.cjs` 已验证：自适应 DPR 2、抽到 4K 屏幕的整套方案、手动固定 4K 三种情况的实际视口、显示比例及 iframe 鼠标点击。13 项指纹单元测试、真实指纹 UI 保存/新建/跨进程读取、4 项环境重置回归和必需基础检查通过。真实网站验证码点击失败尚未复现，不能据本机 iframe 点击成功宣称验证码问题已修复。

## 验证与维护

```powershell
npm.cmd run check
npm.cmd run test:fingerprint
npm.cmd run test:fingerprint-electron
npm.cmd run test:fingerprint-contexts
npm.cmd run test:fingerprint-offscreen
npm.cmd run test:control-api
npm.cmd run test:instance-reset-electron
node scripts/launch-electron.cjs tests/instance-batch-electron.cjs
git diff --check
```

单元回归含 2,000 个种子的取值、组合、可复现、异常字段与旧预设兼容检查。真实 Electron 回归使用独立数据目录和本机受控 HTTPS，验证生产界面填表/保存、页面与同源 iframe、两个并发实例、Canvas/音频跨停止重启稳定、磁盘持久化及第二个全新 Electron 进程读取。测试报告主动保留 Worker 和请求头限制。

本次还通过了 216 个脚本语法/边界检查、控制 API、13 项工作区回归、3 项打包配置检查、真实单项/批量重置及 32 个实例的真实批量创建回归。未构建新安装包、未测试所有公网检测站。

旧 `test:electron` 全量脚本未通过：它在启动实例前等待运行标签，与当前仅显示运行实例的标签规则冲突；临时调整该测试等待条件后前 7 项通过，随后本机订阅夹具被现有公网下载限制拒绝。`instance-tabs-random-electron.cjs` 同样在实例停止时等待 8 个运行标签。未为跑旧测试放宽生产下载限制，临时调整与自动生成报告已恢复原样；这两项不能记录为全量通过。新增专项通过真实新建入口验证了库方案草稿和保存。

重建候选库使用 `scripts/import-fingerprint-catalog.cjs <新输出JSON> <来源JSON...>`。只读 JSON，不执行来源脚本；已有输出会拒绝覆盖。先比较统计与 diff，再替换产品库并回归，不能把完整原始配置拷入仓库。

## 回滚

代码修改前检查点：`0a4487c`。此次文件和当时的未提交文档/草稿另存于任务报告中的备份目录。优先撤销本次功能提交，保留其他未提交工作；不要用 `git reset --hard` 清掉它们。

恢复到不认识 `library-v1` 的旧软件前，先备份实际数据目录。新方案的字段可保留，通过当前界面将设备预设标识切为“自定义”并保存，再使用旧软件；旧版本能读取这些既有字段。只切换标识，不重新填入方案。涉及环境重置时，代码回滚不能找回已清除的网页数据。

## 注入函数的 toString 兼容性（源码修改，尚未发布）

2026-10-15：硬件 getter、Canvas、WebGL、Audio 和 ClientRects 的 JS 覆盖使用原函数作为 Proxy target，保留 name、length 和是否可构造；当前页面上下文的 Function.prototype.toString 仅对已注册替换返回原函数文本。其他函数和无效 receiver 仍交给原生实现。硬件 getter 同时保留原生 receiver 校验。

验证入口：`node scripts/launch-electron.cjs tests/fingerprint-tostring-electron.cjs`。使用独立临时数据和本机 HTTP 页面，对比未注入基线，检查函数/属性描述、非法调用、同源 iframe、跨上下文借用、重复注入、导航和关闭注入；实际执行 Canvas PNG/Blob、音频读取、布局和点击。

边界：这不是内核改造，也不保证无法检测。跨上下文借用 toString 时可能显示原生 Proxy 的匿名函数文本，而不是带名称的原生函数文本。本节历史测试主要覆盖页面；后续 Worker 的字段验证见 2026-10-21 节，SharedWorker 和第三方风控判定仍不在已修范围内。已运行实例需在加载新版主进程后重新启动才使用新注入脚本。
