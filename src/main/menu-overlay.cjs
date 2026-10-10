"use strict";
// 扩展菜单的原生浮层：一个透明的 WebContentsView 叠在网页上方，网页保持实时显示、不再截图冻结。
// 菜单内容由控制界面生成（已转义），浮层只负责显示并把按钮点击回传；失去焦点或按 Esc 即关闭。
const { WebContentsView } = require("electron");
const path = require("node:path");
const PAD = 8;
class MenuOverlay {
  constructor(window, notify) {
    this.window = window;
    this.notify = notify;
    this.view = null;
    this.ready = null;
    this.open = false;
    this.anchor = null;
    this.width = 340;
    this.height = 200;
  }
  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, "overlay-preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        partition: "persist:arena-core-controls",
      },
    });
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event) => event.preventDefault());
    wc.on("blur", () => setTimeout(() => this.hide("blur"), 0));
    wc.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        this.hide("escape");
      }
    });
    wc.on("render-process-gone", () => {
      this.hide("crash");
      this.view = null;
    });
    this.view = view;
    this.ready = wc.loadFile(path.join(__dirname, "../renderer/overlay.html")).catch(() => {});
    return view;
  }
  place() {
    if (!this.view || !this.anchor || this.window.isDestroyed()) return;
    const [cw, ch] = this.window.getContentSize();
    const w = Math.min(this.width, cw - 16) + PAD * 2;
    const x = Math.max(0, Math.min(Math.round(this.anchor.right - w + PAD), cw - w));
    const y = Math.max(0, Math.round(this.anchor.bottom + 6 - PAD));
    const h = Math.max(40, Math.min(this.height + PAD * 2, ch - y));
    this.view.setBounds({ x, y, width: w, height: h });
  }
  async show(message) {
    if (this.window.isDestroyed()) return false;
    const html = String(message?.html || "");
    if (html.length > 200000) throw Error("菜单内容过大");
    const a = message?.anchor || {};
    const anchor = { right: Number(a.right), bottom: Number(a.bottom) };
    if (!Number.isFinite(anchor.right) || !Number.isFinite(anchor.bottom)) throw Error("菜单位置无效");
    const attrs = {};
    for (const [k, v] of Object.entries(message?.attrs || {}))
      if (/^(class|style|data-[a-z0-9-]+)$/.test(k)) attrs[k] = String(v).slice(0, 4000);
    const update = !!message?.update;
    if (update && !this.open) return false;
    const view = this.ensure();
    await this.ready;
    if (this.window.isDestroyed() || !this.view) return false;
    this.anchor = anchor;
    this.width = Math.max(220, Math.min(420, Number(message?.width) || 340));
    this.window.contentView.addChildView(view);
    this.place();
    view.webContents.send("overlay:render", { html, attrs, label: String(message?.label || "扩展") });
    if (!update) {
      view.setVisible(true);
      this.open = true;
      view.webContents.focus();
    }
    return true;
  }
  receive(sender, msg) {
    if (!this.view || sender !== this.view.webContents || !msg || typeof msg !== "object") return;
    if (msg.type === "size") {
      const h = Number(msg.height);
      if (Number.isFinite(h) && h > 0) {
        this.height = Math.min(2000, Math.ceil(h));
        this.place();
      }
      return;
    }
    if (msg.type === "action" && this.open) {
      const data = {};
      for (const k of ["extension", "extensionId", "instanceId", "kind", "view", "privacySite"])
        if (typeof msg.data?.[k] === "string") data[k] = msg.data[k].slice(0, 200);
      if (!data.extension && !data.view && !data.privacySite) return;
      this.hide("action");
      this.notify({ type: "action", data });
    }
  }
  hide(reason = "request") {
    if (!this.open) return;
    this.open = false;
    try {
      this.view?.setVisible(false);
    } catch {}
    if (reason === "escape" && !this.window.isDestroyed()) this.window.webContents.focus();
    this.notify({ type: "closed", reason });
  }
  destroy() {
    this.open = false;
    const view = this.view;
    this.view = null;
    if (!view) return;
    try {
      this.window.contentView.removeChildView(view);
    } catch {}
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    } catch {}
  }
}
module.exports = { MenuOverlay };
