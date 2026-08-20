// DeepSeek Harness desktop wrapper.
// The packaged app runs its bundled DSH copy with Electron's embedded Node.js.

const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, ipcMain, session } = require("electron");
const { spawn, exec, execFileSync } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { createDesktopServices } = require("./desktop-services");

const PORT = 3080;
const URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let dshProcess = null;
let tray = null;
let desktopServices = null;
let isQuitting = false;
let isRestartingDsh = false;
let dshServiceReady = false;
let blankWindowRecoveryAttempted = false;

if (!app.requestSingleInstanceLock()) app.quit();

function appDataPath(...parts) {
  return path.join(app.getPath("userData"), ...parts);
}

function dshHomePath() {
  return appDataPath("dsh");
}

function log(message) {
  try {
    const filename = appDataPath("dsh.log");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.appendFileSync(filename, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never prevent the application from starting.
  }
}

function logFilePath() {
  return appDataPath("dsh.log");
}

async function clearWebRuntimeCache(reason) {
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
    log(`已清理 Electron Web 缓存：${reason}`);
  } catch (error) {
    log(`清理 Electron Web 缓存失败：${error.message}`);
  }
}

function webUrl() {
  const url = new URL(URL);
  url.searchParams.set("desktopVersion", app.getVersion());
  url.searchParams.set("desktopLaunch", String(Date.now()));
  return url.toString();
}

function iconPath() {
  return path.join(__dirname, "assets", process.platform === "darwin" ? "deepseek.icns" : "deepseek.ico");
}

function bundledDshBin() {
  // DSH dynamically imports plugins from the user's profile. Keep production
  // dependencies physically unpacked so the profile fallback can resolve them.
  const nodeModules = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
    : path.join(__dirname, "node_modules");
  return path.join(nodeModules, "@deepseek-ai", "dsh", "lib", "bin.js");
}

function bundledSkillDirectory() {
  return app.isPackaged ? path.join(process.resourcesPath, "bundled-skills") : path.join(__dirname, "bundled-skills");
}

function bundledRuntimePackageDirectory(packageName) {
  const nodeModules = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
    : path.join(__dirname, "node_modules");
  return path.join(nodeModules, ...packageName.split("/"));
}

