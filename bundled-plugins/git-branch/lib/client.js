window.__ModuleLoader__.load({
  id: "@dsh-desktop/git-branch",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const jsx = require("react/jsx-runtime");

    const styleId = "@dsh-desktop/git-branch/styles";
    if (!document.querySelector(`style[data-plugin-css="${styleId}"]`)) {
      const style = document.createElement("style");
      style.dataset.pluginCss = styleId;
      style.textContent = ".dsh-desktop-git-dock{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;font-size:12px;gap:6px;line-height:20px;padding:2px 20px 0}.dsh-desktop-git-dock__repo{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-desktop-git-dock__select{appearance:none;background:var(--dsw-alias-interactive-bg-hover);border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;max-width:280px;outline:none;padding:3px 26px 3px 8px}.dsh-desktop-git-dock__select:disabled{cursor:not-allowed;opacity:.55}.dsh-desktop-git-dock__refresh{background:transparent;border:0;color:inherit;cursor:pointer;font:inherit;padding:3px 4px}.dsh-desktop-git-dock__refresh:hover{color:var(--dsw-alias-label-primary)}.dsh-desktop-git-dock__notice{color:var(--dsw-alias-state-warning-primary,#d59f36);margin-left:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}";
      document.head.appendChild(style);
    }

    function GitBranchDock({ sessionId, useSessions }) {
      const cwd = useSessions((state) => state.byId[sessionId]?.cwd);
      const [context, setContext] = React.useState();
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState("");
      const refresh = React.useCallback(async () => {
        if (!cwd) return;
        setNotice("");
        try {
          setContext(await window.dshDesktop.git.context(cwd));
        } catch (error) {
          setNotice(error.message || "无法读取 Git 分支。");
        }
      }, [cwd]);
      React.useEffect(() => { refresh(); }, [refresh]);
      if (!cwd || context?.isRepository === false) return null;
      const switchBranch = async (event) => {
        const branch = event.target.value;
        if (!branch || branch === context?.branch || !window.confirm(`切换到 ${branch}？Git 会在可能覆盖或冲突时拒绝切换，未提交改动不会丢失。`)) return;
        setBusy(true);
        setNotice("");
        try {
          setContext(await window.dshDesktop.git.switch(cwd, branch));
          setNotice("已切换；建议新开对话，让上下文重新读取工程文件。");
        } catch (error) {
          setNotice(error.message || "切换分支失败。");
        } finally {
          setBusy(false);
        }
      };
      if (!context) return null;
      return jsx.jsxs("div", {
        className: "dsh-desktop-git-dock",
        children: [
          jsx.jsx("span", { className: "dsh-desktop-git-dock__repo", title: context.root, children: `⌘ ${context.repoName}` }),
          jsx.jsx("select", {
            className: "dsh-desktop-git-dock__select",
            value: context.branch,
            disabled: busy,
            title: context.dirty ? "有未提交改动；Git 会在不安全时拒绝切换" : "切换当前工程分支",
            onChange: switchBranch,
            children: context.branches.map((branch) => jsx.jsx("option", { value: branch, children: branch }, branch)),
          }),
          jsx.jsx("button", { type: "button", className: "dsh-desktop-git-dock__refresh", disabled: busy, onClick: refresh, children: "刷新" }),
          context.dirty && jsx.jsx("span", { className: "dsh-desktop-git-dock__notice", children: "有未提交改动" }),
          notice && jsx.jsx("span", { className: "dsh-desktop-git-dock__notice", role: "status", children: notice }),
        ],
      });
    }

    function apply(ctx) {
      // `conversation.composer.dock` is deliberately absent on DSH's new-session
      // hero. The input dock is available for both the hero and normal composer.
      ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
        name: "conversation.input.dock",
        id: "desktop-git-branch",
        order: -10,
      }, GitBranchDock));
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    return module.exports;
  },
});
