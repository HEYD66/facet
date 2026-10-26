# 验证入口与历史记录
## 2026-10-27：宫格小格子里跨站 iframe 收不到点击和滚轮（源码未发布）
- 现象（用户反馈 + 实测）：arena.ai 的 HTML 预览在 `ws-*.arena.site` 跨站 iframe 中。用户的实例 2 在宫格小格子（缩放约 0.31）里，系统真实鼠标点击 1 次、滚轮 3 格，预览收到 0 次，全部落到外层网页；同一页面在放大查看（1:1）和正常浏览中预览都能收到。预览页本身 `overflow:hidden`、没有按钮，所以正常浏览里「点了没反应」是页面内容如此，不是输入问题。
- 探针：`before-mouse-event` 对每个渲染部件（包括跨进程 iframe）都会触发，坐标是该部件自己的坐标，连千面经 CDP 发给 iframe 的输入也会再触发一次，无法据此判断事件属于哪一层，因此没有采用。外层网页收到的、目标为 `<iframe>` 元素且落在其内容区的鼠标事件，正是 Chromium 没送进 iframe 的输入（送对时外层文档根本收不到）。
- 改动：`tile-input-preload.cjs` 在顶层框架的 isolated world 里、页面脚本之前注册捕获监听；只在小格子里拦下这类事件（页面自己的监听收不到，与送对时一致），报给主进程。`tile-input.cjs` 按 `DOM.getFrameOwner` / `DOM.getBoxModel` 找到对应的跨进程 iframe（外层报告的 `<iframe>` 矩形必须对得上），多层嵌套时逐层用 `DOM.getNodeForLocation` 确认未被遮挡，再用该 iframe 自己的 CDP 会话 `Input.dispatchMouseEvent` 送达（移动、按下、松开、滚轮；按下后拖出 iframe 仍送到原 iframe，离开时结束悬停）。`environment-contexts.cjs` 记录每个子会话的父会话。放大查看、正常浏览不受影响；被遮挡或 `pointer-events:none` 的 iframe 保持外层网页的行为。验证框在小格子里仍会拒绝点击（屏幕坐标是缩放后的），仍需放大后操作。
- 通过：`check`、全部单元测试（436 项：434 通过、1 项 POSIX 跳过；`node-network.test.cjs` 读取本机网卡超时 1 次，单独重跑 9/9 通过）、`test:control-api`、`git diff --check`；新增 `test:tile-input`（单元 6 项 + 真实 Electron：对照组确认合成输入在小格子里落到外层网页且目标是 `<iframe>`；修复后跨站、嵌套跨站、`transform: scale(0.8)` 容器内的 iframe 收到点击（落点误差 ≤3 CSS 像素，来自整数视图坐标）和 3/3 格滚轮，外层网页收不到也不滚动；悬停离开、拖出后松开；遮挡和 `pointer-events:none` 的 iframe 不转交；外层网页自身点击和滚轮不变；放大查看与正常浏览不转交任何事件）。真实 Electron（退出码 0）：`test:volume`、`test:grid`、`test:grid-transition-electron`、`test:viewport-bookmarks`、`test:browser-tabs`、`test:background-tabs-policy`、`test:minimized-rendering`、`test:fingerprint-contexts`、`test:cdp-workers`、`test:ai-browser`、`test:viewport-screen`（首轮桌面截图被其他窗口遮挡失败，单独重跑通过）。
- 隔离数据的真实千面（当前源码、2×2 宫格、小格子缩放 0.47）用系统真实鼠标对 7 种 iframe（跨站、sandbox srcdoc、blob、嵌套跨站、scale(0.8) 容器内、Service Worker 提供、右下角固定）各点 1 次、滚 3 格：全部收到 1 次点击和 3 格滚轮，没有重复送达，外层按钮也正常；这一环境里 Chromium 自己把点击和滚轮送对了，只有 6 次移动落到外层由千面转交。放大查看与正常浏览没有转交任何事件（`.local-dev/iframe-input-20261026/probe-tile-real-mouse.cjs`）。
- 用户真实千面复测（按新代码重启，实例 2 的 arena.ai HTML 预览，系统真实鼠标点击 1 次、滚轮 3 格）：小格子（383×235 显示 1226 宽页面，约 0.31）预览收到 pointerdown 1、click 1、wheel 3，外层网页 0（修复前预览 0、外层 1/1/3）；放大查看预览 1/1/3、外层 0。小格子落点与目标差约 10 CSS 像素（按两次光标位置换算，格子里 1 屏幕像素约等于 3.2 CSS 像素）。重启后节点一度连不上 arena.ai（经本机节点端口 curl 退出码 35），网络恢复后才完成复测。

