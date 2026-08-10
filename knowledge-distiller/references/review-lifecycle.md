# Review Lifecycle for Knowledge Distiller

This reference defines the optional read-only review dependency. Review increases confidence; it never authorizes a
write, repairs a failed hard gate, or turns missing evidence into approval. The parent workflow's canonical state
model in `SKILL.md` is authoritative. This document supplies the event protocol, reviewer payloads, fallback, and
delivery vocabulary that Phase 7 needs.
The lifecycle semantics live here; `scripts/check-review-journal.ts` mechanically validates the event-stream invariants,
and `scripts/check-delivery-report.ts` validates the final label against write/gate/review evidence. A checker pass does
not replace this reference's reviewer and fallback requirements.

## 1. The contract in one view

Every review axis is tracked as a tuple, not as one timeout or one `reviewer_state` field:

```text
provider_execution_state → pending | active | completed | failed | unknown
provider_liveness        → unobserved | healthy | suspected_stall | terminal
parent_wait_state        → waiting | deferred | closed
cancel_state             → not_requested | cancel_requested | canceled_confirmed | unknown
quality_result           → clean | findings | unverified | protocol_invalid | unavailable
```

Keep these concerns separate:

1. `write_status`: whether the note transaction was safely written or updated;
2. self-check gates: whether the exact artifact passed heading, link, evidence, and preservation checks;
3. provider execution and liveness: what the provider did and what the parent can observe;
4. reviewer quality: whether a valid result was returned and what it found;
5. parent waiting and cancellation: what the parent stopped doing and whether provider termination was confirmed.

`deferred` means only that the parent stopped waiting. It never means provider failure, provider cancellation, or a
quality pass. `manual_checked` is a fallback result, not `quality_result: clean`.

### 1.1 State transition rules

```text
pending → active | failed | unknown
active → completed | failed | unknown
unknown → completed | failed | suspected_stall | deferred
suspected_stall → cancel_requested | deferred
cancel_requested → canceled_confirmed | unknown
active/unknown → deferred                 (parent cutoff; parent_wait_state changes)
parent_wait_state: waiting/deferred → closed (report closure records the final event; execution state is preserved)
```

Wall-clock duration, a client timeout, an empty poll, a socket error, or a lost UI update is evidence about the
client channel only. It may produce `unknown` and then `parent_wait_state: deferred`; it cannot produce `failed`,
`suspected_stall`, or `canceled_confirmed` by itself.

## 2. Identity and the durable event journal

Create a distinct identity for every review invocation:

```text
cycle_id       → one note revision and its integrated review cycle
axis           → clarity | accuracy
attempt_id     → unique local identity for this reviewer invocation
note_revision  → revision read by the attempt
note_path      → resolved absolute path
draft_hash     → immutable hash of the exact draft bytes
client_dispatch_id  → local submission identity before provider acknowledgement
provider_operation_id → provider identity when provider evidence supplies one
```

`attempt_id` remains stable for the invocation. `client_dispatch_id` and `provider_operation_id` are different fields;
one never replaces the other. A late result belongs to its original attempt and revision. It cannot be merged into a
newer revision or a new attempt.

Before dispatch, append a durable checkpoint with `state: pending`, the exact path/revision/hash, the axis, the parent
cutoff, and the observability boundary. `provider_operation_id` may be `pending` until the provider acknowledges the
request. If no provider request will be made because the capability is unavailable, record the availability decision
and manual fallback; do not invent a provider result or operation ID.

Use an append-only journal. Append every dispatch, provider observation, parent wait, result, defer, retry, fallback,
revision, cancellation request, cancellation acknowledgement, and close event. A record has this shape:

```text
{event_id, order, event_type, cycle_id, attempt_id, axis, note_path, note_revision, draft_hash,
 client_dispatch_id, provider_operation_id, provider_execution_state, provider_liveness,
 parent_wait_state, cancel_state, quality_result, state_before, state_after, observability,
 evidence, observed_at}
```

`order` is monotonic. Acquire a single-writer lock around read-order-increment-append-flush. If the environment cannot
durably append and flush the pre-dispatch event, do not dispatch an asynchronous reviewer; run the complete manual
fallback and report `journal_unavailable`. If a post-dispatch append fails, do not relabel the provider as failed or
canceled: set `provider_execution_state: unknown`, `quality_result: unavailable`, stop new dispatches, and report
`delivery: review-uncertain`.

