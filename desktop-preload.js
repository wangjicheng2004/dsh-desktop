const { contextBridge, ipcRenderer } = require("electron");

const api = {
  skills: { list: () => ipcRenderer.invoke("desktop:skills:list") },
  locale: { get: () => ipcRenderer.invoke("desktop:locale:get") },
  apiEndpoint: {
    get: () => ipcRenderer.invoke("desktop:api-endpoint:get"),
    set: (value) => ipcRenderer.invoke("desktop:api-endpoint:set", value),
  },
  account: { getBalance: () => ipcRenderer.invoke("desktop:account:balance") },
  skins: {
    list: () => ipcRenderer.invoke("desktop:skins:list"),
    import: () => ipcRenderer.invoke("desktop:skins:import"),
    importGitHub: (url) => ipcRenderer.invoke("desktop:skins:import-github", url),
    importDshWebUi: (skinId) => ipcRenderer.invoke("desktop:skins:import-dsh-web-ui", skinId),
    onImportGitHubProgress: (listener) => {
      const handler = (_event, progress) => listener(progress);
      ipcRenderer.on("desktop:skins:import-github-progress", handler);
      return () => ipcRenderer.removeListener("desktop:skins:import-github-progress", handler);
    },
    apply: (id) => ipcRenderer.invoke("desktop:skins:apply", id),
    clear: () => ipcRenderer.invoke("desktop:skins:clear"),
    remove: (id) => ipcRenderer.invoke("desktop:skins:remove", id),
  },
  git: {
    context: (cwd) => ipcRenderer.invoke("desktop:git:context", cwd),
    switch: (cwd, branch) => ipcRenderer.invoke("desktop:git:switch", cwd, branch),
  },
};

