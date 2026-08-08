# Final Self-Check

Run this checklist once before the first reviewer, after every revision, and once before the Phase 8 report. If
the file was not safely written, check the draft but mark path/file checks not applicable and do not claim delivery.

- Scope and route match the user's material; unrelated topics were split or excluded.
- Language, terminology, formulas, code, and conversation-boundary rules are satisfied.
- Material claims have direct evidence; unverified claims are removed or qualified, with important current or
  quantitative claims retaining nearby sources.
- The note teaches cause, mechanism, trade-offs, and boundary conditions without a duplicate title, forced
  Introduction/Conclusion, table of contents, or bibliography dump.
- New-note frontmatter and update-preservation rules are satisfied.
- Existing same-topic choice and output path are correct; `write_status` and read-back prove the claimed file state,
  while uncertain recovery is reported as `possibly_partial`.
- The semantic link ledger is sound, the deterministic wikilink gate passes, and every link has an exact unique target
  position; new block IDs are unique and reported.
- Callouts and diagrams pass the removal test; Mermaid follows `references/mermaid.md`, and unavailable rendering is
  reported as `Mermaid 渲染未验证` with a prose fallback.
- Humanizer and sentence-discipline checks were completed through the extension or its manual fallback.
- Reviewer states, provider evidence, fallback checks, finite round cap, late results, and cancellation claims are
  truthful; no wall-clock duration was treated as provider failure.
- The Phase 8 report accurately states revisions, corrections, unresolved claims, vault mutations, and delivery state.