function resolveRuntimeDependency(packageRoot, packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`, { paths: [packageRoot] }));
  } catch {
    // Some ESM packages intentionally do not export package.json. Resolve
    // their public entry point instead, then walk back to the matching root.
    let cursor;
    try {
      cursor = path.dirname(require.resolve(packageName, { paths: [packageRoot] }));
    } catch {
      throw new Error(`桌面插件缺少运行依赖 ${packageName}。请重新安装或重新构建客户端。`);
    }
    while (true) {
      const manifest = path.join(cursor, "package.json");
      try {
        if (JSON.parse(fs.readFileSync(manifest, "utf8")).name === packageName) return cursor;
      } catch {}
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    throw new Error(`无法定位桌面插件依赖 ${packageName} 的安装目录。`);
  }
}

function resolveCommand(command) {
  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    const output = execFileSync(lookup, [command], { encoding: "utf8", windowsHide: true });
    return output.split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function resolveDshCommands() {
  const candidates = [];
  const localBin = bundledDshBin();
  if (fs.existsSync(localBin)) {
    // The native Windows directory picker loads koffi in a child process.
    // Running DSH under Electron's embedded Node can use a different Node ABI
    // from koffi's prebuilt binary, causing that worker to exit immediately.
    const systemNode = process.platform === "win32" && !app.isPackaged ? resolveCommand("node") : null;
    candidates.push({
      cmd: systemNode || process.execPath,
      args: [localBin, "web"],
      label: app.isPackaged ? "bundled dsh" : "local dsh",
      env: systemNode ? {} : { ELECTRON_RUN_AS_NODE: "1" },
    });
  }
  if (app.isPackaged) return candidates;

  const node = resolveCommand("node");
  const npm = resolveCommand("npm");
  if (node && npm) {
    try {
      const root = execFileSync(npm, ["root", "-g"], { encoding: "utf8", windowsHide: true }).trim();
      const globalBin = path.join(root, "@deepseek-ai", "dsh", "lib", "bin.js");
      if (fs.existsSync(globalBin)) candidates.push({ cmd: node, args: [globalBin, "web"], label: "global dsh" });
    } catch {
      // A local bundled DSH remains the preferred development path.
    }
  }
  const npx = resolveCommand("npx");
  if (npx) candidates.push({ cmd: npx, args: ["-y", "@deepseek-ai/dsh", "web"], label: "npx dsh" });
  return candidates;
}

function startDsh() {
  const candidates = resolveDshCommands();
  if (!candidates.length) {
    log("启动失败：未找到可执行的 DSH");
    return null;
  }
  dshServiceReady = false;

  const startCandidate = (index) => {
    const candidate = candidates[index];
    if (!candidate) return null;
    log(`尝试启动: ${candidate.label}`);
    const child = spawn(candidate.cmd, candidate.args, {
      detached: process.platform !== "win32",
      windowsHide: process.platform === "win32",
      env: {
        ...process.env,
        ...candidate.env,
        DSH_HOME: dshHomePath(),
        DSH_BUNDLED_SKILL_DIR: bundledSkillDirectory(),
      },
    });
    dshProcess = child;
    child.stdout?.on("data", (data) => log(`[dsh stdout] ${String(data).trimEnd()}`));
    child.stderr?.on("data", (data) => log(`[dsh stderr] ${String(data).trimEnd()}`));
    child.on("error", (error) => {
      log(`启动失败 ${candidate.label}: ${error.message}`);
      if (dshProcess === child) dshProcess = null;
      if (!isQuitting && !isRestartingDsh) startCandidate(index + 1);
    });
    child.on("exit", (code, signal) => {
      log(`dsh 进程退出 code=${code} signal=${signal}`);
      if (dshProcess !== child) return;
      dshProcess = null;
      if (!isQuitting && !isRestartingDsh && !dshServiceReady && startCandidate(index + 1)) return;
      if (!isQuitting && !isRestartingDsh && code !== 0 && code !== null) {
        dialog.showErrorBox("DeepSeek Harness 服务已退出", `dsh web 服务异常退出（code=${code}）。\n请查看日志：${logFilePath()}`);
      }
    });
    return child;
  };
  return startCandidate(0);
}

function killProcessTree(proc) {
  if (!proc?.pid) return;
  log(`终止进程树 pid=${proc.pid}`);
  if (process.platform === "win32") {
    exec(`taskkill /pid ${proc.pid} /T /F`, (error) => { if (error) log(`taskkill 失败: ${error.message}`); });
    return;
  }
  try {
    process.kill(-proc.pid, "SIGTERM");
    setTimeout(() => { try { process.kill(-proc.pid, "SIGKILL"); } catch {} }, 5000).unref();
  } catch {
    try { proc.kill("SIGTERM"); } catch {}
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isServerResponding() {
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(1500) });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 120000, expectedProcess = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (expectedProcess && expectedProcess.exitCode !== null) {
      log(`等待服务就绪失败：新 DSH 子进程已退出 code=${expectedProcess.exitCode}`);
      return false;
    }
    if (await isServerResponding()) return true;
    await delay(500);
  }
  log(`等待服务就绪超时：${timeoutMs}ms`);
  return false;
}

async function waitForServerStop(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isServerResponding())) return true;
    await delay(300);
  }
  log(`等待旧服务端口释放超时：${timeoutMs}ms`);
  return false;
}

async function waitForProcessExit(proc, timeoutMs = 10000) {
  if (!proc || proc.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function restartDshService() {
  if (isRestartingDsh) throw new Error("DSH 正在重启，请稍候。");
  if (!dshProcess) {
    throw new Error("当前 DSH 服务并非由此应用启动，无法安全重启。请退出其他 DeepSeek Harness 实例后重试。");
  }

  isRestartingDsh = true;
  dshServiceReady = false;
  const previousProcess = dshProcess;
  try {
    log("皮肤切换：开始重启 DSH 服务");
    killProcessTree(previousProcess);
    if (!(await waitForProcessExit(previousProcess))) throw new Error("旧 DSH 子进程未能按时退出。");
    if (dshProcess === previousProcess) dshProcess = null;
    log("皮肤切换：旧 DSH 子进程已退出，等待端口释放");
    if (!(await waitForServerStop())) throw new Error("旧 DSH 服务端口未释放，请完全退出其他桌面端实例后重试。");

    const nextProcess = startDsh();
    if (!nextProcess) throw new Error("未找到随应用打包的 DSH 服务。");
    log(`皮肤切换：已启动新的 DSH 子进程 pid=${nextProcess.pid}`);
    if (!(await waitForServer(120000, nextProcess))) throw new Error("新的 DSH 服务未能启动，请查看日志。");

    dshServiceReady = true;
    log("皮肤切换：DSH 服务已重新就绪");
    // Complete the IPC response before reloading, so the UI does not report a
    // successful service restart as a cancelled remote invocation.
    setTimeout(() => mainWindow?.webContents.reloadIgnoringCache(), 250).unref();
  } catch (error) {
    log(`皮肤切换：DSH 重启失败：${error.message}`);
    throw new Error(`皮肤已写入，但 DSH 重启失败：${error.message} 请重启应用并查看日志：${logFilePath()}`);
  } finally {
    isRestartingDsh = false;
  }
}

async function readPackageManifest(packageRoot) {
  try {
    return JSON.parse(await fsp.readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

async function syncProfilePackage(profileRoot, source, visited = new Set()) {
  const sourcePackage = await readPackageManifest(source);
  if (!sourcePackage?.name) return null;
  if (visited.has(sourcePackage.name)) return { name: sourcePackage.name, changed: false };
  visited.add(sourcePackage.name);

  const target = path.join(profileRoot, "node_modules", ...sourcePackage.name.split("/"));
  let installedVersion = null;
  try { installedVersion = JSON.parse(await fsp.readFile(path.join(target, "package.json"), "utf8")).version; } catch {}
  if (installedVersion !== sourcePackage.version) {
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.cp(source, target, { recursive: true, dereference: false });
    log(`已安装桌面客户端插件 ${sourcePackage.name} ${sourcePackage.version}`);
  }

  // A DSH profile lives under Application Support. Its ESM/CJS resolver
  // cannot climb into the app's unpacked node_modules, so copy the complete
  // production dependency closure beside every bundled plugin.
  let dependenciesChanged = false;
  for (const dependencyName of Object.keys(sourcePackage.dependencies || {})) {
    const dependency = await syncProfilePackage(profileRoot, resolveRuntimeDependency(source, dependencyName), visited);
    dependenciesChanged ||= Boolean(dependency?.changed);
  }
  return { name: sourcePackage.name, changed: installedVersion !== sourcePackage.version || dependenciesChanged };
}

async function ensureDesktopClientPlugins() {
  const profileRoot = path.join(dshHomePath(), "profiles", "web");
  const profileManifest = path.join(profileRoot, "package.json");
  if (!fs.existsSync(profileManifest)) return false;
  const profile = JSON.parse(await fsp.readFile(profileManifest, "utf8"));
  const bundles = profile.dsh?.profile?.bundles || [];
  // The task board imports this host provider at runtime, although the
  // upstream package currently declares it as a development dependency.
  const sources = [
    { source: bundledRuntimePackageDirectory("@deepseek-ai/dsh-settings"), bundle: false },
    { source: bundledRuntimePackageDirectory("@linxin666/dsh-client-ui-task-board"), bundle: true },
    { source: bundledRuntimePackageDirectory("@linxin666/dsh-client-ui-git-graph"), bundle: true },
  ];
  const packageNames = [];
  let changed = false;

  for (const { source, bundle } of sources) {
    const result = await syncProfilePackage(profileRoot, source);
    if (!result?.name) continue;
    if (bundle) packageNames.push(result.name);
    changed ||= result.changed;
  }

  // Git graph owns the branch entry now. Remove the former lightweight chip
  // so the workspace keeps one coherent Git control.
  const retiredPackages = new Set(["@dsh-desktop/git-branch"]);
  const managedPackages = new Set([...packageNames, ...retiredPackages]);
  const nextBundles = [...bundles.filter((item) => !managedPackages.has(item)), ...packageNames];
  if (nextBundles.length === bundles.length && nextBundles.every((item, index) => item === bundles[index])) return changed;
  const nextProfile = {
    ...profile,
    dsh: { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles: nextBundles } },
  };
  await fsp.writeFile(profileManifest, `${JSON.stringify(nextProfile, null, 2)}\n`);
  return true;
}

function attachWindowDiagnostics(window) {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    log(`[renderer console:${level}] ${message} (${sourceId || "unknown"}:${line || 0})`);
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    log(`窗口加载失败 code=${errorCode} url=${validatedURL}: ${errorDescription}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    log(`渲染进程退出 reason=${details.reason} exitCode=${details.exitCode}`);
  });
}

