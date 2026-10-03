-- Production authentication controls. Application code uses the server-side
-- Postgres connection; browser roles never read these tables directly.

alter table public.platform_users
  add column if not exists email_verified_at timestamptz,
  add column if not exists mfa_enabled boolean not null default false,
  add column if not exists mfa_secret_ciphertext text,
  add column if not exists mfa_recovery_codes jsonb not null default '[]'::jsonb,
  add column if not exists password_changed_at timestamptz;

alter table public.platform_sessions
  add column if not exists mfa_verified_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now();

-- Accounts created before verification was introduced were already admitted
-- through the existing product flow. Preserve them as verified during cutover.
update public.platform_users
   set email_verified_at = coalesce(email_verified_at, created_at, now())
 where email_verified_at is null;

-- Server-created/invitation accounts already possess a signed invitation.
-- Self-service signup explicitly writes NULL until its email link is used.
alter table public.platform_users alter column email_verified_at set default now();

create table if not exists public.platform_auth_tokens (
  id          text primary key,
  user_id     text not null references public.platform_users(id) on delete cascade,
  token_hash  text not null unique,
  purpose     text not null check (purpose in ('email_verification', 'password_reset')),
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists platform_auth_tokens_user_purpose_idx
  on public.platform_auth_tokens(user_id, purpose, created_at desc);
create index if not exists platform_auth_tokens_expiry_idx
  on public.platform_auth_tokens(expires_at) where consumed_at is null;

create table if not exists public.platform_auth_rate_limits (
  scope          text not null,
  subject_hash   text not null,
  window_started timestamptz not null,
  request_count  integer not null default 0 check (request_count >= 0),
  blocked_until  timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (scope, subject_hash)
);

create index if not exists platform_auth_rate_limits_cleanup_idx
  on public.platform_auth_rate_limits(updated_at);
