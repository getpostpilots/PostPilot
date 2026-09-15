-- PostPilot schema. Every table carries user_id directly (denormalized from
-- linkedin_accounts) so RLS policies stay a flat `auth.uid() = user_id` check
-- instead of a join per row.

create extension if not exists "pgcrypto";

create table linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  member_sub text not null,                    -- LinkedIn's `sub` claim, used to build the author URN
  access_token_enc text not null,
  refresh_token_enc text,
  token_expires_at timestamptz not null,
  kill_switch_engaged boolean not null default false,
  primary_audience text,
  secondary_audience text,
  timezone text not null default 'UTC',
  daily_cap int not null default 1,
  weekly_cap int not null default 5,
  min_gap_minutes int not null default 240,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, member_sub)
);

create table ai_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  provider text not null,                       -- see src/lib/ai-providers.ts
  api_key_enc text not null,
  model text,
  base_url text,
  created_at timestamptz not null default now()
);

create table voice_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  version int not null default 1,
  source_posts text[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table content_pillars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  name text not null,
  description text not null,
  kind text not null check (kind in ('founder', 'product')),
  target_share numeric not null check (target_share >= 0 and target_share <= 1),
  cta_mechanic text not null default 'discussion' check (cta_mechanic in ('discussion', 'comment_gate')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table founder_pov (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  label text not null,
  belief text not null,
  challenges text,
  evidence text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  pillar_id uuid references content_pillars(id) on delete set null,
  body text not null,
  state text not null default 'draft'
    check (state in ('draft', 'approved', 'scheduled', 'published', 'killed', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  linkedin_post_urn text,
  kill_reason text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_account_state_idx on posts(account_id, state);
create index posts_scheduled_idx on posts(scheduled_at) where state = 'scheduled';

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  pillar_id uuid references content_pillars(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  requested_count int not null default 1,
  generated_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Audit trail: one row per automated decision (check passed/failed, draft
-- written, post released, kill switch engaged, etc). Never mutated.
create table decision_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  post_id uuid references posts(id) on delete set null,
  stage text not null,
  decision text not null,
  rationale text not null,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  created_at timestamptz not null default now()
);
create index decision_logs_account_idx on decision_logs(account_id, created_at desc);

-- Row Level Security: every table is owned by exactly one auth user.
alter table linkedin_accounts enable row level security;
alter table ai_keys enable row level security;
alter table voice_profiles enable row level security;
alter table content_pillars enable row level security;
alter table founder_pov enable row level security;
alter table posts enable row level security;
alter table generation_jobs enable row level security;
alter table decision_logs enable row level security;

create policy "owner full access" on linkedin_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on ai_keys for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on voice_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on content_pillars for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on founder_pov for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on posts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on generation_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on decision_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger linkedin_accounts_set_updated_at before update on linkedin_accounts
  for each row execute function set_updated_at();
create trigger posts_set_updated_at before update on posts
  for each row execute function set_updated_at();
