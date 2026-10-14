# 本地控制 API 与 CDP

应用设置中的「外部控制（本机 API + CDP）」默认关闭。开启后，千面只在 `127.0.0.1` 监听，不接受局域网或公网连接。

更新：2026-10-14；以 v0.2.13 的 `control-api.cjs` 和 `ipc.cjs` 为准。[项目手册](PROJECT.md) 说明架构、数据和恢复。端口/路径从当前界面获取，不写死。订阅指定代理字段尚未接入，见 [专项状态](SUBSCRIPTION-NETWORK-DIAGNOSTICS.md)。

## 端口和隔离

- API 端口用于启停实例、跳转页面和查询状态。
- CDP 端口是应用级端口，所有运行中的实例页面会作为独立 target 出现在该端口下。
- 实例自己的 Mihomo 代理端口仍按实例独立分配，和 API/CDP 端口无关。
- API 令牌只保存在本机 `control-api.json`，界面可重新生成。

## 连接步骤

1. 打开「应用设置」，打开「允许本机外部工具控制实例」开关。
2. 复制界面显示的 API 地址、CDP 端口和令牌。
3. 重启千面，让 CDP 端口生效。
4. 请求 `GET /v1/targets`，按 `instanceId` 找到对应页面的 `targetId`。
5. Playwright 使用 `chromium.connectOverCDP('http://127.0.0.1:<CDP端口>')`，再根据 URL/title 或 `targetId` 选择页面。

## API

所有请求都要带 `Authorization: Bearer <令牌>`。

- `GET /v1/status`
- `GET /v1/instances`
- `GET /v1/targets`
- `POST /v1/actions`，调用与界面相同的本地操作通道，JSON 至少包含 `{"action":"start","id":"实例ID"}`；其余字段沿用界面请求参数
- `POST /v1/instances`，JSON body 至少包含 `{"name":"新实例"}`；默认直连且不自动启动，可用 `start:true` 明确启动
- `DELETE /v1/instances/<实例ID>`
- `POST /v1/instances/<实例ID>/start`
- `POST /v1/instances/<实例ID>/stop`
- `POST /v1/instances/<实例ID>/reload`
- `POST /v1/instances/<实例ID>/focus`（让千面界面跟随到该实例的浏览页面）
- `POST /v1/instances/<实例ID>/navigate`，JSON body：`{"url":"https://example.com"}`

`/v1/actions` 还支持 `{"action":"toggle-devtools","id":"实例ID"}`，切换当前实例右侧停靠的开发者工具；在实例浏览页面中按 F12 也可切换。开发者工具右侧面板与网页之间提供可拖动分隔条，可调整两侧宽度。开发者工具随实例停止而关闭，不会改变 CDP 端口或其他实例。

`/v1/actions` 复用界面已有的操作分发器，因此实例、节点源、订阅、检测、扩展、环境、布局、日志诊断、更新和快捷链接等操作使用同一套校验与持久化逻辑；需要选择本地文件或原生确认框的操作仍会由应用窗口显示对应对话框。

启动、刷新和跳转接口也会自动发送跟随通知；如果千面当前停留在设置或全局页面，会切换到目标实例的浏览页面。

API 和 CDP 只用于本机脚本自动化；不要把端口映射到公网，也不要把令牌提交到日志、工单或版本库。

## 请求和结果

请求使用 `Authorization: Bearer <当前令牌>`，JSON 操作使用 `Content-Type: application/json`，请求体最多 128 KB。

| 情况 | 状态与结果 |
| --- | --- |
| 普通接口完成 | 200，`{"ok":true,"value":...}` |
| 创建接口完成 | 201，继续检查 value 的 `created`、`started` 和错误字段 |
| 缺少/错误令牌 | 401，`ok:false` |
| 参数或操作失败 | 400，`ok:false` 与 error |
| 未知接口 | 404，`ok:false` |

OPTIONS 预检不表示业务授权，CORS 不能代替令牌。`ok:true` 也不表示长任务全部完成：批量创建、检测、导出等需继续查询 snapshot、任务进度、targets、磁盘及最终文件。

## 通用动作分类

完整字段以 `ipc.cjs` 和对应 renderer 请求为准；下表不代替每个动作的确认和数据校验。

| 领域 | 已有动作举例 | 完成依据 |
| --- | --- | --- |
| 实例 | `create`、`rename`、`start`、`stop`、`remove`、`instance-notes`、`instance-autostart` | ID、实际状态、持久数据 |
| 环境 | `settings`、`fingerprint-preset`、`reset-environment`、`instance-reset-many` | 草稿/保存区别；重置后网站数据和新环境 |
| 代理 | `library-save`、`library-rename`、`library-remove`、`library-assign`、`library-assign-many` | 全局源与独立实例副本 |
| 检测 | `diagnostic-start`、`diagnostic-cancel`、`diagnostic-history`、`node-network-save` | 任务结果和网络设置作用范围 |
| 扩展 | `extension-import`、`extension-configure`、`extension-remove`、`extension-open`、`extension-refresh` | 确认范围和真实扩展功能 |
| 迁移 | `instance-export`、`instance-import-inspect`、`instance-import-commit` | 文件选择、归档复读校验与下游状态 |
| 日志/更新 | `runtime-output`、`export-logs`、`export-diagnostics`、`update-check`、`update-download`、`update-install` | 当前日志覆盖、校验与确认退出 |
| 浏览工具 | `toggle-devtools`、`navigate`、`audio-volume`、`audio-mute`、`quick-link-open` | 目标实例页面与 UI 跟随 |

扩展移除需 `confirmed:true` 和本次确认的 `instanceIds`；启用范围发生变化则拒绝，需重新盘点。专用 DELETE 不替用户弹出确认，调用者先获得明确删除授权。导入/导出/目录选择仍可能要求原生交互，API 不伪造已选文件。安装要求 `confirmed:true`。

## 精确选择网页 target

targets 返回 instanceId、instanceName、webContentsId、targetId、URL 和 title。多个实例可访问同一 URL，名称可变，停止/重建页面后 targetId 变化；按 URL 或序号不能可靠定位。

```js
// targets.value 来自已认证 GET /v1/targets；instanceId、cdpAddress 从当前连接状态取得。
const target = targets.value.find(x => x.instanceId === instanceId);
if (!target?.targetId) throw new Error('目标实例没有可用网页');
const browser = await chromium.connectOverCDP(cdpAddress);
let page;
for (const candidate of browser.contexts().flatMap(x => x.pages())) {
  const session = await candidate.context().newCDPSession(candidate);
  try {
    const info = await session.send('Target.getTargetInfo');
    if (info.targetInfo.targetId === target.targetId) page = candidate;
  } finally {
    await session.detach();
  }
  if (page) break;
}
if (!page) throw new Error('页面已变化，请重新查询 targets');
```

管理界面跟随通过实例 focus；网页 bringToFront 不等同于千面管理路由切换。HTTP API 令牌不同时保护原生 CDP；本机可访问调试端口的工具拥有较强页面控制能力。按需关闭外部控制并重启，以关闭 CDP。
