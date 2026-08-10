# Wikilink Integrity Protocol

本文件只定义 wikilink 的语义与唯一性规则。`check-wikilinks.ts` 负责其中的机械事实，`check-note.ts` 在写入前后汇总它；标题树、Markdown 表面、格式计划和审查 journal 由各自的 checker 负责。

An Obsidian wikilink is a serialized identity, not decorative prose. The target file, anchor, and alias must be
derived from the actual vault and validated after the exact note bytes are read back. This protocol has two separate
gates:

1. the **mechanical gate** proves that the serialized link has one safe target and one unique anchor;
2. the **semantic gate** proves that the target passage defines or materially explains the concept named by the alias.

A mechanical pass is never a semantic pass. A missing or partial vault scan never becomes a deterministic pass.

## 1. Link ledger before composition

Keep at most five central cross-note links unless the note's teaching model requires more. Record one ledger row for
each planned link:

| Field | Required value |
| --- | --- |
| `concept` | The concept being reused |
| `target_path` | Exact normalized relative path from the canonical manifest |
| `target_note` | Exact filename stem serialized in `[[...]]` |
| `anchor` | Exact heading text or legal block ID copied from the target |
| `alias` | Short concept name shown to the reader |
| `source_line` | Draft line that will contain the link |
| `target_hash` | Target content hash from the manifest |
| `excerpt` | Bounded target passage used for semantic judgment |
| `definition_reason` | Why that passage defines or materially explains the alias |
| `result` | `planned | mechanical_pass | semantic_pass | omitted` |

Never reconstruct a filename, heading, or block ID from memory, a search snippet, or a shortened title. If no target
passage defines the concept, explain it locally and omit the link. If two notes have the same basename, omit an
unqualified link unless an exact path-qualified target is supported and verified.

## 2. Canonical manifest is the identity boundary

Resolve one `vault_root` with `realpath`. Recursively include only regular, non-symlink Markdown files whose realpath
stays inside that root. Exclude the exact directory names:

```text
.git  .obsidian  .agents  .codex  node_modules
dist  build  generated  artifacts
```

Also exclude the resolved skill-implementation directory unless it is explicitly the subject of the check. Sort
normalized relative POSIX paths. For every included note record:

```text
{relative_path, realpath, basename, content_hash, headings, block_ids}
```

Use SHA-256 over the file bytes for `content_hash`. For duplicate basename keys use Unicode NFKC, surrounding
whitespace trim, whitespace collapse, and locale-independent case-fold. Use SHA-256 over UTF-8 canonical sorted JSON
for `manifest_hash`. Keep the scan evidence even when the manifest is empty:

```text
{root_realpath, exclusions, errors, manifest_hash, duplicate_keys, scan_status}
```

`scan_status` is `complete` or `partial`. A skipped symlink is absent, not a valid target. A directory or file read
error makes the scan partial and invalidates every vault-derived link decision; do not silently use the files that were
read successfully.

## 3. Target identity and collision rules

Use only these target forms:

```text
[[#Exact Heading|local concept]]
[[Note#Exact Heading|concept]]
[[folder/Note#^block-id|concept]]
```

Rules:

1. `[[#Heading]]` resolves to the current note, which must itself be in the canonical manifest.
2. An unqualified basename resolves globally against the manifest's normalized basename key. One candidate passes;
   zero candidates fails; more than one candidate is ambiguous and fails.
3. A path-qualified target matches one exact normalized relative POSIX path. It may pass even when that note's basename
   is duplicated, but the path itself must occur exactly once.
4. Normalize an allowed leading `./` and backslash path separators to the canonical POSIX form before matching. A
   target containing `..`, an absolute path, an empty or `.` component after that normalization, an excluded file, a
   symlink, or a file outside the manifest fails. Do not use a current-directory shortcut to bypass global basename
   ambiguity.
5. A target with no `#anchor`, including `[[Note|alias]]`, is a bare whole-note link and fails. An alias changes display
   text only; it cannot hide a missing target or anchor.

Do not fuzzy-match punctuation, case, shortened titles, neighboring notes, or the first result returned by a search.
When the vault root is partial or unavailable, omit vault-derived links and report the missing connection. An explicit
path does not make an incomplete manifest complete. An explicit safe out-of-vault target has no vault-derived links and
`actual_vault_check: unavailable`.

