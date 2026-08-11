# Review Lifecycle for Knowledge Distiller

This reference defines the optional read-only review dependency. Review raises confidence; it never authorizes an
unsafe write or repairs a failed hard gate. `SKILL.md` owns the parent workflow. This file owns review attempts,
event evidence, fallback, and delivery vocabulary.

The design rule is simple: one fact has one owner. `Run` owns workflow progress, `ReviewAttempt` owns one reviewer job,
`WriteTransaction` owns the side effect, `GateResult` owns mechanical evidence, and the event journal owns observations.
Delivery labels are derived; they are not another mutable state machine.

## 1. State architecture

### 1.1 Run

The run has one mutually exclusive main state:

```text
intake | compose | persist | review | report | done
blocked(reason) | failed(reason) | stopped(reason)
```

The only normal Run transitions are:

```text
intake  → compose | done | blocked
compose → persist | review | report | blocked
persist → review | report | failed | blocked
review  → compose | report | stopped | blocked
report  → done | failed
```

Terminal states do not transition silently. `compose → compose` is a new revision, not an in-place state mutation.

Run inputs are separate data, not extra lifecycle axes:

```text
route       → answer_only | clarify | distill_note
write_mode  → none | draft | persist
revision    → non-negative integer
draft_hash  → SHA-256 of the exact draft bytes
```

`route`, `write_mode`, and `revision` describe the run; they do not form a second state cross-product.

### 1.2 Review cycle and attempt

A `ReviewCycle` covers one exact note revision and owns two independent attempts:

```text
{run_id, cycle_id, revision, draft_hash, clarity: ReviewAttempt, accuracy: ReviewAttempt, fallback, events}
```

Each attempt is a discriminated lifecycle. The `result` exists only in the `completed` branch:

```text
pending
running
completed(result: clean | findings | unverified)
failed(reason)
stopped(reason)
```

Do not store independent lifecycle, quality, liveness, waiting, or cancellation fields. Those fields create illegal
combinations such as failed+clean. A retry gets a new `attempt_id`; a changed draft gets a new `cycle_id`.

Observation is metadata, not lifecycle:

```text
observability → observed | silent | lost
```

`stop_requested` and `stop_confirmed` are events. A parent stopping its wait does not prove that the provider stopped.
Manual fallback is also separate:

```text
fallback → not_needed | pending | manual_checked
```

`manual_checked` is never a provider `clean` result.

### 1.3 Write transaction and gate

The write side effect has one tagged state:

```text
not_applicable | idle | staging | committed(outcome: created | updated | unchanged) | uncertain
```

`uncertain` is terminal for this write attempt: stop further writes and do not claim delivery. `committed(unchanged)` is
confirmed preservation, not a successful update.

Every mechanical gate has one result:

```text
passed | failed | unavailable | not_applicable
```

Never represent a gate as `applicable` plus another result. Applicability is already encoded by `not_applicable`.

## 2. Identity and event journal

Create a distinct identity for every reviewer invocation:

```text
run_id                → locked target generation owning this invocation's artifacts
cycle_id              → one note revision and its integrated review cycle
axis                  → clarity | accuracy
attempt_id            → unique local reviewer invocation
note_revision         → revision read by the attempt
note_path             → resolved absolute path
draft_hash            → exact bytes read by the attempt
client_dispatch_id    → local submission identity
provider_operation_id → provider identity, when actually supplied
```

The journal is append-only JSONL. Every event carries the stable `run_id`, other identity fields, `event_id`, strictly increasing `order`,
`event_type`, `observability`, `evidence`, and `observed_at`.

Lifecycle event types are:

```text
dispatch | progress | poll | result | failure | stop_requested | stop_confirmed
manual_fallback | late_ignored | report_closed
```

Attempt transitions are:

```text
pending → pending | running | failed | stopped
running → running | completed | failed | stopped
completed → completed
failed    → failed
stopped   → stopped
```

`dispatch` starts an attempt. `result` requires `attempt_state: completed` and one provider result. `failure` requires
`attempt_state: failed` and a `failure_reason`. `stop_requested` leaves a pending/running attempt unchanged;
`stop_confirmed` moves it to `stopped`. A terminal attempt cannot receive another lifecycle event.

