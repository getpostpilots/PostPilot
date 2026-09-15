-- Brand identity pulled from the account's website: logo, accent colors, and
-- a short description used as extra context for draft generation.
alter table linkedin_accounts add column website_url text;
alter table linkedin_accounts add column logo_url text;
alter table linkedin_accounts add column brand_primary_color text;
alter table linkedin_accounts add column brand_secondary_color text;
alter table linkedin_accounts add column brand_description text;
