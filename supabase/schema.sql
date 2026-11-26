-- ============================================================================
-- Schema SQL pentru sistemul de conturi Rentz Online (Supabase PostgreSQL)
-- Ruleaza acest script o singura data in Supabase -> SQL Editor -> New Query
-- ============================================================================

-- 1. Tabelul de profiluri (stocheaza username-ul unic legat de contul auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(trim(username)) between 3 and 18),
  username_lower text generated always as (lower(trim(username))) stored unique,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Politici de securitate (RLS)
drop policy if exists "Citire publica profiluri" on public.profiles;
create policy "Citire publica profiluri"
  on public.profiles for select
  using (true);

drop policy if exists "Utilizatorii isi pot crea propriul profil" on public.profiles;
create policy "Utilizatorii isi pot crea propriul profil"
  on public.profiles for insert
  with check (auth.uid() = id);

-- 2. Trigger automat la inregistrare: salveaza username-ul trimis la signUp
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. Functie securizata pentru autentificarea dupa Username (returneaza emailul asociat)
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

grant execute on function public.get_email_for_login(text) to anon, authenticated;