## 2026-10-26：AI 约 5% 就压缩的来源核对；音频指纹、窗口尺寸、高端显卡配小屏（源码未发布）

- AI 压缩：v0.2.21 在每个任务开始前由千面自己压缩记忆，条件是要附上的历史超过 48000 字符且至少 3 轮，和上下文窗口无关；`deepseek-flash` 自动按 1M 窗口计算，48000 字符约占 2%～5%。同一探针（隔离数据、本机协议夹具、模型名 `deepseek-flash`、每个任务读取一次长网页，共 8 个任务）对比：v0.2.21 工作树在第 5、7 个任务各发一次压缩请求，当时圆环 1.7%～2.2%；当前源码（`a28aff2` 起由 DSH 管理会话历史）8 个任务没有压缩，圆环随对话增长到 3.8%，DSH 在约 80% 时才压缩。本机用户数据最后一次使用 AI 是 10-23，未运行过新代码；修复需要随下个版本发布。
- 音频指纹：旧噪声只改每个声道前 97 个采样中的一个，常见指纹（第 4500–5000 个采样绝对值之和）不受影响，所有实例都是 `124.04347…`。改为按种子对所有非零采样乘固定增益（相对 1e-6～1e-5）。探针：两个种子 `124.04280434999964`、`124.04240644474339`，各自重复渲染一致。
- 窗口尺寸：开启硬件覆盖时 `outerWidth/outerHeight` 不超过模拟屏幕的可用区域，网页高度限制为可用高度减 80。探针（主窗口 1454×969）：模拟 1366×768 时 outer 1366×728、inner 1226×648，跨站 iframe 相同；模拟 2560×1440 时 outer 保持真实 1456×972。getter `toString` 为原生样式。
- 生成器：high 档显卡屏幕物理分辨率至少 1920×1080。
- 未解决：字体列表来自宿主机，网页层无法隐藏（需内核）；屏幕大于主窗口的实例 outer/inner 仍与主窗口一致。
- 通过：`check`、全部单元测试（430 项，429 通过、1 项 POSIX 跳过）、`test:control-api`、`git diff --check`；真实 Electron（退出码 0）：`test:viewport-screen`、`test:instance-reset-electron`、`test:grid`、`test:viewport-bookmarks`、`test:fingerprint-electron`、`test:fingerprint-contexts`、`test:fingerprint-offscreen`、`test:browser-tabs`、`fingerprint-tostring-electron.cjs`、`random-viewport-electron.cjs`。`viewport.test.cjs`、`viewport-screen-electron.cjs`、`instance-reset-electron.cjs` 的高度断言按新的工具栏余量更新。

## 2026-10-26：DPR 精度、原生 UA 应用名、老显卡配套与两项测试修复（源码未发布）

