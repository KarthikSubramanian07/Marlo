import { defineRule } from '../define.js';
import { attr, findAll, findFirst, normalise } from '../dom.js';

/**
 * The language rules. The most reliably auto-fixable category in the whole set,
 * because the correct repair is a single attribute whose value is derivable from the
 * document, and re-scanning confirms it.
 *
 * Language tags are validated against BCP 47's grammar rather than against the IANA
 * registry. The registry is thousands of entries and vendoring it would be a second
 * corpus with its own drift problem, so the check is that the tag is well formed and
 * that the primary subtag is a plausible language. A tag that is well formed but not
 * registered returns `cantTell` rather than `failed`: `xx` is grammatically fine and
 * the honest answer is that Marlo does not know whether it is a language.
 */

/** BCP 47, the subset that appears in practice: language[-script][-region][-variant]. */
const BCP47 =
  /^[a-z]{2,3}(?:-[a-z]{3}){0,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[0-9a-z]{5,8}|\d[0-9a-z]{3}))*(?:-[0-9a-wy-z](?:-[0-9a-z]{2,8})+)*(?:-x(?:-[0-9a-z]{1,8})+)?$/i;

/** Grandfathered and private-use tags BCP 47 permits but the pattern above does not. */
const IRREGULAR = new Set([
  'en-gb-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'sgn-be-fr',
  'sgn-be-nl',
  'sgn-ch-de',
]);

/**
 * The two-letter and three-letter primary subtags that are actually assigned. Not the
 * whole registry: enough that a typo like `eng-us` or `english` is caught, while an
 * unassigned but well-formed tag returns cantTell.
 */
const COMMON_LANGUAGES = new Set([
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
]);

export type LanguageVerdict = 'valid' | 'malformed' | 'unknown-subtag' | 'empty';

/** Classifies a language tag. Exported because three rules and the repair layer use it. */
export function classifyLanguageTag(raw: string): LanguageVerdict {
  const tag = normalise(raw);
  if (tag === '') return 'empty';
  const lower = tag.toLowerCase();
  if (IRREGULAR.has(lower)) return 'valid';
  if (!BCP47.test(tag)) return 'malformed';
  const primary = lower.split('-')[0] ?? '';
  if (COMMON_LANGUAGES.has(primary)) return 'valid';
  return 'unknown-subtag';
}

/** b5c3f8: the html element has a lang attribute. */
export const pageHasLang = defineRule({
  actId: 'b5c3f8',
  name: 'HTML page has lang attribute',
  successCriteria: ['3.1.1'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    // Scoped to HTML documents. An SVG document has a root that is not `html`, and the
    // ACT rule's inapplicable examples are exactly those, which is where axe reports a
    // false positive.
    const html = findFirst(document, 'html');
    return html === null ? [] : [{ element: html }];
  },
  expectation: ({ element }) => {
    const lang = attr(element, 'lang');
    if (lang === null) {
      return {
        outcome: 'failed',
        message:
          'The html element has no lang attribute, so assistive technology has to guess the ' +
          'language and will often pick the wrong voice.',
      };
    }
    if (normalise(lang) === '') {
      return {
        outcome: 'failed',
        message: 'The lang attribute is empty, which is the same as not declaring a language.',
      };
    }
    return { outcome: 'passed', message: `The page declares lang="${normalise(lang)}".` };
  },
});

/** bf051a: the page lang attribute has a valid language tag. */
export const pageLangValid = defineRule({
  actId: 'bf051a',
  name: 'HTML page lang attribute has valid language tag',
  successCriteria: ['3.1.1'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const html = findFirst(document, 'html');
    if (html === null) return [];
    const lang = attr(html, 'lang');
    // Applies only where there is a non-empty lang. A missing one is b5c3f8's business,
    // and reporting both for one defect is the double-counting routing exists to avoid.
    if (lang === null || normalise(lang) === '') return [];
    return [{ element: html }];
  },
  expectation: ({ element }) => {
    const lang = attr(element, 'lang') ?? '';
    switch (classifyLanguageTag(lang)) {
      case 'valid':
        return { outcome: 'passed', message: `lang="${normalise(lang)}" is a valid language tag.` };
      case 'malformed':
        return {
          outcome: 'failed',
          message: `lang="${normalise(lang)}" is not a well-formed BCP 47 language tag.`,
        };
      case 'unknown-subtag':
        return {
          outcome: 'cantTell',
          message:
            `lang="${normalise(lang)}" is well formed but its primary subtag is not one Marlo ` +
            'recognises. It may be a valid registered language Marlo does not know about, so ' +
            'this is not reported as a failure.',
        };
      case 'empty':
        return { outcome: 'inapplicable', message: 'No language declared.' };
    }
  },
});

