-- The specific topic text used to generate this post (campaign topic, or
-- the pillar name for manual generation) - stored directly since a
-- campaign's topic list can change later via editing, and the post should
-- keep showing what it was actually written for at the time.
alter table posts add column topic text;
