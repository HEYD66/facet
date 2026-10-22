---
title: 后台页面与收藏导航卡顿修复
type: 项目验证
status: 已重启验收，公网加载仍有未解决项
created: 2026-10-22
updated: 2026-10-23
tags: [Facet, 导航, 后台, 回归]
---

# 现象与证据

实际运行的实例 2、比特01对照共进行八次界面切换，页面的 timeOrigin 和插件页面编号保持不变，未观察到切换造成重载。但千面被遮挡时，500ms 计时器在约48秒内仅执行7次，requestAnimationFrame 未执行；窗口置于前台后，实例2的空白内容恢复。短时计时器能够执行，不能据此保证长期后台抽卡稳定。

在独立 Electron 44.9.3 进程中使用真实 Controller、渲染界面、原生收藏浮层和 IPC 复现：网页正文已加载，但图片连接仍挂起时，收藏菜单的五个按钮全部禁用。网页自己的脚本跳转能够到达目标页，原导航请求却以 ERR_ABORTED (-3) 返回，被弹成错误。另有真实 Arena ERR_TIMED_OUT 记录，不能把网络超时一并视为导航取消。

# 修改

- 普通网页标签默认关闭 Chromium 后台节流；离开宫格时恢复该策略。宫格显式节能模式仍沿用原来的节流行为。后台执行可能增加 CPU 和内存使用。
- 收藏、旧快捷入口和检测网站不再因另一个导航仍在等待 load 完成而禁用。新的点击可以替换仍在加载的页面。
- 导航用实例运行对象、网页视图和递增序号判断是否已被替代。取消、页面替换或实例停止返回 `{cancelled:true}`；不把它称为页面已加载，也不弹失败提示。正常完成返回 `{loaded:true}`。真实网络故障仍返回错误。
- 会话、代理、环境、登录存储、收藏内容和页面持久化流程保留，不新增自动刷新、网络重试或轮询。

# 验证与边界

`npm.cmd run test:navigation-background` 使用独立临时数据目录和本机 HTTP 服务，不访问生产账号。覆盖隐藏页面计时及草稿保留、挂起资源时重新选择收藏、真实原生按钮替换导航、脚本跳转取消、真实网络断开报错、实例重启后的策略与本地存储。

修复前：后台1.8秒执行3次200ms计时；收藏禁用5项；成功跳转仍返回失败。修复后：后台计时执行9次、草稿不变；收藏禁用0项；点击新收藏约174ms到达本机目标页；取消有明确状态，断网仍报错；重启后策略和存储保留。174ms仅是本机受控测试结果，不代表公网网站加载速度。

已通过 `npm.cmd run check`（331 个脚本）、`npm.cmd run test:control-api`（1 项）、`npm.cmd run test:quick-links`（16 项）、`npm.cmd run test:browser-tabs`（含独立 Electron 重启恢复）、`npm.cmd run test:privacy-sites`（7 项）、`npm.cmd run test:grid-transition-electron`（4 项）及 `git diff --check`。宫格切回普通网页的两种模式均保留输入、页面标识和目标，没有重新请求主页面。图形界面测试顺序运行，避免多个窗口争夺焦点造成输入失败；一次并发运行的收藏测试在点击阶段超时，单独重跑通过。

完整 `tests/grid-electron.cjs` 未通过：“从未显示过的页面”的缩略图为空。使用检查点 `72364a0` 的原始 Controller 和网页标签模块，在同一 Electron 44.9.3 环境复测，得到相同失败；这属于现存问题，本轮没有改写断言或宣称宫格全量通过。两份结果分别保留在 `.local-dev/navigation-regression-artifacts/grid-current-first.json`、`.local-dev/navigation-regression-artifacts/grid-baseline.json`。第一次基线加载器因 `.cjs` 扩展处理器不存在而失败，修正为 Node 实际使用的 `.js` 处理器后完成了上述对照。

本轮不承诺修复代理节点或网站的真实网络超时；未向真实模型发送题目。修改主进程代码必须正常退出并重新启动应用，不能把独立测试通过写成生产已生效。本次授权重启及现场结果见下节。

