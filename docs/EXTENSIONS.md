# 本地浏览器扩展

## v0.2.17：ZIP 导入

- 扩展中心新增「导入 ZIP」，保留「导入解压扩展」。支持根目录清单或唯一嵌套扩展目录；多个候选清单时拒绝猜测。
- 解压后沿用权限确认、托管复制和按实例启用流程，默认禁用。取消导入不会写入扩展索引。
- 保留原 ZIP 路径，单项/全部更新可重新读取 ZIP，并沿用更新并重启及权限变更确认。
- ZIP 文件及实际解压内容上限各 500MB，最多 50000 条目、64 层；拒绝加密、路径越界、符号链接、重复路径及 CRC 损坏。支持标准 stored/deflate ZIP；不保证所有非标准打包工具输出兼容。
- CRX 与商店直装仍不支持；以下旧版本 ZIP 待做记录属于历史。
- 验证入口：tests/extension-zip.test.cjs、tests/extension-zip-ui-electron.cjs；tests/extension-refresh-electron.cjs 加 --zip 验证真实加载及更新。


## 当前源码的 API 补充（2026-10-14）

v0.2.13 补充框架查询、标签/窗口、通知、下载、Cookie、书签、历史、定时任务、工具栏角标、侧栏及实例内调试等常用接口；方法、可选参数、数据存放与实际验证边界见 [扩展兼容层](EXTENSION-COMPATIBILITY.md)。下文 v0.2.12 的有限 debugger 命令清单是原发行实现，当前支持范围以新文档为准；不能将接口专项通过视为 Buster 等第三方扩展完整业务通过。

## 当前摘要（2026-10-13，v0.2.12）

- 入口是全局“扩展中心”，地址栏右侧放当前实例扩展图标，拼图按钮打开菜单。解压目录权限确认后复制到 `extensions-packages/`，默认禁用；索引与实例绑定在 `extensions.json`。
- 支持按实例启停、批量选择、面板/设置、更新检查和权限变更确认；按确认范围停止受影响实例。
- 移除可以确认后由后端停止使用该扩展的实例、解除绑定并移除程序，不要求用户先逐一停用；范围变化拒绝旧确认。保留实例登录与扩展存储。
- 实例内有限 debugger 适配已纳入 v0.2.12，不开放任意跨实例命令；外部统一 CDP 保留。
- CRX3/ZIP 仍待做。Electron API 限制、Dark Reader 历史功能失败保留，加载成功不代表可用。
- 下方早期阻塞/旧布局/移除步骤属于历史，当前摘要优先。Windows恢复结果见“最终验收”。

完整架构见 [项目手册](PROJECT.md)，阶段状态见 [交付状态](UX-DELIVERY-STATUS.md)。

## 待做：CRX3 / ZIP 扩展导入

- [ ] 状态：2026-10-08 用户确认列入待做，尚未开发。
- [ ] 将扩展中心入口统一为“导入扩展”，保留解压文件夹导入，新增 CRX3 和 ZIP 文件选择。CRX2 后续按实际需求评估。
- [ ] 导入时自动校验、解包，再接入现有托管目录和按实例加载流程；展示名称、版本、权限、CRX 签名校验结果及兼容性提示，默认不启用。
- [ ] CRX3 校验签名、签名身份与包完整性；签名有效不表示插件安全或已通过商店审核。ZIP 明确标记为无 CRX 签名。
- [ ] 拒绝路径穿越、绝对路径、符号链接、异常包头、损坏包和解压超限；限制输入大小、解压总大小、文件数量和目录深度，失败清理临时目录并保留已有扩展。
- [ ] 同一插件再次导入时支持更新已有插件；维持扩展身份和托管路径，保留实例绑定及各实例扩展存储，权限增加时明确提示，失败可回滚。
- [ ] 验收覆盖真实 CRX3 / ZIP 导入、实际网页功能、两实例数据隔离、更新与重启持久化，以及签名篡改、损坏包、路径穿越、解压超限、取消和更新失败回滚。

边界：支持包格式不会自动补齐 Chrome API，也不代表支持 Chrome 商店一键安装或扩展自动更新。继续按插件逐项验证真实兼容性。

