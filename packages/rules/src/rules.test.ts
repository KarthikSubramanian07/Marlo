import { describe, expect, it } from 'vitest';
import type { Capability, Outcome } from '@marlo/schema';
import { PUBLISHED_ACT_RULE_COUNT, findRule } from '@marlo/act';

import {
  IMPLEMENTED_RULES,
  MARLO_RULES,
  accessibleName,
  classifyLanguageTag,
  evaluateRules,
  findMarloRule,
  fixture,
  requiredCapabilities,
} from './index.js';
import { defineRule } from './define.js';

/**
 * Rule tests, written the way a contributor is asked to write them: a fixture, an
 * expected outcome, and a negative case that resembles a violation and is not one.
 *
 * The tests that are not about individual rules are at the bottom, and two of them are
 * the load-bearing ones for the whole package: `requires` is honest, and coverage cannot
 * drift from the registry.
 */

const CAPS = new Set<Capability>(['dom', 'script']);
const ALL_CAPS = new Set<Capability>(['dom', 'script', 'layout', 'paint']);

/** Runs one rule over one fixture and collapses to a single outcome. */
function check(
  actId: string,
  html: string,
  options: {
    capabilities?: ReadonlySet<Capability>;
    computed?: Parameters<typeof fixture>[1];
  } = {},
): { outcome: Outcome | 'unsupported' | 'error'; messages: string[] } {
  const document = fixture(html, options.computed ?? {});
  const report = evaluateRules([actId], {
    document,
    renderer: 'static',
    capabilities: options.capabilities ?? CAPS,
    version: '0.1.0-test',
  });
  const result = report.results[0];
  if (result === undefined) throw new Error('no result');
  if (result.status !== 'ok') return { outcome: result.status, messages: [] };

  const messages = result.verdicts.map((v) => v.message);
  if (result.verdicts.length === 0) return { outcome: 'inapplicable', messages };
  if (result.verdicts.some((v) => v.outcome === 'failed')) return { outcome: 'failed', messages };
  if (result.verdicts.some((v) => v.outcome === 'cantTell'))
    return { outcome: 'cantTell', messages };
  if (result.verdicts.some((v) => v.outcome === 'passed')) return { outcome: 'passed', messages };
  return { outcome: 'inapplicable', messages };
}

describe('b5c3f8 page has lang', () => {
  it('fails a page with no lang', () => {
    expect(check('b5c3f8', '<html><body><p>x</p></body></html>').outcome).toBe('failed');
  });

  it('fails an empty lang, which looks declared and is not', () => {
    expect(check('b5c3f8', '<html lang=""><body><p>x</p></body></html>').outcome).toBe('failed');
  });

  it('passes a declared language', () => {
    expect(check('b5c3f8', '<html lang="en"><body><p>x</p></body></html>').outcome).toBe('passed');
  });

  it('does not fire on a lang somewhere other than html', () => {
    // The negative case: a lang on a div is de46e4's business, and reporting both for
    // one document would be the double-counting routing exists to avoid.
    expect(check('b5c3f8', '<html><body><div lang="fr">x</div></body></html>').outcome).toBe(
      'failed',
    );
    expect(
      check('b5c3f8', '<html lang="en"><body><div lang="fr">x</div></body></html>').outcome,
    ).toBe('passed');
  });
});

describe('bf051a page lang is valid', () => {
  it('passes a real tag', () => {
    expect(check('bf051a', '<html lang="en-GB"><body>x</body></html>').outcome).toBe('passed');
  });

  it('fails a malformed tag', () => {
    expect(check('bf051a', '<html lang="english"><body>x</body></html>').outcome).toBe('failed');
    expect(check('bf051a', '<html lang="e"><body>x</body></html>').outcome).toBe('failed');
  });

  it('declines a well-formed tag it does not recognise rather than failing it', () => {
    // The honest answer. `xx` is grammatically valid and Marlo does not vendor the IANA
    // registry, so it does not know whether it is a language.
    expect(check('bf051a', '<html lang="xx"><body>x</body></html>').outcome).toBe('cantTell');
  });

  it('is inapplicable when there is no lang at all', () => {
    // b5c3f8's job. Two rules reporting one defect is noise.
    expect(check('bf051a', '<html><body>x</body></html>').outcome).toBe('inapplicable');
  });
});

