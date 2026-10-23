# UX交付状态（第一至四批）

## 2026-10-23：AI 面板按 DSH 交互改造（路线 C，第一轮，当前源码未发布）

用户选择保留千面面板、复用 DSH 能力并参照 DSH 交互（不嵌入 DSH Web 服务，避免明文落盘和本机端口）。

- [x] 回复 Markdown：主进程用与 DSH 官方界面相同的解析管线（`mdast-util-from-markdown` + GFM + 移植的 CJK 粗体扩展，版本与 DSH 锁文件一致），渲染端只用 createElement/textContent 按固定节点白名单绘制；原始 HTML 为文字，链接仅 http(s)，图片不加载。
- [x] 链接在运行中的实例里新开标签打开，沿用实例代理与登录；控制窗口不发外部请求。
- [x] 工具调用合并为一组（状态、目标实例、参数摘要、结果摘要），参数摘要不含键入文字、对话框回答和网址查询。
- [x] 增量渲染：按条目身份复用节点、按段落复用 Markdown 块；执行中 0.25 秒轮询，空闲 0.9 秒。完成的计划自动折叠，引擎版本并入标题，「回到最新消息」浮在对话区上，发送方式移到模型旁，完全权限醒目提示，空白页提供配置入口和示例。
- 验证：`test:ai-panel`（单元 8 项 + 真实 Electron 6 组），`test:ai-agent`、`ai-dsh`、`ai-browser`、`ai-capabilities`、`ai-recovery`、`ai-sessions`、`ai-stop`、`ai-memory` 全部通过；全部单元测试 416 项 0 失败；生产依赖审计 0 漏洞。截图对比在 `.local-dev/ai-panel-review/`（`after/` 为改造后）。
- [ ] 第二轮：接入 DSH 后端插件——追问用户（tool-ask-user / user-questions）、上下文压缩（compaction-basic / tool-result-pruner）、会话标题、Token 计量、审批服务；逐项评估与千面加密存储和权限模式的对接。
- 未做：新安装包未构建，打包态的 Markdown 依赖加载未验证；正式应用未重启。

## 2026-10-23：运行输出不再被重复的扩展加载警告占满（当前源码未发布）

- [x] 依据：正式数据目录的 `runtime-output.json`（10-20～10-23，22 次运行）中，Electron 的 `ExtensionLoadWarning` 及其权限明细占保留的 5000 行中的 1157 行（23.1%），已有 6612 行被挤出保留窗口。它们是同一个扩展加载到每个实例会话、每次启动都重复报一遍（cookies 214、notifications 132、webNavigation 112、downloads 106、sidePanel 72 次等），这些权限多数由千面兼容层实现，警告本身不代表故障。
- [x] 新增 `src/main/process-warnings.cjs`，由 `main.cjs` 启动时接入：只针对 `ExtensionLoadWarning`，每次运行内相同内容保留首次、丢弃重复；不同扩展或权限变化仍各记一次，其他警告不受影响。单元测试 5 项；真实 Electron 中同一扩展加载到 3 个会话只记 1 次，另一扩展单独记录；正式入口 `test:cdp-workers` 通过。
- 同时修正 `browser-tabs` 测试先释放 IPC 再关窗导致的 `No handler registered for 'core:request'`（生产代码不调用该释放函数，属测试顺序问题），重跑 12 项通过、该报错为 0。
- 体验单元测试夹具已更新，全部单元测试 403 项中 402 通过、0 失败、1 项 POSIX 专用跳过。

## 2026-10-23：本机 0x80000003 启动中止的根因

- [x] 查明不是 D 盘问题：开发机项目所在的 `D:\AProgram\arena` 带有可继承的低完整性标签，其下的 electron.exe / Facet.exe 以低完整性运行，Chromium 启动即中止。复制到无标签的 D 盘目录正常；给 C 盘副本加低标签即复现。默认安装到 `D:\Facet` 的用户不受影响。D 盘无标签副本的打包验收 26 项通过。详见 [验证记录](VERIFICATION.md)。
- [x] 开发启动器在回退时说明真实原因；打包验收脚本不再强制依赖 PowerShell 7。
- [ ] 可选：安装程序检测所选目录是否带低完整性标签，并提示换目录。用户实际遇到的概率低，未实施。

