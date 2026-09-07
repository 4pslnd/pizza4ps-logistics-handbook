/**
 * EDL Internal Handbook — Apps Script backend (UI review build)
 *
 * Serves the handbook to members of a Google Group and stores all
 * process / alignment content in a Google Sheet. Permissions, approval,
 * edit-history and the notification bell run in the page for this review
 * build; publishing content is persisted here.
 *
 * Script properties (Project Settings -> Script properties):
 *   SHEET_ID       id of the Google Sheet datastore (from its URL)
 *   EDITOR_GROUP   learning@pizza4ps.com   (who may open the page)
 *   EXTRA_EDITORS  optional, comma-separated extra emails
 *   CHAT_WEBHOOK   optional, a Google Chat incoming-webhook URL for notifications
 */
var P = PropertiesService.getScriptProperties();
function prop(k, d) { var v = P.getProperty(k); return (v === null || v === '') ? d : v; }
function cfg() {
  return { sheetId: prop('SHEET_ID', ''), group: prop('EDITOR_GROUP', 'learning@pizza4ps.com'),
           extra: prop('EXTRA_EDITORS', ''), chat: prop('CHAT_WEBHOOK', '') };
}
function currentEmail() { return (Session.getActiveUser().getEmail() || '').toLowerCase(); }
function isMember(email) {
  if (!email) return false;
  var c = cfg();
  var extra = c.extra.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (extra.indexOf(email) >= 0) return true;
  try { return GroupsApp.getGroupByEmail(c.group).hasUser(email); } catch (err) { return false; }
}
function doGet(e) {
  var email = currentEmail();
  if (!isMember(email)) {
    return HtmlService.createHtmlOutput(
      '<div style="font:15px/1.6 Arial;padding:44px;max-width:560px;margin:auto;color:#24264A">' +
      '<h2 style="margin:0 0 10px">No access</h2>' +
      '<p>You are signed in as <b>' + (email || 'an unknown account') + '</b>.</p>' +
      '<p>The EDL Internal Handbook is limited to members of <b>' + cfg().group +
      '</b>. Ask the L&amp;D team to add you, then reload this page.</p></div>').setTitle('No access');
  }
  var t = HtmlService.createTemplateFromFile('Editor');
  t.userEmail = email;
  return t.evaluate().setTitle('EDL Internal Handbook')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
function sheetFile_() { var c = cfg(); if (!c.sheetId) throw new Error('SHEET_ID is not set in the script properties.'); return SpreadsheetApp.openById(c.sheetId); }
function dataSheet_() {
  var ss = sheetFile_(), sh = ss.getSheetByName('Data');
  if (!sh) { sh = ss.insertSheet('Data'); sh.getRange(1, 1).setValue('⚠ System data — do not edit by hand. Use the Handbook editor instead.'); sh.getRange(2, 1).setValue(''); }
  return sh;
}
function historySheet_() {
  var ss = sheetFile_(), sh = ss.getSheetByName('History');
  if (!sh) { sh = ss.insertSheet('History'); sh.appendRow(['Date change', 'Change detail']); sh.setFrozenRows(1); }
  return sh;
}
/** Current published content. */
function loadData() {
  var email = currentEmail();
  if (!isMember(email)) throw new Error('Not authorized.');
  try {
    var raw = dataSheet_().getRange(2, 1).getValue();
    return { ok: true, data: raw ? JSON.parse(raw) : { processes: [] }, userEmail: email };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
}
/** Server-side re-check of the browser's rules (processes only; alignments are documents). */
function validateDoc(doc) {
  var errs = [];
  if (!doc || !doc.processes) return ['There is nothing to save.'];
  doc.processes.forEach(function (p) {
    if (!p.process_id) errs.push('An item has no id.');
    if (!p.pillar) errs.push('"' + (p.title || p.process_id) + '" has no pillar.');
    if (p.kind === 'alignment') return;  /* documents have no flowchart to validate */
    var ids = {}; (p.steps || []).forEach(function (s) { ids[s.id] = 1; });
    var starts = (p.steps || []).filter(function (s) { return s.type === 'start'; });
    var ends = (p.steps || []).filter(function (s) { return s.type === 'end'; });
    if (starts.length !== 1) errs.push('"' + (p.title || p.process_id) + '" must have exactly one Start step.');
    if (ends.length !== 1) errs.push('"' + (p.title || p.process_id) + '" must have exactly one End step.');
    (p.steps || []).forEach(function (s) {
      if (!s.label) errs.push('A step in "' + (p.title || p.process_id) + '" has no name.');
      if (!s.lane && s.type !== 'start' && s.type !== 'end') errs.push('Step "' + (s.label || s.id) + '" has nobody assigned.');
    });
  });
  return errs;
}
/** Writes the whole content doc back, logs the change, and (optionally) pings Google Chat. */
function saveData(processes, message) {
  var email = currentEmail();
  if (!isMember(email)) return { ok: false, errors: ['Not authorized.'] };
  var doc = { processes: processes || [] };
  var errs = validateDoc(doc);
  if (errs.length) return { ok: false, errors: errs };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (e) { return { ok: false, errors: ['Someone else is saving right now — please try again in a moment.'] }; }
  try {
    dataSheet_().getRange(2, 1).setValue(JSON.stringify(doc, null, 2));
    historySheet_().appendRow([new Date(), (message || 'Update') + ' — ' + email]);
    notifyChat('*EDL Handbook* updated by ' + email + (message ? ': ' + message : ''));
    return { ok: true };
  } catch (err) { return { ok: false, errors: [String(err.message || err)] }; }
  finally { lock.releaseLock(); }
}
function notifyChat(text) {
  var url = cfg().chat; if (!url) return;
  try { UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ text: text }), muteHttpExceptions: true }); } catch (e) {}
}
function whoami() { return { email: currentEmail(), isMember: isMember(currentEmail()), group: cfg().group }; }
/** One-time: load the demo content so the review page isn't empty. Safe to re-run. */
function seedInitialData() {
  var sh = dataSheet_();
  if (sh.getRange(2, 1).getValue()) { Logger.log('Data already present — not overwriting.'); return; }
  var seed = {
  "processes": [
    {
      "process_id": "monthly-training-calendar",
      "title": "Monthly Training Calendar Process",
      "subtitle": "From collecting trainer schedules to publishing the finalized calendar.",
      "status": "live",
      "lanes": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "steps": [
        {
          "id": "start",
          "lane": "Intern",
          "type": "start",
          "label": "Start",
          "next": [
            "informStakeholders"
          ],
          "task": "",
          "timeline": "",
          "pic": "",
          "files": [],
          "note": "",
          "images": []
        },
        {
          "id": "informStakeholders",
          "lane": "Intern",
          "type": "action",
          "label": "Inform Stakeholders to propose training calendar for the next month",
          "next": [
            "inputOSKB",
            "informe",
            "discuss"
          ],
          "task": "Intern reaches out to TPM, EDL Leader and other departments (QA, HSE, Beverage, Cafe, etc.) asking them to propose their training / activity schedule for the upcoming month.",
          "timeline": "15th – 20th of each month",
          "pic": "Intern",
          "files": [],
          "note": "Priority order for finalizing the schedule: Mandatory Training > Training run by L&D > QA Training > Training from other departments.\n\nCheck carefully whether the room is available that day and book the room as early as possible.\n\nTips for booking QA training:\n\n - Try to input the schedule on the L&D Team's Google Calendar as early as possible.\n- Check the QA team's schedule and the target audience for existing/planned classes, then pick a suitable open date. Avoid Fridays and the first days of the month (1st–5th). Prefer training in the 2nd week of the month and testing in the 3rd week.",
          "workingDays": 2,
          "images": []
        },
        {
          "id": "discuss",
          "lane": "Stakeholders",
          "type": "action",
          "label": "Discuss & Inform training calendar",
          "next": [
            "collect"
          ],
          "task": "In response to the Intern's outreach, other departments (QA, HSE, Beverage, Cafe, etc.) share the extra context needed to complete the calendar — e.g. Cafe training / drink training schedules — and confirm details for the classes they run themselves.",
          "timeline": "15th – 20th of each month",
          "pic": "Other departments (QA, HSE, Beverage, Cafe…)",
          "files": [],
          "note": "",
          "stakeholderDetail": "QA, HSE, Beverage, Cafe, etc.",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "informe",
          "lane": "EDL",
          "type": "action",
          "label": "Inform e-learning launching",
          "next": [
            "collect"
          ],
          "task": "In response to the Intern's outreach, the EDL team shares information on any upcoming e-learning launch so it can be folded into the monthly calendar.",
          "timeline": "15th – 20th of each month",
          "pic": "EDL Leader",
          "files": [],
          "note": "",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "inputOSKB",
          "lane": "TPM",
          "type": "action",
          "label": "Input training calendar to OSKB",
          "next": [
            "collect"
          ],
          "task": "In response to the Intern's outreach, TPM & Trainers place the finalized class schedule directly on OSKB.",
          "timeline": "15th – 20th of each month",
          "pic": "Stakeholder (TPM, EDL, QA, HSE, Beverage Team and other departments…)",
          "files": [],
          "note": "",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "collect",
          "lane": "Intern",
          "type": "action",
          "label": "Collect training calendar from trainers",
          "next": [
            "inputcal"
          ],
          "task": "Confirming (1.1.2):\n\n - Food Safety Management class: QA finalizes the schedule based on L&D's suggestion in the group chat.\n- Classes run by L&D: TPM & Trainers fill in OSKB.\n- Classes run by other departments: confirmed via discussion.\n- E-learning info (if any): EDL team announces the finalized schedule.\n\n Confirmation message (1.1.3): send a message finalizing the schedule to the other L&D stakeholders.",
          "timeline": "Confirming: 15th–20th · Confirmation message: 21st–22nd",
          "pic": "1.1.2: Intern & stakeholders (TPM, EDL, QA, HSE, Beverage…) · 1.1.3: QA line — Intern, other classes — TPM",
          "files": [
            {
              "label": "2026 OSKB_Talent Development",
              "url": "https://example.com/doc/8215"
            }
          ],
          "note": "Consolidates the responses from TPM, EDL Leader and other departments above.",
          "workingDays": 3,
          "images": []
        },
        {
          "id": "inputcal",
          "lane": "Intern",
          "type": "action",
          "label": "Input calendar to L&D Google Calendar",
          "next": [
            "design",
            "draft"
          ],
          "task": "Input all finalized schedules into the L&D account's Google Calendar by filling in the automatic calendar-input file.",
          "timeline": "15th – 22nd of each month",
          "pic": "Intern",
          "files": [
            {
              "label": "ILT Timeline",
              "url": "https://example.com/doc/1720"
            }
          ],
          "note": "Do not delete rows — only fill in the blue header columns in the '1.1 ILT Details' sheet. Do not adjust the other sheets.",
          "workingDays": 2,
          "images": []
        },
        {
          "id": "design",
          "lane": "Intern",
          "type": "action",
          "label": "Design calendar on Canva",
          "next": [
            "reviewTPM"
          ],
          "task": "Pick a theme and finish the calendar design in Canva.",
          "timeline": "22nd – 24th of each month",
          "pic": "Intern",
          "files": [
            {
              "label": "File canva thiết kế",
              "url": "https://example.com/doc/1390"
            }
          ],
          "note": "Choose a theme and style with global appeal — not Vietnam-only.",
          "workingDays": 2,
          "images": [
            {
              "name": "Canva — start from last month’s template",
              "src": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzgwIiB2aWV3Qm94PSIwIDAgNjQwIDM4MCIgZm9udC1mYW1pbHk9IkFyaWFsLEhlbHZldGljYSxzYW5zLXNlcmlmIj4KPHJlY3Qgd2lkdGg9IjY0MCIgaGVpZ2h0PSIzODAiIGZpbGw9IiNGNEYyRUMiLz4KPHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjY0MCIgaGVpZ2h0PSI0NCIgZmlsbD0iIzAyNDk5RCIvPgo8Y2lyY2xlIGN4PSIyNCIgY3k9IjIyIiByPSI3IiBmaWxsPSIjOEREODhEIi8+PHRleHQgeD0iNDAiIHk9IjI3IiBmaWxsPSIjZmZmIiBmb250LXNpemU9IjE1IiBmb250LXdlaWdodD0iYm9sZCI+Q2FudmE8L3RleHQ+CjxyZWN0IHg9IjIwIiB5PSI2NCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSIyOTIiIHJ4PSI4IiBmaWxsPSIjZmZmIiBzdHJva2U9IiNFMkRERDIiLz4KPHRleHQgeD0iMzQiIHk9IjkwIiBmaWxsPSIjNkI2NjU2IiBmb250LXNpemU9IjEyIiBmb250LXdlaWdodD0iYm9sZCI+VE9PTFM8L3RleHQ+CjxyZWN0IHg9IjM0IiB5PSIxMDQiIHdpZHRoPSIxNTAiIGhlaWdodD0iMjYiIHJ4PSI1IiBmaWxsPSIjRUVGMkZCIi8+PHRleHQgeD0iNDQiIHk9IjEyMSIgZmlsbD0iIzAyNDk5RCIgZm9udC1zaXplPSIxMiI+VGVtcGxhdGVzPC90ZXh0Pgo8cmVjdCB4PSIzNCIgeT0iMTM4IiB3aWR0aD0iMTUwIiBoZWlnaHQ9IjI2IiByeD0iNSIgZmlsbD0iI0Y0RjJFQyIvPjx0ZXh0IHg9IjQ0IiB5PSIxNTUiIGZpbGw9IiM2QjY2NTYiIGZvbnQtc2l6ZT0iMTIiPkVsZW1lbnRzPC90ZXh0Pgo8cmVjdCB4PSIzNCIgeT0iMTcyIiB3aWR0aD0iMTUwIiBoZWlnaHQ9IjI2IiByeD0iNSIgZmlsbD0iI0Y0RjJFQyIvPjx0ZXh0IHg9IjQ0IiB5PSIxODkiIGZpbGw9IiM2QjY2NTYiIGZvbnQtc2l6ZT0iMTIiPlRleHQ8L3RleHQ+CjxyZWN0IHg9IjIyMCIgeT0iNjQiIHdpZHRoPSI0MDAiIGhlaWdodD0iMjkyIiByeD0iOCIgZmlsbD0iI2ZmZiIgc3Ryb2tlPSIjRTJEREQyIi8+CjxyZWN0IHg9IjI0NCIgeT0iODgiIHdpZHRoPSIzNTIiIGhlaWdodD0iMTQwIiByeD0iNiIgZmlsbD0iI0ZDRUZEOSIvPjx0ZXh0IHg9IjI2MCIgeT0iMTMwIiBmaWxsPSIjQkY2QjFGIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iYm9sZCI+TW9udGhseSBDYWxlbmRhcjwvdGV4dD4KPHRleHQgeD0iMjYwIiB5PSIxNTgiIGZpbGw9IiM4QTdDNjMiIGZvbnQtc2l6ZT0iMTIiPkRyYWcgYmxvY2tzIGhlcmUgdG8gYnVpbGQgdGhlIG1vbnRoJ3MgY2FsZW5kYXI8L3RleHQ+CjxyZWN0IHg9IjI0NCIgeT0iMjQ0IiB3aWR0aD0iMTY4IiBoZWlnaHQ9Ijg4IiByeD0iNiIgZmlsbD0iI0U4RjVFOSIvPjx0ZXh0IHg9IjI2MCIgeT0iMjg2IiBmaWxsPSIjMkE0NzI4IiBmb250LXNpemU9IjEzIiBmb250LXdlaWdodD0iYm9sZCI+V2VlayAxPC90ZXh0Pgo8cmVjdCB4PSI0MjgiIHk9IjI0NCIgd2lkdGg9IjE2OCIgaGVpZ2h0PSI4OCIgcng9IjYiIGZpbGw9IiNFRUYyRkIiLz48dGV4dCB4PSI0NDQiIHk9IjI4NiIgZmlsbD0iIzAyNDk5RCIgZm9udC1zaXplPSIxMyIgZm9udC13ZWlnaHQ9ImJvbGQiPldlZWsgMjwvdGV4dD4KPC9zdmc+"
            }
          ]
        },
        {
          "id": "draft",
          "lane": "Intern",
          "type": "action",
          "label": "Draft communication content (for email & group chat)",
          "next": [
            "reviewTPM"
          ],
          "task": "Check with the relevant L&D team members on what each course needs to highlight, then write communication copy that fits the design theme.",
          "timeline": "22nd – 24th of each month",
          "pic": "Intern",
          "files": [
            {
              "label": "References",
              "url": "https://example.com/doc/4774"
            },
            {
              "label": "File nhập nội dung truyền thông",
              "url": "https://example.com/doc/3379"
            }
          ],
          "note": "Keep the tone youthful and concise — not overly formal or saccharine — while still covering every important point. Keep the same format each month, but wording and theme are encouraged to be creative.",
          "workingDays": 2,
          "images": []
        },
        {
          "id": "reviewTPM",
          "lane": "TPM",
          "type": "decision",
          "label": "Review",
          "next": {
            "yes": "reviewEDL",
            "no": "inputcal"
          },
          "task": "Send the design + copy to the L&D Staff group so TPM & Trainers can review and give feedback.",
          "timeline": "24th – 26th of each month",
          "pic": "Intern → TPM & Trainer",
          "files": [],
          "note": "Reviewers comment directly in the docs file and in Canva.",
          "workingDays": 2,
          "images": []
        },
        {
          "id": "reviewEDL",
          "lane": "EDL",
          "type": "decision",
          "label": "Review",
          "next": {
            "yes": "reviewLD",
            "no": "inputcal"
          },
          "task": "Send the design to the L&D | EDL group for the EDL team to review and give feedback.",
          "timeline": "26th – 27th of each month",
          "pic": "Intern → EDL Leader",
          "files": [],
          "note": "Reviewers comment directly in the docs file and in Canva.",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "reviewLD",
          "lane": "L&D Head",
          "type": "decision",
          "label": "Review",
          "next": {
            "yes": "send",
            "no": "inputcal"
          },
          "task": "Send to the L&D Manager for final review before communication goes out.",
          "timeline": "27th – 29th of each month",
          "pic": "Intern → L&D Manager",
          "files": [],
          "note": "Reviewers comment directly in the docs file and in Canva.",
          "workingDays": 2,
          "images": []
        },
        {
          "id": "send",
          "lane": "Intern",
          "type": "action",
          "label": "Send communication via email & group chat",
          "next": [
            "update"
          ],
          "task": "Email (2.4.1) — sent using the 'Monthly Calendar' template from the L&D email:\n\nAnnual Training Calendar\n\n - To (Bcc): RMs (IPP, Pizza 4P's Vietnam & abroad) · ASM (Vietnam + abroad) · Hub Managers (Vietnam + abroad) · SRM (IPP, Pizza 4P's Vietnam & abroad) · AM (IPP, Pizza 4P's Vietnam & abroad) · Wow Center Functional Heads (Vietnam + abroad)\n- Cc: L&D team mailbox · Culture, HRD, Transformation, HRBP team · internal trainers (QA, HSE, Beverage, Cafe, etc.)\n\n Monthly Training Calendar\n\n - To: RMs (IPP, Pizza 4P's Vietnam & abroad) · Hub Managers (Vietnam + abroad)\n- Cc: ASM, SRM, AM (IPP, Pizza 4P's Vietnam & abroad) · named leadership & country-manager contacts · L&D team mailbox · CPO + assistant · Culture, HRD, Transformation, HRBP team · internal trainers by department (QA, HSE, Beverage, Cafe)\n\n Group chat (2.4.2) — send the message to:\n\n - Training x 4P's Vietnam Central & South\n- Training x 4P's Vietnam North\n- Training x 4P's India\n- Training x 4P's Cambodia\n- L&D x Vietnam Restaurant Management (ASM, Trial RM / Acting RM, RM)",
          "timeline": "27th – 31st of each month · latest by the 1st of the following month",
          "pic": "Intern",
          "files": [
            {
              "label": "'Monthly Calendar' email template",
              "url": "https://example.com/doc/5412"
            }
          ],
          "note": "Copy should read as a polished, email-appropriate version. If any training is happening abroad, also notify the relevant overseas AM/SRM/RM/ASM and training group. Send from the L&D account and note the sender's name below the message, e.g. \"Hà My | Learning & Development Team\".",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "update",
          "lane": "Intern",
          "type": "action",
          "label": "Update calendar on Ops site",
          "next": [
            "end"
          ],
          "task": "Update the content that was emailed onto the Ops Google Site, following the existing template.",
          "timeline": "",
          "pic": "Intern",
          "files": [
            {
              "label": "Monthly Training calendar Ops site",
              "url": "https://example.com/doc/3027"
            },
            {
              "label": "File Nội dung calendar publish Google site",
              "url": "https://example.com/doc/2773"
            }
          ],
          "note": "",
          "workingDays": 1,
          "images": []
        },
        {
          "id": "end",
          "lane": "Intern",
          "type": "end",
          "label": "End",
          "next": [],
          "task": "",
          "timeline": "",
          "pic": "",
          "files": [],
          "note": "",
          "images": []
        }
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "pillar": "logistics",
      "createdBy": "learning@pizza4ps.com",
      "kind": "process",
      "pic": "phuong.ntl@pizza4ps.com",
      "updatedAt": "2026-08-20",
      "updatedBy": "phuong.ntl@pizza4ps.com",
      "reviewer": "",
      "review": "none"
    },
    {
      "process_id": "prize-cambodia",
      "title": "Prize Sending (Partners — Cambodia)",
      "subtitle": "Coordinating and shipping partner prizes to Cambodia.",
      "status": "draft",
      "lanes": [
        "Intern",
        "TPM"
      ],
      "steps": [
        {
          "id": "start",
          "label": "Start",
          "lane": "Intern",
          "type": "start",
          "next": [
            "receive"
          ],
          "task": "",
          "timeline": "",
          "pic": "",
          "files": [],
          "note": "",
          "images": []
        },
        {
          "id": "receive",
          "label": "Receive partner prize list",
          "lane": "TPM",
          "type": "action",
          "next": [
            "end"
          ],
          "task": "Partner team sends the confirmed list of prize recipients.",
          "timeline": "1st – 3rd of each month",
          "pic": "TPM",
          "files": [
            {
              "label": "Partner prize list",
              "url": "https://example.com/doc/7138"
            }
          ],
          "note": "",
          "images": []
        },
        {
          "id": "end",
          "label": "End",
          "lane": "Intern",
          "type": "end",
          "next": [],
          "task": "",
          "timeline": "",
          "pic": "",
          "files": [],
          "note": "",
          "images": []
        }
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "pillar": "logistics",
      "createdBy": "learning@pizza4ps.com",
      "kind": "process",
      "pic": "hoa.doan@pizza4ps.com",
      "updatedAt": "2026-08-14",
      "updatedBy": "hoa.doan@pizza4ps.com",
      "reviewer": "",
      "review": "none"
    },
    {
      "process_id": "align-file-storage",
      "title": "Shared Drive Folder Structure",
      "subtitle": "Where each kind of logistics file lives on the shared drive.",
      "status": "live",
      "pillar": "logistics",
      "kind": "alignment",
      "pic": "hamy.nguyen@pizza4ps.com",
      "updatedAt": "2026-07-30",
      "updatedBy": "hamy.nguyen@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "body": "<p>Nơi lưu từng loại file logistics trên shared drive, để cả team tìm nhanh và không tạo bản trùng.</p>\n<h3>Cấu trúc thư mục</h3>\n<ul>\n<li><strong>/01 Templates</strong> — email template, calendar template, file nhập nội dung.</li>\n<li><strong>/02 Monthly Calendars</strong> — theo năm → theo tháng.</li>\n<li><strong>/03 Canva Exports</strong> — file thiết kế đã xuất PNG/PDF.</li>\n<li><strong>/04 Reports</strong> — báo cáo cuối khóa, KPI.</li>\n</ul>\n<h3>Nguyên tắc</h3>\n<ul>\n<li>Đặt tên file theo <code>YYYY-MM - Tên</code>.</li>\n<li>Không xóa file cũ — chuyển vào <strong>/99 Archive</strong>.</li>\n</ul>"
    },
    {
      "process_id": "new-hire-elearning",
      "title": "New Hire E-Learning Setup",
      "subtitle": "Setting up e-learning accounts and paths for new hires.",
      "status": "draft",
      "pillar": "elearning",
      "kind": "process",
      "pic": "lnd.edl@pizza4ps.com",
      "updatedAt": "2026-08-25",
      "updatedBy": "lnd.edl@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "lanes": [
        "Intern",
        "EDL"
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "steps": [
        {
          "id": "start",
          "label": "Start",
          "lane": "Intern",
          "type": "start",
          "next": [
            "prep"
          ],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "prep",
          "label": "Prepare materials & learner list",
          "lane": "Intern",
          "type": "action",
          "next": [
            "deliver"
          ],
          "task": "Gather the learner list and prepare the session materials.",
          "timeline": "1st week",
          "workingDays": 2,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "deliver",
          "label": "Deliver session & record on LMS",
          "lane": "EDL",
          "type": "action",
          "next": [
            "end"
          ],
          "task": "Run the ILT session and record attendance/results on the LMS.",
          "timeline": "2nd week",
          "workingDays": 1,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "end",
          "label": "End",
          "lane": "Intern",
          "type": "end",
          "next": [],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        }
      ]
    },
    {
      "process_id": "align-course-naming",
      "title": "Course Naming Convention",
      "subtitle": "The agreed way every e-learning course is named, so nothing gets lost.",
      "status": "live",
      "pillar": "elearning",
      "kind": "alignment",
      "pic": "lnd.edl@pizza4ps.com",
      "updatedAt": "2026-06-18",
      "updatedBy": "lnd.edl@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "body": "<p>Một quy ước đặt tên thống nhất giúp mọi khóa e-learning dễ tìm, dễ lọc và không bị trùng lặp trên LMS.</p>\n<h3>Định dạng</h3>\n<p><code>[Pillar] - [Audience] - [Topic]</code></p>\n<ul>\n<li><strong>Pillar:</strong> E (E-learning), D (Data), L (Logistics), T (Training)</li>\n<li><strong>Audience:</strong> New Hire, RM, ASM, All Staff…</li>\n<li><strong>Topic:</strong> ngắn gọn, không dấu</li>\n</ul>\n<h3>Ví dụ</h3>\n<ul>\n<li><strong>E - New Hire - Food Safety</strong></li>\n<li><strong>T - RM - Leadership Foundation</strong></li>\n</ul>\n<h3>Lưu ý</h3>\n<ul>\n<li>Không dùng ký tự đặc biệt ngoài dấu gạch nối.</li>\n<li>Giữ nguyên thứ tự 3 phần để LMS lọc theo cột chuẩn.</li>\n</ul>"
    },
    {
      "process_id": "monthly-data-report",
      "title": "Monthly Data Report",
      "subtitle": "Compiling the monthly L&D data report.",
      "status": "draft",
      "pillar": "data",
      "kind": "process",
      "pic": "lnd.edl@pizza4ps.com",
      "updatedAt": "2026-08-28",
      "updatedBy": "lnd.edl@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "lanes": [
        "Intern",
        "EDL"
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "steps": [
        {
          "id": "start",
          "label": "Start",
          "lane": "Intern",
          "type": "start",
          "next": [
            "prep"
          ],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "prep",
          "label": "Prepare materials & learner list",
          "lane": "Intern",
          "type": "action",
          "next": [
            "deliver"
          ],
          "task": "Gather the learner list and prepare the session materials.",
          "timeline": "1st week",
          "workingDays": 2,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "deliver",
          "label": "Deliver session & record on LMS",
          "lane": "EDL",
          "type": "action",
          "next": [
            "end"
          ],
          "task": "Run the ILT session and record attendance/results on the LMS.",
          "timeline": "2nd week",
          "workingDays": 1,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "end",
          "label": "End",
          "lane": "Intern",
          "type": "end",
          "next": [],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        }
      ]
    },
    {
      "process_id": "lms-data-mgmt",
      "title": "LMS Data Management Responsibility Guidelines",
      "subtitle": "Who owns which LMS data — EDL builds the backbone, program owners own their ILT data.",
      "status": "live",
      "pillar": "data",
      "kind": "alignment",
      "pic": "lnd.edl@pizza4ps.com",
      "updatedAt": "2026-09-02",
      "updatedBy": "lnd.edl@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "body": "<p>Hệ thống LMS của chúng ta đang ngày càng mở rộng với lượng dữ liệu rất lớn (LMS đã chạm ngưỡng <strong>5000 users</strong> vào tháng 9 này). EDL hiện đảm nhận khối lượng công việc khá nặng về data LMS (3 hệ thống khóa học cho 3 Career Pathway: nhà hàng VN–Cambodia và Hub), xử lý master data từ BIPO và các skill report hằng tháng.</p>\n<p>Vì vậy, định hướng quản lý data LMS được phân rõ vai trò như sau:</p>\n<ul>\n<li><strong>EDL (Admin của LMS):</strong> xây dựng hạ tầng, chuẩn hóa dữ liệu &amp; set up nguyên tắc vận hành chung cho LMS.</li>\n<li><strong>Owner của từng chương trình ILT (Instructors trên LMS):</strong> chủ động quản lý 100% dữ liệu người học và nội dung cho chương trình ILT của mình.</li>\n</ul>\n<h3>❤️‍🔥 A. Owner chương trình được định nghĩa như thế nào?</h3>\n<p>Owner chương trình bao gồm 2 mảng:</p>\n<ul>\n<li><strong>Owner content:</strong> chịu trách nhiệm design nội dung, cập nhật và đảm bảo mọi document được update consistent từ outline → slide → e-learning → test. CONSISTENCY IS KEY!</li>\n<li><strong>Owner tổ chức:</strong> chịu trách nhiệm tổ chức lớp học từ enrollment trên LMS, thông báo, logistics… đến report cuối khóa (feedback, KPI…).</li>\n</ul>\n<h4>Phân chia cụ thể</h4>\n<p>Owner content:</p>\n<ul>\n<li><strong>Phương</strong> (Nguyen Thi Lan Phuong — TPM): LPFM, LPFL, TTT, 4Ps Values</li>\n<li><strong>Hoa</strong> (Doan Thi Dieu Hoa — TPM): Wow Service 5 modules, SOPs</li>\n</ul>\n<p>Owner tổ chức:</p>\n<ul>\n<li>LPFM, 4Ps Values: <strong>Phương</strong></li>\n<li>LPFL, TTT: <strong>Hoa</strong></li>\n<li>Wow Service: <strong>Thành</strong> (Bui Cong Thanh — Talent Development Trainer)</li>\n</ul>\n<p>Vai trò của intern 🐥: support logistics &amp; data tất cả chương trình ILT theo chỉ định của Phương.</p>\n<h3>🤝 B. Phân công cụ thể về quản lý data trên LMS</h3>\n<h4>1. EDL Team (Admin LMS)</h4>\n<ul>\n<li><strong>LMS User Management:</strong> khởi tạo user mới, deactivate user nghỉ việc, cập nhật user (profile, Group/Branch, role), soạn tài liệu hướng dẫn &amp; đào tạo LMS.</li>\n<li><strong>Career Pathway &amp; E-learning:</strong> quản lý E-learning + theory test (set up hệ thống), setup learning paths, xuất báo cáo E-learning, quản lý data Skill Report, hỗ trợ learners + managers.</li>\n</ul>\n<h4>2. Training Team (Instructor các khóa ILT)</h4>\n<p>Owner tổ chức của khóa nào trực tiếp quản lý dữ liệu người học trên LMS cho khóa đó.</p>\n<p><strong>a) Food Safety Management</strong> (EDL phân công PIC chính mỗi tháng):</p>\n<ul>\n<li>Danh sách người học (Nhà hàng + Hub): EDL setup source data hằng tháng, intern lọc DS gửi QA.</li>\n<li>LMS enrollment: tự động bởi hệ thống.</li>\n<li>Nội dung: QA + EDL.</li>\n<li>Giảng dạy &amp; ghi nhận ILT + test: QA (intern support, EDL backup).</li>\n</ul>\n<p><strong>b) Wow Service:</strong></p>\n<ul>\n<li>DS người học: Thành (trích Skill Report).</li>\n<li>LMS enrollment: tự động.</li>\n<li>Giảng dạy &amp; ghi nhận ILT: Thành + Vy.</li>\n<li>Cập nhật nội dung: Hòa.</li>\n</ul>\n<p><strong>c) Train the Trainer:</strong></p>\n<ul>\n<li>DS người học: Hòa.</li>\n<li>LMS enrollment: tự động.</li>\n<li>Giảng dạy &amp; cập nhật ILT: Hòa + Phương.</li>\n<li>Nội dung: Phương.</li>\n</ul>\n<p><strong>d) Leadership (LPFL &amp; LPFM):</strong></p>\n<p>Dữ liệu nguồn EDL đã tạo: <a href=\"https://docs.google.com/spreadsheets/d/12IhFO1EHB-sooHJh-MsiVaswQXEMvsIIeKl3m5YyOlM/edit\" target=\"_blank\" rel=\"noopener\">List of Talent Pipeline 2026</a></p>\n<ul>\n<li><strong>LPFL</strong> — DS &amp; enrollment: Hòa (ngày 11 hằng tháng, sheet <code>For LPFL</code>, cột G). Giảng dạy &amp; ILT: Hòa + Phương. Nội dung: Phương.</li>\n<li><strong>LPFM</strong> — DS &amp; enrollment: Phương (ngày 11 hằng tháng, sheet <code>LPFM</code>, cột G). Giảng dạy &amp; ILT: Hòa + Phương. Nội dung: Phương.</li>\n</ul>\n<h3>🌟 Kết luận</h3>\n<p>EDL Team tập trung xây &amp; giữ \"xương sống\" dữ liệu cho LMS; Training Team làm chủ dữ liệu các chương trình ILT do mình Owner tổ chức từ đầu đến cuối. Giai đoạn đầu, nếu Owner tổ chức cần hỗ trợ LMS, EDL hướng dẫn kỹ &amp; thống nhất quy trình để dữ liệu được chuẩn hóa.</p>"
    },
    {
      "process_id": "train-the-trainer",
      "title": "Train the Trainer",
      "subtitle": "Running the Train-the-Trainer program end to end.",
      "status": "live",
      "pillar": "training",
      "kind": "process",
      "pic": "hoa.doan@pizza4ps.com",
      "updatedAt": "2026-08-10",
      "updatedBy": "hoa.doan@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "lanes": [
        "TPM",
        "L&D Head"
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "steps": [
        {
          "id": "start",
          "label": "Start",
          "lane": "TPM",
          "type": "start",
          "next": [
            "prep"
          ],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "prep",
          "label": "Prepare materials & learner list",
          "lane": "TPM",
          "type": "action",
          "next": [
            "deliver"
          ],
          "task": "Gather the learner list and prepare the session materials.",
          "timeline": "1st week",
          "workingDays": 2,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "deliver",
          "label": "Deliver session & record on LMS",
          "lane": "L&D Head",
          "type": "action",
          "next": [
            "end"
          ],
          "task": "Run the ILT session and record attendance/results on the LMS.",
          "timeline": "2nd week",
          "workingDays": 1,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "end",
          "label": "End",
          "lane": "TPM",
          "type": "end",
          "next": [],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        }
      ]
    },
    {
      "process_id": "food-safety-mgmt",
      "title": "Food Safety Management",
      "subtitle": "Monthly food-safety training coordination with QA.",
      "status": "draft",
      "pillar": "training",
      "kind": "process",
      "pic": "phuong.ntl@pizza4ps.com",
      "updatedAt": "2026-08-27",
      "updatedBy": "phuong.ntl@pizza4ps.com",
      "reviewer": "",
      "review": "none",
      "createdBy": "learning@pizza4ps.com",
      "lanes": [
        "Intern",
        "TPM"
      ],
      "owners": [
        "TPM",
        "Intern",
        "EDL",
        "L&D Head",
        "Stakeholders"
      ],
      "steps": [
        {
          "id": "start",
          "label": "Start",
          "lane": "Intern",
          "type": "start",
          "next": [
            "prep"
          ],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "prep",
          "label": "Prepare materials & learner list",
          "lane": "Intern",
          "type": "action",
          "next": [
            "deliver"
          ],
          "task": "Gather the learner list and prepare the session materials.",
          "timeline": "1st week",
          "workingDays": 2,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "deliver",
          "label": "Deliver session & record on LMS",
          "lane": "TPM",
          "type": "action",
          "next": [
            "end"
          ],
          "task": "Run the ILT session and record attendance/results on the LMS.",
          "timeline": "2nd week",
          "workingDays": 1,
          "files": [],
          "images": [],
          "note": ""
        },
        {
          "id": "end",
          "label": "End",
          "lane": "Intern",
          "type": "end",
          "next": [],
          "task": "",
          "timeline": "",
          "files": [],
          "images": [],
          "note": ""
        }
      ]
    }
  ]
};
  sh.getRange(2, 1).setValue(JSON.stringify(seed, null, 2));
  Logger.log('Seed data written. Reload the web app.');
}
