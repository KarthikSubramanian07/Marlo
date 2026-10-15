/**
 * Where the playground's markup comes from: a web address, a GitHub repository, or a paste.
 *
 * Pure functions only, so the parsing and the choice of files are unit tested without a
 * browser. The network calls live in playground.mjs.
 */

/** The most HTML files a repository check opens, so a large repository stays a quick look. */
export const REPO_FILE_LIMIT = 25;

const SKIP_DIRS =
  /(^|\/)(node_modules|vendor|bower_components|\.git|coverage|test|tests|__tests__|fixtures?)\//i;

/** Classifies what was typed into the address box. */
export function classifyInput(raw) {
  const text = raw.trim();
  if (text === '') return { kind: 'empty' };
  if (/^\s*</.test(text)) return { kind: 'html' };
  const github =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/tree\/([^/\s?#]+)(?:\/([^\s?#]*))?)?\/?(?:[?#].*)?$/i.exec(
      text,
    );
  if (github !== null) {
    return {
      kind: 'repo',
      owner: github[1],
      repo: github[2],
      ref: github[3] ?? null,
      path: (github[4] ?? '').replace(/\/+$/, ''),
    };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.'))
      return { kind: 'invalid', reason: 'That does not look like a web address.' };
    return { kind: 'url', url: url.href };
  } catch {
    return { kind: 'invalid', reason: 'That does not look like a web address.' };
  }
}

/**
 * The HTML files worth checking in a repository tree, best first: under the requested
 * folder, outside dependency and test folders, shallow before deep, index pages first.
 */
export function pickHtmlFiles(tree, folder = '') {
  const prefix = folder === '' ? '' : `${folder}/`;
  const files = tree
    .filter((entry) => entry.type === 'blob' && /\.html?$/i.test(entry.path))
    .filter((entry) => entry.path.startsWith(prefix))
    .filter((entry) => !SKIP_DIRS.test(entry.path.slice(prefix.length)))
    .map((entry) => entry.path);
  const depth = (p) => p.split('/').length;
  const isIndex = (p) => /(^|\/)index\.html?$/i.test(p);
  files.sort(
    (a, b) => depth(a) - depth(b) || Number(isIndex(b)) - Number(isIndex(a)) || a.localeCompare(b),
  );
  return { files: files.slice(0, REPO_FILE_LIMIT), total: files.length };
}

/** The charset a Content-Type header declares, or utf-8. */
export function charsetOf(contentType) {
  const match = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '');
  return match === null ? 'utf-8' : match[1].toLowerCase();
}

/**
 * Inserts `<base href>` after the doctype, so relative URLs resolve where the page expects
 * and a page that declares a doctype keeps standards mode. A page with its own base keeps it.
 */
export function withBase(html, href) {
  if (/<base\b/i.test(html)) return html;
  const base = `<base href="${href.replace(/"/g, '%22')}">`;
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype === null) return `${base}${html}`;
  return `${doctype[0]}${base}${html.slice(doctype[0].length)}`;
}

/**
 * True when a page has almost no text but does have scripts: it builds itself in the
 * browser, and the playground, which runs no page script, has little to check.
 */
export function looksScriptRendered(html, bodyText) {
  return bodyText.replace(/\s+/g, ' ').trim().length < 120 && /<script\b/i.test(html);
}
