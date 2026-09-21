// 稿匠 · Electron 主进程入口
// 职责：应用生命周期、窗口/托盘、依赖装配。业务逻辑在 services / pipeline / ipc 模块中。
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, safeStorage, dialog, shell, clipboard } = require("electron");
const path = require("path");

const { loadCore } = require("./core-loader.cjs");
const { createServices } = require("./services.cjs");
const { createPipeline } = require("./pipeline.cjs");
const { registerIpc } = require("./ipc.cjs");

let win, tray, scheduler, isQuitting = false;

function notify(title, body) {
  let shown = false;
  try { new Notification({ title, body }).show(); shown = true; } catch {}
  if (tray) try { tray.displayBalloon({ title, content: body }); shown = true; } catch {}
  // 系统通知渠道全部失败时退回应用内 toast，保证"到点放行"提醒不静默丢失
  if (!shown) { try { win?.webContents.send("scheduler-event", { type: "app-alert", title, body }); } catch {} }
}

function createWindow(preloadPath) {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: "稿匠", backgroundColor: "#f5f6f8", autoHideMenuBar: true,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  });
  const gjTab = (process.argv.find((a) => String(a).startsWith("--gj-tab=")) || "").split("=")[1];
  win.loadFile(path.join(__dirname, "..", "ui", "index.html"), gjTab ? { hash: gjTab } : undefined);
  if (process.env.GJ_SHOT) {
    // 开发自检模式：加载完成后自截图到该路径并退出（供无头验证界面真实渲染）
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      try {
        win.show(); win.focus();
        await new Promise((r) => setTimeout(r, 600));
        for (let i = 0; i < 6; i++) { // capturePage 偶发返回空图，重试直到拿到有效 PNG
          const buf = (await win.capturePage()).toPNG();
          if (buf.length > 1000) { require("fs").writeFileSync(process.env.GJ_SHOT, buf); console.log("GJ_SHOT saved: " + process.env.GJ_SHOT + " (" + buf.length + "B)"); break; }
          await new Promise((r) => setTimeout(r, 700));
        }
      } catch (e) { console.error("GJ_SHOT failed", e); }
      isQuitting = true; app.quit();
    }, Number(process.env.GJ_SHOT_WAIT || 4000)));
  }
  win.on("close", (e) => {
    // 关窗不退出：调度器需常驻托盘继续盯定时任务
    if (!isQuitting && tray) { e.preventDefault(); win.hide(); }
  });
}

function createTray() {
  try {
    const img = nativeImageTray();
    tray = new Tray(img);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开稿匠", click: () => { win.show(); win.focus(); } },
      { label: "退出（停止定时发布）", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.setToolTip("稿匠 · 定时发布调度运行中");
  } catch (e) {
    console.error("tray failed", e);
    // 无托盘 = 关窗即退出、定时调度停摆，必须显形而非静默降级
    dialog.showErrorBox("稿匠：托盘创建失败", "系统托盘不可用，关闭窗口将直接退出应用，定时发布也会停止。\n建议重启软件。原因：" + String(e?.message || e));
  }
}
function nativeImageTray() {
  const { nativeImage } = require("electron");
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAU0lEQVR4nO3OMQEAAAgDoC251a3g4QcM8OSIuV8HWuABHvAAAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABjw8v3gHZHfWv9AAAAABJRU5ErkJggg=="
  );
}

// ---------- 启动（单实例：定时调度器只允许一个进程持有） ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      const lib = await loadCore();
      const services = createServices({
        lib,
        safeStorage,
        dataDir: path.join(app.getPath("userData"), "data"),
      });
      await services.init();
      await services.bootstrapSecretsFromEnv(process.env);

      const pipeline = createPipeline({
        lib,
        services,
        getScheduler: () => scheduler,
        notify,
      });
      scheduler = new lib.Scheduler(services.store, pipeline.runScheduled, (evt) => {
        if (evt.type === "publish-failed") notify("定时发布失败：" + (evt.task.title || ""), evt.error);
        win?.webContents.send("scheduler-event", evt);
      });

      registerIpc({
        ipcMain, dialog, shell, clipboard, lib, services, pipeline,
        getScheduled: () => scheduler,
        getWindow: () => win,
      });
      scheduler.start(20_000);
      pipeline.startStatusPoller();
      createWindow(path.join(__dirname, "..", "preload", "index.cjs"));
      createTray();
      if (services.store.corrupted.length) {
        // 启动阶段发现的数据文件损坏（已自动备份 .corrupted-*），进界面即显形
        win.webContents.once("did-finish-load", () => win.webContents.send("scheduler-event", { type: "store-corrupted", names: services.store.corrupted.slice() }));
      }
      app.on("before-quit", () => { isQuitting = true; });
    } catch (e) {
      console.error("启动失败:", e);
      dialog.showErrorBox("稿匠启动失败", String(e?.stack || e));
      app.quit();
    }
  });
}
app.on("window-all-closed", () => { if (!tray) app.quit(); });
