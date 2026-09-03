-- A frame per family, not one frame for all of them.
--
-- The card composites two layers: an ornate frame and an inner art panel. The
-- pre-illustrator cards had a bespoke frame per GENRE, which is where much of
-- their personality came from — and which is exactly what does not scale past
-- 167 genres growing weekly.
--
-- One frame per FAMILY keeps the personality and bounds the commission at 16.
-- The renderer does not change: still two assets, still a fixed gold-on-black
-- palette, still the genre name and the reader's Title set in type on top.
--
-- Nullable on purpose. A family with no frame yet falls back to the shared
-- default, so the shelf renders from the day it exists rather than the day the
-- illustrator delivers.

alter table genre_families add column if not exists frame_asset text;

comment on column genre_families.frame_asset is
  'Illustrated frame for this family''s share cards. NULL falls back to the default frame.';
comment on column genre_families.plate_asset is
  'Illustrated inner art for this family''s share cards. NULL falls back to the default plate.';
