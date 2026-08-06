-- schema_v10_migration.sql
-- Adds currently_reading table to track books in progress with a start date.
-- The start_date lets the app calculate how long a user took to finish a book
-- when they eventually call markAsRead() (which removes the row and records
-- the read_at in read_books as usual).

create table if not exists currently_reading (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  book_id       uuid not null references books(id) on delete cascade,
  started_at    date not null default current_date,
  created_at    timestamptz not null default now(),
  constraint currently_reading_user_book_unique unique (user_id, book_id)
);

-- RLS
alter table currently_reading enable row level security;

create policy "Users can manage their own currently_reading"
  on currently_reading
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index for fast per-user lookups
create index if not exists currently_reading_user_id_idx on currently_reading(user_id);
