# Agent Skills

个人沉淀的 Agent Skills 集合，符合 [agentskills.io](https://agentskills.io) 开放标准，Claude Code / Codex CLI / OpenCode / Cursor 等支持 `SKILL.md` 的 agent 通用。

## 安装

```bash
# 安装单个技能
npx skills@latest add <owner>/<repo> --skill=knowledge-distiller

# 或全量安装后挑选
npx skills@latest add <owner>/<repo>
```

手动安装：把 `knowledge-distiller/` 目录放进 agent 的技能目录（Claude Code：`~/.claude/skills/`；OpenCode：`~/.config/agents/skills/`），重启会话即被发现。

## 技能列表

- **knowledge-distiller** — 把用户对某个技术主题的原始理解，蒸馏成有深度、可长期沉淀的中文 Obsidian 笔记（联网核实 + 静默纠错 + 定位锚点 wikilink + 双轴审查）。

## 维护

新增技能 = 新建 `<skill-name>/SKILL.md`（frontmatter：`name` 小写连字符 + `description` 写给模型判断触发用），并在本 README 加一行。支持性细节放技能的 `references/`、`scripts/` 子目录。