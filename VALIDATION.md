# Validation — 12 November 2026

- All dependency-free Node checks passed.
- Browser checks covered opening details, status, zero marks, topic review, notes, persistence, filters, search and backup download.
- Phone layout checked at a 390 px frame / 375 px content viewport; no horizontal content overflow.
- The live Supabase database contains 33 assessments. Direct anonymous table access is denied.
- Live anonymous-role API function tests passed: valid private-key reads and writes, invalid-key denial, optimistic edit conflicts, complete backup restore, and rollback of an invalid restore. Test mutations were rolled back; all assessments returned to not started with no marks or notes.
- Security advisors returned no findings.
- Final published website and cross-browser sync verification follows deployment.
