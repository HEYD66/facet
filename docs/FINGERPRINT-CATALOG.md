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
- API `fingerprint-preset` 的 `preset` 可用 `library-v1`；`random` 保留原有浏览尺寸保护，额外传 `randomScreen:true` 时同时随机屏幕和像素比。输入/输出继续走环境校验。

当前版本生成的 Windows UA 与运行内核一致时，保留原生 Windows UA-CH 数据；显式编辑 UA/平台或旧版本 UA（如实例保存的 UA 在内核升级后落后于运行版本）时，`customMetadata` 从该 UA 自身的 `Chrome/<版本>` 推导 brands 与 fullVersionList，并复用原生 GREASE 项与 OS 字段，让页面的 UA 串、brands、fullVersionList 自洽；非 Chrome 或非 Windows 的自定义 UA 仍沿用清空 UA-CH 的旧策略。关闭参考覆盖后恢复原生方案。

## 2026-10-26（二）多账号审计反馈：音频、窗口尺寸、高端显卡配小屏（源码修改，未发布）

起因：用户转来一份 6 个账号的对比审计，指出音频指纹 6 个完全相同、`outerWidth/outerHeight` 全部 1454×969 且大于部分账号的屏幕、RTX 5060 Laptop 配 1366×768，以及字体列表 6 个相同。

- **音频指纹**（`fingerprint-inject.js`）：旧噪声每个声道只改动一个采样（位置在前 97 个采样内），而常见音频指纹取第 4500–5000 个采样的绝对值之和，所以所有实例都报同一个 `124.04347…`。现在按种子给离线渲染结果的每个非零采样乘一个固定增益（相对 1e-6～1e-5），这个和从小数点后第 4～5 位开始因实例而异；同一实例重复渲染结果不变，静音仍为 0，`getChannelData`/`copyFromChannel`/事件与 Promise 读到同一份数据。实测两个种子分别为 `124.04280434999964`、`124.04240644474339`，各自两次渲染一致。
- **窗口尺寸**（`fingerprint-inject.js` + `viewport.cjs`）：`window.outerWidth/outerHeight` 是千面主窗口的真实尺寸，模拟屏幕小于主窗口时会大于 `screen.width`/`availHeight`。开启硬件覆盖时，这两个值不超过模拟屏幕的可用区域（相当于最大化窗口），窗口更小时仍按真实尺寸跟随缩放；跨站 iframe 读到的值相同。网页显示区域的高度同时限制为可用高度减 80（浏览器标签栏与工具栏的位置），保证 `innerHeight < outerHeight`。实测模拟 1366×768（可用 728）、主窗口 1454×969 时：outer 1366×728、inner 1226×648；模拟 2560×1440 时 outer 保持真实 1456×972。`screenX/screenY` 和鼠标事件坐标不改，避免主页面与跨站 iframe 的屏幕坐标不一致（#10 的人机验证问题）。
- **高端显卡配小屏**（`fingerprint-catalog.cjs`）：high 档屏幕物理分辨率至少 1920×1080，不再配 1280×720、1366×768、1440×900、1600×900。
- **未解决：字体**。字体列表来自宿主机，按测量文字宽度检测，网页 JS 无法在不破坏排版的情况下隐藏已安装字体；中文系统上的 SimHei、KaiTi 等会出现在所有实例里。需要内核层的字体过滤，记入已知限制。
- **未解决：同一主窗口里的实例窗口尺寸相同**。屏幕大于主窗口的实例，outer/inner 都等于主窗口及其浏览区域的尺寸，各实例相同。需要区分时可给实例设置不同的固定视口。

## 2026-10-26 DPR 精度、原生 UA 应用名与老显卡配套（源码修改，未发布）

