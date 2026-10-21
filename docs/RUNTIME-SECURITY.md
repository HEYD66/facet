---
title: 运行时安全更新与验证边界
type: project-maintenance
status: verified-with-boundaries
created: 2026-10-22
updated: 2026-10-22
tags: [security, electron, mihomo]
---

# 运行时安全更新（2026-10-22，源码待发布）

本次修复针对 Windows x64 千面实际使用的浏览器、代理和订阅/AI 网络路径。已有用户数据和网络/DNS 设置不迁移、不覆盖。当前已经打开的旧进程仍使用旧运行时，需要正常退出并重新启动新版应用；旧安装包不会自动获得源码修改。

## 组件与处置

| 对象 | 本次版本 / 处理 | 验证与边界 |
| --- | --- | --- |
| Electron / Chromium | 44.4.5 → **44.9.3**；Chromium 152.0.7977.167 | 官方预编译资产经 SHA256 核验；包括 Electron 的证书 SPKI 阻止列表和浏览器安全回补 |
| Electron 内置 Node | **24.22.0** | **尚未包含 Node 24.22.1 全部上游修复**；不能宣称整个 Node 运行时已完全修复。应用实际入口按以下措施防护，后续仍需升级上游完整修复版 |
| Mihomo | **alpha-3f27ef3 / Go 1.26.10** | 官方预发行构建；稳定版 v1.19.32 早于该 Go 修复。固定发行资产名、SHA256 和完整源码提交，不自动追踪后续 Alpha |
| 开发机系统 Node | 本轮不全局升级 | 开发机 Node 与安装包内置 Node 是两个运行时；升级系统 Node 不能替代 Electron 修复 |
| Android / Linux | 不计入本轮运行验收 | Android 是独立原型，仍有旧版核心配置；Linux 安装脚本有固定下载资产，但本轮未在 Linux 执行和发布 |

## 实际网络路径的防护

- **Brotli 解码**：订阅、AI 消息、模型列表统一经 `src/main/safe-http.cjs` 的安全传输/解码策略。核对 Electron 的 GN 构建补丁后，确认 Node 的解码器也链接 Chromium 的 Brotli，而非直接采用 Node 自带版本。已验证的 Electron 44.9.3 / Chromium 152.0.7977.167 保留 `br` 解码；旧版或未经验证的 Electron、低于安全修复线的独立 Node 不声明接收 `br`，强制收到该编码时在创建解码器之前拒绝。保留 gzip、deflate、identity 和流式响应。不能仅靠修改 `Accept-Encoding` 就声称已阻止恶意服务端。
- **共享 Brotli 修复**：该 Chromium 版本引用的 Brotli 提交 `cfa184a997ac19454d5a3ae97f6d600aac2445a6` 已含 `BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH` 的修复；Electron GN 明确使用 `//third_party/brotli:dec` / `enc`。网页和当前新版应用的正常压缩均保留，不因为内置 Node 的版本字符串就误判 Brotli 尚未修复。
- **TLS 主机名混淆**：应用请求使用规范化 URL；TLS 校验拒绝 NUL、非规范 IPv4 和全角数字等歧义主机名。字面 IP 仅通过原始签名证书的 IP SAN 校验，不能用 DNS SAN / CN 冒充 IP。IPv4 和 IPv6 均有真实 TLS 正向回归。
- **HTTP 连接复用**：AI 原有 Node `fetch` 改为每请求独立 Agent，明确 `Connection: close`，不把外部响应交给旧版 Undici 的复用连接。订阅原本已关闭连接复用，继续保留。AI 重试、停止、流式输出和响应大小限制继续生效。每次模型调用重新连接可能增加连接时延；待上游完整修复并验证后可再恢复复用。
- **DNS NUL**：当前应用解析使用 `dns.lookup` 或已有 DoH 请求，没有使用受公告影响的 `dns.resolve*`；网络 URL 入口同时拒绝 NUL 字符。本次没有更改 DNS 策略或系统 DNS。
- **受损证书链**：保留完整 TLS 校验，不使用 `rejectUnauthorized:false`、忽略证书错误或自定义放行证书来规避问题。应用升级路径使用 Electron 网络栈。
- **快照与权限模型**：项目未构建 Node SEA / 用户启动快照，也未将 Node Permission Model 作为实例安全边界。网页和扩展不能直接调用主进程 Node API。没有将这些未启用能力包装成已打上游补丁。

在旧版或未经验证的运行时中，如果模型服务或订阅服务器无视请求头、强制只返回 Brotli，应用会给出安全错误，要求服务器改用 gzip/identity；不会悄悄回退到有风险的解码器。以后更换 Electron 时必须重新核对共享解码器，更新允许的已验证构建并复测。

