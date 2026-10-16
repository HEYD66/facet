# 内存统计与宫格截图

2026-10-16，源码改动，尚未打包发布。

## 统计口径

Windows 使用私有提交内存，单位 MB 按 1024² 字节换算；不是物理驻留量，也不是 GPU 专用显存。Electron 进程使用 getAppMetrics，实例的 Mihomo、进程保护及 GPU 采样辅助进程按已知 PID 读取 PrivateMemorySize64，每 5 秒更新。辅助采样失败或进程消失时标记 memoryComplete=false，不混入工作集冒充同一口径。

标题栏保留总数，悬停显示渲染进程、主进程、GPU、网络等、代理、进程保护和采样的分项。实例卡片计入该实例代理及保护进程；共享进程不能理解为独占，不能将所有实例卡片简单相加作为总数。CPU 仍是 Electron 进程统计，未包含 Mihomo 和保护进程的 CPU。

PowerShell 脚本从资源中读取并以编码命令执行，兼容 asar 内路径；只传本应用已知 PID，不输出命令行、配置或凭据。采样期间临时 PowerShell 自身的瞬时开销未计入。

## 截图限流

- renderer 最多一个缩略图请求在途；离开宫格、切换模式或布局版本变化后忽略旧结果。
- 主进程合并同时到达的截图请求，最多两个页面同时截图。
- 退出宫格或实例停止后，不继续排队截图，不接受已经过期的结果。
- 离开宫格清空缩略图缓存；未冻结或停止后台运行的实例，不改变指纹尺寸。

这主要限制截图峰值与重复工作，不承诺长期内存减少固定百分比。

## 验证

`node --test tests/grid-thumbnail-limit.test.cjs`：并发上限、单页失败、退出取消、renderer 去重和迟到响应。

`node scripts/launch-electron.cjs tests/memory-lifecycle-electron.cjs`：独立临时资料、本机真实 HTTP 隧道和 Mihomo，实际扩展 MV3 后台、弹窗、网页 Worker 和 F12；两次启动/停止检查网页销毁、扩展后台退出、Mihomo 与保护 PID 消失，以及 localStorage 跨实例重启保留。真实 JPEG 可解码，内存分项合计和界面提示正确。

进一步重复创建/删除实例、打开/关闭扩展弹窗，确认两处引用残留并修复：成功停止实例后解除网络请求采集监听并删除 session 记录；扩展页面销毁时移除 views 集合和当前 wc 引用，同一页面重复调用不会重复注册销毁监听。重新启动实例会重新注册网络采集，重新打开扩展仍可调用 API。没有新增清缓存、删除存储或强制终止共享进程的逻辑。

设置 `FACET_MEMORY_CYCLES=12`、`FACET_MEMORY_AUDIT=1` 后执行上述生命周期测试：12 次启停通过；5 次创建/启动/删除后的采集残留均为 0（修复前逐次增长至 6）；6 次弹窗打开/查询/关闭后的已销毁视图残留均为 0（修复前逐次增长至 6）。报告保留在本机临时目录 `facet-memory-lifecycle-16kAC0/report.json`。

补充扩展兼容回归 21 项通过，随后声明式网络规则拦截 fetch 断言失败；用修改前两个模块的备份做隔离对照，在同一断言失败，未归因于本次修改。该完整套件未通过，后续重启阶段未执行。误选的手动原生对话框测试已通过其测试控制接口结束，不计作通过。

关闭后 Chromium 可能保留公共缓存；上述测试不代表长时间运行无泄漏，也不覆盖所有第三方扩展或网站后台服务，不能据此判断 17 个实例占用 9GB 的全部原因。

相关回归：`npm.cmd run test:grid-transition-electron`、`npm.cmd run test:window-bar`。最低检查：`npm.cmd run check`、`npm.cmd run test:control-api`、`git diff --check`。

## 生效与回滚

重新启动千面主进程后生效；单纯刷新网页不更新主进程模块。验证仅使用隔离数据，未重启用户正在工作的实例。

回滚时恢复本次 app-metrics、controller、renderer/grid 和 window-bar 修改，移除新 grid-thumbnails/process-memory 模块；不要撤销同工作区独立的 toString 修改或订阅代理草稿。代码回滚不需要更改用户数据。

仅回滚本轮引用释放修复：使用 `C:\Users\24719\AppData\Local\Temp\facet-memory-fix-20261016-144240` 中 controller.cjs、extension-compat.cjs、memory-lifecycle-electron.cjs、MEMORY-PERFORMANCE.md 的修改前备份恢复各自原位置（若此后又有改动，先比较差异）。本轮未提交或打包。
