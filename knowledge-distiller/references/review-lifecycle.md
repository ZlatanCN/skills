# Review Lifecycle for Knowledge Distiller

This reference defines the review gate as a best-effort dependency. It protects the parent workflow from a slow
or failed reviewer without treating a missing result as approval. Read it before Phase 7 whenever the environment
can spawn reviewers or expose asynchronous provider requests.

**Core invariant:** the parent wait budget is a scheduling boundary, not a subagent execution deadline. Reaching
that boundary does not prove that the provider is stuck and does not authorize cancellation by itself.

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

A reviewer is `clean` only if it returns a complete result for the exact `attempt_id` and `note_revision`:

```text
axis: clarity | accuracy
attempt_id: …
note_path: …
checklist:
  clarity: C1 … C5, each finding or —
  accuracy: A1, finding or —
result: clean | findings | unverified | protocol_invalid
```

For clarity, the checklist items are C1–C5: undefined formula symbols; material terms used too early; sentences
with three or more unexplained material terms; mechanisms without design rationale; and the likeliest reader
blockage. For accuracy, the checklist is A1: inspect every factual claim and source support, marking uncertain
claims `unverified`.

`No issues` is valid only when every required checklist item is present and has no finding. Missing items,
wrong path, wrong revision, vague praise, or inability to read the note means `protocol_invalid`, followed by the
manual fallback. A reviewer that returns `protocol_invalid` is not clean.

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
against the Phase 2 evidence. Manual checking can repair the note and can establish that delivery is reasonable;
it cannot become a reviewer `clean` result.

If a repair changes note prose, formulas, links, or diagrams, increment `note_revision`, invalidate reviewer
results for the changed axis, and start a new cycle only if the finite review budget allows it. Metadata-only
changes do not invalidate content review.

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
| `written/updated` + self-check pass + unresolved or unverified items | `已交付；存在未决项` |
| `written/updated` + self-check failed | `文件已写入；自检未通过，未宣称交付` |
| `unchanged` | `更新未写入；原文件已保留` |
| `not_written` | `内容已生成但未写入` |
| `possibly_partial` | `文件状态不确定，未宣称交付` |

Only the first row may be called `双轴审查通过`. A clean reviewer result cannot override a failed self-check,
an uncertain write, an open accuracy item, or a missing review axis.
