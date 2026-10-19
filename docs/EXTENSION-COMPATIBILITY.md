# 扩展 API 兼容层

更新：2026-10-14。适用版本：v0.2.13。兼容实现已在 Windows 隔离数据目录验收；当前运行的旧主进程需要退出后重新启动才能加载本版代码。

## 扩展更新后重启（v0.2.16）

单个扩展确认按钮改为「更新并重启」，批量更新为「全部更新并重启」。更新后自动启动本次停止的受影响实例，原本停止的实例不自动启动，无关实例保持运行。扩展绑定和已保存的数据保留；未保存的网页输入可能因重启丢失。重启失败会单独返回实例及错误，不能当作重启成功。


## 用途与入口

补充 Electron 缺少的常用 Chrome 扩展接口。保留「扩展中心」导入、权限确认、按实例启用及更新流程；无需插件修改源码。Manifest V2 后台页、Manifest V3 Service Worker 和扩展面板可使用兼容接口，支持 Promise 和回调错误 `chrome.runtime.lastError`。

这是按实例实现的兼容层，不是完整 Chrome 浏览器 API。具体方法、可选参数和插件最终功能仍有边界。Electron 原生接口保留并分别验收，禁止仅根据函数存在宣布支持。

## 方法范围

| 接口 | 本轮提供 | 主要边界 |
| --- | --- | --- |
| `webNavigation` | `getAllFrames/getFrame`；开始、提交、DOM 就绪、完成、SPA 导航、错误事件 | 主框架 ID 为 0，子框架使用真实 `frameTreeNodeId`；按 `documentId` 查询不支持 |
| `tabs` | 创建、查询、获取、更新、关闭、移动、复制、截图、刷新、缩放、分组与取消分组；对应生命周期事件 | 只枚举本实例主页面及扩展创建的网页；不能固定、预丢弃或移动主页面；后台/独立面板 `getCurrent` 返回 undefined |
| `windows` | 获取、枚举、创建、更新、关闭与焦点事件 | 每个实例主页面对应虚拟窗口 ID；共享工作台只允许聚焦，不能由扩展改变尺寸；新增网页使用有真实标签栏和地址栏的扩展浏览窗口 |
| `notifications` | `create/update/clear/getAll`、点击及关闭事件 | 原生 Windows 通知；图片、通知按钮不支持；创建等待系统 show 事件，等待中的通知不计入 getAll；清除、替换、停止实例立即结束待显示请求 |
| `downloads` | `download/search/cancel/pause/resume/show`、创建及变化事件 | GET、HTTP/HTTPS/data/本扩展 Blob；仅 uniquify；不提供启动下载文件、删除磁盘文件、正则查询和跨重启断点恢复 |
| `cookies` | 获取、枚举、设置、移除、存储列表及变化事件 | 真实 Chromium Cookie，限当前实例和扩展获得的来源权限；分区键尚不支持 |
| `browsingData` | `remove` | 真实清除缓存、Cookie、文件系统、IndexedDB、localStorage、Service Worker、WebSQL；历史及下载记录由兼容层清除；网站存储仅支持 since:0，不支持的范围在清除前报错 |
| `bookmarks` | 树、子树、查询、最近记录、创建、修改、移动、删除与事件 | 本实例的扩展书签库，独立于千面原有收藏管理；不自动合并旧收藏 |
| `history` | 查询、真实访问记录、添加和删除与事件 | 兼容层运行期间记录的本实例页面访问；不是旧浏览数据的完整历史；不包含其他实例或跨设备历史 |
| `sessions` | 最近关闭页、恢复及变化事件 | 保存扩展浏览页关闭记录，恢复为同实例真实网页；不恢复表单、内存和旧 target；无登录账号同步，因此 devices 为空 |
| `permissions` | `getAll/contains/request/remove`、增加及移除事件 | 需清单声明；新增兼容层权限要真人确认，可选原生权限无法授予时直接报错；停止实例自动取消待确认框；兼容来源授权不等于扩展原生网络/脚本权限自动增加 |
| `commands` | `getAll/onCommand` | 读取清单快捷键，在主实例网页实际按键时转发；不是操作系统全局热键注册 |
| `action/browserAction` | 标题、图标、面板、角标、颜色、启用状态、点击事件 | 角标和图标在千面真实工具栏显示；图标、面板路径必须属于扩展；activeTab 由用户调用工具栏/面板授予并随导航清除 |
| `sidePanel` | `getOptions/setOptions/open/close` | 本实例或扩展浏览窗口内真实停靠页面；切换实例、管理页或宫格时隐藏；当前仅保存每扩展一套配置，不提供每 tab 独立配置 |
| `tabGroups` | 查询、读取、修改，配合 tabs.group/ungroup | 当前扩展浏览窗口内分组，标签栏显示标题/颜色/折叠；关闭最后一页清除组，移动到其他窗口取消原组；重启不复活旧窗口与分组 |
| `debugger` | `getTargets/attach/detach/sendCommand`、调试事件 | 仅明确指定本实例 tabId；复用应用 CDP，detach 不关闭应用连接；限定 Network/Runtime/DOM/Page/Fetch/Emulation/DOMSnapshot/Accessibility/CSS/Log/Performance，拒绝 Browser/Target 全局命令及页面崩溃、下载路径覆盖 |
| `alarms` | 创建、获取、枚举、清除与实际定时事件 | 持久化，实例停止暂停、再次启动恢复；重复间隔至少 0.5 分钟；不是严格实时计时器 |
| `privacy/proxy` | WebRTC 防护策略及实际代理路由只读查询 | 返回不可由扩展控制；set/clear 明确报错，保留千面网络配置 |