## 2026-10-23：收藏 / 扩展 / 检测菜单浮层被截断（当前源码未发布）

- [x] 修复原生菜单浮层显示后停在首帧：浮层原生 View 已按菜单高度拉到 407～573，网页视口却一直停在初始 216px、requestAnimationFrame 只执行1次，收藏菜单底部「管理收藏网站」落在可见区外，悬停等变化也不再绘制。生产默认硬件加速、软件渲染、正常显示与非激活显示四种条件都能复现。修复为显示浮层后重新应用同一后台节流策略（`background-rendering.resume`，与网页标签 10-23 的修复相同）；对照试过 `invalidate`、重设尺寸、隐藏再显示，均无效。修复后400ms内视口变为407，持续出帧。
- [x] `test:browser-tabs` 11项（含两次独立 Electron 重启）全部通过，修复前就停在这项「收藏菜单原生高度」超时。截图 `.local-dev/browser-tabs-20261022/artifacts/favorites-menu.png` 显示五个收藏和底部管理入口完整。`test:quick-links` 16项、`test:privacy-sites` 7项、`test:extensions-electron` 15项、`test:navigation-background` 6组通过。
- 两处测试时序修正，不改业务：Windows 上对浮层 `capturePage` 会使其失焦，而浮层按设计失焦即关闭，截图后改为重新打开再点击；`quick-links` 在菜单长高稳定后再计算点击坐标（原先坐标在长高、滚动归零后落到 Gemini 上）。`quick-links` 的这项失败在 HEAD `a6f1b31` 上同样存在。
- 已知遗留：`browser-tabs` 每轮退出时日志有一条 `No handler registered for 'core:request'`（控制页面在 IPC 释放后仍发请求），10-22 的历史日志里就有，本轮未处理。
- 正式应用未重启；源码备份 `.local-dev/grid-thumb-backup-20261023/menu-overlay.cjs`，诊断脚本 `.local-dev/overlay-height-probe/`。

## 2026-10-23：宫格省资源模式缩略图（当前源码未发布）

- [x] 修复从未显示过的运行网页在省资源宫格中一直没有缩略图。原因：这类网页还没有绘制表面，`capturePage` 不论是否 `stayHidden`、是否关闭后台节流都立即返回 0×0 空图；显示过一次后，隐藏且节流时仍可截图。现在仅在省资源模式、无弹窗/菜单/放大时，把该网页在本格原位短暂显示到首帧（实测约11ms，最长1.5秒），再按布局隐藏；每个 WebContents 成功一次后不再重复，失败10秒后才重试。没有改变节流策略、缩略图轮询间隔或实时模式。
- [x] `grid-electron` 16项、`grid-live-stress-electron` 8项真实 Electron 通过；新增 `npm.cmd run test:grid` 依次运行这两项。新增用例在弹窗打开时启动从未显示过的实例，15ms 采样确认原生网页始终未显示、无缩略图；关闭弹窗后得到铺满格子的缩略图并恢复隐藏。临时去掉遮挡保护时该用例失败，恢复后通过。
- 同步更新两处过期断言，不改业务：格子占用文案已改为 `CPU ≥? x% · 提交/内存 ≥? n MB`（与 `test:resource-metrics` 一致）；格子喇叭左键静音、右键才打开音量浮层；离开宫格后普通网页按现行策略关闭后台节流。修复前基线上 `grid-live-stress` 同样在最后一项失败，不是本次改动引入。
- 正式应用未重启；回滚检查点 `a6f1b31`，源码备份 `.local-dev/grid-thumb-backup-20261023/`。

## 2026-10-23：DSH Agent 候选成品

- [x] 官方DSH执行引擎，保留已有模型、会话、图片、压缩摘要与实例/网页工具。
- [x] 执行中下一步补充、消息待办、停止/失败暂停、逐条移除、手动继续和重启恢复；权限范围固定，历史恢复不自动执行。
- [x] 真实模型一次可信点击与结果复查；开发及打包后的DSH、主流程和跨进程恢复验证。详细边界见[验证记录](VERIFICATION.md)。
- [x] v0.2.20 Windows x64本地候选安装包及SHA256；尚未公开发布，现有用户进程未替换。
- [ ] 长时间连续任务与跨设备验收，以及更多第三方模型和站点兼容性。

