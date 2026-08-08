# Review Lifecycle for Knowledge Distiller

This reference defines the review gate as a best-effort dependency. It protects the parent workflow from a slow
or failed reviewer without treating a missing result as approval. Read it before Phase 7 whenever the environment
can spawn reviewers or expose asynchronous provider requests.

**Core invariant:** the parent wait budget is a scheduling boundary, not a subagent execution deadline. Reaching
that boundary does not prove that the provider is stuck and does not authorize cancellation by itself.

## Contents

1. State separation and attempt identity (§1–2)
2. Execution states and liveness evidence (§3–3A)
3. Result protocol and convergence budget (§4–4A)
4. Parent waiting and retries (§5)
5. Fallback and delivery matrix (§6–7)
6. Reviewer prompts (§8)

## 1. Keep four concerns separate

Do not compress these into one `timeout` flag:

1. **Write state** — whether the note was safely written or updated.
2. **Self-check state** — whether the artifact passed local checks.
3. **Reviewer execution state** — whether a reviewer is running, unknown, failed, deferred, or
   `canceled-confirmed`.
4. **Reviewer quality result** — whether that reviewer returned clean findings, actionable findings, or an
   incomplete result.

The final delivery state is a tuple of these values, not a guess derived from elapsed time.

## 2. Identify every attempt

For each review cycle, record internally:

```text
cycle_id       → one note revision and its review cycle
axis           → clarity or accuracy
attempt_id     → unique ID for this reviewer invocation
note_revision  → revision number read by the attempt
note_path      → absolute path the reviewer was instructed to read
provider_operation_id → provider-side operation ID, when one exists
observability  → opaque | client-only | provider-observed | provider-terminal
parent_cutoff  → when the parent stops waiting for this cycle
review_attempts / fallback_passes / revision_rounds → separate counters
```

Resolve the note path before dispatch. Do not merge a late result into a newer revision or a new attempt. A late
result belongs to its original `attempt_id`; if the cycle has already closed, record it as late and ignore it for
the delivered artifact.

Record the evidence behind every state transition, not only the state label: the parent event, provider event or
heartbeat, status response, cancellation acknowledgement, and their timestamps or sequence IDs when available.
If there is no provider-side evidence, say `observability: opaque` rather than filling the gap with elapsed time.

Before dispatch, persist a durable review journal checkpoint with the cycle metadata, `state: pending`, and the
observability boundary. Append each dispatch, wait, result, defer, cancellation request, and fallback transition
before taking the next action. The final conversational report is not the only record: if the reviewer wait itself
blocks, the journal must still prove what was known and what was not known.

## 3. Execution states

Use these states exactly when the mechanism exposes enough information:

| State | Meaning | Allowed parent action |
| --- | --- | --- |
| `pending` | attempt has not started | start it |
| `active` | output, heartbeat, or tool progress is observable | wait |
| `unknown` | request is in flight but liveness is opaque | wait until parent cutoff, then defer |
| `completed` | final result returned | validate the result protocol |
| `failed` | explicit unrecoverable failure | fallback; retry only under §5 |
| `suspected-stall` | liveness evidence indicates recovery is unlikely | status check, then cancel if supported |
| `deferred` | parent stopped awaiting this attempt | fallback; do not call it a pass |
| `cancel-requested` | cancel was requested; termination is not confirmed | fallback; report uncertainty |
| `canceled-confirmed` | the mechanism confirmed termination | fallback; do not call it a pass |

State transitions:

```text
pending → active | failed
active → completed | failed | unknown
unknown → completed | failed | suspected-stall | deferred
suspected-stall → cancel-requested | deferred
cancel-requested → canceled-confirmed | unknown
active/unknown → deferred        (parent cutoff)
```

Wall-clock duration alone never authorizes `suspected-stall` or cancellation. With an opaque provider, use
`unknown` and later `deferred`; do not manufacture a liveness diagnosis.

## 3A. Evidence boundary for liveness

Separate observations by who can make them authoritative:

| Observation | What it proves | What it does not prove |
|---|---|---|
| Parent submitted a request | The client attempted dispatch | The provider accepted or is executing it |
| Client poll/connection is waiting or timed out | The parent cannot observe a result now | Provider failure, provider termination, or cancellation |
| Provider heartbeat, progress event, status response, or terminal event | Provider-side liveness or an explicit provider state | Quality of the review result |
| Provider status explicitly says failed/stalled | A provider-reported execution failure | That a cancellation request has terminated the work |
| Provider cancellation acknowledgement with the same operation ID | Provider-side termination is confirmed | That the review would have been low quality |

Treat a client-side timeout, socket error, empty poll, or lost UI update as an observation about the client
channel only. It may transition `active` to `unknown` or let the parent choose `deferred`; it cannot by itself
produce `failed`, `suspected-stall`, or `canceled-confirmed`.

