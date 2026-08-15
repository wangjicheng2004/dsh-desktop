const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const yaml = require("js-yaml");
const yauzl = require("yauzl");

const MAX_SKIN_FILES = 100;
const MAX_SKIN_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SKIN_BYTES = 20 * 1024 * 1024;
const MAX_GITHUB_ARCHIVE_BYTES = 20 * 1024 * 1024;
const SKILL_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY = /^[A-Za-z0-9._-]+$/;
const DEEPSEEK_OFFICIAL_BASE_URL = "https://api.deepseek.com";
const DSH_WEB_UI_OWNER = "zhu1090093659";
const DSH_WEB_UI_REPOSITORY = "dsh-web-ui";
// A fixed upstream revision avoids silently executing a newer client bundle after
// the user has chosen a skin from the curated desktop catalog.
const DSH_WEB_UI_REF = "a7a38401dcb011d6f775ab392e9cc2a5b162629f";
const DSH_WEB_UI_SKINS = new Set([
  "blue-fantasy", "dragon-heir", "miku", "minecraft", "qq2006",
  "qq98", "ths", "whale-song", "xp",
]);
const runFile = promisify(execFile);

function safeSkinId(value) {
  const id = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!SKILL_NAME.test(id)) throw new Error("皮肤标识只能使用小写字母、数字和连字符，且必须以字母开头。");
  return id;
}

function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return {};
  const parsed = yaml.load(match[1]);
  return parsed && typeof parsed === "object" ? parsed : {};
}

function safePath(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("皮肤包包含越界路径。");
  return resolved;
}

function normalizeApiBaseUrl(value) {
  const input = String(value || "").trim();
  if (!input) return null;
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("API 地址不是有效 URL。");
  }
  if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("API 地址只能使用 http 或 https。");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("API 地址不能包含账号、密码、查询参数或片段。");
  return parsed.toString().replace(/\/+$/, "");
}

function parseGitHubSkinUrl(value) {
  const input = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("请输入有效的 GitHub 仓库地址。");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error("只支持 https://github.com 的公开仓库地址。");
  }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error("GitHub 地址不能包含账号、端口、查询参数或片段。");
  }
  if (/%2f|%5c/i.test(parsed.pathname)) throw new Error("GitHub 地址包含不安全的路径编码。");
  const segments = parsed.pathname.split("/").filter(Boolean);
  const [owner, repositorySegment, kind, ref, ...subpath] = segments;
  // GitHub's clone URLs conventionally end in .git.  Treat it as transport
  // syntax rather than part of the repository name before calling the API.
  const repository = /\.git$/i.test(repositorySegment || "") ? repositorySegment.slice(0, -4) : repositorySegment;
  if (!GITHUB_OWNER.test(owner || "") || !GITHUB_REPOSITORY.test(repository || "")) {
    throw new Error("GitHub 地址应为 owner/repository 形式。");
  }
  if (segments.length === 2) return { owner, repository, ref: null, subpath: [] };
  if (kind !== "tree" || !ref || !/^[A-Za-z0-9._-]+$/.test(ref) || !subpath.length || subpath.some((part) => part === "." || part === "..")) {
    throw new Error("请粘贴仓库地址，或 GitHub 的 /tree/分支/皮肤目录 地址。");
  }
  return { owner, repository, ref, subpath };
}

