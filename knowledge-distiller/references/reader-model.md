# Reader model

This reference defines the teaching shape. It is not a second workflow or a machine schema.

## 1. Define the destination

Before research, answer:

```text
reader  → who this is for and what they know
question → the one question the note answers
after   → the one explanation, prediction, or choice the reader can teach back
scope   → included questions and parked branches
spine   → problem → mechanism → consequence → decision or boundary
```

Treat `after` as one learning target, not a list of topics. A note may mention several controls or examples, but if the reader
cannot teach back one causal model and the choice it enables, narrow or split the note.

A note changes the reader's mental model; it is not a warehouse of verified facts. If unrelated questions cannot share
one spine, narrow or split them. If the input is broad but coherent, choose a boundary and continue. A shared domain or
security theme is not by itself a shared teaching problem.

Before comparing technologies, name their axes. Representation, retrieval, orchestration, and governance can compose;
they are not automatically alternatives.

When introducing an unfamiliar or user-proposed abstraction, default to concrete phenomenon → design problem → reason for
an organizing model → working model → category contents → overlap and boundary. This is a clarity heuristic, not a rigid
template: a mature taxonomy or reference note may lead with its definition, but must still state the model's status, axis,
and scope.

## 2. Build the argument

Use the smallest useful teaching tree:

```text
problem or constraint
  → mechanism
  → remaining failure or trade-off
  → next decision
  → boundary and default choice
```

For every section, record its question, answer, prerequisites, role, relation to its siblings, parent, children, next
question, and Markdown surface. Relations are explicit: `causal`, `prerequisite`, `parallel`, `composable`, `alternative`,
or `refinement`. A section list is insufficient because each necessary subquestion is not automatically a top-level chapter.

Heading depth expresses containment and dependency, not importance:

- H1 answers an independent top-level question under the document title.
- H2/H3 answers a contained mechanism, consequence, example, boundary, or decision.
- Paragraphs, lists, tables, and callouts carry local material that does not need independent navigation.

The filename is always the document title. If frontmatter has a `title`, it must match the filename; metadata must not
create a second title identity. Do not add a duplicate body title H1. Genuine top-level questions are H1 siblings;
contained questions use H2/H3.

Use the sibling test before prose: do the sections share one parent question; can each stand alone without the preceding
section; does the proposed parent genuinely summarize all children; and would removing the heading lose navigation rather
than only visual emphasis? If the relationship is unclear, redraw the tree. Do not invent a parent merely to avoid an all-H1
note, and do not flatten related subquestions merely because H1 siblings are legal. Never jump heading levels, and default
to H3 or shallower unless deeper navigation is essential.

Name sections after the question or decision they resolve. A mechanism or example is not automatically a child; its level is
determined by the question it serves. Use one running example only when it reduces abstraction. A fact backed by a source but
lacking a role in the spine is deferred or dropped. Coverage is not a reason to keep every retrieved item: if an enumeration
mixes classification axes, needs different predicates, or adds names without advancing the single teach-back, group it, use a
representative example, defer it, or drop it.

## 3. Research and edit

For each surviving claim, record its source, limits, role, and disposition. Research returns are inputs to editorial
judgment, not paragraphs to paste. When evidence changes the model, redraw the outline before writing.

Every paragraph has one job: define, explain a mechanism, show an example, state a boundary, compare on one axis, or
make a transition. An enumeration belongs in one sentence only when its items share the same axis and predicate; otherwise
use groups or separate sentences. A correction, limitation, or conclusion inherited from the user's reasoning must also make
its local antecedent recoverable to a standalone reader. If it depends on an unseen conversational premise, add the smallest premise,
rewrite it as a self-contained boundary, or delete it. If it has no job in the spine, or does not help the reader make the target choice, merge, move, defer, or delete it.

For updates, preserve unrelated content by default. Change only incorrect, duplicate, out-of-scope, explicitly retired,
or structurally misplaced material.

## 4. Teach-back

Read the note top to bottom without following links. Reconstruct both the argument and its heading tree. Stop when:

- the central question or answer is no longer recoverable;
- a section has no role or hidden relationship to its siblings;
- a proposed child cannot state the parent question it resolves;
- sibling sections do not share a genuine parent question;
- a substantive section is used as a false parent for unrelated chapters;
- a heading exists only for visual emphasis and would lose no navigation when removed;
- a transition lacks a prerequisite, causal, parallel, composable, alternative, or refinement relation;
- a correction, limitation, or causal conclusion responds to a premise the note never makes visible;
- a comparison mixes axes or implies a false alternative;
- a term is defined but its purpose is unclear;
- the last section introduces an earlier prerequisite instead of completing the argument.

State the spine, the heading convention, each top-level section's role, and each non-top-level section's parent in one
sentence. Then state the reader's teach-back and resulting choice in no more than three short sentences. If that cannot be
done from the note alone, or the summary is only a catalogue of sections and terms, repair the scope or teaching path before
polishing prose. A mechanically valid heading tree is not a clarity pass.
