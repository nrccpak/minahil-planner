# Minahil's Planner — Phase 1 (Core planner)

**Live app:** https://nrccpak.github.io/minahil-planner/

Homework diary planner for Minahil. Plan at 3:20, study on paper 3:30–7:30, tick feedback in the evening, and the app plans better the next day. Phase 1 has **no AI and no cost**; all data stays on the phone.

## What Phase 1 does

| Area | What's built |
|---|---|
| Access | Separate 4-digit PINs for Minahil and the parent area; auto-lock after 15 min idle |
| Week-one setup | Minahil sets starting minutes per page / question / verse / test for each diary subject |
| Diary photo | Camera photo saved with the day (collected now for Phase 2 scanning) |
| Task entry | Subject buttons (English-R … Arabic + Other), kind of work, units, note in English or Urdu (Urdu kept as written, right-to-left), Test / Due-tomorrow flags. Notes like "Ex 3.2 Q1–3" or "p 12-15" fill the units automatically |
| Order | Suggested order (tests and due-tomorrow first, then subjects she tends to move up). Drag or arrows to change; unchanged = agreed |
| Plan | 30-min blocks + 5-min breaks, 15-min break after every 3 blocks; ~12% spare time; finish line 7:30; warns at 3:30 if it won't fit |
| Overflow | She picks tasks for a morning slot (earliest wake 5:00); if still too much, lowest-priority task moves to the weekend (carried over) or is dropped |
| Light days | Offers a 30–45 min revision block, suggesting topics marked Hard / Didn't understand / Need help |
| Day options | "Today is different" (one-off times), Pause (holiday/sick — not counted), weekend window 2:00–7:00 offered on Sat/Sun |
| Printed sheet | One A4 page: plan with times, tick boxes per task (status, time, difficulty, focus, why late, need help), start/finish/sleep times, TV boxes (15 min each), "what was hard", date code MH-YYMMDD. Fits 9+ tasks on one page |
| Evening ticks | Same layout on screen; optional photo of the ticked sheet (kept for Phase 2) |
| Learning (plain code) | Per-unit times = weighted average of last 5–7 days, max ~10 min change per day, rounded to 5; skips Interrupted / Partly done / possibly-rushed results. Order preferences learned from her drags |
| Minahil's view | Tasks done, free time earned, minutes saved, TV today, streak of days finished before the line |
| Parent view | Last 7 days: days with no morning catch-up (key result), finished by the line, average finish/sleep, TV, order changes, overrunning subjects, delay reasons, need-help items, "what was hard" notes; full history with photos; learned times; all settings; backup/restore; PIN change |

## Put it on the phone (GitHub Pages, free)

1. Create a GitHub repo (private repos need GitHub Pro for Pages; a public repo is fine — the code holds no personal data, everything is stored on the phone).
2. Upload all files from this folder (keep the `icons` folder).
3. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
4. On the mother's phone open the Pages link in **Chrome** → menu ⋮ → **Add to Home screen**.
5. First open: set the parent PIN and Minahil's PIN. Minahil then sets her starting times (or skips).
6. In the phone's Clock app add two repeating alarms, Mon–Fri: **3:20 "Plan time"** and **7:30 "Feedback time"**.
7. Printing: Sheet tab → Print sheet → choose the Wi-Fi printer and A4.

## Daily use

- **3:20** Today tab → diary photo → add tasks → check order → Make today's sheet → print.
- **3:30–7:30** study from the paper with a desk timer; phone not needed.
- **Evening** Evening tab → copy the ticks → Save (about 2 minutes).
- **Weekly** Parent tab → Download backup (save to Google Drive or WhatsApp yourself).

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `styles.css` | Look (light/dark) and the A4 print layout |
| `planner.js` | Planning engine: estimates, order, blocks, buffer, overflow, learning, weekly summary |
| `store.js` | On-phone storage (IndexedDB) |
| `app.js` | Screens and interactions |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app + offline use |
| `supabase/schema.sql` | Ready-made tables, row security and private photo bucket for cloud sync |
| `tests/planner.test.js` | 15 unit tests (`node tests/planner.test.js`) |

## Cloud sync (Supabase, family account)

- A separate family Supabase project (free plan, Singapore) with tables `app_kv` and `days` under row-level security, and a private `photos` bucket.
- The phone stays the main copy and works offline. When signed in, every save is copied up within a few seconds; changes from another phone come down when the app opens. Newest save wins per day.
- First phone: Parent → Cloud sync → Create account → confirm the email → Sign in.
- Another phone: open the app link → "Restore from the cloud" → sign in. PINs, days, learned times and photos come across.
- "Delete everything" clears only that phone and signs it out; the cloud copy stays.
- Files: `sync.js`, `vendor/supabase.js` (supabase-js 2.118.0, bundled for offline use), `supabase/schema.sql`.

## Next steps

- **Supabase sync**: done (see above).
- **Phase 2**: Gemini reads the diary photo and the ticked sheet (via a Supabase function, key never on the phone), tuned on the photos collected in Phase 1.
- **Phase 3**: adaptive block length, daily tip.
- **Phase 4**: Sunday email, alerts, full weekend mode, Exam mode, app notifications.