- **devicePixelRatio 精度**（`fingerprint-inject.js`）：模拟 DPR 时主页面读到 `1.0000000149011612`、`1.5000000596046448`、`2.0000000298023224`（Chromium 按原生缩放 × 模拟/原生做 float32 运算），而 `resolution` 媒体查询匹配的是精确值；真实 Chrome 在 100% 缩放下报告精确值。现在与配置值相差不到 1e-6 的残差改回配置值，getter 的 `toString` 保持原生样式；其他取值（如页面缩放后）原样返回。只在开启指纹覆盖且设置了 DPR 时生效。
- **跨站 iframe 的 DPR 仍是原生值**：独立进程 iframe 不接收 `Emulation.setDeviceMetricsOverride`（实测对 iframe 目标返回「Command can only be executed on top-level targets」），DPR 与 `resolution` 媒体查询都按真实显示器（本机 1.25）。这里不改：只改 JS 读数会让 iframe 内的 DPR 与它自己的 CSS 媒体查询矛盾。模拟 DPR 与真实显示器不同的实例，主页面与跨站 iframe 的 DPR 会不同；彻底一致需要内核把模拟屏幕信息传给子框架，或者只使用与真实显示器相同的 DPR。
- **原生 UA 不再带应用名**（`environment.cjs` `nativeUserAgent`）：Electron 默认 UA 在 `Chrome/` 前插入应用名（`app.setName('千面 Facet')` 得到 `千面Facet/<版本>`，含非 ASCII），旧代码只去掉了 `Electron/<版本>`。未填写 UA 的实例现在报告纯 Chrome UA。原生值取自 `app.userAgentFallback`，不再取会话当前值：会话设过自定义 UA 后，清空 UA 在同一次运行里也能回到原生（旧代码会一直沿用旧的自定义 UA）。当前用户实例都保存了显式 UA，不受应用名问题影响；新建的原生环境实例会受影响。
- **老显卡配套**（`fingerprint-catalog.cjs`）：low 档线程池加入 4（Intel HD 2000–6000、AMD HD 7xx0G 时代的 i5-3210M、A8-4500M 等多为 4 线程），现为 low=[4,6,8]。low 档屏幕限制为物理分辨率不超过 2560×1600，不再配 3840×2160、1920×1080@2、2560×1440@1.5 或 3440×1440；mid/high 档不受限。选择顺序：先容纳固定视口，再满足显示器下限，最后按档位；后两者冲突时保留显示器下限，避免 1:1 页面四周留白。
- 验证：`tests/fingerprint.test.cjs` 2000 种子用例新增档位屏幕断言、UA 清理新增应用名用例；Electron 探针确认主页面 DPR 在 1 / 1.25 / 1.5 / 2 下为精确值且与媒体查询一致、跨站 iframe 保持原生；带真实应用名的实例原生 UA 与请求头均无应用名和 Electron 标记，设置自定义 UA 后再清空回到原生 `.167`。

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
- 字体：已安装字体按文字宽度可测，所有实例共用宿主机字体（中文 Windows 上含 SimHei、KaiTi、FangSong、MS Gothic 等），与美国等地区的账号不符，也会把同一台机器上的账号关联起来。网页层无法隐藏，需要内核层按实例过滤字体。

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

### 2026-10-26 网页始终 1:1 显示，不再缩放（issue #10）

此前窗口比模拟屏幕大时（如最大化），自适应页面会被等比放大铺满；固定视口比浏览区域大时、宫格「放大查看」时，页面会被缩小。缩放比例不为 1 时，真实鼠标事件的屏幕坐标与页面坐标对不上：主页面中 `screenX` 的变化是 `clientX` 的 1.14 倍（真实浏览器恒为 1），跨站 iframe 报出的屏幕位置也和它在页面中的位置相差 15–45 像素。在 `ip.net.coffee/cloudflare` 的 Cloudflare 托管验证上用系统真实鼠标实测：缩放 1 时点击一次即通过，1.145（最大化）和 0.829（固定视口大于窗口）时点击后一直停在「需要点击确认」，回到缩放 1 后再次通过。