- DPR：模拟 DPR 时主页面 `devicePixelRatio` 为 `1.0000000149011612` 等 float32 残差，`resolution` 媒体查询却是精确值。注入脚本把相差不到 1e-6 的残差改回配置值（`fingerprint-inject.js`）。探针（本机显示器 1.25，`localhost` 跨站 iframe 为独立进程）：配置 1 / 1.25 / 1.5 / 2 时主页面读数精确、与媒体查询一致，getter `toString` 为原生样式。跨站 iframe 仍报原生 1.25（DPR 与媒体查询都是），对 iframe 目标发送 `setDeviceMetricsOverride` 被 Chromium 拒绝，属内核限制，未改。
- 原生 UA：`app.setName('千面 Facet')` 后 Electron 默认 UA 含 `千面Facet/<版本>`，旧的清理只去掉 `Electron/<版本>`；会话设过自定义 UA 后清空也回不到原生。现在原生 UA 取自 `app.userAgentFallback` 并去掉两段标记（`environment.cjs` `nativeUserAgent`）。探针（带真实应用名）：原生、设为 `.130`、清空三次启动，页面 UA 与请求头依次为纯 `.167`、`.130`、纯 `.167`。用户现有 16 个实例都保存了显式 UA，不受应用名问题影响。
- 老显卡：low 档线程加入 4，low 档屏幕限制物理分辨率不超过 2560×1600（`fingerprint-catalog.cjs`）；显示器下限优先于档位。
- 测试修复：`test:viewport-bookmarks` 仍按 #10 之前的缩放适配断言固定视口宽 1760，改为 1:1 呈现后的实际尺寸和角落点击（这项自 `9f95925` 起失败，当时未跑）。`test:fingerprint-electron`、`test:fingerprint-contexts` 第二阶段的 ERR_CONNECTION_REFUSED 不是环境问题：实例启动时恢复保存的网页标签，仍打开上一阶段已关闭的端口；测试改为同时更新保存的标签。`fingerprint-contexts` 第三阶段的外部 CDP 端口在 40000–60000 随机选取，本机部分端口无人监听却 listen 报 EADDRINUSE，改为向系统申请空闲端口。
- 通过：`check`、全部单元测试、`test:control-api`、`git diff --check`；真实 Electron（退出码 0）：`test:fingerprint-electron`（两阶段）、`test:fingerprint-contexts`（三阶段）、`test:viewport-bookmarks`、`test:viewport-screen`、`test:grid`、`test:fingerprint-offscreen`、`test:devtools-electron`、`test:instance-reset-electron`、`test:browser-tabs`、`fingerprint-tostring-electron.cjs`、`test:cdp-workers`。
- 未验证：没有在真实检测站复测 DPR 与 UA 改动；跨站 iframe 的 DPR 一致性需要内核改动或只用与真实显示器相同的 DPR。

## 2026-10-26：AI 会话改为 DSH 持久 Session（源码未发布）

