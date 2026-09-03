/**
 * EDL Internal Handbook — Apps Script backend
 *
 * Serves the combined Editor + Website page to members of a Google Group,
 * and stores all content in a Google Sheet. Nothing here is reachable
 * without a Workspace login, and every request is checked against the
 * group below — so both the editor AND the public-facing pages only
 * render for people who belong to it.
 *
 * Script properties to set (Project Settings -> Script properties):
 *   SHEET_ID       the ID of the Google Sheet used as the datastore
 *                  (the long id in its URL, between /d/ and /edit)
 *   EDITOR_GROUP   learning@pizza4ps.com
 *   EXTRA_EDITORS  optional, comma-separated emails allowed on top of the group
 *
 * The sheet needs no manual setup beyond existing — this script creates
 * the "Data" and "History" tabs itself the first time it runs.
 */

var P = PropertiesService.getScriptProperties();
function prop(k, d) { var v = P.getProperty(k); return (v === null || v === '') ? d : v; }

function cfg() {
  return {
    sheetId: prop('SHEET_ID', ''),
    group: prop('EDITOR_GROUP', 'learning@pizza4ps.com'),
    extra: prop('EXTRA_EDITORS', '')
  };
}

/* ---------------------------------------------------------------- access */

function currentEmail() {
  /* Apps Script gives us the signed-in Workspace identity; the browser
     cannot spoof this, so it is the entire authentication story — both
     for opening the editor and for viewing the site. */
  return (Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isMember(email) {
  if (!email) return false;
  var c = cfg();
  var extra = c.extra.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (extra.indexOf(email) >= 0) return true;
  try {
    /* Membership is read live — add someone to the group and they're in
       immediately, no redeploy needed. */
    return GroupsApp.getGroupByEmail(c.group).hasUser(email);
  } catch (err) {
    return false;
  }
}

/* ------------------------------------------------------------------- UI */

function doGet(e) {
  var email = currentEmail();
  if (!isMember(email)) {
    return HtmlService.createHtmlOutput(
      '<div style="font:15px/1.6 Arial;padding:44px;max-width:560px;margin:auto;color:#24264A">' +
      '<h2 style="margin:0 0 10px">No access</h2>' +
      '<p>You are signed in as <b>' + (email || 'an unknown account') + '</b>.</p>' +
      '<p>The EDL Internal Handbook — both editing and viewing — is limited to members of ' +
      '<b>' + cfg().group + '</b>. Ask the L&amp;D team to add you to that group, then reload this page.</p></div>'
    ).setTitle('No access');
  }
  var t = HtmlService.createTemplateFromFile('Editor');
  t.userEmail = email;
  return t.evaluate()
    .setTitle('EDL Internal Handbook')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ---------------------------------------------------------------- sheet */

function sheetFile_() {
  var c = cfg();
  if (!c.sheetId) throw new Error('SHEET_ID is not set in the script properties.');
  return SpreadsheetApp.openById(c.sheetId);
}

/** The current document lives as one JSON blob in Data!A2. This tab is
 *  internal storage for the app, not something anyone needs to read —
 *  the editor is where the content is actually viewed and edited. */
function dataSheet_() {
  var ss = sheetFile_();
  var sh = ss.getSheetByName('Data');
  if (!sh) {
    sh = ss.insertSheet('Data');
    sh.getRange(1, 1).setValue('⚠ System data — do not edit by hand. Use the Handbook editor instead.');
    sh.getRange(2, 1).setValue('');
  }
  return sh;
}

/** Every publish appends one human-readable row here: when it happened
 *  and what the person typed as their change summary. This is the plain
 *  changelog anyone can open and understand — it does not store the raw
 *  JSON (that lives only in the Data tab, for the app to read back). */
function historySheet_() {
  var ss = sheetFile_();
  var sh = ss.getSheetByName('History');
  if (!sh) {
    sh = ss.insertSheet('History');
    sh.appendRow(['Date change', 'Change detail']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Current published data — the page always starts from what is live. */
function loadData() {
  var email = currentEmail();
  if (!isMember(email)) throw new Error('Not authorized.');
  try {
    var raw = dataSheet_().getRange(2, 1).getValue();
    var data = raw ? JSON.parse(raw) : null;
    return { ok: true, data: data, userEmail: email };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Server-side re-check of the same rules the browser enforces. */
function validateDoc(doc) {
  var errs = [];
  if (!doc || !doc.processes || !doc.processes.length) return ['There is nothing to publish.'];
  doc.processes.forEach(function (p) {
    var ids = {}; (p.steps || []).forEach(function (s) { ids[s.id] = 1; });
    if (!p.process_id) errs.push('A process has no id.');
    if (!p.pillar) errs.push('"' + (p.title || p.process_id) + '" has no pillar assigned.');
    var starts = (p.steps || []).filter(function (s) { return s.type === 'start'; });
    var ends = (p.steps || []).filter(function (s) { return s.type === 'end'; });
    if (starts.length !== 1) errs.push('"' + (p.title || p.process_id) + '" must have exactly one Start step.');
    if (ends.length !== 1) errs.push('"' + (p.title || p.process_id) + '" must have exactly one End step.');
    (p.steps || []).forEach(function (s) {
      var t = [];
      if (s.type === 'decision') { if (s.next) { if (s.next.yes) t.push(s.next.yes); if (s.next.no) t.push(s.next.no); } }
      else if (s.type !== 'end') t = s.next || [];
      t.forEach(function (x) {
        if (!ids[x]) errs.push('Step "' + s.label + '" points to a step that does not exist.');
      });
      if (!s.label) errs.push('A step in "' + (p.title || p.process_id) + '" has no name.');
      if (!s.lane) errs.push('Step "' + (s.label || s.id) + '" has nobody assigned to it.');
    });
  });
  return errs;
}

/**
 * Writes the data straight to the Sheet and logs the change to History.
 * There is no review step in this build — publish goes live immediately
 * (deliberately deferred, per the earlier decision to hold off on an
 * approval workflow until the design settles).
 */
function publish(doc, message) {
  var email = currentEmail();
  if (!isMember(email)) return { ok: false, errors: ['Not authorized.'] };
  var errs = validateDoc(doc);
  if (errs.length) return { ok: false, errors: errs };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, errors: ['Someone else is publishing right now — please try again in a moment.'] };
  }
  try {
    var json = JSON.stringify(doc, null, 2);
    dataSheet_().getRange(2, 1).setValue(json);
    var detail = (message || 'Update handbook content') + ' — ' + email;
    historySheet_().appendRow([new Date(), detail]);
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [String(err.message || err)] };
  } finally {
    lock.releaseLock();
  }
}

function whoami() { return { email: currentEmail(), isMember: isMember(currentEmail()), group: cfg().group }; }

/**
 * One-time setup helper. Run this once from the Apps Script editor
 * (select "seedInitialData" in the function dropdown, click Run) right
 * after setting SHEET_ID, to load the real Monthly Training Calendar
 * content plus the Prize Sending placeholder. Safe to run more than
 * once — it refuses to overwrite data that's already there.
 */
function seedInitialData() {
  var sh = dataSheet_();
  var existing = sh.getRange(2, 1).getValue();
  if (existing) { Logger.log('Data already present — not overwriting. Clear A2 first if you really want to reseed.'); return; }
  var seed = {
    "processes": [
      {
        "process_id": "monthly-training-calendar",
        "title": "Monthly Training Calendar Process",
        "subtitle": "From collecting trainer schedules to publishing the finalized calendar.",
        "status": "live",
        "pillar": "logistics",
        "createdBy": "learning@pizza4ps.com",
        "lanes": ["TPM", "Intern", "EDL", "L&D Head", "Stakeholders"],
        "owners": ["TPM", "Intern", "EDL", "L&D Head", "Stakeholders"],
        "steps": [
          {"id":"start","label":"Start","lane":"Intern","type":"start","next":["informStakeholders"],"task":"","timeline":"","files":[],"note":""},
          {"id":"informStakeholders","label":"Inform Stakeholders to propose training calendar for the next month","lane":"Intern","type":"action","next":["inputOSKB","informe","discuss"],"task":"Intern reaches out to TPM, EDL Leader and other departments (QA, HSE, Beverage, Cafe, etc.) asking them to propose their training / activity schedule for the upcoming month.","timeline":"15th – 20th of each month","workingDays":2,"files":[],"note":"Priority order for finalizing the schedule: Mandatory Training > Training run by L&D > QA Training > Training from other departments."},
          {"id":"discuss","label":"Discuss & Inform training calendar","lane":"Stakeholders","type":"action","next":["collect"],"task":"In response to the Intern's outreach, other departments (QA, HSE, Beverage, Cafe, etc.) share the extra context needed to complete the calendar.","timeline":"15th – 20th of each month","workingDays":1,"files":[],"note":"","stakeholderDetail":"QA, HSE, Beverage, Cafe, etc."},
          {"id":"informe","label":"Inform e-learning launching","lane":"EDL","type":"action","next":["collect"],"task":"In response to the Intern's outreach, the EDL team shares information on any upcoming e-learning launch so it can be folded into the monthly calendar.","timeline":"15th – 20th of each month","workingDays":1,"files":[],"note":""},
          {"id":"inputOSKB","label":"Input training calendar to OSKB","lane":"TPM","type":"action","next":["collect"],"task":"In response to the Intern's outreach, TPM & Trainers place the finalized class schedule directly on OSKB.","timeline":"15th – 20th of each month","workingDays":1,"files":[],"note":""},
          {"id":"collect","label":"Collect training calendar from trainers","lane":"Intern","type":"action","next":["inputcal"],"task":"Confirming (1.1.2):\n- Food Safety Management class: QA finalizes the schedule based on L&D's suggestion in the group chat.\n- Classes run by L&D: TPM & Trainers fill in OSKB.\n- Classes run by other departments: confirmed via discussion.\n- E-learning info (if any): EDL team announces the finalized schedule.\n\nConfirmation message (1.1.3): send a message finalizing the schedule to the other L&D stakeholders.","timeline":"Confirming: 15th–20th · Confirmation message: 21st–22nd","workingDays":3,"files":[{"label":"2026 OSKB_Talent Development","url":""}],"note":"Consolidates the responses from TPM, EDL Leader and other departments above."},
          {"id":"inputcal","label":"Input calendar to L&D Google Calendar","lane":"Intern","type":"action","next":["design","draft"],"task":"Input all finalized schedules into the L&D account's Google Calendar by filling in the automatic calendar-input file.","timeline":"15th – 22nd of each month","workingDays":2,"files":[{"label":"ILT Timeline","url":""}],"note":"Do not delete rows — only fill in the blue header columns in the '1.1 ILT Details' sheet. Do not adjust the other sheets."},
          {"id":"design","label":"Design calendar on Canva","lane":"Intern","type":"action","next":["reviewTPM"],"task":"Pick a theme and finish the calendar design in Canva.","timeline":"22nd – 24th of each month","workingDays":2,"files":[{"label":"File canva thiết kế","url":""}],"note":"Choose a theme and style with global appeal — not Vietnam-only."},
          {"id":"draft","label":"Draft communication content (for email & group chat)","lane":"Intern","type":"action","next":["reviewTPM"],"task":"Check with the relevant L&D team members on what each course needs to highlight, then write communication copy that fits the design theme.","timeline":"22nd – 24th of each month","workingDays":2,"files":[{"label":"References","url":""},{"label":"File nhập nội dung truyền thông","url":""}],"note":"Keep the tone youthful and concise — not overly formal — while still covering every important point."},
          {"id":"reviewTPM","label":"Review","lane":"TPM","type":"decision","next":{"yes":"reviewEDL","no":"inputcal"},"task":"Send the design + copy to the L&D Staff group so TPM & Trainers can review and give feedback.","timeline":"24th – 26th of each month","workingDays":2,"files":[],"note":"Reviewers comment directly in the docs file and in Canva."},
          {"id":"reviewEDL","label":"Review","lane":"EDL","type":"decision","next":{"yes":"reviewLD","no":"inputcal"},"task":"Send the design to the L&D | EDL group for the EDL team to review and give feedback.","timeline":"26th – 27th of each month","workingDays":1,"files":[],"note":"Reviewers comment directly in the docs file and in Canva."},
          {"id":"reviewLD","label":"Review","lane":"L&D Head","type":"decision","next":{"yes":"send","no":"inputcal"},"task":"Send to the L&D Manager for final review before communication goes out.","timeline":"27th – 29th of each month","workingDays":2,"files":[],"note":"Reviewers comment directly in the docs file and in Canva."},
          {"id":"send","label":"Send communication via email & group chat","lane":"Intern","type":"action","next":["update"],"task":"Send the finalized calendar by email using the 'Monthly Calendar' template, and post it to the group chats.","timeline":"27th – 31st of each month · latest by the 1st of the following month","workingDays":1,"files":[{"label":"'Monthly Calendar' email template","url":""}],"note":"If any training is happening abroad, also notify the relevant overseas AM/SRM/RM/ASM."},
          {"id":"update","label":"Update calendar on Ops site","lane":"Intern","type":"action","next":["end"],"task":"Update the content that was emailed onto the Ops Google Site, following the existing template.","timeline":"","workingDays":1,"files":[{"label":"Monthly Training calendar Ops site","url":""},{"label":"File Nội dung calendar publish Google site","url":""}],"note":""},
          {"id":"end","label":"End","lane":"Intern","type":"end","next":[],"task":"","timeline":"","files":[],"note":""}
        ]
      },
      {
        "process_id": "prize-cambodia",
        "title": "Prize Sending (Partners — Cambodia)",
        "subtitle": "Process for coordinating and shipping partner prizes to Cambodia.",
        "status": "coming-soon",
        "pillar": "logistics",
        "createdBy": "learning@pizza4ps.com",
        "lanes": ["Intern"],
        "owners": ["TPM", "Intern", "EDL", "L&D Head", "Stakeholders"],
        "steps": [
          {"id":"start","label":"Start","lane":"Intern","type":"start","next":["end"],"task":"","timeline":"","files":[],"note":""},
          {"id":"end","label":"End","lane":"Intern","type":"end","next":[],"task":"","timeline":"","files":[],"note":""}
        ]
      }
    ]
  };
  sh.getRange(2, 1).setValue(JSON.stringify(seed, null, 2));
  Logger.log('Seed data written. Reload the web app to see it.');
}
