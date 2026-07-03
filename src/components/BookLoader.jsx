import { useState, useEffect, useRef } from 'react';

// A mixed bag of gothic, horror, romance, fantasy, and literary quotes. One is
// shown at a time and they rotate every ROTATE_MS so longer waits (the Oracle,
// reading plans) stay engaging. Order is shuffled per mount so users rarely see
// the same opening quote twice.
const QUOTES = [
  // ── Gothic ──
  { text: 'We are all haunted houses.', author: 'H.D.', book: 'Tribute to the Angels' },
  { text: 'I am no bird; and no net ensnares me.', author: 'Charlotte Brontë', book: 'Jane Eyre' },
  { text: 'Whatever our souls are made of, his and mine are the same.', author: 'Emily Brontë', book: 'Wuthering Heights' },
  { text: 'Last night I dreamt I went to Manderley again.', author: 'Daphne du Maurier', book: 'Rebecca' },
  { text: 'The dead travel fast.', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'I have been bent and broken, but — I hope — into a better shape.', author: 'Charles Dickens', book: 'Great Expectations' },
  // ── Horror ──
  { text: 'We make up horrors to help us cope with the real ones.', author: 'Stephen King', book: 'Danse Macabre' },
  { text: 'The oldest and strongest emotion of mankind is fear.', author: 'H.P. Lovecraft', book: 'Supernatural Horror in Literature' },
  { text: 'Monsters are real, and ghosts are real too. They live inside us.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'Listen to them, the children of the night. What music they make.', author: 'Bram Stoker', book: 'Dracula' },
  { text: 'No live organism can continue for long to exist sanely under conditions of absolute reality.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'That is not dead which can eternal lie, and with strange aeons even death may die.', author: 'H.P. Lovecraft', book: 'The Call of Cthulhu' },
  // ── Romance ──
  { text: 'You have bewitched me, body and soul.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'I would rather share one lifetime with you than face all the ages of this world alone.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'Whatever comes, she thought, will find me unafraid.', author: 'Daphne du Maurier', book: 'Rebecca' },
  { text: 'If you live to be a hundred, I want to live to be a hundred minus one day.', author: 'A.A. Milne', book: 'Winnie-the-Pooh' },
  { text: 'She was more than the sum of the words used to describe her.', author: 'Madeline Miller', book: 'Circe' },
  { text: 'I am half agony, half hope.', author: 'Jane Austen', book: 'Persuasion' },
  // ── Fantasy ──
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'It is a dangerous business, going out your door.', author: 'J.R.R. Tolkien', book: 'The Hobbit' },
  { text: "There's some good in this world, and it's worth fighting for.", author: 'J.R.R. Tolkien', book: 'The Two Towers' },
  { text: 'The truth is a beautiful and terrible thing, and should therefore be treated with great caution.', author: 'J.K. Rowling', book: "Harry Potter and the Sorcerer's Stone" },
  { text: 'We cross our bridges when we come to them and burn them behind us.', author: 'Tom Stoppard', book: 'Rosencrantz and Guildenstern Are Dead' },
  { text: 'The night is dark and full of terrors.', author: 'George R.R. Martin', book: 'A Clash of Kings' },
  { text: 'A reader lives a thousand lives before he dies. The man who never reads lives only one.', author: 'George R.R. Martin', book: 'A Dance with Dragons' },
  // ── Literary ──
  { text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', author: 'F. Scott Fitzgerald', book: 'The Great Gatsby' },
  { text: 'It was the best of times, it was the worst of times.', author: 'Charles Dickens', book: 'A Tale of Two Cities' },
  { text: 'All happy families are alike; each unhappy family is unhappy in its own way.', author: 'Leo Tolstoy', book: 'Anna Karenina' },
  { text: 'The personal, changing, memorable moment is precious. That is where books live.', author: 'Virginia Woolf', book: 'The Common Reader' },
  { text: 'Beware; for I am fearless, and therefore powerful.', author: 'Mary Shelley', book: 'Frankenstein' },
  { text: 'Tomorrow I will think of some way to get him back. After all, tomorrow is another day.', author: 'Margaret Mitchell', book: 'Gone with the Wind' },
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
      <figure className={`book-loader__quote${visible ? '' : ' is-fading'}`}>
        <blockquote className="book-loader__quote-text">“{quote.text}”</blockquote>
        <figcaption className="book-loader__quote-meta">
          — {quote.author}, <span className="book-loader__quote-book">{quote.book}</span>
        </figcaption>
      </figure>
    </div>
  );
}
