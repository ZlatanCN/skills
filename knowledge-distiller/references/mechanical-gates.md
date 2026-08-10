# Mechanical gates and evidence contract

本文件是 `knowledge-distiller` 的脚本职责与机器证据来源。它只规定代码能够确定的事实、输入输出和失败含义；读者模型、教学取舍、事实正确性、语义链接和格式是否有教学价值，仍由 `SKILL.md`、claim ledger 与双轴审查负责。

## 1. 统一证据外壳

所有内容 checker 的 `--json` 输出都使用：

```json
{
  "schema_version": "knowledge-distiller.evidence.v1",
  "checker": "check-note",
  "checker_version": "0.1.0",
  "generated_at": "ISO-8601",
  "gate": "passed | failed | unavailable",
  "input": {},
  "metrics": {},
  "findings": [
    {
      "code": "stable-code",
      "severity": "error | warning | info",
      "message": "可复核的事实",
      "path": "可选绝对路径",
      "line": 1,
      "evidence": {}
    }
  ],
  "checks": {}
}
```

`passed` 只表示这个 checker 的硬事实通过；`failed` 表示输入确定但发现问题；`unavailable` 表示输入、扫描或运行环境不足以给出确定结论。单个 checker 的自测不能代替目标文件的实际检查，多个 checker 的通过也不能代替语义审查。

命令退出码统一为：`0 = passed`、`1 = failed`、`2 = unavailable/调用错误`。保留 JSON 原文、目标文件 SHA-256、命令、版本、退出码和时间戳。

## 2. 内容门：一个入口，四个专责检查器

实际笔记写入前后运行：

```bash
node scripts/check-note.ts \
  --file "$NOTE_PATH" \
  --vault-root "$VAULT_ROOT" \
  --format-plan "$FORMAT_PLAN_JSON" \
  --strict --portable --json
```

| Checker | 机械负责 | 明确不负责 |
| --- | --- | --- |
| `check-note-surface.ts` | frontmatter/code fence 是否闭合；代码语言标记；表格形状；callout 类型与前缀；危险 HTML/URL；Mermaid 禁止语法与基本类型；强调分隔符 | 解释是否正确、callout 是否值得保留、图是否回答读者问题 |
| `check-heading-tree.ts` | H1 根、层级跳跃、隐含文件名标题约定、重复标题提示 | 章节是否构成好的教学模型 |
| `check-wikilinks.ts` | canonical manifest、containment、排除目录、唯一文件、唯一 heading/block anchor、frontmatter/fence/code 排除 | 目标是否真的定义当前概念、链接是否改善主线 |
| `check-format-plan.ts` | `format_plan` 的 hash、字段、决策枚举和逐行覆盖所有实际格式表面；Mermaid 渲染状态 | 选择的视觉形式是否最适合读者 |
| `check-preservation.ts` | 原稿/草稿 SHA-256、实际变更 hunk、`changed_units` 覆盖和操作枚举 | 删除或重写是否符合教学模型、是否应该保留某段语义 |

`check-note.ts` 只汇总这些 checker，不重新实现它们的规则。缺少 `vault-root` 或 `format-plan` 时，聚合门不通过；不要用“没有链接/没有格式”的默认值掩盖证据缺口。
更新已有笔记时在同一命令追加 `--original ORIGINAL.md --preservation RECORD.json`；新笔记不应伪造 preservation record。
`draft_only` 不得创建计划文件时，可将同一 JSON 通过 stdin 传给 `--format-plan -`；这不会把临时产物写入磁盘。

### 2.1 `format_plan` 的机器部分

写作者在 draft 阶段建立 `knowledge-distiller.format-plan.v1` JSON。完整字段语义仍见 `obsidian-writing-style.md` §5；脚本只验证以下可计算部分：

```json
{
  "schema_version": "knowledge-distiller.format-plan.v1",
  "note_path": "/absolute/path/to/note.md",
  "draft_hash": "sha256",
  "coverage_note": "即使某类表面为空，也说明已检查",
  "emphasis_targets": [{"line": 10, "raw": "**结论**", "decision": "keep", "reader_function": "扫描结论"}],
  "callout_candidates": [{"line": 14, "decision": "keep", "reader_function": "隔离版本边界"}],
  "code_table_diagram_map": [{"line": 20, "kind": "code | table | diagram", "decision": "keep", "reader_function": "展示可执行语法"}],
  "link_surface": {"wikilinks": [], "external_links": [], "footnotes": []},
  "render_status": "verified | unavailable | not_applicable",
  "render_risks": []
}
```

每个实际保留的格式表面必须有 `line`、`decision: keep`、`reader_function`；改为正文或删除的候选必须写 `removal_test`。这能阻止漏记，不会把“存在记录”伪装成“语义选择正确”。

## 3. 审查门：事件流而不是字符串状态

审查 journal 由 `references/review-lifecycle.md` 定义生命周期语义，由 `check-review-journal.ts` 机械验证：

```bash
node scripts/check-review-journal.ts --journal "$JOURNAL" --json
```

脚本验证 JSONL 可解析、`event_id` 唯一、`order` 单调、cycle/attempt/path/revision/hash/axis 身份不漂移、状态转移合法、枚举值合法、`clean` 不得与 findings/partial/unverified 矛盾、`report_closed` 唯一且 cutoff 有效；关闭后的结果只能标记为 `late_ignored`。它不判断 reviewer 的事实判断是否正确，也不把 parent timeout 推断成 provider failure。

## 4. 交付门：阻止成功标签越权

将最终机器记录交给：

```bash
node scripts/check-delivery-report.ts --report "$DELIVERY_JSON" --json
```

`knowledge-distiller.delivery.v1` 至少包含 `write_status`、`hard_gates`、clarity/accuracy 的 `quality_result`、journal 状态、open blockers 和最终 `label`。脚本验证：

- `双轴审查通过` 必须同时拥有 confirmed write、所有 hard gates 通过、两个合法 clean 结果、已关闭 journal 且无 blocker；
- hard gate 失败/不可用、审查不确定、写入可能部分完成或存在 reader/accuracy blocker 时，不得使用成功标签；
- `possibly_partial`、`not_written` 等写状态必须落到对应的非成功标签。

## 5. 不要机械化的部分

代码无法可靠决定：一个段落是否建立因果模型、一个 callout 是否有 removal-test 价值、外链是否真正支持主张、章节是否服务下一个章节、类比是否误导、事实是否在版本边界内成立、更新是否保留了用户要求保留的语义。上述内容必须保留给 claim ledger、teaching model、语义链接复核和 clarity/accuracy 双轴审查。