Use `suspected-stall` only when all of these are true:

1. the provider exposes an operation ID and a meaningful status/heartbeat mechanism;
2. the mechanism previously provided provider-side liveness or an authoritative execution state;
3. one status check or ping, performed after the no-progress threshold, reports an explicit stalled/failed
   state or supplies a provider-side termination signal;
4. no newer heartbeat, progress event, or terminal result contradicts that signal.

If any condition is missing—especially when the provider is entirely opaque—do not cancel. Keep the attempt
`unknown`, then mark the parent wait `deferred` at its cutoff and run manual fallback. This is not claiming that
the provider is healthy; it is refusing to claim a fact the observability boundary cannot establish.

## 4. Result protocol

A reviewer is `clean` only if it returns the exact axis-specific result below for the exact `attempt_id` and
`note_revision`:

Clarity result:

```text
axis: clarity
attempt_id: …
note_revision: …
note_path: …
C1: …
C2: …
C3: …
C4: …
C5: …
teach_back:
  spine: …
  section_roles: …
  after_state: explain | predict | choose | not_reached, with a brief reason
result: clean | findings | protocol_invalid
```

Accuracy result:

```text
axis: accuracy
attempt_id: …
note_revision: …
note_path: …
A1: …
claims_checked: …
source_coverage: complete | partial
unverified: …
result: clean | findings | unverified | protocol_invalid
```

For a clarity result, `C1`–`C5` and `teach_back` are required; `claims_checked`, `source_coverage`, and `unverified`
are not applicable and may be omitted. The checklist items are undefined formula symbols; material terms used too early;
sentences with three or more unexplained material terms; mechanisms without design rationale; and the end-to-end reader
path (central question, section dependencies, scope, orphan material, and incomparable alternatives). For an accuracy
result, `A1`, `claims_checked`, `source_coverage`, and `unverified` are required; `C1`–`C5` and `teach_back` are not
applicable and may be omitted. `A1` inspects every factual claim and source support.

For the clarity axis, `teach_back` is required: it is a blind read of what the note actually lets a reader explain,
predict, or choose, not a restatement of the author's intention. Compare it with the Phase 0 after-state; a polished
spine that does not reach that after-state is an actionable clarity finding. For accuracy, `result: clean` additionally
requires `source_coverage: complete` and `claims_checked` to cover every material claim; partial coverage is
`unverified`, not clean. `No issues` is valid only when every required checklist item is present and has no finding.
Missing items,
wrong path, wrong revision, vague praise, incomplete claim/source coverage, or inability to read the note means
`protocol_invalid`, followed by the manual fallback. A reviewer that returns `protocol_invalid` is not clean.

## 4A. Convergence and revision budget

Review is a bounded diagnosis loop, not an open-ended search for imperfections. Reserve the budget before dispatch:
the default is the initial review plus at most two integrated revision rounds. Only an explicit user request may set a
larger finite cap; a high-severity finding does not silently extend it. Track `review_attempts`, `fallback_passes`, and
`revision_rounds` separately: reviewer waiting, an unavailable result, or a fallback with no body change does not
consume a revision round. If a material non-blocking issue remains at the cap, deliver with an honest open item; a
`reader_blocker` or `accuracy_blocker` stops delivery according to §7.

Normalize both axes' returns before editing. A finding is `actionable` only when it has an exact passage or a structural
locator (`before_heading`, `after_heading`, `missing_relation`), evidence or a concrete correction, and would materially
change truth, the reader's model, scope, or a safety boundary. Duplicate,
preference-only, out-of-scope, unsupported, or already-addressed findings are recorded and do not start a round.
Hard-gate failures in truth, links, writes, permissions, or security remain self-check failures; the finite review
budget never turns them into acceptable open items.

Classify a remaining actionable finding as `reader_blocker` when the spine, after-state, section relation, prerequisite
order, scope, or axis distinction is broken; classify it as `accuracy_blocker` when a material claim is false,
unverified, or materially mis-scoped. Local wording, optional examples, and preferences are `polish_item` and may be
reported without blocking delivery.

Adjudicate the two axes together and make one integrated edit pass per round. Do not run one round per finding, paste
reviewer prose, or ask a reviewer to rewrite the note. If no body change is made, do not increment `note_revision` or
start another review. A structural change, deletion, reordering, or material claim correction reruns both axes; a truly
local wording change reruns the affected axis, and uncertainty reruns both.

Close the cycle when both valid results are clean, when fallback leaves no actionable repair within the budget, when a
round produces no new actionable information, or when the budget is exhausted. A late result belongs to its original
attempt and cannot reopen a closed revision.

## 5. Parent waiting and retries

Set a parent cutoff that leaves time for fallback checks, final writing, and reporting. The cutoff protects the
parent; it is not a kill deadline for a reviewer that is still making progress.

