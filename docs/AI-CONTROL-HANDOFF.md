# 千面 Facet：AI 与自动化接手说明

这份文档给接手项目的 AI、Playwright 脚本和本地自动化工具使用。内容不包含 API 令牌、Cookie、订阅链接或代理凭据。

整体架构、数据/恢复、构建与发布见 [项目总览](PROJECT.md)，专题入口见 [文档索引](README.md)。v0.2.13 安装包一并附带项目 Markdown 文档；旧安装包仅附带当时构建配置指定的接手文件，不自动获得后来新增的文档。

2026-10-14：详细诊断采集和导出已在 v0.2.13 发布，见 [日志说明](DIAGNOSTICS.md)。[订阅指定代理](SUBSCRIPTION-NETWORK-DIAGNOSTICS.md)仍未接线；不要把设计字段当作已可调用 API。

## 1. 先确认项目和运行状态

确认当前 Electron 进程的 `--app-path` 与项目根目录一致，不要根据旧安装包或旧目录名猜测运行副本。开发启动入口：

```powershell
npm.cmd start
```

修改 `src/main/` 后必须重启 Electron 主进程；只刷新控制页面不会重新加载主进程 API、IPC 或控制端口。

修改前先执行：

```powershell
git status --short
git branch --show-current
```

## 2. 启用本地控制

在「应用设置 → 外部控制（本机 API + CDP）」打开开关。应用只监听 `127.0.0.1`，不会接受局域网连接。API 地址、CDP 端口和令牌必须从当前界面读取，不要从日志、截图或仓库猜测令牌。

请求认证格式：

```text
Authorization: Bearer <当前令牌>
```

令牌只放在当前进程的环境变量、内存或临时脚本中，不能写入 Markdown、Git、诊断包或测试输出。

## 3. 推荐控制顺序

1. `GET /v1/status`，确认 API 正在监听。
2. `GET /v1/instances`，用实例 `id` 定位目标，不要只用显示名称。
3. 需要网页控制时，先 `GET /v1/targets`，按 `instanceId` 找 `targetId`。
4. 使用专用实例接口或 `/v1/actions` 执行一个动作。
5. 再次查询实例状态和 targets，确认后端状态已经改变。
6. 需要让用户界面跟随时调用 `focus`，或使用会自动跟随的启动、刷新、跳转接口。

## 4. 实例生命周期

创建停止状态的直连实例：

```json
POST /v1/instances
{"name":"自动化测试实例"}
```

创建后立即启动：

```json
POST /v1/instances
{"name":"自动化运行实例","start":true}
```

| 操作 | 请求 |
| --- | --- |
| 查看实例 | `GET /v1/instances` |
| 启动 | `POST /v1/instances/<id>/start` |
| 停止 | `POST /v1/instances/<id>/stop` |
| 刷新页面 | `POST /v1/instances/<id>/reload` |
| 跳转网址 | `POST /v1/instances/<id>/navigate`，body 为 `{"url":"https://example.com"}` |
| 让界面跟随 | `POST /v1/instances/<id>/focus` |
| 删除 | `DELETE /v1/instances/<id>` |

删除前必须重新查询目标 ID，并确认用户要求的删除范围；删除后的配置和浏览存储不能通过普通界面撤销。

## 5. 通用操作入口

`POST /v1/actions` 复用控制界面使用的 `facet.request` 操作分发器，不需要为每个按钮重复实现后端逻辑。

请求格式：

```json
{"action":"<操作名>","id":"<实例ID>","其他字段":"沿用界面请求字段"}
```

已覆盖实例、代理、订阅、检测、扩展、环境、布局、日志诊断、更新和快捷链接等界面操作。界面已有的确认字段仍然有效，例如扩展配置或删除需要显式传入 `confirmed:true`。需要选择本地文件或原生确认框的操作会显示千面原生对话框；当前 API 不伪造用户点击确认。

## 6. CDP 与 Playwright

CDP 是应用级端口。当前源码有互斥的实例独立代理（默认）与节点端口共享模式；前者每个实例独立核心和临时端口，后者按完整节点配置和网络策略分配端口，多个实例可能共用同一节点端口。切换通过 proxy-mode-set，会重启原先运行的代理实例，需检查 restarted / restartFailed；通过实例 ID 与 target ID 区分页面，不能使用代理端口作为实例标识。端口服务动作与外部软件连接方式见 CONTROL-API.md。运行中的每个实例网页是独立 target：

```text
GET http://127.0.0.1:<CDP端口>/json/list
```

先调用 `/v1/targets`，按 `instanceId` 保存 `targetId`，再连接 CDP。不要按列表序号选页面，因为实例启动、停止和弹窗都会改变顺序。

```js
const target = targets.value.find(item => item.instanceId === instanceId);
if (!target?.targetId) throw new Error('目标实例没有运行中的页面');
const browser = await chromium.connectOverCDP(cdpAddress);
let page;
for (const candidate of browser.contexts().flatMap(context => context.pages())) {
  const session = await candidate.context().newCDPSession(candidate);
  try {
    const info = await session.send('Target.getTargetInfo');
    if (info.targetInfo.targetId === target.targetId) page = candidate;
  } finally {
    await session.detach();
  }
  if (page) break;
}
if (!page) throw new Error('目标实例页面未找到');
await page.bringToFront();
```

CDP 只控制网页内容；实例、代理、环境、扩展、日志和持久化状态通过本地 API 或 `/v1/actions` 完成。

`cdpAddress` 从当前连接信息获取；同 URL 实例必须按 targetId 区分，停止/重建后重新查询。`bringToFront()` 不等于管理界面跟随，必要时通过 API focus。API 的 Bearer 鉴权不等于 CDP 自身具备同一鉴权。

## 7. 验证要求

请求返回 `200` 或 `201` 只表示请求被处理，不能单独作为完成依据。每次变更至少检查：API 的 `ok/value`、实例实际状态和网址、需要网页控制时的 `/v1/targets` 与 CDP 页面 URL，以及重启后的持久化结果。

源码变更的最低检查：

```powershell
npm.cmd run check
npm.cmd run test:control-api
git diff --check
```

## 8. 安全边界

- API 默认关闭，只允许本机回环地址访问。
- 不把 API 或 CDP 端口映射到公网、局域网或代理节点。
- 不把令牌写入 issue、提交信息、截图、诊断包或长期日志。
- 不擅自修改 DNS、代理、环境指纹或网络模式；先读取当前值，再做最小变更。
- 不把“页面显示成功”当作后端成功；必须查询实例状态和持久化结果。
- 不能确认目标实例、文件路径或删除范围时，先停止并只读盘点。

## 9. 交接模板

```text
项目根目录：<实际绝对路径>
当前分支：<git branch --show-current>
启动方式：npm.cmd start / 安装包入口
控制 API：从应用设置读取，不在交接文本中写令牌
CDP：从应用设置读取，按 /v1/targets 的 instanceId 选择 target
当前任务：<要完成的操作>
已验证：<接口、页面、持久化和构建检查>
未验证或限制：<明确写出>
回滚：<Git 提交哈希或具体恢复步骤>
```

