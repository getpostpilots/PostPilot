-- Shared, account-wide image library - replaces campaign_images' per-campaign
-- URL list. Images can come from an uploaded file (storage_path, private
-- Storage bucket) or a pasted external URL (url) - exactly one of the two is
-- set. Reusable across multiple campaigns via campaign_library_images.
create table image_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text,
  storage_path text,
  created_at timestamptz not null default now(),
  check ((url is not null) <> (storage_path is not null))
);
create index image_library_user_idx on image_library(user_id, created_at desc);

-- user_id is denormalized from the two FKs so RLS here can stay the same
-- flat auth.uid() = user_id shape as every other table, not a two-join exists().
create table campaign_library_images (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  image_library_id uuid not null references image_library(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (campaign_id, image_library_id)
);
create index campaign_library_images_image_idx on campaign_library_images(image_library_id);

-- Backfill: dedupe existing campaign_images rows by (user_id, url) into one
-- image_library row each, then re-link every campaign that used that URL.
insert into image_library (user_id, url, created_at)
select distinct on (user_id, url) user_id, url, created_at
from campaign_images
order by user_id, url, created_at asc;

insert into campaign_library_images (campaign_id, image_library_id, user_id)
select distinct ci.campaign_id, il.id, ci.user_id
from campaign_images ci
join image_library il on il.user_id = ci.user_id and il.url = ci.url
on conflict do nothing;

drop table campaign_images;

alter table image_library enable row level security;
alter table campaign_library_images enable row level security;
create policy "owner full access" on image_library for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner full access" on campaign_library_images for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private bucket - some of these will be "inside the platform" screenshots
-- that can show client/lead names, so nothing here gets a public URL.
-- Objects live at "<user_id>/<uuid>.<ext>"; storage.foldername(name)[1] is
-- what the policies below check against auth.uid().
insert into storage.buckets (id, name, public) values ('image-library', 'image-library', false);

create policy "owner insert" on storage.objects for insert
  with check (bucket_id = 'image-library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner select" on storage.objects for select
  using (bucket_id = 'image-library' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner delete" on storage.objects for delete
  using (bucket_id = 'image-library' and (storage.foldername(name))[1] = auth.uid()::text);