## 2026-10-23：v0.2.19 审查确认的待修问题

状态：两项均已修复，并通过真实隔离 Electron 组合回归；当前源码未发布，正式应用尚未重启。本轮没有修改正式实例或网络配置。

- [x] 修复宫格省资源模式与多标签切换后的节流残留：新建/切换标签、进入/退出宫格、扩展弹窗打开/关闭均对所有已加载标签应用当前策略。退出宫格后旧页与当前页均为 `backgroundThrottling=false`；重新激活并隐藏旧页650ms后，动画实测增长39帧，文档未重载。
- [x] 修复最小化期间新建非活动标签恢复后视口为零：新页面先建立有效原生尺寸，隐藏后台页继续保留临时设备指标；实际显示并完成布局后才清除覆盖。恢复后保持 `970×558`，激活后覆盖已清除，调整窗口后变为 `1070×607`，输入与文档标识保留。
- 正式组合回归：`npm.cmd run test:background-tabs-policy`，3组断言通过，报告 `.local-dev/background-tabs-policy-after.json`。旧审查脚本和报告保留供排查，但旧报告曾在修复期间复测覆盖，不作为完整的原始修复前快照。
- 相关回归通过：`test:minimized-rendering` 7项、`test:navigation-background` 6项、`test:grid-transition-electron` 4项、`test:creation-lifecycle`（取消/退出/节点竞争与AI随机创建）、`test:extension-configure` 11项。未重新验收已有的完整收藏菜单与宫格缩略图旧失败，不能据此宣称全项目无问题。（宫格缩略图与收藏菜单原生高度均已于同日修复，见文首两节。）

## 2026-10-23：扩展默认启用（当前源码未发布）

- [x] 扩展卡片「移除」右侧增加「默认启用」开关；普通新建、批量、本机API和AI创建共用默认绑定入口。只影响之后新建实例，不改变已有绑定，重启保持设置；扩展更新保留标志，移除无悬空默认配置。
- [x] `test:extension-defaults` 8项真实集成通过，覆盖原生鼠标点击、实际内容脚本、HTTP创建和两个独立Electron进程；日夜主题与两种窗口宽度截图已检查。`test:extensions` 19项通过，包含默认写入失败保护。说明见 [扩展文档](EXTENSIONS.md) 和 [控制API](CONTROL-API.md)。
- 修改前检查点 `ea9594e`；本轮尚未打包或发布，正式应用需正常退出并重启后加载新主进程代码。
- 最终基础检查：`npm.cmd run check` 336个脚本、`npm.cmd run test:control-api` 1项、`git diff --check` 均通过。AI随机创建专项11项通过，其中包括默认扩展持久化与真实内容脚本；模型响应和地区信息来自本机协议夹具，不作为公网业务验证。

## 当前阅读顺序与状态（2026-10-14）

完整项目说明见 [项目手册](PROJECT.md) 和 [索引](README.md)。本文下方“第一至四批”及其日期是历史批次，不代表整个项目停留在该范围。

- v0.2.13：指纹库组合生成、常用扩展 API 与实例隔离、Windows 任务栏及扩展窗口图标修复、随包项目文档，见 [发行说明](releases/v0.2.13.md)。专项验证和未覆盖范围分别见指纹库、扩展兼容层与验证记录。
- 已发行 v0.2.12：环境重置/表单刷新、开发者工具内嵌及调宽、扩展 debugger 兼容、宫格/代理失败判断和 Star 升级提醒等，见 [发行说明](releases/v0.2.12.md)。节点 DNS、API/CDP、检测菜单等在此前版本已开放。
- 详细网络诊断已接入待发布构建，见 [日志说明](DIAGNOSTICS.md)；订阅指定代理仍为未接线草稿。
- 待做：CRX3/ZIP 导入、跨设备 TUN/DNS/多网卡验收、指纹一致性与长期负载等；不会把当前网络问题归因于所有用户都相同的设备环境。
- 历史通知布局待办需按当前源码重新确认；本次文档整理未对旧待办逐项现场验收，不擅自勾选完成。
- 验证证据按版本与范围记录，见 [VERIFICATION.md](VERIFICATION.md)。