contextBridge.exposeInMainWorld("dshDesktop", api);

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function injectDesktopPages() {
  if (document.getElementById("dsh-desktop-workbench")) return;

  const pages = {
    skills: { icon: "✦" },
    usage: { icon: "◉" },
    skins: { icon: "◐" },
  };
  const dshWebUiSkins = [
    ["qq98", "QQ2008 怀旧版", "QQ2008 Retro"],
    ["qq2006", "QQ2006 经典版", "QQ2006 Classic"],
    ["ths", "同花顺风格", "Trading Terminal"],
    ["xp", "Windows XP", "Windows XP"],
    ["blue-fantasy", "蓝色幻想", "Blue Fantasy"],
    ["dragon-heir", "龙脉传承", "Dragon Heir"],
    ["minecraft", "我的世界", "Minecraft"],
    ["miku", "初音未来", "Miku"],
    ["whale-song", "鲸歌", "Whale Song"],
  ].map(([id, zh, en]) => ({ id, zh, en }));
  const copy = {
    zh: {
      navLabel: "桌面功能", back: "返回对话",
      pages: {
        skills: { label: "技能", title: "技能", description: "通过对话创建项目级 Skills，并查看可用的全局 Skills。" },
        usage: { label: "API 用量", title: "API 用量", description: "查看当前 DeepSeek 账号的可用余额。" },
        skins: { label: "皮肤", title: "皮肤", description: "导入、切换和恢复 DeepSeek Harness 的界面皮肤。" },
      },
    },
    en: {
      navLabel: "Desktop tools", back: "Back to chat",
      pages: {
        skills: { label: "Skills", title: "Skills", description: "Create project-scoped Skills and view available global Skills." },
        usage: { label: "API usage", title: "API usage", description: "View the available balance for the current DeepSeek account." },
        skins: { label: "Skins", title: "Skins", description: "Import, switch, and restore DeepSeek Harness skins." },
      },
    },
  };
  let activeLocale = "zh";
  const text = () => copy[activeLocale];

  const style = document.createElement("style");
  style.textContent = `
    #dsh-desktop-nav,#dsh-desktop-workbench{font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--dsw-alias-label-primary,#eef2f7)}
    #dsh-desktop-nav{display:grid;gap:3px;margin:8px 12px}#dsh-desktop-nav button{align-items:center;background:transparent;border:0;border-radius:9px;color:var(--dsw-alias-label-primary,#eef2f7);cursor:pointer;display:flex;gap:10px;padding:10px 12px;text-align:left;width:100%}#dsh-desktop-nav button:hover,#dsh-desktop-nav button[aria-current="page"]{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09))}#dsh-desktop-nav button[aria-current="page"]{color:var(--dsw-alias-state-business-primary,#66adff)}.dshdc-nav-icon{align-items:center;border:1px solid currentColor;border-radius:6px;display:inline-flex;font-size:16px;font-weight:700;height:22px;justify-content:center;line-height:1;width:22px}#dsh-desktop-nav button[data-page="usage"] .dshdc-nav-icon{border-color:#111;color:#111}body[data-ds-dark-theme] #dsh-desktop-nav button[data-page="usage"] .dshdc-nav-icon{border-color:#fff;color:#fff}.dshdc-nav-label{font-weight:600}
    #dsh-desktop-workbench{background:var(--dsw-alias-bg-base,#111214);box-sizing:border-box;display:block;min-height:100%;overflow:auto;padding:42px 48px 72px;width:100%}#dsh-desktop-workbench[hidden]{display:none}#dsh-desktop-workbench button{font:inherit}#dsh-desktop-workbench button:not(:disabled){cursor:pointer}#dsh-desktop-workbench button:disabled{cursor:not-allowed;opacity:.58}
    .dshdc-shell{margin:0 auto;max-width:1040px}.dshdc-hero{align-items:flex-start;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));display:flex;gap:24px;justify-content:space-between;padding:0 0 28px}.dshdc-eyebrow{color:var(--dsw-alias-label-secondary,#9da7b5);font-size:12px;letter-spacing:.08em;margin:0 0 8px;text-transform:uppercase}.dshdc-hero h1{font-size:32px;letter-spacing:-.03em;line-height:1.15;margin:0}.dshdc-hero p{color:var(--dsw-alias-label-secondary,#9da7b5);margin:9px 0 0}.dshdc-back{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:8px;color:inherit;padding:8px 11px;white-space:nowrap}.dshdc-back:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09))}
    .dshdc-onboarding-field{display:grid;gap:6px;margin-top:12px}.dshdc-onboarding-label{font-size:14px;font-weight:600}.dshdc-onboarding-input{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:8px;box-sizing:border-box;color:inherit;font:inherit;padding:10px 12px;width:100%}.dshdc-onboarding-hint{color:var(--dsw-alias-label-secondary,#9da7b5);font-size:12px;margin:0}.dshdc-onboarding-warning{color:#e7bc70;font-size:12px;margin:0}.dshdc-onboarding-error{color:var(--dsw-alias-state-error-primary,#ff8792);font-size:12px;margin:0}
    .dshdc-view{padding-top:28px}.dshdc-view[hidden]{display:none}.dshdc-toolbar,.dshdc-row{align-items:center;display:flex;gap:12px;justify-content:space-between}.dshdc-toolbar{margin-bottom:16px}.dshdc-toolbar h2{font-size:20px;margin:0}.dshdc-card{background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.045));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:12px;box-sizing:border-box;padding:18px}.dshdc-card h3{font-size:15px;margin:0 0 5px}.dshdc-card p{margin:8px 0}.dshdc-muted{color:var(--dsw-alias-label-secondary,#9da7b5);font-size:13px}.dshdc-stack{display:grid;gap:10px}.dshdc-skill-card{padding:14px}.dshdc-primary,.dshdc-secondary,.dshdc-danger{border-radius:8px;padding:8px 11px}.dshdc-primary{background:var(--dsw-alias-state-business-primary,#4d96ed);border:1px solid transparent;color:#fff}.dshdc-secondary{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));color:inherit}.dshdc-danger{background:transparent;border:1px solid rgba(245,108,120,.45);color:#ffafb7}.dshdc-status{color:var(--dsw-alias-state-business-primary,#66adff);font-size:13px;margin-top:18px;min-height:20px}.dshdc-balance{font-size:26px;font-weight:650;margin-top:14px}.dshdc-warning{color:#e7bc70;font-size:13px;margin-top:10px}.dshdc-steps{color:var(--dsw-alias-label-secondary,#9da7b5);margin:12px 0 0;padding-left:21px}.dshdc-steps li{margin:7px 0}.dshdc-link{color:var(--dsw-alias-state-business-primary,#66adff)}.dshdc-github-import{display:flex;gap:10px;margin:14px 0 9px}.dshdc-github-import input{background:var(--dsw-alias-bg-base,#111214);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:8px;color:inherit;flex:1;font:inherit;min-width:0;padding:9px 11px}.dshdc-import-progress{display:grid;gap:7px;margin-top:12px}.dshdc-import-progress[hidden]{display:none}.dshdc-import-progress progress{accent-color:var(--dsw-alias-state-business-primary,#4d96ed);height:7px;width:100%}
    .dshdc-thought-summary{align-items:center;background:transparent;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary,#8c96a3);cursor:pointer;display:inline-flex;font:14px/24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;gap:7px;margin:0 -7px;padding:4px 7px;text-align:left}.dshdc-thought-summary:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.09));color:var(--dsw-alias-label-primary,#eef2f7)}.dshdc-thought-summary::before{content:"◌";font-size:16px}.dshdc-thought-hidden{display:none!important}
    html[data-dsh-desktop-page-active] [data-slot="conversation"]{display:none!important}
    @media(max-width:880px){#dsh-desktop-workbench{padding:28px 24px 48px}.dshdc-hero{flex-direction:column}.dshdc-back{align-self:flex-start}}
  `;
  document.head.appendChild(style);

  const nav = document.createElement("nav");
  nav.id = "dsh-desktop-nav";

  const root = document.createElement("main");
  root.id = "dsh-desktop-workbench";
  root.hidden = true;
  root.tabIndex = -1;
  root.innerHTML = `<div class="dshdc-shell"><header class="dshdc-hero"><div><p class="dshdc-eyebrow">DeepSeek Harness Desktop</p><h1 data-page-title></h1><p data-page-description></p></div><button class="dshdc-back" data-action="close-page"></button></header><div class="dshdc-view" data-view="skills"></div><div class="dshdc-view" data-view="usage" hidden></div><div class="dshdc-view" data-view="skins" hidden></div><div class="dshdc-status" role="status"></div></div>`;
  document.body.appendChild(root);

  const status = root.querySelector(".dshdc-status");
  const title = root.querySelector("[data-page-title]");
  const description = root.querySelector("[data-page-description]");
  const views = Object.fromEntries([...root.querySelectorAll("[data-view]")].map((view) => [view.dataset.view, view]));
  let skins = [];
  let onboardingEndpointDraft = "";
  let onboardingEndpointLoaded = false;

  const renderNavigation = () => {
    const currentPage = nav.querySelector("[aria-current='page']")?.dataset.page;
    nav.setAttribute("aria-label", text().navLabel);
    nav.innerHTML = Object.entries(pages).map(([id, page]) => `<button type="button" data-page="${id}" aria-controls="dsh-desktop-workbench"${currentPage === id ? ' aria-current="page"' : ""}><span class="dshdc-nav-icon" aria-hidden="true">${page.icon}</span><span class="dshdc-nav-label">${text().pages[id].label}</span></button>`).join("");
    root.querySelector("[data-action='close-page']").textContent = text().back;
  };
  renderNavigation();

  const setStatus = (message, isError = false) => {
    status.textContent = message || "";
    status.style.color = isError ? "#ffbac0" : "#9ac9ff";
  };
  const userMessage = (error) => String(error?.message || "操作失败。").replace(/^Error invoking remote method 'desktop:[^']+': Error:\s*/, "");
  const formatBytes = (value) => value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
  const updateGitHubImportProgress = (progress) => {
    const panel = views.skins.querySelector("[data-github-skin-progress]");
    const bar = panel?.querySelector("progress");
    const text = panel?.querySelector("[data-github-skin-progress-text]");
    if (!panel || !bar || !text) return;
    panel.hidden = false;
    const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
    bar.value = percent;
    const byteProgress = progress.stage === "download" && progress.totalBytes
      ? ` ${formatBytes(progress.transferredBytes || 0)} / ${formatBytes(progress.totalBytes)}`
      : "";
    text.textContent = `${progress.message || "正在导入皮肤…"} ${percent}%${byteProgress}`;
  };
  const applyCss = (css) => {
    let theme = document.getElementById("dsh-desktop-active-skin");
    if (!theme) {
      theme = document.createElement("style");
      theme.id = "dsh-desktop-active-skin";
      document.head.appendChild(theme);
    }
    theme.textContent = css || "";
  };
  const renderSkills = async () => {
    const english = activeLocale === "en";
    const skills = await api.skills.list();
    const invocation = english ? " · model invocable" : " · 模型可调用";
    const userOnly = english ? " · user invocable only" : " · 仅用户调用";
    const skillCards = skills.map((skill) => `<article class="dshdc-card dshdc-skill-card"><h3>/${escapeHtml(skill.name)}</h3><div class="dshdc-muted">${escapeHtml(skill.description)}${skill.modelInvocable ? invocation : userOnly}</div></article>`).join("") || `<div class="dshdc-card dshdc-muted">${english ? "No Skills have been created in this DSH Home yet." : "当前 DSH Home 还没有已创建的 Skill。"}</div>`;
    views.skills.innerHTML = english
      ? `<section class="dshdc-card"><div class="dshdc-row"><div><h3>Create with Skill Creator</h3><p class="dshdc-muted">Start a new chat like Codex. It pre-fills <code>/skill-creator</code>, then the AI confirms your needs before creating the Skill.</p></div><button class="dshdc-primary" data-action="start-skill-creator">Create Skill in new chat</button></div><ol class="dshdc-steps"><li>The button opens a new chat and pre-fills <code>/skill-creator</code>.</li><li>For a local workspace, the creator safely writes to <code>.dsh/skills</code> in that project; without a workspace it falls back to this DSH Home.</li><li>Then type <code>/name</code> in any chat to invoke a created Skill.</li></ol></section><div class="dshdc-toolbar" style="margin-top:28px"><div><h2>Global Skills in this DSH Home</h2><div class="dshdc-muted">Project Skills load with the active workspace and may not appear in this global list.</div></div><button class="dshdc-secondary" data-action="refresh-skills">Refresh</button></div><section class="dshdc-stack">${skillCards}</section>`
      : `<section class="dshdc-card"><div class="dshdc-row"><div><h3>用 Skill 创建器创建</h3><p class="dshdc-muted">像 Codex 一样新开对话，自动写入 <code>/skill-creator</code>，由 AI 先确认需求后再创建。</p></div><button class="dshdc-primary" data-action="start-skill-creator">新对话创建 Skill</button></div><ol class="dshdc-steps"><li>点击按钮后会打开新对话，并预填 <code>/skill-creator</code>。</li><li>有本地工作区时，创建器会默认安全写入当前项目的 <code>.dsh/skills</code>；没有工作区才回退到 DSH Home。</li><li>之后可在任意对话输入 <code>/名称</code> 直接调用已创建的 Skill。</li></ol></section><div class="dshdc-toolbar" style="margin-top:28px"><div><h2>当前 DSH Home 的全局 Skills</h2><div class="dshdc-muted">项目级 Skill 会随当前工作区加载，因此不一定出现在这个全局列表中。</div></div><button class="dshdc-secondary" data-action="refresh-skills">刷新</button></div><section class="dshdc-stack">${skillCards}</section>`;
  };
  const renderUsage = async () => {
    views.usage.innerHTML = activeLocale === "en"
      ? `<div class="dshdc-toolbar"><div><h2>DeepSeek account balance</h2><div class="dshdc-muted">Credentials are read only in the main process; the API key never enters the web page.</div></div><button class="dshdc-secondary" data-action="refresh-balance">Check balance</button></div><section class="dshdc-card"><div data-balance class="dshdc-muted">Select “Check balance” to retrieve the balance for this account.</div><div class="dshdc-warning">DeepSeek provides an account-balance endpoint. Export historical per-key usage from the Usage page in the Open Platform.</div></section>`
      : `<div class="dshdc-toolbar"><div><h2>DeepSeek 当前余额</h2><div class="dshdc-muted">仅在主进程读取本地凭据，API Key 不会进入网页。</div></div><button class="dshdc-secondary" data-action="refresh-balance">查询余额</button></div><section class="dshdc-card"><div data-balance class="dshdc-muted">点击“查询余额”获取当前账号可用余额。</div><div class="dshdc-warning">DeepSeek 当前仅提供账号余额接口；单个 API Key 的历史明细需在开放平台 Usage 页面导出。</div></section>`;
  };
  const renderSkins = async () => {
    const english = activeLocale === "en";
    skins = await api.skins.list();
    const activeSkin = skins.find((skin) => skin.active);
    applyCss(activeSkin?.type === "css" ? activeSkin.css : "");
    const skinCards = skins.map((skin) => {
      const pluginWarning = skin.type === "plugin" ? `<div class="dshdc-warning">${english ? "Plugin skins run bundled client scripts and restart the DSH service when enabled." : "插件皮肤包含可执行客户端脚本，启用后会重启 DSH 服务。"}</div>` : "";
      const source = skin.source?.url ? `<div class="dshdc-muted">${english ? "Source" : "来源"}：<a class="dshdc-link" href="${escapeHtml(skin.source.url)}" target="_blank" rel="noopener noreferrer">GitHub</a></div>` : "";
      const activeSuffix = skin.active ? (english ? " · active" : " · 当前使用") : "";
      return `<div class="dshdc-card"><div class="dshdc-row"><div><h3>${escapeHtml(skin.name)}${activeSuffix}</h3><div class="dshdc-muted">${escapeHtml(skin.description || "")}</div>${source}${pluginWarning}</div><div><button class="dshdc-secondary" data-action="apply-skin" data-id="${escapeHtml(skin.id)}"${skin.active ? " disabled" : ""}>${skin.active ? (english ? "In use" : "正在使用") : (english ? "Use" : "一键使用")}</button> <button class="dshdc-danger" data-action="remove-skin" data-id="${escapeHtml(skin.id)}">${english ? "Remove" : "删除"}</button></div></div></div>`;
    }).join("") || `<div class="dshdc-card dshdc-muted">${english ? "No skins have been imported yet." : "尚未导入皮肤。"}</div>`;
    const catalogCards = dshWebUiSkins.map((skin) => `<article class="dshdc-card dshdc-skill-card"><div class="dshdc-row"><div><h3>${escapeHtml(english ? skin.en : skin.zh)}</h3><div class="dshdc-muted">dsh-web-ui · ${escapeHtml(skin.id)}</div></div><button class="dshdc-secondary" data-action="import-dsh-web-ui" data-id="${escapeHtml(skin.id)}">${english ? "Import" : "导入"}</button></div></article>`).join("");
    const catalog = english
      ? `<section class="dshdc-card" style="margin-top:16px"><h3>dsh-web-ui skin collection</h3><p class="dshdc-muted">Import one of nine curated visual skins directly from a pinned upstream revision. The Trading skin is excluded because it loads external market scripts.</p><div class="dshdc-stack">${catalogCards}</div><p class="dshdc-muted">Each skin contains client-side code. Only enable it after reviewing and trusting the source.</p><a class="dshdc-link" href="https://github.com/zhu1090093659/dsh-web-ui" target="_blank" rel="noopener noreferrer">View dsh-web-ui on GitHub</a></section>`
      : `<section class="dshdc-card" style="margin-top:16px"><h3>dsh-web-ui 开源皮肤库</h3><p class="dshdc-muted">可直接导入 9 款已适配视觉皮肤，来源固定到一个上游版本。Trading 行情皮肤会加载外部脚本，未放入一键库。</p><div class="dshdc-stack">${catalogCards}</div><p class="dshdc-muted">每款皮肤都包含客户端脚本，请在审阅并信任来源后再启用。</p><a class="dshdc-link" href="https://github.com/zhu1090093659/dsh-web-ui" target="_blank" rel="noopener noreferrer">查看 dsh-web-ui 开源项目</a></section>`;
    views.skins.innerHTML = english
      ? `<section class="dshdc-card"><div class="dshdc-row"><div><h3>Current skin</h3><p class="dshdc-muted">${activeSkin ? `In use: ${escapeHtml(activeSkin.name)}` : "Using the default DeepSeek Harness appearance."}</p></div><button class="dshdc-secondary" data-action="clear-skin"${activeSkin ? "" : " disabled"}>Restore default</button></div></section>${catalog}<section class="dshdc-card" style="margin-top:16px"><h3>Import from GitHub</h3><p class="dshdc-muted">Paste a public repository URL. The app downloads its source archive from GitHub and detects DSH skins inside it.</p><div class="dshdc-github-import"><input data-github-skin-url type="url" inputmode="url" placeholder="https://github.com/Small-tailqwq/dsh-deep-whale"><button class="dshdc-primary" data-action="import-skin-github">Import from GitHub</button></div><div class="dshdc-import-progress" data-github-skin-progress hidden aria-live="polite"><progress max="100" value="0"></progress><div class="dshdc-muted" data-github-skin-progress-text></div></div></section><section class="dshdc-card" style="margin-top:16px"><div class="dshdc-row"><div><h3>Import from a file</h3><p class="dshdc-muted">Supports standalone CSS files and compatible DSH skin directories / ZIP files.</p></div><button class="dshdc-primary" data-action="import-skin">Choose skin file</button></div></section><div class="dshdc-toolbar" style="margin-top:28px"><div><h2>Imported skins</h2><div class="dshdc-muted">Switching does not remove other imported skins.</div></div></div><section class="dshdc-stack">${skinCards}</section>`
      : `<section class="dshdc-card"><div class="dshdc-row"><div><h3>当前皮肤</h3><p class="dshdc-muted">${activeSkin ? `正在使用：${escapeHtml(activeSkin.name)}` : "正在使用 DeepSeek Harness 默认外观。"}</p></div><button class="dshdc-secondary" data-action="clear-skin"${activeSkin ? "" : " disabled"}>恢复默认</button></div></section>${catalog}<section class="dshdc-card" style="margin-top:16px"><h3>从 GitHub 导入</h3><p class="dshdc-muted">粘贴公开仓库地址，应用会从 GitHub 官方下载源码包并识别其中的 DSH 皮肤。</p><div class="dshdc-github-import"><input data-github-skin-url type="url" inputmode="url" placeholder="https://github.com/Small-tailqwq/dsh-deep-whale"><button class="dshdc-primary" data-action="import-skin-github">从 GitHub 导入</button></div><div class="dshdc-import-progress" data-github-skin-progress hidden aria-live="polite"><progress max="100" value="0"></progress><div class="dshdc-muted" data-github-skin-progress-text></div></div></section><section class="dshdc-card" style="margin-top:16px"><div class="dshdc-row"><div><h3>本地导入</h3><p class="dshdc-muted">支持纯 CSS 文件，或兼容 DSH 的皮肤目录 / ZIP。</p></div><button class="dshdc-primary" data-action="import-skin">选择皮肤文件</button></div></section><div class="dshdc-toolbar" style="margin-top:28px"><div><h2>已导入皮肤</h2><div class="dshdc-muted">切换前不会删除其他已导入的皮肤。</div></div></div><section class="dshdc-stack">${skinCards}</section>`;
  };
  const renderPage = async (page) => {
    for (const [name, view] of Object.entries(views)) view.hidden = name !== page;
    if (page === "skills") await renderSkills();
    if (page === "usage") await renderUsage();
    if (page === "skins") await renderSkins();
  };
  const closePage = () => {
    root.hidden = true;
    document.documentElement.removeAttribute("data-dsh-desktop-page-active");
    nav.querySelectorAll("[aria-current]").forEach((button) => button.removeAttribute("aria-current"));
  };
  const updatePageHeading = (page) => {
    title.textContent = text().pages[page].title;
    description.textContent = text().pages[page].description;
  };
  const syncLocale = async () => {
    const nextLocale = await api.locale.get();
    if (nextLocale === activeLocale) return;
    const currentPage = nav.querySelector("[aria-current='page']")?.dataset.page;
    activeLocale = nextLocale;
    renderNavigation();
    if (!currentPage || root.hidden) return;
    updatePageHeading(currentPage);
    await renderPage(currentPage);
  };
  const openPage = async (page) => {
    const currentPage = pages[page] ? page : "skills";
    root.hidden = false;
    document.documentElement.setAttribute("data-dsh-desktop-page-active", "");
    updatePageHeading(currentPage);
    nav.querySelectorAll("button[data-page]").forEach((button) => {
      if (button.dataset.page === currentPage) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    try {
      await renderPage(currentPage);
      root.focus({ preventScroll: true });
    } catch (error) {
      setStatus(error.message || "页面加载失败。", true);
    }
  };
  const mountNativeSlots = () => {
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    const workspaceOutlet = sidebar?.querySelector('[data-slot="sidebar.workspaces"]');
    if (workspaceOutlet?.parentElement && nav.parentElement !== workspaceOutlet.parentElement) workspaceOutlet.parentElement.insertBefore(nav, workspaceOutlet);
    const conversation = document.querySelector('[data-slot="conversation"]');
    if (conversation?.parentElement && root.parentElement !== conversation.parentElement) conversation.parentElement.appendChild(root);
  };
  const mountOnboardingEndpoint = () => {
    const apiKeyInput = [...document.querySelectorAll('input[type="password"][required]')].find((input) => !input.closest("#dsh-desktop-workbench"));
    if (!apiKeyInput || document.getElementById("dsh-desktop-onboarding-endpoint")) return;
    const keyField = apiKeyInput.parentElement;
    if (!keyField?.parentElement) return;

    const field = document.createElement("label");
    field.id = "dsh-desktop-onboarding-endpoint";
    field.className = "dshdc-onboarding-field";
    field.innerHTML = `<span class="dshdc-onboarding-label">API 地址（可选）</span><input class="dshdc-onboarding-input" type="url" inputmode="url" autocomplete="url" placeholder="https://api.deepseek.com"><p class="dshdc-onboarding-hint">留空使用 DeepSeek 官方地址；中转站请填写兼容 OpenAI 的根地址，可包含 /v1。</p><p class="dshdc-onboarding-error" hidden></p>`;
    keyField.insertAdjacentElement("afterend", field);

    const input = field.querySelector("input");
    const error = field.querySelector(".dshdc-onboarding-error");
    const warning = document.createElement("p");
    warning.className = "dshdc-onboarding-warning";
    warning.hidden = true;
    warning.textContent = "http 地址会明文传输 API Key，仅建议本机受信任的中转服务使用。";
    field.appendChild(warning);
    input.value = onboardingEndpointDraft;
    if (!onboardingEndpointLoaded) {
      onboardingEndpointLoaded = true;
      api.apiEndpoint.get().then((baseUrl) => {
        if (!onboardingEndpointDraft) onboardingEndpointDraft = baseUrl || "";
        if (input.isConnected) input.value = onboardingEndpointDraft;
      }).catch(() => {});
    }
    let submitted = false;
    const persist = async () => {
      error.hidden = true;
      try {
        const result = await api.apiEndpoint.set(input.value);
        onboardingEndpointDraft = result.baseUrl || "";
        warning.hidden = !result.baseUrl?.startsWith("http://");
        return true;
      } catch (cause) {
        error.textContent = cause.message || "无法保存 API 地址。";
        error.hidden = false;
        return false;
      }
    };
    input.addEventListener("input", () => {
      onboardingEndpointDraft = input.value;
      warning.hidden = !input.value.trim().startsWith("http://");
      error.hidden = true;
    });

    const editor = keyField.parentElement;
    const buttons = [...editor.querySelectorAll('button[type="button"]')];
    const submit = buttons.at(-1);
    if (!submit) return;
    submit.addEventListener("click", async (event) => {
      if (submitted) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submit.disabled = true;
      const saved = await persist();
      submit.disabled = false;
      if (saved) {
        submitted = true;
        submit.click();
      }
    }, true);
  };

  // DSH renders context, reasoning and tool events as independent flow rows.
  // Collapse only a completed trace immediately before an answer, never a
  // live interaction that may still need a response from the user.
  const expandedThoughtGroups = new Set();
  const traceKinds = new Set(["context", "tool-call", "command", "model-retry"]);
  const reasoningDuration = (row) => {
    const text = row.textContent || "";
    let seconds = 0;
    for (const match of text.matchAll(/用时\s*(?:(\d+)分)?\s*(\d+(?:\.\d+)?)秒/g)) {
      seconds += (Number(match[1] || 0) * 60) + Number(match[2]);
    }
    for (const match of text.matchAll(/Ran for\s*(?:(\d+)m\s*)?(\d+(?:\.\d+)?)s/g)) {
      seconds += (Number(match[1] || 0) * 60) + Number(match[2]);
    }
    return seconds;
  };
  const isReasoningOnlyRow = (row) => {
    const reasoning = row.querySelector('[data-variant="think"]');
    if (!reasoning) return false;
    const clone = row.cloneNode(true);
    clone.querySelectorAll('[data-variant="think"]').forEach((node) => node.remove());
    return clone.textContent.trim() === "";
  };
  const isTraceRow = (row) => traceKinds.has(row.dataset.chatFlowKind) || (row.dataset.chatFlowKind === "assistant-step" && isReasoningOnlyRow(row));
  const isAnswerRow = (row) => row.dataset.chatFlowKind === "assistant-step" && !isReasoningOnlyRow(row);
  const thoughtLabel = (seconds, expanded) => {
    if (seconds <= 0) return expanded ? "收起思考" : "思考过程";
    const rounded = Math.max(1, Math.round(seconds));
    const duration = rounded >= 60 ? `${Math.floor(rounded / 60)}分${rounded % 60}秒` : `${rounded}秒`;
    return `${expanded ? "收起思考" : "思考"} · 用时 ${duration}`;
  };
  const mountThoughtDisclosure = () => {
    for (const flow of document.querySelectorAll("[data-chat-flow]")) {
      const rows = [...flow.children].filter((node) => node instanceof HTMLElement && node.dataset.chatFlowKey);
      const activeGroups = new Set();
      for (let index = 0; index < rows.length;) {
        if (!isTraceRow(rows[index])) {
          index += 1;
          continue;
        }
        const start = index;
        while (index < rows.length && isTraceRow(rows[index])) index += 1;
        const traceRows = rows.slice(start, index);
        const answer = rows[index];
        if (!answer || !isAnswerRow(answer)) continue;
        const groupKey = traceRows.map((row) => row.dataset.chatFlowKey).join("|");
        activeGroups.add(groupKey);
        const expanded = expandedThoughtGroups.has(groupKey);
        const seconds = traceRows.reduce((total, row) => total + reasoningDuration(row), 0);
        let button = traceRows[0].previousElementSibling;
        if (!(button instanceof HTMLButtonElement) || button.dataset.dshdcThoughtGroup !== groupKey) {
          button = document.createElement("button");
          button.type = "button";
          button.className = "dshdc-thought-summary";
          button.dataset.dshdcThoughtGroup = groupKey;
          button.addEventListener("click", () => {
            if (expandedThoughtGroups.has(groupKey)) expandedThoughtGroups.delete(groupKey);
            else expandedThoughtGroups.add(groupKey);
            mountThoughtDisclosure();
          });
          flow.insertBefore(button, traceRows[0]);
        }
        const label = thoughtLabel(seconds, expanded);
        // Writing identical text still creates a child-list mutation. Because the
        // surrounding observer watches the whole document, skip no-op writes to
        // avoid scheduling this disclosure pass indefinitely.
        if (button.textContent !== label) button.textContent = label;
        button.setAttribute("aria-expanded", String(expanded));
        for (const row of traceRows) {
          row.classList.toggle("dshdc-thought-hidden", !expanded);
          row.setAttribute("aria-hidden", String(!expanded));
        }
      }
      for (const button of flow.querySelectorAll(":scope > [data-dshdc-thought-group]")) {
        if (!activeGroups.has(button.dataset.dshdcThoughtGroup)) button.remove();
      }
    }
  };

  const prefillComposer = (value) => {
    const candidates = [...document.querySelectorAll('textarea:not([disabled]), [contenteditable="true"][role="textbox"]')];
    const editor = candidates.find((candidate) => candidate.offsetParent !== null);
    if (!editor) return false;
    if (editor instanceof HTMLTextAreaElement) editor.value = value;
    else editor.textContent = value;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    editor.focus();
    return true;
  };

  const startSkillCreator = () => {
    closePage();
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    const newSession = sidebar?.querySelector("button.hHd-Xa_newSession")
      || [...(sidebar?.querySelectorAll("button") || [])].find((button) => /新建会话|new session/i.test(button.getAttribute("aria-label") || ""));
    if (!newSession) throw new Error("未找到“新会话”按钮，请先返回对话后输入 /skill-creator。");
    newSession.click();
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (prefillComposer("/skill-creator ") || attempts >= 12) window.clearInterval(timer);
    }, 150);
  };

  nav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (button) openPage(button.dataset.page);
  });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    try {
      if (button.dataset.action === "close-page") return closePage();
      if (button.dataset.action === "refresh-skills") return renderSkills();
      if (button.dataset.action === "start-skill-creator") return startSkillCreator();
      if (button.dataset.action === "refresh-balance") {
        const output = views.usage.querySelector("[data-balance]");
        output.textContent = "正在查询…";
        const balance = await api.account.getBalance();
        output.innerHTML = !balance.configured ? "尚未配置 DeepSeek API Key。" : balance.customEndpoint ? `当前使用中转 API 地址：<code>${escapeHtml(balance.baseUrl)}</code>。中转站通常不支持 DeepSeek 官方余额接口，请到中转站控制台查看用量。` : balance.balances.map((item) => `<div class="dshdc-balance">${escapeHtml(item.total)} ${escapeHtml(item.currency)}</div><div class="dshdc-muted">赠金 ${escapeHtml(item.granted)} · 充值 ${escapeHtml(item.toppedUp)}</div>`).join("") || "当前账号没有可显示的余额。";
        return;
      }
      if (button.dataset.action === "import-skin") {
        button.disabled = true;
        const skin = await api.skins.import();
        if (skin) {
          setStatus(`已导入 ${skin.name}`);
          await renderSkins();
        }
        return;
      }
      if (button.dataset.action === "import-skin-github") {
        const input = views.skins.querySelector("[data-github-skin-url]");
        const url = input?.value?.trim();
        if (!url) throw new Error("请先粘贴 GitHub 皮肤仓库地址。");
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "正在导入…";
        button.setAttribute("aria-busy", "true");
        input.disabled = true;
        const unsubscribe = api.skins.onImportGitHubProgress(updateGitHubImportProgress);
        updateGitHubImportProgress({ stage: "validate", message: "正在验证 GitHub 地址…", percent: 0 });
        try {
          const skin = await api.skins.importGitHub(url);
          setStatus(`已从 GitHub 导入 ${skin.name}`);
          await renderSkins();
        } catch (error) {
          updateGitHubImportProgress({ stage: "error", message: userMessage(error), percent: 0 });
          throw error;
        } finally {
          unsubscribe();
          button.disabled = false;
          button.textContent = originalLabel;
          button.removeAttribute("aria-busy");
          input.disabled = false;
        }
        return;
      }
      if (button.dataset.action === "import-dsh-web-ui") {
        const skinId = button.dataset.id;
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = activeLocale === "en" ? "Importing…" : "正在导入…";
        button.setAttribute("aria-busy", "true");
        const unsubscribe = api.skins.onImportGitHubProgress(updateGitHubImportProgress);
        updateGitHubImportProgress({ stage: "catalog", message: "正在准备 dsh-web-ui 皮肤…", percent: 0 });
        try {
          const skin = await api.skins.importDshWebUi(skinId);
          setStatus(activeLocale === "en" ? `Imported ${skin.name} from dsh-web-ui.` : `已从 dsh-web-ui 导入 ${skin.name}。`);
          await renderSkins();
        } catch (error) {
          updateGitHubImportProgress({ stage: "error", message: userMessage(error), percent: 0 });
          throw error;
        } finally {
          unsubscribe();
          button.disabled = false;
          button.textContent = originalLabel;
          button.removeAttribute("aria-busy");
        }
        return;
      }
      if (button.dataset.action === "apply-skin") {
        const skin = skins.find((item) => item.id === button.dataset.id);
        if (skin?.type === "plugin" && !window.confirm("此皮肤会执行其自带的客户端脚本，并重启 DSH 服务。仅在信任来源时继续。")) return;
        button.disabled = true;
        const result = await api.skins.apply(button.dataset.id);
        applyCss(result.css);
        setStatus(result.requiresRestart ? "皮肤已启用，DSH 正在重启…" : "皮肤已启用。");
        await renderSkins();
        return;
      }
      if (button.dataset.action === "clear-skin") {
        button.disabled = true;
        const result = await api.skins.clear();
        applyCss(result.css);
        setStatus(result.requiresRestart ? "已恢复默认皮肤，DSH 正在重启…" : "已恢复默认皮肤。");
        await renderSkins();
        return;
      }
      if (button.dataset.action === "remove-skin") {
        const skin = skins.find((item) => item.id === button.dataset.id);
        if (!window.confirm(`删除皮肤“${skin?.name || "此皮肤"}”？此操作无法恢复。`)) return;
        button.disabled = true;
        await api.skins.remove(button.dataset.id);
        setStatus("皮肤已删除。");
        await renderSkins();
      }
    } catch (error) {
      setStatus(userMessage(error), true);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden) closePage();
  });

  let localeSyncTimer = null;
  const observer = new MutationObserver(() => {
    mountNativeSlots();
    mountOnboardingEndpoint();
    mountThoughtDisclosure();
    window.clearTimeout(localeSyncTimer);
    localeSyncTimer = window.setTimeout(() => syncLocale().catch(() => {}), 120);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mountNativeSlots();
  mountOnboardingEndpoint();
  mountThoughtDisclosure();
  localeSyncTimer = window.setTimeout(() => syncLocale().catch(() => {}), 0);
  api.skins.list().then((initial) => applyCss(initial.find((skin) => skin.active && skin.type === "css")?.css)).catch(() => {});
}

window.addEventListener("DOMContentLoaded", injectDesktopPages, { once: true });