现在正常浏览和宫格放大查看都按 1:1 显示（`viewport.cjs`）：

- 自适应视口：开启硬件覆盖时，网页区域不超过模拟屏幕，居中显示，多出的区域留空；未开启时随窗口自适应。
- 固定视口：浏览区域够大时按设定尺寸显示；不够大时随浏览区域变小，不缩小渲染。
- 宫格小格子仍是缩小预览，排版尺寸与正常浏览一致；点「放大查看」后按放大框尺寸 1:1 重新排版，可以正常点击验证框。
- 环境配置的「一键随机」默认仍保留当前屏幕和像素比；旁边新增「同时随机屏幕」勾选项（本机记住选择），勾选后一键随机也从设备库重新抽取屏幕与像素比，并开启硬件覆盖让网页读到它；手动固定的视口宽高仍保留，抽到的屏幕能容纳它。API `fingerprint-preset` 可传 `randomScreen:true` 实现同样效果。
- 整套随机（新建、批量、AI 随机、重置环境）只从不小于本机当前显示器的模拟屏幕中选择（`fingerprint-catalog.cjs` 的 `setDisplayProvider`，由 `main.cjs` 提供显示器尺寸）；显示器比库中所有屏幕都大或读不到时沿用完整候选池。这样最大化时不会出现「1280×720 模拟屏幕在 2048×1152 桌面上只占中间一块」的情况。已保存的旧实例不会自动重新随机；模拟屏幕比显示器小的旧实例，最大化后会看到边距，可重新随机。

已知限制：模拟 DPR 与显示器不同时，主页面的 `devicePixelRatio` 是带浮点误差的值（如 `1.0000000149011612`），跨站 iframe 里仍是显示器的真实值（如 `1.25`）。两者都与缩放无关，这次没有改。

### 2026-10-21 自适应视口不超过模拟屏幕

（已被 2026-10-26 的 1:1 显示取代：后来改为把视口限制到屏幕后再等比放大铺满窗口，这种放大会让验证框拒绝点击。）当实例开启硬件屏幕覆盖且使用自适应视口时，浏览器窗口/DPI 产生的实际网页视口若大于配置的模拟屏幕，超出的宽、高轴会分别限制到屏幕值；窗口较小时仍使用原生自适应尺寸。此处只限制网页布局视口，不缩小页面文字、不改变 Chromium 缩放或保存的实例尺寸；DPR 按实例配置保留。固定视口继续使用原来的等比适配，宫格视口也受模拟屏幕边界约束。

`npm.cmd run test:viewport-screen` 使用独立临时配置与本机页面，验证 1600×1000 窗口下 1280×720 模拟屏幕、自适应小窗口、DPR 1.25、真实右下角鼠标输入、窗口缩放后的输入内容/文档身份保留，以及宫格尺寸。报告位于 `%TEMP%\\facet-viewport-screen-*\\result.json`。这项尺寸一致性修复不证明任意验证码/风控网站会通过，也没有重启用户正在运行的实例；源码改动需重启应用后生效。

公开 v0.2.13 的整套随机曾将随机屏幕宽高填入实际视口。1050 像素宽的浏览区域遇到 3840×2120 视口时，生产适配逻辑缩至约 27%，已在隔离 Electron 中复现。当前源码默认生成 0×0 自适应，保留显式固定尺寸；不自动改写旧实例。

`node scripts/launch-electron.cjs tests/random-viewport-electron.cjs` 已验证：自适应 DPR 2、抽到 4K 屏幕的整套方案、手动固定 4K 三种情况的实际视口、显示比例及 iframe 鼠标点击。13 项指纹单元测试、真实指纹 UI 保存/新建/跨进程读取、4 项环境重置回归和必需基础检查通过。（当时真实网站验证码点击失败尚未复现；2026-10-26 已在 Cloudflare 托管验证上复现，原因是缩放显示，见上文。）

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
