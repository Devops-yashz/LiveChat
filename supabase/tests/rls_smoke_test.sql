\set ON_ERROR_STOP on
\set a '00000000-0000-0000-0000-00000000000a'
\set b '00000000-0000-0000-0000-00000000000b'
\set c '00000000-0000-0000-0000-00000000000c'
insert into auth.users (id,email,raw_user_meta_data) values
 (:'a','a@x.com','{"username":"alice"}'),(:'b','b@x.com','{"username":"bob"}'),(:'c','c@x.com','{"username":"carol"}');
select username from profiles order by 1;

-- service role creates invitation a->b via email
set role service_role;
select public.create_invitation(:'a','b@x.com') as inv;
select public.create_invitation(:'a','nobody@x.com') as inv_unregistered;
reset role;

-- bob sees & accepts
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'b','email','b@x.com')::text, false);
select count(*) as bob_sees_invites from invitations;
select count(*) as bob_sees_alice_profile from profiles where username='alice';
select public.respond_invitation((select id from invitations where invitee_id=:'b' limit 1), true) as conv \gset
reset role;

-- carol (outsider) sees nothing
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'c','email','c@x.com')::text, false);
select (select count(*) from conversations) as carol_convs, (select count(*) from invitations) as carol_inv, (select count(*) from profiles) as carol_profiles;
reset role;

-- alice sends a message; bob reads it
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'a','email','a@x.com')::text, false);
insert into messages (conversation_id, sender_id, kind, body, expires_at) values (:'conv', :'a', 'text', 'hello', now()+interval '999 days');
select (expires_at < now()+interval '25 hours') as expiry_forced_by_server from messages;
-- cannot forge sender / system / update
do $$ begin insert into messages (conversation_id,sender_id,kind,body,expires_at) values ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-00000000000a','text','x',now()); exception when others then raise notice 'blocked foreign conv insert: %', sqlerrm; end $$;
do $$ begin update messages set body='hacked'; exception when others then raise notice 'blocked update: %', sqlerrm; end $$;
reset role;

set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'b','email','b@x.com')::text, false);
select public.mark_delivered(:'conv'); select public.mark_read(:'conv');
select body, delivered_at is not null as delivered, read_at is not null as read from messages;
select count(*) as bob_unread from public.my_conversations() where unread_count>0;

-- bob ends chat -> alice gets system message, alice cannot send, bob sees nothing
select public.end_chat(:'conv');
select count(*) as bob_msgs_after_end from messages;
select count(*) as bob_convs_after_end from conversations;
reset role;
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'a','email','a@x.com')::text, false);
select kind, body from messages order by created_at;
select public.can_send(:'conv') as alice_can_send_after_b_ended;
select other_status from public.my_conversations();
reset role;

-- expiry: force conversation expired -> invisible immediately, before cleanup runs
update conversations set expires_at = now() - interval '1 second';
set role authenticated; select set_config('request.jwt.claims', json_build_object('sub',:'a','email','a@x.com')::text, false);
select (select count(*) from messages) as msgs_after_expiry, (select count(*) from conversations) as convs_after_expiry, (select count(*) from public.my_conversations()) as rpc_after_expiry;
reset role;
set role service_role; select count(*) as to_purge from public.conversations_to_purge(10); reset role;

-- anon / authenticated cannot call service-only functions
set role authenticated; do $$ begin perform public.create_invitation('00000000-0000-0000-0000-00000000000a','x@y.com'); exception when others then raise notice 'blocked: %', sqlerrm; end $$; reset role;
set role anon; select public.username_available('zed') as anon_username_check; do $$ begin perform * from profiles; exception when others then raise notice 'anon blocked: %', sqlerrm; end $$; reset role;
