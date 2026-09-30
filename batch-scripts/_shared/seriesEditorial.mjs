// seriesEditorial.mjs — hand-checked descriptions for the series pages that
// carry the site's search visibility.
//
// Scope: the top series by Search Console impressions (performance-2026-09-07,
// series-diagnostic-2026-09-08) plus the series named in the query exports
// (witcher, narnia, dune, dresden). Two left out on purpose:
//   - "Wicked"   — the catalog row conflates several different "Wicked" series
//                  (performance-2026-09-08 list-integrity); a description would
//                  describe the wrong one for some of its volumes.
//   - Theo Cray  — too thin a shelf to be worth a page yet.
//
// RULES FOR EDITING THIS FILE
//   * First sentence answers the query: what it is, who wrote it, where to
//     start. It is what the meta description keeps (~160–200 chars).
//   * No volume COUNT for anything still being published — the page already
//     prints series.total_books as its own sentence, and two counts that can
//     drift apart is how "3" ended up above a one-book list.
//   * Facts only. If a year or title is not certain, leave it out.
//   * No jacket-copy phrasing lifted from publishers or Goodreads.
//
// Consumed by batch-scripts/manual/seriesEditorialApply.mjs, which emits the
// SQL. `name` is matched through public.normalize_series_name(), the same
// function the pages resolve URLs with.