- 起因：上一条用自写的「较早任务精简 + 任务开始前记忆摘要」缓解压缩过频，仍是千面自己拼历史、DSH 只能压缩当前任务。改为参照 DSH 官方宿主（server / session-controller）：每个会话对应一个长期 Session，任务通过 `ctx.agents.resume` 恢复后追加一轮，历史、中断收尾（`interruptedTurnClosers`）、`tool-result-pruner` 和 `compaction-basic` 全部由 DSH 处理，压缩覆盖之前所有任务。
- 存储：新增 `ai-dsh-store.cjs`，实现官方 `dsh-session-persistence` 接口（create / open / stat / list / flush，句柄 read / append / flush / close，`session/event`、`session/flush`、`session/disposed` 实时写入路由，200 ms 批量窗口）。每个 Session 一个只追加文件，每行一段 safeStorage 密文并同步落盘；残缺尾行下次写入前截掉，完整行损坏则拒绝打开且不改原文件。
- 移除：`prefix()` 历史拼接、`memory.compress`、较早任务精简、`compactTurn`、`ai-finish.cjs`、`interruptedHistory`。轮数上限停止后的说明改为 DSH 中一轮不带工具的回复（20 秒超时，失败用千面的停止说明），停止 / 失败 / 关闭中断改为下一任务开始时注入一条系统说明。
- 迁移：旧版 `sessionsVersion:1` 会话读取时另存 `ai-conversation.json.pre-dsh.bak`，旧记忆在该会话下一次任务时整理成一条「之前的对话（迁移自旧版本，不可信资料）」注入一次；旧图片不迁移。新版写入 `sessionsVersion:2`，旧版本程序无法读取新文件，回退需用备份。
- 取舍：同一会话的历史不再按实例范围拆分，授权仍按每次任务的范围由工具检查（`test:ai-memory` 中 NARROWED_CONTEXT / RESTORE_SCOPE 改为验证这一点）。
- 通过：`check`、全部单元测试（新增 `ai-dsh-store.test.cjs`：真实 DSH 跨上下文恢复、注入顺序、取消后续接、残缺尾行修复、损坏拒绝、密文；删除 `ai-memory.test.cjs` 与 `compactTurn` 用例）、`test:control-api`、`git diff --check`；真实 Electron（退出码 0）：`test:ai-dsh`（两进程，重启后在同一 Session 继续并带停止说明）、`test:ai-memory`（六个独立进程：16K 窗口下 4 个任务触发 2 次 DSH 压缩、重启后摘要与图片仍在、强制退出后 DSH 关闭未完成的工具调用、清空删除 Session 文件）、`test:ai-sessions`（旧格式迁移一次、三个独立 Session、删除会话删除文件）、`test:ai-stop`、`test:ai-recovery`、`test:ai-agent`、`test:ai-browser`、`test:ai-plugins`、`test:ai-panel`、`test:ai-capabilities`。
- 未验证：没有用真实模型和用户的真实长会话复测压缩频率；没有在用户数据目录上实测迁移（测试用隔离目录构造旧格式文件）。

## 2026-10-26：AI 压缩过于频繁、一键随机可选随机屏幕、AI 滚动后点 iframe（源码未发布）

- AI 上下文压缩过于频繁：前几个任务的完整记录（含网页快照、全文等长工具结果）会附在新任务每次请求前面，DSH 只能压缩当前任务，导致长对话里新任务一开始就接近压缩线、几乎每步都压缩。改为发送前精简较早任务的长工具结果（较早任务超过 1200 字保留首尾约 1100 字，最近一个任务超过 4000 字保留约 3500 字；用户与助手文字不删，本地记录不变），记忆压缩按实际要发送的量判断，小窗口模型更早压缩（`ai-memory.cjs`）。没有用真实模型和真实长会话复测压缩次数，只验证了发送内容与触发条件。
- 一键随机可选随机屏幕：环境方案栏「一键随机」旁新增「同时随机屏幕」（本机记住），勾选后一并抽取屏幕和像素比并开启硬件覆盖；不勾选保持原行为。API `fingerprint-preset` 可传 `randomScreen:true`。
- AI 在页面远距离滚动后点击跨站 iframe 会落到外层页面：把 iframe 滚回视野后立即发送鼠标事件，浏览器仍按旧画面路由。改为先等新帧呈现再量坐标（`ai-browser.cjs` `locate`）。这个问题此前被「缩放时改用脚本点击」掩盖，#10 改为 1:1 后暴露。
- 通过：`check`（356 脚本）、全部单元测试 430 项（429 通过、1 项 POSIX 跳过、0 失败，新增 `ai-memory.test.cjs` 与随机屏幕用例）、`test:control-api`、`git diff --check`；真实 Electron（退出码 0）：`test:ai-browser`（新增远距离滚动后点 iframe 的回归）、`test:ai-memory`、`test:ai-agent`、`test:ai-plugins`、`test:ai-dsh`、`test:instance-reset-electron`；环境页「同时随机屏幕」界面探针（默认保持屏幕、勾选后屏幕随机变化、选择被记住）。
- 未通过但与本改动无关：`test:fingerprint-electron` 第一阶段通过，第二阶段本机自建 HTTPS 夹具 `ERR_CONNECTION_REFUSED` 超时；暂存本轮改动后在原代码上同样复现。

## 2026-10-26：网页 1:1 显示，修复缩放后点不了人机验证（issue #10；源码未发布）

