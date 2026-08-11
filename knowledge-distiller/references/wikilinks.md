# Wikilink integrity

A wikilink is a serialized identity, not decoration. It passes two gates:

1. mechanical: one safe file and one unique heading or block ID;
2. semantic: the target passage defines or materially explains the alias.

## Manifest and targets

Resolve the vault root with `realpath`. Recursively include regular, non-symlink Markdown files whose real paths stay
inside the root. Exclude `.git`, `.obsidian`, `.agents`, `.codex`, `node_modules`, build output, generated output,
artifacts, and the skill implementation directory. Keep the normalized relative path, basename, content hash, headings,
and block IDs in memory for the current scan.

Allowed targets are:

```text
[[#Exact Heading|local concept]]
[[Note#Exact Heading|concept]]
[[folder/Note#^block-id|concept]]
```

Reject bare whole-note links, absolute paths, `..`, excluded files, symlinks, and fuzzy matches. A basename must resolve
to exactly one file; a path-qualified target must resolve to exactly one normalized path. A heading or block ID must also
be unique. Never choose the first match.

When the scan is partial or unavailable, omit vault-derived links and report the missing connection. An explicit path
does not make an incomplete scan complete.

## Anchor parsing

Ignore YAML frontmatter, fenced code, and inline code when indexing headings and block IDs. Normalize heading whitespace
with NFKC and trim. A legal block ID is the final non-whitespace token of a non-fenced paragraph and matches
`[A-Za-z0-9_-]+`.

## Semantic check

After a mechanical pass, read the target passage again. Record a bounded excerpt, target hash, and one-sentence reason
why it defines the alias. If it is merely adjacent, preference-only, or not useful to the current teaching model, omit
the link. If target bytes change, rescan.

## Safe failure

| Situation | Action |
| --- | --- |
| unique file and anchor | emit the anchored link |
| duplicate basename without explicit path | omit or ask |
| duplicate heading/block | omit or repair only with explicit permission |
| partial scan | omit vault links and report the gap |
| semantic mismatch | omit the link |
| changed target bytes | rescan |

Truthful missing connections are better than precise links to the wrong concept.
