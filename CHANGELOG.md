# Changelog

## [0.5.1] - 2026-08-11

### 重构
- refactor(ui): 删除knowledge-distiller评估数据及Darwin结果卡页面


## [0.5.0] - 2026-08-11

### 重构
- refactor(lifecycle): 优化分布式系统故障审查状态区分和交付报告

### 其他
- simplify knowledge-distiller audit surface
- fix knowledge-distiller correction trace leakage


## [0.4.4] - 2026-08-10

### 修复
- fix: bind teaching model and editorial gates

### 其他
- merge: knowledge-distiller editorial gates


## [0.4.3] - 2026-08-10

### 重构
- refactor(scripts): 统一引入 runMain 并优化退出处理

### 其他
- chore knowledge-distiller: record full test score
- chore knowledge-distiller: record absolute score
- chore knowledge-distiller: record final Mermaid check
- fix knowledge-distiller: ignore quoted Mermaid syntax
- chore knowledge-distiller: record Mermaid validation
- fix knowledge-distiller: ignore quoted Mermaid labels
- fix knowledge-distiller: tighten Mermaid safety checks
- refactor knowledge-distiller: expand Mermaid support
- chore: record Mermaid Darwin validation
- harden Mermaid compatibility checks
- fix Mermaid type declarations and surface checks
- refactor knowledge-distiller: broaden Mermaid guidance


## [0.4.2] - 2026-08-10

### 其他
- chore(knowledge-distiller): record review protocol optimization
- optimize knowledge-distiller: centralize review lifecycle


## [0.4.1] - 2026-08-10

### 修复
- fix(lint): 调整 lint-staged 配置文件的文件匹配规则

### 重构
- refactor(format-plan): 重构格式检查计划模块及Markdown解析模块


## [0.4.0] - 2026-08-10

### 其他
- knowledge-distiller: narrow optional review axes
- config: allow TypeScript extension imports
- knowledge-distiller: fix TypeScript diagnostics
- knowledge-distiller: finalize paired judge record
- knowledge-distiller: correct paired evaluation count
- knowledge-distiller: record final mechanical-gate evaluation
- knowledge-distiller: close review and delivery false passes
- knowledge-distiller: bind final delivery to review evidence
- knowledge-distiller: close mechanical false-pass paths
- knowledge-distiller: cover nested callout syntax
- knowledge-distiller: clarify update-only preservation gate
- knowledge-distiller: strengthen surface gate regression
- knowledge-distiller: refactor mechanical gate system
- knowledge-distiller: record final HEAD full test
- knowledge-distiller: record writing format validation
- knowledge-distiller: add formatting regression eval
- knowledge-distiller: preserve legacy format roles
- knowledge-distiller: align diagram review states
- knowledge-distiller: close format review coverage
- knowledge-distiller: bind writing style to review contract
- knowledge-distiller: centralize Obsidian writing rules


## [0.3.0] - 2026-08-10

### 新增
- feat(darwin-skill): 添加达尔文技能核心循环图和横幅资源

### 修复
- fix(knowledge-distiller): align wikilink path normalization
- fix(knowledge-distiller): restore lifecycle reference anchor
- fix(knowledge-distiller): disambiguate review terminal states
- fix(knowledge-distiller): align state gates with fallbacks
- fix(release): 检查并拒绝不一致的 SKILL.md 版本

### 其他
- knowledge-distiller: record absolute evaluation
- chore(knowledge-distiller): record wikilink full test
- optimize knowledge-distiller: align wikilink reference contract
- chore(knowledge-distiller): record lifecycle full test
- optimize knowledge-distiller: align review lifecycle contract
- chore(knowledge-distiller): record checker contract evaluation
- optimize knowledge-distiller: enforce canonical wikilink manifest
- chore(knowledge-distiller): record real fixture full-test
- chore(knowledge-distiller): record full-test triage score
- chore(knowledge-distiller): record full refactor evaluation
- optimize knowledge-distiller: refactor full execution contract
- optimize knowledge-distiller: unify execution state and writes
- chore(knowledge-distiller): add darwin result card
- chore(knowledge-distiller): log blacklist optimization
- optimize knowledge-distiller: add action blacklist
- chore(knowledge-distiller): log checkpoint optimization
- optimize knowledge-distiller: mark workflow checkpoints
- chore(knowledge-distiller): record darwin baseline prompts


## [0.2.0] - 2026-08-08

### 新增
- feat(knowledge-distiller): 使用ES模块导入并添加标题结构检查脚本
- feat(knowledge-distiller): 增强检索增强生成相关知识库笔记与审查规范

### 文档
- docs(review): 添加审查提示和完善审查规范文档

### 其他
- chore(knowledge-distiller): 优化知识蒸馏评测与图示文档规范