- 现象：issue #10（最大化后页面放大约 10%，验证框和网页预览点不了），以及用户反馈的「宫格放大后点不了验证框」「固定比例要全屏或最大化才能点」「重置环境后像是 1280×720」。
- 根因（实测）：窗口比模拟屏幕大时页面被 `Emulation.setDeviceMetricsOverride` 的 `scale` 放大，固定视口比浏览区域大或宫格放大时被缩小。缩放不为 1 时，主页面点击的 `screenX` 变化是 `clientX` 的 1.14 倍（真实浏览器恒为 1），跨站 iframe 报出的屏幕位置与页面位置差 15–45 像素；缩放为 1 时完全一致。可见性检测（IntersectionObserver v2）和点击落点在各缩放下都正常，已排除。
- 修复前，`ip.net.coffee/cloudflare` 的 Cloudflare 托管验证，系统真实鼠标点击：缩放 1 通过；最大化（1.145）不通过；还原（1）通过；固定视口 1266×626（0.829）不通过；最后再测缩放 1 仍通过，排除 IP 被逐步拉黑。
- 修复后同一流程：小窗、最大化（网页区域限制为 1600 宽、居中）、还原、固定视口、再测，5 次全部点击后通过；宫格放大查看通过；宫格小格子（0.95 缩放预览）仍不通过，属已知限制，需放大后操作。
- 改动：`viewport.cjs` 正常浏览与宫格放大始终 `scale:1`，网页视图限制在模拟屏幕或固定视口内并居中，布局尺寸按视图显式下发；`controller.cjs` 按呈现边界摆放视图，宫格放大格子 1:1；`grid.js` 标记放大格子；`fingerprint-catalog.cjs` 整套随机只选不小于本机显示器的模拟屏幕（`main.cjs` 提供显示器尺寸）；界面说明文字同步。
- 通过：`check`（355 脚本）、全部单元测试 427 项（426 通过、1 项 POSIX 跳过、0 失败）、`test:control-api`、`git diff --check`；真实 Electron（退出码 0）：`test:viewport-screen`、`test:instance-reset-electron`、`test:ai-browser`、`test:grid`、`test:grid-transition-electron`、`test:browser-tabs`、`test:background-tabs-policy`、`test:minimized-rendering`、`tests/random-viewport-electron.cjs`。用例按新行为改写：视图限制在屏幕内并居中、布局视口等于视图、缩放恒为 1、固定视口跟随较小的视图、宫格放大 1:1、跨站 iframe 收到真实点击。
- 已知限制：模拟 DPR 与显示器不同时，主页面 `devicePixelRatio` 带浮点误差（如 `1.0000000149011612`），跨站 iframe 里是显示器真实 DPR，与缩放无关，未改。旧实例的模拟屏幕若比显示器小，最大化后会看到边距，可重新随机。复测使用本机代理出口，结果受出口 IP 影响，不代表所有网站和网络都能通过。
- 正在运行的应用需重启主进程后生效。原始日志和截图在 Git 忽略的 `.local-dev/issue10-20261026/`。

## 2026-10-25：v0.2.21 发布准备与打包验收（未推送、未发布）

