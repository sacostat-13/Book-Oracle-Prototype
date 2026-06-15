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
export const CURRENT_VERSION = 'v0.17';

export const RELEASES = [{
    version: 'v0.17',
    date: '2026-06-15',
    titleEn: 'Mobile-first experience',
    titleEs: 'Experiencia móvil primero',
    bodyEn: [
      'The navigation is now a hamburger menu on phones. Tap the icon in the top-right to open a full-screen menu with all sections. Tapping any item closes the menu and takes you straight there.',
      'The genre, category, and search filters on Wishlist and Library now stack vertically on mobile, with each dropdown and button taking the full screen width.',
      'Book detail sheets now slide up from the bottom on mobile rather than floating as a small card in the middle of the screen.',
    ],
    bodyEs: [
      'La navegación ahora es un menú hamburguesa en los teléfonos. Tocá el ícono en la esquina superior derecha para abrir un menú a pantalla completa con todas las secciones.',
      'Los filtros de género, categoría y búsqueda en la Lista y la Biblioteca ahora se apilan verticalmente en móvil, con cada menú desplegable y botón ocupando el ancho completo de la pantalla.',
      'Las fichas de detalle de libros ahora se deslizan desde abajo en móvil, en lugar de flotar como una tarjeta pequeña en el centro de la pantalla.',
    ],
  },
  {
    version: 'v0.16',
    date: '2026-06-15',
    titleEn: 'Series navigation fixed',
    titleEs: 'Navegación de sagas corregida',
    bodyEn: [
      'Series navigation now shows the correct number of books in the main sequence. Previously, Parable of the Sower would show 10 or 14 dots instead of 2 because Hardcover counts novellas and short stories alongside the main books.',
      'Bulk import no longer returns a study guide or multi-book compilation when you add an individual title. Adding “The Alchemyst” now reliably returns that book, not “Michael Scott’s: The Alchemyst, The Magician…”',
    ],
    bodyEs: [
      'La navegación de sagas ahora muestra el número correcto de libros en la secuencia principal. Antes, La Parábola del Sembrador mostraba 10 o 14 puntos en lugar de 2, porque Hardcover cuenta novelas cortas y cuentos junto a los libros principales.',
      'La importación masiva ya no devuelve una guía de estudio ni una compilación cuando agregás un título individual. Agregar “The Alchemyst” ahora devuelve ese libro de forma confiable.',
    ],
  },
  {
    version: 'v0.15',
    date: '2026-06-11',
    titleEn: 'The Oracle learns your genres',
    titleEs: 'El Oráculo aprende tus géneros',
    bodyEn: [
      'A new "☩ Let the Oracle categorize my books" button now appears on your Wishlist and Library whenever you have uncategorized books. Press it and the Oracle reads your books in batches, assigns canonical genres (Gothic & Haunted Houses, Sapphic & Feminist Gothic, Folk Horror…), and groups everything instantly — no manual tagging needed.',
      'Genres are now the backbone of both views. Your Wishlist and Library group books by Oracle-assigned genre, with two filter dropdowns: one for genres, one for your own personal categories. The genre filter only shows genres that are actually in your current view.',
      'The Oracle\'s "By genres" mode (previously "By categories") now draws from the same canonical genre catalog — so the temperament you pick when divining is the real genre, not a rough auto-detected label.',
      'The AI features of the app — book lookups, the Oracle\'s AI recommend mode, and reading plan generation — are now fully active.',
    ],
    bodyEs: [
      'Un nuevo botón "☩ Que el Oráculo categorice mis libros" aparece en tu Lista y Biblioteca cuando tenés libros sin categorizar. Presionalo y el Oráculo lee tus libros en grupos, asigna géneros canónicos (Gótico y Casas Encantadas, Gótico Sáfico y Feminista, Horror Rural…) y agrupa todo al instante — sin etiquetado manual.',
      'Los géneros son ahora la columna vertebral de ambas vistas. Tu Lista y Biblioteca agrupan los libros por género asignado por el Oráculo, con dos filtros desplegables: uno para géneros, uno para tus propias categorías. El filtro de géneros solo muestra los géneros que están realmente en tu vista actual.',
      'El modo "Por géneros" del Oráculo (antes "Por categorías") ahora usa el mismo catálogo de géneros canónicos — así que el temperamento que elegís al consultar es el género real, no una etiqueta detectada automáticamente.',
      'Las funciones de IA de la app — búsqueda de libros, el modo de recomendación por IA del Oráculo y la generación de planes de lectura — están ahora completamente activas.',
    ],
  },
  {
    version: 'v0.13.1',
    date: '2026-06-10',
    titleEn: 'Fix: switching tabs no longer resets the app',
    titleEs: 'Corrección: cambiar de pestaña ya no reinicia la app',
    bodyEn: [
      'Switching to another browser tab or app, then coming back, was causing the app to reload silently. Anything in progress — Bulk Import results, an open book modal, a half-filled form — got wiped. Fixed.',
      'Now the app stays exactly where you left it, no matter how long you\'re away.',
    ],
    bodyEs: [
      'Cambiar a otra pestaña del navegador o a otra app, y luego volver, hacía que la app se recargara silenciosamente. Todo lo que estabas haciendo — resultados de Importar varios, una ventana de libro abierta, un formulario a medio llenar — se perdía. Corregido.',
      'Ahora la app se queda exactamente donde la dejaste, sin importar cuánto tiempo estuviste fuera.',
    ],
  },
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
    date: '2026-06-10',
    titleEn: 'Your own categories',
    titleEs: 'Tus propias categorías',
    bodyEn: [
      'Tag any book with your own categories. Open a book and use the new "+ Add" button under "Categories" to type one in. The autocomplete suggests existing categories as you type, ranked by which ones have an editor\'s verification mark (☩) and how many readers use them.',
      'Your tags are private — only you see them. If our editors later mark a category as official, the gilt ☩ pill appears for everyone, but your personal tag survives independently.',
      'Up to 10 categories per book, so the pill row doesn\'t turn into a wall.',
      'The Wishlist filter dropdown now includes your categories alongside the built-in ones — filter your wishlist by "Cyberpunk" and see every book you\'ve tagged with it, regardless of how the book was originally categorized.',
      'Bonus: when a book is part of a series, you now see a Wikipedia-sourced description of the whole series in the modal — particularly helpful for long series where the per-book blurb assumes you already know the world.',
    ],
    bodyEs: [
      'Etiquetá cualquier libro con tus propias categorías. Abrí un libro y usá el nuevo botón "+ Agregar" bajo "Categorías" para escribir una. El autocompletado sugiere categorías que ya existen mientras escribís, ordenadas por las que tienen la marca de verificación de editor (☩) y por cuántos lectores las usan.',
      'Tus etiquetas son privadas — solo vos las ves. Si nuestros editores marcan después una categoría como oficial, la pastilla dorada ☩ aparece para todos, pero tu etiqueta personal sobrevive de forma independiente.',
      'Hasta 10 categorías por libro, para que la fila de pastillas no se vuelva un muro.',
      'El filtro de la Lista ahora incluye tus categorías junto a las predefinidas — filtrá tu lista por "Cyberpunk" y vas a ver todos los libros que etiquetaste así, sin importar cómo se categorizó el libro originalmente.',
      'Extra: cuando un libro forma parte de una saga, ahora ves una descripción de la saga completa tomada de Wikipedia en la ventana del libro — útil especialmente para sagas largas donde la reseña de cada libro asume que ya conocés el mundo.',
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