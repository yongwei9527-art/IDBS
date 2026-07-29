create table if not exists user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android')),
  token_hash text not null unique,
  token_ciphertext text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'invalid')),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error_code text,
  last_seen_at timestamptz not null default now(),
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_push_devices_sendable
  on user_push_devices (user_id, updated_at desc)
  where status = 'active';
