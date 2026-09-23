// src/components/BookLoader.jsx
//
// The loading screen's quote pool. One quote shows at a time and they rotate
// every ROTATE_MS, so a long wait (the Oracle, a reading plan) stays worth
// looking at. Order is shuffled per mount and walked in sequence, so nothing
// repeats until the whole pool is exhausted.
//
// ── v0.63.3: 198 quotes → 515; 49 genre shelves → 173 ──────────────────────────
//
// The pool was written when the taxonomy had 49 genres. public.genres now
// holds 137, and the pool had never caught up: 78 of the shelves a reader can
// actually browse had no voice in the loader at all, including Science Fiction
// (604 books), Young Adult (432) and Thriller (240). Coverage is now 136 of
// 137. The exception is Flintlock Fantasy, which holds no books and whose one
// verifiable line — McClellan's "The age of kings is dead" — is filed below
// under Military Fantasy rather than duplicated.
//
// Each quote carries the `genre` of the heading it is filed under (stamped
// from the headings in the three.js-motion experiment). The loader shows it as
// a small "from the shelf of…" tag, linked to the genre page when the name
// matches a row in public.genres, and a caller can pass `genres` to put that
// shelf's lines first (the Oracle does, for the temperament being drawn). The
// headings are still how the pool is organised — keep new quotes under one,
// and give the quote the heading's name.
//
// EVERY QUOTE ADDED IN v0.63.3 WAS VERIFIED against a source before it was
// written here: wording, author, and title. That is not fussiness. This is a
// product whose whole proposition is that it knows books, and a confidently
// misattributed line costs more than a missing one. If you extend this pool,
// verify first and DROP anything you cannot confirm rather than reconstructing
// it from memory — a genre with two real quotes beats one with three where the
// third is invented. Several sections below carry two for exactly that reason.
//
// Two known untidinesses, neither of which breaks anything:
//   - Some headings predate the v0.63 genre split (Arthurian, Biography,
//     Social Commentary, Gothic & Haunted Houses, Southern & American Gothic)
//     and no longer match a row in public.genres.
//   - src/lib/genreDescriptions.js carries 168 keys against the table's 137,
//     so a few headings here came from names that exist only in that file.
//     Worth reconciling separately; it is not this file's problem to fix.
import { useState, useEffect, useRef, useMemo, useLayoutEffect, useContext } from 'react';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { DataContext } from '../lib/DataContext';
import { hrefFor } from '../lib/RouterContext';
import { useT } from '../lib/I18nContext';
import { prefersReducedMotion } from './landing/motion';
import OracleWaitSpread from './OracleWaitSpread';
import burst from './landing/burst';

