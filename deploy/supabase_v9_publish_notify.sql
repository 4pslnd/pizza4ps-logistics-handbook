-- v9 · Enable the Publish notification (Google Chat + group email)
-- ----------------------------------------------------------------------------
-- The Publish notification reuses the SAME Apps Script mailer as the approval
-- email, so mailer_url + mailer_secret already exist (from v8, since approval
-- emails work). This migration only ADDS the group address that the publish
-- email is sent to. It does NOT touch mailer_url / mailer_secret, so it will not
-- disturb the working approval mailer.
--
-- Run it in Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- Change the email below if the group alias is different.

create table if not exists public.app_config (
  key   text primary key,
  value text
);

insert into public.app_config (key, value)
values ('publish_group_email', 'lnd.edl@pizza4ps.com')
on conflict (key) do update set value = excluded.value;

-- Verify the three keys the Publish notification needs are present:
--   select key, value from public.app_config
--   where key in ('mailer_url','mailer_secret','publish_group_email');
-- If mailer_url or mailer_secret is missing, set them (they must match the Apps
-- Script /exec URL and the SHARED_SECRET inside mailer.gs):
--   insert into public.app_config (key, value) values
--     ('mailer_url',    'https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID/exec'),
--     ('mailer_secret', 'PASTE_THE_SAME_SECRET_AS_IN_mailer.gs')
--   on conflict (key) do update set value = excluded.value;
