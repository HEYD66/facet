# 浏览页快捷网站

## 当前摘要（2026-10-13）

默认五个快捷网站仍沿用当前实例会话和网络，点击导航同一网页；`MAX_LINKS` 当前为 21，名称 1–24 字符、网址上限 2048 字符。用户删除为空后不会自动补回。

检测菜单单独包含 ipip.la、IPLeak、BrowserLeaks DNS、DNSLeakTest、IPPure 和 ip.net.coffee；旧同名 ipip.la 快捷项通过 `quickLinksRevision:2` 一次性迁移清理。菜单由受控原生浮层叠在网页上，不占额外工具栏高度。普通快捷管理的弹窗和检测浮层不能按同一种层级处理。

下方 2026-09-27 的 20 项限制和布局验证是历史；当前设置以 `quick-links.cjs`、`privacy-sites.js` 为准。详见 [项目手册](PROJECT.md)。

2026-09-27。使用浏览页标题行原有空白，不另加一排工具栏。

## 功能

默认 Arena（arena.ai/agent）、ChatGPT、Claude、Gemini、Grok。点击在当前已运行实例的现有WebContents内导航，不创建新实例、不打开系统浏览器，沿用当前session和代理。未启动/异常实例按钮禁用，后端也拒绝导航；不自动启动、不切换网络模式。

齿轮按钮打开管理窗口：添加、编辑名称/网址、上移/下移排序、确认删除。最多20项，名称1–24字符，网址最多2048字符。只接受HTTP/HTTPS，不接受javascript/file/data及带用户名密码的网址；未写协议时默认补https。长列表横向滚动，管理按钮保持可见。

快捷列表全局共用，保存在workspace-tools.json，与节点/IP收藏一起原子写入，不改动实例配置。旧数据缺少quickLinks时提供五个默认项；用户明确删空后不会自动补回。链接未加密，不建议放带临时口令的网址。删除快捷项不会关闭已打开网页或清除登录状态。

管理窗口覆盖浏览页时，隐藏原生WebContentsView；窗口缩放或状态刷新也保持隐藏，关闭后恢复。不使用与实例标签相同的data-tab事件字段。

## 验证

Windows命令cmd_5ff597003ebcf2703420f5464a912ad3054e8298cf8e2d5c exit0：check40、单元/内核46、快捷网站专项9，errors=[]。

专项通过真实Electron/preload/IPC和鼠标：五默认项不预加载、未启动拒绝打开；管理窗口原生视图遮挡；添加/修改/排序/确认删除及持久化；非法协议拒绝并保留输入；当前实例/切换实例导航与存储隔离；受控Mihomo代理实际路由及故障无直连；20个长标题在960×700、1280×800、1440×960三种窗口中的布局和末项点击。

Chromium模拟IPC界面15组通过。截图quick-links-bar-win32.png、quick-links-manager-win32.png来自Windows本机合成测试，不代表访问了五个公网网站或用户真实订阅。

没有强制重启生产实例，没有改写原有代理/指纹配置、旧asar或参考归档。网站登录要求和可用性由各站点决定。

原有功能最终Windows回归：cmd_5a3dcb5d399b61b7fabc8c03075a6a627065ece489f35d6d exit0，视口/IP专项11、完整Electron54，errors=[]。源码、报告与项目包同步更新，入口start.cmd不变。
