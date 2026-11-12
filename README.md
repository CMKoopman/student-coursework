# Studyboard — shared coursework tracker

A single-page tracker for 33 assessments in History, Maths, Science, English and Afrikaans. Science has two separate final exams and a supplied current average of 69%.

## Use the tracker

Open the **private workspace link** shared with you. The page remembers access on that browser. The private link is separate from the public source code and public website address. Anyone with that private link can view and edit the workspace.

- Click an assessment for its topics, status, due date, mark and notes.
- Tick topics as you revise; set assessment completion separately.
- Click the circle beside an assessment to cycle Not started → In progress → Completed.
- Filter by subject or status, or search assessment titles and topics.
- Save changes in a detail form with **Save changes**. Circles save immediately.
- Shared changes normally appear within 10 seconds while the page is visible. **Sharing → Refresh shared progress** refreshes immediately.
- **Sharing → Copy private workspace link** gives another device access to the same tracker.
- **Forget access on this device** removes this browser's saved access. It does not revoke the private link on other devices.
- Export downloads a JSON backup. Restore explicitly confirms replacement and changes all 33 assessments atomically.

Opening only the public address shows the course outline; progress requires the private link. The private access key is sent to the database over HTTPS and checked on every operation. Only its hash is stored in a private database table. No administrator key, workspace access key or student contact details are in this repository.

## Data behaviour

Completion percentages count finished assessments. Topic revision is separate. The 69% Science average is the supplied current average; it is not recalculated from future marks because their weights and earlier marks were not supplied. To update this reported figure, edit `reportedAverage` in `dist/data.js`.

Saving uses server-controlled revisions. Conflicting edits are rejected. Detail forms preserve edited fields, load the latest other fields and ask for review before saving again. Offline saves report failure and leave the form open; the shared version never silently switches to local saving. Due dates and update times use SAST.

## Hosting

GitHub Pages serves `dist/`; Supabase stores shared progress. The new project uses the Free plan. Supabase may pause a Free project after one week of inactivity; the owner can resume it in the dashboard. No paid service or automatic keep-alive is configured.

[GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Supabase pricing](https://supabase.com/pricing)

## Maintain or deploy

The page is buildless HTML, CSS and JavaScript. To publish this repository, choose **GitHub Actions** in Settings → Pages. The included workflow uploads `dist/`.

For local development:

```bash
python3 -m http.server 8000 --directory dist
node --test tests/*.test.cjs
```

`dist/config.js` contains only the public Supabase URL, its public publishable key and `accessMode: 'private_link'`. Blank connection settings enable a clearly labelled local preview.

For a new independent Supabase project, run `supabase/schema.sql`. Set up a random 32-byte URL-safe access key separately, then insert its SHA-256 hash into `study_private.workspace_access` with workspace ID `coursework`. Supply the access key only through the private link fragment `#access=...`; never commit it. The database denies direct client table access. Public API functions check access before reading or updating the data. Named-account functions are retained for optional future member accounts.

Course wording lives in `dist/data.js`. Stable assessment IDs connect to saved progress. Adding assessments or changing checklist length needs a matching database migration. Wording-only changes do not reset progress.

## Files

- `dist/`: complete website.
- `supabase/schema.sql`: database tables, private access checks, validation and write functions.
- `tests/`: dependency-free validation, client and sync checks.
- `.github/workflows/pages.yml`: GitHub Pages publication.

Live database checks covered private reads and writes, invalid-link rejection, stale-edit rejection and transactional backup restore. Security advisors returned no issues. Test edits were rolled back.
