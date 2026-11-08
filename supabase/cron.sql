-- Run ONCE in the Supabase SQL editor AFTER deploying the "cleanup" Edge Function.
-- 1) Replace <PROJECT_REF> and <CRON_SECRET> (the same value you set with `supabase secrets set CRON_SECRET=...`).
-- 2) Enable the extensions first: Dashboard -> Database -> Extensions -> pg_cron, pg_net.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cleanup-expired-chats',
  '*/5 * * * *',            -- every 5 minutes (use '* * * * *' while testing)
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);

-- Inspect:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 10;
-- Remove:    select cron.unschedule('cleanup-expired-chats');