## 4. Anchor parsing and uniqueness

The target parser uses the same visible Markdown surface for both link discovery and anchor indexing:

- strip YAML frontmatter at the beginning of the note;
- ignore fenced code blocks for both backtick and tilde fences;
- ignore wikilinks and block IDs inside inline code;
- index ATX headings using NFKC, trim, and collapsed whitespace normalization;
- accept a block ID only when `^id` is the final non-whitespace token of a non-fenced paragraph and `id` matches
  `[A-Za-z0-9_-]+`.

An anchor must occur exactly once in the target note. A missing or duplicated normalized heading fails. A missing,
illegal, or duplicated block ID fails. Never choose the first occurrence to make a link green. If target bytes change
after the manifest or semantic ledger was created, invalidate the ledger and rescan.

## 5. Deterministic checker

Node 22.6+ is required; Node 24+ is preferred because it runs the bundled `.ts` file directly. Run the self-test before
relying on the checker:

```bash
node scripts/check-wikilinks.ts --self-test
```

After staging the exact temporary file, and again after final read-back, run the checker against the actual vault:

```bash
node scripts/check-wikilinks.ts \
  --vault-root "$VAULT_ROOT" \
  --file "$NOTE_PATH" \
  --json
```

The checker is mechanical only. It verifies:

1. the requested source note is a regular Markdown file in the canonical manifest;
2. the scan is complete and its root/exclusions/manifest evidence is available;
3. every visible wikilink has a heading or block anchor;
4. every target resolves to one included note under the collision rules;
5. every anchor is legal, present, and unique;
6. frontmatter, fenced code, and inline-code false positives are ignored.

Interpret exit status literally:

| Exit | Meaning |
| --- | --- |
| `0` | Complete scan; all requested notes and visible links pass mechanically |
| `1` | Complete scan; a requested file, target, link, or anchor is invalid |
| `2` | Invalid invocation or partial/unavailable scan; no deterministic pass |

With `--json`, retain `root_realpath`, `scan_status`, `manifest_hash`, `duplicate_keys`, `scan_errors`, and per-error
evidence in the execution log. `--include-skill-dir` is an explicit exception only when the skill implementation itself
is the subject. A self-test is not an actual-vault pass.

## 6. Semantic gate and final evidence

After the mechanical gate passes, read the resolved target passage again. Ask whether it materially defines or explains
the concept named by the alias and whether linking it improves the current note's model. Record:

```text
mechanical_target → one manifest path + one unique anchor
semantic_target   → bounded excerpt + target_hash + definition_reason
snapshot          → manifest_hash + target_hash at decision time
```

If the mechanical gate passes but the passage is merely adjacent, preference-only, or not a definition, mark the ledger
`omitted`; do not emit the link. If semantic meaning changes after a content revision, rerun the ledger and both gates.
The clarity/accuracy review may judge semantic fit, but it cannot override a failed mechanical gate.

Report these states independently:

```text
checker_self_test   → passed | failed | unavailable
actual_vault_check  → passed | failed | unavailable
mechanical_link_gate→ passed | failed | unavailable
semantic_link_gate  → passed | failed | unavailable
```

`semantic_link_gate: passed` with zero emitted links is valid only when the ledger records that no suitable defining
target existed or all candidates were safely omitted. It does not mean that the vault was not scanned.

## 7. Safe failure paths

| Situation | Required action |
| --- | --- |
| One exact target and anchor | Emit the anchored link, retain ledger evidence, run both gates |
| Duplicate basename, no explicit path | Omit or ask for the missing choice; never guess |
| Unique path-qualified target | Emit only after exact path and anchor validation |
| Duplicate heading or block ID | Omit or repair the target only with explicit mutation permission, then rescan |
| Partial/unavailable scan | Omit vault-derived links, report the gap, and never claim deterministic pass |
| Checker unavailable | Perform the same checks manually, record every target and the missing tool; state `unavailable` |
| Mechanical pass but semantic mismatch | Omit the link; do not substitute a nearby note |
| Target bytes/meaning changed | Invalidate snapshot and rebuild the manifest/ledger |

Never make a fuzzy substitution merely to turn the checker green. A truthful missing connection is safer than a precise
link to the wrong concept.
