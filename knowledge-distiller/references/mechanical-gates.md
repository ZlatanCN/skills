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

## 2. 内容门：一个入口，六个专责检查器

实际笔记写入前后运行：

先根据原始用户请求设置 `MERMAID_REQUEST_FLAG=--mermaid-requested` 或 `MERMAID_REQUEST_FLAG=--mermaid-not-requested`，再运行：

```bash
node scripts/check-note.ts \
  --file "$NOTE_PATH" \
  --vault-root "$VAULT_ROOT" \
  --format-plan "$FORMAT_PLAN_JSON" \
  --teaching-model "$TEACHING_MODEL_JSON" \
  "$MERMAID_REQUEST_FLAG" \
  --strict --portable --json
```

| Checker | 机械负责 | 明确不负责 |
| --- | --- | --- |
| `check-note-surface.ts` | frontmatter/code fence 是否闭合；代码语言标记；表格形状；callout 类型与前缀；危险 HTML/URL；Mermaid 支持的类型声明、禁止语法与 `flowchart` 保留字风险；强调分隔符 | 解释是否正确、callout 是否值得保留、图是否回答读者问题 |
| `check-heading-tree.ts` | H1 根、层级跳跃、隐含文件名标题约定、重复标题提示 | 章节是否构成好的教学模型 |
| `check-teaching-model.ts` | `knowledge-distiller.teaching-model.v1` 的精确 hash、每个可见标题的覆盖、逐节 `why_next`、图示决策与显式 Mermaid 请求 | 过渡是否真的帮助读者、答案是否正确、图是否值得存在 |
| `check-wikilinks.ts` | canonical manifest、containment、排除目录、唯一文件、唯一 heading/block anchor、frontmatter/fence/code 排除 | 目标是否真的定义当前概念、链接是否改善主线 |
| `check-format-plan.ts` | `format_plan` 的 hash、字段、决策枚举和逐行覆盖所有实际格式表面；外链的 claim/support/placement；独立外链行；Mermaid 渲染状态 | 外链是否真的支持主张、选择的视觉形式是否最适合读者 |
| `check-preservation.ts` | 原稿/草稿 SHA-256、实际变更 hunk、`changed_units` 覆盖和操作枚举 | 删除或重写是否符合教学模型、是否应该保留某段语义 |

