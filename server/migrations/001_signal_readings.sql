create extension if not exists pgcrypto;

create table if not exists public.signal_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  lat numeric not null,
  lng numeric not null,
  carrier text,
  technology text,
  signal_dbm integer,
  wifi_count integer default 0,
  speed_down numeric,
  speed_up numeric,
  trust_receipt_id integer,
  trust_receipt_tx text,
  status text default 'pending',
  error_message text,
  bounty_paid numeric default 0,
  created_at timestamptz default now()
);

alter table public.profiles
add column if not exists signal_balance numeric default 0;

alter table public.signal_readings
add column if not exists trust_receipt_tx text,
add column if not exists status text default 'pending',
add column if not exists error_message text;

create index if not exists signal_readings_user_id_idx
on public.signal_readings(user_id);

create index if not exists signal_readings_created_at_idx
on public.signal_readings(created_at desc);

select pg_notify('pgrst', 'reload schema');