/** de46e4: an element with a lang attribute has a valid language tag. */
export const elementLangValid = defineRule({
  actId: 'de46e4',
  name: 'Element with lang attribute has valid language tag',
  successCriteria: ['3.1.2'],
  requires: ['dom'],
  fixability: 'context-dependent',
  applicability: (document) => {
    const targets = [];
    for (const element of findAll(document, [
      'html',
      'body',
      'div',
      'span',
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'a',
      'em',
      'strong',
      'q',
      'blockquote',
      'li',
      'ul',
      'ol',
      'td',
      'th',
      'section',
      'article',
      'aside',
      'nav',
      'header',
      'footer',
      'main',
      'figure',
      'figcaption',
      'label',
      'button',
      'abbr',
      'cite',
      'code',
      'pre',
      'table',
    ])) {
      // The ACT rule excludes the html element itself, which bf051a covers, and excludes
      // elements with no text content because there is nothing to declare a language for.
      if (element.tag === 'html') continue;
      const lang = attr(element, 'lang');
      if (lang === null) continue;
      if (normalise(element.text) === '') continue;
      targets.push({ element });
    }
    return targets;
  },
  expectation: ({ element }) => {
    const lang = attr(element, 'lang') ?? '';
    switch (classifyLanguageTag(lang)) {
      case 'valid':
        return { outcome: 'passed', message: `lang="${normalise(lang)}" is a valid language tag.` };
      case 'empty':
        return {
          outcome: 'failed',
          message:
            'The lang attribute is empty. An empty lang on an element with text tells assistive ' +
            'technology nothing while looking like it does.',
        };
      case 'malformed':
        return {
          outcome: 'failed',
          message: `lang="${normalise(lang)}" is not a well-formed BCP 47 language tag.`,
        };
      case 'unknown-subtag':
        return {
          outcome: 'cantTell',
          message:
            `lang="${normalise(lang)}" is well formed but its primary subtag is not one Marlo ` +
            'recognises.',
        };
    }
  },
});

/** 5b7ae0: lang and xml:lang on the html element agree. */
export const langAndXmlLangMatch = defineRule({
  actId: '5b7ae0',
  name: 'HTML page lang and xml:lang attributes have matching values',
  successCriteria: ['3.1.1'],
  requires: ['dom'],
  fixability: 'auto',
  applicability: (document) => {
    const html = findFirst(document, 'html');
    if (html === null) return [];
    // Applies only when both are present. One alone is a different rule's business.
    const lang = attr(html, 'lang');
    const xmlLang = attr(html, 'xml:lang');
    if (lang === null || xmlLang === null) return [];
    if (normalise(lang) === '' || normalise(xmlLang) === '') return [];
    return [{ element: html }];
  },
  expectation: ({ element }) => {
    const lang = normalise(attr(element, 'lang') ?? '');
    const xmlLang = normalise(attr(element, 'xml:lang') ?? '');
    // Compared on the primary subtag, case-insensitively, which is what the ACT rule
    // requires: `en` and `en-GB` agree about the language.
    const primary = (tag: string): string => tag.toLowerCase().split('-')[0] ?? '';
    if (primary(lang) === primary(xmlLang)) {
      return { outcome: 'passed', message: `lang and xml:lang both declare "${primary(lang)}".` };
    }
    return {
      outcome: 'failed',
      message:
        `lang="${lang}" and xml:lang="${xmlLang}" declare different languages. Which one wins ` +
        'depends on how the document is served, so the two have to agree.',
    };
  },
});