Close the report under the same lock. First adjudicate every matching result observed before closure, then append a
`report_closed` event with the final `cutoff_order`. A result observed after that event is `late_ignored`. If the close
event cannot be durably flushed, report `report_close_uncertain` and do not claim a clean lifecycle.

Accept a result only when `cycle_id`, `attempt_id`, `axis`, `note_path`, `note_revision`, and `draft_hash` match the
local envelope. A mismatch, older revision, changed local hash, missing required metadata, or result after closure is
`protocol_invalid`/`stale`/`late_ignored` as applicable; it cannot change findings, revisions, convergence, or delivery.

## 3. What observations prove

| Observation | It proves | It does not prove |
| --- | --- | --- |
| Parent submitted a request | The client attempted dispatch | Provider acceptance or execution |
| Client poll/connection waits or times out | The parent cannot observe a result now | Provider failure, termination, or cancellation |
| Provider heartbeat/progress/status/terminal event | Provider-side liveness or an explicit provider state | Review quality |
| Provider explicitly reports failed/stalled | A provider-reported execution state | That a cancellation request terminated the work |
| Provider cancellation acknowledgement with matching operation ID | Provider-side termination is confirmed | That the review would have been low quality |

Set `provider_liveness: suspected_stall` only when all conditions hold:

1. the provider exposes an operation ID and meaningful status/heartbeat mechanism;
2. provider-side liveness was previously observable;
3. one status check or ping after the no-progress threshold reports an explicit stalled/failed state or termination
   signal; and
4. no newer heartbeat, progress event, or terminal result contradicts that signal.

Otherwise keep the attempt `unknown`, stop the parent at its cutoff with `parent_wait_state: deferred`, and use
fallback. An opaque provider is not evidence of either health or failure.

An explicit provider `failed` event sets `provider_execution_state: failed` and `provider_liveness: terminal`. An
explicit provider `stalled` event is different: after the §3 evidence checks, set
`provider_liveness: suspected_stall` while execution remains `active` or `unknown`, then request cancellation if the
mechanism supports it. Do not rewrite a stalled observation as provider failure merely because cancellation is
available.

### 3.1 Cancellation precedence

Cancellation is a separate request and acknowledgement sequence:

1. If a completed result event is ordered before the cancellation acknowledgement, accept and validate the completed
   result; mark the acknowledgement `superseded` and do not set `canceled_confirmed`.
2. If cancellation is confirmed first, a later completed payload for that attempt is a contradictory provider event;
   mark `quality_result: protocol_invalid`, not clean.
3. A client deadline or a request to cancel is never termination confirmation.
4. Never retry while an attempt is `active`, `unknown`, or `cancel_requested`. A retry after an explicit transient
   failure gets a new `attempt_id` and is allowed at most once.

Legacy labels may occur in provider payloads, but they are mapped into the tuple above rather than stored as a second
state machine:

| Legacy label | Canonical mapping |
| --- | --- |
| `pending`, `queued` | `provider_execution_state: pending` |
| `running`, `active` | `provider_execution_state: active` |
| `completed` | `provider_execution_state: completed` |
| `failed` | `provider_execution_state: failed`, `provider_liveness: terminal` |
| `stalled` | `provider_liveness: suspected_stall`; execution remains `active` or `unknown` |
| `unknown` | `provider_execution_state: unknown` |
| `deferred` | `parent_wait_state: deferred`; execution remains active or unknown |
| `suspected-stall` | `provider_liveness: suspected_stall` |
| `cancel-requested` | `cancel_state: cancel_requested` |
| `canceled-confirmed` | `cancel_state: canceled_confirmed` |

## 4. Reviewer result protocol

The reviewer reads the exact artifact identified by the envelope. It does not rewrite the note. A result is valid only
when it preserves the required metadata and uses the axis-specific fields below.

### Clarity result

```text
axis: clarity
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <absolute-note-path>
C1: <finding or —>
C2: <finding or —>
C3: <finding or —>
C4: <finding or —>
C5: <finding or —>
teach_back:
  spine: <one sentence>
  section_roles: <what each top-level section answers>
  after_state: explain | predict | choose | not_reached, with a brief reason
result: clean | findings | protocol_invalid
```

The clarity checklist is: undefined formula symbols; material terms used too early; sentences with three or more
unexplained material terms; mechanisms stated without design rationale; and breaks in the end-to-end reader path
(central question, section dependencies, scope, orphan material, incomparable alternatives, prerequisites, heading
tree, or after-state). It also explicitly attacks two bypasses: a required architecture/process diagram silently
replaced by prose, and an external link shown as a source list instead of being attached to a claim. `teach_back` is a
blind reconstruction of what the note enables, not praise or author intent.

