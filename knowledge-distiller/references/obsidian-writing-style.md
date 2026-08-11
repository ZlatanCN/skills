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

External links belong in the sentence, footnote, or callout that states the supported claim. Do not append a bare URL or
a source-title link list at the end. The clickable text should be natural wording from the claim; RFC sections, papers,
and versioned specifications may use their citation as the anchor.

Do not link every ordinary term. Link density follows the reader model, not the number of search results.

## Diagrams and code

Explain what the reader should observe before a diagram and what it cannot express after it. Keep node IDs ASCII,
labels short and quoted when ambiguous, and never put raw wikilinks in Mermaid labels.

For static Obsidian notes, do not use Mermaid `click`, callbacks, external URLs, raw HTML, init/config directives, or
embedded JavaScript. If the target renderer was not opened, report `Mermaid 渲染未验证`.

Define formula symbols near the formula. Code fields, states, and function names must match the surrounding prose.
