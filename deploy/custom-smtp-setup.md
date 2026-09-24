# L&D Playbook — Fix "email rate limit exceeded" (Custom SMTP for Supabase Auth)

**Symptom:** the login screen shows *"email rate limit exceeded"* when people request a sign‑in link.

**Cause:** Supabase's built‑in email service (used to send magic links) is heavily rate‑limited
(only a few emails per hour for the whole project, plus a ~60‑second cooldown per address). With a
team logging in, that cap is hit quickly.

**Permanent fix — point Supabase Auth at your own Google Workspace SMTP** (same infra as the mailer):

1. In Supabase → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**.
2. Fill in:
   - Host: `smtp.gmail.com`
   - Port: `465` (SSL)  — or `587` (TLS)
   - Username: a real sending mailbox, e.g. `no-reply@pizza4ps.com` or `lnd.edl@pizza4ps.com`
   - Password: a Google **App Password** for that mailbox (same kind used for the approval mailer;
     the account needs 2‑Step Verification on to create one).
   - Sender name: `L&D Playbook`   ·   Sender email: the same mailbox as Username.
3. Save. (Optionally raise the rate limits under Authentication → Rate Limits once custom SMTP is on.)

After this, sign‑in links are sent through 4P's own email → no more rate‑limit errors.

**Meanwhile (no setup):** wait ~1 hour and retry; don't press "Send me a sign‑in link" repeatedly.

*Note recorded on request — to revisit later.*