本机完整证据保留在 `.local-dev/switch-check-20261022.json`、`.local-dev/switch-check-20261022-foreground.json`、`.local-dev/navigation-repro-20261022.json`、`.local-dev/navigation-background-before.json` 和 `.local-dev/navigation-background-after.json`，不进入发布包。

# 2026-10-23 重启与现场验收

用户明确授权“现在重启并验收”后，通过千面正常退出及“停止并退出”确认关闭原进程，原主进程 PID 28244 退出；使用同一源码目录的 `scripts/launch-electron.cjs .` 启动，新主进程 PID 57212，启动器 PID 45996，Electron 44.9.3、应用 0.2.18。源码修复提交为 `15f2a66`。启动终端退出后两进程仍存在，控制页和本机控制接口仍可访问。没有重新下载运行时或更改网络设置。

应用按原设置自动启动实例13；另外恢复重启前运行的实例2、比特01对照，保持原代理、环境和已保存标签。没有启动抽卡或提交模型消息。应用原有启动清理逻辑报告清理了4项已删除实例的残留目录；本轮没有另行删除实例或浏览资料。

## 已通过

- 真实实例2与比特01对照四次切换的控制界面耗时为56、50、56、48ms，页面 timeOrigin 均保持不变，没有因切换重载。
- 两个页面在约48秒内均执行96次500ms计时，最大间隔约703ms、518ms；实例2的 requestAnimationFrame 执行2867次。比特01对照当时尚未完成文档解析，rAF 为0，不能将计时通过解释为该站点已渲染完成。没有验证长时间自动抽卡或应用崩溃后的任务恢复。
- 在实例2中创建临时网页标签，真实访问收藏的 Arena；仍处于加载状态时打开原生收藏菜单，5个按钮全部可用、禁用0项。点击 ChatGPT 后，原导航约293ms返回 `{cancelled:true}`，未弹 ERR_ABORTED，目标标签 URL 已提交为 chatgpt.com，后续 loading=false。该结果证明导航已替换，不代表 ChatGPT 登录或业务功能验收。
- 关闭临时标签后核对：原有标签列表、活动标签、保存地址、代理配置和环境配置与测试前一致。最终停留实例2；实例13、实例2、比特01对照保持运行，抽卡均为 idle。
- 实例2页面正常显示，已有会话及侧栏保留。实例13最初有隐藏的 React 内容；选择该实例后恢复显示，未重载，页面标识保持不变。

证据：`.local-dev/switch-check-20261023-after-foreground.json`、`.local-dev/navigation-live-bookmarks-20261023.json`、`.local-dev/navigation-live-final-health-20261023.json`；启动输出位于 `.local-dev/navigation-restart-20261023.stdout.log`、`.local-dev/navigation-restart-20261023.stderr.log`。证据不包含控制令牌、Cookie或账号凭据。

## 未通过与限制

比特01对照仍有公网加载异常。首次 HTML 的响应结束约34.6秒，DOMContentLoaded约326秒，load约611.6秒；多个 arena.ai 脚本的资源时长约606秒。最终页面显示为未完整应用样式的HTML，不能宣布“网页加载慢、白屏全部修好”。现有证据只能把此项定位到该实例的页面资源加载链路，尚不能区分代理节点、站点返回、扩展规则或其他环节，未擅自切节点、DNS或清缓存。

现场最初尝试通过本机HTTP测试页验收，但实例代理配置使用 `<-loopback>`，本机地址也经过既有代理；测试服务没有收到请求，浏览器得到空的text/plain文档。该测试记录为失败，临时标签已恢复，没有把空页算作成功；最终改用真实收藏站点验证上述导航行为。此失败记录位于 `.local-dev/navigation-live-acceptance-20261023.json`。

启动输出仍含部分扩展权限兼容警告（如 cookies、downloads、sidePanel），本轮未修改扩展兼容层，也未据此断言白屏根因。完整宫格缩略图回归仍保留前文所述旧失败。

# 回滚

修改前 Git 检查点为 `72364a0`。优先撤销本修复提交并正常重启应用，避免覆盖后续工作。回滚不需要删除浏览资料、登录数据或修改代理。