export const SERIES_EDITORIAL = [
  {
    name: 'Crescent City',
    description:
      "Crescent City is Sarah J. Maas's adult urban-fantasy series, starting with House of Earth and Blood. " +
      'Bryce Quinlan, half-human and half-fae, and the fallen angel Hunt Athalar hunt a killer through Lunathion, a modern city of angels, shifters, witches and fae ruled by the Asteri. ' +
      'The third book crosses into the world of A Court of Thorns and Roses, so many readers finish that series first.',
  },
  {
    name: 'Dragonlance Chronicles',
    description:
      'The Dragonlance Chronicles are the trilogy by Margaret Weis and Tracy Hickman that launched Dragonlance: Dragons of Autumn Twilight, Dragons of Winter Night and Dragons of Spring Dawning. ' +
      'A band of old companions from the town of Solace — among them Tanis Half-Elven and the twins Raistlin and Caramon — are drawn into the War of the Lance on Krynn. ' +
      'It is the usual starting point for the wider Dragonlance line, and the Legends trilogy follows it directly.',
  },
  {
    name: 'Fablehaven',
    description:
      "Fablehaven is Brandon Mull's middle-grade fantasy series, beginning with Fablehaven. " +
      "Siblings Kendra and Seth Sorenson discover that their grandparents' estate is a hidden refuge for magical creatures, and that keeping it hidden is dangerous work. " +
      'The story continues in the sequel series Dragonwatch.',
  },
  {
    name: 'Hyperion Cantos',
    description:
      "The Hyperion Cantos is Dan Simmons's science-fiction series of four novels: Hyperion, The Fall of Hyperion, Endymion and The Rise of Endymion. " +
      'Hyperion follows seven pilgrims travelling to the Time Tombs and the Shrike, each telling their own story on the way. ' +
      'The four read as two linked pairs, and the Endymion books are set generations after the first two.',
  },
  {
    name: 'Marvel Zombies',
    description:
      'Marvel Zombies is a run of comic limited series set on an alternate Earth where a virus has turned its superheroes into flesh-eating zombies. ' +
      "It began with Robert Kirkman and Sean Phillips's 2005–06 series, which grew out of a storyline in Ultimate Fantastic Four, and was followed by a long line of sequels and spin-offs. " +
      'Collected editions and single issues overlap, so read in the order listed here.',
  },
  {
    name: 'Red Rising Saga',
    description:
      "The Red Rising Saga is Pierce Brown's science-fiction series set in a colour-coded caste society spread across the solar system. " +
      'Darrow, a Red miner on Mars, is remade to pass as a Gold and infiltrate the ruling class. ' +
      'Red Rising, Golden Son and Morning Star form the original trilogy; a second arc, set ten years later, begins with Iron Gold.',
  },
  {
    name: 'The Godfather',
    description:
      "The Godfather series begins with Mario Puzo's 1969 novel about Vito Corleone and the family he rules. " +
      "Mark Winegardner continued it with The Godfather Returns and The Godfather's Revenge, and Ed Falco's The Family Corleone is a prequel set in the 1930s, adapted from a screenplay by Puzo.",
  },
  {
    name: 'Robert Langdon',
    description:
      "Robert Langdon is Dan Brown's series of thrillers following a Harvard professor of symbology: Angels & Demons, The Da Vinci Code, The Lost Symbol, Inferno, Origin and The Secret of Secrets. " +
      'Each book is a self-contained mystery and can be read alone, but Angels & Demons comes first, and reading in order lets Langdon\'s history accumulate.',
  },
  {
    name: 'Malazan Book of the Fallen',
    description:
      "Malazan Book of the Fallen is Steven Erikson's ten-novel epic fantasy, from Gardens of the Moon to The Crippled God. " +
      'It follows soldiers, gods and empires across several continents, often jumping between storylines from one book to the next. ' +
      "Ian C. Esslemont's Novels of the Malazan Empire are set in the same world and can be read alongside it.",
  },
  {
    name: 'The Shepherd King',
    description:
      "The Shepherd King is Rachel Gillig's gothic fantasy duology: One Dark Window and Two Twisted Crowns. " +
      'Elspeth Spindle shares her mind with an ancient voice she calls the Nightmare, in a kingdom walled in by a poisonous Mist and ruled through twelve magic cards.',
  },
  {
    name: 'Hellboy',
    description:
      "Hellboy is Mike Mignola's comic series, published by Dark Horse since 1994, about a demon summoned to Earth in 1944 who grows up to investigate the occult for the Bureau for Paranormal Research and Defense. " +
      'It anchors a shared universe that includes B.P.R.D. and Hellboy and the B.P.R.D., and those later series fill in earlier years of his life — so publication order and chronological order are not the same.',
  },
  {
    name: 'Night Lords',
    description:
      "Night Lords is Aaron Dembski-Bowden's Warhammer 40,000 trilogy: Soul Hunter, Blood Reaver and Void Stalker. " +
      'It follows Talos and his squad, First Claw, a warband of Chaos Space Marines from a Legion that fights through terror, long after the Horus Heresy.',
  },
  {
    name: 'Tiffany Aching',
    description:
      "Tiffany Aching is the part of Terry Pratchett's Discworld written for younger readers, in five books from The Wee Free Men to The Shepherd's Crown, Pratchett's final novel. " +
      'A farm girl from the Chalk trains as a witch, with the help — and hindrance — of the Nac Mac Feegle. It can be read without any other Discworld book.',
  },
  {
    name: 'The Witcher',
    description:
      "The Witcher is Andrzej Sapkowski's fantasy series about Geralt of Rivia, a monster hunter for hire. " +
      'Start with the two story collections, The Last Wish and Sword of Destiny, which introduce Geralt, Yennefer and Ciri; the five-novel saga begins with Blood of Elves. ' +
      'Season of Storms is a later standalone set between the early stories.',
  },
  {
    name: 'The Chronicles of Narnia',
    description:
      "The Chronicles of Narnia are C. S. Lewis's seven children's fantasy novels, published between 1950 and 1956. " +
      "There are two reading orders: the order they were published, beginning with The Lion, the Witch and the Wardrobe, and the story's internal chronology, beginning with The Magician's Nephew, which most modern editions use for their numbering.",
  },
  {
    name: 'Dune',
    description:
      "Dune is Frank Herbert's science-fiction saga of six novels, from Dune (1965) to Chapterhouse: Dune (1985). " +
      'It begins with Paul Atreides on the desert planet Arrakis, the only source of the spice that makes interstellar travel possible, and spans thousands of years. ' +
      'Brian Herbert and Kevin J. Anderson later wrote many prequels and sequels, which are separate from the original six.',
  },
  {
    name: 'The Dresden Files',
    description:
      "The Dresden Files is Jim Butcher's urban-fantasy series about Harry Dresden, a wizard working as a private investigator in Chicago, beginning with Storm Front. " +
      'The early books are close to standalone cases; the larger story builds steadily from there. ' +
      'Short fiction is collected in Side Jobs and Brief Cases.',
  },
  {
    name: 'Dungeon Crawler Carl',
    description:
      "Dungeon Crawler Carl is Matt Dinniman's LitRPG series. " +
      "After Earth's surface is destroyed for an alien game show, Carl and his ex-girlfriend's cat, Princess Donut, fight their way down through a deadly dungeon — broadcast to the galaxy.",
  },
  {
    name: 'The Broken Earth',
    description:
      "The Broken Earth is N. K. Jemisin's fantasy trilogy: The Fifth Season, The Obelisk Gate and The Stone Sky. " +
      'On a continent wracked by catastrophic seasons, a woman who can command the earth searches for her daughter. ' +
      'Each of the three won the Hugo Award for Best Novel, in three consecutive years.',
  },
  {
    name: 'Locke & Key',
    description:
      "Locke & Key is Joe Hill and Gabriel Rodríguez's horror-fantasy comic, collected in six volumes beginning with Welcome to Lovecraft. " +
      'After their father is murdered, the Locke children move into Keyhouse, a family home full of magical keys — and something in it wants them.',
  },
  {
    name: 'Empire of the Vampire',
    description:
      "Empire of the Vampire is Jay Kristoff's dark fantasy series set in a world where the sun has failed and vampires rule. " +
      'Gabriel de León, the last of an order of holy warriors, tells his story to a vampire historian from a prison cell.',
  },
  {
    name: 'Saga',
    description:
      "Saga is Brian K. Vaughan and Fiona Staples's space-opera comic from Image, running since 2012. " +
      'Alana and Marko, soldiers from two sides of an endless war, run away together with their newborn daughter, Hazel, who narrates the story. ' +
      'It is collected in numbered volumes, which is the easiest way to read it in order.',
  },
  {
    name: 'Earthseed',
    description:
      "Earthseed is Octavia E. Butler's pair of novels, Parable of the Sower and Parable of the Talents. " +
      'In a collapsing near-future America, Lauren Olamina, a young woman with hyperempathy, leaves her walled community and founds a new belief system. ' +
      'Butler planned further books but did not complete them.',
  },
  {
    name: 'Will Trent',
    description:
      "Will Trent is Karin Slaughter's crime series about a Georgia Bureau of Investigation agent, beginning with Triptych. " +
      "From Undone on, it merges with characters from her Grant County books, so readers who want the full picture read Grant County first.",
  },
  {
    name: 'The Sandman',
    description:
      "The Sandman is Neil Gaiman's comic about Dream of the Endless, published by DC's Vertigo line from 1989 to 1996 and collected in ten volumes beginning with Preludes & Nocturnes. " +
      'Later additions such as Overture, a prequel, are best read after the main ten.',
  },
];
