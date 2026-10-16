# 环境重置清理与失败恢复

2026-10-16：源码已修复，未打包发布。

## 行为

先停止目标实例，再原子保存 resetPending 标记和目标环境。标记写入失败时不会开始清理。之后清理网页数据、扩展本地和会话存储、兼容层状态、缓存和导入 Cookie 任务，验证 Cookie 为空后保存新环境。完成全部步骤后移除标记。

任一步骤失败会提示部分数据可能已清除，阻止该实例启动；再次点击重置环境会沿用目标方案重试。应用重新启动后仍执行这一约束。此流程可以继续完成，但不能恢复已清除的登录数据。

扩展包与启用选择保留；已安装但停用的扩展存储也清理。使用隐藏扩展上下文调用存储 API，期间阻断目标会话 HTTP/HTTPS/WebSocket 请求，结束后卸载清理上下文。重新启动扩展可能写入新的默认配置，网站也可能生成新访客 Cookie。外部文件、托管策略及服务器端账号不属于网页数据清理范围。

当前 Electron 不提供 Extensions.clearStorageItems；clearStorageData/clearData 也未清除 chrome.storage.local。直接删除数据库有文件锁问题，未采用。

## 验证

- tests/reset-storage-audit-electron.cjs：真实 Cookie、local/session storage、IndexedDB、CacheStorage、Service Worker、扩展 storage.local；另一个运行实例 Cookie 保留。
- 故障注入：标记写入失败不清数据；环境保存失败留下待重置状态，阻止启动，重试完成。
- 使用 --resume=<首次报告中的临时目录> 启动独立 Electron 进程：验证标记跨进程保留、重试和扩展存储为空。
- tests/instance-reset-electron.cjs：真实界面单个/批量重置、草稿清除、代理保留及环境持久化。
- 当前内核不支持 chrome.storage.sync，未宣称同步存储通过；没有穷举全部第三方扩展后台行为。

## 回滚

修改前备份：C:/Users/24719/AppData/Local/Temp/facet-reset-fix-20261016-153202。
恢复对应 controller.cjs、store.cjs、测试文件，移除新增 reset-extension-storage.cjs；如有后续改动先比较差异，不要撤销已有内存和指纹修复。

代码回滚不能恢复已删除的数据；存在 resetPending 的实例应先完成重试，再使用旧代码。本轮未提交或打包。
