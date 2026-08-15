---
name: skill-creator
description: 将用户的自然语言需求梳理为可复用的 DSH Skill，并默认安全保存到当前项目的 .dsh/skills。
whenToUse: 当用户希望创建、生成、沉淀或安装一个本地 Skill 时使用。
user-invocable: true
---

# 创建本地 Skill

先用不超过 3 个问题确认：Skill 名称（kebab-case）、触发场景/输入、期望步骤与边界。需求已足够明确时不要重复提问。

创建前必须：

1. 若当前会话绑定了本地工作区，默认写入 `<项目根>/.dsh/skills/<name>/SKILL.md`。项目根取当前工作目录向上最近含 `.git` 的目录；若项目不是 Git 仓库，则取当前工作区目录。不得写到工作区外。
2. 只有当前会话没有可确定的本地工作区时，才回退写入 `$DSH_HOME/skills/<name>/SKILL.md`；必须在回复中明确说明这是全局 Skill。
3. 校验 `<name>` 为 1–63 位 kebab-case。
4. 先检查目标路径是否存在（文件、目录或符号链接均算存在）。若存在，绝不覆盖、合并、删除或修改；说明冲突，并让用户改名或明确改为“编辑现有 Skill”。
5. 用目标 `skills` 目录内的临时目录写完 `SKILL.md` 后再原子改名为目标目录；失败时清理临时目录。

Skill 正文需含 YAML frontmatter：`name`、`description`，可选 `whenToUse`。内容要写成可执行的逐步指令，明确输入、输出、安全边界和何时询问用户；禁止把当前对话的私密数据、API Key、绝对机器路径写进去。

成功后回复：已创建的名称、实际保存位置、它是项目级还是全局 Skill、以及如何通过 `/<name>` 调用。提示 DSH 会监听该目录；若当前 slash 菜单没有立刻更新，刷新页面或新开会话。