## 2026-10-21：指纹上下文一致性与内核候选

- [x] 注入辅助方法兼容性：网页重写 WeakMap / WeakSet、Math、Reflect 等方法不再破坏 toString、画布、WebGL、离线音频与布局读取；原生对照覆盖页面、iframe 和 Worker，跨上下文及重启回归通过。真实检测页非交互 PASS，托管仍需点击，不能作为免点击提升的证据。
- [ ] 继续评估原生 HTTP Client Hints、完整 GPU / WebGPU 能力和 Chrome 专属 API 的兼容实现；不以伪造接口存在或硬编码显卡能力代替真实可用性。托管验证免点击差异尚未定位。

- [x] 修复私有调试管道意外启用 AutomationControlled 的回归：正常手动浏览保留原生 webdriver=false，SharedWorker 与外部 CDP 协调保留；同节点真实检测页非交互验证恢复服务端 PASS，托管验证等待点击，未代点。补充页面 / 跨站 iframe 首段及重启回归；源码未发布，现有用户进程未重启。

- [ ] Simprint 内核评估与选择性移植：参考 https://github.com/Simprint/simprint-browser-kernel ，优先审查每实例固定种子、Worker / 跨站 iframe、Canvas / Audio / WebGL 的原生行为与版本升级成本。官方仓库已归档，已查分支为 `simprint/m144`（Chromium 144.0.7559.118，AGPLv3）；不得将配置项或补丁存在等同于运行验证通过，不直接替换现有 Electron 内核。
- [x] Dedicated Worker（含 Blob、module、嵌套和跨站 iframe 内 Worker）与网页的 UA、语言、时区、CPU、内存和 WebGL 报告一致；两个并发实例及全新进程重启验证通过。
- [x] 网站 Service Worker 在首段脚本前应用覆盖；变更环境或仅变更时区时停止本会话旧网站 Worker，使其再次启动时读取新配置；关闭覆盖后撤销预加载，开启后恢复。保留注册与网站数据，不处理扩展 Worker。
- [x] SharedWorker 首段覆盖：通过 Browser 私有 CDP 命名管道暂停脚本并按 browserContextId 路由环境；开启外部 CDP 时由本机网关在原配置端口协调初始化，防止 Playwright 提前恢复执行。正式应用入口验证双客户端、双实例、首段采样、环境变更、存储隔离、重连和全新进程重启；上下文专项同时覆盖失败后恢复。Windows x64 专用，不处理扩展 Worker。
- [x] 补齐跨站独立进程 iframe 的环境应用时机；首段脚本、跨站跳转后和全新 Electron 进程重启的读数通过。
- [x] 修复已复现的 API 行为问题：空白画布保持透明黑，非法 Canvas receiver 不调用页面 getter，AudioBuffer 读取不修改数据，离线音频事件/Promise/copy 一致，WebGL 保留未启用扩展和非法调用的原生错误语义。保留固定种子。
- [x] OffscreenCanvas 的 2D / WebGL 导出使用固定种子噪声，保留原生错误、选项转换、调用时快照、色彩空间和精度。页面、Dedicated Worker、网站 Service Worker、跨站 iframe 的受控 PNG 字节一致；独立导出专项覆盖转移/分离和跨域污染。
- 状态：SharedWorker 受测首段已覆盖，但不能据此宣称所有上下文完全一致或所有风控网站通过。bitmaprenderer / 未记录的 OffscreenCanvas 上下文保留原生导出，不保证噪声覆盖；高频大画布的额外编码开销未做长期验收。详见 [指纹说明](FINGERPRINT-CATALOG.md) 和 [验证记录](VERIFICATION.md)。
- 此次外部 CDP 续做检查点：`ee30e1b`（前序 SharedWorker 提交 `e127cef`）。使用隔离测试数据，未重启正在使用的应用，未修改真实实例数据、网络或 DNS；尚未打包发布。

## 2026-10-14：详细诊断导出

- [x] 订阅 DNS/TCP/TLS/HTTP/解析阶段、节点准备、检测、内核输出和网页失败接入结构化采集。
- [x] 输出跨重启保留；导出标明截断、容量和采集失败。
- [x] 真实 Electron 两次启动和 UI → IPC → JSON 文件验收；详见 [验证记录](VERIFICATION.md)。
- Release 等用户审阅后发布。