### Accuracy result

```text
axis: accuracy
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <absolute-note-path>
A1: <finding or —>
claims_checked: <count or checked claim IDs>
source_coverage: complete | partial
unverified: <claims or —>
result: clean | findings | unverified | protocol_invalid
```

The accuracy reviewer checks every material claim, including tables, callouts, diagrams, formulas, examples, and
operational or quantitative language. `result: clean` requires `A1: —`, complete coverage, every material claim checked,
and no unverified claim. Partial coverage is `unverified`, not clean. Missing metadata, vague praise, wrong path,
wrong revision, or inability to read the artifact is `protocol_invalid`.

Normalize reviewer payloads before acting. A `clean` result with findings, partial coverage, or contradictory fields is
`protocol_invalid`. Preferences, duplicates, unsupported requests, and out-of-scope comments are recorded but do not
start a revision round.

## 4A. Parent waiting and bounded convergence

Set a parent cutoff that leaves time for fallback checks, final writing, and reporting. Use bounded await segments that
return before the cutoff; never make an opaque provider call with an unbounded wait.

- `active` with provider progress → keep waiting until completion or cutoff;
- `unknown` at cutoff → set `parent_wait_state: deferred`; do not claim provider failure;
- explicit provider-side stall evidence → perform one status check, then request cancellation only if supported;
- cancellation without provider acknowledgement → `cancel_state: unknown`, fallback, and report uncertainty;
- explicit transient provider failure → retry at most once with a new attempt when duplicate review is safe;
- any other unavailable axis → manual fallback; do not call it a reviewer pass.

Reserve the convergence budget before dispatch: the initial review plus at most two integrated body-revision rounds.
Track `review_attempts`, `fallback_passes`, and `revision_rounds` separately. Waiting, an unavailable result, or a
fallback with no body change does not consume a revision round. Only an explicit user request may enlarge the finite
cap.

Normalize both axes together. An actionable finding needs an exact passage or structural locator, evidence or a
concrete correction, and a material effect on truth, reader model, scope, or a safety boundary. Adjudicate clarity and
accuracy findings in one integrated edit pass; do not paste reviewer prose or ask a reviewer to rewrite the note. A
structural change, deletion, reordering, material claim correction, link, or diagram change reruns both axes. A truly
local wording change may rerun only the affected axis; uncertainty reruns both.

Classify a remaining actionable finding as `reader_blocker` when the spine, after-state, section relation,
prerequisite order, scope, or axis distinction is broken. Classify it as `accuracy_blocker` when a material claim is
false, unverified, or materially mis-scoped. Local wording and optional examples are `polish_item`.

After every content revision, read the whole note linearly, rerun required gates, increment `note_revision`, recompute
`draft_hash`, invalidate prior results, and start a new cycle only if the budget permits. Close when both valid results
are clean, fallback leaves no actionable repair, no new actionable information appears, or the finite budget is
exhausted. A late result cannot reopen a closed revision.

## 6. Manual fallback

For every axis that is not a valid completed result, record `manual_checked` and inspect the exact draft hash/revision.
Fallback must cover the same contract:

- clarity: spine, section roles, after-state, C1–C5, scope, transitions, and heading tree;
- accuracy: every material claim, source coverage, A1, unverified claims, and needed qualifications;
- hard gates: write read-back, preservation, heading, mechanical link, semantic link, evidence, and render state.

`manual_checked` can repair the note and establish that delivery is reasonable. It cannot become reviewer `clean`. If a
fallback repair changes prose, formulas, links, or diagrams, increment the revision/hash and invalidate results under
§4A. Metadata-only changes do not invalidate content review.

For every non-clean axis, the final report includes execution state, parent wait state, cancellation state,
observability, attempt/revision/hash identity, fallback evidence, and any stale/late-ignored events.

## 7. Delivery matrix

Write states:

| `write_status` | Meaning |
| --- | --- |
| `written` | New file exists and read-back matches |
| `updated` | Existing file was updated and read-back matches |
| `unchanged` | Failed update was restored or verified intact |
| `not_written` | No usable file was created |
| `possibly_partial` | Replacement or read-back is uncertain |

Use these final labels:

