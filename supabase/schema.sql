-- Minahil Homework Planner — cloud sync schema (Supabase).
-- One family account (the parent's email login) owns all rows; row-level security keeps them private.
-- The phone keeps working offline; sync copies whole records both ways and the newest save wins.

create table if not exists public.app_kv (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('settings','meta','rates','samples','subjectScore','carry','pins')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

create table if not exists public.days (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  doc jsonb not null,               -- the whole day: tasks, plan, feedback, flags
  updated_at timestamptz not null default now(),
  primary key (owner, date)
);
create index if not exists days_owner_updated on public.days(owner, updated_at);
create index if not exists kv_owner_updated on public.app_kv(owner, updated_at);

alter table public.app_kv enable row level security;
alter table public.days enable row level security;

drop policy if exists own_rows_select on public.app_kv;
drop policy if exists own_rows_insert on public.app_kv;
drop policy if exists own_rows_update on public.app_kv;
drop policy if exists own_rows_delete on public.app_kv;
create policy own_rows_select on public.app_kv for select to authenticated using (owner = (select auth.uid()));
create policy own_rows_insert on public.app_kv for insert to authenticated with check (owner = (select auth.uid()));
create policy own_rows_update on public.app_kv for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy own_rows_delete on public.app_kv for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists own_rows_select on public.days;
drop policy if exists own_rows_insert on public.days;
drop policy if exists own_rows_update on public.days;
drop policy if exists own_rows_delete on public.days;
create policy own_rows_select on public.days for select to authenticated using (owner = (select auth.uid()));
create policy own_rows_insert on public.days for insert to authenticated with check (owner = (select auth.uid()));
create policy own_rows_update on public.days for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
create policy own_rows_delete on public.days for delete to authenticated using (owner = (select auth.uid()));

-- Private photo bucket: <owner uuid>/<date>-diary.jpg and <date>-sheet.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists photos_select on storage.objects;
drop policy if exists photos_insert on storage.objects;
drop policy if exists photos_update on storage.objects;
create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
