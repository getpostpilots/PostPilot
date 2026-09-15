-- Supporting image for a post, generated alongside the draft. Stored as a
-- data: URL directly on the row rather than in Supabase Storage - one image
-- per post, generated once, and this avoids a storage bucket + policies for
-- what's a fairly small asset.
-- ponytail: move to Supabase Storage if images grow large/numerous enough
-- that inline base64 in Postgres becomes wasteful.
alter table posts add column image_data_url text;

-- The LinkedIn image URN once the image has been uploaded to LinkedIn as
-- part of publishing (see lib/linkedin.ts uploadImage). Kept separate from
-- linkedin_post_urn since the image can be uploaded slightly before the post
-- itself is created.
alter table posts add column linkedin_image_urn text;