`report_closed` uses `axis: system`, `attempt_id: run`, and `close_order` equal to its own `order`; it has no
`attempt_state`. After it, only `late_ignored` events are allowed. A late result is evidence of lateness, not a result for
the delivery decision. It also carries the closed `review_budget`; the journal checker verifies the observed revision span,
attempt count per axis/revision, and fallback count against that budget.

If the journal cannot be durably appended before dispatch, do not dispatch an asynchronous reviewer: use the exact-draft
manual fallback. If a later append fails, stop new dispatches and report review uncertainty; do not invent provider
failure, cancellation, or a clean result.

## 3. Unlimited wait and observation semantics

There is no wall-clock deadline for a reviewer. Client timeout, empty poll, slow provider, lost UI update, or a parent
yielding control does not change `ReviewAttempt.state`. Keep a pending/running attempt open until one of these is
observed:

- a terminal provider result;
- an explicit provider failure/stall signal;
- a confirmed stop/cancellation;
- a dispatch or journal failure that prevents reliable continuation.

An opaque provider is not evidence of either health or failure. A provider-side stall may be recorded as `failed` only when
the provider exposes an operation/status signal and explicitly reports the stall or failure. A request to stop is not
confirmation that the provider stopped.

Do not retry a pending/running attempt. After an explicit transient failure, a retry uses a new `attempt_id`; after a
draft revision, all prior results are invalid and the new cycle starts with new attempts.

Closure is event-ordered, not time-ordered: first adjudicate results observed before `report_closed`, then append the close
event. A result observed later is `late_ignored` even if the provider started it earlier.

## 4. Reviewer result protocol

The reviewer reads the exact artifact identified by the envelope and never rewrites it. A provider result is valid only
when its `run_id`, cycle, attempt, axis, path, revision, and draft hash match the local envelope.

### Clarity

Required evidence:

```text
C1..C5, teach_back, after_state, source_coverage, claims_checked
```

`clean` requires every C item to be `—`, a usable teach-back/after-state, complete coverage, and no contradictory or
unverified evidence. C1–C5 cover undefined symbols, premature terms, dense unexplained terminology, unexplained design
rationale, and breaks in the reader path. C5 also checks required diagrams, link placement, heading structure, and hidden
antecedents across reader-visible surfaces.

### Accuracy

Required evidence:

```text
A1, claims_checked, source_coverage, unverified
```

`clean` requires `A1: —`, complete coverage, every material claim checked, and no unverified claim. Partial coverage is
`unverified`; missing metadata or an unreadable artifact is not clean.

Normalize contradictory payloads to a non-clean outcome. Preferences, duplicates, unsupported requests, and out-of-scope
comments do not start a revision round.

## 5. Convergence and fallback

Reserve a finite revision budget before dispatch. The default and hard ceiling for one invocation is two material
revision rounds after the initial draft; record the value instead of inferring it from event count. Track these counters
separately:

```text
max_revision_rounds → 2
max_attempts_per_axis_per_revision → 2
max_fallback_passes_per_axis → 1
review_attempts | fallback_passes | revision_rounds
```

Waiting does not consume a revision round. Any changed draft bytes consume one revision round; an identical draft is a
no-op and must not reopen review. Adjudicate valid
clarity and accuracy findings together in one edit pass. Structural changes, claim corrections, scope changes, links, or
diagrams rerun both axes; a provably local wording change may rerun only its affected axis.

Do not reset `revision_rounds` when starting a new `ReviewCycle`; a new cycle after a body change consumes the next round.
When `revision_rounds >= max_revision_rounds`, do not enter `compose` again. If actionable reader/accuracy blockers remain,
move the existing Run to `blocked(reason=revision_budget_exhausted)`; otherwise stop revising and use the truthful delivery
label. A terminal provider failure may create at most one new attempt for that axis and revision; after the attempt budget,
use the one exact-draft fallback when available. After the fallback budget is used, stop retrying and move the existing Run
to `blocked(reason=review_attempt_budget_exhausted)` if the result is still actionable. This budget never force-closes a
pending/running provider attempt: slow responses still follow §3's event protocol.

Close when both valid provider outcomes are clean, manual fallback leaves no actionable repair, no new actionable
information appears, an explicit stop is confirmed, or the revision budget is exhausted. A late result cannot reopen a
closed cycle.

