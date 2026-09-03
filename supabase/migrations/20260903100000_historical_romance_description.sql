-- Historical Romance is the one genre whose card sub-line came back null.
--
-- build-genre-cards.mjs takes the first sentence of a description, and caps it at
-- 160 characters because the card gives the sub-line two lines. This description
-- is a single 166-character sentence, so there was nothing to trim to and the
-- card fell through to the generic i18n line.
--
-- The fix is not a longer cap. It is that the description was written before the
-- house voice settled: one long clause-stacked sentence where every sibling
-- genre opens with something short that lands. Rewriting it fixes the card and
-- the voice in the same edit.

update genres set description =
  'A love story the period keeps getting in the way of. Romance set firmly in another era, where propriety, class and the arranged marriage are the obstacle the couple has to outlast.'
 where normalized_name = 'historicalromance';

-- select name from genres where description is not null
--   and split_part(description, '. ', 1) is not null
--   and length(split_part(description, '. ', 1)) > 159;   -- expect 0 rows