## 历史：2026-10-13 订阅指定代理与详细诊断导出

- 用户已授权两项功能；状态：实施中，未接入生产入口、未验收、未发布。
- 两个未提交模块草稿：`src/main/subscription-proxy.cjs`、`src/main/network-trace.cjs`。下载器、Library、IPC、界面和诊断包仍沿用 v0.2.12；上次组合补丁失败，不能视为接线完成。
- [ ] 添加/更新订阅可指定运行中的代理实例，保存线路，代理不可用时明确失败且不回退其他线路。
- [x] 详细诊断包关联 DNS、连接、TLS、HTTP、解析结果和节点检测阶段，保留跨重启历史，明确采集边界并排除凭据与网页数据（2026-10-14 完成）。
- [ ] 完成真实 Electron、异常、安全、持久化和导出文件验收；基础检查不能替代功能验收。
- 回滚点 `c1cc7f9`；详细方案、实际进度和接手步骤见 [订阅指定代理与详细诊断导出](SUBSCRIPTION-NETWORK-DIAGNOSTICS.md)。

## 新增优化待办：Clash TUN / Fake-IP 并存兼容

- 记录日期：2026-10-08；优化清单第 29 项；优先级：高；状态：已实现节点 DNS / 出站设置并完成本机真实应用验证；其他网络环境仍待验收。
- 复现：同一 HTTP 节点在千面检测超时；本机开启 Clash TUN，系统解析返回 Fake-IP，节点连接被另一个代理链路接管。保存的 Clash 节点参数与千面一致。
- 实测：默认路径下，千面核心 v1.19.31 和 Clash 核心 v1.19.32 均失败；只替换真实 DNS 地址或只绑定物理接口也失败。使用真实 DNS 地址并绑定物理接口后，千面核心 HTTP 204 / 586 ms、HTTPS 200 / 803 ms，IP.SB 查询 HTTP 200 / 774 ms，取得美国出口及时区。节点本身可用。
- [x] 共享节点准备流程已接入实例启动、连通性、出口 IP、时区与下载测速。默认恢复系统 DNS；保留自动兼容、安全 DNS 和严格模式。复用校验证书、固定服务引导地址的应用 DoH，每次启动或检测重新解析，仅在内核临时 hosts 中覆写当前节点域名。原域名、TLS/SNI、协议参数与节点库均保留。2026-10-10 调整失败处理：自动兼容和安全 DNS 在 DoH 失败或只返回非公网地址时回退系统 DNS 并继续尝试启动（运行日志注明回退），不保证连通；严格模式不回退，明确报错且不启动代理。只控制节点服务器解析，不保证网页 DNS 无泄露。无运行中定时刷新或自动重连。
- [x] 按本次完整采纳方案的要求，在「应用设置」显示「节点 DNS 与出站网络」面板；四种 DNS 模式和路由可选，非默认设置时显示「重置为默认」。显示面板不自动修改已有配置。外部控制的勾选框改为开关，沿用原保存操作。
- 首次采纳验证（2026-10-10）：check 200 个脚本、control-api 1 项、node-network 9 项、subscription-doh 21 项通过。当时误沿用旧要求隐藏 DNS 面板，现已恢复显示；保存网络设置不重启已有直连页面，缺失网卡保存被拒绝且保留原配置；外部控制开关空格键操作、API 鉴权与真实实例列表、关闭监听、两次进程重启恢复启用 / 关闭状态通过，临时测试数据已清理。本轮未使用个人节点库，未修改真实用户配置，未验证其他设备截图中的节点故障，也未发布安装包。
- [x] 提供跟随系统（默认）、自动物理网卡、手动网卡三种选择。真实读取已连接网卡及路由跃点，自动选择物理默认出口；指定网卡不可用时明确失败，节点已有网卡 / 上游代理配置时要求使用跟随系统。保存不重启已有实例，不改系统 DNS、路由、Clash TUN 或节点原配置。
- [ ] 失败提示区分节点认证、DNS、出站路由、TUN 干扰和检测目标错误；日志脱敏，代理失败不得回退为目标网站直连。
- [ ] 验收覆盖无 TUN、Clash TUN + Fake-IP、普通 DNS、多网卡与网络切换；验证真实实例浏览、HTTPS、出口国家和时区、检测结果及重启持久化，确认其他实例和系统代理不受影响，临时进程与含凭据配置无残留。
- 实际验证：本机宿主 Clash TUN / Fake-IP 开启时，真实 Electron 界面刷新网卡、保存、手动指定、缺失网卡保护通过；同一认证节点经原版核心打开 HTTPS，连通性、出口国家及时区、完整 5 MB 测速成功。错误节点不回退直连，取消检测清理内核，其他运行视图不变；重启后设置和真实出口查询通过。公网测速曾有一次超时，最后完整复测成功，不能把此结果当作检测服务始终可用的保证。
- 验证边界：无 TUN、不同物理网卡同时联网、网卡切换、公司 VPN 和公网 IPv6 节点未完成完整矩阵；未实现运行中自动路由切换。原核心不编译、不替换。内部报告位于 `release/local-node-dns/交付验证报告.md`（Git 忽略，不随仓库发布）；原始诊断报告仍保留在 `release/local-node-diagnostic/验证结论.md`。本地构建不等于 GitHub 发布。

