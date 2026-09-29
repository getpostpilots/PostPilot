-- "Train your AI": free-text rules the account owner adds on top of the
-- built-in LinkedIn playbook (src/lib/linkedin-playbook.ts). Appended to every
-- draft prompt. Run manually in the Supabase SQL Editor.
alter table linkedin_accounts add column ai_training text;
