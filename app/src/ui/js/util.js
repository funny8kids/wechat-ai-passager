/* 通用工具与全局错误显形 */
"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (ts) => new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const li = (cls, txt) => `<li class="${cls}">${esc(txt)}</li>`;

function showFatal(msg) {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;right:0;bottom:0;background:#b91c1c;color:#fff;font-size:12px;padding:6px 12px;z-index:9999";
  d.textContent = "渲染错误：" + msg;
  document.body.appendChild(d);
}
window.addEventListener("error", (e) => showFatal(`${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => showFatal(String(e.reason?.message || e.reason)));

function toast(msg, actionLabel, actionFn) {
  const t = $("#toast");
  t.innerHTML = "";
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  if (actionFn) {
    const b = document.createElement("button"); b.textContent = actionLabel;
    b.onclick = () => { actionFn(); t.classList.remove("show"); };
    t.appendChild(b);
  }
  t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), actionFn ? 6000 : 3000);
}