## 新增优化待办：通知不占独立布局行

- 记录日期：2026-10-08；对应本轮优化清单第 28 项。状态更正（2026-10-23）：同日已实施，当前 `ui.css` 中 `.toast` 为控制区顶部的固定浮层，不再占布局行；当时的真实 Electron 验证见 `release/local-toast-layout/验证记录.md`（Git 忽略）。本次只核对源码，未重新做界面验收。
- 用户要求：错误通知等短时提示不要自己占一格；显示和消失时不能挤压地址栏、侧栏或网页区域。
- 当前依据：`src/renderer/index.html` 的 `notificationSlots` 包含 `toast`；`src/renderer/ui.css` 将通知放在应用网格的 `auto` 行，`.toast` 使用相对定位并带上下边距。
- 修改方向：将短时通知改为浮层显示，保留错误信息、原有消失时机和状态提示。更新提醒的独立交互另行核对，不能顺带删掉。
- 原生网页层约束：必须验证浮层在 `WebContentsView` 上方真实可见，不能仅修改 CSS 后被网页遮住；通知之外的区域不能拦截网页输入，也不能为显示通知而暂停或隐藏实例。
- 验收：普通浏览页、实时宫格和管理页中，通知显示前后及消失后网页边界保持一致；明暗主题和不同窗口尺寸下文字可读，网页点击、滚动及实例切换正常；连续通知不堆出空白布局行。

## 新增优化待办：指纹检测站复测暴露 Electron 与一致性特征

- 记录日期：2026-10-09；来源：使用实例 7（美国家宅ipvpn）的节点、指纹、语言及时区配置启动隔离测试副本；状态：部分完成，仍需继续验收。
- 实测：Sannysoft 大部分基础项通过，但 `HEADCHR_IFRAME` 失败且网页可见 `Electron/44.4.5`；CreepJS 显示约 31% 类似无头环境、隐身评分 0%；Pixelscan 标记指纹 `inconsistent` 和 `Automated behavior detected`。
- 已确认：WebRTC 检测只出现本地候选，未发现公网 IP；节点可连接并取得美国出口。BrowserScan 动态数据未完整返回，IPHey 加载超时，不能据此判定全部检测站通过或 DNS 完全无泄露。
- [x] 研究在不破坏登录、扩展和实例隔离的前提下移除网页可见的 Electron UA 标识，并补充 Electron/Chromium 版本兼容验证。默认 UA 在会话层与 CDP 层均清理 Electron 标记；显式填写的 UA 保持原样。
- [ ] 对齐屏幕、视口、设备缩放和可用高度，消除检测站显示分辨率与脚本读取值不一致的问题；保留每实例固定指纹种子。
- [ ] 排查 CreepJS 的无头/隐身判定与 Pixelscan 的自动化判定，分别定位 WebDriver、iframe、窗口尺寸、Canvas/WebGL/Audio/字体和行为信号，禁止用静态假结果掩盖。
- [x] 用真实代理节点复测六个检测站，并单独记录 DNS、WebRTC、出口 IP 与加载限制；五站页面可加载，IPHey 在超时窗口内未完成，未据此宣称全部通过。
- 复测结果（2026-10-09）：实例 7 的真实节点配置隔离副本可启动；BrowserScan、Sannysoft、CreepJS、Fake Vision、Pixelscan 页面完成加载，网页 UA 均不含 Electron；CreepJS/Pixelscan 的动态评分仍需在可见窗口等待完整接口返回，IPHey 超时。WebRTC 仍未观察到公网候选；敏感出口地址未写入文档。
- 验收：UA 不再暴露 Electron；屏幕/视口参数前后一致；Sannysoft iframe、CreepJS 无头/隐身、Pixelscan 自动化提示有可解释的改善；WebRTC 不出现真实公网地址；原实例会话、节点、扩展和登录状态不受影响。

