/**
 * Margin notes in a hand, the way a reviewer marks up a draft.
 *
 * Marlo's whole manner is marking up its own work, so a few handwritten asides suit it:
 * "yes, really" beside a number it would rather not print. They are used sparingly, never
 * carry a figure (every number on the site comes from the table, through num()), and are
 * real text, so a screen reader reads the joke too. The arrows are drawn strokes and hidden
 * from assistive technology, and they draw themselves in once unless the reader prefers
 * reduced motion.
 */

const ARROWS = {
  // Each is a stroke in a 64 by 40 box, plus an arrowhead at the end of the stroke.
  'down-right': 'M4 6 C 22 4, 40 10, 52 30 M44 28 L53 32 L54 22',
  'down-left': 'M60 6 C 42 4, 24 10, 12 30 M20 28 L11 32 L10 22',
  right: 'M4 24 C 18 10, 36 10, 56 20 M48 13 L57 20 L48 26',
  left: 'M60 24 C 46 10, 28 10, 8 20 M16 13 L7 20 L16 26',
  down: 'M30 4 C 22 14, 38 22, 30 34 M24 28 L30 36 L36 28',
};

/**
 * A note: `text` in the hand, with an optional arrow toward what it is about. `place` is a
 * modifier the stylesheet positions, so the markup says what the note is and the CSS says
 * where it sits at each width.
 */
export function scribble(text, { arrow = null, place = '' } = {}) {
  const path = arrow === null ? null : ARROWS[arrow];
  if (arrow !== null && path === undefined) throw new Error(`scribble: no arrow "${arrow}"`);
  const svg =
    path === null
      ? ''
      : `<svg class="scribble__arrow scribble__arrow--${arrow}" width="64" height="40" viewBox="0 0 64 40" aria-hidden="true" focusable="false"><path d="${path}" pathLength="1"/></svg>`;
  return `<span class="scribble${place ? ` scribble--${place}` : ''}"><span class="scribble__text">${text}</span>${svg}</span>`;
}