For every unavailable or invalid axis, inspect the exact draft and record `outcome: manual_checked` plus fallback
evidence. Fallback covers the same clarity/accuracy contract and all hard gates. If fallback changes the body, increment
the revision, recompute the hash, invalidate prior results, and start a new cycle. Fallback can support a truthful delivery
claim; it cannot be relabeled as provider clean.

## 6. Delivery record and labels

The machine-readable record uses `knowledge-distiller.delivery.v3`:

```text
schema_version → knowledge-distiller.delivery.v3
run_id        → locked target generation owning the report
manifest      → {path, sha256} for the fixed run bundle # required for staging/committed/uncertain
review_budget → max_revision_rounds, max_attempts_per_axis_per_revision, max_fallback_passes_per_axis, counters
write_state  → not_applicable | idle | staging | committed | uncertain
write_outcome → created | updated | unchanged   # required for committed
review.*.outcome → provider_clean | provider_findings | provider_unverified | manual_checked | unavailable
review.journal → gate, closed, events, close_order, path, sha256
```

Required hard gates are `write_readback`, `preservation`, `heading`, `teaching_model`, `mechanical_link`,
`semantic_link`, `evidence`, and `render`. A written artifact needs an absolute `note_path`, matching `final_hash`, and
`write_readback: passed`. A new note may use `preservation: not_applicable` only with a hash-bound creation probe.

| Conditions | Report label |
| --- | --- |
| committed(created/updated) + hard gates pass + both provider outcomes clean + no blockers | `双轴审查通过` |
| committed(created/updated) + hard gates pass + both axes manual_checked + no blockers | `已交付；部分审查由人工复核` |
| committed(created/updated) + hard gates pass + only polish/unverified non-blockers | `已交付；存在未决项` |
| committed(created/updated) + reader/accuracy blocker | `已写入；存在阻塞项，未完成` |
| committed + hard-gate failure | `文件已写入；自检未通过，未宣称交付` |
| committed(unchanged) | `更新未写入；原文件已保留` |
| idle/not_applicable/staging | `内容已生成但未写入` or `未写入（仅草稿）` |
| uncertain | `文件状态不确定，未宣称交付` |
| write confirmed but review/journal uncertain | `已写入；审查状态不确定，未完成` |
| no confirmed write and review/journal uncertain | `未写入（审查不确定）` |

Only the first row may use `双轴审查通过`. No reviewer result overrides a failed gate, uncertain write, missing axis,
open blocker, stale identity, or uncertain journal closure.

## 7. Verbatim reviewer prompts

Substitute only the resolved absolute path, `attempt_id`, and `note_revision`. The local envelope carries `cycle_id` and
`draft_hash`; preserve all metadata exactly.

### Clarity reviewer

```text
axis: clarity
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <absolute-note-path>

Read references/obsidian-writing-style.md before reviewing. If the note has Mermaid, also read references/mermaid.md.
Treat formatting as part of the reader contract, not a reason to add decoration. Reconstruct the spine, top-level section
roles, transitions, boundaries, examples, decisions, and after-state from the note alone. Return teach_back first.

C1: undefined formula symbols
C2: material terms introduced before definition or anchoring
C3: sentences with three or more unexplained material terms
C4: mechanisms stated without their design rationale
C5: broken reader path, prerequisite order, heading tree, required diagram, link placement, or hidden antecedent/provenance

Quote the smallest passage or outline fragment for each finding. Use — when absent. Return result: clean only when every
item is absent, coverage is complete, and the teach-back reaches a usable model.
```

### Accuracy reviewer

```text
axis: accuracy
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <absolute-note-path>

Read references/obsidian-writing-style.md and references/mermaid.md when applicable. Check every material claim in prose,
tables, callouts, code, diagrams, examples, links, and metadata. For each issue, quote the claim, explain the correction
or missing qualification, and cite a source you can stand behind.

Return claims_checked, source_coverage: complete only when every material claim is covered, unverified: — when none, A1: —
when no issue exists, and result: clean only when all claims are accurate, scoped, and supported. Do not guess; use
result: findings or result: unverified when evidence is incomplete.
```