- 内容：纳入 `5daf8c3`、`c02c49a`、`21c2ff4` 的显卡档位/CPU 组合、网页 `window.chrome` 接口、自定义 Chrome UA 的 UA-CH 修复及必应新标签页；应用与锁文件版本升至 0.2.21。未继续修改已记录的老核显组合及会话 UA 回退问题，也未改写已有实例。
- 本轮基础门禁：`npm.cmd run check`（355 个脚本）、`npm.cmd run test:control-api`（1/1）、指纹/标签状态/更新/打包专项单元测试（37/37）、`git diff --check` 通过。`test:browser-tabs` 的 4 项单元及两个独立真实 Electron 阶段通过，覆盖新标签入口、最后一页补开、存储隔离和重启恢复；默认网址在测试中指向本机夹具，不以此证明公网必应可达。
- 构建：复用校验通过的固定 Electron、Mihomo、进程保护和环境管道组件，执行 `node scripts/build-installer.cjs`。安装包 `Facet-Setup-0.2.21-x64.exe`，131,088,438 字节；SHA256 `2177f4016a62a1e1896947757d629bc78066ee172cc991ea44906c8333eaa618`。安装包、blockmap、latest.yml 和 .sha256 四件套齐全且校验一致。
- 包内核验：165 个应用源码文件逐一比对一致；38 个顶层生产依赖均存在；外置 22 份文档与明确白名单和当前内容一致；其他资源与许可证比对一致。包内未发现本地交接、开发验收记录或未接线的订阅代理草稿。新增文本的高置信凭据模式扫描无命中，不代表对所有形式的敏感信息做出完备保证。
- 真实打包程序验收：完整解包目录复制到没有低完整性标签的临时目录，Facet.exe 与 app.asar 的 SHA256 均和构建输出相同；`npm.cmd run test:installed -- <隔离副本的 Facet.exe>` **27/27 通过，退出码 0**。包含主进程/IPC、代理、视口、真实网页、存储隔离、扩展、宫格、API、诊断持久化、重置、DSH 与独立进程重启恢复。未改动正式用户数据，结束后没有该测试副本的残留进程。
- 验证边界：未执行安装器安装/卸载向导，Authenticode 状态为 `NotSigned`；未重跑已记录受本机 HTTPS 夹具连接影响的指纹集成测试第二阶段，不能将该项记为通过。尚未推送源码或公开发布，新版说明先供用户审核。

## 2026-10-24：新建网页标签改为打开必应（源码未发布）

- 改动：`browser-tabs-state.cjs` 新增 `NEW_TAB_URL='https://www.bing.com/'`；标签栏“+”、Ctrl+T、未给 `url` 的 `tab-new`（界面/API/AI）和关闭最后一页后的补开页都打开它，经实例自己的代理加载。显式传 `about:blank` 仍可得到空白页。扩展 `chrome.tabs.create` 未给 url 时仍为 `about:blank`，未改。
- 通过：`check`（355 脚本）、全部单元测试 426 项（425 通过、1 项 POSIX 跳过、0 失败，含新增默认页用例）、`test:control-api`、`test:browser-tabs`（两阶段真实 Electron 全部 PASS）、`git diff --check`。
- Electron 用例把默认页替换为本机夹具 `/new-tab`，分别断言“+”、Ctrl+T 和最后一页关闭后都加载了该页，测试不访问外网。真实必应页面在实例中的加载未在测试中验证。
- 正在运行的应用需重启主进程后生效。

## 2026-10-24：指纹检测对抗（CPU/显卡配套、window.chrome、自定义 UA 的 UA-CH；源码未发布）

