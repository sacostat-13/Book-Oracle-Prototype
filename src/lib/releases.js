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
export const CURRENT_VERSION = 'v0.55.2';

export const RELEASES = [{
    version: 'v0.55.2',
    date: '2026-07-22',
    titleEn: 'Choose your light, and your language',
    titleEs: 'Elige tu luz y tu idioma',
    bodyEn: [
      'The landing page opens with two controls: English/Español, and sun or moon. Pick before the story starts — the whole scroll now has a parchment daylight version, and whatever you choose follows you into the app when you sign up.',
      'Curator accounts: categorizing the catalog no longer spends Oracle calls, and your quota badge shows the truth again instead of a permanent "5 of 5". Everything else — Spark, Ask, Similar, Plans — is metered like any other account.',
      'Letting the Oracle categorize a shelf now costs one Oracle call for the whole run, not one for every few books. If your quota does run out mid-run, it stops and tells you instead of grinding on.',
      'Tidier spacing around buttons and settings sections, and the stray gold lines crossing the companions grid are gone.',
    ],
    bodyEs: [
      'La página de inicio abre con dos controles: English/Español, y sol o luna. Elige antes de que empiece la historia — todo el recorrido tiene ahora una versión clara en pergamino, y lo que elijas te acompaña a la app cuando te registres.',
      'Cuentas de curador: categorizar el catálogo ya no consume llamadas al Oráculo, y tu insignia de cuota vuelve a decir la verdad en lugar de un "5 de 5" permanente. Todo lo demás — Chispa, Preguntar, Similares, Planes — se mide como en cualquier otra cuenta.',
      'Dejar que el Oráculo categorice una estantería ahora cuesta una sola llamada por tanda completa, no una por cada pocos libros. Y si la cuota se agota a mitad de camino, se detiene y te avisa en vez de seguir insistiendo.',
      'Espaciado más prolijo alrededor de botones y secciones de ajustes, y las líneas doradas sueltas que cruzaban la cuadrícula de compañeros ya no están.',
    ],
  }, {
    version: 'v0.55.1',
    date: '2026-07-20',
    titleEn: 'Unlimited Oracle calls for curators',
    titleEs: 'Llamadas ilimitadas al Oráculo para curadores',
    bodyEn: [
      'Curator accounts — the readers whose shelves feed the Vault catalog — now run every Oracle feature, including categorization, without the free/Pro call limits.',
      'The quota badge shows "Unlimited" instead of a countdown when this applies to your account.',
    ],
    bodyEs: [
      'Las cuentas de curador — quienes alimentan el catálogo del Vault con sus estanterías — ahora usan cualquier función del Oráculo, incluida la categorización, sin los límites de llamadas de las cuentas gratuitas o Pro.',
      'La insignia de cuota muestra "Ilimitado" en lugar de una cuenta regresiva cuando esto aplica a tu cuenta.',
    ],
  }, {
    version: 'v0.55',
    date: '2026-07-20',
    titleEn: 'Books by women, counted',
    titleEs: 'Libros de autoras, contados',
    bodyEn: [
      'The Oracle now also notes which books are written by women — drawn from public author information, never guessed from a name.',
      'Your Ledger gains a new shelf: milestones for books by women, sitting alongside your genres, series, and goals.',
      'The share card for this milestone uses the same plain card as every new milestone type at launch — its own illustrated frame is on the way.',
    ],
    bodyEs: [
      'El Oráculo ahora también anota qué libros están escritos por mujeres — a partir de información pública sobre la autora, nunca adivinado por el nombre.',
      'Tu Registro suma un estante nuevo: hitos de libros de autoras, junto a tus géneros, sagas y objetivos.',
      'La tarjeta para compartir este hito usa por ahora la misma tarjeta simple que todo hito nuevo al lanzarse — su propio marco ilustrado está en camino.',
    ],
  }, {
    version: 'v0.54',
    date: '2026-07-20',
    titleEn: 'The thread follows you inside',
    titleEs: 'El hilo te sigue adentro',
    bodyEn: [
      'While the Oracle works, its gold thread now draws itself beneath the rotating quote — and when your suggestions land, a small spark marks the moment.',
      'Reading plans wear the thread too: a quiet gold rail runs through your months, each book a star — read ✦, the one you’re on ☾, the ones ahead ✧.',
      'Everything stays still once drawn. The app remains a study, not a stage — and with reduced motion enabled, nothing moves at all.',
    ],
    bodyEs: [
      'Mientras el Oráculo trabaja, su hilo dorado ahora se dibuja bajo la cita que rota — y cuando llegan tus sugerencias, una pequeña chispa marca el momento.',
      'Los planes de lectura también llevan el hilo: un riel dorado y sereno recorre tus meses, cada libro una estrella — leído ✦, el que llevas ☾, los que esperan ✧.',
      'Todo queda quieto una vez dibujado. La app sigue siendo un estudio, no un escenario — y con movimiento reducido activado, nada se mueve en absoluto.',
    ],
  }, {
    version: 'v0.53',
    date: '2026-07-20',
    titleEn: 'The scroll is the reading',
    titleEs: 'El desplazamiento es la lectura',
    bodyEn: [
      'The landing page now tells one continuous story: five cards fanned across the dark, the Oracle considers your shelf, one card turns — and a gold thread guides you from that reveal, through the Rites, all the way to the card you claim at the end.',
      'No more intro curtain: the 30-second overlay and its skip button are gone. The story plays as you scroll, and scrolling back replays it.',
      'Three Rites now: Suggestions dealt as cards with their reasons, Reading Plans as a constellation the thread draws through, and The Record — your stats, streaks, and Oracle-granted titles, remembered.',
      'Prefer reduced motion? The whole page renders complete and still — same story, no animation. And as always: every word in English y en español.',
    ],
    bodyEs: [
      'La página de inicio ahora cuenta una sola historia continua: cinco cartas abiertas en la oscuridad, el Oráculo considera tu estantería, una carta se voltea — y un hilo dorado te guía desde esa revelación, por los Ritos, hasta la carta que reclamas al final.',
      'Se acabó el telón de entrada: el intro de 30 segundos y su botón de saltar ya no existen. La historia avanza mientras te desplazas, y volver atrás la repite.',
      'Ahora son tres Ritos: las sugerencias repartidas como cartas con sus razones, los Planes de Lectura como una constelación que el hilo atraviesa, y El Registro — tus estadísticas, rachas y títulos otorgados por el Oráculo, recordados.',
      '¿Prefieres menos movimiento? La página entera se muestra completa y quieta — la misma historia, sin animación. Y como siempre: cada palabra in English y en español.',
    ],
  }, {
    version: 'v0.52',
    date: '2026-07-18',
    titleEn: 'A face for every reader',
    titleEs: 'Un rostro para cada lector',
    bodyEn: [
      'Google profile photos now render reliably everywhere — a missing no-referrer policy was quietly blocking them.',
      'New: pick your avatar. Keep your Google photo, fall back to initials, or choose from the new gallery — a motif for every Oracle genre in solid and outline variants across ten colors, plus a standard set of reader icons.',
      'Your avatar (and your Reader Title) follows you across profiles, book clubs, discussions, and the friends feed.',
      'The title ladder now climbs past 100: Sage of the Athenaeum at 250 books, Warden of the Grand Archive at 500, and The Living Library at 1,000.',
    ],
    bodyEs: [
      'Las fotos de perfil de Google ahora se muestran bien en todas partes — una política no-referrer ausente las bloqueaba en silencio.',
      'Nuevo: elegí tu avatar. Mantené tu foto de Google, volvé a las iniciales, o escogé de la nueva galería — un motivo por cada género del Oráculo en variantes sólida y de contorno en diez colores, más un set estándar de íconos lectores.',
      'Tu avatar (y tu Título de Lector) te acompaña por perfiles, clubes de lectura, discusiones y el muro de amigos.',
      'La escalera de títulos ahora sube más allá de 100: Sabio del Ateneo a los 250 libros, Custodio del Gran Archivo a los 500 y La Biblioteca Viviente a los 1.000.',
    ],
  }, {
    version: 'v0.51',
    date: '2026-07-18',
    titleEn: 'Titles, granted by the Oracle alone',
    titleEs: 'Títulos que solo otorga el Oráculo',
    bodyEn: [
      'Reader Titles arrive: six dark-academia epithets, from Initiate of the Order to Voice of the Oracle, earned purely by books read. No one can type one in — if you see a title, the reading behind it happened.',
      'Choose which earned title to wear from your Profile. It appears beneath your name on your profile, beside your name in book club rosters and discussions, and signs your share cards.',
      'Locked tiers show exactly how many books away they are. The ladder starts at your very first book and ends at your hundredth.',
    ],
    bodyEs: [
      'Llegan los Títulos de Lector: seis epítetos de academia oscura, de Iniciado de la Orden a Voz del Oráculo, que se ganan solo leyendo. Nadie puede escribirse uno — si ves un título, la lectura detrás existió.',
      'Elegí desde tu Perfil cuál de tus títulos ganados llevar. Aparece bajo tu nombre en tu perfil, junto a tu nombre en los clubes de lectura y sus discusiones, y firma tus tarjetas para compartir.',
      'Los niveles bloqueados muestran exactamente a cuántos libros están. La escalera empieza con tu primer libro y termina con el número cien.',
    ],
  }, {
    version: 'v0.50',
    date: '2026-07-18',
    titleEn: 'The Oracle reads you, fully',
    titleEs: 'El Oráculo te lee, por completo',
    bodyEn: [
      'Your reading level and reading goal are now editable from your Profile, right beside your favorite genres and mood — no more values frozen at signup.',
      'Every Oracle recommendation — Ask, Similar, category draws, the daily Spark, and reading plans — now weighs all four of your stated preferences: level, goal, genres, and mood.',
      'The Oracle notices growth: when the books you rate highly read well above your stated level, it suggests a promotion on your dashboard. Your call — accept it or wave it off.',
    ],
    bodyEs: [
      'Tu nivel de lectura y tu meta ahora se editan desde tu Perfil, junto a tus géneros favoritos y tu ánimo — se acabaron los valores congelados desde el registro.',
      'Cada recomendación del Oráculo — Preguntar, Similares, sorteos por categoría, el Spark diario y los planes de lectura — ahora pondera tus cuatro preferencias declaradas: nivel, meta, géneros y ánimo.',
      'El Oráculo nota tu crecimiento: cuando los libros que calificás alto superan tu nivel declarado, te sugiere un ascenso en el tablero. Vos decidís — lo aceptás o lo dejás pasar.',
    ],
  }, {
    version: 'v0.49',
    date: '2026-07-16',
    titleEn: 'The Vault, curator-fed',
    titleEs: 'La Bóveda, alimentada por curadores',
    bodyEn: [
      'The Vault now draws from real shelves: every curator’s wishlist and library feed it directly, so it grows as curators read and discover. It jumps from ~426 books to over a thousand today.',
      'Books a curator read but rated poorly stay out — the Vault only carries what curators want to read or can vouch for.',
      'Guests browse the same living catalog as signed-in readers, instead of a smaller built-in list.',
    ],
    bodyEs: [
      'La Bóveda ahora se nutre de estantes reales: la lista de deseos y la biblioteca de cada curador la alimentan directamente, así que crece a medida que los curadores leen y descubren. Hoy salta de ~426 libros a más de mil.',
      'Los libros que un curador leyó pero calificó mal quedan afuera — la Bóveda solo lleva lo que los curadores quieren leer o pueden recomendar.',
      'Los invitados navegan el mismo catálogo vivo que los lectores registrados, en vez de una lista integrada más chica.',
    ],
  }, {
    version: 'v0.48',
    date: '2026-07-16',
    titleEn: 'Every link wears the card',
    titleEs: 'Cada enlace con su tarjeta',
    bodyEn: [
      'Share a link to a book, list, or reading plan anywhere — WhatsApp, Slack, X, Discord, iMessage — and it now unfurls with a proper Oracle card: gold frame, ink background, the cover front and center.',
      'Reading plans (and books without covers) get an elegant text-only card, so no link of yours ever shows up plain again.',
      'The share-a-moment window now fits comfortably on phones: the card scales to your screen and the buttons stack full-width instead of spilling off the edge.',
    ],
    bodyEs: [
      'Compartí el enlace de un libro, una lista o un plan de lectura donde sea — WhatsApp, Slack, X, Discord, iMessage — y ahora se despliega con una tarjeta del Oráculo como corresponde: marco dorado, fondo tinta, y la portada al frente.',
      'Los planes de lectura (y los libros sin portada) reciben una tarjeta elegante solo de texto, así ningún enlace tuyo vuelve a verse pelado.',
      'La ventana de compartir un momento ahora entra cómoda en el teléfono: la tarjeta se ajusta a tu pantalla y los botones se apilan a lo ancho en vez de salirse del borde.',
    ],
  }, {
    version: 'v0.47.1',
    date: '2026-07-16',
    titleEn: 'Stay signed in across updates',
    titleEs: 'Seguí con tu sesión entre actualizaciones',
    bodyEn: [
      'Fixed: updating to a new version no longer signs you out. Before, each new release could quietly log some readers out — now your session stays put across updates.',
      'New: when a new version is ready, a small “A new version is available — Refresh” prompt appears, so you update on your own time instead of the app reloading underneath you.',
    ],
    bodyEs: [
      'Corregido: actualizar a una nueva versión ya no cierra tu sesión. Antes, cada versión nueva podía desconectar a algunos lectores sin aviso — ahora tu sesión se mantiene entre actualizaciones.',
      'Nuevo: cuando hay una versión nueva lista, aparece un pequeño aviso “Hay una nueva versión disponible — Actualizar”, así actualizás cuando quieras en vez de que la app se recargue sola.',
    ],
  }, {
    version: 'v0.47',
    date: '2026-07-15',
    titleEn: 'Milestone cards, illustrated',
    titleEs: 'Tarjetas de hitos, ilustradas',
    bodyEn: [
      'Your milestone share cards are now fully illustrated. Every genre has its own hand-drawn, gold-on-ink frame and artwork — 49 in all — and so does each kind of milestone: series completed, reading goals, and your books of the year.',
      'Genre milestones now show the genre’s own art instead of the last book’s cover, so the card celebrates the achievement — not just the book that happened to finish it. Finishing a single book still frames your real cover.',
      'Cleaner and bolder, too: bigger art and headings so every card reads at a glance, even as a thumbnail.',
    ],
    bodyEs: [
      'Tus tarjetas de hitos ahora están completamente ilustradas. Cada género tiene su propio marco e ilustración dibujados a mano, en dorado sobre tinta — 49 en total — y también cada tipo de hito: sagas completadas, metas de lectura y tus libros del año.',
      'Los hitos de género ahora muestran la ilustración del género en vez de la portada del último libro, así la tarjeta celebra el logro — no solo el libro que lo completó. Al terminar un libro, la tarjeta sigue mostrando tu portada real.',
      'También más limpias y llamativas: ilustración y títulos más grandes para que cada tarjeta se lea de un vistazo, incluso en miniatura.',
    ],
  }, {
    version: 'v0.46',
    date: '2026-07-14',
    titleEn: 'Find your way around: a friendlier Books Oracle',
    titleEs: 'Encontrá tu camino: un Books Oracle más amable',
    bodyEn: [
      'Empty pages now teach as you go. When a shelf, list, plan, or club is empty, it tells you what the feature is for and gives you the button to start — no more guessing what a blank page is waiting for.',
      'New: gentle one-time tips. A quiet pointer appears the first time you land somewhere with a feature that’s easy to miss — adding your own categories to a book, letting the Oracle sort your genres, leaving a note for your future self, or rearranging your dashboard. Dismiss it once and it’s gone for good.',
      'New: a public changelog. Every update now lives at /changelog, and a “what’s new” dot in the top bar lights up when there’s something you haven’t seen.',
    ],
    bodyEs: [
      'Las páginas vacías ahora te enseñan a medida que avanzás. Cuando un estante, lista, plan o club está vacío, te dice para qué sirve la función y te da el botón para empezar — se acabó adivinar qué espera una página en blanco.',
      'Nuevo: consejos suaves que aparecen una sola vez. Un aviso tranquilo aparece la primera vez que llegás a un lugar con una función fácil de pasar por alto — agregar tus propias categorías a un libro, dejar que el Oráculo ordene tus géneros, dejarte una nota para tu yo futuro o reorganizar tu panel. Lo cerrás una vez y no vuelve.',
      'Nuevo: un registro de cambios público. Cada novedad ahora vive en /changelog, y un punto de “novedades” en la barra superior se enciende cuando hay algo que no viste.',
    ],
  }, {
    version: 'v0.45.1',
    date: '2026-07-14',
    titleEn: 'Share cards now post as images',
    titleEs: 'Las tarjetas ahora se publican como imágenes',
    bodyEn: [
      'Share cards now save and post as a crisp image every time — the book cover baked right in — so you can share the card itself to Instagram, WhatsApp, your Stories, or anywhere, not just as a link.',
      'It works the same across phone and desktop, and for every card: finished books, series, reading plans, goals, and your milestones.',
    ],
    bodyEs: [
      'Las tarjetas para compartir ahora se guardan y publican como una imagen nítida siempre — con la portada del libro incluida — así podés compartir la tarjeta en sí en Instagram, WhatsApp, tus Historias o donde quieras, no solo como enlace.',
      'Funciona igual en teléfono y computadora, y para todas las tarjetas: libros terminados, sagas, planes de lectura, metas y tus hitos.',
    ],
  }, {
    version: 'v0.45',
    date: '2026-07-13',
    titleEn: 'The Ledger: your reading accomplishments',
    titleEs: 'El Registro: tus logros de lectura',
    bodyEn: [
      'New: The Ledger, on your Profile. A quiet, dated record of what your reading has already earned — reading goals met, series finished, plans completed, your milestone books of each year, and your genre devotions. It’s a ledger, not a scoreboard: no streaks, no nudges, nothing to keep up with.',
      'It counts your history too. Everything you’ve already read — including your Goodreads imports — is honoured retroactively, dated to when you read it, the first time you open the page.',
      'Tap any mark to re-open its dark-academia share card and post it anywhere.',
    ],
    bodyEs: [
      'Nuevo: El Registro, en tu Perfil. Un registro tranquilo y fechado de lo que tu lectura ya ganó — metas de lectura cumplidas, sagas terminadas, planes completados, tus libros-hito de cada año y tus devociones por género. Es un registro, no un tablero de puntajes: sin rachas, sin insistencias, nada que mantener al día.',
      'También cuenta tu historia. Todo lo que ya leíste — incluidas tus importaciones de Goodreads — se reconoce de forma retroactiva, con la fecha en que lo leíste, la primera vez que abrís la página.',
      'Tocá cualquier marca para volver a abrir su tarjeta dark academia y compartirla donde quieras.',
    ],
  }, {
    version: 'v0.44',
    date: '2026-07-13',
    titleEn: 'Reading Memory: notes for your future self',
    titleEs: 'Memoria de lectura: notas para tu yo del futuro',
    bodyEn: [
      'New: Reading Memory. When you update your reading progress, you can leave a short private note — where you are, what’s staying with you. The next time you pick that book up, it’s waiting for you: "Last time — p. 145: …". Your Book Page keeps the whole private thread, including the note you write when you finish.',
      'Goodreads import, polished: series are now detected from your titles (so "The Fellowship of the Ring (The Lord of the Rings, #1)" arrives as part of its saga, with a clean title), duplicate editions are caught before they clutter your library, and big imports show live progress — "Adding 214 of 500…" instead of a mystery wait.',
      'Fixed: marking a book as read now always removes it from Currently Reading, finished books no longer sneak back into your Read Next queue, and an active re-read shows its progress on the Book Page even when the book is already in your library.',
      'Fixed: adding a book occasionally failed with an error even though it appeared after a refresh — it now saves on the first try.',
      'Fixed: the app icon shows correctly when you install The Books Oracle on your phone or desktop, and a source of console errors around book covers is gone.',
    ],
    bodyEs: [
      'Nuevo: Memoria de lectura. Cuando actualizás tu progreso, podés dejarte una nota corta y privada — dónde vas, qué se te quedó. La próxima vez que retomes ese libro, te está esperando: "La última vez — pág. 145: …". Tu Página de Libro guarda todo el hilo privado, incluida la nota que escribís al terminarlo.',
      'Importación de Goodreads, pulida: ahora se detectan las sagas desde los títulos (así "La Comunidad del Anillo (El Señor de los Anillos, #1)" llega como parte de su saga, con el título limpio), las ediciones duplicadas se detectan antes de ensuciar tu biblioteca, y las importaciones grandes muestran progreso en vivo — "Agregando 214 de 500…" en vez de una espera misteriosa.',
      'Corregido: marcar un libro como leído ahora siempre lo saca de Leyendo Ahora, los libros terminados ya no se cuelan de vuelta en tu cola de Por Leer, y una relectura activa muestra su progreso en la Página de Libro aunque el libro ya esté en tu biblioteca.',
      'Corregido: agregar un libro a veces fallaba con un error aunque aparecía después de refrescar — ahora se guarda al primer intento.',
      'Corregido: el ícono de la app se muestra bien al instalar The Books Oracle en tu teléfono o computadora, y desapareció una fuente de errores de consola relacionada con las portadas.',
    ],
  }, {
    version: 'v0.43',
    date: '2026-07-09',
    titleEn: 'Share your reading life: Share Cards',
    titleEs: 'Compartí tu vida lectora: Tarjetas para Compartir',
    bodyEn: [
      'New: Share buttons on Book Pages, Lists, Book Clubs, Reading Plans, and your Profile — send a link to WhatsApp, X, Telegram, or anywhere via your device’s share sheet. Links now unfurl with a proper preview (title, description, cover) wherever you paste them.',
      'New: finish a book and a share card appears — a dark-academia card you can post as an image or share as a link. Finishing a series, completing a reading plan, or hitting your reading goal gets its own card too.',
      'New: reading milestones. Your 5th, 10th, 25th (and beyond) book of the year, your first book in a new genre, and genre devotion milestones ("10 gothic books") each get a shareable card of their own.',
      'Book clubs: creating a session in a public club offers a "now reading" card to invite people in, and finished sessions can be shared from the session page.',
      'Fixed: books in the Friends Feed are now clickable — tap a cover or title to open its Book Page.',
      'Fixed: every "Upgrade to Pro" button now takes you to My Profile and scrolls straight to the subscription section.',
      'Fixed: after switching from Pro to Free, the Oracle calls counter no longer shows more calls used than your plan allows.',
      'My Profile, reorganized: one card, five tabs — Overview (your stats, top genres, most read author, series in progress, and Reading Challenge), Account, Privacy, Subscription, and Notifications. Tighter spacing throughout, and no more marathon scroll.',
    ],
    bodyEs: [
      'Nuevo: botones de Compartir en Páginas de Libro, Listas, Clubes de Lectura, Planes de Lectura y tu Perfil — enviá un enlace por WhatsApp, X, Telegram o donde quieras con el menú de compartir de tu dispositivo. Los enlaces ahora se muestran con una vista previa completa (título, descripción, portada) donde los pegues.',
      'Nuevo: al terminar un libro aparece una tarjeta para compartir — una tarjeta dark academia que podés publicar como imagen o compartir como enlace. Terminar una serie, completar un plan de lectura o cumplir tu meta de lectura también tiene su propia tarjeta.',
      'Nuevo: hitos de lectura. Tu 5.º, 10.º, 25.º (y más) libro del año, tu primer libro en un género nuevo y los hitos de devoción por género ("10 libros góticos") tienen cada uno su tarjeta para compartir.',
      'Clubes de lectura: crear una sesión en un club público ofrece una tarjeta de "leyendo ahora" para invitar gente, y las sesiones terminadas se pueden compartir desde la página de la sesión.',
      'Corregido: los libros del Feed de Amigos ahora se pueden abrir — tocá una portada o un título para ir a su Página de Libro.',
      'Corregido: todos los botones de "Mejorar a Pro" ahora te llevan a Mi Perfil directo a la sección de suscripción.',
      'Corregido: al pasar de Pro a Gratis, el contador de consultas del Oráculo ya no muestra más consultas usadas de las que permite tu plan.',
      'Mi Perfil, reorganizado: una sola tarjeta, cinco pestañas — Resumen (tus estadísticas, géneros más leídos, autor más leído, series en progreso y Desafío de Lectura), Cuenta, Privacidad, Suscripción y Notificaciones. Espaciado más compacto en toda la página, y se acabó el scroll infinito.',
    ],
  }, {
    version: 'v0.42',
    date: '2026-07-07',
    titleEn: 'Ask the Oracle, Match %, and a richer Dashboard',
    titleEs: 'Preguntale al Oráculo, Compatibilidad, y un Dashboard más completo',
    bodyEn: [
      'New: Ask the Oracle — a third way to get recommendations, alongside By Genres and Based on Other Books. Describe what you\u2019re after in your own words (a mood, a moment, a question) and get three books back. Uses the same Oracle calls as your other Oracle features, so it counts against the same monthly/daily limit.',
      'New: every Oracle recommendation now shows a Match % — how well the Oracle thinks a book fits you, based on your ratings, favorite genres, and mood. Some are the Oracle\u2019s own estimate; others (like wishlist-matched picks) are computed directly from your data.',
      'Dashboard: "My Books at Glance" is now front and center at the top of the page, with two new counts \u2014 Book Clubs and Reading Plans \u2014 alongside Read, Wishlist, and Currently Reading.',
      'Dashboard: your Book Clubs widget now shows the current session, the book being read, and who else is reading along \u2014 not just a name and a link.',
      'Dashboard: the Reading Goal widget now includes a breakdown of your top genres for the year.',
      'Fixed: cover images and a couple of background book lookups were being silently blocked by the app\u2019s security settings \u2014 could occasionally affect cover loading or auto-filled book details.',
    ],
    bodyEs: [
      'Nuevo: Preguntale al Oráculo — una tercera forma de conseguir recomendaciones, junto a Por Géneros y Basado en Otros Libros. Describí qué estás buscando con tus propias palabras (un estado de ánimo, un momento, una pregunta) y recibí tres libros. Usa las mismas consultas al Oráculo que tus otras funciones, así que cuenta para el mismo límite mensual/diario.',
      'Nuevo: cada recomendación del Oráculo ahora muestra una Compatibilidad % \u2014 qué tan bien cree el Oráculo que un libro te queda, según tus calificaciones, géneros favoritos y estado de ánimo. Algunas son una estimación del Oráculo; otras (como las de tu lista de deseos) se calculan directamente con tus datos.',
      'Dashboard: "Mis Libros de un Vistazo" ahora está más arriba y más visible en la página, con dos contadores nuevos \u2014 Clubes de Lectura y Planes de Lectura \u2014 junto a Leídos, Lista de Deseos y Leyendo Ahora.',
      'Dashboard: tu widget de Clubes de Lectura ahora muestra la sesión actual, el libro que se está leyendo, y quién más lo está leyendo con vos \u2014 no solo un nombre y un enlace.',
      'Dashboard: el widget de Meta de Lectura ahora incluye un desglose de tus géneros más leídos en el año.',
      'Corregido: las portadas y algunas búsquedas de datos de libros en segundo plano estaban siendo bloqueadas en silencio por la configuración de seguridad de la app \u2014 podía afectar ocasionalmente la carga de portadas o el autocompletado de detalles de libros.',
    ],
  }, 
  {
    version: 'v0.41.0',
    date: '2026-07-08',
    titleEn: 'A real front door: the public landing page',
    titleEs: 'Una puerta de entrada de verdad: la p\u00e1gina p\u00fablica',
    bodyEn: [
      'thebooksoracle.com now greets signed-out visitors with a proper marketing page instead of the sign-in screen \u2014 what the Oracle does, a tour of every feature (with real screenshots coming soon), pricing, and FAQs, in English and Spanish.',
      'Privacy, Terms, Refund, and Sitemap pages now show the public site\u2019s look when you\u2019re signed out, and switch back to the app\u2019s own styling once you\u2019re logged in.',
      'Signing in or starting a free account now happens right from the landing page \u2014 no separate page to find first.',
    ],
    bodyEs: [
      'thebooksoracle.com ahora recibe a quienes no iniciaron sesi\u00f3n con una p\u00e1gina p\u00fablica de verdad en vez de la pantalla de inicio de sesi\u00f3n \u2014 qu\u00e9 hace el Or\u00e1culo, un recorrido por cada funci\u00f3n (con capturas reales pr\u00f3ximamente), precios y preguntas frecuentes, en espa\u00f1ol e ingl\u00e9s.',
      'Las p\u00e1ginas de Privacidad, T\u00e9rminos, Reembolsos y Mapa del sitio ahora muestran el estilo del sitio p\u00fablico cuando no iniciaste sesi\u00f3n, y vuelven al estilo de la app una vez que inici\u00e1s sesi\u00f3n.',
      'Iniciar sesi\u00f3n o crear una cuenta gratis ahora se hace directo desde la p\u00e1gina p\u00fablica \u2014 sin tener que buscar otra pantalla primero.',
    ],
  }, {
    version: 'v0.40.1',
    date: '2026-07-06',
    titleEn: 'Find a Book Club',
    titleEs: 'Encontr\u00e1 un Club de Lectura',
    bodyEn: [
      'New: Discover clubs from the Book Clubs page \u2014 search by name, filter by genre or mood, and see what each club is currently reading before you join.',
      'When creating a club, choose Private (invite-only, as before) or Public, which lets anyone find it in the directory. Public clubs can require your approval on join requests, and can cap membership \u2014 once full, new joiners land on a waitlist and move in automatically as spots open up.',
    ],
    bodyEs: [
      'Nuevo: Descubr\u00ed clubes desde la p\u00e1gina de Clubes de Lectura \u2014 busc\u00e1 por nombre, filtr\u00e1 por g\u00e9nero u onda, y mir\u00e1 qu\u00e9 est\u00e1 leyendo cada club antes de sumarte.',
      'Al crear un club, eleg\u00ed Privado (solo por invitaci\u00f3n, como antes) o P\u00fablico, que permite que cualquiera lo encuentre en el directorio. Los clubes p\u00fablicos pueden pedir tu aprobaci\u00f3n antes de sumar gente, y pueden tener un l\u00edmite de miembros \u2014 una vez lleno, los nuevos quedan en una lista de espera y se suman solos cuando se libera un lugar.',
    ],
  }, {
    version: 'v0.39.11',
    date: '2026-07-06',
    titleEn: 'Link previews now work for every book',
    titleEs: 'Las vistas previas de enlaces ahora funcionan para todos los libros',
    bodyEn: [
      'Sharing any book link on Slack, WhatsApp, X, or Discord now shows the real title, cover, and description \u2014 including books that haven\u2019t been manually reviewed yet.',
    ],
    bodyEs: [
      'Compartir cualquier enlace de libro en Slack, WhatsApp, X o Discord ahora muestra el t\u00edtulo real, la portada y la descripci\u00f3n \u2014 incluyendo libros que todav\u00eda no fueron revisados manualmente.',
    ],
  }, {
    version: 'v0.39.10',
    date: '2026-07-06',
    titleEn: 'Fixed link previews still not matching books',
    titleEs: 'Se corrigi\u00f3 que las vistas previas de enlaces todav\u00eda no encontraban libros',
    bodyEn: [
      'The link-preview lookup was comparing an internal ID it generates itself against a slightly different version of the same ID used elsewhere in the app \u2014 close enough to look right, but never an exact match. Loosened the comparison so small formatting differences like this can\u2019t cause a silent mismatch again.',
    ],
    bodyEs: [
      'La b\u00fasqueda de vistas previas de enlaces comparaba un identificador interno que genera por su cuenta contra una versi\u00f3n ligeramente distinta del mismo identificador usada en otra parte de la app \u2014 lo suficientemente parecido para parecer correcto, pero nunca una coincidencia exacta. Se flexibiliz\u00f3 la comparaci\u00f3n para que peque\u00f1as diferencias de formato como esta no vuelvan a causar un desajuste silencioso.',
    ],
  }, {
    version: 'v0.39.9',
    date: '2026-07-06',
    titleEn: 'Fixed sitemap and link previews silently truncating the catalog',
    titleEs: 'Se corrigi\u00f3 el truncamiento silencioso del cat\u00e1logo en el mapa del sitio y las vistas previas',
    bodyEn: [
      'The sitemap and link-preview lookup were silently capped at the first 1,000 books in the catalog \u2014 both now page through the full catalog, so books further down the list are found correctly.',
    ],
    bodyEs: [
      'El mapa del sitio y la b\u00fasqueda de vistas previas de enlaces estaban limitados en silencio a los primeros 1000 libros del cat\u00e1logo \u2014 ambos ahora recorren el cat\u00e1logo completo, para que los libros m\u00e1s adelante en la lista se encuentren correctamente.',
    ],
  }, {
    version: 'v0.39.8',
    date: '2026-07-06',
    titleEn: 'Fixed link previews not finding any books',
    titleEs: 'Se corrigieron las vistas previas que no encontraban ningún libro',
    bodyEn: [
      'The link-preview feature from the last release never actually found a book, in any case \u2014 fixed the lookup logic, and widened it to also catch books the Oracle has categorized but that haven\u2019t been manually verified yet.',
    ],
    bodyEs: [
      'La funci\u00f3n de vista previa de enlaces de la versi\u00f3n anterior nunca encontraba ning\u00fan libro, en ning\u00fan caso \u2014 se corrigi\u00f3 la l\u00f3gica de b\u00fasqueda, y se ampli\u00f3 para tambi\u00e9n incluir libros que el Or\u00e1culo categoriz\u00f3 pero que todav\u00eda no fueron verificados manualmente.',
    ],
  }, {
    version: 'v0.39.7',
    date: '2026-07-04',
    titleEn: 'Better link previews when books and series are shared',
    titleEs: 'Mejores vistas previas al compartir libros y series',
    bodyEn: [
      'Sharing a book or series link in Slack, WhatsApp, X, or Discord now shows the real title, cover, and description in the preview \u2014 instead of the site\u2019s generic name for every link.',
    ],
    bodyEs: [
      'Compartir un enlace de un libro o serie en Slack, WhatsApp, X o Discord ahora muestra el t\u00edtulo real, la portada y la descripci\u00f3n en la vista previa \u2014 en vez del nombre gen\u00e9rico del sitio para cualquier enlace.',
    ],
  }, {
    version: 'v0.39.6',
    date: '2026-07-04',
    titleEn: 'Fixed the Series page, and a stats bug',
    titleEs: 'Se corrigi\u00f3 la p\u00e1gina de Series, y un error en las estad\u00edsticas',
    bodyEn: [
      'The Series page had lost its styling entirely and now has its own clean look \u2014 distinct from Reading Plans, so the two won\u2019t be confused for one another.',
      'Fixed a bug where editing a book\u2019s read date (or rating) could silently fail to save for certain books, so the change would look like it worked but revert the next time you opened the app.',
    ],
    bodyEs: [
      'La p\u00e1gina de Series hab\u00eda perdido todo su estilo y ahora tiene un dise\u00f1o propio y prolijo \u2014 distinto al de los Planes de Lectura, para que no se confundan entre s\u00ed.',
      'Se corrigi\u00f3 un error donde editar la fecha de lectura (o calificaci\u00f3n) de un libro pod\u00eda fallar en silencio para ciertos libros, haciendo que el cambio pareciera funcionar pero se revirtiera la pr\u00f3xima vez que abr\u00edas la app.',
    ],
  }, {
    version: 'v0.39.5',
    date: '2026-07-04',
    titleEn: 'Mobile search, reading progress on the book page, and more scroll fixes',
    titleEs: 'B\u00fasqueda en m\u00f3vil, progreso de lectura en la p\u00e1gina del libro, y m\u00e1s arreglos de scroll',
    bodyEn: [
      'The search bar is back on mobile \u2014 open the menu and it\u2019s right there at the top.',
      'Marking a book as read now opens the rating prompt right away, instead of silently filing it away with no rating.',
      'If you\u2019re currently reading a book, its book page now shows your progress bar and lets you update it or mark it finished \u2014 previously there was no way to do either from there.',
      'Fixed the same phantom-scroll bug (from last release) also affecting the 404 page and every loading spinner across the app.',
    ],
    bodyEs: [
      'La barra de b\u00fasqueda volvi\u00f3 en m\u00f3vil \u2014 abr\u00ed el men\u00fa y ah\u00ed est\u00e1, arriba de todo.',
      'Marcar un libro como le\u00eddo ahora abre el panel de calificaci\u00f3n al toque, en vez de guardarlo en silencio sin calificar.',
      'Si est\u00e1s leyendo un libro en este momento, su p\u00e1gina ahora muestra tu barra de progreso y te deja actualizarla o marcarlo como terminado \u2014 antes no hab\u00eda forma de hacer ninguna de las dos cosas desde ah\u00ed.',
      'Se corrigi\u00f3 el mismo error de scroll fantasma (de la versi\u00f3n anterior) que tambi\u00e9n afectaba la p\u00e1gina 404 y cada pantalla de carga de la app.',
    ],
  }, {
    version: 'v0.39.4',
    date: '2026-07-04',
    titleEn: 'Fixed phantom scroll on mobile',
    titleEs: 'Se corrigi\u00f3 el scroll fantasma en m\u00f3vil',
    bodyEn: [
      'Fixed a mobile bug where several full-screen pages (sign-in, onboarding, loading screen) had extra scroll space below the content \u2014 caused by how mobile browsers measure screen height around their address bar.',
    ],
    bodyEs: [
      'Se corrigi\u00f3 un error en m\u00f3vil donde varias pantallas completas (inicio de sesi\u00f3n, bienvenida, pantalla de carga) ten\u00edan espacio de scroll de m\u00e1s debajo del contenido \u2014 causado por c\u00f3mo los navegadores m\u00f3viles miden el alto de pantalla alrededor de la barra de direcciones.',
    ],
  }, {
    version: 'v0.39.3',
    date: '2026-07-03',
    titleEn: 'A proper 404 page, and a sitemap',
    titleEs: 'Una p\u00e1gina 404 como corresponde, y un mapa del sitio',
    bodyEn: [
      "Broken or old links now land on a proper \u201cthe Oracle can't see where you're going\u201d page instead of silently opening your dashboard.",
      'Added a Sitemap page (linked from the footer) mapping out every section of the app \u2014 wishlist, library, and profile stay private to you, so they\u2019re not listed there.',
    ],
    bodyEs: [
      'Los enlaces rotos o antiguos ahora llevan a una p\u00e1gina propia \u2014\u201cel Or\u00e1culo no puede ver hacia d\u00f3nde vas\u201d\u2014 en vez de abrir tu panel silenciosamente.',
      'Se agreg\u00f3 una p\u00e1gina de Mapa del sitio (enlazada desde el pie de p\u00e1gina) con cada secci\u00f3n de la app \u2014 lista de deseos, biblioteca y perfil siguen siendo privados, as\u00ed que no aparecen ah\u00ed.',
    ],
  }, {
    version: 'v0.39.2',
    date: '2026-07-03',
    titleEn: 'Sitemap, page titles, and search previews',
    titleEs: 'Mapa del sitio, t\u00edtulos de p\u00e1gina y vistas previas',
    bodyEn: [
      'Every page now has its own browser tab title and description instead of one generic title everywhere \u2014 book pages show the title and author, series pages show the series name.',
      "A live sitemap now lists every book and series in the catalog, so search engines can discover pages they wouldn't otherwise find on their own.",
    ],
    bodyEs: [
      'Cada p\u00e1gina ahora tiene su propio t\u00edtulo de pesta\u00f1a y descripci\u00f3n en vez de un t\u00edtulo gen\u00e9rico en todos lados \u2014 las p\u00e1ginas de libros muestran t\u00edtulo y autor, las de series muestran el nombre de la serie.',
      'Un mapa del sitio en vivo ahora lista cada libro y serie del cat\u00e1logo, para que los motores de b\u00fasqueda descubran p\u00e1ginas que de otra forma no encontrar\u00edan.',
    ],
  }, {
    version: 'v0.39.1',
    date: '2026-07-03',
    titleEn: 'Real, shareable URLs',
    titleEs: 'URLs reales y f\u00e1ciles de compartir',
    bodyEn: [
      'Every page now has a real, clean URL instead of the old #hash links \u2014 book pages, shared lists, reading plans, and club invites all look like thebooksoracle.com/book/... now.',
      'Old bookmarked or shared #hash links still work \u2014 they quietly redirect to the new URL format.',
      'This is a behind-the-scenes step toward better SEO; more improvements (sitemap, page previews) are coming in the same release line.',
    ],
    bodyEs: [
      'Cada p\u00e1gina ahora tiene una URL real y limpia en vez de los antiguos enlaces con #hash \u2014 p\u00e1ginas de libros, listas compartidas, planes de lectura e invitaciones a clubes ahora se ven como thebooksoracle.com/book/...',
      'Los enlaces antiguos guardados o compartidos con #hash todav\u00eda funcionan \u2014 redirigen silenciosamente al nuevo formato.',
      'Este es un paso t\u00e9cnico hacia mejor SEO; m\u00e1s mejoras (mapa del sitio, vistas previas de p\u00e1ginas) vienen en la misma l\u00ednea de versi\u00f3n.',
    ],
  }, {
    version: 'v0.38',
    date: '2026-07-03',
    titleEn: 'A richer onboarding, tuned to your taste',
    titleEs: 'Una bienvenida m\u00e1s completa, ajustada a tu gusto',
    bodyEn: [
      'Onboarding now asks for your favorite genres and what you\'re in the mood for right now, alongside the reading level, Goodreads import, and goal steps you already know.',
      'These new preferences show up on your Profile, where you can update them any time \u2014 no need to redo onboarding.',
      'Oracle Spark now leans on your favorite genres and current mood when picking a surprise from your wishlist.',
    ],
    bodyEs: [
      'La bienvenida ahora te pregunta tus g\u00e9neros favoritos y qu\u00e9 tipo de lectura busc\u00e1s en este momento, adem\u00e1s de los pasos de nivel lector, importaci\u00f3n de Goodreads y meta que ya conoc\u00e9s.',
      'Estas nuevas preferencias aparecen en tu Perfil, donde pod\u00e9s actualizarlas cuando quieras \u2014 sin tener que repetir la bienvenida.',
      'Oracle Spark ahora toma en cuenta tus g\u00e9neros favoritos y tu \u00e1nimo actual al elegir una sorpresa de tu lista de deseos.',
    ],
  }, {
    version: 'v0.37.3',
    date: '2026-07-03',
    titleEn: 'Custom page counts for your edition',
    titleEs: 'Número de páginas personalizado para tu edición',
    bodyEn: [
      'When updating your reading progress, you can now tell the Oracle your edition has a different page count than our catalog — a paperback, a translation, whatever you\'re actually holding.',
      'Your progress bar, percentage, and book club session progress now use your own page count once you\'ve set one. Everyone else in the club still sees the catalog page count.',
    ],
    bodyEs: [
      'Al actualizar tu progreso de lectura, ahora podés decirle al Oráculo que tu edición tiene un número de páginas distinto al del catálogo — una edición de bolsillo, una traducción, lo que sea que tengas en mano.',
      'Tu barra de progreso, el porcentaje y el progreso en las sesiones de club de lectura ahora usan tu propio número de páginas una vez que lo configurás. El resto del club sigue viendo el número de páginas del catálogo.',
    ],
  },
  {
    version: 'v0.37.2',
    date: '2026-07-02',
    titleEn: 'List pages, cover hover, email sign-in & fixes',
    titleEs: 'Páginas de listas, hover de portadas, acceso por correo y correcciones',
    bodyEn: [
      'Redesigned the Lists experience: the List Dashboard now previews each list\'s covers with a "+N more" overflow, and both the dashboard and individual list pages follow the design system with proper headers, badges and spacing.',
      'Fixed the cover hover everywhere in the app — hovering a book cover now lifts it and reveals a richer overlay with the title, author and genres. Previously hovering did nothing at all.',
      'Added a new "My Plans" page that lists every reading plan you\'ve created with its progress, and fixed the plan view that was rendering unstyled.',
      'You can now sign in with a passwordless email link, in addition to Google. Removed the guest option.',
      'You can now withdraw a friend request while it\'s still pending — hover the "Request sent" button to cancel it.',
      'Cleaned up the About page (pricing deep-links now work) and the Profile page spacing, and fixed a couple of crashes and corner-bracket / modal consistency issues carried over from the design-system pass.',
    ],
    bodyEs: [
      'Se rediseñó la experiencia de Listas: el panel de Listas ahora muestra una vista previa de las portadas de cada lista con un indicador "+N más", y tanto el panel como las páginas de lista individuales siguen el sistema de diseño con encabezados, distintivos y espaciado correctos.',
      'Se corrigió el hover de las portadas en toda la app — al pasar el cursor sobre la portada de un libro ahora se eleva y muestra una capa con título, autora y géneros. Antes el hover no hacía nada.',
      'Se agregó una nueva página "Mis Planes" que lista todos los planes de lectura que creaste con su progreso, y se corrigió la vista de plan que se mostraba sin estilo.',
      'Ahora podés entrar con un link por correo sin contraseña, además de Google. Se quitó la opción de invitada.',
      'Ahora podés retirar una solicitud de amistad mientras está pendiente — pasá el cursor sobre "Solicitud enviada" para cancelarla.',
      'Se ordenó la página Acerca de (los enlaces directos a precios ya funcionan) y el espaciado del Perfil, y se corrigieron un par de fallas y problemas de consistencia de esquinas doradas y modales heredados del rediseño.',
    ],
  },
  {
    version: 'v0.37.1',
    date: '2026-07-01',
    titleEn: 'Design System redesign — sign-in, forms, Oracle, clubs, profile',
    titleEs: 'Rediseño con el Sistema de Diseño — inicio de sesión, formularios, Oráculo, clubs, perfil',
    bodyEn: [
      'A major redesign pass powered by the Books Oracle Design System: sign-in and onboarding, both Oracle recommendation flows, the book club page, several forms, and the Profile page have all been rebuilt to match the design system\'s look and components — brackets, buttons, cards, and typography now consistent across the app instead of a mix of styled and unstyled screens.',
      'Fixed a crash on club session pages: the member progress row called a translation function that was never loaded, so any session with a page-count goal could fail to render.',
      'Fixed a bug where the guest sign-in prompt showed the literal text "[object Object]" instead of a clickable link — the translation system now correctly embeds links and other elements into sentences, not just plain text.',
      'The sign-in screen and the three-step onboarding flow (reading level, Goodreads import, goal) had no styling behind them at all and rendered as plain unformatted text. They now use the same bracketed card, step indicator, and button styling as the rest of the app.',
      'The Oracle\'s two recommendation flows — by genre and by similar books — are rebuilt on the shared card and pill components, including the italic "why this book" line the Oracle gives for AI matches.',
      'The book club page, the "new list" and "report a problem" forms, and the session edit modal now use the app\'s real buttons, inputs, and dropdowns instead of unstyled or dead classes.',
      'Modals, the login card, and the profile\'s account card now consistently show all four gold corner brackets — previously only the top two ever rendered, since the bottom two required page code that no screen actually included.',
      'Your reading stats, pace chart, top genres, favourite author, and series in progress now sit as their own sections on the Profile page instead of inside one shared box, matching the design system; your account settings remain grouped together in a single card below.',
    ],
    bodyEs: [
      'Un rediseño importante impulsado por el Sistema de Diseño de The Books Oracle: el inicio de sesión y la bienvenida, los dos flujos de recomendación del Oráculo, la página de clubs de lectura, varios formularios y la página de Perfil se reconstruyeron para coincidir con el look y los componentes del sistema de diseño — esquinas doradas, botones, tarjetas y tipografía ahora consistentes en toda la app en vez de una mezcla de pantallas con y sin estilo.',
      'Se corrigió un error que rompía la página de sesión del club: la fila de progreso de cada miembro llamaba a una función de traducción que nunca se había cargado, por lo que cualquier sesión con una meta de páginas podía fallar al mostrarse.',
      'Se corrigió un error donde la invitación a probar como invitada mostraba el texto literal "[object Object]" en vez de un link — el sistema de traducciones ahora puede insertar links y otros elementos dentro de una oración, no solo texto plano.',
      'La pantalla de inicio de sesión y el flujo de bienvenida de tres pasos (nivel de lectura, importar Goodreads, meta) no tenían ningún estilo y se mostraban como texto plano sin formato. Ahora usan la misma tarjeta con esquinas doradas, indicador de pasos y botones que el resto de la app.',
      'Los dos flujos de recomendación del Oráculo — por género y por libros similares — se reconstruyeron sobre los componentes de tarjeta y píldora compartidos, incluida la línea itálica de "por qué este libro" que da el Oráculo en las recomendaciones con IA.',
      'La página del club de lectura, los formularios de "nueva lista" y "reportar un problema", y el modal de edición de sesión ahora usan los botones, campos y desplegables reales de la app en vez de clases sin estilo o inexistentes.',
      'Los modales, la tarjeta de inicio de sesión y la tarjeta de cuenta del perfil ahora muestran consistentemente las cuatro esquinas doradas — antes solo se veían las dos de arriba, porque las de abajo necesitaban código que ninguna pantalla incluía.',
      'Tus estadísticas de lectura, el gráfico de ritmo, los géneros más leídos, tu autora favorita y las sagas en progreso ahora son secciones propias en tu Perfil en vez de estar dentro de una sola caja, siguiendo el sistema de diseño; la configuración de tu cuenta se mantiene agrupada en una sola tarjeta más abajo.',
    ],
  },
  {
    version: 'v0.36.4',
    date: '2026-06-24',
    titleEn: 'Bug fix — friend library toolbar styling',
    titleEs: 'Corrección — estilo del toolbar de biblioteca de amigo',
    bodyEn: [
      'The search input and dropdowns in the friend library now match the Library and Wishlist pages exactly. Previously they used inline styles with light-mode input tokens, rendering as plain unstyled browser defaults. Now using the app\'s .wishlist-toolbar, .wishlist-filters, and .search-input classes with the same dark background, gilt caret, and EB Garamond italic that the rest of the app uses for filter controls.',
    ],
    bodyEs: [
      'El campo de búsqueda y los desplegables en la biblioteca de amigos ahora coinciden exactamente con las páginas de Biblioteca y Lista de deseos. Antes usaban estilos en línea con tokens de modo claro, mostrándose como controles de navegador sin estilo. Ahora usa las clases .wishlist-toolbar, .wishlist-filters y .search-input de la app con el mismo fondo oscuro, flecha dorada y EB Garamond itálica que el resto de la app usa para los controles de filtro.',
    ],
  },
  {
    version: 'v0.36.3',
    date: '2026-06-24',
    titleEn: 'Bug fix — friend library was empty',
    titleEs: 'Corrección — biblioteca de amigo aparecía vacía',
    bodyEn: [
      'Fixed two bugs that caused the friend library to show empty: the i18n key friends.friendsEmpty was missing (it lived in profile.friendsEmpty), and the library data query was using an incorrect deeply-nested join that Supabase PostgREST silently dropped.',
      'getFriendLibrary now uses the same read_books + books join shape as DataContext, with a separate book_genres query to attach genre data — exactly matching how the rest of the app reads library data.',
    ],
    bodyEs: [
      'Se corrigieron dos errores que hacían que la biblioteca de amigos apareciera vacía: la clave i18n friends.friendsEmpty no existía (estaba en profile.friendsEmpty), y la consulta de datos usaba una unión anidada incorrecta que Supabase PostgREST ignoraba silenciosamente.',
      'getFriendLibrary ahora usa la misma forma de unión read_books + books que DataContext, con una consulta separada de book_genres para adjuntar datos de género, coincidiendo exactamente con cómo el resto de la app lee los datos de la biblioteca.',
    ],
  },
  {
    version: 'v0.36.2',
    date: '2026-06-24',
    titleEn: 'Friend profile — full library with filters',
    titleEs: 'Perfil de amigo — biblioteca completa con filtros',
    bodyEn: [
      'The friend library now shows all books with full filtering. Search by title or author, filter by genre or year, sort by recently read, rating, title, or author.',
      'Books load 48 at a time with a "Load more" button — so a 430-book library doesn\'t overwhelm the page on first load.',
      'Each book shows its cover, title, author, and star rating. Genre tags come from Oracle-curated genres in the book_genres table, with a fallback to the raw genre field.',
      'You can now also filter by year read — useful for seeing what a friend finished in a specific year.',
    ],
    bodyEs: [
      'La biblioteca de amigos ahora muestra todos los libros con filtros completos. Buscá por título o autor, filtrá por género o año, ordená por leídos recientemente, calificación, título o autor.',
      'Los libros cargan de a 48 con un botón "Cargar más" — así una biblioteca de 430 libros no satura la página al primer clic.',
      'Cada libro muestra su portada, título, autor y calificación con estrellas. Las etiquetas de género vienen de los géneros curados por el Oráculo en la tabla book_genres, con respaldo en el campo de género directo.',
      'También podés filtrar por año de lectura — útil para ver qué terminó un amigo en un año específico.',
    ],
  },
  {
    version: 'v0.36.1',
    date: '2026-06-24',
    titleEn: 'Friends feed + profile URL fix',
    titleEs: 'Feed de amigos + corrección de URL de perfil',
    bodyEn: [
      'Sharing your profile link (e.g. thebookoracle.app/u/yourname) now correctly opens the friend profile view for anyone who clicks it. Previously the app ignored the pathname and always redirected to the dashboard.',
      'When you open your own profile link, you now see exactly what your friends see — a great way to check what you\'re sharing before sending the link.',
      'New "Friends reading" dashboard widget shows what your reading friends have recently finished or started, with their avatar, the book cover, and how long ago. A Refresh button fetches the latest. The widget shows a helpful prompt if you have no friends yet.',
      'The existing activity feed widget is now labelled "My activity" in the widget settings to clearly distinguish it from the friends feed.',
    ],
    bodyEs: [
      'Compartir tu link de perfil (ej. thebookoracle.app/u/tunombre) ahora abre correctamente el perfil para cualquiera que haga clic. Antes la app ignoraba la ruta y siempre redirigía al panel.',
      'Cuando abrís tu propio link de perfil, ahora ves exactamente lo que ven tus amigos — ideal para revisar qué estás compartiendo antes de enviarlo.',
      'Nuevo widget "Amigos leyendo" muestra qué terminaron o empezaron a leer tus amigos recientemente, con su avatar, la portada del libro y hace cuánto. Un botón Actualizar trae los datos más recientes.',
      'El widget de actividad existente ahora se llama "Mi actividad" en la configuración de widgets para diferenciarlo claramente del feed de amigos.',
    ],
  },
  {
    version: 'v0.36',
    date: '2026-06-24',
    titleEn: 'Friends, usernames & notifications',
    titleEs: 'Amigos, nombres de usuario y notificaciones',
    bodyEn: [
      'You can now claim a unique username (e.g. @simon) and set a separate display name (Simon, Si, Sim — whatever you like). Username is your permanent handle used in profile URLs and friend requests; display name is how you appear in greetings.',
      'Send friend requests by sharing your profile link. Accept or decline directly from the new notification bell in the nav.',
      'The notification bell shows a live unread count badge and opens a panel with accept/decline buttons inline. New requests appear in real time via Supabase Realtime — no refresh needed.',
      'Friend requests and acceptances now trigger an email notification via Resend. You can turn emails off in your profile privacy settings.',
      'Friend profiles show currently reading, full library, reading stats, and a mini progress bar for series in progress.',
    ],
    bodyEs: [
      'Ahora podés elegir un nombre de usuario único (ej. @simon) y configurar un nombre visible por separado (Simón, Si, Sim — lo que quieras). El nombre de usuario es tu identificador permanente para URLs de perfil y solicitudes de amistad; el nombre visible es cómo aparecés en los saludos.',
      'Enviá solicitudes de amistad compartiendo tu link de perfil. Aceptá o rechazá directamente desde la nueva campana de notificaciones en la barra de navegación.',
      'La campana muestra el conteo de no leídos en tiempo real y abre un panel con botones de aceptar/rechazar integrados. Las solicitudes nuevas aparecen al instante vía Supabase Realtime.',
      'Las solicitudes de amistad y aceptaciones ahora disparan un email de notificación vía Resend. Podés desactivar los emails en tu configuración de privacidad.',
      'Los perfiles de amigos muestran qué están leyendo, su biblioteca completa, estadísticas de lectura y barras de progreso de series en curso.',
    ],
  },
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