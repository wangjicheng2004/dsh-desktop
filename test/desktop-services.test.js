const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const yaml = require("js-yaml");
const { createDesktopServices, parseGitHubSkinUrl } = require("../desktop-services");

async function withTemporaryHome(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-desktop-test-"));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("lists user Skills without creating them from the desktop shell", async () => {
  await withTemporaryHome(async (dshHome) => {
    const services = createDesktopServices({ dshHome });
    const skillDirectory = path.join(dshHome, "skills", "release-notes");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "---\nname: release-notes\ndescription: 整理发布说明\n---\n\n根据提交记录生成发布说明。\n");

    assert.deepEqual(await services.listSkills(), [{
      name: "release-notes",
      description: "整理发布说明",
      whenToUse: "",
      modelInvocable: true,
    }]);
  });
});

test("stores a custom chat endpoint in DSH settings and clears it for the official default", async () => {
  await withTemporaryHome(async (dshHome) => {
    const services = createDesktopServices({ dshHome });
    await fs.writeFile(path.join(dshHome, "settings.yaml"), "other-plugin:\n  enabled: true\n");

    assert.deepEqual(await services.setApiBaseUrl("https://gateway.example/v1/"), { baseUrl: "https://gateway.example/v1" });
    assert.equal(await services.getApiBaseUrl(), "https://gateway.example/v1");
    const settings = yaml.load(await fs.readFile(path.join(dshHome, "settings.yaml"), "utf8"));
    assert.deepEqual(settings, {
      "other-plugin": { enabled: true },
      "llm-deepseek": { baseURL: "https://gateway.example/v1" },
    });

    assert.deepEqual(await services.setApiBaseUrl(""), { baseUrl: null });
    assert.equal(await services.getApiBaseUrl(), null);
    await assert.rejects(services.setApiBaseUrl("ftp://gateway.example"), /http 或 https/);
    await assert.rejects(services.setApiBaseUrl("https://name:secret@gateway.example/v1"), /账号、密码/);
  });
});

test("reads the DSH locale preference for desktop copy", async () => {
  await withTemporaryHome(async (dshHome) => {
    const services = createDesktopServices({ dshHome });
    assert.equal(await services.getLocale(), "zh");
    await fs.writeFile(path.join(dshHome, "settings.yaml"), "locale:\n  preference: en\n");
    assert.equal(await services.getLocale(), "en");
  });
});

test("accepts only safe public GitHub skin repository URLs", () => {
  assert.deepEqual(parseGitHubSkinUrl("https://github.com/Small-tailqwq/dsh-deep-whale"), {
    owner: "Small-tailqwq", repository: "dsh-deep-whale", ref: null, subpath: [],
  });
  assert.deepEqual(parseGitHubSkinUrl("https://github.com/Small-tailqwq/dsh-deep-whale.git"), {
    owner: "Small-tailqwq", repository: "dsh-deep-whale", ref: null, subpath: [],
  });
  assert.deepEqual(parseGitHubSkinUrl("https://github.com/Small-tailqwq/dsh-deep-whale/tree/main/maid-atelier"), {
    owner: "Small-tailqwq", repository: "dsh-deep-whale", ref: "main", subpath: ["maid-atelier"],
  });
  assert.throws(() => parseGitHubSkinUrl("http://github.com/example/skin"), /https:\/\/github\.com/);
  assert.throws(() => parseGitHubSkinUrl("https://github.com:444/example/skin?token=no"), /账号、端口、查询参数/);
  assert.throws(() => parseGitHubSkinUrl("https://github.com/example/skin/tree/main/%2Fsecret"), /不安全/);
});

test("reads local Git branches and lets Git protect dirty worktree switches", async () => {
  await withTemporaryHome(async (dshHome) => {
    const repository = path.join(dshHome, "repository");
    await fs.mkdir(repository);
    const git = (args) => execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
    git(["init", "--initial-branch", "main"]);
    git(["config", "user.email", "desktop@example.test"]);
    git(["config", "user.name", "Desktop Test"]);
    await fs.writeFile(path.join(repository, "README.md"), "# test\n");
    git(["add", "README.md"]);
    git(["commit", "-m", "initial"]);
    git(["branch", "feature/alternate"]);
    const services = createDesktopServices({ dshHome });

    assert.deepEqual(await services.getGitContext(path.join(dshHome, "missing")), { isRepository: false });
    const context = await services.getGitContext(repository);
    assert.equal(context.branch, "main");
    assert.deepEqual(context.branches, ["feature/alternate", "main"]);
    const switched = await services.switchGitBranch(repository, "feature/alternate");
    assert.equal(switched.branch, "feature/alternate");
    await assert.rejects(services.switchGitBranch(repository, "missing"), /已有的本地分支/);

    await fs.writeFile(path.join(repository, "README.md"), "# dirty\n");
    const switchedWithChanges = await services.switchGitBranch(repository, "main");
    assert.equal(switchedWithChanges.branch, "main");
    assert.equal(switchedWithChanges.dirty, true);
  });
});

