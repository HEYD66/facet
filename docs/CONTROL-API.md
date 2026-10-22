# 本地控制 API 与 CDP

应用设置中的「外部控制（本机 API + CDP）」默认关闭。开启后，千面只在 `127.0.0.1` 监听，不接受局域网或公网连接。

更新：2026-10-22；以 v0.2.18 基线及当前源码（含尚未发布的节点端口服务）的 `control-api.cjs` 和 `ipc.cjs` 为准。[项目手册](PROJECT.md) 说明架构、数据和恢复。端口/路径从当前界面获取，不写死。订阅指定代理字段尚未接入，见 [专项状态](SUBSCRIPTION-NETWORK-DIAGNOSTICS.md)。

## 端口和隔离

- API 端口用于启停实例、跳转页面和查询状态。
- CDP 端口是应用级端口，所有运行中的实例页面会作为独立 target 出现在该端口下。
- 当前源码提供互斥的实例独立代理与节点端口共享模式。独立模式下每个代理实例一个核心和临时端口；共享模式的 Mihomo 代理端口按完整节点配置和网络策略分配：多个实例使用同配置节点时可共用端口，不同配置节点分开。它和 API/CDP 端口无关；Cookie 与网站存储仍按实例分区隔离。
- API 令牌只保存在本机 `control-api.json`，界面可重新生成。

v0.2.18 候选包包含的修复：外部 CDP 在原配置端口经过本机协调网关，内部仍使用私有命名管道；网页 / Worker 环境初始化完成后才转发相应附着事件和恢复命令，防止 Playwright 抢先恢复首段。`chromium.connectOverCDP` 的连接方式不变，支持 Browser 与 page WebSocket，多个客户端使用独立 CDP 会话。此通道目前支持 Windows x64。HTTP 发现入口支持 `/json/version`、`/json/list` 和 `/json`；未实现原生 `/json/protocol` 或托管 DevTools 前端，不能据此宣称所有第三方 CDP 工具兼容。

Electron 的持久会话具有各自的 Chromium `browserContextId`；Playwright 对 Electron 不认识的上下文可能都归入同一个默认 `BrowserContext` 包装对象，因此不要用 `page.context()` 是否相同判断实例存储是否隔离。继续按 API 的 instanceId 与 CDP targetId 选页；本次真实测试另核对 Cookie / localStorage 和重启持久化。

## 连接步骤

1. 打开「应用设置」，打开「允许本机外部工具控制实例」开关。
2. 复制界面显示的 API 地址、CDP 端口和令牌。
3. 重启千面，让 CDP 端口生效。
4. 请求 `GET /v1/targets`，按 `instanceId`、`tabId` 和 `active` 找到对应页面的 `targetId`。
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

## 批量创建节点分配（当前源码）

普通新建的 `instance-new-plan` 返回自动选择的未分配可用节点及 `sourceVersion`。确认自动方案时传 `requireUnusedNode:true` 和该版本；写入前再次验证连通记录、分配与源版本。界面手动修改节点后解除自动方案限制，仍允许显式复用。AI 的 `create random:true` 同样排除已分配配置并实测连通与出口地区；环境重置按原约定保留代理，导入与手动指定节点不强制独占。

通过 `/v1/actions` 调用 `instance-batch-options` 获取节点的 `available`（最近有效连通检测）、`usage`（已保存分配数，包含停止实例）和出口信息，不包含节点凭据。

`instance-batch-plan` 的代理模式使用 `mode:"mihomo"`：

- `allocation:"unique"`：界面默认值。仅从 `usage:0` 且最近连通检测成功的节点中随机分配，不要求延迟数值、不按延迟排序。同配置节点跨订阅或改名后仍去重；数量不足报错，不自动复用。`nodes:[]` 使用全部符合条件的节点；指定 `nodes:[{sourceId,name}]` 时仅在该范围内选择。
- `allocation:"cycle"`：显式允许按所选顺序循环复用，必须提供非空 `nodes`。`random:true` 仍为每个实例生成独立随机环境。

取得草稿 `token` 后，用 `instance-batch-create` 确认创建。独占模式在首次写入前和逐项创建时重新检查节点，防止预览后被其他实例分配；地区同步仍通过所选代理查询，失败项不创建。查询 snapshot 的 `batchCreation` 和最终逐项结果确认实际创建数量；`instance-batch-cancel` 停止后续创建，保留已创建实例。

停止操作会中断当前尚未写入的出口地区查询；取消项不计作失败，已保存实例保留。应用退出时，尚未写入的创建请求不能继续保存。普通创建也会在写入前核对节点源版本及完整配置，不依赖调用者提供 `sourceVersion`；查询期间源已更新、节点被删除或排除时，拒绝保存旧节点。

## 新建实例的默认扩展（2026-10-23，当前源码未发布）

通过 `POST /v1/actions` 调用：

```json
{"action":"extension-default-set","extensionId":"<已导入扩展ID>","enabled":true}
```

`enabled` 必须是布尔值。返回 `value` 为 `{extensionId,enabled,changed}`；相同设置返回 `changed:false`，不重复写入。设置不存在的扩展或保存失败会返回错误。该操作只设置之后新建实例的默认扩展，不改变、停止或重启已有实例，不需要实例 `id`。

