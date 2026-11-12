# Validation — 12 November 2026

- All 11 dependency-free Node checks passed.
- Browser checks covered opening details, status, zero marks, topic review, notes, persistence, filters, search and backup download.
- Phone layout checked at a 390 px frame / 375 px content viewport; no horizontal content overflow.
- Live Supabase checks passed for valid private-key reads and writes, invalid-key denial, direct-table-access denial, optimistic edit conflicts and atomic backup restoration.
- Supabase security advisors returned no findings.
- GitHub Pages publication succeeded. The live page connected to the shared database without browser errors.
- A separately opened page loaded the status, zero mark, note and topic tick saved in the first page, confirming server-backed shared progress.
- An independent browser opened only the public address and saw the outline with saved progress hidden.
- Temporary test entries were cleared. All 33 assessments are ready: not started, no marks, no notes, no due dates and no topics checked.