async function inspectWindowRenderState(window) {
  return window.webContents.executeJavaScript(`(() => {
    const root = document.getElementById("root");
    return {
      href: location.href,
      readyState: document.readyState,
      hasBootManifest: Boolean(window.__DSH_BOOT__),
      rootChildren: root ? root.children.length : null,
      bodyText: document.body ? document.body.innerText.trim().slice(0, 200) : "",
    };
  })()`, true);
}

async function recoverBlankWindow(window) {
  if (blankWindowRecoveryAttempted || window.isDestroyed()) return;
  let state;
  try {
    state = await inspectWindowRenderState(window);
  } catch (error) {
    log(`白屏检测失败：${error.message}`);
    return;
  }
  log(`窗口渲染状态：${JSON.stringify(state)}`);
  const blank = state.readyState === "complete"
    && state.hasBootManifest
    && state.rootChildren === 0
    && !state.bodyText;
  if (!blank) return;

  blankWindowRecoveryAttempted = true;
  log("检测到 Web UI 白屏，准备清理缓存并禁用当前插件皮肤后重载。");
  await clearWebRuntimeCache("white screen recovery");
  try {
    const activeSkin = (await requireDesktopServices().listSkins()).find((skin) => skin.active);
    if (activeSkin?.type === "plugin") {
      const result = await requireDesktopServices().clearSkin();
      log(`已禁用导致白屏风险的插件皮肤：${activeSkin.id}`);
      if (result.requiresRestart && dshProcess) await restartDshService();
    } else {
      log("白屏恢复未发现活动插件皮肤，仅执行强制无缓存重载。");
      window.webContents.reloadIgnoringCache();
    }
  } catch (error) {
    log(`白屏恢复失败：${error.message}`);
    window.webContents.reloadIgnoringCache();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "DeepSeek Harness",
    autoHideMenuBar: true,
    // Let the web UI extend through the macOS title bar while retaining the
    // native traffic-light controls, so the default white title strip is gone.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, "desktop-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  attachWindowDiagnostics(mainWindow);
  mainWindow.webContents.on("did-finish-load", () => {
    setTimeout(() => recoverBlankWindow(mainWindow), 10_000).unref();
  });
  mainWindow.loadURL(webUrl());
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      log("窗口关闭，最小化到托盘（服务继续运行）");
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  let icon = nativeImage.createFromPath(iconPath());
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("DeepSeek Harness");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示窗口", click: showWindow },
    { label: "退出", click: () => { isQuitting = true; if (mainWindow) mainWindow.close(); killProcessTree(dshProcess); app.quit(); } },
  ]));
  tray.on("click", showWindow);
}

