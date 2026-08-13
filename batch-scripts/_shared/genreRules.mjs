// genreRules.mjs — subject strings → canonical genres.
//
// Lifted out of scheduled/metadataBackfill.mjs in v0.63, for two reasons. The
// table grew from 49 targets to cover a 136-genre taxonomy and was crowding out
// the script it lived in; and a second consumer arrived (manual/regenreCatalog)
// that must infer genres from exactly the same rules, because two scripts
// writing the same table from two slightly different rule sets is a bug that
// takes months to notice.
//
// WHAT THIS IS
//
// Hardcover, Open Library and Google Books all return free-text subject/tag
// lists — "Southern gothic fiction", "Detective and mystery stories", "Ghost
// stories". None of them returns this project's taxonomy. A keyword table maps
// theirs onto ours deterministically, which costs nothing and is reproducible,
// where a model costs money per book and answers slightly differently each run.
//
// Claude is for judgment. Deciding that "Ghost stories" implies Haunted Houses
// is not judgment; it is a lookup somebody has to write down once.
//
// THE SCORING, AND WHY IT IS NOT FIRST-MATCH-WINS
//
// Open Library routinely returns 30+ subjects. First-match-wins meant almost
// every book eventually matched something, and *what* it matched depended on
// rule order rather than fit — a broad rule sitting above a specific one
// silently stole its books.
//
// Now every subject is tested against every rule and genres accumulate points.
// Two things carry weight: how specific the rule is, and how near the top of
// the list the subject appeared, since Open Library orders roughly by
// prominence. A genre must clear MIN_GENRE_SCORE to be assigned at all, so a
// single weak hit yields nothing rather than a wrong shelf.
//
// A WRONG GENRE IS WORSE THAN NO GENRE. It puts a book in front of exactly the
// reader who did not ask for it. Every pattern below is deliberately narrow for
// that reason, and anything unmatched goes to a CSV for review instead of being
// guessed at.

// Weights. A specific genre matching once should beat a broad one matching
// once — "folk horror" is far stronger evidence than "fiction".
export const SPECIFIC = 3;   // a named subgenre; almost never a coincidence
export const MID = 2;        // a real genre, but with overlap
export const BROAD = 1;      // umbrella terms that appear on half the catalog

// Minimum score before a genre is assigned at all. One BROAD hit deep in a long
// subject list scores 1 and is not enough — that is how "Fiction" alone used to
// drag books into a genre they had no business in.
export const MIN_GENRE_SCORE = 3;

// Genres per book, shared by every writer so they cannot disagree. Roughly two
// umbrellas plus three specifics — umbrellas are applied ALONGSIDE the specific
// genre (v0.63), so a folk horror novel is "Folk Horror" AND "Horror".
export const MAX_GENRES_PER_BOOK = 5;

