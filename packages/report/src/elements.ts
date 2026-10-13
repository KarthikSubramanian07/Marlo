import type { EngineId, EngineVerdict, RuleResult } from '@marlo/schema';

/**
 * The one-directional invariant, applied to elements as well as to rules.
 *
 * `decideRule` guarantees that a rule some engine failed is never reported clean. That is a
 * statement about the rule. It says nothing about which elements are reported, and the
 * findings for a failed rule were taken from the routed engine alone. So when the routed
 * engine failed some elements of a rule and passed one that a peer failed, the rule was
 * reported and that element was not. The first browser run showed it: in Chromium axe-core
 * passes an `input type="tel"` named by a misspelled `aria-labeledby` that Marlo and Alfa
 * both fail, axe-core is routed for the rule, and the field disappeared from the report.
 *
 * This finds those elements. Engines locate an element in different notations (a CSS
 * selector, an XPath, a tag with an id), so they cannot be compared by locator. They do
 * all carry the element's markup as evidence, and the opening tag in that markup is the
 * same whichever engine serialised it. That opening tag, normalised, is the identity.
 *
 * Two deliberate properties:
 *
 * Counting, not deduplicating. Two elements with identical opening tags are two elements.
 * If the routed engine failed one of them and a peer failed both, the second is reported,
 * because collapsing identical markup would hide exactly the duplicated field a page
 * author is most likely to have copied.
 *
 * A page-level defect is one defect. Engines locate a rule about the whole document, such
 * as a missing title or language, at different elements: one at `html`, another at
 * `head`. A failure located at `html`, `head` or `body` is therefore covered whenever the
 * reporting engine already failed the rule, rather than reported a second time under a
 * different element.
 *
 * An attribute is evidence about its element. Alfa locates an ARIA attribute rule at the
 * attribute itself, so its evidence is `aria-checked="true"` rather than the element that
 * carries it. A reported failure of that shape covers one element whose opening tag holds
 * exactly that attribute and value, so the same link is not reported a second time.
 *
 * Unidentifiable evidence is not guessed at. A snippet that is not an element, or whose
 * opening tag was cut off by truncation, yields no identity, and that verdict is not added
 * here. The rule it belongs to is still reported by `decideRule`, so this can only ever add
 * findings, never remove one.
 */

/** A reasonable bound on attributes read from one opening tag. Markup sets the count. */
const ATTRIBUTE_LIMIT = 64;

/** Elements that stand for the document itself when an engine locates a page-level rule. */
const DOCUMENT_ELEMENTS: ReadonlySet<string> = new Set(['html', 'head', 'body']);

const OPENING_TAG = /^<([a-zA-Z][\w:-]*)([^<>]*)>/;
const ATTRIBUTE_ONLY = /^([^\s=/>"'<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')$/;
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * The normalised opening tag of an evidence snippet, or null when it has none.
 *
 * Tag and attribute names are lower-cased, attributes are sorted by name, and quoting is
 * dropped, so `<INPUT name='a' type=text>` and `<input type="text" name="a">` agree.
 */
export function elementKey(snippet: string): string | null {
  const match = OPENING_TAG.exec(snippet.trim());
  if (match === null) return null;
  const [, tag = '', rest = ''] = match;
  const attributes: string[] = [];
  for (const attribute of rest.matchAll(ATTRIBUTE)) {
    if (attributes.length === ATTRIBUTE_LIMIT) break;
    const [, name = '', double, single, bare] = attribute;
    attributes.push(`${name.toLowerCase()}=${double ?? single ?? bare ?? ''}`);
  }
  attributes.sort();
  return `${tag.toLowerCase()} ${attributes.join(' ')}`.trim();
}

/**
 * The normalised `name=value` of evidence that is a single attribute, or null.
 *
 * Written in the same form `elementKey` uses for each attribute, so an attribute can be
 * looked up among an element's.
 */
export function attributeKey(snippet: string): string | null {
  const match = ATTRIBUTE_ONLY.exec(snippet.trim());
  if (match === null) return null;
  const [, name = '', double, single] = match;
  return `${name.toLowerCase()}=${double ?? single ?? ''}`;
}

/** A peer's failing verdict on an element the reported findings do not already cover. */
export interface UncoveredFailure {
  readonly verdict: EngineVerdict;
  /** Other engines that failed an element with the same identity. */
  readonly agreedBy: readonly EngineId[];
  /** Engines that judged an element with the same identity and did not fail it. */
  readonly dissent: readonly EngineVerdict[];
}

function failures(result: RuleResult): EngineVerdict[] {
  return result.status === 'ok' ? result.verdicts.filter((v) => v.outcome === 'failed') : [];
}

/**
 * The failing elements a peer reported for a rule that the reporting engine's findings do
 * not include.
 *
 * `reportedBy` is the engine whose failing verdicts became findings. Every other engine's
 * failures are checked against them in the order the results are given, and an element
 * reported here counts as covered for the engines after it, so one element failed by two
 * peers appears once, attributed to the first.
 */
export function uncoveredPeerFailures(
  results: readonly RuleResult[],
  reportedBy: EngineId,
): readonly UncoveredFailure[] {
  const covered = new Map<string, number>();
  // Attribute-shaped evidence from the reporting engine, each covering one element that
  // carries it. Consumed once matched, like the element counts.
  const attributes: string[] = [];
  const take = (key: string): boolean => {
    const remaining = covered.get(key) ?? 0;
    if (remaining > 0) {
      covered.set(key, remaining - 1);
      return true;
    }
    const held = new Set(key.split(' ').slice(1));
    const index = attributes.findIndex((attribute) => held.has(attribute));
    if (index === -1) return false;
    attributes.splice(index, 1);
    return true;
  };

  const reporter = results.find((r) => r.engine === reportedBy);
  const reported = reporter === undefined ? [] : failures(reporter);
  const pageLevelCovered = reported.length > 0;
  for (const verdict of reported) {
    const key = elementKey(verdict.target.snippet);
    if (key !== null) covered.set(key, (covered.get(key) ?? 0) + 1);
    const attribute = attributeKey(verdict.target.snippet);
    if (attribute !== null) attributes.push(attribute);
  }

  const out: UncoveredFailure[] = [];
  for (const result of results) {
    if (result.engine === reportedBy) continue;
    // Each peer is compared with what was already reported, not with what an earlier peer
    // consumed, so a copy of the coverage is drawn down per peer.
    const before = new Map(covered);
    const attributesBefore = [...attributes];
    const added: string[] = [];
    for (const verdict of failures(result)) {
      const key = elementKey(verdict.target.snippet);
      if (key === null || take(key)) continue;
      if (pageLevelCovered && DOCUMENT_ELEMENTS.has(key.split(' ')[0] ?? '')) continue;
      added.push(key);
      out.push({
        verdict,
        agreedBy: results
          .filter((other) => other.engine !== result.engine)
          .filter((other) => failures(other).some((v) => elementKey(v.target.snippet) === key))
          .map((other) => other.engine),
        dissent: results
          .filter((other) => other.engine !== result.engine && other.status === 'ok')
          .flatMap((other) =>
            other.verdicts.filter(
              (v) => v.outcome !== 'failed' && elementKey(v.target.snippet) === key,
            ),
          ),
      });
    }
    // Restore the reported coverage, then count what this peer added, so a later peer
    // failing the same element does not report it a second time.
    covered.clear();
    for (const [key, count] of before) covered.set(key, count);
    attributes.splice(0, attributes.length, ...attributesBefore);
    for (const key of added) covered.set(key, (covered.get(key) ?? 0) + 1);
  }
  return out;
}
