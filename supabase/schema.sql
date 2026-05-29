-- ============================================================
-- The Wishlist Oracle — Supabase schema
-- Run this once in your Supabase project's SQL Editor.
-- ============================================================

-- ---------- PROFILES (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  preferences jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auto-create a profile row when a new user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- WISHLIST ----------
create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_title text not null,
  book_author text,
  book_isbn text,
  book_metadata jsonb default '{}'::jsonb,
  notes text,
  added_at timestamptz default now(),
  unique (user_id, book_title)
);
create index if not exists wishlist_user_idx on public.wishlist_items(user_id);

-- ---------- READ BOOKS ----------
create table if not exists public.read_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_title text not null,
  book_author text,
  book_isbn text,
  rating numeric(2,1),
  read_at date,
  source text default 'manual',
  book_metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (user_id, book_title)
);
create index if not exists read_books_user_idx on public.read_books(user_id);

-- ---------- PLANS ----------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists plans_user_idx on public.plans(user_id);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.profiles enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.read_books enable row level security;
alter table public.plans enable row level security;

-- Profiles: users can read/update their own row
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Wishlist, read books, plans: full CRUD on own rows only
drop policy if exists "Users manage own wishlist" on public.wishlist_items;
create policy "Users manage own wishlist"
  on public.wishlist_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own read books" on public.read_books;
create policy "Users manage own read books"
  on public.read_books for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage own plans" on public.plans;
create policy "Users manage own plans"
  on public.plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------- DEFAULTS so client can omit user_id on inserts ----------
alter table public.wishlist_items alter column user_id set default auth.uid();
alter table public.read_books alter column user_id set default auth.uid();
alter table public.plans alter column user_id set default auth.uid();