| Conditions | Report label |
| --- | --- |
| written/updated + hard gates pass + both valid reviewer results clean + no open items | `双轴审查通过` |
| written/updated + hard gates pass + unavailable axes manually checked + no open items | `已交付；部分审查由人工复核` |
| written/updated + hard gates pass + only polish/unverified non-blockers | `已交付；存在未决项` |
| written/updated + reader/accuracy blocker | `已写入；存在阻塞项，未完成` |
| written/updated + hard-gate failure | `文件已写入；自检未通过，未宣称交付` |
| confirmed unchanged | `更新未写入；原文件已保留` |
| not_written | `内容已生成但未写入` |
| possibly_partial | `文件状态不确定，未宣称交付` |
| confirmed write + journal/report closure or review state uncertain | `已写入；审查状态不确定，未完成` |
| no confirmed write + journal/report closure or review state uncertain | `未写入（审查不确定）` |

Only the first row may be called `双轴审查通过`. No reviewer result overrides a failed gate, uncertain write,
missing axis, open blocker, stale identity, or uncertain journal closure.

## 8. Verbatim reviewer prompts

Substitute only the resolved absolute path, `attempt_id`, and `note_revision`. The local envelope carries `cycle_id` and
`draft_hash`; do not replace the required prompt fields with an unresolved placeholder.

### Clarity reviewer

```text
axis: clarity
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <vault-path>/<area>/<filename>.md

Read `references/obsidian-writing-style.md` before reviewing the note. If it contains a Mermaid diagram, also read
`references/mermaid.md`. Treat format roles as part of the reader contract, not as a request to use every Markdown
feature. In addition to C1–C5 below, inspect whether the visual hierarchy of emphasis, callouts, tables, code blocks,
diagrams, links and footnotes lets a near-zero-prior reader find the spine, core conclusions, boundaries, examples,
and decisions. For every retained or removed format block that materially affects the path, report the exact passage
and the lost or gained reader function. Apply the reference's callout removal test; do not reward decorative blocks or
penalize an intentionally plain passage whose reader role remains easy to recover.

You are a human reader learning this topic. Treat your own prior knowledge as near-zero and judge whether the note
alone lets you reconstruct and use one coherent model. First state the `teach_back`: the spine you recovered in one
sentence, what question each top-level section answers, and what the reader can now explain, predict, or choose. Then
report only concrete findings and quote the exact passage for each:
- C1: every symbol in a formula/equation that is never defined;
- C2: every material technical term used before it is defined, anchored to a defining vault position, or used as a common English fixture;
- C3: any sentence containing 3 or more unexplained material technical terms;
- C4: any mechanism or behavior stated without explaining why it is designed that way;
- C5: every end-to-end break: a missing central question or transition, a section that is not needed for the next
  section, an orphan fact or branch, a comparison of different axes as alternatives, a prerequisite introduced after
  its dependent idea, a heading tree whose levels contradict the teaching model (including unrelated major chapters
  nested under one substantive first section), a required diagram replaced by prose, a standalone external link, or
  an after-state the note does not actually enable. Quote the smallest
  passage or outline fragment that proves a local break; for a missing edge between sections, give `before_heading`,
  `after_heading`, and the missing relation.
Return the `teach_back`, all five labels using “—” for an item with no finding, followed by `result: clean` or
`result: findings`. Preserve the metadata above exactly. Do not give vague praise. Say `result: clean` only when every
item has no finding and the teach-back reaches the reader's usable model.
```

### Accuracy reviewer

```text
axis: accuracy
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <vault-path>/<area>/<filename>.md

Read `references/obsidian-writing-style.md` before reviewing the note. If the note contains a Mermaid diagram, also
read `references/mermaid.md`. Treat every callout, emphasized phrase,
code block, table, diagram, link, footnote, embed, and example as part of the factual artifact. Check that each format
feature uses valid portable syntax for the declared vault/runtime; mark custom CSS/plugin-dependent syntax as
unverified unless the capability is evidenced. Do not require a feature merely for variety, but do check that a
material boundary, qualification, or example was not hidden or deleted by flattening it into ordinary prose.

You are an expert in this field. Check every factual claim, including claims in tables, callouts, diagrams, and
examples. For A1, quote the exact claim for each problem, state the correction or missing nuance, and cite a source you
can actually stand behind. Return `claims_checked: N` (or the checked claim IDs), `source_coverage: complete` only when
the review covered every material claim and its needed source support, and list any `unverified` claims. If a claim
cannot be verified with confidence, mark it “unverified” instead of guessing. Return `A1: —` and `result: clean` only
when every claim is accurate, properly scoped, covered, and every external link is plausibly attached to the claim it
purports to support; otherwise return each finding under A1, followed by
`result: findings` or `result: unverified`. Preserve the metadata above exactly.
```
