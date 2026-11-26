-- ============================================================================
-- Schema SQL pentru sistemul de conturi Rentz Online (Supabase PostgreSQL)
-- ============================================================================

-- 1. Tabelul de profiluri
-- username = ID-ul contului folosit la autentificare (login)
-- display_name = numele afisat in joc, ales la prima autentificare (initial NULL)
-- display_name_changed_at = momentul ultimei schimbari ulterioare a nickname-ului (cooldown 5 zile)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(trim(username)) between 3 and 18),
  username_lower text generated always as (lower(trim(username))) stored unique,
  display_name text check (display_name is null or char_length(trim(display_name)) between 2 and 18),
  display_name_lower text generated always as (lower(trim(display_name))) stored unique,
  display_name_changed_at timestamptz,
  avatar_url text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Acordare acces pentru Data API (accesul la randuri ramane controlat strict de RLS)
grant usage on schema public to anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant insert on table public.profiles to authenticated;
grant update (display_name, preferences, avatar_url) on table public.profiles to authenticated;

-- Politici de securitate (RLS)
drop policy if exists "Citire publica profiluri" on public.profiles;
create policy "Citire publica profiluri"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "Utilizatorii isi pot crea propriul profil" on public.profiles;
create policy "Utilizatorii isi pot crea propriul profil"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Utilizatorii isi pot actualiza propriul profil" on public.profiles;
create policy "Utilizatorii isi pot actualiza propriul profil"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 2. Trigger pentru limitarea schimbarii nickname-ului la o data la 5 zile
create or replace function public.enforce_display_name_cooldown()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.display_name is not null and new.display_name is distinct from old.display_name then
    if old.display_name_changed_at is not null
       and now() < old.display_name_changed_at + interval '5 days' then
      raise exception 'NICKNAME_COOLDOWN_ACTIVE';
    end if;
    new.display_name_changed_at := now();
  else
    new.display_name_changed_at := old.display_name_changed_at;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_display_name_cooldown() from public, anon;
grant execute on function public.enforce_display_name_cooldown() to authenticated;

drop trigger if exists trg_enforce_display_name_cooldown on public.profiles;
create trigger trg_enforce_display_name_cooldown
  before update on public.profiles
  for each row execute procedure public.enforce_display_name_cooldown();

-- 3. Trigger automat la inregistrare: salveaza username-ul de login (display_name ramane NULL pana la primul login)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Functie securizata pentru autentificarea dupa Username-ul contului
create or replace function public.get_email_for_login(p_username text)
returns text
language plpgsql
security definer set search_path = public, auth
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username_lower = lower(trim(p_username))
  limit 1;
  return v_email;
end;
$$;

revoke all on function public.get_email_for_login(text) from public;
grant execute on function public.get_email_for_login(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- 5. Istoric Meciuri & Statistici Jucatori
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  num_players smallint not null check (num_players between 3 and 6),
  total_rounds smallint not null,
  winner_user_id uuid references public.profiles(id) on delete set null,
  winner_name text not null,
  won_by_zero boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.match_players (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  place smallint not null check (place between 1 and 6),
  final_score integer not null,
  is_winner boolean not null default false,
  is_zero_winner boolean not null default false,
  was_bot boolean not null default false,
  blind_rounds_chosen smallint not null default 0,
  blind_net_points integer not null default 0,
  king_of_hearts_taken smallint not null default 0,
  ten_of_clubs_taken smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_matches_created_at on public.matches (created_at desc);
create index if not exists idx_matches_winner_user_id on public.matches (winner_user_id);
create index if not exists idx_match_players_match_id on public.match_players (match_id);
create index if not exists idx_match_players_user_created on public.match_players (user_id, created_at desc);

alter table public.matches enable row level security;
alter table public.match_players enable row level security;

revoke all on table public.matches from public, anon;
revoke all on table public.match_players from public, anon;
grant select, insert on table public.matches to authenticated;
grant select, insert on table public.match_players to authenticated;

drop policy if exists "Utilizatorii autentificati pot citi meciurile" on public.matches;
create policy "Utilizatorii autentificati pot citi meciurile"
  on public.matches for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Participantii pot inregistra meciuri" on public.matches;
create policy "Participantii pot inregistra meciuri"
  on public.matches for insert to authenticated
  with check ((select auth.uid()) is not null);

drop policy if exists "Utilizatorii autentificati pot citi participantii" on public.match_players;
create policy "Utilizatorii autentificati pot citi participantii"
  on public.match_players for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists "Participantii pot inregistra rezultatele meciului" on public.match_players;
create policy "Participantii pot inregistra rezultatele meciului"
  on public.match_players for insert to authenticated
  with check ((select auth.uid()) is not null);

create or replace function public.record_completed_match(
  p_room_code text,
  p_num_players smallint,
  p_total_rounds smallint,
  p_winner_user_id uuid,
  p_winner_name text,
  p_won_by_zero boolean,
  p_players jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_match_id uuid;
  v_item jsonb;
begin
  if v_caller is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(p_players) as elem
    where (elem->>'user_id')::uuid = v_caller
  ) then
    raise exception 'NOT_MATCH_PARTICIPANT';
  end if;

  insert into public.matches (
    room_code, num_players, total_rounds, winner_user_id, winner_name, won_by_zero
  )
  values (
    p_room_code, p_num_players, p_total_rounds, p_winner_user_id, p_winner_name, coalesce(p_won_by_zero, false)
  )
  returning id into v_match_id;

  for v_item in select * from jsonb_array_elements(p_players)
  loop
    insert into public.match_players (
      match_id, user_id, display_name, place, final_score,
      is_winner, is_zero_winner, was_bot,
      blind_rounds_chosen, blind_net_points, king_of_hearts_taken, ten_of_clubs_taken
    )
    values (
      v_match_id,
      nullif(v_item->>'user_id', '')::uuid,
      coalesce(v_item->>'display_name', 'Jucător'),
      (v_item->>'place')::smallint,
      (v_item->>'final_score')::integer,
      coalesce((v_item->>'is_winner')::boolean, false),
      coalesce((v_item->>'is_zero_winner')::boolean, false),
      coalesce((v_item->>'was_bot')::boolean, false),
      coalesce((v_item->>'blind_rounds_chosen')::smallint, 0),
      coalesce((v_item->>'blind_net_points')::integer, 0),
      coalesce((v_item->>'king_of_hearts_taken')::smallint, 0),
      coalesce((v_item->>'ten_of_clubs_taken')::smallint, 0)
    );
  end loop;

  return v_match_id;
end;
$$;

revoke all on function public.record_completed_match(text, smallint, smallint, uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.record_completed_match(text, smallint, smallint, uuid, text, boolean, jsonb) to authenticated;


-- 6. Storage Bucket pentru Avatare de Profil (512 KB max, imagini publice, scriere strict pe folderul propriu user_id)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,
  array['image/webp', 'image/jpeg', 'image/png', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Citire publica avatare" on storage.objects;
create policy "Citire publica avatare"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Incarcare avatar propriu" on storage.objects;
create policy "Incarcare avatar propriu"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Actualizare avatar propriu" on storage.objects;
create policy "Actualizare avatar propriu"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Stergere avatar propriu" on storage.objects;
create policy "Stergere avatar propriu"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

notify pgrst, 'reload schema';