- 起因：用控制 API + CDP（只读）在一个检测页上实测伪装实例，读出破绽：`hardwareConcurrency 24` 配 `Intel UHD 617`（不可能的机器）、`window.chrome` 为空对象；重启应用载入首轮两处修复（`5daf8c3`）后复测，又读出第三处——该实例保存的自定义 UA（`Chrome/152.0.7977.130`，比运行内核 `.167` 旧）触发旧策略清空 UA-CH，`navigator.userAgentData.brands` 为空数组（空 brands 本身即强「被伪造」信号）。
- 首轮改动（已提交 `5daf8c3`）：`fingerprint-catalog.cjs` 按显卡档位选线程数；`fingerprint-inject.js` 在窗口补 `chrome.app/csi/loadTimes`（原生样式 toString）。
- 第二轮改动（本次，待提交）：`fingerprint.cjs` 新增 `customMetadata`，对 Chrome-on-Windows 的自定义/漂移 UA 从 UA 自身 `Chrome/<版本>` 推导非空 brands/fullVersionList，复用原生 GREASE 项与 OS 字段；`environment.cjs` 把它接到 `generatedMetadata` 之后、清空兜底之前。非 Chrome / 非 Windows / 缺原生 metadata 仍清空。
- 通过：`check`（355 脚本）、全部单元测试 425 项（424 通过、1 项 POSIX 跳过、0 失败，含 `fingerprint.test.cjs` 的 2000 种子配套断言与新增 `customMetadata` 用例）、`test:control-api`、`git diff --check`。
- 运行时确认（首轮）：独立 Electron 探针显示 `window.chrome.{app,csi,loadTimes}` 存在、`toString` 原生、低端显卡（GT 625）配 6 线程、显卡/CPU 配套。
- 未通过但与本改动无关：`test:fingerprint-contexts` / `test:fingerprint-electron` 首阶段通过，第二阶段（fresh-process-restart / UI-save）在本机因自定义 HTTPS 主机 `main.alpha.test` 连接被拒而超时；stash 掉本次改动后同样复现，确属既有环境问题（疑与正在运行的生产实例争用端口/CDP 有关）。
- 未改（见指纹文档已知限制）：`navigator.userAgentData` 仍缺 `Google Chrome` 品牌（空 brands 子问题已由 `customMetadata` 修复，但补 Google Chrome 改页面会与 Service Worker 不一致，属内核阶段）、宿主语音按真实系统语言暴露、`navigator.languages` 单地区码。
- 运行中的生产进程载入的是 `5daf8c3`（无 `customMetadata`）；第二轮改动需再次重启主进程后生效。对已保存旧 UA 的实例，可另行清掉自定义 UA/平台改回原生元数据使 brands 立即非空（见下条线上修复记录）。未构建安装包。

## 2026-10-23 22:20：v0.2.20 发布候选构建（未发布）

- 源码：`0b28c96`（发布说明与打包检查）。之后只提交了本记录，`docs/VERIFICATION.md` 不在安装包内，安装包内容不受影响。
- 构建前门禁：`check`、`test:control-api`、`test:updates`、`test:packaging`、`git diff --check`、`npm audit --omit=dev`（0 漏洞）通过。
- 构建：`build:environment-pipe` 未能重新链接 `environment-pipe.node`（LNK1104），原因是正式进程正在加载该文件。该文件与 manifest 的哈希一致，git 中也没有改动，因此直接运行 `node scripts/build-installer.cjs`，由它的 `verifyArtifacts()` 校验 Mihomo、进程保护和环境管道组件后构建。
- 产物：`release/Facet-Setup-0.2.20-x64.exe`，131,082,668 字节，SHA256 `f0b2c8f15b005dcf8271ed7d3eb658f7ea31e57e00b3b09c00fa1655d28914b1`。`latest.yml` 版本 0.2.20，SHA512 与大小和安装包一致，blockmap 和 .sha256 齐全。
- 打包验收：`win-unpacked` 复制到没有低完整性标签的 `%LOCALAPPDATA%\Temp`（`app.asar`、`Facet.exe` 哈希与构建输出一致），连续运行 `test:installed` 3 次。第 1 次 27 项全部通过，但最后一次正常退出超过 15 秒等待，记为失败：控制关闭后 16 秒才出现「正在退出」，像是测试用 `CloseMainWindow` 发出的 WM_CLOSE 没有送到主窗口。第 2、3 次 27/27 通过、退出码 0。新增的第 25 项确认 ASAR 内模型能收到 `ask_user_question`、请求附带 `include_usage`、token-meter 记录上下文用量，主进程能用 micromark/mdast 解析 Markdown 表格和粗体。
- 未做：安装器本身的安装/卸载流程（只验收了解包程序）；未签名；未推送、未发布。

## 2026-10-23：AI 面板接入 DSH 后端插件（第二轮）

