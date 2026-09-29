-- Document (carousel) posts + per-post results for the learning loop.
-- Run manually in the Supabase SQL Editor (see 0011 note).

-- Third media choice alongside image/video, same per-pillar/per-campaign
-- checkbox model. last_media_type is the rotation cursor, so its check
-- constraint must now allow 'document'.
alter table content_pillars add column media_document boolean not null default false;
alter table campaigns add column media_document boolean not null default false;
alter table content_pillars drop constraint if exists content_pillars_last_media_type_check;
alter table content_pillars add constraint content_pillars_last_media_type_check check (last_media_type in ('image', 'video', 'document'));
alter table campaigns drop constraint if exists campaigns_last_media_type_check;
alter table campaigns add constraint campaigns_last_media_type_check check (last_media_type in ('image', 'video', 'document'));

-- A document post stores its slides as JSON; the PDF is rendered at publish
-- time (src/lib/carousel.ts), so nothing binary is kept.
alter table posts add column document_title text;
alter table posts add column document_slides jsonb;

-- Which post shape (case/mistakes/contrast/playbook) the draft used.
alter table posts add column structure text;

-- Results the owner logs after publishing (LinkedIn's analytics API needs a
-- restricted scope this app does not have). Feeds src/lib/learning.ts.
alter table posts add column impressions integer;
alter table posts add column reactions integer;
alter table posts add column comments_count integer;
alter table posts add column saves integer;
alter table posts add column reposts integer;
alter table posts add column metrics_updated_at timestamptz;
