-- History of custom image prompts a user has typed, so the queue can offer
-- the last few as quick-select chips instead of retyping them.
create table image_prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references linkedin_accounts(id) on delete cascade,
  prompt text not null,
  created_at timestamptz not null default now()
);
create index image_prompts_account_idx on image_prompts(account_id, created_at desc);

alter table image_prompts enable row level security;
create policy "owner full access" on image_prompts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
