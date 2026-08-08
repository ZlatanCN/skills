# Wikilink Integrity Protocol

## Why this is a separate protocol

An Obsidian wikilink is a serialized reference, not a piece of prose. A similar-looking title is not an
identity: punctuation, omitted words, duplicate filenames, and stale headings can all point somewhere else or
nowhere. The model must derive the reference from the vault and validate the serialized result after writing.

## Link ledger

Before composing, keep a small internal ledger for every planned link:

| Field | Required value |
|---|---|
| concept | The concept being reused |
| target_path | Exact relative path returned by the vault scan |
| target_note | Exact filename stem used in `[[...]]` |
| anchor | Exact heading text or block ID copied from the target |
| evidence | The target passage defines or materially explains the concept |
| source_line | The line in the draft that will contain the link |

Do not reconstruct `target_note` from memory, a search-result snippet, or a shortened title. Copy it from the
resolved filesystem path. If two notes have the same filename, the reference is ambiguous: omit it unless a
path-qualified target is supported and verified.

## Deterministic gate

The checker requires Node 22.6+ (Node 24+ is preferred because it runs the `.ts` file directly). Validate the
checker itself before relying on it:

```bash
node scripts/check-wikilinks.ts --self-test
```

After the note is written and read back, run the bundled checker against the actual vault:

```bash
node scripts/check-wikilinks.ts \
  --vault-root "$VAULT_ROOT" \
  --file "$NOTE_PATH"
```

The checker verifies only mechanical invariants:

1. every wikilink has a heading or block anchor;
2. the target resolves to exactly one Markdown note;
3. the heading text or block ID exists in that note;
4. links inside fenced code are ignored.

It does not decide whether the target passage defines the concept. That semantic judgment belongs in the link
ledger and the clarity/accuracy review. A non-zero exit is a self-check failure: repair the exact target or
remove the link before review. Never make a fuzzy substitution merely to turn the checker green.

Record the mechanical state as `link_gate: passed | failed | unavailable`. If the checker is unavailable,
perform the same four checks manually and record the missing tool plus every checked target in the Phase 8
report; `unavailable` is not a deterministic pass. “I scanned the vault” is not evidence that the serialized
link is valid.
