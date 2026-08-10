# Reader Model Protocol

Read this reference before Phase 0, Phase 3, and Phase 5, then revisit it before Phase 7. It defines the artifact's real
target: a reader who can reconstruct and use the model without relying on the research trail.

## 1. Define the destination before researching

A note is a change in the reader's mental model, not a warehouse for verified facts. Truth is an admission ticket;
it is not a reason for a fact to enter the body.

Write these decisions internally:

```text
reader        → who this note is for and what they already know
question      → the one question the note must answer
after         → what the reader can explain, predict, or choose afterward
scope         → keep / defer / split; name the tempting but excluded branches
spine         → one sentence connecting problem → mechanism → consequence → choice or boundary
```

These fields are the canonical `Teaching Model`. Keep one model across research, vault scanning, drafting, and
review; do not replace it with a source list, a technology outline, or a post-hoc summary of already-written prose.

If the question or spine cannot be stated without joining unrelated problems, split the note or choose a narrower
angle. When the user's material is broad but coherent, choose a useful boundary and park the rest; do not turn every
related name into a section.

Before comparing technologies, identify their dimensions. For example, representation, retrieval/ranking, query
orchestration, and data governance are different axes. Give each mechanism one primary role; if it spans axes, state
the secondary role explicitly. Objects on different axes can be composed, not casually presented as alternatives or
put in one comparison row as though they were the same kind of thing.

## 2. Build the argument, not a topic list

Make a small internal model before broad research:

```text
problem or constraint
  → mechanism that addresses it
  → failure or trade-off that remains
  → next mechanism or decision
  → boundary and default choice
```

Every section must answer a necessary subquestion of the central question. When sections are parallel or lie on
different composable axes, state their shared question and relationship explicitly instead of pretending one causes
the next. Name sections after the question or decision they resolve, not merely after a product, paper, or noun. The
order follows prerequisite or causal dependency where one exists; there is no section-count target.

Use one running example when several mechanisms would otherwise remain abstract. It should recur only where it
clarifies a transition; do not add an example as decoration.

Before writing prose, make an internal section blueprint:

```text
section → the question this section resolves
answer → the smallest answer that moves the reader forward
requires → concepts the reader must already have
leads_to → the next question or decision this answer unlocks
relation → prerequisite | causal | parallel | composable | alternative | refinement
why_next → why this answer makes that relation or next question necessary
admitted → claim IDs, examples, and boundaries that earn a place here
```

The blueprint is a tree, not a flat list. Record the parent, children, heading level, and sibling relation for every
section. Heading depth is semantic: it tells the reader what belongs under what; it is not a font-size choice.

Choose one title convention for the note and keep it consistent:

- **Implicit filename title** — the filename is the title, so each major chapter is a `#` heading and its children are
  `##`/`###` headings. Do not make the first substantive chapter the sole `#` parent of unrelated chapters.
- **Explicit body title** — the first `#` heading is the note title, normally matching the filename or frontmatter
  title; major chapters are `##`, and their children are `###`/`####` headings.

The two conventions are both valid, but a content section must not masquerade as the document root. Parallel chapters
must be siblings under the same parent; mechanisms that share a failure question should sit under that question rather
than appearing as a flat row of unrelated top-level sections. Never jump from `#` to `###` without an intermediate
parent. Before drafting, inspect the outline as a tree and ask: “Can a reader tell what these sections have in common
without reading their paragraphs?” If not, change the teaching model before changing prose.

Do not promote a section into the body merely because it is related to the topic or backed by a source. If its `answer`
does not make the next section more intelligible—or, for a parallel/composable section, does not make its relationship
to the shared question explicit—merge, move, defer, or drop it. This blueprint is the gate between research evidence and
prose; it may contain fragments, but it is not a draft to paste.

## 3. Make research serve the model

For every surviving claim, record its editorial role in addition to its source:

```text
claim → role (premise | mechanism | example | boundary | decision)
depends_on → which prior idea makes it intelligible
why_now → the question or transition it answers
source → direct evidence and its limits
disposition → include | qualify | correct | defer | drop
```

Research results are inputs to editorial judgment, not paragraphs to paste. A verified claim with no role, dependency,
or place in the spine is deferred or dropped. If research changes the model, redraw the model and reorder the note;
do not append a new branch to preserve it. The same rule applies to reviewer findings: extract the underlying reader
problem, choose an editorial operation, then rewrite only the necessary content in the note's voice.

## 4. Compose and edit as an editor

Draft from the section blueprint, not from the order in which sources returned. A paragraph normally does one job: set
up a question, explain a mechanism, show an example, state a boundary, or derive a decision. Every paragraph must map
to a section and one of those jobs; if it cannot, delete, merge, move, defer, or rewrite it. Make the transition to the
next job visible when the dependency is not obvious. The opening of a section should make its reason for appearing now
understandable; its ending should leave the reader ready for the next question.

When revising, all of these are valid editorial operations: keep, rewrite, move, merge, split, delete, defer, and
add. Choose the smallest operation that restores the reader's path. Never paste a reviewer response or research
return into the body. New prose must earn a role in the spine; otherwise remove it even when technically correct.

## 5. Run a linear teach-back test

Read the body from top to bottom without following links. Stop if any of these is true:

- the central question or answer is no longer recoverable;
- a section has no explained role in answering the central question or its relation to a sibling section is hidden;
- a transition claims that one section follows another without a prerequisite, causal, parallel, composable, alternative,
  or refinement relation the reader can understand;
- a paragraph introduces a branch without explaining why it belongs;
- a comparison mixes axes or implies false alternatives;
- a term is locally defined but its purpose in the model is still unclear;
- the last section adds an earlier prerequisite instead of completing the argument.

After the read, state the spine in one sentence and the role of each top-level section in one short clause. If that
cannot be done from the note alone, revise the structure before polishing sentences or adding facts.

## 6. Bind the model to the draft

Before prose is composed, author the blueprint that will become `knowledge-distiller.teaching-model.v1`; it is not a
post-hoc summary. At the Phase 5 draft boundary, bind that blueprint to the exact target path and draft bytes, then
run `check-teaching-model.ts` before the format and delivery gates. Its `sections` must cover every visible heading
exactly once, and each section must carry `question`, `answer`, `dependency`, `boundary`, `role`, `relation`,
`why_next`, `next_heading`, and the line of the next heading. The terminal section explicitly sets `next_heading` and
`next_line` to `null`. Record `diagram_policy`
explicitly; an explicit user request for Mermaid is a hard `required` decision and cannot be replaced by prose alone.
Any later body change invalidates the model and requires a new exact hash.
