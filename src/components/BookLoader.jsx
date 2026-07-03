import { useMemo } from 'react';

// A mixed bag of gothic, horror, romance, and fantasy quotes. One is picked at
// random each time the loader mounts, so users rarely see the same twice.
const QUOTES = [
  // Gothic
  { text: 'We are all haunted houses.', author: 'H.D.', book: 'Tribute to the Angels' },
  { text: 'I am no bird; and no net ensnares me.', author: 'Charlotte Brontë', book: 'Jane Eyre' },
  { text: 'Whatever our souls are made of, his and mine are the same.', author: 'Emily Brontë', book: 'Wuthering Heights' },
  { text: 'The oscillation between dread and desire is the pulse of every ghost story.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  // Horror
  { text: 'We make up horrors to help us cope with the real ones.', author: 'Stephen King', book: 'Danse Macabre' },
  { text: 'The oldest and strongest emotion of mankind is fear.', author: 'H.P. Lovecraft', book: 'Supernatural Horror in Literature' },
  { text: 'Monsters are real, and ghosts are real too. They live inside us.', author: 'Shirley Jackson', book: 'The Haunting of Hill House' },
  { text: 'Listen to them, the children of the night. What music they make.', author: 'Bram Stoker', book: 'Dracula' },
  // Romance
  { text: 'You have bewitched me, body and soul.', author: 'Jane Austen', book: 'Pride and Prejudice' },
  { text: 'If you live to be a hundred, I want to live to be a hundred minus one day.', author: 'A.A. Milne', book: 'Winnie-the-Pooh' },
  { text: 'I would rather share one lifetime with you than face all the ages of this world alone.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'Whatever comes, she thought, will find me unafraid.', author: 'Daphne du Maurier', book: 'Rebecca' },
  // Fantasy
  { text: 'Not all those who wander are lost.', author: 'J.R.R. Tolkien', book: 'The Fellowship of the Ring' },
  { text: 'It is a dangerous business, going out your door.', author: 'J.R.R. Tolkien', book: 'The Hobbit' },
  { text: 'The truth is a beautiful and terrible thing, and should therefore be treated with great caution.', author: 'J.K. Rowling', book: "Harry Potter and the Sorcerer's Stone" },
  { text: 'There\'s some good in this world, and it\'s worth fighting for.', author: 'J.R.R. Tolkien', book: 'The Two Towers' },
];

export default function BookLoader({ text }) {
  // Pick once per mount so it stays stable while visible.
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);

  return (
    <div className="book-loader" role="status" aria-live="polite">
      <div className="book-loader__anim" aria-hidden="true">
        <div className="book-loader__page" />
      </div>
      {text && <div className="book-loader__status">{text}</div>}
      <figure className="book-loader__quote">
        <blockquote className="book-loader__quote-text">“{quote.text}”</blockquote>
        <figcaption className="book-loader__quote-meta">
          — {quote.author}, <span className="book-loader__quote-book">{quote.book}</span>
        </figcaption>
      </figure>
    </div>
  );
}
