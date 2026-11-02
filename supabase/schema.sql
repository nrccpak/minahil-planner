-- Minahil Homework Planner — Supabase schema (prepared in Phase 1, applied when sync is switched on).
-- One family account (the parent login) owns all rows. Minahil's PIN stays a local unlock on the phone.
-- Mirrors the on-phone data: settings/rates/samples/order scores (key-value), days, tasks, feedback, photos.

create table if not exists public.app_kv (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key in ('settings','meta','rates','samples','subjectScore','carry')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner, key)
);

create table if not exists public.days (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  pause boolean not null default false,
  different jsonb,                -- {studyStart, finishLine} for "today is different"
  plan jsonb,                     -- timeline snapshot when the sheet was made
  locked boolean not null default false,
  order_changed boolean,
  suggested_order text[],
  morning jsonb,                  -- {taskIds, wake}
  moved jsonb,                    -- [{taskId, to}]
  revision jsonb,                 -- {minutes, topic}
  learned boolean not null default false,
  diary_photo text,               -- storage path in bucket "photos"
  sheet_photo text,
  updated_at timestamptz not null default now(),
  primary key (owner, date)
);

create table if not exists public.tasks (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  date date not null,
  position int not null,
  subject text not null,
  type text not null check (type in ('pages','questions','verses','test','minutes')),
  units numeric,
  note text,                      -- kept exactly as written (Urdu stays Urdu)
  test boolean not null default false,
  due_tomorrow boolean not null default false,
  override_min int,
  planned_min int,
  primary key (owner, id),
  foreign key (owner, date) references public.days(owner, date) on delete cascade
);

create table if not exists public.task_feedback (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id text not null,
  status text check (status in ('done','partly','notdone')),
  time_bucket text check (time_bucket in ('early10','early5','ontime','plus10','plus20','plus30')),
  difficulty text check (difficulty in ('easy','ok','hard')),
  focus text check (focus in ('good','average','poor')),
  reasons text[] not null default '{}',
  need_help boolean not null default false,
  primary key (owner, task_id),
  foreign key (owner, task_id) references public.tasks(owner, id) on delete cascade
);

create table if not exists public.day_feedback (
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  start_time time,
  finish_time time,
  sleep_time time,
  free_taken boolean not null default false,
  tv_boxes int not null default 0 check (tv_boxes between 0 and 8),
  hard_note text,
  saved_at timestamptz,
  primary key (owner, date),
  foreign key (owner, date) references public.days(owner, date) on delete cascade
);

-- Row-level security: each signed-in family sees only its own rows.
alter table public.app_kv enable row level security;
alter table public.days enable row level security;
alter table public.tasks enable row level security;
alter table public.task_feedback enable row level security;
alter table public.day_feedback enable row level security;

do $$
declare t text;
begin
  foreach t in array array['app_kv','days','tasks','task_feedback','day_feedback'] loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()))', t);
  end loop;
end $$;

create index if not exists tasks_by_date on public.tasks(owner, date, position);

-- Private photo bucket: files stored under <owner uuid>/<date>-diary.jpg and <date>-sheet.jpg
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists photos_own on storage.objects;
create policy photos_own on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
