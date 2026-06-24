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
export const CURRENT_VERSION = 'v0.35.1';

export const RELEASES = [
  {
    version: 'v0.35.1',
    date: '2026-06-24',
    titleEn: 'Bug fix — book not removed from Reading Next when started',
    titleEs: 'Corrección — libro no se eliminaba de Leer después al empezar a leer',
    bodyEn: [
      'Fixed a bug where starting to read a book left it stranded in the Reading Next queue. The authenticated path in startReading was adding the book to Currently Reading but missing the readNext filter that the guest path had. The book now correctly disappears from Reading Next the moment you start it.',
      'As a safeguard, the app now also cleans up stale Reading Next entries on login — any book already in Currently Reading or your Library is automatically removed from the queue, fixing existing affected profiles without manual intervention.',
    ],
    bodyEs: [
      'Se corrigió un error donde empezar a leer un libro lo dejaba varado en la cola de Leer después. El camino autenticado en startReading agregaba el libro a Leyendo ahora pero le faltaba el filtro de readNext que sí tenía el camino de invitado. El libro ahora desaparece correctamente de Leer después en el momento en que empezás a leerlo.',
      'Como medida de seguridad, la app ahora también limpia entradas desactualizadas en Leer después al iniciar sesión — cualquier libro que ya esté en Leyendo ahora o en tu Biblioteca se elimina automáticamente de la cola, corrigiendo los perfiles afectados existentes sin intervención manual.',
    ],
  },
  {
    version: 'v0.35',
    date: '2026-06-24',
    titleEn: 'Customizable dashboard & reading challenge',
    titleEs: 'Panel personalizable y desafío de lectura',
    bodyEn: [
      'The dashboard is now fully customizable. A gear icon in the header opens a settings sheet where you can show or hide any widget and reorder them with up/down arrows.',
      'New Oracle Spark widget: one tap picks a surprising book from your wishlist using the Oracle AI. Uses one quota slot like any other Oracle call.',
      'New Reading Challenge: set an annual book goal on your Profile page and track it across both a dedicated widget and the full-featured challenge section on your profile, complete with a pace marker showing whether you\'re ahead or behind.',
      'New Reading Stats widget shows your total books, pace per month, and total pages at a glance.',
      'New Series in Progress widget surfaces your unfinished series with individual progress bars.',
      'New Reading Streak widget counts consecutive months with at least one book finished.',
      'Widget visibility and order are saved to your profile and sync across devices.',
    ],
    bodyEs: [
      'El panel ahora es completamente personalizable. Un ícono de engranaje en el encabezado abre un panel donde podés mostrar u ocultar widgets y reordenarlos con flechas arriba/abajo.',
      'Nuevo widget Chispa del Oráculo: con un toque, el Oráculo elige un libro sorpresa de tu lista de deseos. Usa un cupo de llamada como cualquier otra función del Oráculo.',
      'Nuevo Desafío de lectura: establecé una meta anual de libros en tu Perfil y seguí tu progreso con un marcador de ritmo que indica si estás adelante o atrás.',
      'Nuevo widget de Estadísticas muestra tus libros totales, ritmo mensual y páginas de un vistazo.',
      'Nuevo widget de Series en progreso muestra tus series incompletas con barras de progreso individuales.',
      'Nuevo widget de Racha de lectura cuenta los meses consecutivos con al menos un libro terminado.',
      'La visibilidad y el orden de los widgets se guardan en tu perfil y se sincronizan entre dispositivos.',
    ],
  },
  {
    version: 'v0.34',
    date: '2026-06-24',
    titleEn: 'Design system overhaul',
    titleEs: 'Renovación del sistema de diseño',
    bodyEn: [
      'Light mode is now a warm parchment theme instead of a mechanical colour inversion. Text contrast passes WCAG AA across all surfaces.',
      'Finishing, starting, wishlisting and planning events in the Dashboard feed each have a distinct colour accent bar and icon, making your reading history scannable at a glance.',
      'Book series with more than 6 entries now show a sleek progress track instead of crowded numbered dots. Short series dots have been updated with clearer status colours.',
      'Font sizes across the app now respect a 12px minimum — small labels in the feed, similar books grid, and chart have all been brought up to the floor.',
    ],
    bodyEs: [
      'El modo claro ahora es un tema de pergamino cálido en lugar de una inversión mecánica de colores. El contraste de texto cumple WCAG AA en todas las superficies.',
      'Los eventos del feed del Panel — terminar, empezar, agregar a lista de deseos y planificar — tienen ahora una barra de acento y un ícono de color distinto, haciendo tu historial de lectura escaneable de un vistazo.',
      'Las series de libros con más de 6 entregas ahora muestran una barra de progreso elegante en lugar de puntos numerados apretados. Los puntos de series cortas se actualizaron con colores de estado más claros.',
      'Los tamaños de fuente en la app ahora respetan un mínimo de 12px — las etiquetas pequeñas en el feed, la grilla de libros similares y el gráfico se ajustaron al límite.',
    ],
  },
  {
    version: 'v0.33.1',
    date: '2026-06-24',
    titleEn: 'Bug fixes — series navigation & feed',
    titleEs: 'Correcciones — navegación de series y actividad',
    bodyEn: [
      'Finishing a book now correctly appears in the Dashboard activity feed. The feed was reading the wrong date field (readAt instead of dateRead), so completed books were silently omitted.',
      'Series navigation from a Book Page no longer shows "Not Found" for books outside your collection. Every series dot now carries a book snapshot in the URL so the page can render immediately.',
      'Going back in browser history after visiting a series book now restores the previous page correctly instead of staying broken until a refresh.',
      'Fixed an infinite loop that hammered the Wikipedia function whenever a Book Page or Book Modal was open. The useEffect dependency arrays were watching object references that changed on every render, causing series data to be re-fetched endlessly.',
      'Book Page now shows your star rating, reading notes, and personal categories — previously these were only visible in the modal. You can also edit your rating directly from the Book Page.',
      'Profile reading chart now shows a tooltip on hover and a book list when you click any month bar.',
      'Oracle Categories toggle group is no longer invisible in light mode (was hardcoded to a near-black background).',
    ],
    bodyEs: [
      'Terminar un libro ahora aparece correctamente en el feed de actividad del Panel. El feed leía el campo de fecha equivocado (readAt en lugar de dateRead), por lo que los libros completados no se mostraban.',
      'La navegación de series desde una Página de libro ya no muestra "No encontrado" para libros fuera de tu colección. Cada punto de la serie ahora lleva un resumen del libro en la URL para que la página pueda renderizarse de inmediato.',
      'Retroceder en el historial del navegador después de visitar un libro de una serie ahora restaura la página anterior correctamente en lugar de quedarse roto hasta recargar.',
      'Se corrigió un bucle infinito que saturaba la función de Wikipedia cuando una Página de libro o Modal de libro estaba abierta. Los arrays de dependencias de useEffect observaban referencias de objetos que cambiaban en cada render, causando que los datos de la serie se recargaran indefinidamente.',
      'La Página de libro ahora muestra tu calificación con estrellas, notas de lectura y categorías personales — antes solo eran visibles en el modal. También podés editar tu calificación directamente desde la Página de libro.',
      'El gráfico de lectura en el Perfil ahora muestra un tooltip al pasar el cursor y una lista de libros al hacer clic en cualquier barra mensual.',
      'El grupo de botones de Categorías del Oráculo ya no es invisible en modo claro (tenía un fondo casi negro fijo en el código).',
    ],
  },
  {
    version: 'v0.33',
    date: '2026-06-23',
    titleEn: 'Subscription polish',
    titleEs: 'Ajustes a la suscripción',
    bodyEn: [
      'Oracle usage is now tracked for all users, including Pro. Previously, Pro accounts never incremented the monthly counter, making it impossible to monitor AI costs per user.',
      'Fixed a bug where the quota counter reset to its starting value on every page refresh. The Netlify function was firing consume_oracle_call as a fire-and-forget call that the Lambda killed before it completed — it is now awaited correctly.',
      'Stripe webhook events now handle the newer Stripe API shape (2026-05-27). The invoice.payment_succeeded and checkout.session.completed handlers were updated to find user_id and subscription ID in their new nested locations.',
      'The subscription tier badge in Profile now refreshes automatically when you switch back to the tab — useful when a webhook fires or a DB change is made while the app is open.',
      'Fixed a React rendering error where refreshQuota was called during render on return from Stripe Checkout. Moved to a useEffect with polling (immediate, 2s, 5s) to handle webhook delivery delay.',
    ],
    bodyEs: [
      'El uso del Oráculo ahora se registra para todos los usuarios, incluidos los Pro. Antes, las cuentas Pro nunca incrementaban el contador mensual, haciendo imposible monitorear los costos de IA por usuario.',
      'Se corrigió un error donde el contador de cuota se reiniciaba en cada recarga de página. La función de Netlify ejecutaba consume_oracle_call sin esperar la respuesta — ahora se espera correctamente.',
      'Los eventos del webhook de Stripe ahora manejan la nueva estructura de la API de Stripe (2026-05-27). Los manejadores de invoice.payment_succeeded y checkout.session.completed fueron actualizados para encontrar user_id e ID de suscripción en sus nuevas ubicaciones anidadas.',
      'El indicador de nivel de suscripción en el Perfil ahora se actualiza automáticamente al volver a la pestaña — útil cuando llega un webhook o se hace un cambio en la DB mientras la app está abierta.',
      'Se corrigió un error de renderizado de React donde refreshQuota era llamada durante el renderizado al volver de Stripe Checkout. Se movió a un useEffect con reintentos (inmediato, 2s, 5s) para manejar el retraso en la entrega del webhook.',
    ],
  },
  {
    version: 'v0.32',
    date: '2026-06-23',
    titleEn: 'The Oracle has a price',
    titleEs: 'El Oráculo tiene un precio',
    bodyEn: [
      'Free accounts now include 5 AI calls per month — shared across Oracle draws, reading plans, book categorization, and all other AI features. The counter resets on the first of each month.',
      'A Pro plan ($5/month) unlocks unlimited AI usage across everything. Upgrade from your Profile page. Stripe handles all payments — we never store card details.',
      'Your subscription tier is shown clearly in Profile with a usage bar, reset date, and a direct link to manage or cancel via the Stripe customer portal.',
      'The dashboard now shows an AI usage widget so you always know how many calls remain without having to navigate away.',
    ],
    bodyEs: [
      'Las cuentas gratuitas ahora incluyen 5 consultas de IA por mes — compartidas entre el Oráculo, planes de lectura, categorización de libros y todas las demás funciones de IA. El contador se renueva el primero de cada mes.',
      'El plan Pro ($5/mes) desbloquea uso ilimitado de IA en todo. Mejorá desde tu perfil. Stripe maneja todos los pagos — nunca almacenamos datos de tarjetas.',
      'Tu nivel de suscripción se muestra claramente en el perfil con una barra de uso, fecha de renovación y un enlace directo para gestionar o cancelar desde el portal de clientes de Stripe.',
      'El panel ahora muestra un widget de uso de IA para que siempre sepas cuántas consultas te quedan sin tener que navegar a otro lado.',
    ],
  },
  {
    version: 'v0.31',
    date: '2026-06-22',
    titleEn: 'Every word, in your language',
    titleEs: 'Cada palabra, en tu idioma',
    bodyEn: [
      'The app is now fully bilingual. Every button, label, confirmation dialog, empty state, and status message across all 47 screens has been wired to the translation system — nothing is hardcoded in English anymore.',
      'Spanish uses Costa Rican vos conventions throughout, not generic Latin American Spanish. The 697 original key pairs grew to 930 to cover strings that previously existed only in code.',
      'The language toggle (in the ··· menu) now switches everything instantly. Your preference persists across sessions and can also be set via the ?lang=es URL parameter.',
    ],
    bodyEs: [
      'La app es ahora completamente bilingüe. Cada botón, etiqueta, diálogo de confirmación, estado vacío y mensaje de estado en las 47 pantallas está conectado al sistema de traducción — ya nada está escrito en inglés de forma fija.',
      'El español usa las convenciones del vos costarricense en toda la app, no español latinoamericano genérico. Los 697 pares de claves originales crecieron a 930 para cubrir textos que antes solo existían en el código.',
      'El selector de idioma (en el menú ···) ahora cambia todo al instante. Tu preferencia se guarda entre sesiones y también se puede establecer con el parámetro de URL ?lang=es.',
    ],
  },
  {
    version: 'v0.30',
    date: '2026-06-20',
    titleEn: 'Under the hood',
    titleEs: 'Bajo el capó',
    bodyEn: [
      'This release is all internal: no new features, but the codebase is cleaner and more reliable going forward.',
      'The stylesheet has been reorganised into a proper architecture — tokens, reset, layout, components, and pages each live in their own folder. Editing a button style now means opening one file, not hunting through a flat pile of partials.',
      'Light mode is now available. Tap the theme toggle in the navigation to switch — the app remembers your preference and respects your OS setting on first visit.',
      'A routing bug that caused book pages to break when the app language was set to Spanish has been fixed. The issue only affected local development, but it was annoying enough to squash now.',
    ],
    bodyEs: [
      'Esta versión es completamente interna: sin funciones nuevas, pero el código está más limpio y confiable de aquí en adelante.',
      'Las hojas de estilo se reorganizaron en una arquitectura ordenada — tokens, reset, layout, componentes y páginas cada uno en su propia carpeta. Editar el estilo de un botón ahora significa abrir un archivo, no buscar entre un montón de parciales sin estructura.',
      'El modo claro ya está disponible. Tocá el selector de tema en la navegación para cambiar — la app recuerda tu preferencia y respeta la configuración de tu sistema operativo en la primera visita.',
      'Se corrigió un error de rutas que hacía que las páginas de libros fallaran cuando el idioma de la app estaba en español. El problema solo afectaba el entorno de desarrollo local, pero era suficientemente molesto para resolverlo ahora.',
    ],
  },
  {
    version: 'v0.29',
    date: '2026-06-19',
    titleEn: 'Discussion & Decisions',
    titleEs: 'Discusión y Decisiones',
    bodyEn: [
      'Sessions now have a full discussion layer. Admins can pin discussion questions — members answer each one in its own thread. A free comments section below lets the conversation roam. Replies nest one level deep. Authors can edit or delete their own comments; admins can delete any.',
      'Tap "☩ Oracle suggests" in the questions panel and Claude generates five discussion questions tailored to the session\'s book — themes, characters, emotional resonance. A pick-list lets the admin add any or all of them with a single tap, skipping questions already pinned.',
      'Book Club polls let the group decide what to read next. Admins create polls manually or trigger the Oracle — Claude suggests three books based on the club\'s genres and reading history, which become a poll automatically. Members vote, results show in real time, and the winning book pre-fills the next session form.',
      'Admins can close a poll when voting is done, delete a poll outright, or create the next session directly from the winning option.',
    ],
    bodyEs: [
      'Las sesiones ahora tienen una capa completa de discusión. Los administradores pueden fijar preguntas de debate — los miembros responden cada una en su propio hilo. Una sección de comentarios libres permite que la conversación fluya. Las respuestas tienen un nivel de profundidad. Los autores pueden editar o eliminar sus propios comentarios; los administradores pueden eliminar cualquiera.',
      'Toca "☩ Oracle sugiere" en el panel de preguntas y Claude genera cinco preguntas de debate adaptadas al libro de la sesión — temas, personajes, resonancia emocional. Una lista de selección permite al administrador agregar una o todas con un solo toque, omitiendo las preguntas ya fijadas.',
      'Las encuestas del Club de Lectura permiten al grupo decidir qué leer a continuación. Los administradores crean encuestas manualmente o invocan al Oracle — Claude sugiere tres libros basándose en los géneros e historial del club, que se convierten automáticamente en una encuesta. Los miembros votan, los resultados se muestran en tiempo real y el libro ganador rellena automáticamente el formulario de la próxima sesión.',
      'Los administradores pueden cerrar una encuesta cuando termina la votación, eliminarla por completo, o crear la próxima sesión directamente desde la opción ganadora.',
    ],
  },
  {
    version: 'v0.28',
    date: '2026-06-19',
    titleEn: 'Book Clubs',
    titleEs: 'Clubs de Lectura',
    bodyEn: [
      'Create a Book Club, invite members via a shareable join link, and read together. Admins can create Sessions — each one tied to a specific book with a start date, end date, and notes for the group.',
      'Session pages show every member\'s reading progress in real time. Update your page count from Currently Reading or directly from the session, and watch the progress grid come alive.',
      'Reading progress tracking is now built into Currently Reading. Add how many pages you\'ve read to any in-progress book — a subtle progress bar keeps your place in view.',
    ],
    bodyEs: [
      'Creá un Club de Lectura, invitá miembros con un enlace de unión y leé en grupo. Los administradores pueden crear Sesiones — cada una vinculada a un libro específico con fecha de inicio, fecha de fin y notas para el grupo.',
      'Las páginas de sesión muestran el progreso de lectura de cada miembro en tiempo real. Actualizá tu cuenta de páginas desde Leyendo Ahora o directamente desde la sesión, y observá cómo cobra vida la grilla de progreso.',
      'El seguimiento del progreso de lectura ahora está integrado en Leyendo Ahora. Agregá cuántas páginas leíste de cualquier libro en curso — una barra de progreso sutil mantiene tu lugar a la vista.',
    ],
  },
  {
    version: 'v0.27',
    date: '2026-06-18',
    titleEn: 'Lists, sharing, and smarter browsing',
    titleEs: 'Listas, compartir y mejor navegación',
    bodyEn: [
      'Create curated reading lists, add any book from your collection, and share them with a public link — no account required to view.',
      'Reading Plans are now shareable too. Open a plan link to browse it, copy it to your own account with one tap, or add all its books to your queue.',
      'The nav is cleaner: Reading (Currently Reading + Read Next) collapses into one dropdown, and Profile, Language, and Sign out move to a ··· overflow menu — freeing space for the new Lists entry.',
      'Book pages now open in a new tab with content visible instantly, even before your library loads. No account needed to read a book page.',
      'Select multiple books in Wishlist, Library, or a List to bulk-add to a list, mark as read, or remove — works in both list and cover grid views.',
    ],
    bodyEs: [
      'Creá listas de lectura curadas, agregá cualquier libro de tu colección y compartilas con un enlace público — sin necesidad de cuenta para verlas.',
      'Los Planes de Lectura ahora también se pueden compartir. Abrí un enlace de plan para verlo, copialo a tu cuenta con un toque, o agregá todos sus libros a tu cola.',
      'La navegación es más limpia: Leyendo (Leyendo Ahora + Leer Después) se colapsa en un desplegable, y Perfil, Idioma y Cerrar Sesión se mueven a un menú ··· — liberando espacio para la nueva entrada de Listas.',
      'Las páginas de libro ahora se abren en una nueva pestaña con el contenido visible al instante, incluso antes de que cargue tu biblioteca. No se necesita cuenta para leer una página de libro.',
      'Seleccioná varios libros en Lista de Deseos, Biblioteca o una Lista para agregarlos en bloque a una lista, marcarlos como leídos o eliminarlos — funciona en vistas de lista y de portadas.',
    ],
  },
  {
    version: 'v0.26',
    date: '2026-06-18',
    titleEn: 'Your dashboard, alive',
    titleEs: 'Tu panel, con vida propia',
    bodyEn: [
      'The dashboard is now an activity feed. See what you finished, started, and added to your wishlist — grouped by day, with cover art throughout.',
      'Currently Reading gets a prominent strip at the top so your active books are always front and center.',
      'Reading Plans now supports multiple plans at once. Create as many as you want; each lives independently and can be opened from the dashboard.',
      'The curated catalog (used by the Oracle when AI is off) is now powered by your own wishlist rather than a static bundled list — so the more books you add, the richer it gets.',
      'The shelf SCSS has been split into 25 focused partials for easier maintenance.',
    ],
    bodyEs: [
      'El panel ahora es un feed de actividad. Ves qué terminaste, empezaste y agregaste a tu lista — agrupado por día, con portadas en cada entrada.',
      'Leyendo Ahora tiene un bloque destacado en la parte superior para que tus libros activos estén siempre visibles.',
      'Los Planes de Lectura ahora soportan múltiples planes a la vez. Creá todos los que quieras; cada uno vive de forma independiente y se puede abrir desde el panel.',
      'El catálogo curado (que usa el Oráculo cuando la IA está desactivada) ahora se alimenta de tu propia lista de deseos en lugar de una lista estática — cuantos más libros agregues, más rico es.',
      'El SCSS del proyecto se dividió en 25 archivos parciales para facilitar el mantenimiento.',
    ],
  },
  {
    version: 'v0.25',
    date: '2026-06-17',
    titleEn: 'Currently Reading & cover shelves',
    titleEs: 'Leyendo ahora y estantes de portadas',
    bodyEn: [
      'A new "Reading" section in the nav tracks books you\'re actively reading, with a start date and day counter so you can see how long each book took once you finish.',
      'Wishlist and Library now have a Covers toggle — switch from the list view to a visual grid where each genre becomes its own shelf of cover art.',
      'Books marked as reading are hidden from Read Next automatically; removing a book from Currently Reading sends it back to your queue.',
    ],
    bodyEs: [
      'Una nueva sección "Leyendo" en la navegación registra los libros que estás leyendo activamente, con fecha de inicio y contador de días para saber cuánto tardaste al terminar.',
      'La Lista de Deseos y la Biblioteca tienen ahora un toggle de Portadas — cambiá de la vista de lista a una grilla visual donde cada género se convierte en su propio estante.',
      'Los libros marcados como "leyendo" se ocultan automáticamente de Leer Después; quitarlos de Leyendo los devuelve a la cola.',
    ],
  },
  {
    version: 'v0.24',
    date: '2026-06-16',
    titleEn: 'Series get their own page',
    titleEs: 'Las sagas tienen su propia página',
    bodyEn: [
      'Every series now has a dedicated page with a progress bar, all books in order with their covers, a description from Wikipedia, and your read/queued/wishlist status on each book.',
      'You can add, queue, or mark books as read directly from the series page without going book by book.',
      'Get there from a book modal or book page whenever the book is part of a series, or tap any in-progress series on your profile.',
    ],
    bodyEs: [
      'Cada saga tiene ahora una página propia con una barra de progreso, todos los libros en orden con sus portadas, una descripción de Wikipedia y tu estado de lectura en cada libro.',
      'Podés agregar, poner en cola o marcar libros como leídos directamente desde la página de la saga.',
      'Llegá desde el modal o la página de cualquier libro que sea parte de una saga, o tocá una saga en progreso en tu perfil.',
    ],
  },
  {
    version: 'v0.23',
    date: '2026-06-16',
    titleEn: 'How you read, in numbers',
    titleEs: 'Cómo leís, en números',
    bodyEn: [
      'Your profile now shows reading stats: total books and pages, your pace over the last 12 months as a bar chart, top genres, most-read author, and series in progress with dot indicators.',
      'Reading Plans no longer shows every series in the catalog. It now shows only the series you have started or have on your wishlist, split into In progress and On your wishlist. You can still search for any other series.',
      'Series in progress on the stats page are tappable and take you straight to creating a plan to finish them.',
    ],
    bodyEs: [
      'Tu perfil ahora muestra estadísticas de lectura: libros y páginas totales, tu ritmo en los últimos 12 meses como gráfico de barras, géneros favoritos, autora más leída y sagas en progreso.',
      'Los Planes de Lectura ahora solo muestran las sagas que ya empezaste o tenés en tu lista, divididas en En progreso y En tu lista. Todavía podés buscar cualquier otra saga.',
      'Las sagas en progreso en las estadísticas son interactivas y te llevan directamente a crear un plan para terminarlas.',
    ],
  },
  {
    version: 'v0.22',
    date: '2026-06-16',
    titleEn: 'Your library remembers when',
    titleEs: 'Tu biblioteca recuerda cuándo',
    bodyEn: [
      'Every book you mark as read now records the date you finished it. A \'Finished on\' field appears in the rating modal, pre-filled with today but fully editable — so you can backfill the real date for books you read months or years ago.',
      'The read date shows quietly in your library next to each book. It will power reading stats in an upcoming release.',
      'Books that can\'t be found in Hardcover or OpenLibrary are now identified by the Oracle before falling back to \'add as-is\'. Most obscure and Spanish-language titles should now resolve with real metadata.',
      'The Oracle also enriches genres, series, and descriptions all in one pass. And the About page now shows where the app is heading.',
    ],
    bodyEs: [
      'Cada libro que marcás como leído ahora guarda la fecha en que lo terminaste. Aparece un campo \'Terminado el\' en el modal de calificación, con la fecha de hoy por defecto pero editable — para que puedas registrar la fecha real de libros que leíste hace meses o años.',
      'La fecha aparece discretamente en tu biblioteca junto a cada libro, y pronto alimentará estadísticas de lectura.',
      'Los libros que no se encuentran en Hardcover ni OpenLibrary ahora son identificados por el Oráculo antes de recurrir a \'agregar tal cual\'. La mayoría de títulos poco conocidos y en español deberían resolverse correctamente.',
      'El Oráculo también hace más en un solo proceso: géneros, sagas y descripciones a la vez. Y la página Acerca de ahora muestra hacia dónde va la app.',
    ],
  },
  {
    version: 'v0.21',
    date: '2026-06-15',
    titleEn: 'The Oracle grows wiser',
    titleEs: 'El Oráculo se vuelve más sabio',
    bodyEn: [
      'The Oracle now assigns genres, fills in missing descriptions, and identifies series information for your books in a single pass. Previously it only handled genres.',
      'Books added through search now load faster and have richer descriptions from the start.',
    ],
    bodyEs: [
      'El Oráculo ahora asigna géneros, completa descripciones faltantes e identifica información de saga en un solo proceso. Antes solo manejaba géneros.',
      'Los libros agregados mediante búsqueda ahora cargan más rápido y tienen descripciones más ricas desde el principio.',
    ],
  },
  {
    version: 'v0.20',
    date: '2026-06-15',
    titleEn: 'Report book issues',
    titleEs: 'Reportar errores en libros',
    bodyEn: [
      'You can now flag incorrect information on any book. Open a book modal or book page and tap "Report an issue" at the bottom to tell us what\'s wrong — cover, title, description, series, or genres.',
      'Reports go to our review queue and will be used to prioritise which books get fixed first.',
    ],
    bodyEs: [
      'Ahora podés marcar información incorrecta en cualquier libro. Abrí el modal o la página de un libro y tocá "Reportar un error" al final para indicar qué está mal.',
      'Los reportes van a nuestra cola de revisión y se usarán para priorizar qué libros se corrigen primero.',
    ],
  },
  {
    version: 'v0.19',
    date: '2026-06-15',
    titleEn: 'Search any book',
    titleEs: 'Busca cualquier libro',
    bodyEn: [
      'The search bar in the navigation now works. Start typing any title or author and results appear instantly from your collection, then from Hardcover\'s catalog of millions of books.',
      'Tapping any result opens the full book page. If the book isn\'t in your collection yet, you can add it to your wishlist or mark it as read from there.',
      'If a book can\'t be found anywhere, the Oracle steps in and identifies it from its knowledge of literature.',
    ],
    bodyEs: [
      'La barra de búsqueda en la navegación ya funciona. Empezá a escribir cualquier título o autor y los resultados aparecen al instante desde tu colección, y luego desde el catálogo de Hardcover.',
      'Tocar cualquier resultado abre la página completa del libro. Si el libro no está en tu colección, podés agregarlo a tu lista o marcarlo como leído desde allí.',
      'Si un libro no se puede encontrar en ninguna parte, el Oráculo interviene e identifica el libro por su conocimiento de la literatura.',
    ],
  },
  {
    version: 'v0.18',
    date: '2026-06-15',
    titleEn: 'Book pages',
    titleEs: 'Páginas de libro',
    bodyEn: [
      'Every book now has its own page. Open any book modal and tap “See more” to see the full description, series navigation, genre tags, and action buttons on a dedicated page.',
      'Series navigation on the book page lets you jump directly to any other book in the sequence.',
    ],
    bodyEs: [
      'Cada libro tiene ahora su propia página. Abrí cualquier modal de libro y tocá “Ver más” para ver la descripción completa, la navegación de saga, las etiquetas de género y los botones de acción en una página dedicada.',
      'La navegación de saga en la página del libro te permite saltar directamente a cualquier otro libro de la secuencia.',
    ],
  },
  {
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