function requireDesktopServices() {
  if (!desktopServices) throw new Error("桌面服务尚未初始化。");
  return desktopServices;
}

function registerDesktopIpc() {
  ipcMain.handle("desktop:skills:list", () => requireDesktopServices().listSkills());
  ipcMain.handle("desktop:locale:get", () => requireDesktopServices().getLocale());
  ipcMain.handle("desktop:api-endpoint:get", () => requireDesktopServices().getApiBaseUrl());
  ipcMain.handle("desktop:api-endpoint:set", (_event, value) => requireDesktopServices().setApiBaseUrl(value));
  ipcMain.handle("desktop:account:balance", () => requireDesktopServices().getBalance());
  ipcMain.handle("desktop:git:context", (_event, cwd) => requireDesktopServices().getGitContext(cwd));
  ipcMain.handle("desktop:git:switch", (_event, cwd, branch) => requireDesktopServices().switchGitBranch(cwd, branch));
  ipcMain.handle("desktop:skins:list", () => requireDesktopServices().listSkins());
  ipcMain.handle("desktop:skins:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择皮肤文件或目录",
      properties: ["openFile", "openDirectory"],
      filters: [{ name: "皮肤文件", extensions: ["css", "zip"] }],
    });
    return result.canceled || !result.filePaths[0] ? null : requireDesktopServices().importSkin(result.filePaths[0]);
  });
  const withSkinProgress = (event, action) => action((progress) => event.sender.send("desktop:skins:import-github-progress", progress));
  ipcMain.handle("desktop:skins:import-github", (event, url) => withSkinProgress(event, (progress) => requireDesktopServices().importSkinFromGitHub(url, progress)));
  ipcMain.handle("desktop:skins:import-dsh-web-ui", (event, id) => withSkinProgress(event, (progress) => requireDesktopServices().importDshWebUiSkin(id, progress)));
  ipcMain.handle("desktop:skins:apply", async (_event, id) => {
    const result = await requireDesktopServices().applySkin(id);
    if (result.requiresRestart) await restartDshService();
    return result;
  });
  ipcMain.handle("desktop:skins:clear", async () => {
    const result = await requireDesktopServices().clearSkin();
    if (result.requiresRestart) await restartDshService();
    return result;
  });
  ipcMain.handle("desktop:skins:remove", async (_event, id) => {
    const result = await requireDesktopServices().removeSkin(id);
    if (result?.requiresRestart) await restartDshService();
    return result;
  });
}