原生 `offscreen` 可创建和运行。DNR（源码已修复，尚未发布）：v0.2.13～v0.2.16 不生效的根因是实例 Session 注册了诊断用 `webRequest` 监听，使 Electron 绕过扩展请求代理；诊断改为 CDP 采集后，动态规则的拦截、跳转及请求/响应改头已在真实 fetch 上验证执行（`test:extension-compat`）。Electron 加载扩展时不会启用清单中 `"enabled": true` 的静态规则集（实测 `getEnabledRulesets()` 为空）；千面在实例启动、页面加载前为每个实例按扩展包指纹补做一次（`extension-dnr-rulesets.cjs`，标记存于实例配置目录 `facet-dnr-rulesets.json`）。首次见到扩展时若其已有启用集合则保持不动；扩展更新只补启新版清单新增的默认规则集；扩展自己调用 `updateEnabledRulesets` 的选择由 Electron 跨重启保存，不被覆盖。`getMatchedRules`/调试反馈和 `responseHeaders` 条件尚未验证。扩展调试器只有在该扩展自己调用 `Network.enable` 后才收到 Network 事件；它关闭 Network 或断开时，千面恢复诊断用的小缓冲设置，不关闭采集。`nativeMessaging`、浏览器账号/同步、商店安装、所有 Chrome API/参数并未补齐。Buster 本机辅助程序通信仍受 Electron 限制。

导航只开放无 URL 登录凭据的 HTTP/HTTPS、about:blank 或本扩展页面，拒绝 file/javascript 等；截图另检查页面来源权限或真实 activeTab。导航事件过滤目前支持 hostEquals/urlContains，其他 Chrome URLFilter 字段尚未实现。会话、书签、历史和下载的字段也不是完整 Chrome 数据模型。

## 隔离、数据与生命周期

- 主进程按 Session、扩展来源、托管路径和运行状态检查 IPC，网页不能直接调用控制桥。跨实例 tab/window/Cookie/debugger 操作拒绝执行。
- 扩展创建的网页使用所属实例 Session、Mihomo、环境和 WebRTC 防护；工具栏另用无 Node 权限的隔离 Session。主实例停止时关闭其扩展浏览窗口、侧栏、通知及定时器，取消活动下载，不影响其他实例。
- 状态文件为实际 `session.getStoragePath()` 下的 `facet-extension-state.json`，原子写入并保留 `.bak`。含扩展书签、访问历史、下载记录、关闭页、可选授权、角标及侧栏配置。损坏状态明确失败并保留原文件。
- 已完成下载默认位于系统下载目录下 `Facet/<实例ID>/`。禁止相对路径越界、设备文件名与下载目录联接。同名并发请求预留各自路径，也避开已有 `.crdownload`。saveAs 在发起传输前打开原生保存选择，同一实例只允许一个待选择的保存框；取消不会启动下载。停止实例会取消活动下载并立即保存 USER_SHUTDOWN 状态。
- 可选授权仅在确认后持久化；写入尚未提交就失败时恢复原内存权限，不发送授权变化事件。原子写入若已经替换文件但无法确认目录持久化，则保留实际已写入状态并报告错误，沿用 `json-storage.cjs` 的提交状态语义。
- 重启保留书签、访问记录、完成下载及定时任务，窗口/target ID 不复用。重置环境同时清除兼容状态文件与备份；外部下载文件保留，不能把“重置网页环境”当作清空系统下载目录。
- 状态文件含浏览信息和下载路径，按实例私有数据处理；不要直接上传、写进 Git、复制到公开诊断材料。下载记录不自动导出为系统日志。

