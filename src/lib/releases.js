// Release notes content. Hand-authored, bilingual, version-controlled.
//
// Rules of thumb:
//   - The popup is for end-users, not developers. Skip the schema/RPC
//     details — those live in the README. Talk about what the user
//     can now SEE or DO.
//   - Keep each release to 2-4 short bullets. The popup gets long fast
//     if every release is a wall of text.
//   - Order is reverse-chronological: newest first. The component does
//     not sort — it renders in array order.
//   - The `current` flag is computed by the component (matches CURRENT_VERSION
//     below), not set per entry.
//
// To add a new release: prepend a new object to RELEASES with the bilingual
// content, then bump CURRENT_VERSION. That's it.

// The version label shown as "current" — keep in sync with package.json and
// the README version line.
export const CURRENT_VERSION = 'v0.13';

export const RELEASES = [
  {
    version: 'v0.13',
    date: '2026-06-10',
    titleEn: 'Release notes, in your language',
    titleEs: 'Notas de versión, en tu idioma',
    bodyEn: [
      'You\'re looking at the new "What\'s new" popup. From now on, every release will be summarized here with a one-tap way to see all past releases.',
      'Fully bilingual — Spanish and English. The popup follows whichever language the rest of the app is in.',
      'The current version is always visible at the bottom of the About page.',
    ],
    bodyEs: [
      'Estás viendo la nueva ventana de "Novedades". A partir de ahora, cada versión se resumirá aquí con acceso de un toque al historial completo.',
      'Completamente bilingüe — español e inglés. La ventana sigue el idioma en el que esté el resto de la app.',
      'La versión actual siempre se ve al final de la página "Acerca de".',
    ],
  },
  {
    version: 'v0.12',
    date: '2026-06-15', // tentative — bump when shipped
    placeholder: true, // hidden until shipped
    titleEn: 'Your own categories',
    titleEs: 'Tus propias categorías',
    bodyEn: [
      '(Coming soon) Tag books with your own categories and search by them.',
    ],
    bodyEs: [
      '(Próximamente) Etiqueta libros con tus propias categorías y búscalos.',
    ],
  },
  {
    version: 'v0.11',
    date: '2026-06-10',
    titleEn: 'Ratings and categories, where they belong',
    titleEs: 'Calificaciones y categorías, donde corresponden',
    bodyEn: [
      'Open any book in your library and you\'ll now see your rating and notes right there, with an "Edit" button to change them without leaving the book.',
      'A new "Categories" section shows the book\'s genres as pills. Verified ones (curated by our editors) glow gilt; auto-detected ones are dimmer.',
      'Descriptions sourced from Wikipedia now show a small "from wikipedia ↗" link so you can read more.',
    ],
    bodyEs: [
      'Al abrir cualquier libro de tu biblioteca, ahora verás tu calificación y notas ahí mismo, con un botón "Editar" para cambiarlas sin salir del libro.',
      'Una nueva sección "Categorías" muestra los géneros del libro como pastillas. Las verificadas (curadas por nuestros editores) brillan en dorado; las detectadas automáticamente son más tenues.',
      'Las descripciones provenientes de Wikipedia ahora muestran un pequeño enlace "from wikipedia ↗" para leer más.',
    ],
  },
  {
    version: 'v0.10',
    date: '2026-06-09',
    titleEn: 'Better descriptions, thanks to Wikipedia',
    titleEs: 'Mejores descripciones, gracias a Wikipedia',
    bodyEn: [
      'When other sources have nothing or only a short blurb to say about a book, we now pull a richer description from Wikipedia.',
      'For Spanish-language users, we check Spanish Wikipedia first — coverage of translated and Latin American titles is surprisingly good.',
      'No setup required. Existing books refresh automatically the next time you open them.',
    ],
    bodyEs: [
      'Cuando las otras fuentes no tienen nada o sólo una reseña corta sobre un libro, ahora extraemos una descripción más rica de Wikipedia.',
      'Para usuarios en español, consultamos primero la Wikipedia en español — la cobertura de títulos traducidos y latinoamericanos es sorprendentemente buena.',
      'No requiere configuración. Los libros existentes se actualizan automáticamente la próxima vez que los abras.',
    ],
  },
  {
    version: 'v0.9',
    date: '2026-06-09',
    titleEn: 'Rate your books, bulk-add to library',
    titleEs: 'Califica tus libros, agrega varios a la biblioteca',
    bodyEn: [
      'Books in your library can now be rated from 1 to 5 stars, with optional private notes. Tap the star icon on any library row to rate.',
      'A "⇪ Bulk add" button on the Library lets you import read books via Goodreads CSV (one-time), pasted titles, or Amazon URLs.',
      'Ratings from Goodreads imports are preserved.',
    ],
    bodyEs: [
      'Los libros en tu biblioteca ahora se pueden calificar de 1 a 5 estrellas, con notas privadas opcionales. Toca el ícono de estrella en cualquier fila de la biblioteca para calificar.',
      'Un botón "⇪ Importar varios" en la Biblioteca te permite agregar libros leídos vía CSV de Goodreads (una sola vez), títulos pegados o URLs de Amazon.',
      'Las calificaciones de la importación de Goodreads se preservan.',
    ],
  },
  {
    version: 'v0.8.1',
    date: '2026-06-09',
    titleEn: 'Fix: series with colon-titled volumes',
    titleEs: 'Corrección: series con volúmenes que llevan dos puntos',
    bodyEn: [
      'Adding books like "Fabius Bile: Clonelord" and "Fabius Bile: Manflayer" was returning identical data for every volume — same cover, same description, same page count. Fixed.',
      'Every series that uses a "Series Name: Volume Title" convention (Warhammer, military SF, Star Wars novels…) is now handled correctly.',
    ],
    bodyEs: [
      'Al agregar libros como "Fabius Bile: Clonelord" y "Fabius Bile: Manflayer", todos los volúmenes recibían datos idénticos — misma portada, misma descripción, mismo conteo de páginas. Corregido.',
      'Todas las series que usan la convención "Nombre: Título del Volumen" (Warhammer, ciencia ficción militar, novelas de Star Wars…) ahora se manejan correctamente.',
    ],
  },
  {
    version: 'v0.8',
    date: '2026-05-28',
    titleEn: 'Penguin Random House integration',
    titleEs: 'Integración con Penguin Random House',
    bodyEn: [
      'Penguin Random House joins Hardcover and OpenLibrary as a metadata source. PRH is especially good at Spanish-language and Latin American titles.',
      'Lookups now run all three sources in parallel and merge the results.',
      'Bulk import gained a "duplicate" detector that catches the same book whether you typed the original title or a translation.',
    ],
    bodyEs: [
      'Penguin Random House se suma a Hardcover y OpenLibrary como fuente de metadatos. PRH es especialmente bueno en títulos en español y latinoamericanos.',
      'Las búsquedas ahora consultan las tres fuentes en paralelo y combinan los resultados.',
      'La importación masiva ahora detecta duplicados aunque escribas el título original o una traducción.',
    ],
  },
  {
    version: 'v0.7',
    date: '2026-05-12',
    titleEn: 'Reading plans, manual book entry',
    titleEs: 'Planes de lectura, agregar libros manualmente',
    bodyEn: [
      'A new Reading Plan flow: tell the Oracle where you want to go, and it builds you a paced 3-12 month path.',
      'You can now add books to your wishlist by hand — title, author, optional Amazon URL — without going through any external search.',
    ],
    bodyEs: [
      'Un nuevo flujo de Plan de Lectura: dile al Oráculo a dónde quieres ir, y te construye un camino paseado de 3 a 12 meses.',
      'Ahora puedes agregar libros a tu lista de deseos a mano — título, autor, URL opcional de Amazon — sin pasar por ninguna búsqueda externa.',
    ],
  },
  {
    version: 'v0.6',
    date: '2026-04-30',
    titleEn: 'The Vault: a curated catalog',
    titleEs: 'La Bóveda: un catálogo curado',
    bodyEn: [
      'A separate "Vault" view shows the curated catalog — books our editors have verified. The Oracle can now draw from your wishlist OR the Vault.',
      'Verified books and series carry a "☩ Verified" badge so you know which data we trust.',
    ],
    bodyEs: [
      'Una vista separada "Bóveda" muestra el catálogo curado — libros que nuestros editores han verificado. El Oráculo ahora puede consultar tu lista de deseos O la Bóveda.',
      'Los libros y series verificados llevan una insignia "☩ Verificado" para que sepas en qué datos confiar.',
    ],
  },
  {
    version: 'v0.5',
    date: '2026-04-15',
    titleEn: 'Spanish translation',
    titleEs: 'Traducción al español',
    bodyEn: [
      'The entire app is now available in Spanish. Switch languages from the toggle in the top bar.',
      'Share-friendly URLs: append "?lang=es" or "?lang=en" to force a language for the link recipient.',
    ],
    bodyEs: [
      'La app completa ya está disponible en español. Cambia de idioma desde el interruptor en la barra superior.',
      'URLs compartibles: agrega "?lang=es" o "?lang=en" para forzar un idioma para quien reciba el enlace.',
    ],
  },
  {
    version: 'v0.4',
    date: '2026-03-28',
    titleEn: 'Cross-device sync via Supabase',
    titleEs: 'Sincronización entre dispositivos vía Supabase',
    bodyEn: [
      'Sign in with Google and your wishlist, library, and reading plan now sync across every device you use.',
      'Books you\'ve added are private to you; the catalog of books themselves is shared so the app gets smarter over time.',
    ],
    bodyEs: [
      'Inicia sesión con Google y tu lista de deseos, biblioteca y plan de lectura se sincronizan en todos tus dispositivos.',
      'Los libros que agregas son privados; el catálogo de libros en sí es compartido para que la app sea más inteligente con el tiempo.',
    ],
  },
  {
    version: 'v0.3',
    date: '2026-03-10',
    titleEn: 'The Oracle',
    titleEs: 'El Oráculo',
    bodyEn: [
      'Two new ways to discover books: "By categories" (draws three books from a temperament you choose) and "By similar books" (pick 1-3 books you\'ve loved, get five kindred ones).',
      'AI mode goes beyond your wishlist — it can recommend any book in world literature based on your taste.',
    ],
    bodyEs: [
      'Dos nuevas formas de descubrir libros: "Por categorías" (extrae tres libros del temperamento que elijas) y "Por libros similares" (escoge 1-3 libros que has amado, recibe cinco afines).',
      'El modo IA va más allá de tu lista de deseos — puede recomendar cualquier libro de la literatura mundial según tu gusto.',
    ],
  },
  {
    version: 'v0.2',
    date: '2026-02-22',
    titleEn: 'Reading history from Goodreads',
    titleEs: 'Historial de lectura desde Goodreads',
    bodyEn: [
      'Import your Goodreads library during onboarding to start with all your history already in place. Ratings come along for the ride.',
      'Books you\'ve read fill the shelves on your dashboard so they\'re visible at a glance.',
    ],
    bodyEs: [
      'Importa tu biblioteca de Goodreads durante la configuración inicial para empezar con todo tu historial ya en su lugar. Las calificaciones vienen incluidas.',
      'Los libros que has leído llenan los estantes de tu panel para que estén visibles de un vistazo.',
    ],
  },
  {
    version: 'v0.1',
    date: '2026-02-05',
    titleEn: 'First release',
    titleEs: 'Primera versión',
    bodyEn: [
      'Wishlist, library, and a curated catalog of ~280 books in horror, gothic, and literary fiction. Built for readers who want a quieter home for their reading than the algorithm-driven alternatives.',
    ],
    bodyEs: [
      'Lista de deseos, biblioteca y un catálogo curado de ~280 libros de horror, gótico y ficción literaria. Construido para lectores que quieren un hogar más tranquilo para su lectura que las alternativas impulsadas por algoritmos.',
    ],
  },
];

// Filter out placeholder entries (future releases we've sketched but not shipped).
export function publishedReleases() {
  return RELEASES.filter((r) => !r.placeholder);
}

// Find a release by version string. Returns null if not found.
export function findRelease(version) {
  return RELEASES.find((r) => r.version === version) || null;
}