`check-note.ts` 只汇总这些 checker，不重新实现它们的规则。缺少 `vault-root`、`format-plan` 或 `teaching-model` 时，聚合门不通过；不要用“没有链接/没有格式”的默认值掩盖证据缺口。新笔记聚合门有五个硬检查器，更新已有笔记时再加 preservation，共六个。
聚合器会在每个子 checker 前后及整轮结束比较目标文件 hash；发现笔记在检查期间被替换或修改时，结果为 `failed`，不得把不同版本的子证据拼成一次通过。
更新已有笔记时在同一命令追加 `--original ORIGINAL.md --preservation RECORD.json`；新笔记不应伪造 preservation record。
checker evidence envelope 的总 gate 只有 `passed|failed|unavailable`；delivery report 的 `hard_gates` 另允许 `not_applicable`，表示该门对当前 artifact 不适用。
`write_mode: draft` 不得创建计划文件时，可将同一 JSON 通过 stdin 传给 `--format-plan -`；这不会把临时产物写入磁盘。

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
  "link_surface": {"wikilinks": [], "external_links": [
    {"line": 24, "raw": "https://example.com/spec", "claim_id": "C-07", "support": "规范定义该字段的边界", "placement": "inline", "decision": "keep", "reader_function": "核验边界"}
  ], "footnotes": []},
  "render_status": "verified | unavailable | not_applicable",
  "render_risks": []
}
```

每个实际出现在 draft 中的格式表面必须有匹配的 `line` 记录，而且只能由 `decision: keep` 覆盖；若当前表面仍存在却标成 `plain/remove`，脚本会失败，避免把未执行的编辑伪装成已完成。尚未出现在 draft 中、但被考虑过的 plain/remove 候选可以保留在计划中，但必须写 `removal_test`。这能同时阻止漏记和“存在记录即完成”的假通过。

`external_links` 还必须逐项提供实际 URL `raw`、对应的 `claim_id`、说明支持关系的 `support` 和 `placement`。`placement` 只能是 `inline`、`footnote` 或 `callout`；只贴 URL、只贴链接列表或使用 `standalone` 都会失败。这个门只验证链接被绑定到主张和正文位置，不验证来源本身是否足以证明主张。

### 2.2 `teaching_model` 的机器部分

写作者在动笔前建立 section blueprint；首稿字节出现后立即把它绑定为 `knowledge-distiller.teaching-model.v1`。至少包含 `central_question`、`spine`、`after_state`、`linear_teach_back`、逐个可见标题的 `sections`，以及必填的 `diagram_policy`。每个 section 记录 `question`、`answer`、`dependency`、`boundary`、`role`、`relation`、`why_next`、`next_heading` 和下一标题行；最后一节必须显式把 `next_heading` 与 `next_line` 设为 `null`。若用户明确要求 Mermaid，`diagram_policy` 必须是 `decision: required` 与 `format: mermaid`，且正文必须真的有 Mermaid 块。Mermaid 请求事实不能只由模型自报，调用方必须显式传入 `--mermaid-requested` 或 `--mermaid-not-requested`。运行：

```bash
node scripts/check-teaching-model.ts --model "$TEACHING_MODEL_JSON" --note "$NOTE_PATH" "$MERMAID_REQUEST_FLAG" --json
```

它防止“写完后补一个漂亮摘要”或“checker 通过但模型断裂”，但不替代线性 teach-back、事实审查和清晰度审查。

## 3. 审查门：事件流而不是字符串状态

审查 journal 由 `references/review-lifecycle.md` 定义生命周期语义，由 `check-review-journal.ts` 机械验证：

```bash
node scripts/check-review-journal.ts --journal "$JOURNAL" --allow-open --json
# before report_closed, omit --allow-open
```

脚本验证 JSONL 可解析、`event_id` 唯一、`order` 单调、cycle/attempt/path/revision/hash/axis 身份不漂移、dispatch/provider identity、observability、evidence 字段存在、`ReviewAttempt` 状态转移合法、枚举值合法、`result: clean` 只能出现在 `attempt_state: completed` 的结果事件且具备 complete coverage/claims/after-state、`report_closed` 唯一且必须位于至少一个真实生命周期事件之后；空 journal 失败，关闭后的结果只能标记为 `late_ignored`。它不判断 reviewer 的事实判断是否正确，也不把 client timeout、空轮询或父任务暂时等待推断成 provider failure。

## 4. 交付门：阻止成功标签越权

将最终机器记录交给：

```bash
node scripts/check-delivery-report.ts --report "$DELIVERY_JSON" --json
```

`knowledge-distiller.delivery.v2` 至少包含 `run_id`、持久化或不确定写入的 `manifest: {path, sha256}`、`write_state: not_applicable|idle|staging|committed|uncertain`、`committed` 时的 `write_outcome: created|updated|unchanged`、`artifact_kind: new_note|updated_note`、写入产物的绝对 `note_path` 与 `final_hash`、完整的 `hard_gates`（`write_readback`、`preservation`、`heading`、`teaching_model`、`mechanical_link`、`semantic_link`、`evidence`、`render`；提交写入必须 `write_readback: passed`，且只有 `new_note` 的 preservation 可为 `not_applicable`）、clarity/accuracy 的 `outcome: provider_clean|provider_findings|provider_unverified|manual_checked|unavailable`、journal 状态、open blockers 和最终 `label`。checker 会读取 manifest，验证 `run_id`、`target_key/generation`、canonical target、artifact kind、original/draft hash，以及固定的 `manifest.json`、`draft.md`、`teaching-model.json`、`format-plan.json`、`review.jsonl`、`delivery.json` 路径；写入或审查证据的 `run_id` 不一致时必须失败。新笔记还必须提供带 SHA-256 的 `creation_probe`，其证据文件要明确证明同一目标在写入前不存在；更新则不能用 `new_note` 规避 preservation。

- `双轴审查通过` 必须同时拥有 confirmed write、所有 hard gates 通过、两个合法 clean 结果、已关闭 journal 且无 blocker；
- hard gate 失败/不可用、审查不确定、写入可能部分完成或存在 reader/accuracy blocker 时，不得使用成功标签；
- `write_state: uncertain`、`idle`、`staging` 等写状态必须落到对应的非成功标签。
- 当 journal 为 `passed` 时，报告必须携带 journal 文件路径和 SHA-256；脚本会重新运行 journal checker、比对事件数量/关闭游标，并要求两个 clean 轴的 attempt、draft hash、note path 以及 `source_coverage`、claims、after-state、C1–C5/A1 结果都能在同一份真实事件流中逐字段对齐。

人工 fallback 不伪装成 provider 结果；轴级直接记录 `outcome: manual_checked`，并由 checker 根据两轴 outcome 推导 fallback 完成。不可用 provider 记录 `outcome: unavailable`，不能同时宣称 clean。

## 5. 不要机械化的部分

代码无法可靠决定：一个段落是否真正建立因果模型、一个 `why_next` 是否对读者有说服力、一个 callout 是否有 removal-test 价值、外链来源是否足以支持主张、类比是否误导、事实是否在版本边界内成立、更新是否保留了用户要求保留的语义。上述内容必须保留给 claim ledger、teaching model、语义链接复核和 clarity/accuracy 双轴审查。
