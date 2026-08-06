-- ============================================================================
-- Schema v9: Genre descriptions + expose description in book_genres_view
-- ============================================================================
-- Populates the description column on the 15 seeded genres and recreates
-- book_genres_view to include it. No table structure changes.
-- ============================================================================

-- STEP 1: Populate descriptions on seeded genres
UPDATE genres SET description = 'The original haunted manor, the brooding aristocrat, the ancestral curse. Walpole, Radcliffe, Lewis, and the century they shaped — where the genre found its bones and its shadows.'
  WHERE normalized_name = normalize_genre_name('Classic & Older Gothic');

UPDATE genres SET description = 'Where the body becomes the site of horror. Transgressive, visceral fiction that refuses to look away from what flesh can do and what can be done to it. Clive Barker territory.'
  WHERE normalized_name = normalize_genre_name('Body Horror & Transgressive');

UPDATE genres SET description = 'Rooted in the land, the old ways, and the community that keeps terrible secrets. Horror that grows from soil and ritual — The Wicker Man, The Ruins, folk magic gone wrong.'
  WHERE normalized_name = normalize_genre_name('Folk Horror');

UPDATE genres SET description = 'The feminine gaze turned inward and outward on a world that haunts women in particular ways. From Shirley Jackson to Carmen Maria Machado — the gothic reimagined through queer and feminist lenses.'
  WHERE normalized_name = normalize_genre_name('Sapphic & Feminist Gothic');

UPDATE genres SET description = 'Kudzu on the verandah, rot beneath the gentility, violence encoded in the landscape. The American South and its ghosts — racial, historical, familial.'
  WHERE normalized_name = normalize_genre_name('Southern & American Gothic');

UPDATE genres SET description = 'Magic realism bleeding into dread. García Márquez''s descendants and contemporaries mapping a continent''s grief, beauty, and violence through the uncanny.'
  WHERE normalized_name = normalize_genre_name('Latin American Horror & Literary');

UPDATE genres SET description = 'The blood-drinker across centuries — from Varney and Carmilla to Rice''s chronicles. Vampire fiction in all its sensual, philosophical, and horrifying registers.'
  WHERE normalized_name = normalize_genre_name('Vampires');

UPDATE genres SET description = 'Spirits inhabit the architecture. Houses with memories, rooms with will, walls that watch. The haunted space as psychological and literal threat.'
  WHERE normalized_name = normalize_genre_name('Gothic & Haunted Houses');

UPDATE genres SET description = 'Japan''s kaidan tradition, Korean horror''s social brutality, the strange and uncanny from across East Asia — folk tales reborn, corporate dread, and the ghosts between modernity and myth.'
  WHERE normalized_name = normalize_genre_name('Korean, Japanese & East Asian Lit');

UPDATE genres SET description = 'The work that resists easy genre — the novel as art object. Prose that demands and rewards attention, from Woolf to Sebald to today''s most uncompromising voices.'
  WHERE normalized_name = normalize_genre_name('Literary Fiction');

UPDATE genres SET description = 'Enchantment with a hearth at its center. Warm, gentle, witty — the fantasy of cozy inns, friendly magic, and adventure that ends in tea.'
  WHERE normalized_name = normalize_genre_name('Cozy Fantasy');

UPDATE genres SET description = 'Dragons, war, chosen ones, and the cost of power across vast invented worlds. Fantasy that takes its darkness seriously alongside its wonder.'
  WHERE normalized_name = normalize_genre_name('Epic & Dark Fantasy');

UPDATE genres SET description = 'Stars, time, and the estrangement of the possible. Science fiction and speculative work that asks what we become — and what we lose — as the world changes.'
  WHERE normalized_name = normalize_genre_name('Sci-Fi & Speculative');

UPDATE genres SET description = 'Cunning women, herbalists, sabbaths, and the persecution of the different. Witch fiction as horror, as reclamation, as history made strange.'
  WHERE normalized_name = normalize_genre_name('Witches');

UPDATE genres SET description = 'Gothic''s other house — the one at the edge of town where something was done and never spoken of. Regional and psychological horror from American soil, beyond the South.'
  WHERE normalized_name = normalize_genre_name('New England Gothic');

-- STEP 2: Recreate book_genres_view to include description
CREATE OR REPLACE VIEW public.book_genres_view AS
SELECT
  bg.book_id,
  bg.genre_id,
  g.name          AS genre_name,
  g.normalized_name,
  g.source        AS genre_source,
  g.usage_count,
  g.description   AS genre_description,
  bg.assigned_by_source
FROM public.book_genres bg
JOIN public.genres g ON g.id = bg.genre_id;

GRANT SELECT ON public.book_genres_view TO authenticated, anon;
