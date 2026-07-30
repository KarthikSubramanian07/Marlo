import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type { SourceRange } from '@marlo/schema';

/**
 * Where things are in the source bytes.
 *
 * WHY THIS IS A SEPARATE CONCERN FROM THE DOM
 *
 * Every engine reports findings against a rendered DOM, and a DOM has no memory of the text it
 * came from. Attribute order is normalised, quoting is gone, duplicates have been dropped, and
 * an implied `tbody` that nobody typed is sitting in the tree. So a finding cannot be turned
 * into a diff without going back to the bytes.
 *
 * Findings carried `source: null` and a note saying the location arrives with this layer, for
 * exactly this reason. A byte offset guessed from a DOM selector would have looked more
 * finished than it was.
 *
 * WHY parse5 RATHER THAN A HAND-WRITTEN SCANNER
 *
 * A scanner over HTML that is correct for comments, raw text elements, unquoted attributes,
 * malformed nesting and character references is not a hundred lines, and the failure mode of
 * getting it wrong is an edit applied to the wrong range. That is the single worst thing this
 * codebase could do. parse5 is the tokeniser jsdom uses, is MIT, and reports per-attribute
 * offsets.
 *
 * WHAT IT REFUSES TO DO
 *
 * `locate` returns null rather than a best guess whenever a description matches zero elements
 * or more than one. A repair with no location becomes a `Flag` with reason
 * `source-not-located`, which already exists in the schema. An ambiguous location is the case
 * where a confident answer does real damage.
 */

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

/** How a codemod says which element it means, without a selector engine. */
export interface ElementDescription {
  /** Lower case tag name. */
  readonly tag: string;
  /** Attributes that must be present, and their exact values where a value is given. */
  readonly attrs?: Readonly<Record<string, string | null>>;
  /**
   * Which match to take when several are expected, zero-based.
   *
   * Omitted means the description must match exactly one element. Passing an index is a
   * statement that the caller knows how many there are, and it is checked.
   */
  readonly index?: number;
  /** Total number of matches the caller expects, checked when `index` is given. */
  readonly of?: number;
}

export interface LocatedElement {
  readonly tag: string;
  /** The whole start tag, from `<` to `>`. */
  readonly startTag: SourceRange;
  /** Per attribute, the range covering `name="value"` including the quotes. */
  readonly attrs: ReadonlyMap<string, SourceRange>;
  /** Attribute values as the parser resolved them. */
  readonly values: ReadonlyMap<string, string>;
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function toRange(
  file: string,
  loc: { startOffset: number; endOffset: number; startLine: number; startCol: number },
): SourceRange {
  return {
    file,
    start: loc.startOffset,
    end: loc.endOffset,
    line: loc.startLine,
    column: loc.startCol,
  };
}

/** Every element in the document, in document order, with its source ranges. */
export function indexElements(html: string, file: string): readonly LocatedElement[] {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const out: LocatedElement[] = [];

  const walk = (node: Node): void => {
    if (isElement(node)) {
      const loc = node.sourceCodeLocation;
      // An element the parser implied rather than read, `tbody` being the common one, has no
      // source location. It cannot be edited because it was never written down, and pretending
      // otherwise is how an edit lands in the wrong place.
      const startTag = loc?.startTag;
      if (loc !== undefined && loc !== null && startTag !== undefined) {
        // Attribute ranges hang off the element location rather than off the start tag
        // location, which are different types in parse5 even though both carry them at
        // runtime. Reading the typed one keeps this honest.
        const attrs = new Map<string, SourceRange>();
        for (const [name, attrLoc] of Object.entries(loc.attrs ?? {})) {
          attrs.set(name, toRange(file, attrLoc));
        }
        out.push({
          tag: node.tagName.toLowerCase(),
          startTag: toRange(file, startTag),
          attrs,
          values: new Map(node.attrs.map((a) => [a.name, a.value])),
        });
      }
    }
    for (const child of 'childNodes' in node ? node.childNodes : []) walk(child);
  };

  walk(document);
  return out;
}

/** How many elements a description matches. Exposed so a caller can explain an ambiguity. */
export function matchesOf(
  elements: readonly LocatedElement[],
  description: ElementDescription,
): readonly LocatedElement[] {
  return elements.filter((el) => {
    if (el.tag !== description.tag) return false;
    for (const [name, value] of Object.entries(description.attrs ?? {})) {
      if (!el.values.has(name)) return false;
      if (value !== null && el.values.get(name) !== value) return false;
    }
    return true;
  });
}

/**
 * The one element a description means, or null.
 *
 * Null on zero matches and null on an unexpected number of them. The caller turns that into a
 * flag rather than a fix, because an edit applied to the wrong one of two candidates is worse
 * than no edit at all.
 */
export function locate(
  html: string,
  file: string,
  description: ElementDescription,
): LocatedElement | null {
  const matches = matchesOf(indexElements(html, file), description);
  if (description.index === undefined) return matches.length === 1 ? (matches[0] ?? null) : null;
  if (description.of !== undefined && matches.length !== description.of) return null;
  return matches[description.index] ?? null;
}

/**
 * Attribute occurrences inside one start tag, read from the bytes.
 *
 * This exists for one rule and it is worth explaining. ACT rule e6952f is "attribute is not
 * duplicated", and no DOM-based check can see a violation of it: every HTML parser drops the
 * second occurrence before a tree exists, so `<input name="a" name="b">` and `<input name="a">`
 * are the same document by the time any engine looks. `apps/demo/expected.json` records it as
 * undetectable for that reason.
 *
 * Source location is what makes it detectable, and the scan is safe because it is bounded: the
 * start tag range is already known from the parser, so this only has to tokenise attributes
 * inside a span that is known to be a start tag. That is a much smaller problem than tokenising
 * HTML, and the property tests hold it to it.
 */
export function attributeOccurrences(
  html: string,
  startTag: SourceRange,
): readonly { readonly name: string; readonly start: number; readonly end: number }[] {
  const text = html.slice(startTag.start, startTag.end);
  const out: { name: string; start: number; end: number }[] = [];

  // Past `<tagname`, which cannot contain an attribute.
  let i = 1;
  while (i < text.length && /[^\s/>]/.test(text[i] ?? '')) i += 1;

  while (i < text.length) {
    while (i < text.length && /[\s/]/.test(text[i] ?? '')) i += 1;
    if (i >= text.length || text[i] === '>') break;

    const nameStart = i;
    while (i < text.length && !/[\s/>=]/.test(text[i] ?? '')) i += 1;
    const name = text.slice(nameStart, i).toLowerCase();
    if (name === '') break;

    let end = i;
    let j = i;
    while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
    if (text[j] === '=') {
      j += 1;
      while (j < text.length && /\s/.test(text[j] ?? '')) j += 1;
      const quote = text[j];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, j + 1);
        // An unterminated quote means the start tag range is not what it claimed to be. Give up
        // rather than return an end offset past the end of the tag.
        if (close === -1) return out;
        j = close + 1;
      } else {
        while (j < text.length && !/[\s>]/.test(text[j] ?? '')) j += 1;
      }
      end = j;
      i = j;
    }

    out.push({ name, start: startTag.start + nameStart, end: startTag.start + end });
  }

  return out;
}
