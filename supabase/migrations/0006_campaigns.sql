-- Recurring content campaigns: cycle through a fixed topic list on a
-- schedule, auto-generating text+image drafts and publishing them, subject
-- to the account's existing daily/weekly caps and min_gap_minutes.
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  duration_type text not null check (duration_type in ('week', 'month', 'evergreen')),
  start_date date not null default current_date,
  end_date date, -- null for evergreen
  days_of_week int[] not null default '{1,2,3,4,5}', -- 0=Sun..6=Sat
  post_time text not null default '17:00', -- "HH:MM", interpreted in the account's timezone
  last_run_date date, -- last calendar date (account tz) this campaign fired, guards double-runs
  next_topic_index int not null default 0, -- round-robin cursor into campaign_topics
  created_at timestamptz not null default now()
);
create index campaigns_account_idx on campaigns(account_id, status);

create table campaign_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  topic text not null,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
create index campaign_topics_campaign_idx on campaign_topics(campaign_id, order_index);

-- Reference images the campaign can point the image model at for style/mood
-- inspiration - never reproduced verbatim, see lib/image-ai.ts.
create table campaign_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);
create index campaign_images_campaign_idx on campaign_images(campaign_id);

alter table posts add column campaign_id uuid references campaigns(id) on delete set null;
alter table posts add column image_prompt text; -- whatever prompt produced image_data_url, for dedup

alter table campaigns enable row level security;
alter table campaign_topics enable row level security;
alter table campaign_images enable row level security;
create policy "owner full access" on campaigns for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on campaign_topics for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on campaign_images for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
