import { useState, useEffect, useRef } from 'react';
import burst from './landing/burst';

// One quote per genre-shelf across all 49 Oracle genres. One is shown at a
// time and they rotate every ROTATE_MS so longer waits (the Oracle, reading
// plans) stay engaging. Order is shuffled per mount so users rarely see the
// same opening quote twice, and with this many entries pooled across genres
// it's rare to see the same quote twice in a session at all.
const QUOTES = [
  // ── Arthurian ──
  { text: 'The best thing for being sad is to learn something. That is the only thing that never fails.', author: 'T.H. White', book: 'The Once and Future King' },
  { text: 'The bravest thing you can do when you are not brave is to profess courage and act accordingly.', author: 'T.H. White', book: 'The Sword in the Stone' },
  { text: 'Here lies Arthur, king once, and king to be.', author: 'Thomas Malory', book: "Le Morte d'Arthur" },
  { text: 'The old order changeth, yielding place to new, and God fulfils himself in many ways, lest one good custom should corrupt the world.', author: 'Alfred, Lord Tennyson', book: 'Idylls of the King' },
  { text: 'In my time I have been called many things: sister, lover, priestess, wisewoman, queen. Now I am old, and the time has come when I too must go into the shadows.', author: 'Marion Zimmer Bradley', book: 'The Mists of Avalon' },
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
  // ── Classics ──
  { text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'It was the best of times, it was the worst of times.', author: 'Charles Dickens', book: 'A Tale of Two Cities' },
  { text: 'Call me Ishmael.', author: 'Herman Melville', book: 'Moby-Dick' },
  { text: 'All happy families are alike; each unhappy family is unhappy in its own way.', author: 'Leo Tolstoy', book: 'Anna Karenina' },
  { text: 'Every limit is a beginning as well as an ending.', author: 'George Eliot', book: 'Middlemarch' },
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
  // ── Contemporary Fiction ──
  { text: 'Most people go through their whole lives without ever really feeling that close with anyone.', author: 'Sally Rooney', book: 'Normal People' },
  { text: 'Life is the thing you bring with you inside your own head.', author: 'Sally Rooney', book: 'Normal People' },
  { text: "It's wrong what they say about the past, I've learned, about how you can bury it. Because the past claws its way out.", author: 'Khaled Hosseini', book: 'The Kite Runner' },
  { text: "There is no such thing as bad people. We're all just people who sometimes do bad things.", author: 'Colleen Hoover', book: 'It Ends with Us' },
  // ── Cozy Fantasy ──
  { text: "I was just thinking that you don't have to forget who you were… because that's what brought you here.", author: 'Travis Baldree', book: 'Legends & Lattes' },
  { text: 'The combined aromas of hot cinnamon, ground coffee, and sweet cardamom intoxicated her.', author: 'Travis Baldree', book: 'Legends & Lattes' },
  { text: "It is more fun to talk with someone who doesn't use long, difficult words but rather short, easy words like 'What about lunch?'", author: 'A.A. Milne', book: 'Winnie-the-Pooh' },
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
  // ── East Asian Literary Fiction ──
  { text: 'I want you always to remember me. Will you remember that I existed, and that I stood next to you here like this?', author: 'Haruki Murakami', book: 'Norwegian Wood' },
  { text: 'Memories warm you up from the inside. But they also tear you apart.', author: 'Haruki Murakami', book: 'Kafka on the Shore' },
  { text: 'Time was a wave, almost cruel in its relentlessness as it whisked her life downstream.', author: 'Han Kang', book: 'The Vegetarian' },
  { text: "Memories, even your most precious ones, fade surprisingly quickly. But I don't go along with that. The memories I value most, I don't ever see them fading.", author: 'Kazuo Ishiguro', book: 'Never Let Me Go' },
  // ── Epic Poetry ──
  { text: "Rage—Goddess, sing the rage of Peleus' son Achilles.", author: 'Homer', book: 'The Iliad' },
  { text: 'Sing to me of the man, Muse, the man of twists and turns driven time and again off course.', author: 'Homer', book: 'The Odyssey' },
  { text: 'So. The Spear-Danes in days gone by and the kings who ruled them had courage and greatness.', author: 'Anonymous (trans. Seamus Heaney)', book: 'Beowulf' },
  { text: 'Better to reign in Hell, than serve in Heaven.', author: 'John Milton', book: 'Paradise Lost' },
  { text: 'Midway upon the journey of our life I found myself within a forest dark, for the straightforward pathway had been lost.', author: 'Dante Alighieri', book: 'The Divine Comedy' },
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
  // ── Folk Horror ──
  { text: "It isn't fair, it isn't right.", author: 'Shirley Jackson', book: 'The Lottery' },
  { text: 'Lottery in June, corn be heavy soon.', author: 'Shirley Jackson', book: 'The Lottery' },
  { text: 'Come. It is time to keep your appointment with the Wicker Man.', author: 'Anthony Shaffer & Robin Hardy', book: 'The Wicker Man' },
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
  // ── International Fiction ──
  { text: 'Many years later, as he faced the firing squad, Colonel Aureliano Buendía was to remember that distant afternoon when his father took him to discover ice.', author: 'Gabriel García Márquez', book: 'One Hundred Years of Solitude' },
  { text: 'There are a lot of children in Afghanistan, but little childhood.', author: 'Khaled Hosseini', book: 'The Kite Runner' },
  { text: 'I have a story that will make you believe in God.', author: 'Yann Martel', book: 'Life of Pi' },
  // ── Intimate Fiction ──
  { text: 'We had the stars, you and I. And this is given once only.', author: 'André Aciman', book: 'Call Me by Your Name' },
  { text: 'To feel nothing so as not to feel anything - what a waste!', author: 'André Aciman', book: 'Call Me by Your Name' },
  { text: "The heaviest of burdens crushes us, we sink beneath it, it pins us to the ground. But in the love poetry of every age, the woman longs to be weighed down by the man's body.", author: 'Milan Kundera', book: 'The Unbearable Lightness of Being' },
  // ── Japanese & East Asian Horror ──
  { text: "It wasn't that people refrained from saying anything out of fear of being laughed at for being unscientific. It was that they felt they'd be drawing unto themselves some unimaginable horror by admitting it.", author: 'Koji Suzuki', book: 'Ring' },
  { text: 'Spirals… this town is contaminated with spirals.', author: 'Junji Ito', book: 'Uzumaki' },
  // ── LGBTQ+ Romance ──
  { text: 'I love him, with all that, because of all that. On purpose. I love him on purpose.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  { text: 'But the truth is, also, simply this: love is indomitable.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  { text: 'When you kissed me in disgusting public toilets and pouted in hotel bars and made me happy in ways in which it had never even occurred to me that a mangled-up, locked-up person like me could be happy, I loved you.', author: 'Casey McQuiston', book: 'Red, White & Royal Blue' },
  // ── Literary Fiction ──
  { text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', author: 'F. Scott Fitzgerald', book: 'The Great Gatsby' },
  { text: 'The personal, changing, memorable moment is precious. That is where books live.', author: 'Virginia Woolf', book: 'The Common Reader' },
  { text: 'In this here place, we flesh; flesh that weeps, laughs; flesh that dances on bare feet in grass. Love it. Love it hard.', author: 'Toni Morrison', book: 'Beloved' },
  { text: 'I looked up at the mass of signs and stars in the night sky and laid myself open for the first time to the benign indifference of the world.', author: 'Albert Camus', book: 'The Stranger' },
  { text: 'Pain and suffering are always inevitable for a large intelligence and a deep heart.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  // ── Magical Realism ──
  { text: 'It was inevitable: the scent of bitter almonds always reminded him of the fate of unrequited love.', author: 'Gabriel García Márquez', book: 'Love in the Time of Cholera' },
  { text: "There's no sun there, no moon, no direction, no sense of time. Just fine white sand swirling up into the sky like pulverized bones.", author: 'Haruki Murakami', book: 'Kafka on the Shore' },
  { text: 'The feeling that she had never really lived in this world caught her by surprise. It was a fact. She had never lived.', author: 'Han Kang', book: 'The Vegetarian' },
  // ── Martial Arts ──
  { text: 'All martial arts in the world are invincible except for speed.', author: 'Jin Yong', book: 'The Legend of the Condor Heroes' },
  { text: 'The supreme art of war is to subdue the enemy without fighting.', author: 'Sun Tzu', book: 'The Art of War' },
  { text: 'Do nothing that is of no use.', author: 'Miyamoto Musashi', book: 'The Book of Five Rings' },
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
  // ── Parenting & Motherhood ──
  { text: "I'll tend to her as no mother ever tended a child, a daughter. Nobody will ever get my milk no more except my own children.", author: 'Toni Morrison', book: 'Beloved' },
  { text: '"Your love is too thick," he said.', author: 'Toni Morrison', book: 'Beloved' },
  { text: "I would give up the unessential; I would give my money, I would give my life for my children; but I wouldn't give myself.", author: 'Kate Chopin', book: 'The Awakening' },
  // ── Philosophical Fiction ──
  { text: 'One must imagine Sisyphus happy.', author: 'Albert Camus', book: 'The Myth of Sisyphus' },
  { text: 'Taking a new step, uttering a new word, is what people fear most.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: 'Wisdom is not communicable.', author: 'Hermann Hesse', book: 'Siddhartha' },
  { text: 'Hell is other people.', author: 'Jean-Paul Sartre', book: 'No Exit' },
  // ── Psychological Fiction ──
  { text: 'The man who has a conscience suffers whilst acknowledging his sin. That is his punishment.', author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: "To go wrong in one's own way is better than to go right in someone else's.", author: 'Fyodor Dostoevsky', book: 'Crime and Punishment' },
  { text: 'We took away your art because we thought it would reveal your souls. Or to put it more finely, we did it to prove you had souls at all.', author: 'Kazuo Ishiguro', book: 'Never Let Me Go' },
  { text: 'I felt very still and empty, the way the eye of a tornado must feel, moving dully along in the middle of the surrounding hullabaloo.', author: 'Sylvia Plath', book: 'The Bell Jar' },
  // ── Romance ──
  { text: 'You have bewitched me, body and soul.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'I am half agony, half hope.', author: 'Jane Austen', book: 'Persuasion' },
  { text: "So it's not gonna be easy. It's gonna be really hard. We're gonna have to work at this every day, but I want to do that because I want you.", author: 'Nicholas Sparks', book: 'The Notebook' },
  { text: "Just because someone hurts you doesn't mean you can simply stop loving them.", author: 'Colleen Hoover', book: 'It Ends with Us' },
  // ── Sapphic Fantasy ──
  { text: 'No woman should be made to fear that she was not enough.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  { text: 'I would live alone for fifty years to have one day with you.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  { text: 'We may be small, and we may be young, but we will shake the world for our beliefs.', author: 'Samantha Shannon', book: 'The Priory of the Orange Tree' },
  // ── Sci-Fi & Speculative ──
  { text: 'Fear is the mind-killer.', author: 'Frank Herbert', book: 'Dune' },
  { text: 'It was a pleasure to burn.', author: 'Ray Bradbury', book: 'Fahrenheit 451' },
  { text: 'The only thing that makes life possible is permanent, intolerable uncertainty; not knowing what comes next.', author: 'Ursula K. Le Guin', book: 'The Left Hand of Darkness' },
  { text: 'All that you touch you change. All that you change changes you.', author: 'Octavia E. Butler', book: 'Parable of the Sower' },
  // ── Slasher ──
  { text: "They float, Georgie. They float. And when you're down here with me, you'll float too.", author: 'Stephen King', book: 'It' },
  { text: 'I am every nightmare you ever had, I am your worst dream come true.', author: 'Stephen King', book: 'It' },
  { text: "A boy's best friend is his mother.", author: 'Robert Bloch', book: 'Psycho' },
  // ── Smutty Corner ──
  { text: '"Let me love you," he says hoarsely.', author: 'E.L. James', book: 'Fifty Shades of Grey' },
  { text: 'Anastasia Steele, I love you. I want to love, cherish and protect you for the rest of my life.', author: 'E.L. James', book: 'Fifty Shades of Grey' },
  { text: 'He had not touched me. He did not need to. His presence had affected me in such a way that I felt as if he had caressed me for a long time.', author: 'Anaïs Nin', book: 'Delta of Venus' },
  { text: 'The language of sex had yet to be invented. The language of the senses was yet to be explored.', author: 'Anaïs Nin', book: 'Delta of Venus' },
  // ── Social Commentary ──
  { text: 'Who controls the past controls the future. Who controls the present controls the past.', author: 'George Orwell', book: 'Nineteen Eighty-Four' },
  { text: 'Freedom is the freedom to say that two plus two make four. If that is granted, all else follows.', author: 'George Orwell', book: 'Nineteen Eighty-Four' },
  { text: "I think there's just one kind of folks. Folks.", author: 'Harper Lee', book: 'To Kill a Mockingbird' },
  // ── Southern & American Gothic ──
  { text: "The past is never dead. It's not even past.", author: 'William Faulkner', book: 'Requiem for a Nun' },
  { text: 'Where you come from is gone, where you thought you were going to never was there, and where you are is no good unless you can get away from it.', author: 'Flannery O\'Connor', book: 'Wise Blood' },
  { text: 'Some things you forget. Other things you never do.', author: 'Toni Morrison', book: 'Beloved' },
  { text: 'You never really understand a person until you consider things from his point of view, until you climb into his skin and walk around in it.', author: 'Harper Lee', book: 'To Kill a Mockingbird' },
  { text: 'Anything that comes out of the South is going to be called grotesque by the Northern reader, unless it is grotesque, in which case it is going to be called realistic.', author: "Flannery O'Connor", book: 'Mystery and Manners' },
  // ── Superhero Epic ──
  { text: "...and all the whores and politicians will look up and shout: 'Save us!' And I'll look down and whisper: 'No.'", author: 'Alan Moore', book: 'Watchmen' },
  { text: "I never said, 'The superman exists, and he's American.' What I said was, 'God exists, and he's American.'", author: 'Alan Moore', book: 'Watchmen' },
  // ── Vampires ──
  { text: 'Welcome to my house! Enter freely and of your own will!', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'Evil is always possible. And goodness is eternally difficult.', author: 'Anne Rice', book: 'Interview with the Vampire' },
  { text: 'None of us really changes over time. We only become more fully what we are.', author: 'Anne Rice', book: 'The Vampire Lestat' },
  { text: "The prince is never going to come. Everyone knows that; and maybe sleeping beauty's dead.", author: 'Anne Rice', book: 'The Vampire Lestat' },
  { text: 'And so the lion fell in love with the lamb.', author: 'Stephenie Meyer', book: 'Twilight' },
  // ── Witches ──
  { text: 'My darling girl, when are you going to realize that being normal is not necessarily a virtue? It rather denotes a lack of courage.', author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: 'Always throw spilled salt over your left shoulder. Keep rosemary by your garden gate. Add pepper to your mashed potatoes. Plant roses and lavender, for luck. Fall in love whenever you can.', author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: "Do you ever just put your arms out and just spin and spin and spin? Well, that's what love is like.", author: 'Alice Hoffman', book: 'Practical Magic' },
  { text: 'Double, double toil and trouble; fire burn, and cauldron bubble.', author: 'William Shakespeare', book: 'Macbeth' },
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
    return () => {
      if (Date.now() - mountedAtRef.current < 1500) return;
      const el = threadRef.current;
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
