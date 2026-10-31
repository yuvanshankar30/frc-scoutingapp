import katex from 'katex';

// A small, safe Markdown + LaTeX renderer for chat answers: headings, paragraphs, bold, italic, strikethrough,
// inline code, fenced code blocks, links, blockquotes, rules, bullet / numbered lists (one nested level),
// tables with alignment, $inline$ and $$display$$ math (KaTeX), and typographic symbols (-> >= <= != +/-).
//
// Safety: math and code are pulled out first, ALL remaining text is HTML-escaped, and only then is markup
// added, so model text (which can echo scout notes) cannot inject HTML. KaTeX runs with trust off. Links keep
// only http, https and mailto URLs.

const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const mark = (i) => `${i}`; // private-use placeholders survive escaping and inline formatting
const MARK = /(\d+)/g;

function math(tex, display) {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml'
    });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

/** Replace "a -> b", ">=", "<=", "!=", "+/-" and "..." with the symbols they stand for. Applied to text only. */
export function symbols(text) {
  return text
    .replace(/&lt;-&gt;/g, '↔')
    .replace(/-&gt;/g, '→')
    .replace(/&lt;-/g, '←')
    .replace(/&gt;=/g, '≥')
    .replace(/&lt;=/g, '≤')
    .replace(/!=/g, '≠')
    .replace(/\+\/-/g, '±')
    .replace(/(\d)\s?x\s?(\d)/g, '$1 × $2')
    .replace(/\.\.\./g, '…');
}

function safeUrl(escapedUrl) {
  if (/[\uE000-\uE003]/.test(escapedUrl)) return null;
  const url = escapedUrl.replace(/&amp;/g, '&');
  return /^(https?:\/\/|mailto:)/i.test(url) ? escapedUrl : null;
}

function inline(escaped) {
  const stash = [];
  const holdInline = (html) => {
    stash.push(html);
    return `${stash.length - 1}`;
  };
  // inline code first, so nothing inside it is formatted
  let out = escaped.replace(/`([^`\n]+)`/g, (_, code) => holdInline(`<code>${code}</code>`));
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    const ok = safeUrl(url);
    return ok ? holdInline(`<a href="${ok}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`) : label;
  });
  out = symbols(out)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*(?!\s)([^*\n]*[^*\s])\*(?!\*)/g, '$1<em>$2</em>');
  return out.replace(/(\d+)/g, (_, i) => stash[Number(i)]);
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const alignOf = (cell) =>
  /^:-+:$/.test(cell) ? 'center' : /-+:$/.test(cell) ? 'right' : /^:-+/.test(cell) ? 'left' : null;

export function renderMarkdown(source) {
  const placeholders = [];
  const hold = (html) => {
    placeholders.push(html);
    return mark(placeholders.length - 1);
  };

  // Drop the private-use characters used as placeholders, so input cannot forge one.
  let text = String(source ?? '')
    .replace(/[\uE000-\uE003]/g, '')
    .replace(/\r\n/g, '\n');
  // fenced code blocks
  text = text.replace(
    /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g,
    (_, lang, code) =>
      `\n${hold(`<pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`)}\n`
  );
  // math: display first, then inline. "$5 and $6" is money, not math: the opening $ must be followed by a
  // non-space and the closing $ preceded by one and not followed by a digit.
  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => `\n${hold(math(tex, true))}\n`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => `\n${hold(math(tex, true))}\n`)
    .replace(/\\\(([^\n]+?)\\\)/g, (_, tex) => hold(math(tex, false)))
    .replace(/(^|[^\\$\d])\$(?!\s)([^$\n]*[^$\s\\])\$(?!\d)/g, (_, pre, tex) => `${pre}${hold(math(tex, false))}`);

  const lines = escapeHtml(text).split('\n');
  const out = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }

    const standalone = line.trim().match(/^(\d+)$/);
    if (standalone) {
      flush();
      out.push(placeholders[Number(standalone[1])]);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }

    if (/^\s*&gt;\s?/.test(line)) {
      flush();
      const quote = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        quote.push(inline(lines[i].replace(/^\s*&gt;\s?/, '')));
        i += 1;
      }
      i -= 1;
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(alignOf);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      i -= 1;
      const cell = (tag, value, c) =>
        `<${tag}${aligns[c] ? ` style="text-align:${aligns[c]}"` : ''}>${inline(value || '')}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((h, c) => cell('th', h, c)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, c) => cell('td', r[c], c)).join('')}</tr>`).join('')}</tbody></table></div>`
      );
      continue;
    }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      // gather the whole list, allowing one level of nesting by indentation
      const entries = [];
      while (i < lines.length) {
        const m = lines[i].trimEnd().match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        entries.push({ depth: m[1].length >= 2 ? 1 : 0, ordered: /\d/.test(m[2]), html: inline(m[3]) });
        i += 1;
      }
      i -= 1;
      let html = '';
      let open = []; // stack of list tags
      entries.forEach((e, k) => {
        const tag = e.ordered ? 'ol' : 'ul';
        if (e.depth === 0) {
          while (open.length > 1) html += `</li></${open.pop()}>`;
          if (open.length === 1 && open[0] !== tag) {
            html += `</li></${open.pop()}>`;
          }
          if (!open.length) {
            html += `<${tag}>`;
            open.push(tag);
          } else html += '</li>';
          html += `<li>${e.html}`;
        } else {
          if (!open.length) {
            html += `<${tag}>`;
            open.push(tag);
            html += '<li>';
          }
          if (open.length === 1) {
            html += `<${tag}>`;
            open.push(tag);
          } else html += '</li>';
          html += `<li>${e.html}`;
        }
        if (k === entries.length - 1) while (open.length) html += `</li></${open.pop()}>`;
      });
      out.push(html);
      continue;
    }

    paragraph.push(inline(line));
  }
  flush();
  return out.join('').replace(MARK, (_, i) => placeholders[Number(i)] ?? '');
}