- `tests/ai-stream.test.cjs` 新增 2 项：OpenAI `cached_tokens` 与 DeepSeek `prompt_cache_hit_tokens` 映射为 DSH 互斥用量（输入不含缓存命中），用量是不可枚举字段、不进入历史；畸形用量被忽略。
- `tests/ai-request.test.cjs` 新增 2 项：服务拒绝 `stream_options` 时立即去掉重发一次并通知调用方；上下文超限的 400 归类为 `CONTEXT_WINDOW_EXCEEDED`，错误文字不含服务返回体；普通 400 不被误判。
- `tests/ai-dsh-plugins.test.cjs` 2 项：提问卡片的数量与长度上限、空选项过滤；压缩摘要输入去掉系统消息、保留工具调用并遵守字数预算。`tests/ai-tool-display.test.cjs` 新增 ask_user_question 摘要。
- `tests/ai-dsh-plugins-electron.cjs` 5 组（真实 Electron、IPC、Controller、官方 DSH 插件，模型为本机协议夹具）：请求带 `include_usage`，模型返回用量成为 token-meter 基线（`estimated:false`），圆环显示 16% 与缓存命中，测量随会话加密保存；提问卡片显示标题、选项说明和两个问题，空提交被拒且不发请求，选项加自定义文字原样作为工具结果回到模型，「暂不回答」与「停止」各自生效，过期回答被拒；24K 窗口下 DSH 压缩把较早 4 次 observe 整理为摘要（只有 1 次无工具的摘要请求），下一次请求携带检查点、工具消息变少，任务在阈值下完成，每次 observe 只显示一次；夜间截图无横向溢出。
- 回归：`test:ai-panel`、`test:ai-agent`、`test:ai-dsh`、`test:ai-browser`、`test:ai-capabilities`、`test:ai-recovery`、`test:ai-sessions`、`test:ai-stop`、`test:ai-memory` 通过；全部 `tests/*.test.cjs` 423 项 422 通过、1 项 POSIX 跳过；`check`、`test:control-api`、`test:packaging`、`git diff --check` 通过；`npm audit` 0 漏洞。
- 发现并修复：新增 DSH 包的必需 peer 只被 npm 自动安装、不在 `dependencies` 中，electron-builder 会漏收；已列为精确版本生产依赖。
- 未覆盖：真实模型服务的用量字段和超限报错原文（各家措辞不同，按常见英文/中文措辞匹配）、打包后 ASAR 中加载新增插件（未重新构建安装包）。

## 2026-10-23：AI 面板 DSH 式对话（第一轮）

- `tests/ai-markdown.test.cjs` 5 项：GFM 结构、顶层偏移、位置信息剥离；CJK 粗体扩展生效（对照：不加扩展时同一文本不产生 strong）；HTML 节点保持惰性；超长、过深、非法输入回落为 null；批量上限与缓存。
- `tests/ai-tool-display.test.cjs` 3 项：键入文字、对话框文字、网址查询不进入摘要；结果摘要按真实返回结构；畸形参数降级为空摘要。
- `tests/ai-panel-electron.cjs` 6 组（真实 Electron、IPC、Controller、官方 DSH 引擎，模型为本机协议夹具）：未配置时「配置模型」打开设置；示例任务填入输入框；Markdown 标题/粗体/右对齐表格/代码块；`<img onerror>`、`<script>` 与 `javascript:` 链接均无效果（页面无 img/script 元素、`window.pwned` 为空）；图片未被请求；三步工具合成一组（含 1 步失败），键入的密码既不显示也不存入条目；追加段落时前面的块元素被复用；点击链接在实例中新开标签并跟随。
- 回归：`test:ai-agent`、`test:ai-dsh`、`test:ai-browser`、`test:ai-capabilities`、`test:ai-recovery`、`test:ai-sessions`、`test:ai-stop`、`test:ai-memory` 通过；全部 `tests/*.test.cjs` 416 项 415 通过、1 项 POSIX 跳过；`check` 353 个脚本、`test:control-api`、`test:packaging`、`git diff --check` 通过；`npm audit --omit=dev` 0 漏洞。
- 未覆盖：真实模型的流式长回复、打包后的 ASAR 中加载新增 ESM 依赖（未重新构建安装包）、屏幕阅读器体验。

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
