alter table public.signal_readings
add column if not exists network_type text,
add column if not exists sim_operator text,
add column if not exists network_operator text,
add column if not exists mcc text,
add column if not exists mnc text,
add column if not exists cell_id text,
add column if not exists tac integer,
add column if not exists lac integer,
add column if not exists pci integer,
add column if not exists psc integer,
add column if not exists rsrp integer,
add column if not exists rsrq integer,
add column if not exists sinr integer,
add column if not exists asu_level integer,
add column if not exists dbm integer,
add column if not exists is_registered boolean,
add column if not exists wifi_ssid text,
add column if not exists wifi_bssid text,
add column if not exists wifi_rssi integer,
add column if not exists wifi_link_speed numeric,
add column if not exists wifi_frequency integer,
add column if not exists wifi_ip_address text,
add column if not exists latency_ms numeric,
add column if not exists speed_source text,
add column if not exists speed_error text,
add column if not exists telemetry_raw jsonb;

create index if not exists signal_readings_operator_idx
on public.signal_readings(network_operator);

create index if not exists signal_readings_technology_idx
on public.signal_readings(technology);

create index if not exists signal_readings_status_idx
on public.signal_readings(status);

select pg_notify('pgrst', 'reload schema');
