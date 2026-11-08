// Edge Function: cleanup  (called by pg_cron every few minutes with header x-cron-secret)
// Deletes expired media from Storage FIRST, then deletes the database rows.
// Expiry is ALSO enforced by RLS on every read, so users never see expired data even if this job is late.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'chat-media';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const stats = { files_deleted: 0, messages_deleted: 0, conversations_deleted: 0, invitations_deleted: 0, errors: [] as string[] };

  // 1) expired attachments: remove files, then rows
  for (let i = 0; i < 20; i++) {
    const { data: rows, error } = await admin.from('media_attachments')
      .select('id, storage_path').lte('expires_at', new Date().toISOString()).limit(500);
    if (error) { stats.errors.push('attachments: ' + error.message); break; }
    if (!rows?.length) break;
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
    if (rmErr) { stats.errors.push('storage: ' + rmErr.message); break; }
    stats.files_deleted += rows.length;
    await admin.from('media_attachments').delete().in('id', rows.map((r) => r.id));
  }

  // 2) expired messages
  {
    const { count, error } = await admin.from('messages').delete({ count: 'exact' })
      .lte('expires_at', new Date().toISOString());
    if (error) stats.errors.push('messages: ' + error.message); else stats.messages_deleted = count ?? 0;
  }

  // 3) expired conversations (or conversations both people have ended): wipe the whole storage folder
  //    (also catches uploads that never became a message), then cascade-delete DB rows.
  {
    const { data: ids, error } = await admin.rpc('conversations_to_purge', { p_limit: 200 });
    if (error) stats.errors.push('purge list: ' + error.message);
    for (const convId of (ids ?? []) as string[]) {
      let ok = true;
      for (let guard = 0; guard < 50; guard++) {
        const { data: files, error: lerr } = await admin.storage.from(BUCKET).list(convId, { limit: 1000 });
        if (lerr) { ok = false; stats.errors.push('list: ' + lerr.message); break; }
        if (!files?.length) break;
        const { error: rerr } = await admin.storage.from(BUCKET).remove(files.map((f) => `${convId}/${f.name}`));
        if (rerr) { ok = false; stats.errors.push('remove: ' + rerr.message); break; }
        stats.files_deleted += files.length;
      }
      if (!ok) continue; // keep the row so we retry next run
      const { error: derr } = await admin.from('conversations').delete().eq('id', convId);
      if (derr) stats.errors.push('conversation: ' + derr.message); else stats.conversations_deleted++;
    }
  }

  // 4) old invitations + stale calls
  {
    const { count } = await admin.from('invitations').delete({ count: 'exact' }).lte('expires_at', new Date().toISOString());
    stats.invitations_deleted = count ?? 0;
    await admin.rpc('expire_stale_calls');
  }

  console.log(JSON.stringify(stats));
  return new Response(JSON.stringify(stats), { status: stats.errors.length ? 207 : 200, headers: { 'Content-Type': 'application/json' } });
});
