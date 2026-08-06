-- ============================================================
-- announce_v058.sql — one-time broadcast. Run LAST, after the reset.
--
-- Order matters: this tells people their calls have been restored, so it must
-- not arrive before reset_oracle_quota_v058.sql has actually restored them.
--
-- ── Body format (matches the previous announcements) ─────────────────────────
-- Single-quoted string, LITERAL backslash-n for line breaks, apostrophes
-- doubled ('' inside the string). Not dollar quoting and not real newlines —
-- AnnouncementModal.jsx does:
--
--     (body || preview || '').replace(/\\n/g, '\n').split('\n').filter(Boolean)
--
-- so it un-escapes the two-character sequence \n, then drops empty lines and
-- renders each remaining line as its own <p>. Blank-line spacing therefore
-- comes from the paragraph margins, not from \n\n — but \n\n is kept anyway to
-- match how every prior announcement was written and to keep the source
-- readable.
--
-- ── Editorial notes ──────────────────────────────────────────────────────────
-- Leads with the refund, not the feature. The person who wrote in complained
-- about calls disappearing; "you have your calls back" answers that first,
-- "here is a history panel" answers it second.
--
-- It says plainly that the import path was charging when it shouldn't have.
-- Naming the cause is the difference between an apology and an excuse, and it
-- is the only part of this that actually explains where their calls went. The
-- Oracle voice rule holds throughout: the Oracle offers, the reader decides.
--
-- ── Bilingual in one body ────────────────────────────────────────────────────
-- public.announcements has a single `body` column and no language field, and
-- the notification payload, modal and email all read that one string. English
-- first, then a rule, then rioplatense Spanish. Two announcements would double
-- every user's notifications to serve one language each.
-- ============================================================

-- ── 1. Confirm the admin id ──────────────────────────────────────────────────
-- Expect exactly one row, and expect it to match the uuid hardcoded in step 3.
select id as admin_id, email
from auth.users
where email = 'simont@mozillafoundation.org';

-- ── 2. Preview the fan-out size ──────────────────────────────────────────────
-- broadcast_announcement inserts one notification row PER PROFILE in a loop.
-- Worth knowing the number before you trigger it.
select count(*) as notifications_that_will_be_created from public.profiles;

-- ── 3. Broadcast ─────────────────────────────────────────────────────────────
-- Run this block ONCE. There is no idempotency guard — running it twice sends
-- everyone a duplicate notification.
SELECT broadcast_announcement(
  'Your Oracle calls are back — and now you can see where they go · Tus consultas al Oráculo vuelven — y ahora podés ver en qué se usan',
  'Every account''s Oracle calls have been reset. Whatever your balance was, you begin again with a full quota.\n\nHere is why. When you imported a list of books, any title the catalogue could not identify was quietly passed to the Oracle — and charged as one of your calls. That was never meant to happen, and it is why some of you ran out far sooner than made any sense. Identifying a book during an import is free now, as it always should have been, and the calls that fault ran up have been given back.\n\nWhat''s new:\n\n• A history of your calls — under Profile → Subscription there is now a record of every Oracle call: which part of the app it came from, and when. If your quota ever empties faster than you expect, you can look instead of guess.\n\n• An explanation, once — the first time you consult the Oracle, a short note explains what does and does not use a call. Anything marked Oracle draws one. Searching, importing, building your shelves and tracking your reading never will.\n\n• A word before the last one — when you are down to your final call of the period, the Oracle asks you to confirm before spending it. The decision stays yours; it simply stops being a surprise.\n\n• Nothing you asked is recorded — the history keeps only the section and the time. Never your question, and never which book you were reading.\n\nThank you to the reader who wrote in about this. It was a fair complaint, and a better app came out of it.\n\n· · ·\n\nReiniciamos las consultas al Oráculo de todas las cuentas. Sea cual sea el saldo que tenías, empezás de nuevo con la cuota completa.\n\nTe contamos por qué. Cuando importabas una lista de libros, cualquier título que el catálogo no lograba identificar pasaba al Oráculo sin avisarte — y se cobraba como una de tus consultas. Nunca tuvo que funcionar así, y es la razón por la que a varios se les acabaron mucho antes de lo razonable. Identificar un libro durante una importación ahora es gratis, como siempre debió ser, y las consultas que ese error gastó te fueron devueltas.\n\nQué hay de nuevo:\n\n• Un historial de tus consultas — en Perfil → Suscripción ahora hay un registro de cada consulta al Oráculo: de qué parte de la app salió y cuándo. Si alguna vez tu cuota se vacía más rápido de lo esperado, podés mirar en vez de adivinar.\n\n• Una explicación, una sola vez — la primera vez que consultás al Oráculo, una nota breve te aclara qué usa una consulta y qué no. Todo lo que dice Oráculo usa una. Buscar, importar, armar tus estantes y registrar tus lecturas nunca lo van a hacer.\n\n• Un aviso antes de la última — cuando te queda la última consulta del período, el Oráculo te pide que confirmes antes de gastarla. La decisión sigue siendo tuya; simplemente deja de ser una sorpresa.\n\n• Nada de lo que preguntás queda registrado — el historial guarda solo la sección y la hora. Nunca tu pregunta, ni qué libro estabas leyendo.\n\nGracias a quien nos escribió por esto. Era un reclamo justo, y la app quedó mejor.',
  'e24137be-81a2-4462-b6e8-6cfd462d4b1a'
);

-- ── 4. Verify ────────────────────────────────────────────────────────────────
select id, title, created_at, length(body) as body_chars
from public.announcements
order by created_at desc
limit 1;

select count(*) as notifications_sent
from public.notifications
where type = 'announcement'
  and created_at > now() - interval '5 minutes';

-- Confirm the escaping survived. The modal un-escapes the two-character
-- sequence backslash-n, so that is what must be sitting in the column.
-- Note the doubled backslash: LIKE's default escape character IS backslash,
-- so '%\n%' would match a literal "n" and pass for the wrong reason.
select
  body like '%\\n%'        as has_literal_backslash_n,  -- expect true
  body like '%' || chr(10) || '%' as has_real_newlines  -- expect false
from public.announcements
order by created_at desc
limit 1;

-- ============================================================
-- If you need to pull it back
-- ============================================================
-- Deleting the announcement does NOT remove the notifications — they carry
-- their own copy of the title and body in `data` (that is why schema_v25
-- exists). Remove both, newest first:
--
--   delete from public.notifications
--   where type = 'announcement'
--     and data->>'announcement_id' = '<the uuid from step 4>';
--
--   delete from public.announcements where id = '<the uuid from step 4>';
-- ============================================================
