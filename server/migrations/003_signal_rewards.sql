alter table public.signal_readings
add column if not exists reward_tx_hash text,
add column if not exists reward_status text default 'pending',
add column if not exists reward_error text;

create index if not exists signal_readings_reward_status_idx
on public.signal_readings(reward_status);

select pg_notify('pgrst', 'reload schema');
