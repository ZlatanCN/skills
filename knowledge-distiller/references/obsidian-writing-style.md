# Obsidian writing style

**Surface principle**

Use the simplest surface that preserves the reader's job. Markdown is a retrieval aid, not decoration: **format only what
 the reader needs to find, compare, execute, or remember.**

This is a style reference, not a format inventory.

## Defaults

- Ordinary paragraphs explain concepts and causal relationships.
- Headings state the question or decision a section resolves.
- One paragraph has one main job.
- Numbered lists express order or decisions; unordered lists express parallel items.
- Tables compare one aligned axis; move long explanations into prose.
- Code blocks show executable syntax or clearly labelled teaching pseudocode.
- Mermaid shows a relationship, state transition, sequence, or structure that prose would make longer. Choose its type from the
reader's question: `flowchart` for flow or decisions, `sequenceDiagram` for actor order, `stateDiagram-v2` for lifecycle,
`classDiagram`/`erDiagram` for entity relations, and `timeline` for change over time. Use one diagram only when it materially
reduces relationship reconstruction; do not add a diagram for a short prose explanation.
- Wikilinks connect to an actual defining passage in the vault.

Ask “what would the reader lose if this formatting disappeared?” If the answer is nothing, use a paragraph.

### Natural technical Chinese

Write the note's meaning directly rather than performing explanation. Remove filler openings, praise, promotional language,
vague authority, empty summaries, forced contrasts, repeated connective phrases, and literal translations when a precise Chinese
expression exists. Prefer explicit subjects and simple verbs. A transition such as “因此”“再”“同时” must have a recoverable
前件; if it changes the topic or reader task, split the sentence or paragraph. Naturalness is a wording pass after the teaching
unit is stable, not permission to change claim scope, causal order, or technical boundaries.

## Emphasis and callouts

> **Attention budget**
>
> Bold and callouts are scarce attention signals. Use them for a conclusion, constraint, boundary, warning, stop rule,
> example, or reusable model—not for ordinary explanation.

- Bold a conclusion, constraint, or key difference; never bold a whole paragraph.
- Use inline code for identifiers, commands, filenames, exact syntax, and state values.
- Use italics sparingly for a qualifier; do not use it as a definition or code.
- Use `info` for scope, version, or precondition boundaries.
- Use `warning` or `danger` for common wrong intuitions and risky actions.
- Use `example` for a concrete scenario or analogy.

Every callout needs an independent reader function: use `info` for scope or preconditions, `warning` for a wrong intuition,
`danger` for a stop rule or irreversible risk, `example` for a concrete scenario, `tip` for a recommended default, and
`abstract` for a compact reusable model. Keep the main argument in ordinary prose. Do not nest beyond two levels, rely on
custom CSS, or use a callout as decoration. Choose a callout when the content must be quickly found or remembered; do not add
one merely because the content is important. Reminder phrases such as “注意”, “第一原则”, “关键认知”, and “需要明确” are
heuristic signals for this decision, not hard rules: a matching boundary or stop rule without those words may still need a
callout, while an ordinary explanation containing them may not.

```markdown
> [!warning] Boundary
> This example describes the mechanism, not a complete production implementation.
```

## Links and sources

> **No source tails**
>
> Treat an external link as an affordance inside the claim it supports, not as a citation object appended after the claim.
> A link that appears only after the claim has ended is a new source object and fails the teaching surface.

Treat an external link as an affordance inside the claim it supports, not as a citation object appended after the claim.
A link may end a sentence when it is grammatically part of that sentence; a link after terminal punctuation is a source tail.

- Put the link inside the claim-bearing sentence, footnote, or callout; do not add it in a later source-append pass.
- The anchor must identify the linked subject without creating a new discourse unit.
- Standalone source lines, `Source:`, `参考资料：`, and source lists are forbidden.
- An RFC section, paper, or versioned specification may be the anchor when the source itself is a syntactic participant.
- Do not use a generic anchor such as “here” or “source” when a more informative phrase is available.

```markdown
<!-- good: the link is part of the sentence's meaning -->
The cache key includes the request method, as specified in [RFC 9110 §5.2](https://example.com/rfc).
[The HTML Living Standard](https://example.com/html) defines the parsing behavior used by this example.

<!-- bad: the source is appended as a separate citation tail -->
The cache key includes the request method. [RFC 9110](https://example.com/rfc)
The cache key includes the request method. Source: [RFC 9110](https://example.com/rfc)
```

Do not link every ordinary term. Link density follows the reader model, not the number of search results.

## Diagrams and code

Explain what the reader should observe before a diagram and what it cannot express after it. Keep node IDs ASCII,
labels short and quoted when ambiguous, and never put raw wikilinks in Mermaid labels.

For static Obsidian notes, do not use Mermaid `click`, callbacks, external URLs, raw HTML, init/config directives, or
embedded JavaScript. If the target renderer was not opened, report `Mermaid 渲染未验证`.

Define formula symbols near the formula. Code fields, states, and function names must match the surrounding prose.