Use bounded await segments that return before the parent cutoff; never make an opaque provider call with an
unbounded wait. At the cutoff, persist `state: deferred`, stop awaiting in the parent, run manual fallback, and
report the boundary. Do not send a cancellation request merely because the parent stopped awaiting; the provider
may continue and can still produce a late result under its original `attempt_id`.

- `active` with progress: keep waiting until cutoff or completion.
- `unknown` at cutoff: mark `deferred`; do not claim provider failure.
- No progress with a real liveness signal: perform one status check or ping. Only then may a confirmed stall be
  canceled when the mechanism supports cancellation.
- A status check that merely times out is still a client/channel observation, not the provider's cancellation
  confirmation. If the provider does not answer with an authoritative state, remain `unknown`/`deferred`.
- A client request deadline releases the client; it does not prove provider-side termination.
- Never retry while the original attempt is `unknown`, `active`, or `cancel-requested`.
- Retry at most once after an explicit transient failure, and only when the read-only review mechanism makes a
  duplicate safe. Give the retry a new `attempt_id`.

When the parent stops waiting, the current cycle can still receive a late result until the final report is closed.
Do not reopen a closed revision because a late result arrives.

## 6. Manual fallback

For every axis that is not `completed` with a valid result, record `manual_checked` and perform the same checklist
against the Phase 2 evidence and Phase 3 teaching model. Manual checking can repair the note and can establish that
delivery is reasonable;
it cannot become a reviewer `clean` result.

The fallback record must include the clarity teach-back (recovered spine, section roles, and reached after-state), the
accuracy coverage (claims checked, source coverage, and unverified claims), each C1–C5/A1 outcome that applies, and any
`reader_blocker`, `accuracy_blocker`, or `polish_item`. `manual_checked` without these observations is incomplete.

If a repair changes note prose, formulas, links, or diagrams, increment `note_revision` and invalidate reviewer
results according to §4A's local-versus-structural rule; start a new cycle only if the finite review budget allows it.
Metadata-only changes do not invalidate content review.

For any axis that is not a valid completed result, the Phase 8 report must include both `execution_state` and
`observability`: what the parent observed, what the provider exposed (if anything), whether cancellation was
requested, and whether termination was confirmed. This makes `deferred`, `unknown`, and `canceled-confirmed`
auditable rather than decorative labels.

## 7. Delivery matrix

Use these write states:

| `write_status` | Meaning |
| --- | --- |
| `written` | new file exists and read-back matches |
| `updated` | existing file was updated and read-back matches |
| `unchanged` | requested update failed, but the original file was restored or verified intact |
| `not_written` | creation failed before a usable file existed |
| `possibly_partial` | an update/create may have changed the file, but read-back or recovery is uncertain |

Use these final delivery labels:

| Conditions | Report label |
| --- | --- |
| `written/updated` + self-check pass + both valid reviewer results clean + no open items | `双轴审查通过` |
| `written/updated` + self-check pass + missing axes manually checked + no open items | `已交付；部分审查由人工复核` |
| `written/updated` + self-check pass + only `polish_item` or non-blocking unverified items | `已交付；存在未决项` |
| `written/updated` + self-check pass + any `reader_blocker` or `accuracy_blocker` | `已写入；存在阻塞项，未完成` |
| `written/updated` + self-check failed | `文件已写入；自检未通过，未宣称交付` |
| `unchanged` | `更新未写入；原文件已保留` |
| `not_written` | `内容已生成但未写入` |
| `possibly_partial` | `文件状态不确定，未宣称交付` |

Only the first row may be called `双轴审查通过`. A clean reviewer result cannot override a failed self-check,
an uncertain write, an open accuracy blocker, a reader blocker, or a missing review axis. A written file with a blocker
is not a delivered note.

## 8. Reviewer prompts

Use these prompts verbatim after substituting the resolved absolute `note_path`, `attempt_id`, and `note_revision`.

### Clarity reviewer

```text
axis: clarity
attempt_id: <attempt-id>
note_revision: <note-revision>
note_path: <vault-path>/<area>/<filename>.md

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
  nested under one substantive first section), or an after-state the note does not actually enable. Quote the smallest
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

You are an expert in this field. Check every factual claim, including claims in tables, callouts, diagrams, and
examples. For A1, quote the exact claim for each problem, state the correction or missing nuance, and cite a source you
can actually stand behind. Return `claims_checked: N` (or the checked claim IDs), `source_coverage: complete` only when
the review covered every material claim and its needed source support, and list any `unverified` claims. If a claim
cannot be verified with confidence, mark it “unverified” instead of guessing. Return `A1: —` and `result: clean` only
when every claim is accurate, properly scoped, and covered; otherwise return each finding under A1, followed by
`result: findings` or `result: unverified`. Preserve the metadata above exactly.
```