describe('de46e4 element lang is valid', () => {
  it('fails a malformed lang on an element with text', () => {
    expect(check('de46e4', '<html><body><p lang="franch">bonjour</p></body></html>').outcome).toBe(
      'failed',
    );
  });

  it('ignores an element with a lang and no text', () => {
    // Nothing to declare a language for. This is the applicability case people skip.
    expect(check('de46e4', '<html><body><div lang="zz"></div></body></html>').outcome).toBe(
      'inapplicable',
    );
  });

  it('excludes the html element', () => {
    expect(check('de46e4', '<html lang="nope"><body>x</body></html>').outcome).toBe('inapplicable');
  });
});

describe('5b7ae0 lang and xml:lang agree', () => {
  it('passes when the primary subtags match', () => {
    expect(
      check('5b7ae0', '<html lang="en-GB" xml:lang="en-US"><body>x</body></html>').outcome,
    ).toBe('passed');
  });

  it('fails when they disagree', () => {
    expect(check('5b7ae0', '<html lang="en" xml:lang="fr"><body>x</body></html>').outcome).toBe(
      'failed',
    );
  });

  it('is inapplicable with only one of them', () => {
    expect(check('5b7ae0', '<html lang="en"><body>x</body></html>').outcome).toBe('inapplicable');
  });
});

