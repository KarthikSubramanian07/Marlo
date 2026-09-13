import { describe, expect, it } from 'vitest';
import { emailProblems, problems } from './check-signoff.mjs';

describe('check-signoff credit guards', () => {
  it('accepts a signed-off message with a linked email', () => {
    const message =
      'rules: implement b5c3f8\n\nSigned-off-by: Sai Sanjay Devi <107503943+dudeperson123@users.noreply.github.com>\n';
    expect(problems(message, 't')).toEqual([]);
  });

  it('rejects a missing sign-off', () => {
    expect(problems('rules: implement b5c3f8\n', 't').join('\n')).toMatch(/no Signed-off-by/);
  });

  it('rejects AI co-author trailers', () => {
    const message =
      'rules: implement b5c3f8\n\nCo-authored-by: Claude Sonnet 5 <noreply@anthropic.com>\nSigned-off-by: KarthikSubramanian07 <winnerkarthik07@gmail.com>\n';
    expect(problems(message, 't').join('\n')).toMatch(/AI Co-authored-by/);
  });

  it('rejects machine Author emails', () => {
    expect(emailProblems('SaiSanjayD@Sais-Macbook-Air.local', 't').join('\n')).toMatch(
      /will not link/,
    );
    expect(emailProblems('someone@MacBookAir.hsd1.ca.comcast.net', 't').join('\n')).toMatch(
      /will not link/,
    );
  });

  it('allows GitHub noreply and ordinary emails', () => {
    expect(emailProblems('107503943+dudeperson123@users.noreply.github.com', 't')).toEqual([]);
    expect(emailProblems('winnerkarthik07@gmail.com', 't')).toEqual([]);
  });
});