const QUOTES = [
  // ── Adventure ──
  { text: "Seaward ho! Hang the treasure! It's the glory of the sea that has turned my head.", author: 'Robert Louis Stevenson', book: 'Treasure Island', genre: 'Adventure' },
  { text: 'With enough determination, any bloody idiot can get up this hill. The trick is to get back down alive.', author: 'Jon Krakauer', book: 'Into Thin Air', genre: 'Adventure' },
  { text: 'It does not do to leave a live dragon out of your calculations, if you live near him.', author: 'J.R.R. Tolkien', book: 'The Hobbit', genre: 'Adventure' },
  // ── African Literary Fiction ──
  { text: 'I was not sorry when my brother died.', author: 'Tsitsi Dangarembga', book: 'Nervous Conditions', genre: 'African Literary Fiction' },
  { text: 'In the beginning there was a river. The river became a road and the road branched out to the whole world.', author: 'Ben Okri', book: 'The Famished Road', genre: 'African Literary Fiction' },
  { text: 'He has put a knife on the things that held us together and we have fallen apart.', author: 'Chinua Achebe', book: 'Things Fall Apart', genre: 'African Literary Fiction' },
  // ── Alien Invasion ──
  { text: 'Few people realise the immensity of vacancy in which the dust of the material universe swims.', author: 'H.G. Wells', book: 'The War of the Worlds', genre: 'Alien Invasion' },
  { text: 'In the face of madness, rationality was powerless.', author: 'Liu Cixin', book: 'The Three-Body Problem', genre: 'Alien Invasion' },
  { text: "Remember, the enemy's gate is down.", author: 'Orson Scott Card', book: "Ender's Game", genre: 'Alien Invasion' },
  // ── American Gothic ──
  { text: "124 was spiteful. Full of a baby's venom.", author: 'Toni Morrison', book: 'Beloved', genre: 'American Gothic' },
  { text: 'Hill House, not sane, stood by itself against the hills, holding darkness within.', author: 'Shirley Jackson', book: 'The Haunting of Hill House', genre: 'American Gothic' },
  { text: 'My mother is a fish.', author: 'William Faulkner', book: 'As I Lay Dying', genre: 'American Gothic' },
  // ── American Literature ──
  { text: 'Definitions belong to the definers, not the defined.', author: 'Toni Morrison', book: 'Beloved', genre: 'American Literature' },
  { text: "And now that you don't have to be perfect, you can be good.", author: 'John Steinbeck', book: 'East of Eden', genre: 'American Literature' },
  // ── Apocalyptic ──
  { text: 'Keep a little fire burning; however small, however hidden.', author: 'Cormac McCarthy', book: 'The Road', genre: 'Apocalyptic' },
  { text: 'Hell is the absence of the people you long for.', author: 'Emily St. John Mandel', book: 'Station Eleven', genre: 'Apocalyptic' },
  { text: "Freedom is dangerous but it's precious, too. You can't just throw it away or let it slip away.", author: 'Octavia E. Butler', book: 'Parable of the Sower', genre: 'Apocalyptic' },
  // ── Apocalyptic Fantasy ──
  { text: "Let's start with the end of the world, why don't we? Get it over with and move on to more interesting things.", author: 'N. K. Jemisin', book: 'The Fifth Season', genre: 'Apocalyptic Fantasy' },
  { text: 'The man in black fled across the desert, and the gunslinger followed.', author: 'Stephen King', book: 'The Gunslinger', genre: 'Apocalyptic Fantasy' },
  { text: 'Ravens! Always the ravens. They settled on the gables of the church even before the injured became the dead.', author: 'Mark Lawrence', book: 'Prince of Thorns', genre: 'Apocalyptic Fantasy' },
  // ── Art History ──
  { text: 'The relation between what we see and what we know is never settled.', author: 'John Berger', book: 'Ways of Seeing', genre: 'Art History' },
  { text: 'There really is no such thing as Art. There are only artists.', author: 'E.H. Gombrich', book: 'The Story of Art', genre: 'Art History' },
  { text: 'No one expected me. Everything awaited me.', author: 'Patti Smith', book: 'Just Kids', genre: 'Art History' },
  // ── Arthurian ──
  { text: 'The best thing for being sad is to learn something. That is the only thing that never fails.', author: 'T.H. White', book: 'The Once and Future King', genre: 'Arthurian' },
  { text: 'The bravest thing you can do when you are not brave is to profess courage and act accordingly.', author: 'T.H. White', book: 'The Sword in the Stone', genre: 'Arthurian' },
  { text: 'Here lies Arthur, king once, and king to be.', author: 'Thomas Malory', book: "Le Morte d'Arthur", genre: 'Arthurian' },
  { text: 'The old order changeth, yielding place to new, and God fulfils himself in many ways, lest one good custom should corrupt the world.', author: 'Alfred, Lord Tennyson', book: 'Idylls of the King', genre: 'Arthurian' },
  { text: 'In my time I have been called many things: sister, lover, priestess, wisewoman, queen. Now I am old, and the time has come when I too must go into the shadows.', author: 'Marion Zimmer Bradley', book: 'The Mists of Avalon', genre: 'Arthurian' },
  // ── Arthurian Retelling ──
  { text: 'I am an old man now, but then I was already past my prime when Arthur was crowned King.', author: 'Mary Stewart', book: 'The Crystal Cave', genre: 'Arthurian Retelling' },
  // ── Arthurian-Inspired ──
  { text: 'When the Dark comes rising, six shall turn it back.', author: 'Susan Cooper', book: 'The Dark Is Rising', genre: 'Arthurian-Inspired' },
  { text: 'The giant, once buried, now stirs.', author: 'Kazuo Ishiguro', book: 'The Buried Giant', genre: 'Arthurian-Inspired' },
  { text: 'Once upon a time, in a land that was called Britain, these things happened.', author: 'Bernard Cornwell', book: 'The Winter King', genre: 'Arthurian-Inspired' },
  // ── Asian-inspired Fantasy ──
  { text: 'But I warn you, little warrior. The price of power is pain.', author: 'R.F. Kuang', book: 'The Poppy War', genre: 'Asian-inspired Fantasy' },
  { text: 'Destroying what someone else cherished never brought back what you yourself had lost.', author: 'Shelley Parker-Chan', book: 'She Who Became the Sun', genre: 'Asian-inspired Fantasy' },
  { text: 'What is fate but coincidences in retrospect?', author: 'Ken Liu', book: 'The Grace of Kings', genre: 'Asian-inspired Fantasy' },
  // ── Australian Gothic ──
  { text: 'Everything begins and ends at exactly the right time and place.', author: 'Joan Lindsay', book: 'Picnic at Hanging Rock', genre: 'Australian Gothic' },
  { text: 'The map? I will first make it.', author: 'Patrick White', book: 'Voss', genre: 'Australian Gothic' },
  { text: 'If I am a wretch, who made me one? If I hate you and myself and the world, who made me hate it?', author: 'Marcus Clarke', book: 'For the Term of His Natural Life', genre: 'Australian Gothic' },
  // ── Aviation ──
  { text: 'The earth teaches us more about ourselves than all the books in the world, because it is resistant to us.', author: 'Antoine de Saint-Exupéry', book: 'Wind, Sand and Stars', genre: 'Aviation' },
  { text: 'You can live a lifetime and, at the end of it, know more about other people than you know about yourself.', author: 'Beryl Markham', book: 'West with the Night', genre: 'Aviation' },
  { text: "Most gulls don't bother to learn more than the simplest facts of flight — how to get from shore to food and back again.", author: 'Richard Bach', book: 'Jonathan Livingston Seagull', genre: 'Aviation' },
  // ── Biography ──
  { text: 'I learned that courage was not the absence of fear, but the triumph over it.', author: 'Nelson Mandela', book: 'Long Walk to Freedom', genre: 'Biography' },
  { text: 'In spite of everything, I still believe that people are really good at heart.', author: 'Anne Frank', book: 'The Diary of a Young Girl', genre: 'Biography' },
  { text: 'I have learned that success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome.', author: 'Booker T. Washington', book: 'Up From Slavery', genre: 'Biography' },
  { text: 'Your story is what you have, what you will always have. It is something to own.', author: 'Michelle Obama', book: 'Becoming', genre: 'Biography' },
  { text: 'There is no greater agony than bearing an untold story inside you.', author: 'Maya Angelou', book: 'I Know Why the Caged Bird Sings', genre: 'Biography' },
  // ── Body Horror & Transgressive ──
  { text: 'As Gregor Samsa awoke one morning from uneasy dreams he found himself transformed in his bed into a gigantic insect.', author: 'Franz Kafka', book: 'The Metamorphosis', genre: 'Body Horror & Transgressive' },
  { text: "It's only after we've lost everything that we're free to do anything.", author: 'Chuck Palahniuk', book: 'Fight Club', genre: 'Body Horror & Transgressive' },
  { text: "You are not your job. You're not how much money you have in the bank. You are not the car you drive.", author: 'Chuck Palahniuk', book: 'Fight Club', genre: 'Body Horror & Transgressive' },
  { text: 'I was benevolent and good; misery made me a fiend.', author: 'Mary Shelley', book: 'Frankenstein', genre: 'Body Horror & Transgressive' },
  // ── British & Rural Horror ──
  { text: 'Innocence, once lost, is lost forever.', author: 'Susan Hill', book: 'The Woman in Black', genre: 'British & Rural Horror' },
  { text: 'If it had another name, I never knew, but the locals called it the Loney.', author: 'Andrew Michael Hurley', book: 'The Loney', genre: 'British & Rural Horror' },
  { text: 'Some teeth long for ripping, gleaming wet from black dog gums. So you keep your eyes closed at the end.', author: 'Adam Nevill', book: 'The Ritual', genre: 'British & Rural Horror' },
  // ── Celtic Fantasy ──
  { text: "I have never known courage to be judged by the length of a man's hair.", author: 'Lloyd Alexander', book: 'The Book of Three', genre: 'Celtic Fantasy' },
  { text: 'Sometimes you must seem to hurt something in order to do good for it.', author: 'Susan Cooper', book: 'The Grey King', genre: 'Celtic Fantasy' },
  { text: 'The world is simple, I think, in its essence. Life, death, love, hate. Desire, fulfillment. Magic.', author: 'Juliet Marillier', book: 'Son of the Shadows', genre: 'Celtic Fantasy' },
  // ── Chicano & Latinx Fiction ──
  { text: 'I am in the earth and the earth is in me.', author: 'Luis Alberto Urrea', book: "The Hummingbird's Daughter", genre: 'Chicano & Latinx Fiction' },
  { text: 'Women endure the labor of childbirth and men send themselves to war!', author: 'Ana Castillo', book: 'So Far from God', genre: 'Chicano & Latinx Fiction' },
  { text: 'The half-life of love is forever.', author: 'Junot Díaz', book: 'This Is How You Lose Her', genre: 'Chicano & Latinx Fiction' },
  // ── Children's Fiction ──
  { text: 'It is only with the heart that one can see rightly; what is essential is invisible to the eye.', author: 'Antoine de Saint-Exupéry', book: 'The Little Prince', genre: 'Children\'s Fiction' },
  { text: 'You have been my friend. That in itself is a tremendous thing.', author: 'E. B. White', book: "Charlotte's Web", genre: 'Children\'s Fiction' },
  // ── Children's Picture Book ──
  { text: '"And now," cried Max, "let the wild rumpus start!"', author: 'Maurice Sendak', book: 'Where the Wild Things Are', genre: 'Children\'s Picture Book' },
  { text: "Oh please don't go—we'll eat you up—we love you so!", author: 'Maurice Sendak', book: 'Where the Wild Things Are', genre: 'Children\'s Picture Book' },
  { text: 'You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.', author: 'Dr. Seuss', book: 'Oh, the Places You\'ll Go!', genre: 'Children\'s Picture Book' },
  { text: 'If you live to be a hundred, I want to live to be a hundred minus one day, so I never have to live without you.', author: 'A.A. Milne', book: 'Winnie-the-Pooh', genre: 'Children\'s Picture Book' },
  { text: 'Goodnight room, goodnight moon, goodnight cow jumping over the moon.', author: 'Margaret Wise Brown', book: 'Goodnight Moon', genre: 'Children\'s Picture Book' },
  // ── Classic & Older Gothic ──
  { text: 'Whatever our souls are made of, his and mine are the same.', author: 'Emily Brontë', book: 'Wuthering Heights', genre: 'Classic & Older Gothic' },
  { text: 'I am no bird; and no net ensnares me.', author: 'Charlotte Brontë', book: 'Jane Eyre', genre: 'Classic & Older Gothic' },
  { text: 'Beware; for I am fearless, and therefore powerful.', author: 'Mary Shelley', book: 'Frankenstein', genre: 'Classic & Older Gothic' },
  { text: 'The dead travel fast.', author: 'Bram Stoker', book: 'Dracula', genre: 'Classic & Older Gothic' },
  { text: 'True! —nervous —very, very dreadfully nervous I had been and am; but why will you say that I am mad?', author: 'Edgar Allan Poe', book: 'The Tell-Tale Heart', genre: 'Classic & Older Gothic' },
  // ── Classic Literary Fiction ──
  { text: 'It is not down in any map; true places never are.', author: 'Herman Melville', book: 'Moby-Dick', genre: 'Classic Literary Fiction' },
  // ── Classic Science Fiction ──
  { text: 'War is peace. Freedom is slavery. Ignorance is strength.', author: 'George Orwell', book: 'Nineteen Eighty-Four', genre: 'Classic Science Fiction' },
  { text: 'Violence is the last refuge of the incompetent.', author: 'Isaac Asimov', book: 'Foundation', genre: 'Classic Science Fiction' },
  // ── Classics ──
  { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', author: 'Jane Austen', book: 'Pride and Prejudice', genre: 'Classics' },
  { text: 'It was the best of times, it was the worst of times.', author: 'Charles Dickens', book: 'A Tale of Two Cities', genre: 'Classics' },
  { text: 'Call me Ishmael.', author: 'Herman Melville', book: 'Moby-Dick', genre: 'Classics' },
  { text: 'All happy families are alike; each unhappy family is unhappy in its own way.', author: 'Leo Tolstoy', book: 'Anna Karenina', genre: 'Classics' },
  { text: 'Every limit is a beginning as well as an ending.', author: 'George Eliot', book: 'Middlemarch', genre: 'Classics' },
  // ── Climate Fiction ──
  { text: 'Politics is ugly. Never doubt what small men will do for great power.', author: 'Paolo Bacigalupi', book: 'The Windup Girl', genre: 'Climate Fiction' },
  // ── Comedy & Wit ──
  { text: 'The trouble with having an open mind, of course, is that people will insist on coming along and trying to put things in it.', author: 'Terry Pratchett', book: 'Diggers', genre: 'Comedy & Wit' },
  { text: 'I like work; it fascinates me. I can sit and look at it for hours.', author: 'Jerome K. Jerome', book: 'Three Men in a Boat', genre: 'Comedy & Wit' },
  { text: 'I can resist everything except temptation.', author: 'Oscar Wilde', book: 'The Importance of Being Earnest', genre: 'Comedy & Wit' },
  { text: "Don't Panic.", author: 'Douglas Adams', book: "The Hitchhiker's Guide to the Galaxy", genre: 'Comedy & Wit' },
  { text: 'It is a good rule in life never to apologize. The right sort of people do not want apologies, and the wrong sort take a mean advantage of them.', author: 'P.G. Wodehouse', book: 'The Man Upstairs and Other Stories', genre: 'Comedy & Wit' },
  // ── Coming of Age ──
  { text: 'We accept the love we think we deserve.', author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower', genre: 'Coming of Age' },
  { text: "So, I guess we are who we are for a lot of reasons. But even if we don't have the power to choose where we come from, we can still choose where we go from there.", author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower', genre: 'Coming of Age' },
  { text: "I'm the most terrific liar you ever saw in your life.", author: 'J.D. Salinger', book: 'The Catcher in the Rye', genre: 'Coming of Age' },
  { text: 'I have hated the words and I have loved them, and I hope I have made them right.', author: 'Markus Zusak', book: 'The Book Thief', genre: 'Coming of Age' },
  { text: 'People can really change one another.', author: 'Sally Rooney', book: 'Normal People', genre: 'Coming of Age' },
  // ── Contemporary Fantasy ──
  { text: 'The Beauty of the House is immeasurable; its Kindness infinite.', author: 'Susanna Clarke', book: 'Piranesi', genre: 'Contemporary Fantasy' },
  { text: 'Gods die. And when they truly die they are unmourned and unremembered.', author: 'Neil Gaiman', book: 'American Gods', genre: 'Contemporary Fantasy' },
  { text: 'Quentin did a magic trick. Nobody noticed.', author: 'Lev Grossman', book: 'The Magicians', genre: 'Contemporary Fantasy' },
  // ── Contemporary Fiction ──
  { text: 'Most people go through their whole lives without ever really feeling that close with anyone.', author: 'Sally Rooney', book: 'Normal People', genre: 'Contemporary Fiction' },
  { text: 'Life is the thing you bring with you inside your own head.', author: 'Sally Rooney', book: 'Normal People', genre: 'Contemporary Fiction' },
  { text: "It's wrong what they say about the past, I've learned, about how you can bury it. Because the past claws its way out.", author: 'Khaled Hosseini', book: 'The Kite Runner', genre: 'Contemporary Fiction' },
  { text: "There is no such thing as bad people. We're all just people who sometimes do bad things.", author: 'Colleen Hoover', book: 'It Ends with Us', genre: 'Contemporary Fiction' },
  // ── Cosmic Horror ──
  { text: 'What one thinks finds expression in words, and what one says, happens.', author: 'Algernon Blackwood', book: 'The Willows', genre: 'Cosmic Horror' },
  { text: 'Amnesia may well be the highest sacrament in the great gray ritual of existence.', author: 'Thomas Ligotti', book: 'Teatro Grottesco', genre: 'Cosmic Horror' },
  // ── Court Intrigue ──
  { text: 'Drear ritual turned its wheel.', author: 'Mervyn Peake', book: 'Titus Groan', genre: 'Court Intrigue' },
  { text: 'When power is gone the memory of power lingers.', author: 'Guy Gavriel Kay', book: 'Tigana', genre: 'Court Intrigue' },
  // ── Cozy Fantasy ──
  { text: "I was just thinking that you don't have to forget who you were… because that's what brought you here.", author: 'Travis Baldree', book: 'Legends & Lattes', genre: 'Cozy Fantasy' },
  { text: 'The combined aromas of hot cinnamon, ground coffee, and sweet cardamom intoxicated her.', author: 'Travis Baldree', book: 'Legends & Lattes', genre: 'Cozy Fantasy' },
  { text: "It is more fun to talk with someone who doesn't use long, difficult words but rather short, easy words like 'What about lunch?'", author: 'A.A. Milne', book: 'Winnie-the-Pooh', genre: 'Cozy Fantasy' },
  // ── Cozy Mystery ──
  { text: 'Mma Ramotswe had a detective agency in Africa, at the foot of Kgale Hill.', author: 'Alexander McCall Smith', book: "The No. 1 Ladies' Detective Agency", genre: 'Cozy Mystery' },
  { text: 'Anyone who murdered Colonel Protheroe would be doing the world at large a service.', author: 'Agatha Christie', book: 'The Murder at the Vicarage', genre: 'Cozy Mystery' },
  { text: "Always look where the action isn't, because that's where the action is.", author: 'Richard Osman', book: 'The Thursday Murder Club', genre: 'Cozy Mystery' },
  // ── Crime Fiction ──
  { text: 'Dead men are heavier than broken hearts.', author: 'Raymond Chandler', book: 'The Big Sleep', genre: 'Crime Fiction' },
  { text: 'The cheaper the crook, the gaudier the patter.', author: 'Dashiell Hammett', book: 'The Maltese Falcon', genre: 'Crime Fiction' },
  // ── Crime Noir ──
  { text: 'There is no trap so deadly as the trap you set for yourself.', author: 'Raymond Chandler', book: 'The Long Goodbye', genre: 'Crime Noir' },
  { text: "I had killed a man, for money and a woman. I didn't have the money and I didn't have the woman.", author: 'James M. Cain', book: 'Double Indemnity', genre: 'Crime Noir' },
  { text: 'Who shot him? I asked. The grey man scratched the back of his neck and said: Somebody with a gun.', author: 'Dashiell Hammett', book: 'Red Harvest', genre: 'Crime Noir' },
  // ── Cult Fiction ──
  { text: "But it's the truth even if it didn't happen.", author: 'Ken Kesey', book: "One Flew Over the Cuckoo's Nest", genre: 'Cult Fiction' },
  { text: 'It began as a mistake.', author: 'Charles Bukowski', book: 'Post Office', genre: 'Cult Fiction' },
  // ── Cultural Studies ──
  { text: 'To collect photographs is to collect the world.', author: 'Susan Sontag', book: 'On Photography', genre: 'Cultural Studies' },
  { text: 'Love is an action, never simply a feeling.', author: 'bell hooks', book: 'All About Love', genre: 'Cultural Studies' },
  { text: 'In order to see a photograph well, it is best to look away or close your eyes.', author: 'Roland Barthes', book: 'Camera Lucida', genre: 'Cultural Studies' },
  // ── Cyberpunk ──
  { text: 'The sky above the port was the color of television, tuned to a dead channel.', author: 'William Gibson', book: 'Neuromancer', genre: 'Cyberpunk' },
  { text: 'Cyberspace. A consensual hallucination experienced daily by billions of legitimate operators.', author: 'William Gibson', book: 'Neuromancer', genre: 'Cyberpunk' },
  { text: 'The street finds its own uses for things.', author: 'William Gibson', book: 'Burning Chrome', genre: 'Cyberpunk' },
  { text: 'You will be required to do wrong no matter where you go. It is the basic condition of life, to be required to violate your own identity.', author: 'Philip K. Dick', book: 'Do Androids Dream of Electric Sheep?', genre: 'Cyberpunk' },
  // ── Dark & Epic Fantasy ──
  { text: 'When you play a game of thrones you win or you die.', author: 'George R.R. Martin', book: 'A Game of Thrones', genre: 'Dark & Epic Fantasy' },
  { text: 'The man who passes the sentence should swing the sword.', author: 'George R.R. Martin', book: 'A Game of Thrones', genre: 'Dark & Epic Fantasy' },
  { text: 'The night is dark and full of terrors.', author: 'George R.R. Martin', book: 'A Clash of Kings', genre: 'Dark & Epic Fantasy' },
  { text: 'A reader lives a thousand lives before he dies. The man who never reads lives only one.', author: 'George R.R. Martin', book: 'A Dance with Dragons', genre: 'Dark & Epic Fantasy' },
  { text: "There's some good in this world, and it's worth fighting for.", author: 'J.R.R. Tolkien', book: 'The Two Towers', genre: 'Dark & Epic Fantasy' },
  // ── Dark Academia ──
  { text: 'It is better to know one book intimately than a hundred superficially.', author: 'Donna Tartt', book: 'The Secret History', genre: 'Dark Academia' },
  { text: 'We were always surrounded by books and words and poetry, all the fierce passion of the world bound in leather and vellum.', author: 'M.L. Rio', book: 'If We Were Villains', genre: 'Dark Academia' },
  { text: "I should like to bury something precious in every place where I've been happy.", author: 'Evelyn Waugh', book: 'Brideshead Revisited', genre: 'Dark Academia' },
  // ── Dark Fantasy ──
  { text: "Real magic can never be made by offering someone else's liver.", author: 'Peter S. Beagle', book: 'The Last Unicorn', genre: 'Dark Fantasy' },
  { text: 'For death is life. It is only living that is lifeless.', author: 'Mervyn Peake', book: 'Titus Groan', genre: 'Dark Fantasy' },
  { text: "He had noticed that events were cowards: they didn't occur singly, but instead they would run in packs.", author: 'Neil Gaiman', book: 'Neverwhere', genre: 'Dark Fantasy' },
  // ── Demons & Monsters ──
  { text: "Better to reign in Hell, than serve in Heav'n.", author: 'John Milton', book: 'Paradise Lost', genre: 'Demons & Monsters' },
  { text: "Manuscripts don't burn.", author: 'Mikhail Bulgakov', book: 'The Master and Margarita', genre: 'Demons & Monsters' },
  { text: "Poor Grendel's had an accident. So may you all.", author: 'John Gardner', book: 'Grendel', genre: 'Demons & Monsters' },
  // ── Dragons ──
  { text: 'The dragons do not dream. They are dreams.', author: 'Ursula K. Le Guin', book: 'The Farthest Shore', genre: 'Dragons' },
  { text: 'But we were dragons. We were supposed to be cruel, cunning, heartless and terrible.', author: 'Terry Pratchett', book: 'Guards! Guards!', genre: 'Dragons' },
  { text: 'May your swords stay sharp.', author: 'Christopher Paolini', book: 'Eragon', genre: 'Dragons' },
  // ── Drama ──
  { text: 'There are more things in heaven and earth, Horatio, than are dreamt of in your philosophy.', author: 'William Shakespeare', book: 'Hamlet', genre: 'Drama' },
  { text: "I didn't go to the moon, I went much further—for time is the longest distance between two places.", author: 'Tennessee Williams', book: 'The Glass Menagerie', genre: 'Drama' },
  { text: 'All Russia is our orchard.', author: 'Anton Chekhov', book: 'The Cherry Orchard', genre: 'Drama' },
  // ── Dying Earth ──
  { text: 'We believe that we invent symbols. The truth is that they invent us.', author: 'Gene Wolfe', book: 'The Shadow of the Torturer', genre: 'Dying Earth' },
  { text: 'There is no magic. There is only knowledge, more or less hidden.', author: 'Gene Wolfe', book: 'The Claw of the Conciliator', genre: 'Dying Earth' },
  { text: 'And I to have gained Honour; yet to have learned that Honour doth be but as the ash of Life, if that you not to have Love.', author: 'William Hope Hodgson', book: 'The Night Land', genre: 'Dying Earth' },
  // ── Dystopian ──
  { text: "Words can be like X-rays, if you use them properly—they'll go through anything.", author: 'Aldous Huxley', book: 'Brave New World', genre: 'Dystopian' },
  { text: 'Happy Hunger Games! And may the odds be ever in your favor.', author: 'Suzanne Collins', book: 'The Hunger Games', genre: 'Dystopian' },
  { text: "The worst part of holding the memories is not the pain. It's the loneliness of it.", author: 'Lois Lowry', book: 'The Giver', genre: 'Dystopian' },
  // ── East Asian Lit ──
  { text: 'The train came out of the long tunnel into the snow country.', author: 'Yasunari Kawabata', book: 'Snow Country', genre: 'East Asian Lit' },
  { text: 'The place I like best in this world is the kitchen.', author: 'Banana Yoshimoto', book: 'Kitchen', genre: 'East Asian Lit' },
  { text: 'Chance encounters are what keep us going.', author: 'Haruki Murakami', book: 'Kafka on the Shore', genre: 'East Asian Lit' },
  // ── East Asian Literary Fiction ──
  { text: 'I want you always to remember me. Will you remember that I existed, and that I stood next to you here like this?', author: 'Haruki Murakami', book: 'Norwegian Wood', genre: 'East Asian Literary Fiction' },
  { text: 'Memories warm you up from the inside. But they also tear you apart.', author: 'Haruki Murakami', book: 'Kafka on the Shore', genre: 'East Asian Literary Fiction' },
  { text: 'Time was a wave, almost cruel in its relentlessness as it whisked her life downstream.', author: 'Han Kang', book: 'The Vegetarian', genre: 'East Asian Literary Fiction' },
  { text: "Memories, even your most precious ones, fade surprisingly quickly. But I don't go along with that. The memories I value most, I don't ever see them fading.", author: 'Kazuo Ishiguro', book: 'Never Let Me Go', genre: 'East Asian Literary Fiction' },
  // ── Eco-Fiction ──
  { text: "There was the hills, an' there was me, an' we wasn't separate no more. We was one thing.", author: 'John Steinbeck', book: 'The Grapes of Wrath', genre: 'Eco-Fiction' },
  { text: 'Somewhere in the depths of solitude, beyond wilderness and freedom, lay the trap of madness.', author: 'Edward Abbey', book: 'The Monkey Wrench Gang', genre: 'Eco-Fiction' },
  // ── Epic & Dark Fantasy ──
  { text: "Once you've got a task to do, it's better to do it than live with the fear of it.", author: 'Joe Abercrombie', book: 'The Blade Itself', genre: 'Epic & Dark Fantasy' },
  { text: 'When you play the game of thrones, you win or you die.', author: 'George R. R. Martin', book: 'A Game of Thrones', genre: 'Epic & Dark Fantasy' },
  { text: 'Very little worth knowing is taught by fear.', author: 'Robin Hobb', book: "Assassin's Apprentice", genre: 'Epic & Dark Fantasy' },
  // ── Epic Fantasy ──
  { text: 'All that is gold does not glitter, not all those who wander are lost.', author: 'J. R. R. Tolkien', book: 'The Fellowship of the Ring', genre: 'Epic Fantasy' },
  { text: 'Life before death, strength before weakness, journey before destination.', author: 'Brandon Sanderson', book: 'The Way of Kings', genre: 'Epic Fantasy' },
  { text: 'To hear, one must be silent.', author: 'Ursula K. Le Guin', book: 'A Wizard of Earthsea', genre: 'Epic Fantasy' },
  // ── Epic Poetry ──
  { text: "Rage—Goddess, sing the rage of Peleus' son Achilles.", author: 'Homer', book: 'The Iliad', genre: 'Epic Poetry' },
  { text: 'Sing to me of the man, Muse, the man of twists and turns driven time and again off course.', author: 'Homer', book: 'The Odyssey', genre: 'Epic Poetry' },
  { text: 'So. The Spear-Danes in days gone by and the kings who ruled them had courage and greatness.', author: 'Anonymous (trans. Seamus Heaney)', book: 'Beowulf', genre: 'Epic Poetry' },
  { text: 'Better to reign in Hell, than serve in Heaven.', author: 'John Milton', book: 'Paradise Lost', genre: 'Epic Poetry' },
  { text: 'Midway upon the journey of our life I found myself within a forest dark, for the straightforward pathway had been lost.', author: 'Dante Alighieri', book: 'The Divine Comedy', genre: 'Epic Poetry' },
  // ── Epistolary Fiction ──
  { text: 'It is funny how mortals always picture us as putting things into their minds: in reality our best work is done by keeping things out.', author: 'C. S. Lewis', book: 'The Screwtape Letters', genre: 'Epistolary Fiction' },
  { text: 'When one woman strikes at the heart of another, she seldom misses, and the wound is invariably fatal.', author: 'Pierre Choderlos de Laclos', book: 'Les Liaisons Dangereuses', genre: 'Epistolary Fiction' },
  // ── Espionage ──
  { text: 'Intelligence work has one moral law — it is justified by results.', author: 'John le Carré', book: 'The Spy Who Came In from the Cold', genre: 'Espionage' },
  { text: 'The more identities a man has, the more they express the person they conceal.', author: 'John le Carré', book: 'Tinker Tailor Soldier Spy', genre: 'Espionage' },
  { text: 'God save us always from the innocent and the good.', author: 'Graham Greene', book: 'The Quiet American', genre: 'Espionage' },
  // ── Existential ──
  { text: 'I swear to you gentlemen, that to be overly conscious is a sickness, a real, thorough sickness.', author: 'Fyodor Dostoevsky', book: 'Notes from Underground', genre: 'Existential' },
  { text: 'And what can life be worth if the first rehearsal for life is life itself?', author: 'Milan Kundera', book: 'The Unbearable Lightness of Being', genre: 'Existential' },
  // ── Experimental & Avant-Garde ──
  { text: 'Mrs Dalloway said she would buy the flowers herself.', author: 'Virginia Woolf', book: 'Mrs Dalloway', genre: 'Experimental & Avant-Garde' },
  { text: 'For Heaven only knows why one loves it so, how one sees it so, making it up, building it round one, tumbling it, creating it every moment afresh.', author: 'Virginia Woolf', book: 'Mrs Dalloway', genre: 'Experimental & Avant-Garde' },
  { text: 'Yes I said yes I will Yes.', author: 'James Joyce', book: 'Ulysses', genre: 'Experimental & Avant-Garde' },
  { text: 'So it goes.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five', genre: 'Experimental & Avant-Garde' },
  { text: 'Rose is a rose is a rose is a rose.', author: 'Gertrude Stein', book: 'Sacred Emily', genre: 'Experimental & Avant-Garde' },
  // ── Fairy Tale Retelling ──
  { text: 'I am all for putting new wine in old bottles, especially if the pressure of the new wine makes the old bottles explode.', author: 'Angela Carter', book: 'The Bloody Chamber', genre: 'Fairy Tale Retelling' },
  { text: 'Mirror, mirror, on the wall, who is the fairest of them all?', author: 'Brothers Grimm', book: 'Snow White', genre: 'Fairy Tale Retelling' },
  { text: 'But a mermaid has no tears, and therefore she suffers so much more.', author: 'Hans Christian Andersen', book: 'The Little Mermaid', genre: 'Fairy Tale Retelling' },
  // ── Family Drama ──
  { text: "Lydia is dead. But they don't know this yet.", author: 'Celeste Ng', book: 'Everything I Never Told You', genre: 'Family Drama' },
  { text: 'I was born twice: first, as a baby girl, on a remarkably smokeless Detroit day in January of 1960.', author: 'Jeffrey Eugenides', book: 'Middlesex', genre: 'Family Drama' },
  { text: 'My mother believed you could be anything you wanted to be in America.', author: 'Amy Tan', book: 'The Joy Luck Club', genre: 'Family Drama' },
  // ── Fantasy ──
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring', genre: 'Fantasy' },
  { text: 'It is a dangerous business, going out your door.', author: 'J.R.R. Tolkien', book: 'The Hobbit', genre: 'Fantasy' },
  { text: 'The truth is a beautiful and terrible thing, and should therefore be treated with great caution.', author: 'J.K. Rowling', book: "Harry Potter and the Sorcerer's Stone", genre: 'Fantasy' },
  { text: "Only in silence the word, only in dark the light, only in dying life: bright the hawk's flight on the empty sky.", author: 'Ursula K. Le Guin', book: 'A Wizard of Earthsea', genre: 'Fantasy' },
  { text: '"Safe?" said Mr Beaver. "Who said anything about safe? \'Course he isn\'t safe. But he\'s good. He\'s the King, I tell you."', author: 'C.S. Lewis', book: 'The Lion, the Witch and the Wardrobe', genre: 'Fantasy' },
  // ── Fantasy Romance ──
  { text: "Be glad of your human heart, Feyre. Pity those who don't feel anything at all.", author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses', genre: 'Fantasy Romance' },
  { text: '"I love you," he whispered, and kissed my brow. "Thorns and all."', author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses', genre: 'Fantasy Romance' },
  { text: 'We need hope, or else we cannot endure.', author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses', genre: 'Fantasy Romance' },
  { text: 'I would rather share one lifetime with you than face all the ages of this world alone.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring', genre: 'Fantasy Romance' },
  // ── Feminist & Sapphic Gothic ──
  { text: 'At its core, the Gothic drama is fundamentally about voiceless things—the dead, the past, the marginalized—gaining voices that cannot be ignored.', author: 'Carmen Maria Machado', book: 'Carmilla: A Critical Edition', genre: 'Feminist & Sapphic Gothic' },
  { text: 'In the rapture of my enormous humiliation I live in her warm kisses, and live to die.', author: 'Sheridan Le Fanu', book: 'Carmilla', genre: 'Feminist & Sapphic Gothic' },
  { text: 'I was going to put death in all their food and watch them die.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle', genre: 'Feminist & Sapphic Gothic' },
  { text: 'For there is no friend like a sister in calm or stormy weather.', author: 'Christina Rossetti', book: 'Goblin Market', genre: 'Feminist & Sapphic Gothic' },
  // ── Feminist & Social Commentary ──
  { text: 'Better never means better for everyone. It always means worse, for some.', author: 'Margaret Atwood', book: "The Handmaid's Tale", genre: 'Feminist & Social Commentary' },
  { text: 'We teach girls to shrink themselves, to make themselves smaller.', author: 'Chimamanda Ngozi Adichie', book: 'We Should All Be Feminists', genre: 'Feminist & Social Commentary' },
  // ── Feminist Fiction ──
  { text: 'The bird that would soar above the level plain of tradition and prejudice must have strong wings.', author: 'Kate Chopin', book: 'The Awakening', genre: 'Feminist Fiction' },
  { text: 'If you expect nothing from somebody you are never disappointed.', author: 'Sylvia Plath', book: 'The Bell Jar', genre: 'Feminist Fiction' },
  { text: 'The more I wonder, the more I love.', author: 'Alice Walker', book: 'The Color Purple', genre: 'Feminist Fiction' },
  // ── Feminist Gothic ──
  { text: 'A pretty sight, a lady with a book.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle', genre: 'Feminist Gothic' },
  // ── First Contact ──
  { text: 'The planets you may one day possess. But the stars are not for man.', author: 'Arthur C. Clarke', book: "Childhood's End", genre: 'First Contact' },
  { text: 'Knowledge of the future was incompatible with free will.', author: 'Ted Chiang', book: 'Stories of Your Life and Others', genre: 'First Contact' },
  { text: 'Your lack of fear is based on your ignorance.', author: 'Liu Cixin', book: 'The Three-Body Problem', genre: 'First Contact' },
  // ── Folk Horror ──
  { text: "It isn't fair, it isn't right.", author: 'Shirley Jackson', book: 'The Lottery', genre: 'Folk Horror' },
  { text: 'Lottery in June, corn be heavy soon.', author: 'Shirley Jackson', book: 'The Lottery', genre: 'Folk Horror' },
  { text: 'Come. It is time to keep your appointment with the Wicker Man.', author: 'Anthony Shaffer & Robin Hardy', book: 'The Wicker Man', genre: 'Folk Horror' },
  // ── Folklore ──
  { text: 'Fear and flee the wolf; for, worst of all, the wolf may be more than he seems.', author: 'Angela Carter', book: 'The Bloody Chamber', genre: 'Folklore' },
  { text: "Mouths don't empty themselves unless ears are sympathetic and knowing.", author: 'Zora Neale Hurston', book: 'Mules and Men', genre: 'Folklore' },
  { text: 'Rapunzel, Rapunzel, let down your hair to me.', author: 'Jacob and Wilhelm Grimm', book: "Grimms' Fairy Tales", genre: 'Folklore' },
  // ── Gothic & Haunted Houses ──
  { text: 'We are all haunted houses.', author: 'H.D.', book: 'Tribute to the Angels', genre: 'Gothic & Haunted Houses' },
  { text: 'Whatever walked there, walked alone.', author: 'Shirley Jackson', book: 'The Haunting of Hill House', genre: 'Gothic & Haunted Houses' },
  { text: 'No live organism can continue for long to exist sanely under conditions of absolute reality.', author: 'Shirley Jackson', book: 'The Haunting of Hill House', genre: 'Gothic & Haunted Houses' },
  { text: 'Last night I dreamt I went to Manderley again.', author: 'Daphne du Maurier', book: 'Rebecca', genre: 'Gothic & Haunted Houses' },
  { text: 'Whatever comes, she thought, will find me unafraid.', author: 'Daphne du Maurier', book: 'Rebecca', genre: 'Gothic & Haunted Houses' },
  // ── Graphic Novel ──
  { text: 'The cold, suffocating dark goes on forever and we are alone. Existence is random. Has no pattern save what we imagine after staring at it for too long.', author: 'Alan Moore', book: 'Watchmen', genre: 'Graphic Novel' },
  { text: "We're all puppets, Laurie. I'm just a puppet who can see the strings.", author: 'Alan Moore', book: 'Watchmen', genre: 'Graphic Novel' },
  { text: 'Evil must be punished. Even in the face of Armageddon I shall not compromise.', author: 'Alan Moore', book: 'Watchmen', genre: 'Graphic Novel' },
  { text: 'I know this is insane, but I somehow wish I had been in Auschwitz with my parents so I could really know what they lived through.', author: 'Art Spiegelman', book: 'Maus', genre: 'Graphic Novel' },
  // ── Grief Memoir ──
  { text: 'Human knowledge is never contained in one person. It grows from the relationships we create between each other and the world.', author: 'Paul Kalanithi', book: 'When Breath Becomes Air', genre: 'Grief Memoir' },
  { text: 'Every love story is a potential grief story.', author: 'Julian Barnes', book: 'Levels of Life', genre: 'Grief Memoir' },
  { text: 'Age is irrelevant in grief; at issue is not how old he was but how loved.', author: 'Chimamanda Ngozi Adichie', book: 'Notes on Grief', genre: 'Grief Memoir' },
  // ── Grimdark ──
  { text: 'Hate will keep you alive where love fails.', author: 'Mark Lawrence', book: 'Prince of Thorns', genre: 'Grimdark' },
  { text: 'Only madmen and historians, he said, believe their lies.', author: 'R. Scott Bakker', book: 'The Darkness That Comes Before', genre: 'Grimdark' },
  { text: 'The things we love destroy us every time, lad. Remember that.', author: 'George R. R. Martin', book: 'A Game of Thrones', genre: 'Grimdark' },
  // ── Haunted Houses ──
  { text: "Just because there are no ghosts it doesn't mean you can't be haunted.", author: 'Silvia Moreno-Garcia', book: 'Mexican Gothic', genre: 'Haunted Houses' },
  // ── Heist ──
  { text: "There's no freedom quite like the freedom of being constantly underestimated.", author: 'Scott Lynch', book: 'The Lies of Locke Lamora', genre: 'Heist' },
  { text: 'A thief never makes a noise by accident.', author: 'Megan Whalen Turner', book: 'The Thief', genre: 'Heist' },
  { text: "She'd absolutely adored the library — an entire building where anyone could take things they didn't own and feel no remorse about it.", author: 'Ally Carter', book: 'Heist Society', genre: 'Heist' },
  // ── Historical ──
  { text: 'I am haunted by humans.', author: 'Markus Zusak', book: 'The Book Thief', genre: 'Historical' },
  // ── Historical Biography ──
  { text: 'In the cold, nearly colorless light of a New England winter, two men on horseback traveled the coast road below Boston, heading north.', author: 'David McCullough', book: 'John Adams', genre: 'Historical Biography' },
  { text: 'Among the most famous women to have lived, Cleopatra VII ruled Egypt for twenty-two years.', author: 'Stacy Schiff', book: 'Cleopatra: A Life', genre: 'Historical Biography' },
  { text: 'No immigrant in American history has ever made a larger contribution than Alexander Hamilton.', author: 'Ron Chernow', book: 'Alexander Hamilton', genre: 'Historical Biography' },
  // ── Historical Fantasy ──
  { text: 'All of us are lonely at some point or another, no matter how many people surround us.', author: 'Helene Wecker', book: 'The Golem and the Jinni', genre: 'Historical Fantasy' },
  { text: "There's only one way to run away from your own story, and that's to sneak into someone else's.", author: 'Alix E. Harrow', book: 'The Ten Thousand Doors of January', genre: 'Historical Fantasy' },
  // ── Historical Fiction ──
  { text: 'Having faith in God did not mean sitting back and doing nothing. It meant believing you would find success if you did your best honestly and energetically.', author: 'Ken Follett', book: 'The Pillars of the Earth', genre: 'Historical Fiction' },
  { text: 'She loved him because he had brought her back to life. She had been like a caterpillar in a cocoon, and he had drawn her out and shown her that she was a butterfly.', author: 'Ken Follett', book: 'The Pillars of the Earth', genre: 'Historical Fiction' },
  { text: 'Beneath every history, another history.', author: 'Hilary Mantel', book: 'Wolf Hall', genre: 'Historical Fiction' },
  { text: 'Some of these things are true and some of them lies. But they are all good stories.', author: 'Hilary Mantel', book: 'Wolf Hall', genre: 'Historical Fiction' },
  { text: 'Tomorrow I will think of some way to get him back. After all, tomorrow is another day.', author: 'Margaret Mitchell', book: 'Gone with the Wind', genre: 'Historical Fiction' },
  // ── Historical Romance ──
  { text: 'I do not know if the wound is mortal, but Claire—I do feel my heart\'s blood leave me, when I look at you.', author: 'Diana Gabaldon', book: 'Dragonfly in Amber', genre: 'Historical Romance' },
  { text: "Ye are Blood of my Blood, and Bone of my Bone. I give ye my Body, that we Two might be One. I give ye my Spirit, 'til our Life shall be Done.", author: 'Diana Gabaldon', book: 'Outlander', genre: 'Historical Romance' },
  { text: 'I love you with everything I am, everything I\'ve been, and everything I hope to be.', author: 'Julia Quinn', book: 'Romancing Mister Bridgerton', genre: 'Historical Romance' },
  { text: 'I am asking you to marry me because I love you, because I cannot imagine living my life without you.', author: 'Julia Quinn', book: 'An Offer From a Gentleman', genre: 'Historical Romance' },
  // ── Horror ──
  { text: 'We make up horrors to help us cope with the real ones.', author: 'Stephen King', book: 'Danse Macabre', genre: 'Horror' },
  { text: 'The oldest and strongest emotion of mankind is fear.', author: 'H.P. Lovecraft', book: 'Supernatural Horror in Literature', genre: 'Horror' },
  { text: 'Monsters are real, and ghosts are real too. They live inside us.', author: 'Shirley Jackson', book: 'The Haunting of Hill House', genre: 'Horror' },
  { text: 'Listen to them, the children of the night. What music they make.', author: 'Bram Stoker', book: 'Dracula', genre: 'Horror' },
  { text: 'That is not dead which can eternal lie, and with strange aeons even death may die.', author: 'H.P. Lovecraft', book: 'The Call of Cthulhu', genre: 'Horror' },
  // ── Identity & Belonging ──
  { text: 'I am an invisible man.', author: 'Ralph Ellison', book: 'Invisible Man', genre: 'Identity & Belonging' },
  { text: 'Perhaps home is not a place but simply an irrevocable condition.', author: 'James Baldwin', book: "Giovanni's Room", genre: 'Identity & Belonging' },
  // ── Illustrated ──
  { text: "So many things are possible just as long as you don't know they're impossible.", author: 'Norton Juster', book: 'The Phantom Tollbooth', genre: 'Illustrated' },
  { text: 'Machines never have any extra parts. They have the exact number and type of parts they need.', author: 'Brian Selznick', book: 'The Invention of Hugo Cabret', genre: 'Illustrated' },
  // ── Indigenous Fiction ──
  { text: "They aren't just entertainment. Don't be fooled. They are all we have, you see, all we have to fight off illness and death.", author: 'Leslie Marmon Silko', book: 'Ceremony', genre: 'Indigenous Fiction' },
  { text: 'We started dying before the snow, and like the snow, we continued to fall.', author: 'Louise Erdrich', book: 'Tracks', genre: 'Indigenous Fiction' },
  { text: 'Being Indian has never been about returning to the land. The land is everywhere or nowhere.', author: 'Tommy Orange', book: 'There There', genre: 'Indigenous Fiction' },
  // ── Indigenous Horror ──
  { text: "Our world isn't ending. It already ended.", author: 'Waubgeshig Rice', book: 'Moon of the Crusted Snow', genre: 'Indigenous Horror' },
  { text: 'And I understood that as long as there are dreamers left, there will never be want for a dream.', author: 'Cherie Dimaline', book: 'The Marrow Thieves', genre: 'Indigenous Horror' },
  // ── Inspirational ──
  { text: 'Be patient toward all that is unsolved in your heart and try to love the questions themselves.', author: 'Rainer Maria Rilke', book: 'Letters to a Young Poet', genre: 'Inspirational' },
  { text: 'Tell me, what is it you plan to do with your one wild and precious life?', author: 'Mary Oliver', book: 'New and Selected Poems', genre: 'Inspirational' },
  // ── International Fiction ──
  { text: 'Many years later, as he faced the firing squad, Colonel Aureliano Buendía was to remember that distant afternoon when his father took him to discover ice.', author: 'Gabriel García Márquez', book: 'One Hundred Years of Solitude', genre: 'International Fiction' },
  { text: 'There are a lot of children in Afghanistan, but little childhood.', author: 'Khaled Hosseini', book: 'The Kite Runner', genre: 'International Fiction' },
  { text: 'I have a story that will make you believe in God.', author: 'Yann Martel', book: 'Life of Pi', genre: 'International Fiction' },
  // ── Intimate Fiction ──
  { text: 'We had the stars, you and I. And this is given once only.', author: 'André Aciman', book: 'Call Me by Your Name', genre: 'Intimate Fiction' },
  { text: 'To feel nothing so as not to feel anything - what a waste!', author: 'André Aciman', book: 'Call Me by Your Name', genre: 'Intimate Fiction' },
  { text: "The heaviest of burdens crushes us, we sink beneath it, it pins us to the ground. But in the love poetry of every age, the woman longs to be weighed down by the man's body.", author: 'Milan Kundera', book: 'The Unbearable Lightness of Being', genre: 'Intimate Fiction' },
  // ── Irish Fiction ──
  { text: 'Is it about a bicycle?', author: "Flann O'Brien", book: 'The Third Policeman', genre: 'Irish Fiction' },
  { text: 'The sun shone, having no alternative, on the nothing new.', author: 'Samuel Beckett', book: 'Murphy', genre: 'Irish Fiction' },
  { text: 'They departed, the gods, on the day of the strange tide.', author: 'John Banville', book: 'The Sea', genre: 'Irish Fiction' },
  // ── Irish Folklore ──
  { text: "It is better doubtless to believe much unreason and a little truth than to deny for denial's sake truth and unreason alike.", author: 'W. B. Yeats', book: 'The Celtic Twilight', genre: 'Irish Folklore' },
  { text: "The young never grow old there; the fields and the flowers are as pleasant to be looking at as the blackbird's eggs.", author: 'Lady Augusta Gregory', book: 'Gods and Fighting Men', genre: 'Irish Folklore' },
  { text: 'Man, all the world over, when he is tired of the actualities of life, seeks to unbend his mind with the creations of fancy.', author: 'Douglas Hyde', book: 'Beside the Fire', genre: 'Irish Folklore' },
  // ── Italian Gothic ──
  { text: 'It is one of the most gloomy spots I ever beheld; the view of it is enough to strike a criminal with despair!', author: 'Ann Radcliffe', book: 'The Italian', genre: 'Italian Gothic' },
  { text: 'In this city, demons lurk under the ashes.', author: 'Giorgio De Maria', book: 'The Twenty Days of Turin', genre: 'Italian Gothic' },
  { text: 'Heaven mocks the short-sighted views of man.', author: 'Horace Walpole', book: 'The Castle of Otranto', genre: 'Italian Gothic' },
  // ── Japanese & East Asian Horror ──
  { text: "It wasn't that people refrained from saying anything out of fear of being laughed at for being unscientific. It was that they felt they'd be drawing unto themselves some unimaginable horror by admitting it.", author: 'Koji Suzuki', book: 'Ring', genre: 'Japanese & East Asian Horror' },
  { text: 'Spirals… this town is contaminated with spirals.', author: 'Junji Ito', book: 'Uzumaki', genre: 'Japanese & East Asian Horror' },
  // ── Japanese & East Asian Lit ──
  { text: 'Our entire civilization—with all its magnificence, and its insignificance—will someday belong to the past.', author: 'Eileen Chang', book: 'Love in a Fallen City', genre: 'Japanese & East Asian Lit' },
  { text: "Truth becomes fiction when the fiction's true; Real becomes not-real where the unreal's real.", author: 'Cao Xueqin', book: 'The Story of the Stone', genre: 'Japanese & East Asian Lit' },
  { text: "It's better to live an ordinary life. If you go on striving for this and that, you'll end up paying with your life.", author: 'Yu Hua', book: 'To Live', genre: 'Japanese & East Asian Lit' },
  // ── Japanese Lit ──
  { text: 'I am a cat. As yet I have no name.', author: 'Natsume Sōseki', book: 'I Am a Cat', genre: 'Japanese Lit' },
  // ── Korean, Japanese & East Asian Lit ──
  { text: 'Is it true that human beings are fundamentally cruel? Is the experience of cruelty the only thing we share as a species?', author: 'Han Kang', book: 'Human Acts', genre: 'Korean, Japanese & East Asian Lit' },
  { text: "It's been one week since Mom went missing.", author: 'Kyung-sook Shin', book: 'Please Look After Mom', genre: 'Korean, Japanese & East Asian Lit' },
  { text: 'Now that I have become you, I shall take your place and live a new life.', author: 'Bora Chung', book: 'Cursed Bunny', genre: 'Korean, Japanese & East Asian Lit' },
  // ── Latin American Horror & Literary ──
  { text: "Maybe I wasn't the princess in her castle; maybe I was a madwoman locked in her tower.", author: 'Mariana Enriquez', book: 'Things We Lost in the Fire', genre: 'Latin American Horror & Literary' },
  { text: 'My mother always said something bad would happen.', author: 'Samanta Schweblin', book: 'Fever Dream', genre: 'Latin American Horror & Literary' },
  // ── Latin American Literary ──
  { text: 'I came to Comala because I had been told that my father, a man named Pedro Páramo, lived there.', author: 'Juan Rulfo', book: 'Pedro Páramo', genre: 'Latin American Literary' },
  { text: 'Barrabás came to us by sea, the child Clara wrote in her delicate calligraphy.', author: 'Isabel Allende', book: 'The House of the Spirits', genre: 'Latin American Literary' },
  // ── Legal Thriller ──
  { text: 'There is no client as scary as an innocent man.', author: 'Michael Connelly', book: 'The Lincoln Lawyer', genre: 'Legal Thriller' },
  { text: 'There are few things in life worse than a long-winded lawyer.', author: 'John Grisham', book: 'The Rainmaker', genre: 'Legal Thriller' },
  { text: 'And until we can see each other as equals, justice is never going to be even-handed.', author: 'John Grisham', book: 'A Time to Kill', genre: 'Legal Thriller' },
  // ── LGBTQ+ Fiction ──
  { text: 'Is it better to speak or to die?', author: 'André Aciman', book: 'Call Me by Your Name', genre: 'LGBTQ+ Fiction' },
  { text: "I bet you could sometimes find all the mysteries of the universe in someone's hand.", author: 'Benjamin Alire Sáenz', book: 'Aristotle and Dante Discover the Secrets of the Universe', genre: 'LGBTQ+ Fiction' },
  { text: "And now we shan't be parted no more, and that's finished.", author: 'E. M. Forster', book: 'Maurice', genre: 'LGBTQ+ Fiction' },
  // ── LGBTQ+ Romance ──
  { text: 'I love him, with all that, because of all that. On purpose. I love him on purpose.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue', genre: 'LGBTQ+ Romance' },
  { text: 'But the truth is, also, simply this: love is indomitable.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue', genre: 'LGBTQ+ Romance' },
  { text: 'When you kissed me in disgusting public toilets and pouted in hotel bars and made me happy in ways in which it had never even occurred to me that a mangled-up, locked-up person like me could be happy, I loved you.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue', genre: 'LGBTQ+ Romance' },
  // ── Literary Criticism ──
  { text: 'The road to hell is paved with adverbs.', author: 'Stephen King', book: 'On Writing', genre: 'Literary Criticism' },
  { text: 'Almost all good writing begins with terrible first efforts.', author: 'Anne Lamott', book: 'Bird by Bird', genre: 'Literary Criticism' },
  { text: 'The king died and then the queen died is a story. The king died, and then the queen died of grief, is a plot.', author: 'E. M. Forster', book: 'Aspects of the Novel', genre: 'Literary Criticism' },
  // ── Literary Fiction ──
  { text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', author: 'F. Scott Fitzgerald', book: 'The Great Gatsby', genre: 'Literary Fiction' },
  { text: 'The personal, changing, memorable moment is precious. That is where books live.', author: 'Virginia Woolf', book: 'The Common Reader', genre: 'Literary Fiction' },
  { text: 'In this here place, we flesh; flesh that weeps, laughs; flesh that dances on bare feet in grass. Love it. Love it hard.', author: 'Toni Morrison', book: 'Beloved', genre: 'Literary Fiction' },
  { text: 'I looked up at the mass of signs and stars in the night sky and laid myself open for the first time to the benign indifference of the world.', author: 'Albert Camus', book: 'The Stranger', genre: 'Literary Fiction' },
  { text: 'Pain and suffering are always inevitable for a large intelligence and a deep heart.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment', genre: 'Literary Fiction' },
  // ── LitRPG ──
  { text: "You'd be amazed how much research you can get done when you have no life whatsoever.", author: 'Ernest Cline', book: 'Ready Player One', genre: 'LitRPG' },
  { text: "Everything's science fiction until someone makes it science fact.", author: 'Marie Lu', book: 'Warcross', genre: 'LitRPG' },
  // ── Magical Realism ──
  { text: 'It was inevitable: the scent of bitter almonds always reminded him of the fate of unrequited love.', author: 'Gabriel García Márquez', book: 'Love in the Time of Cholera', genre: 'Magical Realism' },
  { text: "There's no sun there, no moon, no direction, no sense of time. Just fine white sand swirling up into the sky like pulverized bones.", author: 'Haruki Murakami', book: 'Kafka on the Shore', genre: 'Magical Realism' },
  { text: 'The feeling that she had never really lived in this world caught her by surprise. It was a fact. She had never lived.', author: 'Han Kang', book: 'The Vegetarian', genre: 'Magical Realism' },
  // ── Malaysian Literary Fiction ──
  { text: 'On a mountain above the clouds once lived a man who had been the gardener of the emperor of Japan.', author: 'Tan Twan Eng', book: 'The Garden of Evening Mists', genre: 'Malaysian Literary Fiction' },
  { text: 'For that is what miracles are like sometimes: quiet, unheralded, unglamorous to all but the beneficiary.', author: 'Preeta Samarasan', book: 'Evening Is the Whole Day', genre: 'Malaysian Literary Fiction' },
  { text: "All my beliefs are ill-founded, all my convictions weak. Yet I feel strangely alive. Funny, isn't it?", author: 'Tash Aw', book: 'The Harmony Silk Factory', genre: 'Malaysian Literary Fiction' },
  // ── Martial Arts ──
  { text: 'All martial arts in the world are invincible except for speed.', author: 'Jin Yong', book: 'The Legend of the Condor Heroes', genre: 'Martial Arts' },
  { text: 'The supreme art of war is to subdue the enemy without fighting.', author: 'Sun Tzu', book: 'The Art of War', genre: 'Martial Arts' },
  { text: 'Do nothing that is of no use.', author: 'Miyamoto Musashi', book: 'The Book of Five Rings', genre: 'Martial Arts' },
  // ── Medical Narrative ──
  { text: "Even if I'm dying, until I actually die, I am still living.", author: 'Paul Kalanithi', book: 'When Breath Becomes Air', genre: 'Medical Narrative' },
  { text: 'We look for medicine to be an orderly field of knowledge and procedure. But it is not.', author: 'Atul Gawande', book: 'Complications', genre: 'Medical Narrative' },
  { text: 'If a man has lost a leg or an eye, he knows he has lost a leg or an eye; but if he has lost a self, he cannot know it.', author: 'Oliver Sacks', book: 'The Man Who Mistook His Wife for a Hat', genre: 'Medical Narrative' },
  // ── Medieval ──
  { text: 'All shall be well, and all shall be well, and all manner of thing shall be well.', author: 'Julian of Norwich', book: 'Revelations of Divine Love', genre: 'Medieval' },
  { text: 'All hope abandon, ye who enter in!', author: 'Dante Alighieri', book: 'The Divine Comedy: Inferno', genre: 'Medieval' },
  // ── Memoir ──
  { text: 'Life changes fast. Life changes in the instant. You sit down to dinner and life as you know it ends.', author: 'Joan Didion', book: 'The Year of Magical Thinking', genre: 'Memoir' },
  { text: 'The cradle rocks above an abyss, and common sense tells us that our existence is but a brief crack of light between two eternities of darkness.', author: 'Vladimir Nabokov', book: 'Speak, Memory', genre: 'Memoir' },
  { text: 'It was, of course, a miserable childhood: the happy childhood is hardly worth your while.', author: 'Frank McCourt', book: "Angela's Ashes", genre: 'Memoir' },
  // ── Metafiction ──
  { text: "You are about to begin reading Italo Calvino's new novel, If on a winter's night a traveler.", author: 'Italo Calvino', book: "If on a winter's night a traveler", genre: 'Metafiction' },
  { text: 'All this happened, more or less.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five', genre: 'Metafiction' },
  { text: 'This is my favorite book in all the world, though I have never read it.', author: 'William Goldman', book: 'The Princess Bride', genre: 'Metafiction' },
  // ── Military Fantasy ──
  { text: 'Ambition is not a dirty word. Piss on compromise. Go for the throat.', author: 'Steven Erikson', book: 'Gardens of the Moon', genre: 'Military Fantasy' },
  { text: 'Armour is part of a state of mind in which you admit the possibility of being hit.', author: 'Joe Abercrombie', book: 'The Heroes', genre: 'Military Fantasy' },
  { text: 'The age of kings is dead, Adamat, and I have killed it.', author: 'Brian McClellan', book: 'Promise of Blood', genre: 'Military Fantasy' },
  // ── Military Science Fiction ──
  { text: 'There are no dangerous weapons; there are only dangerous men.', author: 'Robert A. Heinlein', book: 'Starship Troopers', genre: 'Military Science Fiction' },
  { text: "Tonight we're going to show you eight silent ways to kill a man.", author: 'Joe Haldeman', book: 'The Forever War', genre: 'Military Science Fiction' },
  // ── Modernist ──
  { text: 'History is a nightmare from which I am trying to awake.', author: 'James Joyce', book: 'Ulysses', genre: 'Modernist' },
  { text: 'What is the meaning of life? That was all — a simple question; one that tended to close in on one with years.', author: 'Virginia Woolf', book: 'To the Lighthouse', genre: 'Modernist' },
  { text: 'Clocks slay time. Time is dead as long as it is being clicked off.', author: 'William Faulkner', book: 'The Sound and the Fury', genre: 'Modernist' },
  // ── Monster Horror ──
  { text: 'I ought to be thy Adam, but I am rather the fallen angel, whom thou drivest from joy for no misdeed.', author: 'Mary Shelley', book: 'Frankenstein', genre: 'Monster Horror' },
  { text: 'The walls speak to me. They tell me secrets.', author: 'Silvia Moreno-Garcia', book: 'Mexican Gothic', genre: 'Monster Horror' },
  // ── Music Fiction ──
  { text: "It's not what you like but what you are like that's important.", author: 'Nick Hornby', book: 'High Fidelity', genre: 'Music Fiction' },
  { text: 'He believed that life, true life, was something that was stored in music.', author: 'Ann Patchett', book: 'Bel Canto', genre: 'Music Fiction' },
  { text: 'I am not a muse. I am the somebody.', author: 'Taylor Jenkins Reid', book: 'Daisy Jones & The Six', genre: 'Music Fiction' },
  // ── Mystery ──
  { text: 'When you have eliminated the impossible, whatever remains, however improbable, must be the truth.', author: 'Arthur Conan Doyle', book: 'The Sign of Four', genre: 'Mystery' },
  { text: "Every murderer is probably somebody's old friend.", author: 'Agatha Christie', book: 'An Autobiography', genre: 'Mystery' },
  { text: "I'm a big fan of the lie of omission.", author: 'Gillian Flynn', book: 'Gone Girl', genre: 'Mystery' },
  { text: "There's a difference between really loving someone and loving the idea of her.", author: 'Gillian Flynn', book: 'Gone Girl', genre: 'Mystery' },
  // ── Mythological Fantasy ──
  { text: 'I could recognize him by touch alone, by smell; I would know him blind, by the way his breaths came and his feet struck the earth.', author: 'Madeline Miller', book: 'The Song of Achilles', genre: 'Mythological Fantasy' },
  { text: 'We were like gods at the dawning of the world, and our joy was so bright we could see nothing else but the other.', author: 'Madeline Miller', book: 'The Song of Achilles', genre: 'Mythological Fantasy' },
  { text: 'She was more than the sum of the words used to describe her.', author: 'Madeline Miller', book: 'Circe', genre: 'Mythological Fantasy' },
  { text: "It doesn't matter, in the end, how they got the money. It's how you spend it that decides who and what you are.", author: 'Neil Gaiman', book: 'American Gods', genre: 'Mythological Fantasy' },
  // ── Non-Fiction ──
  { text: 'Grief turns out to be a place none of us know until we reach it.', author: 'Joan Didion', book: 'The Year of Magical Thinking', genre: 'Non-Fiction' },
  { text: 'To photograph is to appropriate the thing photographed.', author: 'Susan Sontag', book: 'On Photography', genre: 'Non-Fiction' },
  { text: 'In nature nothing exists alone.', author: 'Rachel Carson', book: 'Silent Spring', genre: 'Non-Fiction' },
  { text: 'The Cognitive Revolution is accordingly the point when history declared its independence from biology.', author: 'Yuval Noah Harari', book: 'Sapiens', genre: 'Non-Fiction' },
  { text: 'A woman must have money and a room of her own if she is to write fiction.', author: 'Virginia Woolf', book: 'A Room of One\'s Own', genre: 'Non-Fiction' },
  // ── Paranormal ──
  { text: 'The world changes, we do not, therein lies the irony that kills us.', author: 'Anne Rice', book: 'Interview with the Vampire', genre: 'Paranormal' },
  { text: 'First of all, it was October, a rare month for boys.', author: 'Ray Bradbury', book: 'Something Wicked This Way Comes', genre: 'Paranormal' },
  // ── Parenting & Motherhood ──
  { text: "I'll tend to her as no mother ever tended a child, a daughter. Nobody will ever get my milk no more except my own children.", author: 'Toni Morrison', book: 'Beloved', genre: 'Parenting & Motherhood' },
  { text: '"Your love is too thick," he said.', author: 'Toni Morrison', book: 'Beloved', genre: 'Parenting & Motherhood' },
  { text: "I would give up the unessential; I would give my money, I would give my life for my children; but I wouldn't give myself.", author: 'Kate Chopin', book: 'The Awakening', genre: 'Parenting & Motherhood' },
  // ── Philosophical Fiction ──
  { text: 'One must imagine Sisyphus happy.', author: 'Albert Camus', book: 'The Myth of Sisyphus', genre: 'Philosophical Fiction' },
  { text: 'Taking a new step, uttering a new word, is what people fear most.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment', genre: 'Philosophical Fiction' },
  { text: 'Wisdom is not communicable.', author: 'Hermann Hesse', book: 'Siddhartha', genre: 'Philosophical Fiction' },
  { text: 'Hell is other people.', author: 'Jean-Paul Sartre', book: 'No Exit', genre: 'Philosophical Fiction' },
  // ── Philosophy ──
  { text: 'Such as are thy habitual thoughts, such also will be the character of thy mind; for the soul is dyed by the thoughts.', author: 'Marcus Aurelius', book: 'Meditations', genre: 'Philosophy' },
  { text: 'When you gaze long into an abyss the abyss also gazes into you.', author: 'Friedrich Nietzsche', book: 'Beyond Good and Evil', genre: 'Philosophy' },
  // ── Political Fiction ──
  { text: 'All animals are equal, but some animals are more equal than others.', author: 'George Orwell', book: 'Animal Farm', genre: 'Political Fiction' },
  { text: 'Man is conceived in sin and born in corruption and he passeth from the stink of the didie to the stench of the shroud.', author: 'Robert Penn Warren', book: "All the King's Men", genre: 'Political Fiction' },
  // ── Portal Fantasy ──
  { text: 'The term is over: the holidays have begun. The dream is ended: this is the morning.', author: 'C. S. Lewis', book: 'The Last Battle', genre: 'Portal Fantasy' },
  { text: 'She was a story, not an epilogue.', author: 'Seanan McGuire', book: 'Every Heart a Doorway', genre: 'Portal Fantasy' },
  { text: 'The sky had never seemed so sky; the world had never seemed so world.', author: 'Neil Gaiman', book: 'Coraline', genre: 'Portal Fantasy' },
  // ── Post-Apocalyptic ──
  { text: 'Men go and come, but earth abides.', author: 'George R. Stewart', book: 'Earth Abides', genre: 'Post-Apocalyptic' },
  { text: 'A new terror born in death, a new superstition entering the unassailable fortress of forever. I am legend.', author: 'Richard Matheson', book: 'I Am Legend', genre: 'Post-Apocalyptic' },
  { text: 'Ignorance is king. Many would not profit by his abdication.', author: 'Walter M. Miller Jr.', book: 'A Canticle for Leibowitz', genre: 'Post-Apocalyptic' },
  // ── Postmodern ──
  { text: 'All plots tend to move deathward. This is the nature of plots.', author: 'Don DeLillo', book: 'White Noise', genre: 'Postmodern' },
  { text: 'A screaming comes across the sky.', author: 'Thomas Pynchon', book: "Gravity's Rainbow", genre: 'Postmodern' },
  // ── Psychological Fiction ──
  { text: 'The man who has a conscience suffers whilst acknowledging his sin. That is his punishment.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment', genre: 'Psychological Fiction' },
  { text: "To go wrong in one's own way is better than to go right in someone else's.", author: 'Fyodor Dostoevsky', book: 'Crime and Punishment', genre: 'Psychological Fiction' },
  { text: 'We took away your art because we thought it would reveal your souls. Or to put it more finely, we did it to prove you had souls at all.', author: 'Kazuo Ishiguro', book: 'Never Let Me Go', genre: 'Psychological Fiction' },
  { text: 'I felt very still and empty, the way the eye of a tornado must feel, moving dully along in the middle of the surrounding hullabaloo.', author: 'Sylvia Plath', book: 'The Bell Jar', genre: 'Psychological Fiction' },
  // ── Quest Fantasy ──
  { text: 'There are three things all wise men fear: the sea in storm, a night with no moon, and the anger of a gentle man.', author: 'Patrick Rothfuss', book: 'The Name of the Wind', genre: 'Quest Fantasy' },
  { text: 'The Wheel of Time turns, and Ages come and pass, leaving memories that become legend.', author: 'Robert Jordan', book: 'The Eye of the World', genre: 'Quest Fantasy' },
  { text: 'We are not always what we seem, and hardly ever what we dream.', author: 'Peter S. Beagle', book: 'The Last Unicorn', genre: 'Quest Fantasy' },
  // ── Romance ──
  { text: 'You have bewitched me, body and soul.', author: 'Jane Austen', book: 'Pride and Prejudice', genre: 'Romance' },
  { text: 'I am half agony, half hope.', author: 'Jane Austen', book: 'Persuasion', genre: 'Romance' },
  { text: "So it's not gonna be easy. It's gonna be really hard. We're gonna have to work at this every day, but I want to do that because I want you.", author: 'Nicholas Sparks', book: 'The Notebook', genre: 'Romance' },
  { text: "Just because someone hurts you doesn't mean you can simply stop loving them.", author: 'Colleen Hoover', book: 'It Ends with Us', genre: 'Romance' },
  // ── Romantasy ──
  { text: 'A dragon without its rider is a tragedy. A rider without their dragon is dead.', author: 'Rebecca Yarros', book: 'Fourth Wing', genre: 'Romantasy' },
  { text: 'To the stars who listen—and the dreams that are answered.', author: 'Sarah J. Maas', book: 'A Court of Mist and Fury', genre: 'Romantasy' },
  { text: 'Fear and bravery are often one and the same.', author: 'Jennifer L. Armentrout', book: 'From Blood and Ash', genre: 'Romantasy' },
  // ── Romantic Fantasy ──
  { text: 'In the land of Ingary, where such things as seven-league boots really exist, it is quite the misfortune to be born the eldest of three.', author: 'Diana Wynne Jones', book: "Howl's Moving Castle", genre: 'Romantic Fantasy' },
  { text: 'You intolerable lunatic, he snarled at me, and then he caught my face between his hands and kissed me.', author: 'Naomi Novik', book: 'Uprooted', genre: 'Romantic Fantasy' },
  { text: 'You will find the way, daughter of the forest. Through grief and pain, through many trials, your feet will walk a straight path.', author: 'Juliet Marillier', book: 'Daughter of the Forest', genre: 'Romantic Fantasy' },
  // ── Sapphic & Feminist Gothic ──
  { text: 'In the rapture of my enormous humiliation I live in your warm life, and you shall die—die, sweetly die—into mine.', author: 'J. Sheridan Le Fanu', book: 'Carmilla', genre: 'Sapphic & Feminist Gothic' },
  { text: 'I am going to put death in all their food and watch them die.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle', genre: 'Sapphic & Feminist Gothic' },
  // ── Sapphic Fantasy ──
  { text: 'No woman should be made to fear that she was not enough.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree', genre: 'Sapphic Fantasy' },
  { text: 'I would live alone for fifty years to have one day with you.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree', genre: 'Sapphic Fantasy' },
  { text: 'We may be small, and we may be young, but we will shake the world for our beliefs.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree', genre: 'Sapphic Fantasy' },
  // ── Satire ──
  { text: 'Some men are born mediocre, some men achieve mediocrity, and some men have mediocrity thrust upon them.', author: 'Joseph Heller', book: 'Catch-22', genre: 'Satire' },
  { text: 'Everything was beautiful and nothing hurt.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five', genre: 'Satire' },
  { text: 'Let us work without reasoning; it is the only way to make life endurable.', author: 'Voltaire', book: 'Candide', genre: 'Satire' },
  // ── Scandinavian Horror ──
  { text: 'Real love is to offer your life at the feet of another.', author: 'John Ajvide Lindqvist', book: 'Let the Right One In', genre: 'Scandinavian Horror' },
  { text: 'A graveyard could be so densely populated and yet it was the loneliest place on earth.', author: 'John Ajvide Lindqvist', book: 'Handling the Undead', genre: 'Scandinavian Horror' },
  // ── Sci-Fi & Speculative ──
  { text: 'Fear is the mind-killer.', author: 'Frank Herbert', book: 'Dune', genre: 'Sci-Fi & Speculative' },
  { text: 'It was a pleasure to burn.', author: 'Ray Bradbury', book: 'Fahrenheit 451', genre: 'Sci-Fi & Speculative' },
  { text: 'The only thing that makes life possible is permanent, intolerable uncertainty; not knowing what comes next.', author: 'Ursula K. Le Guin', book: 'The Left Hand of Darkness', genre: 'Sci-Fi & Speculative' },
  { text: 'All that you touch you change. All that you change changes you.', author: 'Octavia E. Butler', book: 'Parable of the Sower', genre: 'Sci-Fi & Speculative' },
  // ── Science Fiction ──
  { text: "Space is big. You just won't believe how vastly, hugely, mind-bogglingly big it is.", author: 'Douglas Adams', book: "The Hitchhiker's Guide to the Galaxy", genre: 'Science Fiction' },
  // ── Scientific Anthropology ──
  { text: 'We did not domesticate wheat. It domesticated us.', author: 'Yuval Noah Harari', book: 'Sapiens', genre: 'Scientific Anthropology' },
  { text: 'We are survival machines — robot vehicles blindly programmed to preserve the selfish molecules known as genes.', author: 'Richard Dawkins', book: 'The Selfish Gene', genre: 'Scientific Anthropology' },
  { text: "History followed different courses for different peoples because of differences among peoples' environments.", author: 'Jared Diamond', book: 'Guns, Germs, and Steel', genre: 'Scientific Anthropology' },
  // ── Scottish ──
  { text: 'Give me a girl at an impressionable age, and she is mine for life.', author: 'Muriel Spark', book: 'The Prime of Miss Jean Brodie', genre: 'Scottish' },
  { text: 'Man is not truly one, but truly two.', author: 'Robert Louis Stevenson', book: 'Strange Case of Dr Jekyll and Mr Hyde', genre: 'Scottish' },
  { text: 'Sometimes ah think that people become junkies just because they subconsciously crave a wee bit ay silence.', author: 'Irvine Welsh', book: 'Trainspotting', genre: 'Scottish' },
  // ── Short Fiction ──
  { text: "I could hear my heart beating. I could hear everyone's heart. I could hear the human noise we sat there making.", author: 'Raymond Carver', book: 'What We Talk About When We Talk About Love', genre: 'Short Fiction' },
  { text: 'The universe (which others call the Library) is composed of an indefinite, perhaps infinite number of hexagonal galleries.', author: 'Jorge Luis Borges', book: 'Ficciones', genre: 'Short Fiction' },
  { text: 'And after all the weather was ideal.', author: 'Katherine Mansfield', book: 'The Garden Party and Other Stories', genre: 'Short Fiction' },
  // ── Slasher ──
  { text: "They float, Georgie. They float. And when you're down here with me, you'll float too.", author: 'Stephen King', book: 'It', genre: 'Slasher' },
  { text: 'I am every nightmare you ever had, I am your worst dream come true.', author: 'Stephen King', book: 'It', genre: 'Slasher' },
  { text: "A boy's best friend is his mother.", author: 'Robert Bloch', book: 'Psycho', genre: 'Slasher' },
  // ── Slavic Folk Horror ──
  { text: 'Wild birds die in cages.', author: 'Katherine Arden', book: 'The Bear and the Nightingale', genre: 'Slavic Folk Horror' },
  { text: "Our Dragon doesn't eat the girls he takes, no matter what stories they tell outside our valley.", author: 'Naomi Novik', book: 'Uprooted', genre: 'Slavic Folk Horror' },
  { text: 'What is the world but a boxing ring where fools and devils put up their fists?', author: 'Catherynne M. Valente', book: 'Deathless', genre: 'Slavic Folk Horror' },
  // ── Smutty Corner ──
  { text: '"Let me love you," he says hoarsely.', author: 'E.L. James', book: 'Fifty Shades of Grey', genre: 'Smutty Corner' },
  { text: 'Anastasia Steele, I love you. I want to love, cherish and protect you for the rest of my life.', author: 'E.L. James', book: 'Fifty Shades of Grey', genre: 'Smutty Corner' },
  { text: 'He had not touched me. He did not need to. His presence had affected me in such a way that I felt as if he had caressed me for a long time.', author: 'Anaïs Nin', book: 'Delta of Venus', genre: 'Smutty Corner' },
  { text: 'The language of sex had yet to be invented. The language of the senses was yet to be explored.', author: 'Anaïs Nin', book: 'Delta of Venus', genre: 'Smutty Corner' },
  // ── Social Commentary ──
  { text: 'Who controls the past controls the future. Who controls the present controls the past.', author: 'George Orwell', book: 'Nineteen Eighty-Four', genre: 'Social Commentary' },
  { text: 'Freedom is the freedom to say that two plus two make four. If that is granted, all else follows.', author: 'George Orwell', book: 'Nineteen Eighty-Four', genre: 'Social Commentary' },
  { text: "I think there's just one kind of folks. Folks.", author: 'Harper Lee', book: 'To Kill a Mockingbird', genre: 'Social Commentary' },
  // ── Social Commentary & History ──
  { text: 'The memory of oppressed people is one thing that cannot be taken away.', author: 'Howard Zinn', book: "A People's History of the United States", genre: 'Social Commentary & History' },
  { text: 'They did what human beings looking for freedom, throughout history, have often done. They left.', author: 'Isabel Wilkerson', book: 'The Warmth of Other Suns', genre: 'Social Commentary & History' },
  { text: 'A human being is primarily a bag for putting food into.', author: 'George Orwell', book: 'The Road to Wigan Pier', genre: 'Social Commentary & History' },
  // ── Southern & American Gothic ──
  { text: "The past is never dead. It's not even past.", author: 'William Faulkner', book: 'Requiem for a Nun', genre: 'Southern & American Gothic' },
  { text: 'Where you come from is gone, where you thought you were going to never was there, and where you are is no good unless you can get away from it.', author: 'Flannery O\'Connor', book: 'Wise Blood', genre: 'Southern & American Gothic' },
  { text: 'Some things you forget. Other things you never do.', author: 'Toni Morrison', book: 'Beloved', genre: 'Southern & American Gothic' },
  { text: 'You never really understand a person until you consider things from his point of view, until you climb into his skin and walk around in it.', author: 'Harper Lee', book: 'To Kill a Mockingbird', genre: 'Southern & American Gothic' },
  { text: 'Anything that comes out of the South is going to be called grotesque by the Northern reader, unless it is grotesque, in which case it is going to be called realistic.', author: "Flannery O'Connor", book: 'Mystery and Manners', genre: 'Southern & American Gothic' },
  // ── Southern Fiction ──
  { text: 'Until I feared I would lose it, I never loved to read. One does not love breathing.', author: 'Harper Lee', book: 'To Kill a Mockingbird', genre: 'Southern Fiction' },
  { text: 'I mingle with my peers or no one, and since I have no peers, I mingle with no one.', author: 'John Kennedy Toole', book: 'A Confederacy of Dunces', genre: 'Southern Fiction' },
  { text: 'Only when the mind is free has the body a chance to be free.', author: 'Ernest J. Gaines', book: 'A Lesson Before Dying', genre: 'Southern Fiction' },
  // ── Southern Gothic ──
  { text: 'She would have been a good woman if it had been somebody there to shoot her every minute of her life.', author: "Flannery O'Connor", book: 'A Good Man Is Hard to Find', genre: 'Southern Gothic' },
  { text: 'In the town there were two mutes, and they were always together.', author: 'Carson McCullers', book: 'The Heart Is a Lonely Hunter', genre: 'Southern Gothic' },
  { text: 'the deep South dead since 1865 and peopled with garrulous outraged baffled ghosts', author: 'William Faulkner', book: 'Absalom, Absalom!', genre: 'Southern Gothic' },
  // ── Space Opera ──
  { text: "Words are the only bullets in truth's bandolier. And poets are the snipers.", author: 'Dan Simmons', book: 'Hyperion', genre: 'Space Opera' },
  { text: "Luxury always comes at someone else's expense.", author: 'Ann Leckie', book: 'Ancillary Justice', genre: 'Space Opera' },
  { text: 'This book is dedicated to anyone who has ever fallen in love with a culture that was devouring their own.', author: 'Arkady Martine', book: 'A Memory Called Empire', genre: 'Space Opera' },
  // ── Spanish Literary ──
  { text: 'Every book, every volume you see here, has a soul.', author: 'Carlos Ruiz Zafón', book: 'The Shadow of the Wind', genre: 'Spanish Literary' },
  { text: 'The truth may be stretched thin, but it never breaks, and it always surfaces above lies, as oil floats on water.', author: 'Miguel de Cervantes', book: 'Don Quixote', genre: 'Spanish Literary' },
  { text: 'I am not, sir, a bad person, though in all truth I am not lacking in reasons for being one.', author: 'Camilo José Cela', book: 'The Family of Pascual Duarte', genre: 'Spanish Literary' },
  // ── Spanish Literature ──
  { text: 'The Library is a sphere whose exact centre is any one of its hexagons and whose circumference is inaccessible.', author: 'Jorge Luis Borges', book: 'Ficciones', genre: 'Spanish Literature' },
  { text: 'Memory is fragile and the space of a single life is brief.', author: 'Isabel Allende', book: 'The House of the Spirits', genre: 'Spanish Literature' },
  // ── Speculative Fiction ──
  { text: 'A rat in a maze is free to go anywhere, as long as it stays inside the maze.', author: 'Margaret Atwood', book: "The Handmaid's Tale", genre: 'Speculative Fiction' },
  { text: 'What is any ocean but a multitude of drops?', author: 'David Mitchell', book: 'Cloud Atlas', genre: 'Speculative Fiction' },
  // ── Sports Fiction ──
  { text: 'A ballpark at night is more like a church than a church.', author: 'W. P. Kinsella', book: 'Shoeless Joe', genre: 'Sports Fiction' },
  { text: "We don't have a single goddamn thing left to prove to anyone. We're proven. Today we play.", author: 'Chad Harbach', book: 'The Art of Fielding', genre: 'Sports Fiction' },
  { text: 'We have two lives; the life we learn with and the life we live after that.', author: 'Bernard Malamud', book: 'The Natural', genre: 'Sports Fiction' },
  // ── Steampunk ──
  { text: 'It was a dark, blustery afternoon in spring, and the city of London was chasing a small mining town across the dried-out bed of the old North Sea.', author: 'Philip Reeve', book: 'Mortal Engines', genre: 'Steampunk' },
  { text: 'When you raise the dead, they bring their baggage.', author: 'William Gibson and Bruce Sterling', book: 'The Difference Engine', genre: 'Steampunk' },
  { text: 'Maybe this was how you stayed sane in wartime: a handful of noble deeds amid the chaos.', author: 'Scott Westerfeld', book: 'Leviathan', genre: 'Steampunk' },
  // ── Superhero Epic ──
  { text: "...and all the whores and politicians will look up and shout: 'Save us!' And I'll look down and whisper: 'No.'", author: 'Alan Moore', book: 'Watchmen', genre: 'Superhero Epic' },
  { text: "I never said, 'The superman exists, and he's American.' What I said was, 'God exists, and he's American.'", author: 'Alan Moore', book: 'Watchmen', genre: 'Superhero Epic' },
  // ── Supernatural ──
  { text: 'Evil is a point of view.', author: 'Anne Rice', book: 'Interview with the Vampire', genre: 'Supernatural' },
  { text: "Death doesn't exist. It never did, it never will.", author: 'Ray Bradbury', book: 'Something Wicked This Way Comes', genre: 'Supernatural' },
  // ── Supernatural Horror ──
  { text: 'Sometimes human places create inhuman monsters.', author: 'Stephen King', book: 'The Shining', genre: 'Supernatural Horror' },
  // ── Surrealism ──
  { text: 'Beauty will be convulsive or will not be at all.', author: 'André Breton', book: 'Nadja', genre: 'Surrealism' },
  { text: 'Reality is as thin as paper and betrays with all its cracks its imitative character.', author: 'Bruno Schulz', book: 'The Street of Crocodiles', genre: 'Surrealism' },
  { text: 'Houses are really bodies. We connect ourselves with walls, roofs, and drains just as we hang on to our livers, skeletons, flesh and blood stream.', author: 'Leonora Carrington', book: 'The Hearing Trumpet', genre: 'Surrealism' },
  // ── Suspense ──
  { text: "This is the story of what a Woman's patience can endure, and what a Man's resolution can achieve.", author: 'Wilkie Collins', book: 'The Woman in White', genre: 'Suspense' },
  { text: 'Writers remember everything, especially the hurts.', author: 'Stephen King', book: 'Misery', genre: 'Suspense' },
  // ── Techno-Horror ──
  { text: 'What harm could come from just watching a videotape?', author: 'Koji Suzuki', book: 'Ring', genre: 'Techno-Horror' },
  { text: 'Her new boss was an undead automaton from hell, true. But, no job is perfect.', author: 'Daniel Suarez', book: 'Daemon', genre: 'Techno-Horror' },
  // ── Theology ──
  { text: 'If I find in myself desires which nothing in this world can satisfy, the only logical explanation is that I was made for another world.', author: 'C. S. Lewis', book: 'Mere Christianity', genre: 'Theology' },
  { text: 'The mind commands the body and is instantly obeyed. The mind commands itself and meets resistance.', author: 'Augustine of Hippo', book: 'Confessions', genre: 'Theology' },
  { text: 'When Christ calls a man, he bids him come and die.', author: 'Dietrich Bonhoeffer', book: 'The Cost of Discipleship', genre: 'Theology' },
  // ── Thriller ──
  { text: "There's something disturbing about recalling a warm memory and feeling utterly cold.", author: 'Gillian Flynn', book: 'Gone Girl', genre: 'Thriller' },
  { text: 'Problem-solving is hunting; it is savage pleasure and we are born to it.', author: 'Thomas Harris', book: 'The Silence of the Lambs', genre: 'Thriller' },
  { text: 'Friendship — my definition — is built on two things. Respect and trust.', author: 'Stieg Larsson', book: 'The Girl with the Dragon Tattoo', genre: 'Thriller' },
  // ── Time Travel ──
  { text: 'I lost an arm on my last trip home. My left arm.', author: 'Octavia E. Butler', book: 'Kindred', genre: 'Time Travel' },
  { text: 'There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.', author: 'H. G. Wells', book: 'The Time Machine', genre: 'Time Travel' },
  // ── Transgressive & Body Horror ──
  { text: "This is your life and it's ending one minute at a time.", author: 'Chuck Palahniuk', book: 'Fight Club', genre: 'Transgressive & Body Horror' },
  { text: 'The human being is the cause of all evil in this world. We are our own virus.', author: 'Agustina Bazterrica', book: 'Tender Is the Flesh', genre: 'Transgressive & Body Horror' },
  { text: "Before my wife turned vegetarian, I'd always thought of her as completely unremarkable in every way.", author: 'Han Kang', book: 'The Vegetarian', genre: 'Transgressive & Body Horror' },
  // ── Urban Fantasy ──
  { text: 'Questions would be asked. Answers would be ignored.', author: 'Ben Aaronovitch', book: 'Rivers of London', genre: 'Urban Fantasy' },
  { text: "Paranoid? Probably. But just because you're paranoid doesn't mean there isn't an invisible demon about to eat your face.", author: 'Jim Butcher', book: 'Storm Front', genre: 'Urban Fantasy' },
  // ── Vampires ──
  { text: 'Welcome to my house! Enter freely and of your own will!', author: 'Bram Stoker', book: 'Dracula', genre: 'Vampires' },
  { text: 'Evil is always possible. And goodness is eternally difficult.', author: 'Anne Rice', book: 'Interview with the Vampire', genre: 'Vampires' },
  { text: 'None of us really changes over time. We only become more fully what we are.', author: 'Anne Rice', book: 'The Vampire Lestat', genre: 'Vampires' },
  { text: "The prince is never going to come. Everyone knows that; and maybe sleeping beauty's dead.", author: 'Anne Rice', book: 'The Vampire Lestat', genre: 'Vampires' },
  { text: 'And so the lion fell in love with the lamb.', author: 'Stephenie Meyer', book: 'Twilight', genre: 'Vampires' },
  // ── Victorian Fiction ──
  { text: 'The only way to get rid of temptation is to yield to it.', author: 'Oscar Wilde', book: 'The Picture of Dorian Gray', genre: 'Victorian Fiction' },
  { text: 'It is a far, far better thing that I do, than I have ever done.', author: 'Charles Dickens', book: 'A Tale of Two Cities', genre: 'Victorian Fiction' },
  { text: "We're all mad here. I'm mad. You're mad.", author: 'Lewis Carroll', book: "Alice's Adventures in Wonderland", genre: 'Victorian Fiction' },
  // ── Vikings & Norse ──
  { text: 'Cattle die, kinsmen die, the self must also die; I know one thing which never dies: the reputation of each dead man.', author: 'Anonymous, trans. Carolyne Larrington', book: 'The Poetic Edda', genre: 'Vikings & Norse' },
  { text: 'He said nothing: seldom do those who are silent make mistakes.', author: 'Neil Gaiman', book: 'Norse Mythology', genre: 'Vikings & Norse' },
  { text: 'Fate is inexorable. It grips us like a harness.', author: 'Bernard Cornwell', book: 'The Last Kingdom', genre: 'Vikings & Norse' },
  // ── War Fiction ──
  { text: 'A true war story is never moral.', author: "Tim O'Brien", book: 'The Things They Carried', genre: 'War Fiction' },
  { text: 'Billy Pilgrim has come unstuck in time.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five', genre: 'War Fiction' },
  { text: "We are not youth any longer. We don't want to take the world by storm.", author: 'Erich Maria Remarque', book: 'All Quiet on the Western Front', genre: 'War Fiction' },
  // ── Werewolves ──
  { text: 'My grandfather used to tell me he was a werewolf.', author: 'Stephen Graham Jones', book: 'Mongrels', genre: 'Werewolves' },
  { text: "Just because life's meaningless doesn't mean we can't experience it meaningfully.", author: 'Glen Duncan', book: 'The Last Werewolf', genre: 'Werewolves' },
  // ── Western ──
  { text: 'The older the violin, the sweeter the music.', author: 'Larry McMurtry', book: 'Lonesome Dove', genre: 'Western' },
  { text: 'You must pay for everything in this world one way and another. There is nothing free except the Grace of God.', author: 'Charles Portis', book: 'True Grit', genre: 'Western' },
  { text: 'What joins men together is not the sharing of bread but the sharing of enemies.', author: 'Cormac McCarthy', book: 'Blood Meridian', genre: 'Western' },
  // ── Witches ──
  { text: 'My darling girl, when are you going to realize that being normal is not necessarily a virtue? It rather denotes a lack of courage.', author: 'Alice Hoffman', book: 'Practical Magic', genre: 'Witches' },
  { text: 'Always throw spilled salt over your left shoulder. Keep rosemary by your garden gate. Add pepper to your mashed potatoes. Plant roses and lavender, for luck. Fall in love whenever you can.', author: 'Alice Hoffman', book: 'Practical Magic', genre: 'Witches' },
  { text: "Do you ever just put your arms out and just spin and spin and spin? Well, that's what love is like.", author: 'Alice Hoffman', book: 'Practical Magic', genre: 'Witches' },
  { text: 'Double, double toil and trouble; fire burn, and cauldron bubble.', author: 'William Shakespeare', book: 'Macbeth', genre: 'Witches' },
  // ── Young Adult ──
  { text: 'As he read, I fell in love the way you fall asleep: slowly, and then all at once.', author: 'John Green', book: 'The Fault in Our Stars', genre: 'Young Adult' },
  { text: 'And in that moment, I swear we were infinite.', author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower', genre: 'Young Adult' },
  // ── Zombies ──
  { text: 'The monsters that rose from the dead, they are nothing compared to the ones we carry in our hearts.', author: 'Max Brooks', book: 'World War Z', genre: 'Zombies' },
  { text: "Most people don't believe something can happen until it already has. That's not stupidity or weakness, that's just human nature.", author: 'Max Brooks', book: 'World War Z', genre: 'Zombies' },
  { text: 'Fear is the most basic emotion we have. Fear is primal. Fear sells.', author: 'Max Brooks', book: 'World War Z', genre: 'Zombies' },
  { text: "There's a word for that kind of lie. Hope.", author: 'Max Brooks', book: 'World War Z', genre: 'Zombies' },
];


const ROTATE_MS = 10000; // rotate quote every 10s
const FADE_MS = 500;      // fade transition length
const LEAVES = 4;         // pages turning in the book mark

gsap.registerPlugin(SplitText);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// Shuffle the pool, but when the caller names shelves (e.g. the temperament
// the Oracle is drawing), lead with those shelves' lines.
function orderQuotes(genres) {
  const wanted = new Set((genres || []).map(norm).filter(Boolean));
  if (!wanted.size) return shuffle(QUOTES);
  const first = [];
  const rest = [];
  for (const q of QUOTES) (wanted.has(norm(q.genre)) ? first : rest).push(q);
  return [...shuffle(first), ...shuffle(rest)];
}

export default function BookLoader({ text, fullHeight = false, genres = null, spread = false, spreadAfterMs }) {
  const t = useT();
  // BookLoader also renders before DataProvider mounts (the app's first
  // load), so read the context directly and tolerate its absence.
  const data = useContext(DataContext);
  const catalog = data?.state?.genres;

  // Shuffle once per mount; walk the shuffled order so no repeats until the
  // whole pool is exhausted.
  const orderRef = useRef(null);
  if (!orderRef.current) orderRef.current = orderQuotes(genres);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const [spreadOn, setSpreadOn] = useState(false);
  const swapRef = useRef(null);
  const threadRef = useRef(null);
  const quoteRef = useRef(null);
  const mountedAtRef = useRef(Date.now());

  // The landing's gold thread, borrowed for the wait: it draws beneath the
  // quote while the Oracle works, and when the loader leaves (results landed)
  // a small spark marks the resolution. Skipped for very short waits and, via
  // burst() itself, under prefers-reduced-motion.
  useEffect(() => {
    // Both refs are read in the CLEANUP, which runs at unmount — by which point
    // React has already detached the DOM ref, so `threadRef.current` can be
    // null exactly when we want it. Captured here, while the effect body runs
    // and the node is still attached. `mountedAt` never changes after mount, so
    // capturing it is free.
    const mountedAt = mountedAtRef.current;
    const el = threadRef.current;
    return () => {
      if (Date.now() - mountedAt < 1500) return;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || r.top < 0 || r.top > window.innerHeight) return;
      burst(r.left + r.width / 2, r.top + r.height / 2, 12);
    };
  }, []);

  useEffect(() => {
    const rotate = setInterval(() => {
      // fade out, swap, fade back in
      setVisible(false);
      swapRef.current = setTimeout(() => {
        setIdx((i) => (i + 1) % orderRef.current.length);
        setVisible(true);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => {
      clearInterval(rotate);
      if (swapRef.current) clearTimeout(swapRef.current);
    };
  }, []);

  // Ink-in: each new quote soaks onto the page word by word, then its
  // attribution and shelf tag settle in beneath. The blockquote is keyed by
  // idx, so React mounts a fresh node per quote and SplitText never edits a
  // node React is still reconciling; revert() runs before it unmounts.
  useLayoutEffect(() => {
    const el = quoteRef.current;
    if (!el || prefersReducedMotion()) return undefined;
    const fig = el.closest('.book-loader__quote');
    const meta = fig ? fig.querySelectorAll('.book-loader__quote-meta, .book-loader__genre') : [];
    const split = SplitText.create(el, { type: 'words', wordsClass: 'book-loader__word' });
    const tl = gsap.timeline();
    tl.from(split.words, {
      opacity: 0,
      y: 5,
      filter: 'blur(5px)',
      duration: 0.7,
      ease: 'power2.out',
      stagger: Math.min(0.06, 1.8 / Math.max(split.words.length, 1)),
    }).from(meta, { opacity: 0, y: 6, duration: 0.6, ease: 'power2.out', stagger: 0.12 }, '-=0.35');
    return () => {
      tl.kill();
      split.revert();
      gsap.set(meta, { clearProps: 'opacity,transform' });
    };
  }, [idx]);

  const quote = orderRef.current[idx];

  // Link the shelf tag to its genre page when the heading names a real genre.
  // A new tab, deliberately: following it mid-wait must not abandon the
  // Oracle's reading in this one.
  const genreHref = useMemo(() => {
    if (!quote.genre || !catalog?.length) return null;
    const n = norm(quote.genre);
    const hit = catalog.find((g) => norm(g.name) === n || norm(g.normalizedName) === n);
    return hit?.normalizedName ? hrefFor('genre-page', { genreSlug: hit.normalizedName }) : null;
  }, [quote.genre, catalog]);

  return (
    <div
      className={`book-loader${fullHeight ? ' book-loader--full' : ''}${spreadOn ? ' book-loader--spread' : ''}`}
      role="status"
      aria-live="polite"
    >
      {spread && <OracleWaitSpread onActive={setSpreadOn} showAfterMs={spreadAfterMs} />}
      <div className="book-loader__book" aria-hidden="true">
        <span className="book-loader__board book-loader__board--left" />
        <span className="book-loader__board book-loader__board--right" />
        {Array.from({ length: LEAVES }, (_, i) => (
          <span className="book-loader__leaf" style={{ '--i': i }} key={i} />
        ))}
      </div>
      {text && <div className="book-loader__status">{text}</div>}
      <svg className="book-loader__thread" ref={threadRef} viewBox="0 0 220 12" aria-hidden="true">
        <path className="book-loader__thread-path" d="M2,6 C40,1 70,11 110,6 C150,1 180,11 218,6" />
      </svg>
      <figure className={`book-loader__quote${visible ? '' : ' is-fading'}`}>
        <blockquote className="book-loader__quote-text" key={idx} ref={quoteRef}>“{quote.text}”</blockquote>
        <figcaption className="book-loader__quote-meta">
          — {quote.author}, <span className="book-loader__quote-book">{quote.book}</span>
        </figcaption>
        {quote.genre && (
          genreHref ? (
            <a className="book-loader__genre" href={genreHref} target="_blank" rel="noopener">
              {t('common.loaderShelf', { genre: quote.genre })}
            </a>
          ) : (
            <span className="book-loader__genre">{t('common.loaderShelf', { genre: quote.genre })}</span>
          )
        )}
      </figure>
    </div>
  );
}
