-- Video posts sourced from stock footage (Pexels + Pixabay), not AI-generated.
-- See src/lib/video-search.ts / src/lib/video-ai.ts / src/lib/linkedin.ts.

-- Guided "video style" profile, same flat-columns-on-the-account pattern as
-- the brand fields in 0003_brand.sql - feeds the stock-search query builder.
alter table linkedin_accounts add column video_style_description text;
alter table linkedin_accounts add column video_style_include text;
alter table linkedin_accounts add column video_style_avoid text;

-- Per-pillar (manual generation) and per-campaign (automatic ticks) media
-- checkboxes - independent settings since campaigns generate from
-- campaign_topics, not content_pillars. `last_media_type` is the alternation
-- cursor when both boxes are checked: flip from whichever type was used last.
alter table content_pillars add column media_image boolean not null default true;
alter table content_pillars add column media_video boolean not null default false;
alter table content_pillars add column last_media_type text check (last_media_type in ('image', 'video'));

alter table campaigns add column media_image boolean not null default true;
alter table campaigns add column media_video boolean not null default false;
alter table campaigns add column last_media_type text check (last_media_type in ('image', 'video'));

-- A post carries either image_data_url or video_url, never both - same
-- "one supporting media slot" model as today, just a second media type.
alter table posts add column video_url text;
alter table posts add column video_thumbnail_url text;
alter table posts add column video_search_query text; -- mirrors image_prompt's dedup role
alter table posts add column video_provider text check (video_provider in ('pexels', 'pixabay'));
alter table posts add column video_provider_id text;

-- The LinkedIn video URN once uploaded via lib/linkedin.ts uploadVideo -
-- kept separate from linkedin_image_urn, same reasoning as 0002_post_images.sql.
alter table posts add column linkedin_video_urn text;