## 下载、验收和恢复

- `src/main/core-release.cjs` 集中固定代理核心、Go 编译器版本、Windows/Linux 资产摘要和源码提交；订阅 User-Agent 引用同一版本定义。
- `npm.cmd run setup:core` 校验资产、源码和许可证摘要，先对临时二进制执行 `-v` 验证版本，再安装。可用 `FACET_CORE_DOWNLOAD_CACHE` 指定按摘要命名的本地缓存；缓存同样必须通过 SHA256，不能跳过校验。Alpha 上游若删除旧资产，下载会明确失败，不能自动替换为不同构建。
- 安装包构建校验固定安全核心与资源摘要，阻止把已恢复的旧核心误当安全候选打包。
- 新增 `npm.cmd run test:runtime-security`，覆盖旧版禁止 Brotli 实际调用、新版真实 Brotli 解压、TLS 主机名/IP、真实 IPv4/IPv6 TLS 握手、流式消费、取消连接、跨源重定向拒绝、证书拒绝与核心资产一致性。
- 在新 Electron 的内置 Node 中重跑同一组测试，而非只用开发机 Node 代替。
- 最终结果：304 个脚本语法/边界检查通过；安全测试在系统 Node 和新 Electron 内置 Node 下各 11 项通过；控制 API 1 项、真实代理/基础模型 13 项、打包边界 3 项、启动器 11 项通过。加固回归 137 项通过，1 项 POSIX 专用同步失败用例在 Windows 按原条件跳过。生产 npm 依赖审计为 0 项；不等于所有开发依赖和运行时都完成审计。
- 回归通过：控制 API、代理 IPv4/IPv6、扩展启停与跨进程持久化、CDP/SharedWorker、AI 重试/取消/会话、视口原生点击与铺满、环境重置后 Cookie/存储不复活、浏览网络策略及扩展真实路由。受控模型服务只验证传输和工具执行，不代表任何第三方模型服务都通过。
- 公网证书测试：Node 对 12 条问题链均返回 `CERT_REVOKED`；Chromium 对 12 条均给出明确证书错误（撤销或不受信任）；Mihomo 对两条代表链返回 TLS 证书不受信任，代理请求 502。初测 Chromium 有超时，未把超时计为证书拦截；延长测试窗口后重新取得上述证书错误。
- 测试使用隔离资料目录与本机服务；公网测试只访问公开证书验证端点。没有以真实用户实例、账号、代理凭据或站点 Cookie 进行回归，也没有停止用户原有进程。

源码回滚使用本次修复提交的 `git revert`，然后重新安装 lockfile 对应依赖；代理资产随提交恢复。回滚会同时恢复旧版安全风险，仅用于故障定位。源码检查点为 `bd35747`。本机临时备份、下载缓存和测试证据保留在仓库忽略的 `.local-dev/security-runtime-20261022/`，不进入 Git 或安装包。

## 尚待后续

- Electron 发布包含 Node 24.22.1 同等全部修复的版本后，重新升级并验证，不把本轮路径防护冒充底层全部修补。
- Mihomo 发布使用 Go 1.26.10 / 1.27.3 或后续安全版本的稳定发行件后，替换当前固定预发行件并重跑代理回归。
- Android 和 Linux 需分别升级、验证；本轮 Windows 结果不能替代它们的验收。此更新也不代表 PHP、Nginx、Tomcat 或整台开发机已完成安全审计。
- 代理回归覆盖受控 HTTP 上游、IPv4/IPv6、隔离、失败拒绝直连和公开证书错误；未逐个验证所有机场、远端节点和代理协议。

## 官方依据

- [Node.js 2026 年 10 月安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Node.js 24.22.1 修复清单](https://nodejs.org/en/blog/release/v24.22.1)
- [Electron 44.9.3](https://github.com/electron/electron/releases/tag/v44.9.3)
- [Electron Node/Chromium 证书阻止列表回补](https://github.com/electron/electron/pull/55126)
- [Electron Node 共享 Chromium Brotli 的 GN 构建补丁](https://github.com/electron/electron/blob/v44.9.3/patches/node/build_add_gn_build_files.patch)
- [Chromium 152.0.7977.167 Brotli 版本](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/brotli/README.chromium)
- [Brotli 对应源码](https://github.com/google/brotli/blob/cfa184a997ac19454d5a3ae97f6d600aac2445a6/c/dec/decode.c)
- [Mihomo 固定源码](https://github.com/MetaCubeX/mihomo/tree/3f27ef39f8c96bbfbc8b0b9bb10f5c9ef60149d8)
- [Go 安全发布公告](https://groups.google.com/g/golang-announce/c/66pojueaQek)