test("imports, activates, and removes a CSS skin without a plugin runtime", async () => {
  await withTemporaryHome(async (dshHome) => {
    const source = path.join(dshHome, "midnight.css");
    await fs.writeFile(source, "body { --accent: #7755ff; }\n");
    const services = createDesktopServices({ dshHome });

    const skin = await services.importSkin(source);
    assert.equal(skin.type, "css");
    assert.deepEqual(await services.applySkin(skin.id), {
      requiresRestart: false,
      css: "body { --accent: #7755ff; }\n",
    });
    assert.equal((await services.listSkins())[0].active, true);
    assert.deepEqual(await services.clearSkin(), { requiresRestart: false, css: "" });
    assert.equal((await services.listSkins())[0].active, false);
    await services.applySkin(skin.id);
    assert.deepEqual(await services.removeSkin(skin.id), { requiresRestart: false });
    assert.deepEqual(await services.listSkins(), []);
  });
});

test("ships a bundled Skill creator that defaults to project .dsh skills", async () => {
  const content = await fs.readFile(path.join(__dirname, "..", "bundled-skills", "skill-creator", "SKILL.md"), "utf8");
  assert.match(content, /name: skill-creator/);
  assert.match(content, /<项目根>\/\.dsh\/skills/);
  assert.match(content, /\$DSH_HOME\/skills/);
  assert.match(content, /绝不覆盖/);
});

test("ships the session-aware Git branch client bundle", async () => {
  const root = path.join(__dirname, "..", "bundled-plugins", "git-branch");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "@dsh-desktop/git-branch");
  assert.match(await fs.readFile(path.join(root, "cordis.patch.yml"), "utf8"), /desktop-git-branch/);
  const client = await fs.readFile(path.join(root, "lib", "client.js"), "utf8");
  assert.match(client, /conversation\.input\.dock/);
  assert.match(client, /window\.dshDesktop\.git\.switch/);
});

test("ships a completed-turn thought disclosure without hiding live interactions", async () => {
  const preload = await fs.readFile(path.join(__dirname, "..", "desktop-preload.js"), "utf8");
  assert.match(preload, /data-dshdc-thought-group/);
  assert.match(preload, /isAnswerRow/);
  assert.match(preload, /Collapse only a completed trace immediately before an answer/);
  assert.match(preload, /aria-expanded/);
  assert.match(preload, /const label = thoughtLabel\(seconds, expanded\);\s+\/\/ Writing identical text[\s\S]*?if \(button\.textContent !== label\) button\.textContent = label;/);
});

