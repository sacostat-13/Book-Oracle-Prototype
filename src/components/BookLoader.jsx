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
// The genre headings are ORGANISATIONAL ONLY. QUOTES is a flat array and
// nothing reads the comments, so a line filed under Cosmic Horror can appear
// while the Oracle draws cozy mysteries. They exist so the next person to
// extend this can see the shape of the coverage — and so a thin genre is
// visible rather than buried in five hundred lines.
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
import { useState, useEffect, useRef } from 'react';
import burst from './landing/burst';

const QUOTES = [
  // ── Adventure ──
  { text: "Seaward ho! Hang the treasure! It's the glory of the sea that has turned my head.", author: 'Robert Louis Stevenson', book: 'Treasure Island' },
  { text: 'With enough determination, any bloody idiot can get up this hill. The trick is to get back down alive.', author: 'Jon Krakauer', book: 'Into Thin Air' },
  { text: 'It does not do to leave a live dragon out of your calculations, if you live near him.', author: 'J.R.R. Tolkien', book: 'The Hobbit' },
  // ── African Literary Fiction ──
  { text: 'I was not sorry when my brother died.', author: 'Tsitsi Dangarembga', book: 'Nervous Conditions' },
  { text: 'In the beginning there was a river. The river became a road and the road branched out to the whole world.', author: 'Ben Okri', book: 'The Famished Road' },
  { text: 'He has put a knife on the things that held us together and we have fallen apart.', author: 'Chinua Achebe', book: 'Things Fall Apart' },
  // ── Alien Invasion ──
  { text: 'Few people realise the immensity of vacancy in which the dust of the material universe swims.', author: 'H.G. Wells', book: 'The War of the Worlds' },
  { text: 'In the face of madness, rationality was powerless.', author: 'Liu Cixin', book: 'The Three-Body Problem' },
  { text: "Remember, the enemy's gate is down.", author: 'Orson Scott Card', book: "Ender's Game" },
  // ── American Gothic ──
  { text: "124 was spiteful. Full of a baby's venom.", author: 'Toni Morrison', book: 'Beloved' },
  { text: 'Hill House, not sane, stood by itself against the hills, holding darkness within.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'My mother is a fish.', author: 'William Faulkner', book: 'As I Lay Dying' },
  // ── American Literature ──
  { text: 'Definitions belong to the definers, not the defined.', author: 'Toni Morrison', book: 'Beloved' },
  { text: "And now that you don't have to be perfect, you can be good.", author: 'John Steinbeck', book: 'East of Eden' },
  // ── Apocalyptic ──
  { text: 'Keep a little fire burning; however small, however hidden.', author: 'Cormac McCarthy', book: 'The Road' },
  { text: 'Hell is the absence of the people you long for.', author: 'Emily St. John Mandel', book: 'Station Eleven' },
  { text: "Freedom is dangerous but it's precious, too. You can't just throw it away or let it slip away.", author: 'Octavia E. Butler', book: 'Parable of the Sower' },
  // ── Apocalyptic Fantasy ──
  { text: "Let's start with the end of the world, why don't we? Get it over with and move on to more interesting things.", author: 'N. K. Jemisin', book: 'The Fifth Season' },
  { text: 'The man in black fled across the desert, and the gunslinger followed.', author: 'Stephen King', book: 'The Gunslinger' },
  { text: 'Ravens! Always the ravens. They settled on the gables of the church even before the injured became the dead.', author: 'Mark Lawrence', book: 'Prince of Thorns' },
  // ── Art History ──
  { text: 'The relation between what we see and what we know is never settled.', author: 'John Berger', book: 'Ways of Seeing' },
  { text: 'There really is no such thing as Art. There are only artists.', author: 'E.H. Gombrich', book: 'The Story of Art' },
  { text: 'No one expected me. Everything awaited me.', author: 'Patti Smith', book: 'Just Kids' },
  // ── Arthurian ──
  { text: 'The best thing for being sad is to learn something. That is the only thing that never fails.', author: 'T.H. White', book: 'The Once and Future King' },
  { text: 'The bravest thing you can do when you are not brave is to profess courage and act accordingly.', author: 'T.H. White', book: 'The Sword in the Stone' },
  { text: 'Here lies Arthur, king once, and king to be.', author: 'Thomas Malory', book: "Le Morte d'Arthur" },
  { text: 'The old order changeth, yielding place to new, and God fulfils himself in many ways, lest one good custom should corrupt the world.', author: 'Alfred, Lord Tennyson', book: 'Idylls of the King' },
  { text: 'In my time I have been called many things: sister, lover, priestess, wisewoman, queen. Now I am old, and the time has come when I too must go into the shadows.', author: 'Marion Zimmer Bradley', book: 'The Mists of Avalon' },
  // ── Arthurian Retelling ──
  { text: 'I am an old man now, but then I was already past my prime when Arthur was crowned King.', author: 'Mary Stewart', book: 'The Crystal Cave' },
  // ── Arthurian-Inspired ──
  { text: 'When the Dark comes rising, six shall turn it back.', author: 'Susan Cooper', book: 'The Dark Is Rising' },
  { text: 'The giant, once buried, now stirs.', author: 'Kazuo Ishiguro', book: 'The Buried Giant' },
  { text: 'Once upon a time, in a land that was called Britain, these things happened.', author: 'Bernard Cornwell', book: 'The Winter King' },
  // ── Asian-inspired Fantasy ──
  { text: 'But I warn you, little warrior. The price of power is pain.', author: 'R.F. Kuang', book: 'The Poppy War' },
  { text: 'Destroying what someone else cherished never brought back what you yourself had lost.', author: 'Shelley Parker-Chan', book: 'She Who Became the Sun' },
  { text: 'What is fate but coincidences in retrospect?', author: 'Ken Liu', book: 'The Grace of Kings' },
  // ── Australian Gothic ──
  { text: 'Everything begins and ends at exactly the right time and place.', author: 'Joan Lindsay', book: 'Picnic at Hanging Rock' },
  { text: 'The map? I will first make it.', author: 'Patrick White', book: 'Voss' },
  { text: 'If I am a wretch, who made me one? If I hate you and myself and the world, who made me hate it?', author: 'Marcus Clarke', book: 'For the Term of His Natural Life' },
  // ── Aviation ──
  { text: 'The earth teaches us more about ourselves than all the books in the world, because it is resistant to us.', author: 'Antoine de Saint-Exupéry', book: 'Wind, Sand and Stars' },
  { text: 'You can live a lifetime and, at the end of it, know more about other people than you know about yourself.', author: 'Beryl Markham', book: 'West with the Night' },
  { text: "Most gulls don't bother to learn more than the simplest facts of flight — how to get from shore to food and back again.", author: 'Richard Bach', book: 'Jonathan Livingston Seagull' },
  // ── Biography ──
  { text: 'I learned that courage was not the absence of fear, but the triumph over it.', author: 'Nelson Mandela', book: 'Long Walk to Freedom' },
  { text: 'In spite of everything, I still believe that people are really good at heart.', author: 'Anne Frank', book: 'The Diary of a Young Girl' },
  { text: 'I have learned that success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome.', author: 'Booker T. Washington', book: 'Up From Slavery' },
  { text: 'Your story is what you have, what you will always have. It is something to own.', author: 'Michelle Obama', book: 'Becoming' },
  { text: 'There is no greater agony than bearing an untold story inside you.', author: 'Maya Angelou', book: 'I Know Why the Caged Bird Sings' },
  // ── Body Horror & Transgressive ──
  { text: 'As Gregor Samsa awoke one morning from uneasy dreams he found himself transformed in his bed into a gigantic insect.', author: 'Franz Kafka', book: 'The Metamorphosis' },
  { text: "It's only after we've lost everything that we're free to do anything.", author: 'Chuck Palahniuk', book: 'Fight Club' },
  { text: "You are not your job. You're not how much money you have in the bank. You are not the car you drive.", author: 'Chuck Palahniuk', book: 'Fight Club' },
  { text: 'I was benevolent and good; misery made me a fiend.', author: 'Mary Shelley', book: 'Frankenstein' },
  // ── British & Rural Horror ──
  { text: 'Innocence, once lost, is lost forever.', author: 'Susan Hill', book: 'The Woman in Black' },
  { text: 'If it had another name, I never knew, but the locals called it the Loney.', author: 'Andrew Michael Hurley', book: 'The Loney' },
  { text: 'Some teeth long for ripping, gleaming wet from black dog gums. So you keep your eyes closed at the end.', author: 'Adam Nevill', book: 'The Ritual' },
  // ── Celtic Fantasy ──
  { text: "I have never known courage to be judged by the length of a man's hair.", author: 'Lloyd Alexander', book: 'The Book of Three' },
  { text: 'Sometimes you must seem to hurt something in order to do good for it.', author: 'Susan Cooper', book: 'The Grey King' },
  { text: 'The world is simple, I think, in its essence. Life, death, love, hate. Desire, fulfillment. Magic.', author: 'Juliet Marillier', book: 'Son of the Shadows' },
  // ── Chicano & Latinx Fiction ──
  { text: 'I am in the earth and the earth is in me.', author: 'Luis Alberto Urrea', book: "The Hummingbird's Daughter" },
  { text: 'Women endure the labor of childbirth and men send themselves to war!', author: 'Ana Castillo', book: 'So Far from God' },
  { text: 'The half-life of love is forever.', author: 'Junot Díaz', book: 'This Is How You Lose Her' },
  // ── Children's Fiction ──
  { text: 'It is only with the heart that one can see rightly; what is essential is invisible to the eye.', author: 'Antoine de Saint-Exupéry', book: 'The Little Prince' },
  { text: 'You have been my friend. That in itself is a tremendous thing.', author: 'E. B. White', book: "Charlotte's Web" },
  // ── Children's Picture Book ──
  { text: '"And now," cried Max, "let the wild rumpus start!"', author: 'Maurice Sendak', book: 'Where the Wild Things Are' },
  { text: "Oh please don't go—we'll eat you up—we love you so!", author: 'Maurice Sendak', book: 'Where the Wild Things Are' },
  { text: 'You have brains in your head. You have feet in your shoes. You can steer yourself any direction you choose.', author: 'Dr. Seuss', book: 'Oh, the Places You\'ll Go!' },
  { text: 'If you live to be a hundred, I want to live to be a hundred minus one day, so I never have to live without you.', author: 'A.A. Milne', book: 'Winnie-the-Pooh' },
  { text: 'Goodnight room, goodnight moon, goodnight cow jumping over the moon.', author: 'Margaret Wise Brown', book: 'Goodnight Moon' },
  // ── Classic & Older Gothic ──
  { text: 'Whatever our souls are made of, his and mine are the same.', author: 'Emily Brontë', book: 'Wuthering Heights' },
  { text: 'I am no bird; and no net ensnares me.', author: 'Charlotte Brontë', book: 'Jane Eyre' },
  { text: 'Beware; for I am fearless, and therefore powerful.', author: 'Mary Shelley', book: 'Frankenstein' },
  { text: 'The dead travel fast.', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'True! —nervous —very, very dreadfully nervous I had been and am; but why will you say that I am mad?', author: 'Edgar Allan Poe', book: 'The Tell-Tale Heart' },
  // ── Classic Literary Fiction ──
  { text: 'It is not down in any map; true places never are.', author: 'Herman Melville', book: 'Moby-Dick' },
  // ── Classic Science Fiction ──
  { text: 'War is peace. Freedom is slavery. Ignorance is strength.', author: 'George Orwell', book: 'Nineteen Eighty-Four' },
  { text: 'Violence is the last refuge of the incompetent.', author: 'Isaac Asimov', book: 'Foundation' },
  // ── Classics ──
  { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'It was the best of times, it was the worst of times.', author: 'Charles Dickens', book: 'A Tale of Two Cities' },
  { text: 'Call me Ishmael.', author: 'Herman Melville', book: 'Moby-Dick' },
  { text: 'All happy families are alike; each unhappy family is unhappy in its own way.', author: 'Leo Tolstoy', book: 'Anna Karenina' },
  { text: 'Every limit is a beginning as well as an ending.', author: 'George Eliot', book: 'Middlemarch' },
  // ── Climate Fiction ──
  { text: 'Politics is ugly. Never doubt what small men will do for great power.', author: 'Paolo Bacigalupi', book: 'The Windup Girl' },
  // ── Comedy & Wit ──
  { text: 'The trouble with having an open mind, of course, is that people will insist on coming along and trying to put things in it.', author: 'Terry Pratchett', book: 'Diggers' },
  { text: 'I like work; it fascinates me. I can sit and look at it for hours.', author: 'Jerome K. Jerome', book: 'Three Men in a Boat' },
  { text: 'I can resist everything except temptation.', author: 'Oscar Wilde', book: 'The Importance of Being Earnest' },
  { text: "Don't Panic.", author: 'Douglas Adams', book: "The Hitchhiker's Guide to the Galaxy" },
  { text: 'It is a good rule in life never to apologize. The right sort of people do not want apologies, and the wrong sort take a mean advantage of them.', author: 'P.G. Wodehouse', book: 'The Man Upstairs and Other Stories' },
  // ── Coming of Age ──
  { text: 'We accept the love we think we deserve.', author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower' },
  { text: "So, I guess we are who we are for a lot of reasons. But even if we don't have the power to choose where we come from, we can still choose where we go from there.", author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower' },
  { text: "I'm the most terrific liar you ever saw in your life.", author: 'J.D. Salinger', book: 'The Catcher in the Rye' },
  { text: 'I have hated the words and I have loved them, and I hope I have made them right.', author: 'Markus Zusak', book: 'The Book Thief' },
  { text: 'People can really change one another.', author: 'Sally Rooney', book: 'Normal People' },
  // ── Contemporary Fantasy ──
  { text: 'The Beauty of the House is immeasurable; its Kindness infinite.', author: 'Susanna Clarke', book: 'Piranesi' },
  { text: 'Gods die. And when they truly die they are unmourned and unremembered.', author: 'Neil Gaiman', book: 'American Gods' },
  { text: 'Quentin did a magic trick. Nobody noticed.', author: 'Lev Grossman', book: 'The Magicians' },
  // ── Contemporary Fiction ──
  { text: 'Most people go through their whole lives without ever really feeling that close with anyone.', author: 'Sally Rooney', book: 'Normal People' },
  { text: 'Life is the thing you bring with you inside your own head.', author: 'Sally Rooney', book: 'Normal People' },
  { text: "It's wrong what they say about the past, I've learned, about how you can bury it. Because the past claws its way out.", author: 'Khaled Hosseini', book: 'The Kite Runner' },
  { text: "There is no such thing as bad people. We're all just people who sometimes do bad things.", author: 'Colleen Hoover', book: 'It Ends with Us' },
  // ── Cosmic Horror ──
  { text: 'What one thinks finds expression in words, and what one says, happens.', author: 'Algernon Blackwood', book: 'The Willows' },
  { text: 'Amnesia may well be the highest sacrament in the great gray ritual of existence.', author: 'Thomas Ligotti', book: 'Teatro Grottesco' },
  // ── Court Intrigue ──
  { text: 'Drear ritual turned its wheel.', author: 'Mervyn Peake', book: 'Titus Groan' },
  { text: 'When power is gone the memory of power lingers.', author: 'Guy Gavriel Kay', book: 'Tigana' },
  // ── Cozy Fantasy ──
  { text: "I was just thinking that you don't have to forget who you were… because that's what brought you here.", author: 'Travis Baldree', book: 'Legends & Lattes' },
  { text: 'The combined aromas of hot cinnamon, ground coffee, and sweet cardamom intoxicated her.', author: 'Travis Baldree', book: 'Legends & Lattes' },
  { text: "It is more fun to talk with someone who doesn't use long, difficult words but rather short, easy words like 'What about lunch?'", author: 'A.A. Milne', book: 'Winnie-the-Pooh' },
  // ── Cozy Mystery ──
  { text: 'Mma Ramotswe had a detective agency in Africa, at the foot of Kgale Hill.', author: 'Alexander McCall Smith', book: "The No. 1 Ladies' Detective Agency" },
  { text: 'Anyone who murdered Colonel Protheroe would be doing the world at large a service.', author: 'Agatha Christie', book: 'The Murder at the Vicarage' },
  { text: "Always look where the action isn't, because that's where the action is.", author: 'Richard Osman', book: 'The Thursday Murder Club' },
  // ── Crime Fiction ──
  { text: 'Dead men are heavier than broken hearts.', author: 'Raymond Chandler', book: 'The Big Sleep' },
  { text: 'The cheaper the crook, the gaudier the patter.', author: 'Dashiell Hammett', book: 'The Maltese Falcon' },
  // ── Crime Noir ──
  { text: 'There is no trap so deadly as the trap you set for yourself.', author: 'Raymond Chandler', book: 'The Long Goodbye' },
  { text: "I had killed a man, for money and a woman. I didn't have the money and I didn't have the woman.", author: 'James M. Cain', book: 'Double Indemnity' },
  { text: 'Who shot him? I asked. The grey man scratched the back of his neck and said: Somebody with a gun.', author: 'Dashiell Hammett', book: 'Red Harvest' },
  // ── Cult Fiction ──
  { text: "But it's the truth even if it didn't happen.", author: 'Ken Kesey', book: "One Flew Over the Cuckoo's Nest" },
  { text: 'It began as a mistake.', author: 'Charles Bukowski', book: 'Post Office' },
  // ── Cultural Studies ──
  { text: 'To collect photographs is to collect the world.', author: 'Susan Sontag', book: 'On Photography' },
  { text: 'Love is an action, never simply a feeling.', author: 'bell hooks', book: 'All About Love' },
  { text: 'In order to see a photograph well, it is best to look away or close your eyes.', author: 'Roland Barthes', book: 'Camera Lucida' },
  // ── Cyberpunk ──
  { text: 'The sky above the port was the color of television, tuned to a dead channel.', author: 'William Gibson', book: 'Neuromancer' },
  { text: 'Cyberspace. A consensual hallucination experienced daily by billions of legitimate operators.', author: 'William Gibson', book: 'Neuromancer' },
  { text: 'The street finds its own uses for things.', author: 'William Gibson', book: 'Burning Chrome' },
  { text: 'You will be required to do wrong no matter where you go. It is the basic condition of life, to be required to violate your own identity.', author: 'Philip K. Dick', book: 'Do Androids Dream of Electric Sheep?' },
  // ── Dark & Epic Fantasy ──
  { text: 'When you play a game of thrones you win or you die.', author: 'George R.R. Martin', book: 'A Game of Thrones' },
  { text: 'The man who passes the sentence should swing the sword.', author: 'George R.R. Martin', book: 'A Game of Thrones' },
  { text: 'The night is dark and full of terrors.', author: 'George R.R. Martin', book: 'A Clash of Kings' },
  { text: 'A reader lives a thousand lives before he dies. The man who never reads lives only one.', author: 'George R.R. Martin', book: 'A Dance with Dragons' },
  { text: "There's some good in this world, and it's worth fighting for.", author: 'J.R.R. Tolkien', book: 'The Two Towers' },
  // ── Dark Academia ──
  { text: 'It is better to know one book intimately than a hundred superficially.', author: 'Donna Tartt', book: 'The Secret History' },
  { text: 'We were always surrounded by books and words and poetry, all the fierce passion of the world bound in leather and vellum.', author: 'M.L. Rio', book: 'If We Were Villains' },
  { text: "I should like to bury something precious in every place where I've been happy.", author: 'Evelyn Waugh', book: 'Brideshead Revisited' },
  // ── Dark Fantasy ──
  { text: "Real magic can never be made by offering someone else's liver.", author: 'Peter S. Beagle', book: 'The Last Unicorn' },
  { text: 'For death is life. It is only living that is lifeless.', author: 'Mervyn Peake', book: 'Titus Groan' },
  { text: "He had noticed that events were cowards: they didn't occur singly, but instead they would run in packs.", author: 'Neil Gaiman', book: 'Neverwhere' },
  // ── Demons & Monsters ──
  { text: "Better to reign in Hell, than serve in Heav'n.", author: 'John Milton', book: 'Paradise Lost' },
  { text: "Manuscripts don't burn.", author: 'Mikhail Bulgakov', book: 'The Master and Margarita' },
  { text: "Poor Grendel's had an accident. So may you all.", author: 'John Gardner', book: 'Grendel' },
  // ── Dragons ──
  { text: 'The dragons do not dream. They are dreams.', author: 'Ursula K. Le Guin', book: 'The Farthest Shore' },
  { text: 'But we were dragons. We were supposed to be cruel, cunning, heartless and terrible.', author: 'Terry Pratchett', book: 'Guards! Guards!' },
  { text: 'May your swords stay sharp.', author: 'Christopher Paolini', book: 'Eragon' },
  // ── Drama ──
  { text: 'There are more things in heaven and earth, Horatio, than are dreamt of in your philosophy.', author: 'William Shakespeare', book: 'Hamlet' },
  { text: "I didn't go to the moon, I went much further—for time is the longest distance between two places.", author: 'Tennessee Williams', book: 'The Glass Menagerie' },
  { text: 'All Russia is our orchard.', author: 'Anton Chekhov', book: 'The Cherry Orchard' },
  // ── Dying Earth ──
  { text: 'We believe that we invent symbols. The truth is that they invent us.', author: 'Gene Wolfe', book: 'The Shadow of the Torturer' },
  { text: 'There is no magic. There is only knowledge, more or less hidden.', author: 'Gene Wolfe', book: 'The Claw of the Conciliator' },
  { text: 'And I to have gained Honour; yet to have learned that Honour doth be but as the ash of Life, if that you not to have Love.', author: 'William Hope Hodgson', book: 'The Night Land' },
  // ── Dystopian ──
  { text: "Words can be like X-rays, if you use them properly—they'll go through anything.", author: 'Aldous Huxley', book: 'Brave New World' },
  { text: 'Happy Hunger Games! And may the odds be ever in your favor.', author: 'Suzanne Collins', book: 'The Hunger Games' },
  { text: "The worst part of holding the memories is not the pain. It's the loneliness of it.", author: 'Lois Lowry', book: 'The Giver' },
  // ── East Asian Lit ──
  { text: 'The train came out of the long tunnel into the snow country.', author: 'Yasunari Kawabata', book: 'Snow Country' },
  { text: 'The place I like best in this world is the kitchen.', author: 'Banana Yoshimoto', book: 'Kitchen' },
  { text: 'Chance encounters are what keep us going.', author: 'Haruki Murakami', book: 'Kafka on the Shore' },
  // ── East Asian Literary Fiction ──
  { text: 'I want you always to remember me. Will you remember that I existed, and that I stood next to you here like this?', author: 'Haruki Murakami', book: 'Norwegian Wood' },
  { text: 'Memories warm you up from the inside. But they also tear you apart.', author: 'Haruki Murakami', book: 'Kafka on the Shore' },
  { text: 'Time was a wave, almost cruel in its relentlessness as it whisked her life downstream.', author: 'Han Kang', book: 'The Vegetarian' },
  { text: "Memories, even your most precious ones, fade surprisingly quickly. But I don't go along with that. The memories I value most, I don't ever see them fading.", author: 'Kazuo Ishiguro', book: 'Never Let Me Go' },
  // ── Eco-Fiction ──
  { text: "There was the hills, an' there was me, an' we wasn't separate no more. We was one thing.", author: 'John Steinbeck', book: 'The Grapes of Wrath' },
  { text: 'Somewhere in the depths of solitude, beyond wilderness and freedom, lay the trap of madness.', author: 'Edward Abbey', book: 'The Monkey Wrench Gang' },
  // ── Epic & Dark Fantasy ──
  { text: "Once you've got a task to do, it's better to do it than live with the fear of it.", author: 'Joe Abercrombie', book: 'The Blade Itself' },
  { text: 'When you play the game of thrones, you win or you die.', author: 'George R. R. Martin', book: 'A Game of Thrones' },
  { text: 'Very little worth knowing is taught by fear.', author: 'Robin Hobb', book: "Assassin's Apprentice" },
  // ── Epic Fantasy ──
  { text: 'All that is gold does not glitter, not all those who wander are lost.', author: 'J. R. R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'Life before death, strength before weakness, journey before destination.', author: 'Brandon Sanderson', book: 'The Way of Kings' },
  { text: 'To hear, one must be silent.', author: 'Ursula K. Le Guin', book: 'A Wizard of Earthsea' },
  // ── Epic Poetry ──
  { text: "Rage—Goddess, sing the rage of Peleus' son Achilles.", author: 'Homer', book: 'The Iliad' },
  { text: 'Sing to me of the man, Muse, the man of twists and turns driven time and again off course.', author: 'Homer', book: 'The Odyssey' },
  { text: 'So. The Spear-Danes in days gone by and the kings who ruled them had courage and greatness.', author: 'Anonymous (trans. Seamus Heaney)', book: 'Beowulf' },
  { text: 'Better to reign in Hell, than serve in Heaven.', author: 'John Milton', book: 'Paradise Lost' },
  { text: 'Midway upon the journey of our life I found myself within a forest dark, for the straightforward pathway had been lost.', author: 'Dante Alighieri', book: 'The Divine Comedy' },
  // ── Epistolary Fiction ──
  { text: 'It is funny how mortals always picture us as putting things into their minds: in reality our best work is done by keeping things out.', author: 'C. S. Lewis', book: 'The Screwtape Letters' },
  { text: 'When one woman strikes at the heart of another, she seldom misses, and the wound is invariably fatal.', author: 'Pierre Choderlos de Laclos', book: 'Les Liaisons Dangereuses' },
  // ── Espionage ──
  { text: 'Intelligence work has one moral law — it is justified by results.', author: 'John le Carré', book: 'The Spy Who Came In from the Cold' },
  { text: 'The more identities a man has, the more they express the person they conceal.', author: 'John le Carré', book: 'Tinker Tailor Soldier Spy' },
  { text: 'God save us always from the innocent and the good.', author: 'Graham Greene', book: 'The Quiet American' },
  // ── Existential ──
  { text: 'I swear to you gentlemen, that to be overly conscious is a sickness, a real, thorough sickness.', author: 'Fyodor Dostoevsky', book: 'Notes from Underground' },
  { text: 'And what can life be worth if the first rehearsal for life is life itself?', author: 'Milan Kundera', book: 'The Unbearable Lightness of Being' },
  // ── Experimental & Avant-Garde ──
  { text: 'Mrs Dalloway said she would buy the flowers herself.', author: 'Virginia Woolf', book: 'Mrs Dalloway' },
  { text: 'For Heaven only knows why one loves it so, how one sees it so, making it up, building it round one, tumbling it, creating it every moment afresh.', author: 'Virginia Woolf', book: 'Mrs Dalloway' },
  { text: 'Yes I said yes I will Yes.', author: 'James Joyce', book: 'Ulysses' },
  { text: 'So it goes.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five' },
  { text: 'Rose is a rose is a rose is a rose.', author: 'Gertrude Stein', book: 'Sacred Emily' },
  // ── Fairy Tale Retelling ──
  { text: 'I am all for putting new wine in old bottles, especially if the pressure of the new wine makes the old bottles explode.', author: 'Angela Carter', book: 'The Bloody Chamber' },
  { text: 'Mirror, mirror, on the wall, who is the fairest of them all?', author: 'Brothers Grimm', book: 'Snow White' },
  { text: 'But a mermaid has no tears, and therefore she suffers so much more.', author: 'Hans Christian Andersen', book: 'The Little Mermaid' },
  // ── Family Drama ──
  { text: "Lydia is dead. But they don't know this yet.", author: 'Celeste Ng', book: 'Everything I Never Told You' },
  { text: 'I was born twice: first, as a baby girl, on a remarkably smokeless Detroit day in January of 1960.', author: 'Jeffrey Eugenides', book: 'Middlesex' },
  { text: 'My mother believed you could be anything you wanted to be in America.', author: 'Amy Tan', book: 'The Joy Luck Club' },
  // ── Fantasy ──
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'It is a dangerous business, going out your door.', author: 'J.R.R. Tolkien', book: 'The Hobbit' },
  { text: 'The truth is a beautiful and terrible thing, and should therefore be treated with great caution.', author: 'J.K. Rowling', book: "Harry Potter and the Sorcerer's Stone" },
  { text: "Only in silence the word, only in dark the light, only in dying life: bright the hawk's flight on the empty sky.", author: 'Ursula K. Le Guin', book: 'A Wizard of Earthsea' },
  { text: '"Safe?" said Mr Beaver. "Who said anything about safe? \'Course he isn\'t safe. But he\'s good. He\'s the King, I tell you."', author: 'C.S. Lewis', book: 'The Lion, the Witch and the Wardrobe' },
  // ── Fantasy Romance ──
  { text: "Be glad of your human heart, Feyre. Pity those who don't feel anything at all.", author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses' },
  { text: '"I love you," he whispered, and kissed my brow. "Thorns and all."', author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses' },
  { text: 'We need hope, or else we cannot endure.', author: 'Sarah J. Maas', book: 'A Court of Thorns and Roses' },
  { text: 'I would rather share one lifetime with you than face all the ages of this world alone.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  // ── Feminist & Sapphic Gothic ──
  { text: 'At its core, the Gothic drama is fundamentally about voiceless things—the dead, the past, the marginalized—gaining voices that cannot be ignored.', author: 'Carmen Maria Machado', book: 'Carmilla: A Critical Edition' },
  { text: 'In the rapture of my enormous humiliation I live in her warm kisses, and live to die.', author: 'Sheridan Le Fanu', book: 'Carmilla' },
  { text: 'I was going to put death in all their food and watch them die.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle' },
  { text: 'For there is no friend like a sister in calm or stormy weather.', author: 'Christina Rossetti', book: 'Goblin Market' },
  // ── Feminist & Social Commentary ──
  { text: 'Better never means better for everyone. It always means worse, for some.', author: 'Margaret Atwood', book: "The Handmaid's Tale" },
  { text: 'We teach girls to shrink themselves, to make themselves smaller.', author: 'Chimamanda Ngozi Adichie', book: 'We Should All Be Feminists' },
  // ── Feminist Fiction ──
  { text: 'The bird that would soar above the level plain of tradition and prejudice must have strong wings.', author: 'Kate Chopin', book: 'The Awakening' },
  { text: 'If you expect nothing from somebody you are never disappointed.', author: 'Sylvia Plath', book: 'The Bell Jar' },
  { text: 'The more I wonder, the more I love.', author: 'Alice Walker', book: 'The Color Purple' },
  // ── Feminist Gothic ──
  { text: 'A pretty sight, a lady with a book.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle' },
  // ── First Contact ──
  { text: 'The planets you may one day possess. But the stars are not for man.', author: 'Arthur C. Clarke', book: "Childhood's End" },
  { text: 'Knowledge of the future was incompatible with free will.', author: 'Ted Chiang', book: 'Stories of Your Life and Others' },
  { text: 'Your lack of fear is based on your ignorance.', author: 'Liu Cixin', book: 'The Three-Body Problem' },
  // ── Folk Horror ──
  { text: "It isn't fair, it isn't right.", author: 'Shirley Jackson', book: 'The Lottery' },
  { text: 'Lottery in June, corn be heavy soon.', author: 'Shirley Jackson', book: 'The Lottery' },
  { text: 'Come. It is time to keep your appointment with the Wicker Man.', author: 'Anthony Shaffer & Robin Hardy', book: 'The Wicker Man' },
  // ── Folklore ──
  { text: 'Fear and flee the wolf; for, worst of all, the wolf may be more than he seems.', author: 'Angela Carter', book: 'The Bloody Chamber' },
  { text: "Mouths don't empty themselves unless ears are sympathetic and knowing.", author: 'Zora Neale Hurston', book: 'Mules and Men' },
  { text: 'Rapunzel, Rapunzel, let down your hair to me.', author: 'Jacob and Wilhelm Grimm', book: "Grimms' Fairy Tales" },
  // ── Gothic & Haunted Houses ──
  { text: 'We are all haunted houses.', author: 'H.D.', book: 'Tribute to the Angels' },
  { text: 'Whatever walked there, walked alone.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'No live organism can continue for long to exist sanely under conditions of absolute reality.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'Last night I dreamt I went to Manderley again.', author: 'Daphne du Maurier', book: 'Rebecca' },
  { text: 'Whatever comes, she thought, will find me unafraid.', author: 'Daphne du Maurier', book: 'Rebecca' },
  // ── Graphic Novel ──
  { text: 'The cold, suffocating dark goes on forever and we are alone. Existence is random. Has no pattern save what we imagine after staring at it for too long.', author: 'Alan Moore', book: 'Watchmen' },
  { text: "We're all puppets, Laurie. I'm just a puppet who can see the strings.", author: 'Alan Moore', book: 'Watchmen' },
  { text: 'Evil must be punished. Even in the face of Armageddon I shall not compromise.', author: 'Alan Moore', book: 'Watchmen' },
  { text: 'I know this is insane, but I somehow wish I had been in Auschwitz with my parents so I could really know what they lived through.', author: 'Art Spiegelman', book: 'Maus' },
  // ── Grief Memoir ──
  { text: 'Human knowledge is never contained in one person. It grows from the relationships we create between each other and the world.', author: 'Paul Kalanithi', book: 'When Breath Becomes Air' },
  { text: 'Every love story is a potential grief story.', author: 'Julian Barnes', book: 'Levels of Life' },
  { text: 'Age is irrelevant in grief; at issue is not how old he was but how loved.', author: 'Chimamanda Ngozi Adichie', book: 'Notes on Grief' },
  // ── Grimdark ──
  { text: 'Hate will keep you alive where love fails.', author: 'Mark Lawrence', book: 'Prince of Thorns' },
  { text: 'Only madmen and historians, he said, believe their lies.', author: 'R. Scott Bakker', book: 'The Darkness That Comes Before' },
  { text: 'The things we love destroy us every time, lad. Remember that.', author: 'George R. R. Martin', book: 'A Game of Thrones' },
  // ── Haunted Houses ──
  { text: "Just because there are no ghosts it doesn't mean you can't be haunted.", author: 'Silvia Moreno-Garcia', book: 'Mexican Gothic' },
  // ── Heist ──
  { text: "There's no freedom quite like the freedom of being constantly underestimated.", author: 'Scott Lynch', book: 'The Lies of Locke Lamora' },
  { text: 'A thief never makes a noise by accident.', author: 'Megan Whalen Turner', book: 'The Thief' },
  { text: "She'd absolutely adored the library — an entire building where anyone could take things they didn't own and feel no remorse about it.", author: 'Ally Carter', book: 'Heist Society' },
  // ── Historical ──
  { text: 'I am haunted by humans.', author: 'Markus Zusak', book: 'The Book Thief' },
  // ── Historical Biography ──
  { text: 'In the cold, nearly colorless light of a New England winter, two men on horseback traveled the coast road below Boston, heading north.', author: 'David McCullough', book: 'John Adams' },
  { text: 'Among the most famous women to have lived, Cleopatra VII ruled Egypt for twenty-two years.', author: 'Stacy Schiff', book: 'Cleopatra: A Life' },
  { text: 'No immigrant in American history has ever made a larger contribution than Alexander Hamilton.', author: 'Ron Chernow', book: 'Alexander Hamilton' },
  // ── Historical Fantasy ──
  { text: 'All of us are lonely at some point or another, no matter how many people surround us.', author: 'Helene Wecker', book: 'The Golem and the Jinni' },
  { text: "There's only one way to run away from your own story, and that's to sneak into someone else's.", author: 'Alix E. Harrow', book: 'The Ten Thousand Doors of January' },
  // ── Historical Fiction ──
  { text: 'Having faith in God did not mean sitting back and doing nothing. It meant believing you would find success if you did your best honestly and energetically.', author: 'Ken Follett', book: 'The Pillars of the Earth' },
  { text: 'She loved him because he had brought her back to life. She had been like a caterpillar in a cocoon, and he had drawn her out and shown her that she was a butterfly.', author: 'Ken Follett', book: 'The Pillars of the Earth' },
  { text: 'Beneath every history, another history.', author: 'Hilary Mantel', book: 'Wolf Hall' },
  { text: 'Some of these things are true and some of them lies. But they are all good stories.', author: 'Hilary Mantel', book: 'Wolf Hall' },
  { text: 'Tomorrow I will think of some way to get him back. After all, tomorrow is another day.', author: 'Margaret Mitchell', book: 'Gone with the Wind' },
  // ── Historical Romance ──
  { text: 'I do not know if the wound is mortal, but Claire—I do feel my heart\'s blood leave me, when I look at you.', author: 'Diana Gabaldon', book: 'Dragonfly in Amber' },
  { text: "Ye are Blood of my Blood, and Bone of my Bone. I give ye my Body, that we Two might be One. I give ye my Spirit, 'til our Life shall be Done.", author: 'Diana Gabaldon', book: 'Outlander' },
  { text: 'I love you with everything I am, everything I\'ve been, and everything I hope to be.', author: 'Julia Quinn', book: 'Romancing Mister Bridgerton' },
  { text: 'I am asking you to marry me because I love you, because I cannot imagine living my life without you.', author: 'Julia Quinn', book: 'An Offer From a Gentleman' },
  // ── Horror ──
  { text: 'We make up horrors to help us cope with the real ones.', author: 'Stephen King', book: 'Danse Macabre' },
  { text: 'The oldest and strongest emotion of mankind is fear.', author: 'H.P. Lovecraft', book: 'Supernatural Horror in Literature' },
  { text: 'Monsters are real, and ghosts are real too. They live inside us.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'Listen to them, the children of the night. What music they make.', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'That is not dead which can eternal lie, and with strange aeons even death may die.', author: 'H.P. Lovecraft', book: 'The Call of Cthulhu' },
  // ── Identity & Belonging ──
  { text: 'I am an invisible man.', author: 'Ralph Ellison', book: 'Invisible Man' },
  { text: 'Perhaps home is not a place but simply an irrevocable condition.', author: 'James Baldwin', book: "Giovanni's Room" },
  // ── Illustrated ──
  { text: "So many things are possible just as long as you don't know they're impossible.", author: 'Norton Juster', book: 'The Phantom Tollbooth' },
  { text: 'Machines never have any extra parts. They have the exact number and type of parts they need.', author: 'Brian Selznick', book: 'The Invention of Hugo Cabret' },
  // ── Indigenous Fiction ──
  { text: "They aren't just entertainment. Don't be fooled. They are all we have, you see, all we have to fight off illness and death.", author: 'Leslie Marmon Silko', book: 'Ceremony' },
  { text: 'We started dying before the snow, and like the snow, we continued to fall.', author: 'Louise Erdrich', book: 'Tracks' },
  { text: 'Being Indian has never been about returning to the land. The land is everywhere or nowhere.', author: 'Tommy Orange', book: 'There There' },
  // ── Indigenous Horror ──
  { text: "Our world isn't ending. It already ended.", author: 'Waubgeshig Rice', book: 'Moon of the Crusted Snow' },
  { text: 'And I understood that as long as there are dreamers left, there will never be want for a dream.', author: 'Cherie Dimaline', book: 'The Marrow Thieves' },
  // ── Inspirational ──
  { text: 'Be patient toward all that is unsolved in your heart and try to love the questions themselves.', author: 'Rainer Maria Rilke', book: 'Letters to a Young Poet' },
  { text: 'Tell me, what is it you plan to do with your one wild and precious life?', author: 'Mary Oliver', book: 'New and Selected Poems' },
  // ── International Fiction ──
  { text: 'Many years later, as he faced the firing squad, Colonel Aureliano Buendía was to remember that distant afternoon when his father took him to discover ice.', author: 'Gabriel García Márquez', book: 'One Hundred Years of Solitude' },
  { text: 'There are a lot of children in Afghanistan, but little childhood.', author: 'Khaled Hosseini', book: 'The Kite Runner' },
  { text: 'I have a story that will make you believe in God.', author: 'Yann Martel', book: 'Life of Pi' },
  // ── Intimate Fiction ──
  { text: 'We had the stars, you and I. And this is given once only.', author: 'André Aciman', book: 'Call Me by Your Name' },
  { text: 'To feel nothing so as not to feel anything - what a waste!', author: 'André Aciman', book: 'Call Me by Your Name' },
  { text: "The heaviest of burdens crushes us, we sink beneath it, it pins us to the ground. But in the love poetry of every age, the woman longs to be weighed down by the man's body.", author: 'Milan Kundera', book: 'The Unbearable Lightness of Being' },
  // ── Irish Fiction ──
  { text: 'Is it about a bicycle?', author: "Flann O'Brien", book: 'The Third Policeman' },
  { text: 'The sun shone, having no alternative, on the nothing new.', author: 'Samuel Beckett', book: 'Murphy' },
  { text: 'They departed, the gods, on the day of the strange tide.', author: 'John Banville', book: 'The Sea' },
  // ── Irish Folklore ──
  { text: "It is better doubtless to believe much unreason and a little truth than to deny for denial's sake truth and unreason alike.", author: 'W. B. Yeats', book: 'The Celtic Twilight' },
  { text: "The young never grow old there; the fields and the flowers are as pleasant to be looking at as the blackbird's eggs.", author: 'Lady Augusta Gregory', book: 'Gods and Fighting Men' },
  { text: 'Man, all the world over, when he is tired of the actualities of life, seeks to unbend his mind with the creations of fancy.', author: 'Douglas Hyde', book: 'Beside the Fire' },
  // ── Italian Gothic ──
  { text: 'It is one of the most gloomy spots I ever beheld; the view of it is enough to strike a criminal with despair!', author: 'Ann Radcliffe', book: 'The Italian' },
  { text: 'In this city, demons lurk under the ashes.', author: 'Giorgio De Maria', book: 'The Twenty Days of Turin' },
  { text: 'Heaven mocks the short-sighted views of man.', author: 'Horace Walpole', book: 'The Castle of Otranto' },
  // ── Japanese & East Asian Horror ──
  { text: "It wasn't that people refrained from saying anything out of fear of being laughed at for being unscientific. It was that they felt they'd be drawing unto themselves some unimaginable horror by admitting it.", author: 'Koji Suzuki', book: 'Ring' },
  { text: 'Spirals… this town is contaminated with spirals.', author: 'Junji Ito', book: 'Uzumaki' },
  // ── Japanese & East Asian Lit ──
  { text: 'Our entire civilization—with all its magnificence, and its insignificance—will someday belong to the past.', author: 'Eileen Chang', book: 'Love in a Fallen City' },
  { text: "Truth becomes fiction when the fiction's true; Real becomes not-real where the unreal's real.", author: 'Cao Xueqin', book: 'The Story of the Stone' },
  { text: "It's better to live an ordinary life. If you go on striving for this and that, you'll end up paying with your life.", author: 'Yu Hua', book: 'To Live' },
  // ── Japanese Lit ──
  { text: 'I am a cat. As yet I have no name.', author: 'Natsume Sōseki', book: 'I Am a Cat' },
  // ── Korean, Japanese & East Asian Lit ──
  { text: 'Is it true that human beings are fundamentally cruel? Is the experience of cruelty the only thing we share as a species?', author: 'Han Kang', book: 'Human Acts' },
  { text: "It's been one week since Mom went missing.", author: 'Kyung-sook Shin', book: 'Please Look After Mom' },
  { text: 'Now that I have become you, I shall take your place and live a new life.', author: 'Bora Chung', book: 'Cursed Bunny' },
  // ── Latin American Horror & Literary ──
  { text: "Maybe I wasn't the princess in her castle; maybe I was a madwoman locked in her tower.", author: 'Mariana Enriquez', book: 'Things We Lost in the Fire' },
  { text: 'My mother always said something bad would happen.', author: 'Samanta Schweblin', book: 'Fever Dream' },
  // ── Latin American Literary ──
  { text: 'I came to Comala because I had been told that my father, a man named Pedro Páramo, lived there.', author: 'Juan Rulfo', book: 'Pedro Páramo' },
  { text: 'Barrabás came to us by sea, the child Clara wrote in her delicate calligraphy.', author: 'Isabel Allende', book: 'The House of the Spirits' },
  // ── Legal Thriller ──
  { text: 'There is no client as scary as an innocent man.', author: 'Michael Connelly', book: 'The Lincoln Lawyer' },
  { text: 'There are few things in life worse than a long-winded lawyer.', author: 'John Grisham', book: 'The Rainmaker' },
  { text: 'And until we can see each other as equals, justice is never going to be even-handed.', author: 'John Grisham', book: 'A Time to Kill' },
  // ── LGBTQ+ Fiction ──
  { text: 'Is it better to speak or to die?', author: 'André Aciman', book: 'Call Me by Your Name' },
  { text: "I bet you could sometimes find all the mysteries of the universe in someone's hand.", author: 'Benjamin Alire Sáenz', book: 'Aristotle and Dante Discover the Secrets of the Universe' },
  { text: "And now we shan't be parted no more, and that's finished.", author: 'E. M. Forster', book: 'Maurice' },
  // ── LGBTQ+ Romance ──
  { text: 'I love him, with all that, because of all that. On purpose. I love him on purpose.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  { text: 'But the truth is, also, simply this: love is indomitable.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  { text: 'When you kissed me in disgusting public toilets and pouted in hotel bars and made me happy in ways in which it had never even occurred to me that a mangled-up, locked-up person like me could be happy, I loved you.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  // ── Literary Criticism ──
  { text: 'The road to hell is paved with adverbs.', author: 'Stephen King', book: 'On Writing' },
  { text: 'Almost all good writing begins with terrible first efforts.', author: 'Anne Lamott', book: 'Bird by Bird' },
  { text: 'The king died and then the queen died is a story. The king died, and then the queen died of grief, is a plot.', author: 'E. M. Forster', book: 'Aspects of the Novel' },
  // ── Literary Fiction ──
  { text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', author: 'F. Scott Fitzgerald', book: 'The Great Gatsby' },
  { text: 'The personal, changing, memorable moment is precious. That is where books live.', author: 'Virginia Woolf', book: 'The Common Reader' },
  { text: 'In this here place, we flesh; flesh that weeps, laughs; flesh that dances on bare feet in grass. Love it. Love it hard.', author: 'Toni Morrison', book: 'Beloved' },
  { text: 'I looked up at the mass of signs and stars in the night sky and laid myself open for the first time to the benign indifference of the world.', author: 'Albert Camus', book: 'The Stranger' },
  { text: 'Pain and suffering are always inevitable for a large intelligence and a deep heart.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  // ── LitRPG ──
  { text: "You'd be amazed how much research you can get done when you have no life whatsoever.", author: 'Ernest Cline', book: 'Ready Player One' },
  { text: "Everything's science fiction until someone makes it science fact.", author: 'Marie Lu', book: 'Warcross' },
  // ── Magical Realism ──
  { text: 'It was inevitable: the scent of bitter almonds always reminded him of the fate of unrequited love.', author: 'Gabriel García Márquez', book: 'Love in the Time of Cholera' },
  { text: "There's no sun there, no moon, no direction, no sense of time. Just fine white sand swirling up into the sky like pulverized bones.", author: 'Haruki Murakami', book: 'Kafka on the Shore' },
  { text: 'The feeling that she had never really lived in this world caught her by surprise. It was a fact. She had never lived.', author: 'Han Kang', book: 'The Vegetarian' },
  // ── Malaysian Literary Fiction ──
  { text: 'On a mountain above the clouds once lived a man who had been the gardener of the emperor of Japan.', author: 'Tan Twan Eng', book: 'The Garden of Evening Mists' },
  { text: 'For that is what miracles are like sometimes: quiet, unheralded, unglamorous to all but the beneficiary.', author: 'Preeta Samarasan', book: 'Evening Is the Whole Day' },
  { text: "All my beliefs are ill-founded, all my convictions weak. Yet I feel strangely alive. Funny, isn't it?", author: 'Tash Aw', book: 'The Harmony Silk Factory' },
  // ── Martial Arts ──
  { text: 'All martial arts in the world are invincible except for speed.', author: 'Jin Yong', book: 'The Legend of the Condor Heroes' },
  { text: 'The supreme art of war is to subdue the enemy without fighting.', author: 'Sun Tzu', book: 'The Art of War' },
  { text: 'Do nothing that is of no use.', author: 'Miyamoto Musashi', book: 'The Book of Five Rings' },
  // ── Medical Narrative ──
  { text: "Even if I'm dying, until I actually die, I am still living.", author: 'Paul Kalanithi', book: 'When Breath Becomes Air' },
  { text: 'We look for medicine to be an orderly field of knowledge and procedure. But it is not.', author: 'Atul Gawande', book: 'Complications' },
  { text: 'If a man has lost a leg or an eye, he knows he has lost a leg or an eye; but if he has lost a self, he cannot know it.', author: 'Oliver Sacks', book: 'The Man Who Mistook His Wife for a Hat' },
  // ── Medieval ──
  { text: 'All shall be well, and all shall be well, and all manner of thing shall be well.', author: 'Julian of Norwich', book: 'Revelations of Divine Love' },
  { text: 'All hope abandon, ye who enter in!', author: 'Dante Alighieri', book: 'The Divine Comedy: Inferno' },
  // ── Memoir ──
  { text: 'Life changes fast. Life changes in the instant. You sit down to dinner and life as you know it ends.', author: 'Joan Didion', book: 'The Year of Magical Thinking' },
  { text: 'The cradle rocks above an abyss, and common sense tells us that our existence is but a brief crack of light between two eternities of darkness.', author: 'Vladimir Nabokov', book: 'Speak, Memory' },
  { text: 'It was, of course, a miserable childhood: the happy childhood is hardly worth your while.', author: 'Frank McCourt', book: "Angela's Ashes" },
  // ── Metafiction ──
  { text: "You are about to begin reading Italo Calvino's new novel, If on a winter's night a traveler.", author: 'Italo Calvino', book: "If on a winter's night a traveler" },
  { text: 'All this happened, more or less.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five' },
  { text: 'This is my favorite book in all the world, though I have never read it.', author: 'William Goldman', book: 'The Princess Bride' },
  // ── Military Fantasy ──
  { text: 'Ambition is not a dirty word. Piss on compromise. Go for the throat.', author: 'Steven Erikson', book: 'Gardens of the Moon' },
  { text: 'Armour is part of a state of mind in which you admit the possibility of being hit.', author: 'Joe Abercrombie', book: 'The Heroes' },
  { text: 'The age of kings is dead, Adamat, and I have killed it.', author: 'Brian McClellan', book: 'Promise of Blood' },
  // ── Military Science Fiction ──
  { text: 'There are no dangerous weapons; there are only dangerous men.', author: 'Robert A. Heinlein', book: 'Starship Troopers' },
  { text: "Tonight we're going to show you eight silent ways to kill a man.", author: 'Joe Haldeman', book: 'The Forever War' },
  // ── Modernist ──
  { text: 'History is a nightmare from which I am trying to awake.', author: 'James Joyce', book: 'Ulysses' },
  { text: 'What is the meaning of life? That was all — a simple question; one that tended to close in on one with years.', author: 'Virginia Woolf', book: 'To the Lighthouse' },
  { text: 'Clocks slay time. Time is dead as long as it is being clicked off.', author: 'William Faulkner', book: 'The Sound and the Fury' },
  // ── Monster Horror ──
  { text: 'I ought to be thy Adam, but I am rather the fallen angel, whom thou drivest from joy for no misdeed.', author: 'Mary Shelley', book: 'Frankenstein' },
  { text: 'The walls speak to me. They tell me secrets.', author: 'Silvia Moreno-Garcia', book: 'Mexican Gothic' },
  // ── Music Fiction ──
  { text: "It's not what you like but what you are like that's important.", author: 'Nick Hornby', book: 'High Fidelity' },
  { text: 'He believed that life, true life, was something that was stored in music.', author: 'Ann Patchett', book: 'Bel Canto' },
  { text: 'I am not a muse. I am the somebody.', author: 'Taylor Jenkins Reid', book: 'Daisy Jones & The Six' },
  // ── Mystery ──
  { text: 'When you have eliminated the impossible, whatever remains, however improbable, must be the truth.', author: 'Arthur Conan Doyle', book: 'The Sign of Four' },
  { text: "Every murderer is probably somebody's old friend.", author: 'Agatha Christie', book: 'An Autobiography' },
  { text: "I'm a big fan of the lie of omission.", author: 'Gillian Flynn', book: 'Gone Girl' },
  { text: "There's a difference between really loving someone and loving the idea of her.", author: 'Gillian Flynn', book: 'Gone Girl' },
  // ── Mythological Fantasy ──
  { text: 'I could recognize him by touch alone, by smell; I would know him blind, by the way his breaths came and his feet struck the earth.', author: 'Madeline Miller', book: 'The Song of Achilles' },
  { text: 'We were like gods at the dawning of the world, and our joy was so bright we could see nothing else but the other.', author: 'Madeline Miller', book: 'The Song of Achilles' },
  { text: 'She was more than the sum of the words used to describe her.', author: 'Madeline Miller', book: 'Circe' },
  { text: "It doesn't matter, in the end, how they got the money. It's how you spend it that decides who and what you are.", author: 'Neil Gaiman', book: 'American Gods' },
  // ── Non-Fiction ──
  { text: 'Grief turns out to be a place none of us know until we reach it.', author: 'Joan Didion', book: 'The Year of Magical Thinking' },
  { text: 'To photograph is to appropriate the thing photographed.', author: 'Susan Sontag', book: 'On Photography' },
  { text: 'In nature nothing exists alone.', author: 'Rachel Carson', book: 'Silent Spring' },
  { text: 'The Cognitive Revolution is accordingly the point when history declared its independence from biology.', author: 'Yuval Noah Harari', book: 'Sapiens' },
  { text: 'A woman must have money and a room of her own if she is to write fiction.', author: 'Virginia Woolf', book: 'A Room of One\'s Own' },
  // ── Paranormal ──
  { text: 'The world changes, we do not, therein lies the irony that kills us.', author: 'Anne Rice', book: 'Interview with the Vampire' },
  { text: 'First of all, it was October, a rare month for boys.', author: 'Ray Bradbury', book: 'Something Wicked This Way Comes' },
  // ── Parenting & Motherhood ──
  { text: "I'll tend to her as no mother ever tended a child, a daughter. Nobody will ever get my milk no more except my own children.", author: 'Toni Morrison', book: 'Beloved' },
  { text: '"Your love is too thick," he said.', author: 'Toni Morrison', book: 'Beloved' },
  { text: "I would give up the unessential; I would give my money, I would give my life for my children; but I wouldn't give myself.", author: 'Kate Chopin', book: 'The Awakening' },
  // ── Philosophical Fiction ──
  { text: 'One must imagine Sisyphus happy.', author: 'Albert Camus', book: 'The Myth of Sisyphus' },
  { text: 'Taking a new step, uttering a new word, is what people fear most.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: 'Wisdom is not communicable.', author: 'Hermann Hesse', book: 'Siddhartha' },
  { text: 'Hell is other people.', author: 'Jean-Paul Sartre', book: 'No Exit' },
  // ── Philosophy ──
  { text: 'Such as are thy habitual thoughts, such also will be the character of thy mind; for the soul is dyed by the thoughts.', author: 'Marcus Aurelius', book: 'Meditations' },
  { text: 'When you gaze long into an abyss the abyss also gazes into you.', author: 'Friedrich Nietzsche', book: 'Beyond Good and Evil' },
  // ── Political Fiction ──
  { text: 'All animals are equal, but some animals are more equal than others.', author: 'George Orwell', book: 'Animal Farm' },
  { text: 'Man is conceived in sin and born in corruption and he passeth from the stink of the didie to the stench of the shroud.', author: 'Robert Penn Warren', book: "All the King's Men" },
  // ── Portal Fantasy ──
  { text: 'The term is over: the holidays have begun. The dream is ended: this is the morning.', author: 'C. S. Lewis', book: 'The Last Battle' },
  { text: 'She was a story, not an epilogue.', author: 'Seanan McGuire', book: 'Every Heart a Doorway' },
  { text: 'The sky had never seemed so sky; the world had never seemed so world.', author: 'Neil Gaiman', book: 'Coraline' },
  // ── Post-Apocalyptic ──
  { text: 'Men go and come, but earth abides.', author: 'George R. Stewart', book: 'Earth Abides' },
  { text: 'A new terror born in death, a new superstition entering the unassailable fortress of forever. I am legend.', author: 'Richard Matheson', book: 'I Am Legend' },
  { text: 'Ignorance is king. Many would not profit by his abdication.', author: 'Walter M. Miller Jr.', book: 'A Canticle for Leibowitz' },
  // ── Postmodern ──
  { text: 'All plots tend to move deathward. This is the nature of plots.', author: 'Don DeLillo', book: 'White Noise' },
  { text: 'A screaming comes across the sky.', author: 'Thomas Pynchon', book: "Gravity's Rainbow" },
  // ── Psychological Fiction ──
  { text: 'The man who has a conscience suffers whilst acknowledging his sin. That is his punishment.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: "To go wrong in one's own way is better than to go right in someone else's.", author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: 'We took away your art because we thought it would reveal your souls. Or to put it more finely, we did it to prove you had souls at all.', author: 'Kazuo Ishiguro', book: 'Never Let Me Go' },
  { text: 'I felt very still and empty, the way the eye of a tornado must feel, moving dully along in the middle of the surrounding hullabaloo.', author: 'Sylvia Plath', book: 'The Bell Jar' },
  // ── Quest Fantasy ──
  { text: 'There are three things all wise men fear: the sea in storm, a night with no moon, and the anger of a gentle man.', author: 'Patrick Rothfuss', book: 'The Name of the Wind' },
  { text: 'The Wheel of Time turns, and Ages come and pass, leaving memories that become legend.', author: 'Robert Jordan', book: 'The Eye of the World' },
  { text: 'We are not always what we seem, and hardly ever what we dream.', author: 'Peter S. Beagle', book: 'The Last Unicorn' },
  // ── Romance ──
  { text: 'You have bewitched me, body and soul.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'I am half agony, half hope.', author: 'Jane Austen', book: 'Persuasion' },
  { text: "So it's not gonna be easy. It's gonna be really hard. We're gonna have to work at this every day, but I want to do that because I want you.", author: 'Nicholas Sparks', book: 'The Notebook' },
  { text: "Just because someone hurts you doesn't mean you can simply stop loving them.", author: 'Colleen Hoover', book: 'It Ends with Us' },
  // ── Romantasy ──
  { text: 'A dragon without its rider is a tragedy. A rider without their dragon is dead.', author: 'Rebecca Yarros', book: 'Fourth Wing' },
  { text: 'To the stars who listen—and the dreams that are answered.', author: 'Sarah J. Maas', book: 'A Court of Mist and Fury' },
  { text: 'Fear and bravery are often one and the same.', author: 'Jennifer L. Armentrout', book: 'From Blood and Ash' },
  // ── Romantic Fantasy ──
  { text: 'In the land of Ingary, where such things as seven-league boots really exist, it is quite the misfortune to be born the eldest of three.', author: 'Diana Wynne Jones', book: "Howl's Moving Castle" },
  { text: 'You intolerable lunatic, he snarled at me, and then he caught my face between his hands and kissed me.', author: 'Naomi Novik', book: 'Uprooted' },
  { text: 'You will find the way, daughter of the forest. Through grief and pain, through many trials, your feet will walk a straight path.', author: 'Juliet Marillier', book: 'Daughter of the Forest' },
  // ── Sapphic & Feminist Gothic ──
  { text: 'In the rapture of my enormous humiliation I live in your warm life, and you shall die—die, sweetly die—into mine.', author: 'J. Sheridan Le Fanu', book: 'Carmilla' },
  { text: 'I am going to put death in all their food and watch them die.', author: 'Shirley Jackson', book: 'We Have Always Lived in the Castle' },
  // ── Sapphic Fantasy ──
  { text: 'No woman should be made to fear that she was not enough.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  { text: 'I would live alone for fifty years to have one day with you.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  { text: 'We may be small, and we may be young, but we will shake the world for our beliefs.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  // ── Satire ──
  { text: 'Some men are born mediocre, some men achieve mediocrity, and some men have mediocrity thrust upon them.', author: 'Joseph Heller', book: 'Catch-22' },
  { text: 'Everything was beautiful and nothing hurt.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five' },
  { text: 'Let us work without reasoning; it is the only way to make life endurable.', author: 'Voltaire', book: 'Candide' },
  // ── Scandinavian Horror ──
  { text: 'Real love is to offer your life at the feet of another.', author: 'John Ajvide Lindqvist', book: 'Let the Right One In' },
  { text: 'A graveyard could be so densely populated and yet it was the loneliest place on earth.', author: 'John Ajvide Lindqvist', book: 'Handling the Undead' },
  // ── Sci-Fi & Speculative ──
  { text: 'Fear is the mind-killer.', author: 'Frank Herbert', book: 'Dune' },
  { text: 'It was a pleasure to burn.', author: 'Ray Bradbury', book: 'Fahrenheit 451' },
  { text: 'The only thing that makes life possible is permanent, intolerable uncertainty; not knowing what comes next.', author: 'Ursula K. Le Guin', book: 'The Left Hand of Darkness' },
  { text: 'All that you touch you change. All that you change changes you.', author: 'Octavia E. Butler', book: 'Parable of the Sower' },
  // ── Science Fiction ──
  { text: "Space is big. You just won't believe how vastly, hugely, mind-bogglingly big it is.", author: 'Douglas Adams', book: "The Hitchhiker's Guide to the Galaxy" },
  // ── Scientific Anthropology ──
  { text: 'We did not domesticate wheat. It domesticated us.', author: 'Yuval Noah Harari', book: 'Sapiens' },
  { text: 'We are survival machines — robot vehicles blindly programmed to preserve the selfish molecules known as genes.', author: 'Richard Dawkins', book: 'The Selfish Gene' },
  { text: "History followed different courses for different peoples because of differences among peoples' environments.", author: 'Jared Diamond', book: 'Guns, Germs, and Steel' },
  // ── Scottish ──
  { text: 'Give me a girl at an impressionable age, and she is mine for life.', author: 'Muriel Spark', book: 'The Prime of Miss Jean Brodie' },
  { text: 'Man is not truly one, but truly two.', author: 'Robert Louis Stevenson', book: 'Strange Case of Dr Jekyll and Mr Hyde' },
  { text: 'Sometimes ah think that people become junkies just because they subconsciously crave a wee bit ay silence.', author: 'Irvine Welsh', book: 'Trainspotting' },
  // ── Short Fiction ──
  { text: "I could hear my heart beating. I could hear everyone's heart. I could hear the human noise we sat there making.", author: 'Raymond Carver', book: 'What We Talk About When We Talk About Love' },
  { text: 'The universe (which others call the Library) is composed of an indefinite, perhaps infinite number of hexagonal galleries.', author: 'Jorge Luis Borges', book: 'Ficciones' },
  { text: 'And after all the weather was ideal.', author: 'Katherine Mansfield', book: 'The Garden Party and Other Stories' },
  // ── Slasher ──
  { text: "They float, Georgie. They float. And when you're down here with me, you'll float too.", author: 'Stephen King', book: 'It' },
  { text: 'I am every nightmare you ever had, I am your worst dream come true.', author: 'Stephen King', book: 'It' },
  { text: "A boy's best friend is his mother.", author: 'Robert Bloch', book: 'Psycho' },
  // ── Slavic Folk Horror ──
  { text: 'Wild birds die in cages.', author: 'Katherine Arden', book: 'The Bear and the Nightingale' },
  { text: "Our Dragon doesn't eat the girls he takes, no matter what stories they tell outside our valley.", author: 'Naomi Novik', book: 'Uprooted' },
  { text: 'What is the world but a boxing ring where fools and devils put up their fists?', author: 'Catherynne M. Valente', book: 'Deathless' },
  // ── Smutty Corner ──
  { text: '"Let me love you," he says hoarsely.', author: 'E.L. James', book: 'Fifty Shades of Grey' },
  { text: 'Anastasia Steele, I love you. I want to love, cherish and protect you for the rest of my life.', author: 'E.L. James', book: 'Fifty Shades of Grey' },
  { text: 'He had not touched me. He did not need to. His presence had affected me in such a way that I felt as if he had caressed me for a long time.', author: 'Anaïs Nin', book: 'Delta of Venus' },
  { text: 'The language of sex had yet to be invented. The language of the senses was yet to be explored.', author: 'Anaïs Nin', book: 'Delta of Venus' },
  // ── Social Commentary ──
  { text: 'Who controls the past controls the future. Who controls the present controls the past.', author: 'George Orwell', book: 'Nineteen Eighty-Four' },
  { text: 'Freedom is the freedom to say that two plus two make four. If that is granted, all else follows.', author: 'George Orwell', book: 'Nineteen Eighty-Four' },
  { text: "I think there's just one kind of folks. Folks.", author: 'Harper Lee', book: 'To Kill a Mockingbird' },
  // ── Social Commentary & History ──
  { text: 'The memory of oppressed people is one thing that cannot be taken away.', author: 'Howard Zinn', book: "A People's History of the United States" },
  { text: 'They did what human beings looking for freedom, throughout history, have often done. They left.', author: 'Isabel Wilkerson', book: 'The Warmth of Other Suns' },
  { text: 'A human being is primarily a bag for putting food into.', author: 'George Orwell', book: 'The Road to Wigan Pier' },
  // ── Southern & American Gothic ──
  { text: "The past is never dead. It's not even past.", author: 'William Faulkner', book: 'Requiem for a Nun' },
  { text: 'Where you come from is gone, where you thought you were going to never was there, and where you are is no good unless you can get away from it.', author: 'Flannery O\'Connor', book: 'Wise Blood' },
  { text: 'Some things you forget. Other things you never do.', author: 'Toni Morrison', book: 'Beloved' },
  { text: 'You never really understand a person until you consider things from his point of view, until you climb into his skin and walk around in it.', author: 'Harper Lee', book: 'To Kill a Mockingbird' },
  { text: 'Anything that comes out of the South is going to be called grotesque by the Northern reader, unless it is grotesque, in which case it is going to be called realistic.', author: "Flannery O'Connor", book: 'Mystery and Manners' },
  // ── Southern Fiction ──
  { text: 'Until I feared I would lose it, I never loved to read. One does not love breathing.', author: 'Harper Lee', book: 'To Kill a Mockingbird' },
  { text: 'I mingle with my peers or no one, and since I have no peers, I mingle with no one.', author: 'John Kennedy Toole', book: 'A Confederacy of Dunces' },
  { text: 'Only when the mind is free has the body a chance to be free.', author: 'Ernest J. Gaines', book: 'A Lesson Before Dying' },
  // ── Southern Gothic ──
  { text: 'She would have been a good woman if it had been somebody there to shoot her every minute of her life.', author: "Flannery O'Connor", book: 'A Good Man Is Hard to Find' },
  { text: 'In the town there were two mutes, and they were always together.', author: 'Carson McCullers', book: 'The Heart Is a Lonely Hunter' },
  { text: 'the deep South dead since 1865 and peopled with garrulous outraged baffled ghosts', author: 'William Faulkner', book: 'Absalom, Absalom!' },
  // ── Space Opera ──
  { text: "Words are the only bullets in truth's bandolier. And poets are the snipers.", author: 'Dan Simmons', book: 'Hyperion' },
  { text: "Luxury always comes at someone else's expense.", author: 'Ann Leckie', book: 'Ancillary Justice' },
  { text: 'This book is dedicated to anyone who has ever fallen in love with a culture that was devouring their own.', author: 'Arkady Martine', book: 'A Memory Called Empire' },
  // ── Spanish Literary ──
  { text: 'Every book, every volume you see here, has a soul.', author: 'Carlos Ruiz Zafón', book: 'The Shadow of the Wind' },
  { text: 'The truth may be stretched thin, but it never breaks, and it always surfaces above lies, as oil floats on water.', author: 'Miguel de Cervantes', book: 'Don Quixote' },
  { text: 'I am not, sir, a bad person, though in all truth I am not lacking in reasons for being one.', author: 'Camilo José Cela', book: 'The Family of Pascual Duarte' },
  // ── Spanish Literature ──
  { text: 'The Library is a sphere whose exact centre is any one of its hexagons and whose circumference is inaccessible.', author: 'Jorge Luis Borges', book: 'Ficciones' },
  { text: 'Memory is fragile and the space of a single life is brief.', author: 'Isabel Allende', book: 'The House of the Spirits' },
  // ── Speculative Fiction ──
  { text: 'A rat in a maze is free to go anywhere, as long as it stays inside the maze.', author: 'Margaret Atwood', book: "The Handmaid's Tale" },
  { text: 'What is any ocean but a multitude of drops?', author: 'David Mitchell', book: 'Cloud Atlas' },
  // ── Sports Fiction ──
  { text: 'A ballpark at night is more like a church than a church.', author: 'W. P. Kinsella', book: 'Shoeless Joe' },
  { text: "We don't have a single goddamn thing left to prove to anyone. We're proven. Today we play.", author: 'Chad Harbach', book: 'The Art of Fielding' },
  { text: 'We have two lives; the life we learn with and the life we live after that.', author: 'Bernard Malamud', book: 'The Natural' },
  // ── Steampunk ──
  { text: 'It was a dark, blustery afternoon in spring, and the city of London was chasing a small mining town across the dried-out bed of the old North Sea.', author: 'Philip Reeve', book: 'Mortal Engines' },
  { text: 'When you raise the dead, they bring their baggage.', author: 'William Gibson and Bruce Sterling', book: 'The Difference Engine' },
  { text: 'Maybe this was how you stayed sane in wartime: a handful of noble deeds amid the chaos.', author: 'Scott Westerfeld', book: 'Leviathan' },
  // ── Superhero Epic ──
  { text: "...and all the whores and politicians will look up and shout: 'Save us!' And I'll look down and whisper: 'No.'", author: 'Alan Moore', book: 'Watchmen' },
  { text: "I never said, 'The superman exists, and he's American.' What I said was, 'God exists, and he's American.'", author: 'Alan Moore', book: 'Watchmen' },
  // ── Supernatural ──
  { text: 'Evil is a point of view.', author: 'Anne Rice', book: 'Interview with the Vampire' },
  { text: "Death doesn't exist. It never did, it never will.", author: 'Ray Bradbury', book: 'Something Wicked This Way Comes' },
  // ── Supernatural Horror ──
  { text: 'Sometimes human places create inhuman monsters.', author: 'Stephen King', book: 'The Shining' },
  // ── Surrealism ──
  { text: 'Beauty will be convulsive or will not be at all.', author: 'André Breton', book: 'Nadja' },
  { text: 'Reality is as thin as paper and betrays with all its cracks its imitative character.', author: 'Bruno Schulz', book: 'The Street of Crocodiles' },
  { text: 'Houses are really bodies. We connect ourselves with walls, roofs, and drains just as we hang on to our livers, skeletons, flesh and blood stream.', author: 'Leonora Carrington', book: 'The Hearing Trumpet' },
  // ── Suspense ──
  { text: "This is the story of what a Woman's patience can endure, and what a Man's resolution can achieve.", author: 'Wilkie Collins', book: 'The Woman in White' },
  { text: 'Writers remember everything, especially the hurts.', author: 'Stephen King', book: 'Misery' },
  // ── Techno-Horror ──
  { text: 'What harm could come from just watching a videotape?', author: 'Koji Suzuki', book: 'Ring' },
  { text: 'Her new boss was an undead automaton from hell, true. But, no job is perfect.', author: 'Daniel Suarez', book: 'Daemon' },
  // ── Theology ──
  { text: 'If I find in myself desires which nothing in this world can satisfy, the only logical explanation is that I was made for another world.', author: 'C. S. Lewis', book: 'Mere Christianity' },
  { text: 'The mind commands the body and is instantly obeyed. The mind commands itself and meets resistance.', author: 'Augustine of Hippo', book: 'Confessions' },
  { text: 'When Christ calls a man, he bids him come and die.', author: 'Dietrich Bonhoeffer', book: 'The Cost of Discipleship' },
  // ── Thriller ──
  { text: "There's something disturbing about recalling a warm memory and feeling utterly cold.", author: 'Gillian Flynn', book: 'Gone Girl' },
  { text: 'Problem-solving is hunting; it is savage pleasure and we are born to it.', author: 'Thomas Harris', book: 'The Silence of the Lambs' },
  { text: 'Friendship — my definition — is built on two things. Respect and trust.', author: 'Stieg Larsson', book: 'The Girl with the Dragon Tattoo' },
  // ── Time Travel ──
  { text: 'I lost an arm on my last trip home. My left arm.', author: 'Octavia E. Butler', book: 'Kindred' },
  { text: 'There is no difference between Time and any of the three dimensions of Space except that our consciousness moves along it.', author: 'H. G. Wells', book: 'The Time Machine' },
  // ── Transgressive & Body Horror ──
  { text: "This is your life and it's ending one minute at a time.", author: 'Chuck Palahniuk', book: 'Fight Club' },
  { text: 'The human being is the cause of all evil in this world. We are our own virus.', author: 'Agustina Bazterrica', book: 'Tender Is the Flesh' },
  { text: "Before my wife turned vegetarian, I'd always thought of her as completely unremarkable in every way.", author: 'Han Kang', book: 'The Vegetarian' },
  // ── Urban Fantasy ──
  { text: 'Questions would be asked. Answers would be ignored.', author: 'Ben Aaronovitch', book: 'Rivers of London' },
  { text: "Paranoid? Probably. But just because you're paranoid doesn't mean there isn't an invisible demon about to eat your face.", author: 'Jim Butcher', book: 'Storm Front' },
  // ── Vampires ──
  { text: 'Welcome to my house! Enter freely and of your own will!', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'Evil is always possible. And goodness is eternally difficult.', author: 'Anne Rice', book: 'Interview with the Vampire' },
  { text: 'None of us really changes over time. We only become more fully what we are.', author: 'Anne Rice', book: 'The Vampire Lestat' },
  { text: "The prince is never going to come. Everyone knows that; and maybe sleeping beauty's dead.", author: 'Anne Rice', book: 'The Vampire Lestat' },
  { text: 'And so the lion fell in love with the lamb.', author: 'Stephenie Meyer', book: 'Twilight' },
  // ── Victorian Fiction ──
  { text: 'The only way to get rid of temptation is to yield to it.', author: 'Oscar Wilde', book: 'The Picture of Dorian Gray' },
  { text: 'It is a far, far better thing that I do, than I have ever done.', author: 'Charles Dickens', book: 'A Tale of Two Cities' },
  { text: "We're all mad here. I'm mad. You're mad.", author: 'Lewis Carroll', book: "Alice's Adventures in Wonderland" },
  // ── Vikings & Norse ──
  { text: 'Cattle die, kinsmen die, the self must also die; I know one thing which never dies: the reputation of each dead man.', author: 'Anonymous, trans. Carolyne Larrington', book: 'The Poetic Edda' },
  { text: 'He said nothing: seldom do those who are silent make mistakes.', author: 'Neil Gaiman', book: 'Norse Mythology' },
  { text: 'Fate is inexorable. It grips us like a harness.', author: 'Bernard Cornwell', book: 'The Last Kingdom' },
  // ── War Fiction ──
  { text: 'A true war story is never moral.', author: "Tim O'Brien", book: 'The Things They Carried' },
  { text: 'Billy Pilgrim has come unstuck in time.', author: 'Kurt Vonnegut', book: 'Slaughterhouse-Five' },
  { text: "We are not youth any longer. We don't want to take the world by storm.", author: 'Erich Maria Remarque', book: 'All Quiet on the Western Front' },
  // ── Werewolves ──
  { text: 'My grandfather used to tell me he was a werewolf.', author: 'Stephen Graham Jones', book: 'Mongrels' },
  { text: "Just because life's meaningless doesn't mean we can't experience it meaningfully.", author: 'Glen Duncan', book: 'The Last Werewolf' },
  // ── Western ──
  { text: 'The older the violin, the sweeter the music.', author: 'Larry McMurtry', book: 'Lonesome Dove' },
  { text: 'You must pay for everything in this world one way and another. There is nothing free except the Grace of God.', author: 'Charles Portis', book: 'True Grit' },
  { text: 'What joins men together is not the sharing of bread but the sharing of enemies.', author: 'Cormac McCarthy', book: 'Blood Meridian' },
  // ── Witches ──
  { text: 'My darling girl, when are you going to realize that being normal is not necessarily a virtue? It rather denotes a lack of courage.', author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: 'Always throw spilled salt over your left shoulder. Keep rosemary by your garden gate. Add pepper to your mashed potatoes. Plant roses and lavender, for luck. Fall in love whenever you can.', author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: "Do you ever just put your arms out and just spin and spin and spin? Well, that's what love is like.", author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: 'Double, double toil and trouble; fire burn, and cauldron bubble.', author: 'William Shakespeare', book: 'Macbeth' },
  // ── Young Adult ──
  { text: 'As he read, I fell in love the way you fall asleep: slowly, and then all at once.', author: 'John Green', book: 'The Fault in Our Stars' },
  { text: 'And in that moment, I swear we were infinite.', author: 'Stephen Chbosky', book: 'The Perks of Being a Wallflower' },
  // ── Zombies ──
  { text: 'The monsters that rose from the dead, they are nothing compared to the ones we carry in our hearts.', author: 'Max Brooks', book: 'World War Z' },
  { text: "Most people don't believe something can happen until it already has. That's not stupidity or weakness, that's just human nature.", author: 'Max Brooks', book: 'World War Z' },
  { text: 'Fear is the most basic emotion we have. Fear is primal. Fear sells.', author: 'Max Brooks', book: 'World War Z' },
  { text: "There's a word for that kind of lie. Hope.", author: 'Max Brooks', book: 'World War Z' },
];


const ROTATE_MS = 10000; // rotate quote every 10s
const FADE_MS = 500;      // fade transition length

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function BookLoader({ text, fullHeight = false }) {
  // Shuffle once per mount; walk the shuffled order so no repeats until the
  // whole pool is exhausted.
  const orderRef = useRef(shuffle(QUOTES));
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const swapRef = useRef(null);
  const threadRef = useRef(null);
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

  const quote = orderRef.current[idx];

  return (
    <div className={`book-loader${fullHeight ? ' book-loader--full' : ''}`} role="status" aria-live="polite">
      <div className="book-loader__anim" aria-hidden="true">
        <div className="book-loader__page" />
      </div>
      {text && <div className="book-loader__status">{text}</div>}
      <svg className="book-loader__thread" ref={threadRef} viewBox="0 0 220 12" aria-hidden="true">
        <path className="book-loader__thread-path" d="M2,6 C40,1 70,11 110,6 C150,1 180,11 218,6" />
      </svg>
      <figure className={`book-loader__quote${visible ? '' : ' is-fading'}`}>
        <blockquote className="book-loader__quote-text">“{quote.text}”</blockquote>
        <figcaption className="book-loader__quote-meta">
          — {quote.author}, <span className="book-loader__quote-book">{quote.book}</span>
        </figcaption>
      </figure>
    </div>
  );
}
