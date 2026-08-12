# Obsidian writing style

Use the simplest surface that preserves the reader's job. This is a style reference, not a format inventory.

## Defaults

- Ordinary paragraphs explain concepts and causal relationships.
- Headings state the question or decision a section resolves.
- One paragraph has one main job.
- Numbered lists express order or decisions; unordered lists express parallel items.
- Tables compare one aligned axis; move long explanations into prose.
- Code blocks show executable syntax or clearly labelled teaching pseudocode.
- Mermaid shows a relationship, state transition, sequence, or structure that prose would make longer.
- Wikilinks connect to an actual defining passage in the vault.

Ask “what would the reader lose if this formatting disappeared?” If the answer is nothing, use a paragraph.

## Emphasis and callouts

- Bold a conclusion, constraint, or key difference; never bold a whole paragraph.
- Use inline code for identifiers, commands, filenames, exact syntax, and state values.
- Use italics sparingly for a qualifier; do not use it as a definition or code.
- Use `info` for scope, version, or precondition boundaries.
- Use `warning` or `danger` for common wrong intuitions and risky actions.
- Use `example` for a concrete scenario or analogy.

Every callout needs an independent reader function. Keep the main argument in ordinary prose. Do not nest beyond two
levels, rely on custom CSS, or use a callout as decoration.

```markdown
> [!warning] Boundary
> This example describes the mechanism, not a complete production implementation.
```

## Links and sources

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
