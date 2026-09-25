/**
 * L&D Playbook — Apps Script mailer (Google Chat + email)
 * ------------------------------------------------------------------
 * The web app receives POSTs from the Playbook and:
 *   - event "approval"  → emails the reviewer (CC the L&D group) + posts a Chat card
 *   - event "published" → posts a Chat card + emails the publish group
 *
 * DEPLOY (do this every time you change the code):
 *   1. Paste this whole file into the Apps Script project (script.google.com).
 *   2. Set SHARED_SECRET below to the SAME value as Supabase app_config.mailer_secret.
 *   3. Set CHAT_WEBHOOK to your Google Chat space incoming-webhook URL.
 *   4. Deploy ▸ Manage deployments ▸ (edit the Web app) ▸ Version: New version ▸ Deploy.
 *      Execute as: Me   ·   Who has access: Anyone
 *   5. The /exec URL must equal Supabase app_config.mailer_url.
 *
 * The client posts JSON as text/plain, no-cors, so no response is read — this
 * script just needs to accept the POST and do the work.
 */

var SHARED_SECRET   = 'PUT-THE-SAME-SECRET-AS-app_config.mailer_secret';
var CHAT_WEBHOOK    = 'PUT-YOUR-GOOGLE-CHAT-INCOMING-WEBHOOK-URL';   // Space ▸ Apps & integrations ▸ Webhooks
var CC_APPROVAL     = 'lnd.edl@pizza4ps.com';   // CC on approval emails ('' to disable)
var SENDER_NAME     = 'L&D Playbook';
var ALLOWED_DOMAINS = ['pizza4ps.com'];         // only send email to addresses on these domains

function doGet() { return _json({ ok: true, service: 'ld-playbook-mailer' }); }   // health check

function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
    if (!SHARED_SECRET || body.secret !== SHARED_SECRET) return _json({ ok: false, error: 'bad secret' });
    if (body.event === 'approval')  return _handleApproval(body);
    if (body.event === 'published') return _handlePublished(body);
    return _json({ ok: false, error: 'unknown event' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _handleApproval(b) {
  var to = b.to || '';
  if (_emailAllowed(to)) {
    var html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#24264A">' +
      '<p>Hi ' + _esc(b.reviewerName || to) + ',</p>' +
      '<p><b>' + _esc(b.senderName || b.senderEmail || 'Someone') + '</b> submitted a ' +
        _esc(b.type || 'document') + ' for your approval:</p>' +
      _table([['Title', b.title], ['Pillar', b.pillar], ['Type', b.type], ['PIC', b.pic],
              ['Submitted by', _who(b.senderName, b.senderEmail)], ['Submitted at', b.submittedAt]]) +
      _button(b.link, 'Open the document to review', '#02499D') +
      '<p style="color:#7A8199;font-size:12px">You can Approve, Approve &amp; publish, ' +
        'or Request changes right on the document.</p></div>';
    var msg = { to: to, subject: '[L&D Playbook] Approval needed: ' + (b.title || '(no title)'),
                htmlBody: html, name: SENDER_NAME };
    if (CC_APPROVAL && _emailAllowed(CC_APPROVAL)) msg.cc = CC_APPROVAL;
    MailApp.sendEmail(msg);
  }
  _postChat(_card('⏳ Waiting for approval', b, b.submittedAt, _who(b.senderName, b.senderEmail), 'Submitted by'));
  return _json({ ok: true });
}

function _handlePublished(b) {
  var group = b.group || '';
  if (_emailAllowed(group)) {
    var html =
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#24264A">' +
      '<p>A ' + _esc(b.type || 'document') + ' was just published on the L&amp;D Playbook:</p>' +
      _table([['Title', b.title], ['Pillar', b.pillar], ['Type', b.type], ['PIC', b.pic],
              ['Published by', _who(b.publisherName, b.publisherEmail)], ['Published at', b.publishedAt]]) +
      _button(b.link, 'Open the document', '#2A4728') + '</div>';
    MailApp.sendEmail({ to: group, subject: '[L&D Playbook] Published: ' + (b.title || '(no title)'),
                        htmlBody: html, name: SENDER_NAME });
  }
  _postChat(_card('📣 Published', b, b.publishedAt, _who(b.publisherName, b.publisherEmail), 'Published by'));
  return _json({ ok: true });
}

/* ---- Google Chat card (cardsV2) ---- */
function _card(statusText, b, whenText, who, whoLabel) {
  var widgets = [
    { decoratedText: { topLabel: 'Title',   text: _esc(b.title || '') } },
    { decoratedText: { topLabel: 'Status',  text: _esc(statusText) } },
    { decoratedText: { topLabel: 'Pillar',  text: _esc((b.pillar || '') + ' - ' + (b.type || '')) } },
    { decoratedText: { topLabel: whoLabel,  text: _esc(who || '') } },
    { decoratedText: { topLabel: 'Time',    text: _esc(whenText || '') } }
  ];
  if (b.link) widgets.push({ buttonList: { buttons: [{ text: 'Open the document', onClick: { openLink: { url: b.link } } }] } });
  return { cardsV2: [{ cardId: 'ld-' + Date.now(),
    card: { header: { title: 'L&D Playbook', subtitle: statusText }, sections: [{ widgets: widgets }] } }] };
}
function _postChat(payload) {
  if (!CHAT_WEBHOOK || CHAT_WEBHOOK.indexOf('http') !== 0) return;
  try {
    UrlFetchApp.fetch(CHAT_WEBHOOK, { method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true });
  } catch (err) {}
}

/* ---- helpers ---- */
function _emailAllowed(addr) {
  addr = String(addr || '').toLowerCase();
  for (var i = 0; i < ALLOWED_DOMAINS.length; i++) { if (addr.indexOf('@' + ALLOWED_DOMAINS[i]) > -1) return true; }
  return false;
}
function _who(name, email) { name = name || ''; email = email || ''; return email ? (name ? name + ' <' + email + '>' : email) : name; }
function _table(rows) {
  return '<table style="border-collapse:collapse;margin:8px 0">' + rows.filter(function (r) { return r[1]; }).map(function (r) {
    return '<tr><td style="padding:4px 12px 4px 0;color:#7A8199">' + _esc(r[0]) +
           '</td><td style="padding:4px 0;font-weight:bold">' + _esc(r[1]) + '</td></tr>';
  }).join('') + '</table>';
}
function _button(url, label, color) {
  if (!url) return '';
  return '<p style="margin:18px 0"><a href="' + _esc(url) + '" style="background:' + color +
    ';color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">' + _esc(label) + '</a></p>';
}
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
function _json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
