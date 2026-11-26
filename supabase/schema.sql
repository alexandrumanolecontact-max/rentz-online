-- ============================================================================
-- Schema SQL pentru sistemul de conturi Rentz Online (Supabase PostgreSQL)
-- ============================================================================

-- 1. Tabelul de profiluri
-- username = ID-ul contului folosit la autentificare (login)
-- display_name = numele afisat in joc, ales la prima autentificare (initial NULL)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(trim(username)) between 3 and 18),
  username_lower text generated always as (lower(trim(username))) stored unique,
  display_name text check (display_name is null or char_length(trim(display_name)) between 2 and 18),
  display_name_lower text generated always as (lower(trim(display_name))) stored unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Acordare acces pentru Data API (accesul la randuri ramane controlat strict de RLS)
grant usage on schema public to anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant insert on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

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

-- 2. Trigger automat la inregistrare: salveaza username-ul de login (display_name ramane NULL pana la primul login)
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

-- 3. Functie securizata pentru autentificarea dupa Username-ul contului
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