## 第四批：扩展中心、地址栏扩展图标、侧栏空白

- 「浏览器扩展」改为「扩展中心」，以扩展为主：一张卡片一个扩展（清单图标或首字母、版本、大小、启用数量），下方勾选要启用的实例；可同时改多个实例，点「应用更改（n）」一次确认，确认栏写明将启用/停用哪些实例、会停止哪些运行中的实例；可撤销，改回原状态自动取消。移除只在所有实例都停用后可用，并需确认。
- 实例浏览页不再单独占一行放扩展：已启用的扩展以图标显示在地址栏右侧（未启动的实例图标为灰色，加载失败带红色「!」），点击直接打开扩展面板；没有面板时打开设置页。拼图按钮打开扩展菜单（面板/设置、未在此实例启用的扩展数、跳转扩展中心），Esc或点外面关闭；菜单打开时网页视图暂时让位。地址栏自动让出宽度。
- 全局管理页侧栏不再在「返回实例」下方留空白。
- 主进程：extension-catalog.cjs 新增 extensionIcon，只读取清单声明、位于扩展目录内、不超过64KB的 png/jpg/gif/webp/svg；extensions.cjs 缓存图标并在快照中提供 icon。启用/停用仍会停止目标实例（原有行为不变）。
- 新增 src/renderer/extensions.css、tests/extension-center.cjs（npm run test:extension-center-ui）；tests/extensions.test.cjs 增加图标测试。

Windows验证：check 50；extension-center 7；ux3 11；experience-renderer 15；appearance 8；ui 5/5；7组单元测试全部通过；extensions-electron 11；quick-links 15；viewport 11；smoke 54/0（第一次运行出现一次偶发的 “Script failed to execute”，随后连续两次全部通过、errors为空）。

## 第三批：导航去重、字号与对比度、状态记忆、键盘操作

2026-09-27：Windows全量回归通过；未重启用户正在运行的实例，需用户自行重启 千面 Facet 后生效。

### 改动

- 导航：删除顶栏「实例管理」按钮和顶部通知条，只保留标签栏网格按钮与侧栏「实例管理」。全局页侧栏不再显示实例工作台和启停按钮，改为「返回实例：名称」。去掉 GLOBAL/INSTANCE 标签；页脚只显示「内置 Mihomo · 状态」和版本号。浏览器预览提示仅在预览模式动态插入。
- 可读性：新增 `src/renderer/readability.css`（最后加载）：所有文字不小于 11px，说明与表单标签 12px；日间主题次要文字、状态色、主按钮调整为不低于 4.5:1；夜间主题原本已达标。36px 紧凑节点行不变。
- 状态记忆：新增 `src/renderer/ux-habits.js`，`localStorage` 键 `arena.ui.state.v1`。记住打开的标签、当前实例、页面、代理管理的来源/排序/筛选/并发/提示/搜索、全局日志的级别/范围/实例/来源、实例总览的筛选/搜索、收藏页签和「高级指纹」展开状态。滚动位置只在本次运行内按页面记忆。过期 ID、未知页面、非法取值、损坏的存储一律回退默认值；启动时不自动启动任何实例。
- 键盘（仅软件界面，不拦截网页内按键）：Ctrl+L 地址栏（实例未运行时提示并聚焦启动按钮）、Ctrl+Enter 在「代理与指纹」页保存、Ctrl+Tab / Ctrl+Shift+Tab、Ctrl+1…9、Ctrl+T 新建、标签栏 ←/→/Home/End。不提供 Ctrl+W。重新渲染和弹窗关闭后焦点回到原控件；两种主题下都有可见焦点框；快捷键列在「应用信息」页。
- 测试工具：`scripts/preview.cjs` 原先只提供 index.html、styles.css、app.js，拆分出的其他脚本全部 404，导致 `tests/ui.cjs` 在本批之前就已失败（提示条为 `refreshIPBookmarks is not defined`）。已改为提供渲染目录下所有 html/css/js 文件（只接受平铺文件名，路径穿越返回 404）。
- 新增 `tests/ux3-renderer.cjs`（`npm run test:ux3-ui`），只依赖 Playwright、使用自包含的模拟 IPC，共 11 组用例：导航、8 个页面在日/夜主题下的字号与对比度审计、43 节点 36px 行高、重启后状态恢复且不启动实例、滚动记忆、过期/损坏存储回退、全部快捷键、焦点连续性、1024×768 / 1280×800 / 1440×960 下长名称 + 15 实例 + 43 节点无横向溢出、失败/已取消任务、零实例与无节点。

