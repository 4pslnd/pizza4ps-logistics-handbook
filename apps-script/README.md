# Apps Script backup

This folder is a **code backup** of the EDL Internal Handbook — the live
tool runs as a Google Apps Script web app, not from this repository. These
files are kept here only so the code has version history and a place to
recover from if needed.

- `Code.gs` — server-side logic (access control, load/publish, validation)
- `Editor.html` — the editor + website page shell (HTML/CSS/JS)
- `Layout.html`, `Render.html`, `Modal.html` — supporting scripts, included
  into `Editor.html` at runtime via Apps Script's `include()` pattern

**Data does not live here.** The actual handbook content (all processes,
steps, owners, etc.) is stored in a Google Sheet that the Apps Script
project reads from and writes to — see the `SHEET_ID` script property.
`data/processes.json` elsewhere in this repo is a leftover from an earlier
GitHub-based version of the backend and is no longer read by anything.

To deploy a change: copy the updated file(s) into the actual Apps Script
project (script.google.com), save, and create a new deployment. Pushing to
this folder does not automatically update the live tool.