普通创建、批量创建、`POST /v1/instances` 与 AI 创建均继承当前已开启的默认扩展，持久化到新实例启用列表。关闭默认不会移除旧绑定；重置和导入不套用新默认。创建时默认扩展配置保存失败会返回 `configurationError`，实例已创建但保持停止，调用方必须检查该字段，不能只依据 HTTP 成功状态。

## 实例内网页标签（当前源码）

顶部横向实例切换栏选择环境，宫格等全局页面也保持显示；地址栏上方管理该实例的网页标签。标签共享所属实例的 Session、代理与环境，不额外启动代理核心。不同实例仍使用独立存储分区。每个实例最多 32 页。

通过 `POST /v1/actions` 调用：

| action | 参数 | 结果 |
| --- | --- | --- |
| `tab-list` | `id` | `activeTabId` 与全部 `tabs`（含未加载的恢复页） |
| `tab-new` | `id,url?`、`active?`（默认 true） | `tabId,webContentsId`，默认打开 `about:blank` |
| `tab-activate` | `id,tabId` | 切换或按需加载指定页，不重新加载已有页 |
| `tab-close` | `id,tabId` | 关闭指定页；最后一页关闭时创建空白页，实例保持运行 |

`tabId` 是持久化 UUID，不能跨实例使用；它与 Chromium 的数字 `webContentsId`、CDP `targetId` 及扩展 `chrome.tabs` 数字 ID 不同。`GET /v1/targets` 只枚举实际加载的网页，含 `instanceId,tabId,active,webContentsId,targetId`。先激活未加载的恢复页，再重新查询 target。现有 navigate/reload/F12 等操作作用于当前活跃网页。

URL 列表、顺序和活跃页写入实例配置；完整退出后只恢复活跃网页，其他网页选中后加载。未提交输入和网页内存仅在运行中切换时保留，不能跨进程恢复。普通 target=_blank 链接打开为网页标签，带独立窗口要求的登录弹窗维持原流程。

## 请求和结果

### 节点端口服务（当前源码）

通过 `POST /v1/actions` 调用，仍要求本机控制 API 的 Bearer 令牌：

| action | 参数 | 结果 |
| --- | --- | --- |
| `proxy-mode-set` | `mode: "instance"/"node"`、`confirmed:true`（有运行实例、检测或外部端口时必须） | 切换互斥模式，返回 `mode`、`changed`、`restarted`、`restartFailed` 和节点 `failed` 明细 |
| `node-ports-set` | `enabled: true/false`、`confirmed:true` | 兼容入口：true 切到共享模式，false 切回独立模式；不是单独关闭外部常驻引用 |
| `node-ports-sync` | 无 | 同步当前节点库并重试失败节点；服务需先开启 |
| `node-port-copy` | `sourceId`、`name`、`protocol: "http"/"socks5"` | 仅对真实运行的端口复制地址，返回 `copied` 与 `port` |
| `node-ports-copy` | 无 | 复制全部已运行节点地址，返回数量 |

控制界面 `snapshot` 的 `nodePorts` 包含 `mode`（instance/node）、`switching`、开关、共享进程数、监听端口数、同步状态及最近逐节点失败明细；`library[].nodes[].localProxy` 提供 `port`、`running`、`external`，不含节点配置或密码。`instances[].proxyPort` 可相同，不能把端口当作实例唯一身份。仍以实例 ID 和 CDP target 区分网页。

两种模式全局互斥；切换会取消检测、停止代理实例并回收旧模式代理后再启动新模式和恢复实例，直连实例保持运行。切回独立模式关闭全部共享节点端口，端口映射保留。未保存的网页输入可能丢失；失败会尝试恢复原模式。`restarted` 为已恢复的实例 ID，`restartFailed` 非空表示部分实例未恢复，应检查实例状态和网页 target。配置导出或其他配置任务期间拒绝切换；切换中拒绝新的实例和检测变更。订阅变更产生新端口时，运行实例仍沿用保存的旧配置与端口。端口只监听回环，不能作为公网代理；HTTP API 令牌不用于 mixed 代理端口。关闭千面后代理端口也关闭。

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

`extension-configure` 仍需 `confirmed:true`。更改后自动恢复原先运行的目标实例，停止的实例保持停止；重复提交相同启用状态不重启。返回的 `value` 含 `id`、`extensionId`、`enabled`、`changed`、`stopped`、`restarted` 和 `restartFailed`；后两项分别是已恢复的实例名称列表与 `{id,name,error}` 失败列表。`ok:true` 可能表示配置已保存但恢复运行失败，必须继续检查 `restartFailed`、实例状态和网页 target。保存失败返回 `ok:false`，并尝试按原配置恢复；退出过程中不重新启动实例。网页会重建，未保存输入可能丢失。

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

## 诊断导出（v0.2.13 待发布构建）

`export-logs` 保持操作记录数组格式，界面名称为“导出操作记录”。`export-diagnostics` 通过原生保存框导出 `facet-diagnostics` v2 JSON；含跨重启输出、网络任务、检测历史和采集范围。返回条目计数和采集 warning。`runtime-output` 返回最新最多 1000 行，详细包最多 5000 行。API 不接受任意保存路径，返回取消不等于已生成文件。字段与限制见 [详细诊断](DIAGNOSTICS.md)。