上限：每实例最多 32 个网页、8 个扩展浏览窗口、100 个活跃通知、20 个等待下载、500 个命名定时任务；书签 10000 项/64 层、历史摘要 5000 项/访问记录 10000 项、最近关闭页 25 项、下载记录 200 项。

## 验证与边界

测试均使用临时数据目录、真实 Electron/Chromium、实际文件和本机受控 HTTP/代理服务器。未操作用户正式实例和订阅。

```powershell
npm.cmd run check
npm.cmd run test:control-api
npm.cmd run test:extensions
npm.cmd run test:extension-compat-policy
npm.cmd run test:extension-compat
npm.cmd run test:extensions-electron
npm.cmd run test:extension-debugger-electron
npm.cmd run test:devtools-electron
npm.cmd run test:instance-reset-electron
npm.cmd run test:grid-transition-electron
git diff --check
```

兼容测试覆盖主/同源/跨源框架 ID 与 runtime.sender 比对、MV2 后台页/MV3 worker、回调错误、跨实例拒绝、真实页与窗口、Cookie、书签、侧栏、分组、截图、通知系统 show、下载文件字节/取消/Blob、实际 Mihomo 转发且直连命中为零、定时事件、Offscreen DOMParser、实际请求阻断/撤销、CDP、清理与整进程重启持久化。脚本输出 `report.json/resume-report.json` 的临时绝对路径，失败时非零退出。

原有回归覆盖扩展导入/移除/更新、存储隔离、DPR2 鼠标坐标、Mihomo 故障不回退直连、F12、环境重置及宫格输入保持。Buster 3.4.0 未改动程序包在受控网页完成框架查询、帮助页创建和角标检查；没有进行验证码、人机验证、语音识别或本机辅助程序完整业务验收。

### 2026-10-14 后续异常处理与原生交互验收

- 自动兼容专项 27 项、整进程重启 2 项通过；增加真实并发同名下载，各自产出 64 KiB 内容并逐字节比对；实例下载中停止后，磁盘状态明确为 interrupted / USER_SHUTDOWN。
- 最终回归曾在 MV2 消息接收方尚未就绪时得到空响应。验收脚本改为等待真实后台回复，并保留无回复超时失败；没有用默认 Tab 数据替代返回值，也没有修改断言。
- 边界单元 11 项通过。新增通知同步失败/等待状态/清除与替换/停机、权限拒绝/并发确认/写入失败回滚、下载文件名预留检查。这些单元测试的原生对象与对话框响应是受控替身，不计入真人授权或真实 Windows 点击验收。
- Windows 原生交互专项（dialogs-only 范围）3 项通过：实际保存得到指定临时文件及完整字节；原生取消后 HTTP 命中和下载记录不增加；停止实例自动取消真实权限确认框，未点击“允许”，授权保持未获得。随后重启仍可读取保存文件。
- 完整原生专项的通知点击等待超时，未收到 onClicked 回调，未标记通过；自动化工具没有提供可操作的测试通知窗口。通知系统 show、更新与 clear 的专项成功不等于真人点击已验证。

原生交互脚本使用临时数据，需真人或受允许的 Windows UI 工具选择/取消文件；权限允许/拒绝不能由 AI 代点。运行方式：

```powershell
# 保存新文件、取消第二次保存；实例停止自动关闭权限框。
npm.cmd run test:extension-native -- --dialogs-only
# 以上步骤后，还需点击“Facet 原生通知验收”。
npm.cmd run test:extension-native
```

报告包含 scope、实际结果与 errors；默认完整范围中点击超时属于未通过。`--dialogs-only` 只证明保存/取消/权限生命周期，不代表验证通知点击。脚本退出时关闭自己的实例和窗口，不关闭正式应用。

**未自动验收**：真人可选权限允许/拒绝、通知真人点击及所有第三方扩展完整流程；跨重启下载断点恢复仍未实现。不得把上述接口专项通过写成“所有插件兼容”。

## 接手与回滚

入口为 `extension-host.cjs`；`extension-compat.cjs` 按领域分发，tabs/data/downloads/notifications/alarms 各模块实现真实动作；`extension-compat-preload.cjs` 适配调用与事件。`extension-browser.html/js` 为真实扩展浏览窗口，Controller 管理主页面侧栏尺寸与生命周期。

修改主进程后必须重新启动 Electron。回滚使用本次最终功能提交的 `git revert`，修改前检查点为 `a57963e`；先停止需恢复的实例并复制其兼容状态文件及 `.bak`，不要删除原会话目录。旧源码不会读取新增文件，可保留以后恢复；回滚不撤销已经执行的网站数据清理或下载动作。

接口依据：[Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Chrome WebNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)、[Electron 扩展支持范围](https://www.electronjs.org/docs/latest/api/extensions)、[Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item)。