test("ships GitHub skin import progress and retryable error handling", async () => {
  const preload = await fs.readFile(path.join(__dirname, "..", "desktop-preload.js"), "utf8");
  const services = await fs.readFile(path.join(__dirname, "..", "desktop-services.js"), "utf8");
  assert.match(preload, /onImportGitHubProgress/);
  assert.match(preload, /data-github-skin-progress/);
  assert.match(services, /正在下载 GitHub 皮肤/);
  assert.match(preload, /finally \{/);
  assert.match(preload, /input\.disabled = false/);
});

test("imports a selected dsh-web-ui catalog skin from its pinned source files", async () => {
  await withTemporaryHome(async (dshHome) => {
    const files = {
      "skin.json": JSON.stringify({ id: "qq98", name: "QQ2008 怀旧版", description: "retro" }),
      "package.json": JSON.stringify({
        name: "@linxin666/dsh-client-ui-skin-qq98",
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
      }),
      "cordis.patch.yml": "- insert: []\n",
      "lib/index.js": "export function apply() {}\n",
      "lib/client.js": "window.__ModuleLoader__ = window.__ModuleLoader__;\n",
    };
    const requested = [];
    const services = createDesktopServices({
      dshHome,
      fetchImpl: async (url) => {
        requested.push(url);
        const filename = url.split("/").slice(-2).join("/");
        return new Response(files[files[filename] ? filename : url.split("/").pop()] || "", { status: files[files[filename] ? filename : url.split("/").pop()] ? 200 : 404 });
      },
    });

    const skin = await services.importDshWebUiSkin("qq98");
    assert.equal(skin.id, "qq98");
    assert.equal(skin.source.kind, "dsh-web-ui");
    assert.equal(requested.length, 5);
    assert.match(requested[0], /raw\.githubusercontent\.com\/zhu1090093659\/dsh-web-ui\/a7a38401/);
    await assert.rejects(services.importDshWebUiSkin("trading"), /支持列表/);
  });
});

test("ships locale-synced desktop navigation in the compact sidebar style", async () => {
  const preload = await fs.readFile(path.join(__dirname, "..", "desktop-preload.js"), "utf8");
  assert.match(preload, /desktop:locale:get/);
  assert.match(preload, /activeLocale/);
  assert.match(preload, /syncLocale/);
  assert.match(preload, /skills: \{ icon: '<svg viewBox=/);
  assert.match(preload, /#dsh-desktop-nav button\{.*height:32px/s);
  assert.match(preload, /sidebarRoot\.insertBefore\(nav, anchor\.nextElementSibling\)/);
  assert.match(preload, /\[data-sidebar-collapsed\] \.dshdc-nav-label\{display:none\}/);
  assert.match(preload, /const panelActivateEvent = "dsh-panel-activate"/);
  assert.match(preload, /const desktopPanelName = "desktop-page"/);
  assert.match(preload, /const taskboardClosePanelName = "ssh"/);
  assert.match(preload, /data-dsh-taskboard-active/);
  assert.match(preload, /data-dsh-taskboard-view\]\[data-dsh-taskboard-view\]/);
  assert.match(preload, /document\.dispatchEvent\(new CustomEvent\(panelActivateEvent, \{ detail: desktopPanelName \}\)\)/);
  assert.match(preload, /event\.detail !== desktopPanelName && !root\.hidden/);
  assert.match(preload, /isSidebarNavigationClick/);
  assert.match(preload, /returnToConversation\(\)/);
  assert.match(preload, /target\.closest\("\[data-dsh-taskboard-entry\]"\)/);
});

test("ships the dsh-web-ui catalog without its external-script trading skin", async () => {
  const preload = await fs.readFile(path.join(__dirname, "..", "desktop-preload.js"), "utf8");
  const services = await fs.readFile(path.join(__dirname, "..", "desktop-services.js"), "utf8");
  assert.match(preload, /dsh-web-ui 开源皮肤库/);
  assert.match(preload, /import-dsh-web-ui/);
  assert.match(services, /importDshWebUiSkin/);
  assert.doesNotMatch(services, /"trading"/);
});

test("ships the upstream task board and Git graph without the side workbench", async () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const main = await fs.readFile(path.join(root, "main.js"), "utf8");

  assert.equal(manifest.dependencies["@linxin666/dsh-client-ui-task-board"], "0.1.20");
  assert.equal(manifest.dependencies["@linxin666/dsh-client-ui-git-graph"], "0.1.20");
  assert.match(main, /dsh-client-ui-task-board/);
  assert.match(main, /dsh-client-ui-git-graph/);
  assert.match(main, /bundledRuntimePackageDirectory\("@deepseek-ai\/dsh-settings"\)/);
  assert.match(main, /resolveRuntimeDependency/);
  assert.match(main, /Object\.keys\(sourcePackage\.dependencies \|\| \{\}\)/);
  assert.match(main, /retiredPackages = new Set\(\["@dsh-desktop\/git-branch"\]\)/);
  assert.match(main, /await ensureDesktopClientPlugins\(\);\s+if \(await waitForServer\(3000\)\)/);
  assert.doesNotMatch(main, /side-workbench|desktop:workbench|workbench-panel\.html|workbench-preload\.js/);
});

test("declares DSH peer runtime packages as desktop production dependencies", async () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
  const runtimePeerPackages = [
    "@deepseek-ai/dsh-anonymous-user-id",
    "@deepseek-ai/dsh-atomic-write",
    "@deepseek-ai/dsh-bash-local",
    "@deepseek-ai/dsh-code-runtime",
    "@deepseek-ai/dsh-compaction",
    "@deepseek-ai/dsh-fs",
    "@deepseek-ai/dsh-invariants",
    "@deepseek-ai/dsh-output-retention",
    "@deepseek-ai/dsh-sandbox",
    "@deepseek-ai/dsh-scope",
    "@deepseek-ai/dsh-session-telemetry",
    "@deepseek-ai/dsh-session-title-llm",
    "@deepseek-ai/dsh-shell",
    "@deepseek-ai/dsh-spill",
    "@deepseek-ai/dsh-subagent-in-process-driver",
    "@deepseek-ai/dsh-subprocess",
    "@deepseek-ai/dsh-timeout",
    "@deepseek-ai/dsh-workflow",
  ];

  for (const packageName of runtimePeerPackages) {
    assert.equal(manifest.dependencies[packageName], "0.1.0-rc.6", `${packageName} must be a production dependency`);
    assert.equal(lock.packages[""].dependencies[packageName], "0.1.0-rc.6", `${packageName} must be locked at the root`);
    assert.equal(lock.packages[`node_modules/${packageName}`].version, "0.1.0-rc.6", `${packageName} package must be locked`);
  }
});

test("pins desktop builds to a supported Node version and verifies Windows on Windows", async () => {
  const root = path.join(__dirname, "..");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const installer = await fs.readFile(path.join(root, "install.ps1"), "utf8");
  const main = await fs.readFile(path.join(root, "main.js"), "utf8");
  const preload = await fs.readFile(path.join(root, "desktop-preload.js"), "utf8");
  const workflow = await fs.readFile(path.join(root, ".github", "workflows", "verify-desktop-builds.yml"), "utf8");

  assert.equal(manifest.engines.node, ">=22.19.0");
  assert.match(installer, /Node\.js 22\.19\.0 or later/);
  assert.match(installer, /npm\.cmd ci/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /npm run package:win/);
  assert.match(workflow, /runs-on: macos-14/);
  assert.match(workflow, /npm run package:mac/);
  assert.match(workflow, /npm run package:win -- --publish never/);
  assert.match(workflow, /npm run package:mac -- --publish never/);
  assert.match(workflow, /ulimit -n 65536/);
  assert.equal(manifest.build.asar, true);
  assert.deepEqual(manifest.build.asarUnpack, ["node_modules/**/*"]);
  assert.doesNotMatch(JSON.stringify(manifest.build.extraResources), /"from":"node_modules"/);
  assert.match(main, /app\.asar\.unpacked.*node_modules/s);
  assert.match(main, /titleBarStyle:\s*process\.platform === "darwin" \? "hiddenInset" : "default"/);
  assert.match(preload, /dataset\.dshDesktopMacOs/);
  assert.match(preload, /\[data-slot="sidebar"\]>div>\[class\*="logoRow"\].*-webkit-app-region:drag/);
  assert.match(preload, /\[data-slot="conversation"\] header.*-webkit-app-region:drag/);
  assert.match(preload, /:is\(button,a,input,textarea,select,\[role="button"\]\)\{-webkit-app-region:no-drag\}/);
});

test("activates a trusted DSH plugin skin through the web profile", async () => {
  await withTemporaryHome(async (dshHome) => {
    const source = path.join(dshHome, "trusted-skin");
    const profile = path.join(dshHome, "profiles", "web");
    await fs.mkdir(path.join(source, "lib"), { recursive: true });
    await fs.mkdir(profile, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(source, "skin.json"), JSON.stringify({ id: "trusted-skin", name: "可信皮肤" })),
      fs.writeFile(path.join(source, "package.json"), JSON.stringify({
        name: "@example/trusted-skin",
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
      })),
      fs.writeFile(path.join(source, "cordis.patch.yml"), "plugins: []\n"),
      fs.writeFile(path.join(source, "lib", "client.js"), "module.exports = {};\n"),
      fs.writeFile(path.join(profile, "package.json"), JSON.stringify({
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-web-app"] } },
      })),
    ]);
    const services = createDesktopServices({ dshHome });

    const skin = await services.importSkin(source);
    assert.equal(skin.type, "plugin");
    assert.equal((await services.applySkin(skin.id)).requiresRestart, true);
    const manifest = JSON.parse(await fs.readFile(path.join(profile, "package.json"), "utf8"));
    assert.deepEqual(manifest.dsh.profile.bundles, ["@deepseek-ai/dsh-web-app", "@example/trusted-skin"]);
    await fs.access(path.join(profile, "node_modules", "@example", "trusted-skin", "lib", "client.js"));

    assert.deepEqual(await services.removeSkin(skin.id), { requiresRestart: true });
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(profile, "package.json"), "utf8")).dsh.profile.bundles, ["@deepseek-ai/dsh-web-app"]);
  });
});
