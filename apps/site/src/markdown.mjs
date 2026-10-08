import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/** Convert the same content served to readers, preserving tables, links and examples. */
export function markdownForPage({ body, origin }) {
  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  converter.use(gfm);
  converter.remove(['svg', 'script', 'style', 'input', 'label']);
  converter.addRule('absoluteLinks', {
    filter: 'a',
    replacement(content, node) {
      const href = node.getAttribute('href');
      if (!href) return content;
      return `[${content}](${new URL(href, origin).href})`;
    },
  });
  return `${converter.turndown(body)}\n`;
}