function readZipFrom(openArchive) {
  return new Promise((resolve, reject) => {
    openArchive((openError, zip) => {
      if (openError) return reject(new Error("无法读取皮肤压缩包。"));
      const entries = [];
      const names = new Set();
      let totalSize = 0;
      zip.readEntry();
      zip.on("entry", (entry) => {
        const name = entry.fileName.replace(/\\/g, "/");
        const parts = name.split("/").filter(Boolean);
        if (name.startsWith("/") || parts.some((part) => part === "..")) return zip.close(), reject(new Error("皮肤压缩包包含不安全路径。"));
        if (/\/$/.test(name)) return zip.readEntry();
        if (names.has(name)) return zip.close(), reject(new Error("皮肤压缩包包含重复路径。"));
        names.add(name);
        totalSize += entry.uncompressedSize;
        if (entries.length >= MAX_SKIN_FILES || entry.uncompressedSize > MAX_SKIN_FILE_BYTES || totalSize > MAX_SKIN_BYTES) {
          return zip.close(), reject(new Error("皮肤压缩包超出安全大小限制。"));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(new Error("无法读取皮肤压缩包条目。"));
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("error", reject);
          stream.on("end", () => {
            entries.push({ name, data: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
    });
  });
}

function readZip(source) {
  return readZipFrom((callback) => yauzl.open(source, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, callback));
}

function readZipBuffer(buffer) {
  return readZipFrom((callback) => yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, callback));
}

async function readLimitedResponse(response, description, onProgress) {
  if (!response.ok) throw new Error(`${description}失败（HTTP ${response.status}）。`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_GITHUB_ARCHIVE_BYTES) throw new Error("GitHub 皮肤压缩包超过 20 MB 限制。");
  if (!response.body) throw new Error("GitHub 没有返回皮肤压缩包。");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  onProgress?.({ stage: "download", message: "正在下载 GitHub 皮肤…", percent: 20, transferredBytes: 0, totalBytes: declaredSize || null });
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_GITHUB_ARCHIVE_BYTES) {
      await reader.cancel();
      throw new Error("GitHub 皮肤压缩包超过 20 MB 限制。");
    }
    chunks.push(value);
    const percent = declaredSize > 0 ? 20 + Math.min(50, Math.floor((total / declaredSize) * 50)) : 20;
    onProgress?.({ stage: "download", message: "正在下载 GitHub 皮肤…", percent, transferredBytes: total, totalBytes: declaredSize || null });
  }
  return Buffer.concat(chunks);
}

async function readRemoteSkinFile(response, filename) {
  if (!response.ok) throw new Error(`无法下载 dsh-web-ui 皮肤文件 ${filename}（HTTP ${response.status}）。`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_SKIN_FILE_BYTES) {
    throw new Error(`dsh-web-ui 皮肤文件 ${filename} 超过 5 MB 限制。`);
  }
  if (!response.body) throw new Error(`dsh-web-ui 没有返回皮肤文件 ${filename}。`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SKIN_FILE_BYTES) {
      await reader.cancel();
      throw new Error(`dsh-web-ui 皮肤文件 ${filename} 超过 5 MB 限制。`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function listDirectoryFiles(root, current = root, files = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isSymbolicLink()) throw new Error("皮肤目录不能包含符号链接。");
    if (entry.isDirectory()) await listDirectoryFiles(root, absolute, files);
    else if (entry.isFile()) {
      const stat = await fs.stat(absolute);
      if (files.length >= MAX_SKIN_FILES || stat.size > MAX_SKIN_FILE_BYTES) throw new Error("皮肤目录超出安全大小限制。");
      files.push({ name: relative.split(path.sep).join("/"), data: await fs.readFile(absolute) });
    }
  }
  const total = files.reduce((sum, file) => sum + file.data.length, 0);
  if (total > MAX_SKIN_BYTES) throw new Error("皮肤目录超出安全大小限制。");
  return files;
}

function resolveSkinPackage(files, expectedSubpath = []) {
  const manifests = files.filter((file) => file.name.endsWith("/skin.json") || file.name === "skin.json");
  for (const manifest of manifests) {
    const root = path.posix.dirname(manifest.name);
    const rootSegments = root === "." ? [] : root.split("/");
    if (expectedSubpath.length && rootSegments.slice(-expectedSubpath.length).join("/") !== expectedSubpath.join("/")) continue;
    const prefix = root === "." ? "" : `${root}/`;
    const packageEntry = files.find((file) => file.name === `${prefix}package.json`);
    const patchEntry = files.find((file) => file.name === `${prefix}cordis.patch.yml`);
    const clientEntry = files.find((file) => file.name === `${prefix}lib/client.js`);
    if (!packageEntry || !patchEntry || !clientEntry) continue;
    const skin = JSON.parse(manifest.data.toString("utf8"));
    const packageJson = JSON.parse(packageEntry.data.toString("utf8"));
    const packageName = packageJson.name;
    if (!PACKAGE_NAME.test(packageName || "") || packageJson.dsh?.bundle?.patch !== "./cordis.patch.yml") continue;
    return { root: prefix, skin, packageJson, packageName };
  }
  throw new Error(expectedSubpath.length
    ? "该 GitHub 目录中未找到兼容的 DSH 皮肤包。"
    : "未找到兼容的 DSH 皮肤包（需要 skin.json、package.json、cordis.patch.yml 与 lib/client.js）。");
}

async function atomicWrite(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, { mode: 0o600 });
  await fs.rename(temporary, filename);
}

function createDesktopServices({ dshHome, fetchImpl = globalThis.fetch }) {
  const skillsRoot = path.join(dshHome, "skills");
  const skinsRoot = path.join(dshHome, "skins");
  const skinStatePath = path.join(skinsRoot, "state.json");
  const profileRoot = path.join(dshHome, "profiles", "web");
  const settingsPath = path.join(dshHome, "settings.yaml");

  async function readSkinState() {
    try {
      const state = JSON.parse(await fs.readFile(skinStatePath, "utf8"));
      return { activeSkinId: state.activeSkinId || null, skins: state.skins || [] };
    } catch (error) {
      if (error.code === "ENOENT") return { activeSkinId: null, skins: [] };
      throw new Error("皮肤状态文件已损坏，请删除后重试。");
    }
  }

  async function writeSkinState(state) {
    await atomicWrite(skinStatePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  async function listSkills() {
    await fs.mkdir(skillsRoot, { recursive: true });
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filename = path.join(skillsRoot, entry.name, "SKILL.md");
      try {
        const content = await fs.readFile(filename, "utf8");
        const metadata = parseFrontmatter(content);
        if (metadata["user-invocable"] === false) continue;
        skills.push({
          name: typeof metadata.name === "string" ? metadata.name : entry.name,
          description: typeof metadata.description === "string" ? metadata.description : "未提供描述",
          whenToUse: typeof metadata.whenToUse === "string" ? metadata.whenToUse : "",
          modelInvocable: metadata["disable-model-invocation"] !== true,
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  }

  async function readSettings() {
    try {
      const settings = yaml.load(await fs.readFile(settingsPath, "utf8"));
      if (settings === undefined || settings === null) return {};
      if (typeof settings !== "object" || Array.isArray(settings)) throw new Error("设置文件格式不正确。");
      return settings;
    } catch (error) {
      if (error.code === "ENOENT") return {};
      if (error.message === "设置文件格式不正确。") throw error;
      throw new Error("无法读取 DSH 设置文件。");
    }
  }

  async function getApiBaseUrl() {
    const settings = await readSettings();
    const value = settings["llm-deepseek"]?.baseURL;
    return typeof value === "string" && value.trim() ? normalizeApiBaseUrl(value) : null;
  }

  async function getLocale() {
    const settings = await readSettings();
    return settings.locale?.preference === "en" ? "en" : "zh";
  }

  async function setApiBaseUrl(value) {
    const baseUrl = normalizeApiBaseUrl(value);
    const settings = await readSettings();
    const provider = settings["llm-deepseek"];
    if (provider !== undefined && (typeof provider !== "object" || provider === null || Array.isArray(provider))) {
      throw new Error("DSH 的 DeepSeek 设置格式不正确，无法更新 API 地址。");
    }
    const nextProvider = { ...(provider || {}) };
    if (baseUrl) nextProvider.baseURL = baseUrl;
    else delete nextProvider.baseURL;
    if (Object.keys(nextProvider).length) settings["llm-deepseek"] = nextProvider;
    else delete settings["llm-deepseek"];
    await atomicWrite(settingsPath, yaml.dump(settings, { lineWidth: -1, noRefs: true }));
    return { baseUrl };
  }

  async function readApiKey() {
    const envKey = process.env.DEEPSEEK_API_KEY;
    if (envKey) return envKey;
    try {
      const credentials = yaml.load(await fs.readFile(path.join(dshHome, ".credentials.yaml"), "utf8"));
      const value = credentials?.DEEPSEEK_API_KEY;
      return typeof value === "string" && value.trim() ? value.trim() : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("无法读取本地 API Key 配置。");
    }
  }

  async function getBalance() {
    const apiKey = await readApiKey();
    if (!apiKey) return { configured: false, balances: [] };
    const baseUrl = (await getApiBaseUrl()) || normalizeApiBaseUrl(process.env.DEEPSEEK_BASE_URL);
    if (baseUrl && baseUrl !== DEEPSEEK_OFFICIAL_BASE_URL) {
      return { configured: true, customEndpoint: true, baseUrl, balances: [] };
    }
    let response;
    try {
      response = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new Error("无法连接 DeepSeek 余额服务，请检查网络后重试。");
    }
    if (!response.ok) throw new Error(`余额查询失败（HTTP ${response.status}）。请确认当前 API Key 有效。`);
    const payload = await response.json();
    return {
      configured: true,
      available: payload.is_available === true,
      balances: Array.isArray(payload.balance_infos) ? payload.balance_infos.map((item) => ({
        currency: item.currency,
        total: item.total_balance,
        granted: item.granted_balance,
        toppedUp: item.topped_up_balance,
      })) : [],
    };
  }

  async function listSkins() {
    const state = await readSkinState();
    return state.skins.map((skin) => ({ ...skin, active: skin.id === state.activeSkinId }));
  }

  async function importPluginSkin(files, source = null, expectedSubpath = [], onProgress) {
    onProgress?.({ stage: "inspect", message: "正在检查皮肤包…", percent: 74 });
    const bundle = resolveSkinPackage(files, expectedSubpath);
    const id = safeSkinId(bundle.skin.id || bundle.packageName.replace(/^@/, "").replace(/\//g, "-"));
    const state = await readSkinState();
    if (state.skins.some((skin) => skin.id === id)) throw new Error("同名皮肤已存在，请先删除旧皮肤。");
    const destination = path.join(skinsRoot, id, "package");
    const packageFiles = files.filter((file) => file.name.startsWith(bundle.root));
    for (const [index, file] of packageFiles.entries()) {
      const relative = file.name.slice(bundle.root.length);
      await fs.mkdir(path.dirname(safePath(destination, relative)), { recursive: true });
      await fs.writeFile(safePath(destination, relative), file.data, { mode: 0o600 });
      onProgress?.({
        stage: "install",
        message: "正在保存皮肤文件…",
        percent: 80 + Math.floor(((index + 1) / packageFiles.length) * 18),
      });
    }
    const skin = {
      id,
      name: bundle.skin.name || bundle.packageName,
      description: bundle.skin.description || "DSH 插件皮肤",
      type: "plugin",
      packageName: bundle.packageName,
      path: destination,
      ...(source ? { source } : {}),
    };
    state.skins.push(skin);
    await writeSkinState(state);
    onProgress?.({ stage: "complete", message: "皮肤已导入。", percent: 100 });
    return skin;
  }

  async function importSkin(sourcePath) {
    const stat = await fs.stat(sourcePath);
    if (stat.isFile() && path.extname(sourcePath).toLowerCase() === ".css") {
      const css = await fs.readFile(sourcePath, "utf8");
      if (Buffer.byteLength(css) > MAX_SKIN_FILE_BYTES) throw new Error("CSS 皮肤文件过大。");
      const id = safeSkinId(path.basename(sourcePath, ".css"));
      const state = await readSkinState();
      if (state.skins.some((skin) => skin.id === id)) throw new Error("同名皮肤已存在，请先删除旧皮肤。");
      const skin = { id, name: id, description: "自定义 CSS 皮肤", type: "css", css };
      state.skins.push(skin);
      await writeSkinState(state);
      return { ...skin, css: undefined };
    }
    const files = stat.isDirectory() ? await listDirectoryFiles(sourcePath) : await readZip(sourcePath);
    return importPluginSkin(files);
  }

  async function importSkinFromGitHub(url, onProgress) {
    if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 GitHub 皮肤下载。");
    const source = parseGitHubSkinUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      onProgress?.({ stage: "validate", message: "正在验证 GitHub 仓库…", percent: 5 });
      let ref = source.ref;
      if (!ref) {
        const metadata = await fetchImpl(`https://api.github.com/repos/${source.owner}/${source.repository}`, {
          headers: { Accept: "application/vnd.github+json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!metadata.ok) throw new Error(`无法读取 GitHub 仓库（HTTP ${metadata.status}）。请确认仓库是公开的。`);
        const payload = await metadata.json();
        if (typeof payload.default_branch !== "string" || !/^[A-Za-z0-9._-]+$/.test(payload.default_branch)) {
          throw new Error("GitHub 仓库没有可下载的默认分支。");
        }
        ref = payload.default_branch;
      }
      onProgress?.({ stage: "archive", message: `正在获取 ${ref} 分支的源码包…`, percent: 15 });
      const archive = await fetchImpl(`https://codeload.github.com/${source.owner}/${source.repository}/zip/${encodeURIComponent(ref)}`, {
        headers: { Accept: "application/zip" },
        redirect: "error",
        signal: controller.signal,
      });
      const archiveBuffer = await readLimitedResponse(archive, "下载 GitHub 皮肤", onProgress);
      onProgress?.({ stage: "extract", message: "正在解压并识别 DSH 皮肤…", percent: 70 });
      const files = await readZipBuffer(archiveBuffer);
      return importPluginSkin(files, {
        kind: "github",
        url: `https://github.com/${source.owner}/${source.repository}${source.ref ? `/tree/${source.ref}/${source.subpath.join("/")}` : ""}`,
        owner: source.owner,
        repository: source.repository,
        ref,
      }, source.subpath, onProgress);
    } catch (error) {
      if (error.name === "AbortError") throw new Error("下载 GitHub 皮肤超时，请检查网络后重试。");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function importDshWebUiSkin(skinId, onProgress) {
    if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 dsh-web-ui 皮肤下载。");
    const id = String(skinId || "").trim();
    if (!DSH_WEB_UI_SKINS.has(id)) throw new Error("该 dsh-web-ui 皮肤不在桌面端支持列表中。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const root = `packages/skins/${id}`;
    const filenames = ["skin.json", "package.json", "cordis.patch.yml", "lib/index.js", "lib/client.js"];
    try {
      onProgress?.({ stage: "catalog", message: "正在下载 dsh-web-ui 皮肤…", percent: 8 });
      const files = [];
      let totalBytes = 0;
      for (const [index, filename] of filenames.entries()) {
        const response = await fetchImpl(
          `https://raw.githubusercontent.com/${DSH_WEB_UI_OWNER}/${DSH_WEB_UI_REPOSITORY}/${DSH_WEB_UI_REF}/${root}/${filename}`,
          { redirect: "error", signal: controller.signal },
        );
        const data = await readRemoteSkinFile(response, filename);
        totalBytes += data.length;
        if (totalBytes > MAX_SKIN_BYTES) throw new Error("dsh-web-ui 皮肤超过 20 MB 限制。");
        files.push({ name: filename, data });
        onProgress?.({
          stage: "catalog",
          message: `正在下载 dsh-web-ui 皮肤（${index + 1}/${filenames.length}）…`,
          percent: 8 + Math.floor(((index + 1) / filenames.length) * 62),
        });
      }
      return importPluginSkin(files, {
        kind: "dsh-web-ui",
        url: `https://github.com/${DSH_WEB_UI_OWNER}/${DSH_WEB_UI_REPOSITORY}/tree/${DSH_WEB_UI_REF}/${root}`,
        owner: DSH_WEB_UI_OWNER,
        repository: DSH_WEB_UI_REPOSITORY,
        ref: DSH_WEB_UI_REF,
      }, [], onProgress);
    } catch (error) {
      if (error.name === "AbortError") throw new Error("下载 dsh-web-ui 皮肤超时，请检查网络后重试。");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function activatePluginSkin(skin, state) {
    const manifestPath = path.join(profileRoot, "package.json");
    let profile;
    try {
      profile = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("DSH 尚未完成初始化，请重启应用后再启用插件皮肤。");
      throw error;
    }
    const bundles = profile.dsh?.profile?.bundles || [];
    const pluginNames = state.skins.filter((item) => item.type === "plugin").map((item) => item.packageName);
    profile.dsh = { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles: [...bundles.filter((name) => !pluginNames.includes(name)), skin.packageName] } };
    const target = safePath(path.join(profileRoot, "node_modules"), skin.packageName);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(skin.path, target, { recursive: true, dereference: false, errorOnExist: true });
    await atomicWrite(manifestPath, `${JSON.stringify(profile, null, 2)}\n`);
  }

  async function removePluginBundles(state, packageNames = null) {
    const manifestPath = path.join(profileRoot, "package.json");
    let profile;
    try {
      profile = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const pluginNames = packageNames || state.skins.filter((item) => item.type === "plugin").map((item) => item.packageName);
    const bundles = profile.dsh?.profile?.bundles || [];
    profile.dsh = {
      ...profile.dsh,
      profile: { ...profile.dsh?.profile, bundles: bundles.filter((name) => !pluginNames.includes(name)) },
    };
    await atomicWrite(manifestPath, `${JSON.stringify(profile, null, 2)}\n`);
  }

  async function applySkin(id) {
    const state = await readSkinState();
    const skin = state.skins.find((item) => item.id === id);
    if (!skin) throw new Error("未找到此皮肤。");
    const previousSkin = state.skins.find((item) => item.id === state.activeSkinId);
    if (skin.type === "plugin") await activatePluginSkin(skin, state);
    else if (previousSkin?.type === "plugin") await removePluginBundles(state);
    state.activeSkinId = id;
    await writeSkinState(state);
    return {
      requiresRestart: skin.type === "plugin" || previousSkin?.type === "plugin",
      css: skin.type === "css" ? skin.css : null,
    };
  }

  async function clearSkin() {
    const state = await readSkinState();
    const previousSkin = state.skins.find((item) => item.id === state.activeSkinId);
    if (previousSkin?.type === "plugin") await removePluginBundles(state);
    state.activeSkinId = null;
    await writeSkinState(state);
    return { requiresRestart: previousSkin?.type === "plugin", css: "" };
  }

  async function removeSkin(id) {
    const state = await readSkinState();
    const skin = state.skins.find((item) => item.id === id);
    if (!skin) return;
    const isActive = skin.id === state.activeSkinId;
    if (isActive) state.activeSkinId = null;
    if (skin.type === "plugin") {
      await removePluginBundles(state, [skin.packageName]);
      await fs.rm(safePath(path.join(profileRoot, "node_modules"), skin.packageName), { recursive: true, force: true });
    }
    state.skins = state.skins.filter((item) => item.id !== id);
    await fs.rm(path.join(skinsRoot, id), { recursive: true, force: true });
    await writeSkinState(state);
    return { requiresRestart: skin.type === "plugin" && isActive };
  }

  async function runGit(cwd, args) {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || cwd.includes("\0")) throw new Error("当前工程路径无效。");
    try {
      return await runFile("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("未找到 Git，请先安装 Git 后再使用分支切换。");
      throw error;
    }
  }

  async function gitRepositoryRoot(cwd) {
    try {
      const { stdout } = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
      return stdout.trim();
    } catch (error) {
      if (error.code === 128) return null;
      throw error;
    }
  }

  async function getGitContext(cwd) {
    const root = await gitRepositoryRoot(cwd);
    if (!root) return { isRepository: false };
    const [branchResult, branchesResult, statusResult] = await Promise.all([
      runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(async (error) => {
        if (error.code !== 1) throw error;
        return runGit(root, ["rev-parse", "--short", "HEAD"]);
      }),
      runGit(root, ["branch", "--format=%(refname:short)"]),
      runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ]);
    return {
      isRepository: true,
      root,
      repoName: path.basename(root),
      branch: branchResult.stdout.trim(),
      branches: branchesResult.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      dirty: Boolean(statusResult.stdout.trim()),
    };
  }

  async function switchGitBranch(cwd, branch) {
    const nextBranch = String(branch || "").trim();
    if (!nextBranch || nextBranch.includes("\0")) throw new Error("目标分支无效。");
    const context = await getGitContext(cwd);
    if (!context.isRepository) throw new Error("当前工程不是 Git 仓库。");
    if (!context.branches.includes(nextBranch)) throw new Error("只能切换到当前仓库已有的本地分支。");
    if (context.branch === nextBranch) return context;
    try {
      await runGit(context.root, ["switch", "--quiet", nextBranch]);
    } catch (error) {
      const detail = String(error.stderr || "").trim();
      throw new Error(detail ? `无法切换分支：${detail}` : "无法切换分支。Git 已保留当前未提交改动，请检查冲突或该分支是否已在其他工作树中使用。");
    }
    return getGitContext(context.root);
  }

  return {
    listSkills,
    getLocale,
    getApiBaseUrl,
    setApiBaseUrl,
    getBalance,
    listSkins,
    importSkin,
    importSkinFromGitHub,
    importDshWebUiSkin,
    applySkin,
    clearSkin,
    removeSkin,
    getGitContext,
    switchGitBranch,
  };
}

module.exports = { createDesktopServices, parseGitHubSkinUrl };