app.whenReady().then(async () => {
  log("=== DeepSeek Harness 桌面版启动 ===");
  await clearWebRuntimeCache("startup");
  desktopServices = createDesktopServices({ dshHome: dshHomePath() });
  registerDesktopIpc();
  createTray();

  // Repair an existing profile before DSH loads it. Waiting until the web
  // server responds is too late: a missing plugin dependency can make DSH exit
  // during profile boot and prevent the repair from ever running.
  await ensureDesktopClientPlugins();

  if (await waitForServer(3000)) {
    dshServiceReady = true;
    log("检测到已有 DSH 服务，直接连接；不会接管其重启生命周期");
    showWindow();
    return;
  }
  const child = startDsh();
  if (!child) {
    dialog.showErrorBox("启动失败", `未找到随应用打包的 dsh 服务，请重新安装应用。\n日志：${logFilePath()}`);
    app.quit();
    return;
  }
  if (!(await waitForServer(120000, child))) {
    dialog.showErrorBox("服务未就绪", `等待 ${URL} 超时。请查看日志：${logFilePath()}`);
    killProcessTree(child);
    app.quit();
    return;
  }
  dshServiceReady = true;

  // The web profile is created by the first DSH launch, so install our client
  // bundle afterwards and then restart the process we own exactly once.
  if (await ensureDesktopClientPlugins()) await restartDshService();
  log("服务就绪，打开窗口");
  showWindow();
});

app.on("second-instance", () => showWindow());
app.on("window-all-closed", () => log("所有窗口已关闭，应用保持后台运行（托盘）"));
app.on("activate", () => { if (app.isReady()) showWindow(); });
app.on("before-quit", () => { isQuitting = true; killProcessTree(dshProcess); });