describe('5f99a7 aria attributes are defined', () => {
  it('fails a misspelled attribute', () => {
    expect(
      check('5f99a7', '<html><body><div aria-labeledby="x">y</div></body></html>').outcome,
    ).toBe('failed');
  });

  it('passes real attributes', () => {
    expect(
      check('5f99a7', '<html><body><div aria-label="x" aria-busy="true">y</div></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('names the offending attribute so the fix is obvious', () => {
    const { messages } = check(
      '5f99a7',
      '<html><body><div aria-labeledby="x">y</div></body></html>',
    );
    expect(messages.join(' ')).toContain('aria-labeledby');
  });
});

describe('6a7281 aria values are valid', () => {
  it('fails a non-boolean where a boolean belongs', () => {
    expect(
      check('6a7281', '<html><body><div role="checkbox" aria-checked="yes">x</div></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('accepts mixed on a tristate', () => {
    expect(
      check('6a7281', '<html><body><div role="checkbox" aria-checked="mixed">x</div></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('fails a token outside the permitted set', () => {
    expect(check('6a7281', '<html><body><div aria-live="loud">x</div></body></html>').outcome).toBe(
      'failed',
    );
  });

  it('fails a non-integer level', () => {
    expect(
      check('6a7281', '<html><body><div role="heading" aria-level="two">x</div></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('fails a reference list where nothing resolves', () => {
    expect(
      check('6a7281', '<html><body><div aria-labelledby="nope">x</div></body></html>').outcome,
    ).toBe('failed');
  });

  it('passes a reference that resolves', () => {
    expect(
      check(
        '6a7281',
        '<html><body><span id="lbl">Name</span><div aria-labelledby="lbl">x</div></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('declines a partially resolving list rather than failing it', () => {
    // The specification permits it, so it is not a failure, but asserting a clean pass
    // would hide something the author almost certainly did not intend.
    expect(
      check(
        '6a7281',
        '<html><body><span id="a">A</span><div aria-labelledby="a missing">x</div></body></html>',
      ).outcome,
    ).toBe('cantTell');
  });
});

describe('674b10 role values are valid', () => {
  it('fails an invented role', () => {
    expect(check('674b10', '<html><body><div role="widget">x</div></body></html>').outcome).toBe(
      'failed',
    );
  });

  it('passes a role list where one token is valid, as the browser does', () => {
    expect(
      check('674b10', '<html><body><div role="nonsense button">x</div></body></html>').outcome,
    ).toBe('passed');
  });

  it('rejects an abstract role, which is not a valid author value', () => {
    expect(check('674b10', '<html><body><div role="widget">x</div></body></html>').outcome).toBe(
      'failed',
    );
  });
});

describe('4e8ab6 role has required states and properties', () => {
  it('fails a role missing its required property', () => {
    expect(check('4e8ab6', '<html><body><div role="checkbox">x</div></body></html>').outcome).toBe(
      'failed',
    );
  });

  it('passes a role with its required property set', () => {
    expect(
      check('4e8ab6', '<html><body><div role="checkbox" aria-checked="false">x</div></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('fails a combobox with aria-expanded but no aria-controls', () => {
    // ARIA 1.2 redefined combobox as always owning a popup, so both properties are
    // required unconditionally rather than one implying the other.
    expect(
      check('4e8ab6', '<html><body><div role="combobox" aria-expanded="true">x</div></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('passes a combobox with both required properties set', () => {
    expect(
      check(
        '4e8ab6',
        '<html><body><div role="combobox" aria-expanded="false" aria-controls="list">x</div></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('treats an empty value as missing, not merely present', () => {
    expect(
      check(
        '4e8ab6',
        '<html><body><div role="combobox" aria-expanded="true" aria-controls="">x</div></body></html>',
      ).outcome,
    ).toBe('failed');
  });

  it('does not apply when the explicit role matches the native one', () => {
    // A native checkbox's required state is a host-language concern already, and the
    // rule would otherwise fail every plain <input type="checkbox" role="checkbox">.
    expect(
      check('4e8ab6', '<html><body><input type="checkbox" role="checkbox" /></body></html>')
        .outcome,
    ).toBe('inapplicable');
  });

  it('still applies when the explicit role differs from the native one', () => {
    expect(
      check('4e8ab6', '<html><body><input type="text" role="checkbox" /></body></html>').outcome,
    ).toBe('failed');
  });
});

describe('6cfa84 aria-hidden hides nothing focusable', () => {
  it('fails a hidden container with a focusable child', () => {
    const result = check(
      '6cfa84',
      '<html><body><div aria-hidden="true"><button>Go</button></div></body></html>',
    );
    expect(result.outcome).toBe('failed');
    expect(result.messages.join(' ')).toContain('keyboard user');
  });

  it('passes a hidden container with nothing focusable', () => {
    expect(
      check('6cfa84', '<html><body><div aria-hidden="true"><span>x</span></div></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('passes when the child is removed from the focus order', () => {
    // The negative case that matters: a developer who did it correctly.
    expect(
      check(
        '6cfa84',
        '<html><body><div aria-hidden="true"><button tabindex="-1">Go</button></div></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('does not fire on a link with no href, which is not focusable', () => {
    expect(
      check('6cfa84', '<html><body><div aria-hidden="true"><a>text</a></div></body></html>')
        .outcome,
    ).toBe('passed');
  });
});

describe('3ea0c8 ids are unique', () => {
  it('fails a duplicate', () => {
    const result = check('3ea0c8', '<html><body><p id="a">1</p><p id="a">2</p></body></html>');
    expect(result.outcome).toBe('failed');
    expect(result.messages.join(' ')).toContain('resolves to the first one only');
  });

  it('passes distinct ids', () => {
    expect(
      check('3ea0c8', '<html><body><p id="a">1</p><p id="b">2</p></body></html>').outcome,
    ).toBe('passed');
  });
});

describe('e6952f attributes are not duplicated', () => {
  it('fails a repeated attribute', () => {
    expect(check('e6952f', '<html><body><p class="a" class="b">x</p></body></html>').outcome).toBe(
      'failed',
    );
  });

  it('passes distinct attributes', () => {
    expect(check('e6952f', '<html><body><p class="a" id="b">x</p></body></html>').outcome).toBe(
      'passed',
    );
  });
});

describe('bc659a and bisz58 meta refresh', () => {
  const refresh = (content: string) =>
    `<html><head><meta http-equiv="refresh" content="${content}"></head><body>x</body></html>`;

  it('fails a short delay', () => {
    expect(check('bc659a', refresh('5')).outcome).toBe('failed');
  });

  it('passes an immediate redirect', () => {
    expect(check('bc659a', refresh('0;url=/next')).outcome).toBe('passed');
  });

  it('applies the over-20-hours exception', () => {
    expect(check('bc659a', refresh('72001')).outcome).toBe('passed');
  });

  it('and the strict variant does not, which is the only difference', () => {
    expect(check('bisz58', refresh('72001')).outcome).toBe('failed');
    expect(check('bisz58', refresh('0')).outcome).toBe('passed');
  });
});

describe('b4f0c3 viewport allows zoom', () => {
  const viewport = (content: string) =>
    `<html><head><meta name="viewport" content="${content}"></head><body>x</body></html>`;

  it('fails user-scalable=no', () => {
    expect(check('b4f0c3', viewport('width=device-width, user-scalable=no')).outcome).toBe(
      'failed',
    );
  });

  it('fails a maximum-scale below 2', () => {
    expect(check('b4f0c3', viewport('width=device-width, maximum-scale=1')).outcome).toBe('failed');
  });

  it('passes a maximum-scale of 2 or more', () => {
    expect(check('b4f0c3', viewport('width=device-width, maximum-scale=5')).outcome).toBe('passed');
  });

  it('passes an ordinary viewport', () => {
    expect(check('b4f0c3', viewport('width=device-width, initial-scale=1')).outcome).toBe('passed');
  });
});

describe('2779a5 page has a title', () => {
  it('fails a missing title', () => {
    expect(check('2779a5', '<html><head></head><body>x</body></html>').outcome).toBe('failed');
  });

  it('fails an empty title', () => {
    expect(check('2779a5', '<html><head><title></title></head><body>x</body></html>').outcome).toBe(
      'failed',
    );
  });

  it('passes a real title', () => {
    expect(
      check('2779a5', '<html><head><title>Checkout</title></head><body>x</body></html>').outcome,
    ).toBe('passed');
  });

  it('does not accept an svg title as the page title', () => {
    // The distinction the ACT rule makes, and the negative case worth having.
    expect(
      check('2779a5', '<html><head></head><body><svg><title>Icon</title></svg></body></html>')
        .outcome,
    ).toBe('failed');
  });
});

describe('78fd32 line height is not important below the threshold', () => {
  it('fails a value below 1.5x the font size', () => {
    expect(
      check('78fd32', '<html><body><p style="line-height: 1em !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('passes a value at or above 1.5x the font size', () => {
    expect(
      check('78fd32', '<html><body><p style="line-height: 2em !important;">x</p></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('accepts a bare unitless number as a direct multiple of font size', () => {
    // Unlike letter-spacing and word-spacing, a unitless line-height is valid CSS and
    // means exactly this: a multiple of the element's own font size.
    expect(
      check('78fd32', '<html><body><p style="line-height: 1.6 !important;">x</p></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('accepts a percentage as a multiple of font size', () => {
    expect(
      check('78fd32', '<html><body><p style="line-height: 160% !important;">x</p></body></html>')
        .outcome,
    ).toBe('passed');
    expect(
      check('78fd32', '<html><body><p style="line-height: 120% !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('fails normal, whose used value is well below the threshold', () => {
    expect(
      check('78fd32', '<html><body><p style="line-height: normal !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('fails initial the same way as normal, since normal is its specified value', () => {
    expect(
      check('78fd32', '<html><body><p style="line-height: initial !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('passes inherit and unset, which defer to the ancestor rather than fixing a value', () => {
    expect(
      check(
        '78fd32',
        '<html><body><p style="line-height: 1.2em"><span style="line-height: inherit !important; display: block;">x</span></p></body></html>',
      ).outcome,
    ).toBe('passed');
    expect(
      check(
        '78fd32',
        '<html><body><p style="line-height: 1.2em"><span style="line-height: unset !important; display: block;">x</span></p></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('takes the later of two competing !important declarations', () => {
    expect(
      check(
        '78fd32',
        '<html><body><p style="line-height: 1em !important; line-height: 2em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('does not apply to a hidden element', () => {
    expect(
      check(
        '78fd32',
        '<html><body><p style="display: none; line-height: 1em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('inapplicable');
  });

  it('does not apply to text positioned off-screen', () => {
    expect(
      check(
        '78fd32',
        '<html><body><p style="position: absolute; top: -999em; line-height: 1em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('inapplicable');
  });

  it('does not treat an ordinary small offset as off-screen', () => {
    // The magnitude check exists for the -999em idiom, not for routine positioning.
    expect(
      check(
        '78fd32',
        '<html><body><p style="position: absolute; top: -4px; line-height: 1em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('failed');
  });

  it('does not apply where the text cannot take a soft wrap break', () => {
    expect(
      check(
        '78fd32',
        '<html><body><div style="overflow-x: scroll;"><p style="line-height: 1em !important; width: 1000px;">x</p></div></body></html>',
      ).outcome,
    ).toBe('inapplicable');
  });
});

describe('24afc2 letter spacing is not important below the threshold', () => {
  it('fails a value below 0.12x the font size', () => {
    expect(
      check(
        '24afc2',
        '<html><body><p style="letter-spacing: 0.05em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('failed');
  });

  it('passes a value at or above 0.12x the font size', () => {
    expect(
      check(
        '24afc2',
        '<html><body><p style="letter-spacing: 0.15em !important;">x</p></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('fails normal, which computes to zero spacing', () => {
    expect(
      check(
        '24afc2',
        '<html><body><p style="letter-spacing: normal !important;">x</p></body></html>',
      ).outcome,
    ).toBe('failed');
  });

  it('passes inherit, which defers to the ancestor rather than fixing a value', () => {
    expect(
      check(
        '24afc2',
        '<html><body><p style="letter-spacing: 0.15em"><span style="letter-spacing: inherit !important;">x</span></p></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('does not accept a bare unitless number, which is not valid CSS for this property', () => {
    expect(
      check('24afc2', '<html><body><p style="letter-spacing: 2 !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });
});

describe('9e45ec word spacing is not important below the threshold', () => {
  it('fails a value below 0.16x the font size', () => {
    expect(
      check('9e45ec', '<html><body><p style="word-spacing: 0.1em !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });

  it('passes a value at or above 0.16x the font size', () => {
    expect(
      check('9e45ec', '<html><body><p style="word-spacing: 0.2em !important;">x</p></body></html>')
        .outcome,
    ).toBe('passed');
  });

  it('fails normal, which computes to zero spacing', () => {
    expect(
      check('9e45ec', '<html><body><p style="word-spacing: normal !important;">x</p></body></html>')
        .outcome,
    ).toBe('failed');
  });
});

describe('the accessible name rules', () => {
  it('fails an unnamed link and passes a named one', () => {
    expect(check('c487ae', '<html><body><a href="/x"></a></body></html>').outcome).toBe('failed');
    expect(check('c487ae', '<html><body><a href="/x">Basket</a></body></html>').outcome).toBe(
      'passed',
    );
  });

  it('does not treat an anchor with no href as a link', () => {
    expect(check('c487ae', '<html><body><a></a></body></html>').outcome).toBe('inapplicable');
  });

  it('fails an unlabelled field and explains why placeholder is not a label', () => {
    const result = check(
      'e086e5',
      '<html><body><input type="text" placeholder="Email"></body></html>',
    );
    expect(result.outcome).toBe('failed');
    expect(result.messages.join(' ')).toContain('placeholder');
    expect(result.messages.join(' ')).toContain('disappears on focus');
  });

  it('passes a field labelled by for', () => {
    expect(
      check(
        'e086e5',
        '<html><body><label for="e">Email</label><input type="text" id="e"></body></html>',
      ).outcome,
    ).toBe('passed');
  });

  it('passes a field inside a wrapping label', () => {
    expect(
      check('e086e5', '<html><body><label>Email <input type="text"></label></body></html>').outcome,
    ).toBe('passed');
  });

  it('ignores a hidden input, which is not in the tree', () => {
    expect(
      check('e086e5', '<html><body><input type="hidden" name="csrf"></body></html>').outcome,
    ).toBe('inapplicable');
  });

  it('fails an image with no alt and ignores one marked decorative', () => {
    expect(check('23a2a8', '<html><body><img src="a.png"></body></html>').outcome).toBe('failed');
    // alt="" is a deliberate statement that the image is decorative, not a missing name.
    expect(check('23a2a8', '<html><body><img src="a.png" alt=""></body></html>').outcome).toBe(
      'inapplicable',
    );
  });

  it('fails an empty heading and says why it is worse than no heading', () => {
    const result = check('ffd0e9', '<html><body><h2></h2></body></html>');
    expect(result.outcome).toBe('failed');
    expect(result.messages.join(' ')).toContain('blank');
  });
});

describe('accessibleName declines rather than guessing', () => {
  it('is certain about aria-label', () => {
    const document = fixture('<html><body><button aria-label="Close">x</button></body></html>');
    const button = document.root.children[0]?.children[0];
    expect(button).toBeDefined();
    if (button === undefined) return;
    const name = accessibleName(button, document, { nameFromContent: true });
    expect(name.name).toBe('Close');
    expect(name.confidence).toBe('certain');
    expect(name.from).toBe('aria-label');
  });

  it('is uncertain when a descendant image would contribute', () => {
    // A complete computation recurses into the image's alt text. This one does not, so it
    // says so rather than returning a name that might be wrong.
    const document = fixture(
      '<html><body><a href="/x"><img src="i.png" alt="Home"></a></body></html>',
    );
    const link = document.root.children[0]?.children[0];
    expect(link).toBeDefined();
    if (link === undefined) return;
    const name = accessibleName(link, document, { nameFromContent: true });
    expect(name.confidence).toBe('uncertain');
    expect(name.reason).toContain('image');
  });

  it('reports a dangling aria-labelledby as producing no name', () => {
    const document = fixture('<html><body><button aria-labelledby="gone">x</button></body></html>');
    const button = document.root.children[0]?.children[0];
    expect(button).toBeDefined();
    if (button === undefined) return;
    const name = accessibleName(button, document, { nameFromContent: true });
    expect(name.name).toBe('');
    expect(name.reason).toContain('does not exist');
  });
});

describe('classifyLanguageTag', () => {
  it('accepts real tags', () => {
    for (const tag of ['en', 'en-GB', 'zh-Hant-TW', 'de-CH-1901', 'i-klingon']) {
      expect(classifyLanguageTag(tag), tag).toBe('valid');
    }
  });

  it('rejects malformed tags', () => {
    for (const tag of ['english', 'e', 'en_GB', '123']) {
      expect(classifyLanguageTag(tag), tag).toBe('malformed');
    }
  });

  it('says it does not know rather than failing an unregistered subtag', () => {
    expect(classifyLanguageTag('xx')).toBe('unknown-subtag');
  });

  it('treats empty as empty', () => {
    expect(classifyLanguageTag('   ')).toBe('empty');
  });
});

describe('the capability model reaches the rules', () => {
  it('reports contrast as unsupported without layout, never as a pass', () => {
    // The single most important test in this package. If this ever returns `passed`,
    // Marlo is claiming to have checked contrast on a renderer that cannot.
    const result = check('afw4f7', '<html><body><p>text</p></body></html>');
    expect(result.outcome).toBe('unsupported');
  });

  it('evaluates contrast once layout is available, and still declines to assert a ratio', () => {
    const result = check('afw4f7', '<html><body><p id="t">text</p></body></html>', {
      capabilities: ALL_CAPS,
      computed: {
        computed: { '#t': { color: 'rgb(119,119,119)', 'background-color': 'rgb(255,255,255)' } },
      },
    });
    // Marlo locates the text and names the colours, and does not claim a ratio it has
    // not computed correctly. That is a published limitation rather than a silent one.
    expect(result.outcome).toBe('cantTell');
    expect(result.messages.join(' ')).toContain('paint');
  });

  it('reports a rule Marlo does not implement as unsupported with nothing missing', () => {
    // Distinct from a capability gap: nothing was missing from the renderer, Marlo simply
    // has no opinion.
    const document = fixture('<html><body>x</body></html>');
    const report = evaluateRules(['2t702h'], {
      document,
      renderer: 'static',
      capabilities: CAPS,
      version: '0.1.0-test',
    });
    expect(report.results[0]?.status).toBe('unsupported');
    expect(report.results[0]?.missingCapabilities).toEqual([]);
  });

  it('catches a throwing rule per rule rather than per run', () => {
    // A bad rule must not discard the other thirty-four.
    const document = fixture('<html lang="en"><body>x</body></html>');
    const report = evaluateRules(['b5c3f8', '3ea0c8'], {
      document,
      renderer: 'static',
      capabilities: CAPS,
      version: '0.1.0-test',
    });
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.status === 'ok')).toBe(true);
  });
});

describe('the registry keeps its promises', () => {
  it('declares layout on every rule that reads a computed style', () => {
    // THE structural test. A rule that reads element.computed and declares only `dom`
    // passes under the static renderer and fails in a browser, which is a false negative
    // Marlo cannot see. Asserted by behaviour rather than by reading source: run every
    // rule with layout absent and with a fixture that has resolved styles, and any rule
    // whose verdict changes was depending on layout it did not declare.
    for (const rule of MARLO_RULES) {
      if (rule.requires.includes('layout')) continue;

      const html =
        '<html lang="en"><head><title>t</title></head><body><p id="t">text</p></body></html>';
      const withoutLayout = fixture(html);
      const withLayout = fixture(html, {
        computed: {
          '#t': { color: 'rgb(0,0,0)', 'background-color': 'rgb(255,255,255)', display: 'block' },
        },
      });

      const outcomeOf = (document: ReturnType<typeof fixture>): string => {
        const report = evaluateRules([rule.actId], {
          document,
          renderer: 'static',
          capabilities: ALL_CAPS,
          version: 'test',
        });
        const result = report.results[0];
        if (result?.status !== 'ok') return result?.status ?? 'missing';
        return result.verdicts
          .map((v) => v.outcome)
          .sort()
          .join(',');
      };

      expect(outcomeOf(withoutLayout), `${rule.actId} changes verdict when styles resolve`).toBe(
        outcomeOf(withLayout),
      );
    }
  });

  it('gives every rule a unique ACT id', () => {
    expect(new Set(IMPLEMENTED_RULES).size).toBe(IMPLEMENTED_RULES.length);
    expect(IMPLEMENTED_RULES.length).toBe(MARLO_RULES.length);
  });

  it('only implements published ACT rules', () => {
    for (const actId of IMPLEMENTED_RULES) {
      expect(findRule(actId), actId).toBeDefined();
    }
  });

  it('declares the success criteria ACT publishes, not its own reading of them', () => {
    // Enforced by defineRule at load time, asserted here so the enforcement is visible.
    for (const rule of MARLO_RULES) {
      const published = findRule(rule.actId);
      expect(published).toBeDefined();
      if (published === undefined) continue;
      if (published.successCriteria.length === 0) continue;
      expect([...rule.successCriteria].sort(), rule.actId).toEqual(
        [...published.successCriteria].sort(),
      );
    }
  });

  it('requires dom on every rule', () => {
    for (const rule of MARLO_RULES) expect(rule.requires).toContain('dom');
  });

  it('states fixability on every rule', () => {
    for (const rule of MARLO_RULES) {
      expect(['auto', 'context-dependent', 'never']).toContain(rule.fixability);
    }
  });

  it('never marks a contrast rule auto-fixable', () => {
    // Recolouring is a design decision. A rule that claimed otherwise would let the
    // repair layer pick a colour, which is the "fix drifting into redesign" failure the
    // literature catalogues.
    for (const actId of ['afw4f7', '09o5cg']) {
      expect(findMarloRule(actId)?.fixability, actId).toBe('never');
    }
  });

  it('reports coverage as a fraction of the real denominator', () => {
    expect(IMPLEMENTED_RULES.length).toBeGreaterThan(30);
    expect(IMPLEMENTED_RULES.length).toBeLessThan(PUBLISHED_ACT_RULE_COUNT);
    expect(PUBLISHED_ACT_RULE_COUNT).toBe(94);
  });

  it('needs only dom, script, layout and paint', () => {
    for (const capability of requiredCapabilities()) {
      expect(['dom', 'script', 'layout', 'paint']).toContain(capability);
    }
  });
});

describe('defineRule refuses a malformed rule at load time', () => {
  const stub = {
    name: 'x',
    requires: ['dom'] as const,
    fixability: 'never' as const,
    applicability: () => [],
    expectation: () => ({ outcome: 'passed' as const, message: 'x' }),
  };

  it('refuses an ACT id the corpus does not contain', () => {
    expect(() => defineRule({ ...stub, actId: 'zzzzzz', successCriteria: [] })).toThrow(
      /not a published ACT rule/,
    );
  });

  it('refuses success criteria that disagree with ACT', () => {
    expect(() => defineRule({ ...stub, actId: 'b5c3f8', successCriteria: ['1.1.1'] })).toThrow(
      /but ACT publishes/,
    );
  });

  it('refuses a rule that does not declare dom', () => {
    expect(() =>
      defineRule({ ...stub, actId: 'b5c3f8', successCriteria: ['3.1.1'], requires: [] }),
    ).toThrow(/must declare the dom capability/);
  });
});