依据：[Electron 扩展加载说明](https://www.electronjs.org/docs/latest/api/extensions)、[Chromium CRX3 格式定义](https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/crx3.proto)。

## 已实现

左侧全局管理新增“浏览器扩展”，导入后在此统一分配给实例。导入解压文件夹后先复制到应用托管目录，显示权限、可选权限和内容脚本范围，经用户确认后保存；默认不启用、不启动实例。最多20个包，每包500MB、50000目录/文件（自动跳过 .git、.svn、.hg、.vscode、.idea、node_modules、__pycache__ 及 Thumbs.db 等开发/系统文件，清单引用 node_modules 时保留；确认框列出跳过项；超限时提示实际大小和占用最多的子文件夹；根目录缺 manifest.json 时列出其中的扩展子文件夹），拒绝符号链接、目录联接、祖先目录递归导入和跨目录页面路径。

启用/停用需要明确确认，只停止目标实例并保存选择；更改完成后自动恢复原先运行的实例，原本停止的实例保持停止，无关实例不受影响。未保存的网页输入可能丢失。恢复失败会单独显示实例和错误；保存失败时尝试按原配置恢复运行。无实际变更时不重启。停止时卸载扩展并关闭该实例的扩展面板，避免内容脚本和后台继续存活。再次启动从持久配置加载；扩展chrome.storage.local按独立持久session隔离。启动失败不忽略选中的扩展：明确报告错误并阻止实例继续浏览，可停用后重试。

扩展面板/设置页使用相同实例的session和代理，不带控制窗口preload，没有Node权限，不允许随意弹出新窗口或离开扩展自己的来源。只有清单声明的面板/设置入口能通过控制IPC打开。生产sandbox、contextIsolation、webSecurity不降低。

### Arena Trace Inspector 3.x：实例内 CDP 兼容

Electron 不提供扩展侧 `chrome.debugger`。千面为声明 `debugger` 权限的扩展提供受限兼容层：复用该实例已经用于环境和视口控制的 CDP 连接，并转发 `Network.responseReceived`、`Network.dataReceived`、`Network.loadingFinished` 和 `Network.loadingFailed` 事件；允许的命令仅包括 `Network.enable`、`Network.disable`、`Network.streamResourceContent` 和 `Network.getResponseBody`。

兼容层的 `attach` / `detach` 是扩展监听生命周期，不会关闭千面自己的 CDP。目标必须是当前实例页面，不能跨实例读取；因此 Arena Trace Inspector 在每个实例内分别开启/停止检测。外部统一 CDP 端口仍按 `/v1/targets` 暴露所有运行实例，不受此适配影响。

这项兼容只解决调试器和网络事件适配，不绕过 Arena 接口认证；`/cost`、Trace 或其他接口返回 401/403 时，仍按服务端权限和当前会话处理。

程序文件全局共用，各实例分别选择；所有实例停用后才能移除程序包。移除保留实例登录和扩展存储，删除实例时才按原流程清除该实例数据。暂不支持商店一键安装、CRX/ZIP直装、自动更新、完整Chrome工具栏/右键菜单/命令快捷键或任意Chrome API。扩展不会被自动装入用户实例。

## 兼容性不是“加载成功”

Electron官方仅支持部分Chrome扩展API：
https://www.electronjs.org/docs/latest/api/extensions
https://www.electronjs.org/docs/latest/api/extensions-api

已加载状态不等于扩展功能全部正常。扩展声明权限由Chromium按可支持部分处理；显示权限不是提供完整Chrome权限管理。只导入可信扩展。

### Dark Reader 4.9.133：当前未通过功能验证

仅在隔离Linux Electron44.4.5测试，不涉及生产实例。官方MV2和MV3包均可被加载，但在受控页面上没有注入darkreader样式、背景仍为白色；MV2面板显示Loading, please wait，后台报错Cannot read properties of undefined (reading onRemoved)。MV3探测也未实现网页变暗。不能将其宣传为已支持；界面明确提示该版本初测失败，Windows仍待验证。未通过篡改官方扩展、伪造API成功或降低沙盒来掩盖问题。

仅供验证的官方包存放在项目之外的extension-validation，不随生产项目包预装：
- https://github.com/darkreader/darkreader/releases/download/v4.9.133/darkreader-chrome.zip
  SHA256 3515b14f96bee900be6f606c1d2b4e0272440261a46c2b14f77917b25e89890e
- https://github.com/darkreader/darkreader/releases/download/v4.9.133/darkreader-chrome-mv3.zip
  SHA256 a5a1a9c78d377fafd8c9190ce9d57b96f89bc95d21f077888601e4c445b20ebf

## 已实测与阻塞

本地：check47；51项单元/内核；扩展专项11（真实Electron）；旧快捷/主题15、视口/IP11、完整Electron54；Chromium模拟IPC15+8。扩展专项验证导入取消/确认、复制和默认禁用、目标实例启停、内容脚本、扩展面板无控制桥/Node、两实例storage.local隔离、停止卸载/重启存储保持、移除保护、错误包阻止启动、固定视口DPR2角落鼠标、后台Mihomo路由和内核失败卸载无直连，以及三尺寸夜间管理页。

回归发现：Linux DPR2鼠标专项在仅等待网页标题和150ms后偶发失败；一次旧Controller对照通过并不能证明扩展是根因。未选扩展时保留原启动路径避免额外异步等待；测试补充等待viewportWork和原生capturePage合成帧后再发送真实鼠标点击，不跳过坐标断言。另增加启用扩展时固定视口DPR2的真实鼠标断言。最终复测结果以日志为准。

开发连接再次返回530 Cloudflare Tunnel error。本轮源码尚未同步到Windows，不能把此前Windows报告当作本轮证明。Windows扩展专项、完整回归、项目包更新和远端任务终结均待恢复连接。Linux截图不是Windows交付证明。

## 测试命令

npm run test:extensions
npm run test:extensions-electron
npm run test:extension-debugger-electron

Dark Reader可选验证路径由DARK_READER_DIR指定；默认项目旁extension-validation/darkreader。不提供验证包时不执行Dark Reader探测。普通扩展单元和受控Electron测试不依赖它。

最终本地整链日志extensions-final-verified.txt exit0；DPR2等待合成帧后连续三次专项及整链均通过。Windows依然阻塞，未标记交付完成。

## 最终验收（Windows已恢复）

- Windows最终回归 **cmd_48244811da3a425df9026b502825ef7985c0a4c71af32aa2 completed/exit0**：check47、扩展单元5、快捷/主题15、视口/IP11、完整Electron54，errors=[]。
- Windows扩展专项 **cmd_fc244bc32c9f5c423972e5950d8f968e4cc03fbc0c407b34 completed/exit0**：11项全部通过，errors=[]，包含：
  - 受信文件夹导入需二次确认、复制后默认禁用、不自动启动
  - 启用/停用取消安全、仅停止目标实例
  - 内容脚本仅在启用实例生效
  - 扩展面板与实例同session但无控制桥/Node
  - 两实例chrome.storage.local隔离
  - 停止卸载面板/重启存储保持、环境未变
  - 停用后重启清除残留脚本、移除保护
  - 错误包阻止启动并明确报错
  - 固定视口DPR2角落真实鼠标
  - 后台Mihomo路由、内核失败卸载无直连
  - 三尺寸夜间管理页
- Linux本地同链 **extensions-final-verified.txt exit0**：check47、51单元/内核、扩展11、快捷15、视口11、完整54、Chromium15+8，DPR2等待合成帧后连续三次通过。
- Dark Reader官方4.9.133 MV2/MV3在Linux与Windows均可加载但功能未通过：无darkreader样式、背景仍白、MV2面板Loading，日志onRemoved缺失。管理页已对该版本显示兼容性警告，不宣称支持。验证包不在生产包内，仅在extension-validation按官方URL+SHA校验下载。


## 本轮调整：全局管理与浏览页入口

- 按用户截图反馈，扩展管理从实例工作台移入全局管理（全部实例/代理管理同级），避免每个实例重复导入。
- 全局页：导入后显示每个扩展已分配实例列表，每个实例可单独启用/停用（确认后仅停止目标实例），运行中实例可直接打开面板/设置页；移除需先在所有实例停用。
- 浏览页：地址栏下方新增扩展工具栏，显示当前实例已启用扩展数量、加载状态及快捷打开按钮；未启用时提示去全局管理添加。内容脚本仍自动运行，无需手动点击。
- 侧栏状态：扩展页属于全局范围，不再依赖当前实例选择；切换实例不影响全局分配视图。