// Every target here must exist in public.genres, or the assignment is invisible
// — the genre picker only offers names from that table, so no reader can select
// it and no book filed under it can be found. assertNoGenreDrift() below is the
// guard; the scripts call it before writing anything.
export const GENRE_RULES = [
  // ══ Specific subgenres — a named thing, rarely a coincidence ══════════════
  // ── Gothic ────────────────────────────────────────────────────────────────
  ['Southern Gothic',             /southern gothic/i,                                                        SPECIFIC],
  ['American Gothic',             /american gothic/i,                                                        SPECIFIC],
  ['Australian Gothic',           /australian gothic|antipodean gothic/i,                                    SPECIFIC],
  ['Feminist & Sapphic Gothic',   /sapphic|lesbian fiction|feminist gothic|queer gothic/i,                   SPECIFIC],
  ['Classic & Older Gothic',      /classic gothic|victorian gothic|gothic revival/i,                         SPECIFIC],
  ['Haunted Houses',              /haunted house|haunted houses|ghost stor(y|ies)|haunting/i,                SPECIFIC],
  ['Dark Academia',               /dark academia|campus novel|academic thriller|boarding school/i,           SPECIFIC],

  // ── Horror ────────────────────────────────────────────────────────────────
  ['Folk Horror',                 /folk horror|folklore horror|rural horror/i,                               SPECIFIC],
  ['Cosmic Horror',               /cosmic horror|lovecraft|weird fiction|eldritch/i,                          SPECIFIC],
  ['Body Horror & Transgressive', /body horror|transgressive fiction|splatterpunk/i,                         SPECIFIC],
  ['Techno-Horror',               /techno-horror|technological horror|machine horror/i,                      SPECIFIC],
  ['Indigenous Horror',           /indigenous horror|native american horror/i,                               SPECIFIC],
  ['Scandinavian Horror',         /nordic horror|scandinavian horror|swedish horror|norwegian horror/i,      SPECIFIC],
  ['Japanese & East Asian Horror',/japanese horror|j-horror|korean horror/i,                                 SPECIFIC],
  ['Vampires',                    /vampire/i,                                                                SPECIFIC],
  ['Witches',                     /witch(es|craft)?\b/i,                                                     SPECIFIC],
  ['Zombies',                     /zombie|undead/i,                                                          SPECIFIC],
  ['Werewolves',                  /werewol(f|ves)|lycanthrop/i,                                              SPECIFIC],
  ['Demons & Monsters',           /demon|monster|possession|exorcis/i,                                       SPECIFIC],
  ['Slasher',                     /slasher|final girl/i,                                                     SPECIFIC],
  ['Paranormal',                  /paranormal/i,                                                             SPECIFIC],

  // ── Fantasy ───────────────────────────────────────────────────────────────
  ['Cozy Fantasy',                /coz[yi]e? fantasy|cosy fantasy|low[- ]stakes fantasy/i,                    SPECIFIC],
  ['Urban Fantasy',               /urban fantasy/i,                                                          SPECIFIC],
  ['Dark Fantasy',                /dark fantasy/i,                                                           SPECIFIC],
  ['Epic Fantasy',                /epic fantasy|high fantasy|sword and sorcery/i,                            SPECIFIC],
  ['Grimdark',                    /grimdark/i,                                                               SPECIFIC],
  ['Portal Fantasy',              /portal fantasy|isekai/i,                                                  SPECIFIC],
  ['Quest Fantasy',               /quest fantasy|heroic quest/i,                                             SPECIFIC],
  ['Military Fantasy',            /military fantasy/i,                                                       SPECIFIC],
  ['Flintlock Fantasy',           /flintlock fantasy|gunpowder fantasy/i,                                    SPECIFIC],
  ['Historical Fantasy',          /historical fantasy/i,                                                     SPECIFIC],
  ['Celtic Fantasy',              /celtic fantasy|irish mythology|welsh mythology|scottish folklore/i,       SPECIFIC],
  ['Asian-inspired Fantasy',      /wuxia|xianxia|cultivation novel|silkpunk/i,                               SPECIFIC],
  ['Sapphic Fantasy',             /sapphic fantasy|lesbian fantasy/i,                                        SPECIFIC],
  ['Dragons',                     /dragon/i,                                                                 SPECIFIC],
  ['Arthurian',                   /arthurian|king arthur|camelot|holy grail/i,                               SPECIFIC],
  ['Fairy Tale Retelling',        /fairy tale|fairy tales|retelling/i,                                       SPECIFIC],
  ['Mythological Fantasy',        /mythology|greek myth|norse myth|egyptian myth/i,                          SPECIFIC],
  ['Vikings & Norse',             /viking|norse saga|old norse/i,                                            SPECIFIC],
  ['LitRPG',                      /litrpg|gamelit|dungeon core/i,                                            SPECIFIC],
  ['Dying Earth',                 /dying earth/i,                                                            SPECIFIC],

  // ── Science fiction ───────────────────────────────────────────────────────
  ['Space Opera',                 /space opera/i,                                                            SPECIFIC],
  ['Cyberpunk',                   /cyberpunk/i,                                                              SPECIFIC],
  ['Steampunk',                   /steampunk/i,                                                              SPECIFIC],
  ['Military Science Fiction',    /military science fiction|military sf/i,                                   SPECIFIC],
  ['Classic Science Fiction',     /golden age science fiction|classic science fiction/i,                     SPECIFIC],
  ['First Contact',               /first contact/i,                                                          SPECIFIC],
  ['Alien Invasion',              /alien invasion/i,                                                         SPECIFIC],
  ['Time Travel',                 /time travel/i,                                                            SPECIFIC],
  ['Dystopian',                   /dystopia/i,                                                               SPECIFIC],
  ['Post-Apocalyptic',            /post-apocalyptic|postapocalyptic|post apocalyptic/i,                      SPECIFIC],
  ['Apocalyptic',                 /apocalyptic fiction|end of the world/i,                                   SPECIFIC],
  ['Climate Fiction',             /cli-fi|climate fiction|climate change fiction/i,                          SPECIFIC],
  ['Eco-Fiction',                 /ecofiction|eco-fiction|nature writing|environmental fiction/i,            SPECIFIC],

  // ── Crime, thriller, mystery ──────────────────────────────────────────────
  ['Crime Noir',                  /noir|hardboiled|hard-boiled/i,                                            SPECIFIC],
  ['Legal Thriller',              /legal thriller|courtroom/i,                                               SPECIFIC],
  ['Espionage',                   /espionage|spy stories|spy fiction|intelligence service/i,                 SPECIFIC],
  ['Heist',                       /heist|caper/i,                                                            SPECIFIC],
  ['Crime Fiction',               /crime fiction|true crime stories/i,                                       SPECIFIC],

  // ── Form and movement ─────────────────────────────────────────────────────
  ['Epic Poetry',                 /epic poetry|epic poem/i,                                                  SPECIFIC],
  ['Epistolary Fiction',          /epistolary/i,                                                             SPECIFIC],
  ['Metafiction',                 /metafiction/i,                                                            SPECIFIC],
  ['Surrealism',                  /surrealis/i,                                                              SPECIFIC],
  ['Modernist',                   /modernism|modernist/i,                                                    SPECIFIC],
  ['Postmodern',                  /postmodern/i,                                                             SPECIFIC],
  ['Magical Realism',             /magical realism|magic realism/i,                                          SPECIFIC],
  ['Short Fiction',               /short stories|short story|novella/i,                                      SPECIFIC],
  ['Drama',                       /\bdrama(s)?\b|plays|theater|theatre/i,                                    SPECIFIC],
  ['Graphic Novel',               /graphic novel|comic book|comics|manga|sequential art/i,                    SPECIFIC],
  ['Illustrated',                 /illustrated|picture books for children/i,                                 SPECIFIC],

  // ── Theme and subject ─────────────────────────────────────────────────────
  ['Martial Arts',                /martial arts|samurai|kung fu/i,                                           SPECIFIC],
  ['Superhero Epic',              /superhero/i,                                                              SPECIFIC],
  ['Parenting & Motherhood',      /parenting|motherhood|mothers and daughters|new mothers/i,                 SPECIFIC],
  ['Children\'s Picture Book',    /picture book/i,                                                           SPECIFIC],
  // "children's fiction" was missing — the single commonest phrasing, on 281
  // books, while the rule listed three rarer ones.
  ['Children\'s Fiction',         /juvenile fiction|children's (fiction|stories|literature)|middle grade/i,   SPECIFIC],
  // NO reading-level pattern here, deliberately — it was tried and reverted.
  //
  // "Reading Level-Grade 11" is a TEXT DIFFICULTY measure, not a statement of
  // intended audience: adult literary novels carry grade 10-12 tags routinely.
  // Matching on it took Young Adult from 149 books to 367 on a catalogue that
  // is mostly adult gothic and horror, which means ~218 adult books were being
  // filed as YA. A wrong genre is worse than a missing one.
  ['Young Adult',                 /young adult|teen fiction|ya fiction/i,                                    SPECIFIC],
  ['Smutty Corner',               /erotica|erotic fiction/i,                                                 SPECIFIC],
  ['Dark Academia',               /dark academia/i,                                                          SPECIFIC],
  ['Court Intrigue',              /court intrigue|palace intrigue|royal court/i,                             SPECIFIC],
  ['War Fiction',                 /war stories|world war|military history fiction/i,                         SPECIFIC],
  ['Western',                     /western stories|westerns|cowboys/i,                                       SPECIFIC],
  ['Sports Fiction',              /sports fiction|baseball|boxing stories/i,                                 SPECIFIC],
  ['Music Fiction',               /music fiction|rock music fiction|musicians fiction/i,                     SPECIFIC],
  ['Aviation',                    /aviation|aeronautics|pilots/i,                                            SPECIFIC],
  ['Folklore',                    /folklore|folk tales|legends/i,                                            SPECIFIC],
  // Bare "adventure" appears on 191 books and is a genre claim in its own
  // right, not a nationality or a format. MID rather than SPECIFIC because it
  // also turns up as a mood word on children's and fantasy records.
  ['Adventure',                   /adventure stories|adventure fiction/i,                                    SPECIFIC],
  ['Adventure',                   /^adventure$/i,                                                            MID],
  ['Heist',                       /robbery fiction/i,                                                        SPECIFIC],
  ['Grief Memoir',                /bereavement|grief/i,                                                      SPECIFIC],
  ['Medical Narrative',           /medicine|physicians|illness narrative/i,                                  SPECIFIC],
  ['Dark Academia',               /secret societies/i,                                                       MID],

  // ── Region and tradition ──────────────────────────────────────────────────
  ['East Asian Literary Fiction', /japanese (literature|fiction)|korean (literature|fiction)|chinese (literature|fiction)|east asian literature/i, SPECIFIC],
  ['Irish Fiction',               /irish fiction|irish literature/i,                                         SPECIFIC],
  // Same reasoning as American Literature — "Spanish fiction" is a shelving
  // nationality, not a genre.
  ['Spanish Literature',          /spanish literature/i,                                                     SPECIFIC],
  ['Chicano & Latinx Fiction',    /chicano|latinx|mexican american fiction/i,                                SPECIFIC],
  // NOT bare "American fiction". Open Library uses that as a nationality
  // marker, not a genre claim — it appeared on 10% of a 100-book sample and
  // pushed American Literature above Historical Fiction, which is nonsense.
  // "American literature" as a subject is a real classification; "American
  // fiction" only says where the author lived.
  ['American Literature',         /american literature/i,                                                    MID],
  ['Victorian Fiction',           /victorian fiction|victorian literature/i,                                 SPECIFIC],

  // ══ Real genres with some overlap ═════════════════════════════════════════
  ['Fantasy Romance',             /fantasy romance|romantasy|paranormal romance/i,                           MID],
  ['Historical Romance',          /historical romance|regency romance/i,                                     MID],
  ['LGBTQ+ Romance',              /queer romance|gay romance|m\/m romance/i,                                 MID],
  ['LGBTQ+ Fiction',              /lgbt|gay fiction|queer fiction|transgender fiction/i,                     MID],
  ['Mystery',                     /mystery|detective|whodunit|amateur sleuth/i,                              MID],
  // "murder" on its own, 75 books. BROAD because it is genuinely ambiguous —
  // it sits on crime novels, but equally on literary fiction and horror where
  // a murder is the event rather than the puzzle. At BROAD any sharper rule
  // outranks it and it must appear early to score at all.
  ['Mystery',                     /^murder$/i,                                                               BROAD],
  ['Thriller',                    /thriller/i,                                                               MID],
  ['Suspense',                    /suspense/i,                                                               MID],
  ['Psychological Fiction',       /psychological (fiction|thriller|suspense)|unreliable narrator/i,          MID],
  ['Philosophical Fiction',       /philosophical fiction|existential fiction/i,                              MID],
  ['Existential',                 /existentialism/i,                                                         MID],
  ['Experimental & Avant-Garde',  /experimental fiction|avant-garde/i,                                       MID],
  ['Coming of Age',               /coming of age|bildungsroman/i,                                            MID],
  ['Historical Fiction',          /historical fiction|historical novel/i,                                    MID],
  ['Biography',                   /biography|autobiography|personal memoirs/i,                               MID],
  ['Memoir',                      /\bmemoir\b/i,                                                             MID],
  ['Comedy & Wit',                /humor|humour|comedy|comic novel/i,                                        MID],
  ['Satire',                      /satire|satirical/i,                                                       MID],
  ['Social Commentary',           /social commentary|social problem|social science/i,                        MID],
  ['Political Fiction',           /political fiction|politics fiction/i,                                     MID],
  ['Feminist Fiction',            /feminism|feminist/i,                                                      MID],
  ['Family Drama',                /family (saga|drama|life)|domestic fiction/i,                              MID],
  ['Identity & Belonging',        /immigrants|diaspora|assimilation|identity/i,                              MID],
  // "french fiction" / "indian fiction" carry the same nationality-marker risk
  // as the two above, but at far lower volume and International Fiction is
  // where a nationality tag genuinely belongs — so they stay, at MID.
  ['International Fiction',       /translations into english|african literature|russian literature|german literature|french fiction|indian fiction/i, MID],
  ['Intimate Fiction',            /sexuality|desire|sensual/i,                                               MID],
  ['Cult Fiction',                /cult fiction|counterculture/i,                                            MID],
  ['Literary Criticism',          /literary criticism|history and criticism/i,                               MID],
  ['Cultural Studies',            /cultural studies|popular culture/i,                                       MID],
  ['Art History',                 /art history|painting|sculpture/i,                                         MID],
  ['Theology',                    /theology|christianity|religion and philosophy/i,                          MID],
  ['Inspirational',               /inspirational|self-improvement|motivational/i,                            MID],

  // ══ Umbrellas. Only win when nothing sharper matched. ═════════════════════
  // 'translations' is deliberately absent: a translated book is not a classic,
  // and Open Library tags translations heavily. It used to score on every work
  // ever published in another language.
  ['Classics',                    /classics|classic literature|classic fiction|early works to 1800/i,        BROAD],
  ['Classic Literary Fiction',    /classic literary/i,                                                       BROAD],
  ['Horror',                      /horror/i,                                                                 BROAD],
  ['Gothic',                      /gothic/i,                                                                 BROAD],
  ['Supernatural',                /supernatural/i,                                                           BROAD],
  // "magic" alone appears on 167 books. BROAD, not MID, deliberately: it is
  // real evidence of fantasy but it also turns up on magical realism, stage
  // magic and children's picture books. At BROAD it needs to appear early to
  // clear MIN_GENRE_SCORE on its own, and any sharper rule outranks it.
  ['Fantasy',                     /fantasy|\bmagic\b/i,                                                      BROAD],
  ['Science Fiction',             /science fiction/i,                                                        BROAD],
  ['Speculative Fiction',         /speculative fiction/i,                                                    BROAD],
  ['Romance',                     /romance|love stor(y|ies)/i,                                               BROAD],
  // "Fiction / Literary" is Google's BISAC heading and "literary" alone is
  // Open Library's; together they sit on ~146 books that the natural-language
  // pattern missed entirely.
  ['Literary Fiction',            /literary fiction|literary collections|fiction \/ literary|^literary$/i,   BROAD],
  ['Contemporary Fiction',        /contemporary fiction|contemporary/i,                                      BROAD],
  // Anchored, and deliberately narrow.
  //
  // This rule previously matched bare `history`, `psychology` and `philosophy`
  // anywhere in a subject, which is close to catastrophic on Open Library data
  // — it tags literary criticism with exactly those words. "The Importance of
  // Being Earnest" was assigned Non-Fiction on the strength of "Identity
  // (Psychology)" and "History and criticism".
  //
  // Rules are tested per-subject, not against a joined blob, so anchoring with
  // ^...$ means "the subject IS Psychology", not "mentions psychology".
  // Google Books returns BISAC headings, which are unambiguous non-fiction
  // when they appear: "Education", "Science", "Language Arts & Disciplines",
  // "Business & Economics". Anchored so they must BE the subject, not merely
  // occur in one — "Science fiction" must never reach this rule.
  ['Non-Fiction',                 /\bnon-?fiction\b|self-help|true crime|popular science|^(psychology|history|philosophy|economics|sociology|education|science|mathematics|technology & engineering|language arts & disciplines|business & economics|health & fitness|political science|social science|true crime)$/i, BROAD],
  ['Philosophy',                  /^philosophy$/i,                                                           BROAD],
];

// ── Subject normalisation ────────────────────────────────────────────────────
//
// Library cataloguing inverts headings. Open Library returns "Fiction,
// historical" and "Fiction, psychological", never "Historical fiction" — and
// every rule here is written in natural reading order, so none of them matched.
// A full-catalogue run found 98 books tagged "fiction, historical" and 94
// tagged "fiction, psychological" sitting unplaced next to rules that describe
// them exactly.
//
// Adding an inverted twin for every rule would double the table and the next
// person would add one form and forget the other. Normalising the SUBJECT
// instead fixes the whole class at once: each subject is tested in its original
// form and with its comma-separated parts reversed.
//
//   "fiction, historical"                -> "historical fiction"
//   "fiction, historical, general"       -> "general historical fiction"
//   "fiction, psychological"             -> "psychological fiction"
//
// The reversal is a rotation, not a permutation — trying every ordering of a
// four-part heading generates noise that matches things it should not.
export function subjectVariants(subject) {
  const low = String(subject).toLowerCase().trim();
  if (!low.includes(',')) return [low];
  const parts = low.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return [low];
  const reversed = [...parts].reverse().join(' ');
  return reversed === low ? [low] : [low, reversed];
}

// True when any rule matches any variant of this subject.
function patternHits(pattern, subject) {
  return subjectVariants(subject).some((v) => pattern.test(v));
}

// ── Scoring ──────────────────────────────────────────────────────────────────
//
// Ties are common and were previously broken by Map insertion order, i.e. by
// where the rule happened to sit in the array — Poe scored Horror=12 and
// Mystery=12, Spinning Silver scored Fairy Tale Retelling=9 and Mythological
// Fantasy=9. Now: highest score, then whichever matched nearer the top of the
// subject list, then the more specific rule, then alphabetically. Fully
// determined, and by something meaningful rather than by array position.
//
// Position before specificity is deliberate and was arrived at from real data:
// ranking by specificity first handed Poe to Mystery even though his very first
// subject was "American Horror tales". Open Library orders subjects roughly by
// prominence, so earliest is the better signal of what a book actually is.
export function rankGenres(subjects) {
  const acc = new Map();
  (subjects || []).forEach((subject, i) => {
    const positionWeight = i < 6 ? 3 : i < 15 ? 2 : 1;
    for (const [genre, pattern, specificity] of GENRE_RULES) {
      if (!patternHits(pattern, subject)) continue;
      const prev = acc.get(genre) || { score: 0, spec: 0, firstPos: Infinity, hits: [] };
      prev.score += positionWeight * specificity;
      prev.spec = Math.max(prev.spec, specificity);
      prev.firstPos = Math.min(prev.firstPos, i);
      if (prev.hits.length < 3) prev.hits.push(subject);
      acc.set(genre, prev);
    }
  });

  return [...acc.entries()].sort((a, b) =>
    b[1].score - a[1].score ||
    a[1].firstPos - b[1].firstPos ||
    b[1].spec - a[1].spec ||
    a[0].localeCompare(b[0])
  );
}

// The single best genre, or null. Kept for books.genre, which is a scalar
// column other code still reads.
export function inferGenre(subjects) {
  const ranked = rankGenres(subjects);
  if (ranked.length === 0) return null;
  const [genre, { score }] = ranked[0];
  return score >= MIN_GENRE_SCORE ? genre : null;
}

// Every genre clearing the bar, best first, capped.
export function inferAllGenres(subjects, limit = MAX_GENRES_PER_BOOK) {
  return rankGenres(subjects)
    .filter(([, v]) => v.score >= MIN_GENRE_SCORE)
    .slice(0, limit)
    .map(([name]) => name);
}

// Used by --verbose so a surprising assignment can be understood without
// re-deriving it by hand. A diagnostic that hides the deciding input is worse
// than none.
export function explainGenre(subjects) {
  return rankGenres(subjects)
    .slice(0, 4)
    .map(([g, v]) => `${g}=${v.score} (${v.hits.join('; ')})`);
}

// ── Umbrellas ────────────────────────────────────────────────────────────────
//
// Applied ALONGSIDE the specific genre rather than instead of it (v0.63): a
// folk horror novel is "Folk Horror" AND "Horror", so the reader browsing the
// wide shelf and the reader browsing the narrow one both find it.
//
// The hierarchy comes from public.genres.parent_id, NOT from a second copy of
// it here. A map in this file would be a duplicate of the one in the database,
// and the two would disagree within a month.
//
// `parentByName` is { childName -> parentName }, built by the caller from one
// query. Umbrellas are appended after the specifics so that when the cap bites
// it removes an umbrella rather than the precise genre that earned the book its
// place — the specific one is the more useful of the two.
export function withUmbrellas(genreNames, parentByName, limit = MAX_GENRES_PER_BOOK) {
  const out = [...genreNames];
  const seen = new Set(genreNames);
  for (const name of genreNames) {
    const parent = parentByName?.get?.(name) ?? parentByName?.[name];
    if (parent && !seen.has(parent)) {
      seen.add(parent);
      out.push(parent);
    }
  }
  return out.slice(0, limit);
}

// True when ANY rule matches this subject string. Used by the report to find
// subjects nothing reads — the ranked list of those is what tells you which
// rule to write next, rather than guessing at what the catalogue contains.
export function ruleMatches(subject) {
  return GENRE_RULES.some(([, pattern]) => patternHits(pattern, subject));
}

// ── Drift guard ──────────────────────────────────────────────────────────────
//
// Every rule target must exist in public.genres. If one does not, the script
// will happily assign it and the result is invisible: the picker only offers
// names from that table, so no reader can select it and none of those books can
// be found. This has bitten before — four canonical names differed from the
// real genre by word order alone and stranded ~114 books.
//
// Reported, not thrown. A stale rule should not stop the rest of the run.
export function findGenreDrift(knownNames) {
  const known = knownNames instanceof Set ? knownNames : new Set(knownNames);
  return [...new Set(GENRE_RULES.map(([name]) => name))].filter((n) => !known.has(n));
}
