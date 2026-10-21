# 验证入口与历史记录

更新：2026-10-21。当前源码版本 v0.2.17。下方原始记录是各阶段历史证据；命令编号、数量和阻塞状态不能当作今天的全量结果。

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
