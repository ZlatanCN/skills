# Mechanical gates

The scripts verify facts that code can determine. They do not decide whether the teaching model is insightful, whether a
source is sufficient, or whether a callout is worth keeping; clarity and accuracy review do that.

## One note command

Run against the exact temporary file before replacement and the exact final file after read-back:

```bash
node scripts/check-note.ts \
  --file "$NOTE_PATH" \
  --vault-root "$VAULT_ROOT" \
  [--original "$ORIGINAL_PATH"] \
  [--json]
```

The aggregate checks:

- frontmatter, fenced code, tables, callouts, emphasis, unsafe HTML/URLs, and Mermaid hazards;
- heading root, level jumps, duplicate anchors, and the filename-only title convention (frontmatter must match the filename; no duplicate body title H1);
- vault containment, symlink exclusion, unique wikilink targets, and unique anchors;
- update preservation when `--original` is supplied.

It returns one evidence envelope with `passed`, `failed`, or `unavailable`. An unavailable scan or child check is not a
pass. Focused checker files may remain for diagnostics, but the workflow has one public note command.

## Minimal evidence

Keep only the note path, vault root, original hash when updating, final hash after read-back, checker result, and concrete
findings. Do not create format plans, teaching-model JSON, run manifests, journals, or per-phase evidence files.

## Delivery check

`check-delivery-report.ts` validates a small final record:

```json
{
  "schema_version": "knowledge-distiller.delivery.v1",
  "note_path": "/absolute/path/to/note.md",
  "final_hash": "sha256",
  "write_state": "committed",
  "write_outcome": "created",
  "review": {
    "clarity": {"result": "clean", "findings": []},
    "accuracy": {"result": "clean", "findings": []}
  },
  "blockers": []
}
```

The checker verifies the final hash when the file is committed and rejects a success label when either review is not
clean, a blocker exists, or the write state is uncertain. The record may stay in memory during a normal invocation.

## What code cannot prove

Code cannot reliably judge causal teaching, source sufficiency, semantic link usefulness, analogy quality, or whether an
update preserved the meaning the user cares about. Keep those decisions in the claim ledger and the two reviewers.
