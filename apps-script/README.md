# Apps Script — EDL Internal Handbook (UI review build)

Code backup of the handbook web app. The live tool runs as a Google Apps
Script web app; these files are the source, kept here for version history.

## Files
- `Code.gs` — server backend. Serves the page (gated to the L&D Google Group),
  reads/writes the content in a Google Sheet, logs every change, and can ping a
  Google Chat webhook. Also holds `seedInitialData()` (run once to load demo
  content).
- `Editor.html` — the whole UI (HTML/CSS/JS inlined). Data and the signed-in
  user are supplied by `Code.gs` at load time via `google.script.run`.

## What runs where (this build)
- **Persisted in the Sheet:** all process / alignment content (the thing people
  publish). Tab `Data` holds it as JSON; tab `History` logs each change.
- **In the page for now (review build):** per-person permissions, the approval
  flow, edit-history restore, and the notification bell. These are demonstrated
  client-side; moving them into the Sheet is the next phase.

## Deploy / update
1. Apps Script project → paste `Code.gs` and `Editor.html` (create an HTML file
   named exactly `Editor`).
2. Project Settings → Script properties:
   - `SHEET_ID` — the datastore Google Sheet id
   - `EDITOR_GROUP` — `learning@pizza4ps.com`
   - `CHAT_WEBHOOK` — (optional) Google Chat incoming-webhook URL for notifications
3. Run `seedInitialData` once to load the demo content.
4. Deploy → New deployment → Web app (execute as you; access: anyone in the org,
   or as your setup requires — the group check still gates content).

Pushing to this folder does not deploy anything; copy the files into the Apps
Script project to update the live page.
