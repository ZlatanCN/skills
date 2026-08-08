# Agent Skills

[![skills.sh](https://skills.sh/b/ZlatanCN/skills)](https://skills.sh/ZlatanCN/skills)

个人沉淀的 Agent Skills 集合，符合 [agentskills.io](https://agentskills.io) 开放标准，Claude Code / Codex CLI / OpenCode / Cursor 等支持 `SKILL.md` 的 agent 通用。

## 安装

```bash
# 安装单个技能
npx skills@latest add ZlatanCN/skills --skill=knowledge-distiller

# 或全量安装后挑选
npx skills@latest add ZlatanCN/skills
```

手动安装：把 `knowledge-distiller/` 目录放进 agent 的技能目录（Claude Code：`~/.claude/skills/`；OpenCode：`~/.config/agents/skills/`），重启会话即被发现。

## 技能列表

- **knowledge-distiller** — 把用户对某个技术主题的原始理解，蒸馏成有深度、可长期沉淀的中文 Obsidian 笔记（联网核实 + 静默纠错 + 定位锚点 wikilink + 双轴审查）。

## 版本与发布

版本号由 git tag 承载（SemVer 语义）：`v0.1.0` → `v0.2.0` → `v1.0.0`。发布一个新版本：

```bash
git tag -a v1.0.0 -m "release v1.0.0"
git push origin v1.0.0
```

- **patch**：修 bug / 文档小改；**minor**：新增能力、行为向后兼容；**major**：破坏性变更（改了技能的工作流约定、frontmatter 结构）。
- GitHub Releases 页与 `gh skill` 都以 tag 为版本依据；固定安装：

```bash
# skills CLI：仓库后加 #tag
npx skills@latest add ZlatanCN/skills#v0.1.0 --skill=knowledge-distiller

# gh skill（GitHub CLI v2.90+）
gh skill install ZlatanCN/skills knowledge-distiller@v0.1.0
```

`gh skill publish`（在仓库根目录运行）会校验技能符合 agentskills.io 规范，并可开启不可变 Releases，增强供应链安全。

## 维护

新增技能 = 新建 `<skill-name>/SKILL.md`（frontmatter：`name` 小写连字符 + `description` 写给模型判断触发用），并在本 README 加一行。支持性细节放技能的 `references/`、`scripts/` 子目录。