### Windows 验证

check 49 个脚本；ux3-renderer 11/11；experience-renderer 15/15；appearance-audit 8/8；ui（浏览器预览）5/5；core、subscription、library、workspace、fingerprint、experience、extensions 单元测试全部 exit 0；Electron：electron-smoke 通过（errors=[]），viewport-bookmarks 11、quick-links 15、extensions-electron 11。测试前后用户的 verge-mihomo、mihomo 与 Arena 进程均保持运行。

### 已知环境问题

`node_modules` 中的 Playwright 1.63.0 需要 chromium_headless_shell-1243，本机只装有 1234。本轮 Chromium 类测试通过环境变量 `PW_CHROMIUM` 指向 1234 版运行：ux3 测试原生支持该变量，其余测试用放在 %TEMP% 的预加载脚本注入，未改动仓库。如需按默认方式运行，请在项目根目录执行 `npx playwright install chromium-headless-shell`。

---

# UX前两批交付状态

2026-09-27：Windows最终回归通过，生产未强制重启。

## 通过的验证

Windows命令cmd_f8b7a9f4d27b034e4f5c60bb9f73acbdb2860e3117bf49b1 exit0：check33、experience6、fingerprint5、workspace5、core10、library5、subscription7、Electron52，errors=[]。

新增Windows浏览器用例覆盖无修改/无效配置不停止真实实例、随机撤销、草稿离开保护/保存只影响目标、分配目标保持及任务日志跳转、创建成功但启动失败后重试同一实例，以及三种窗口尺寸的固定保存栏。原有订阅、43节点紧凑表、并发检测、取消、代理无直连回退、指纹与时区等回归继续通过。

另有11组Chromium界面测试（模拟IPC与runtime、真实Store/校验）及Linux Electron52项通过。这些辅助结果不代替Windows结果。

## 本轮改动

- 保存前校验、无修改短路、防重复提交、固定保存栏和就地错误。
- 按实例会话内草稿、离开保护、旧草稿冲突保护；退出应用不保留未保存草稿。
- 创建/查询时区/启动阶段分离，失败重试已有实例；节点副本保存失败不以直连启动。
- 指纹方案前置及撤销，禁用未启用字段；实例卡片快捷启动/打开/配置，删除在更多菜单。
- 代理/收藏目标保持、导入草稿、分配后返回；检测完成摘要、失败项重测、结果详情和相关日志。
- 用户可明确选择在本次应用运行中记住同类连通性/IP检测告知；测速仍手动确认。
- 当前状态与历史错误分开；任务筛选可读并增量更新，导出明确为全部日志。

## 恢复记录

此前Windows桥接HTTP530导致中断。恢复后先取回terminal105的旧结果，确认测试选择器仍按span查找已改为button的结果单元格；已修正为.node-result-value，重跑全套通过。没有重复启动重叠测试，没有停止生产或修改旧asar、参考归档。

## 边界

测试使用受控本机上游，不证明用户真实节点、公网IP数据库准确性、15实例长期重载或完整防泄漏/防检测。草稿仅本次应用内保留；环境需保存并启动后生效。公开发行授权核查仍未完成。

截图：tests/ux-environment-win32.png；测试报告：tests/electron-results-win32.json。
