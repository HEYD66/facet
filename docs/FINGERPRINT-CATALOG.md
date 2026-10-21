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

当前版本生成的 Windows UA 与运行内核一致时，保留原生 Windows UA-CH 数据；显式编辑 UA/平台或旧版本 UA 仍沿用清空自定义 UA-CH 的兼容策略，避免套用错误版本信息。关闭参考覆盖后恢复原生方案。

## 已知限制与内核后续

- 字体、媒体设备、语音、WebGPU、完整 WebGL 能力、TLS 均未因导入库而改动。
- 主页面、同源 iframe、跨站独立进程 iframe、Dedicated Worker 和网站 Service Worker 的所测设备字段及 OffscreenCanvas PNG 导出已对齐，见下节。SharedWorker 仍有差异；bitmaprenderer 导出和完整 GPU 能力等不完整覆盖，不能宣称所有上下文完全一致。
- 当前 Electron 44.4.5 的原生对照和库实例在受控 HTTPS 上均未发送 `Sec-CH-UA-*` 请求头；页面 `navigator.userAgentData` 与 UA 版本一致。不能把 JS 元数据验证写成 HTTP Client Hints 已完整支持。[该版本 Electron 源码](https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_browser_context.cc) 的 `GetClientHintsControllerDelegate` 返回空指针，相关支持需在内核阶段实现。
- 第三方采样中的 Canvas/音频数值不通用，沿用千面现有固定种子扰动，不导入其签名或私有算法。

## 2026-10-21 上下文一致性与 API 行为修复

- 每个网页只附着自己的 iframe / Dedicated Worker 后代。新目标先应用相同环境，再恢复首段脚本；递归处理 iframe 内 Worker 和嵌套 Worker。没有增加网络请求拦截器、浏览器范围的目标发现或外部 CDP 端口。
- 网站 Service Worker 使用本会话的主世界预加载。CDP 在其启动暂停阶段的 Runtime / Emulation 命令不响应，因此不再将它挂在这条等待链路中。切换环境（含仅时区变化）或开关指纹覆盖时停止旧网站 Worker，保留注册和持久化网站数据。扩展 Service Worker 不执行此覆盖。
- 透明 Canvas 不加噪，色值不从 255 环绕为 0；保留原生 receiver、参数转换和异常。OffscreenCanvas 的 2D 读取和 `convertToBlob` 使用相同固定种子规则。导出先调用原生方法校验原画布，再同步保存加噪副本；原生错误不会变成成功。编码选项只读取和转换一次，源画布不被修改。
- OffscreenCanvas 通过弱引用映射记录已获取的绘图上下文，保留 sRGB / Display P3 和 unorm8 / float16；浮点像素使用归一化噪声，不按字节直接加 1。无上下文、未记录上下文或 bitmaprenderer 等无法可靠克隆的情况保留原生结果，不为了导出而改变源画布的上下文类型。该兜底不保证导出噪声覆盖。
- 不再覆写 `AudioBuffer.getChannelData`：原生引用、手动写入、`copyFromChannel`、空白缓冲均保留。固定种子噪声仅作用于 OfflineAudioContext 渲染结果；在构造时登记完成事件处理，确保页面先注册的事件、返回 Promise 和拷贝读取一致，静音保持零。
- WebGL 先执行原生查询，再覆盖已启用调试扩展所允许的厂商/渲染器字符串；保留未启用扩展的 null / INVALID_ENUM、非法 receiver 的 TypeError 和参数只转换一次。空元素矩形不偏移。

实际验证入口：`npm.cmd run test:fingerprint-contexts`。独立临时 profile、本机受控 HTTPS、两个并发实例，记录首段脚本读数、跨站进程隔离、导航、实例重启、全新进程重启及配置开关切换。检查 UA / 平台 / CPU / 内存 / 语言列表 / 时区 / GPU，生成库方案的 JavaScript UA-CH 和 OffscreenCanvas PNG 字节也与主页面比对。

`npm.cmd run test:fingerprint-offscreen` 单独对照原生与覆盖后的真实导出：PNG / JPEG / WebP、质量与无效 MIME、参数 getter 顺序和次数、调用时快照、透明像素、非法 receiver、零尺寸、转移/分离、DOM 所有权及跨域污染错误。另测页面/Worker 相同输出、DOM 画布转移到 Worker、色彩空间/浮点精度和网站替换辅助方法。为保留原生校验，正常加噪导出会额外编码副本；大画布高频导出有额外 CPU 和瞬时内存开销，未做长期负载验收。

报告中的 `passed` 表示已实现范围的断言通过；`complete:false` 和 `boundaries` 明确记录 SharedWorker 未完成，不得据退出码写成全上下文通过。测试不读取或修改真实用户实例；未用第三方注册/验证码成功率作为结果，也未宣称对任意自定义 UA 和所有检测站完整覆盖。仅当前 Windows / Electron 44.4.5 的受控场景已测。

SharedWorker 入口探针确认：页面 CDP 的 `setAutoAttach` 即使包含 `shared_worker` 也没有在首段脚本前附着；`autoAttachRelated` 要求 Browser target，页面通道请求 Browser target 被拒绝，`registerPreloadScript` 也不接受 `shared-worker` 类型。运行后手动附着不算首段覆盖。探针未接入生产，不新增全局目标发现、请求拦截器或外部调试端口；后续需独立验证更底层启动入口。

回归另包含 `test:fingerprint-electron`、`fingerprint-tostring-electron.cjs`、`test:extension-debugger-electron` 和 `test:devtools-electron`，验证生产保存流程、停用、扩展调试事件、Worker 与开发者工具兼容。代码回滚点为 `d69ee20`；修改后须重新启动主进程和实例才能使用新逻辑。

## 2026-10-15 视口修复验证

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
