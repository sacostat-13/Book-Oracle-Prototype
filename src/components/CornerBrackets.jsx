// src/components/CornerBrackets.jsx
// The four gold corner brackets used on bracketed cards (modals, the sign-in
// card, the profile account card). Drop this as the first child of any
// element with `position: relative` and the `.corner-bracket`s will pin
// themselves to its four corners — see styles/components/_corner-brackets.scss.
//
// This replaced an earlier attempt at drawing all four corners with a single
// layered background-gradient on ::before. That technique was hard to verify
// visually and shipped looking wrong in practice. This is the same plain
// bordered-div technique the design system's own reference mockup uses.

export default function CornerBrackets({ size }) {
  const sizeClass = size === 'sm' ? ' corner-bracket--sm' : '';
  return (
    <>
      <span className={`corner-bracket corner-bracket--tl${sizeClass}`} aria-hidden="true" />
      <span className={`corner-bracket corner-bracket--tr${sizeClass}`} aria-hidden="true" />
      <span className={`corner-bracket corner-bracket--bl${sizeClass}`} aria-hidden="true" />
      <span className={`corner-bracket corner-bracket--br${sizeClass}`} aria-hidden="true" />
    </>
  );
}
