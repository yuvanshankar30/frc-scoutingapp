import { describe, expect, it } from 'vitest';
import { renderMarkdown, symbols } from './miniMarkdown.js';

describe('basic Markdown', () => {
  it('renders bold, italic, strikethrough, code and paragraphs', () => {
    expect(renderMarkdown('**5940** scores *most* with `avg` 25')).toBe(
      '<p><strong>5940</strong> scores <em>most</em> with <code>avg</code> 25</p>'
    );
    expect(renderMarkdown('~~old~~ new')).toBe('<p><del>old</del> new</p>');
    expect(renderMarkdown('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
  });
  it('renders headings, rules and quotes', () => {
    expect(renderMarkdown('# Top\n### Detail')).toBe('<h2>Top</h2><h4>Detail</h4>');
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p><hr><p>b</p>');
    expect(renderMarkdown('> note one\n> note two')).toBe('<blockquote>note one<br>note two</blockquote>');
  });
  it('does not italicise a multiplication sign', () => {
    expect(renderMarkdown('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('**open')).toBe('<p>**open</p>');
  });
});

describe('lists', () => {
  it('renders bullet and numbered lists and closes them', () => {
    expect(renderMarkdown('- a\n- **b**\n\nafter')).toBe('<ul><li>a</li><li><strong>b</strong></li></ul><p>after</p>');
    expect(renderMarkdown('1. x\n2. y')).toBe('<ol><li>x</li><li>y</li></ol>');
  });
  it('renders one level of nesting', () => {
    expect(renderMarkdown('- a\n  - a1\n  - a2\n- b')).toBe(
      '<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'
    );
  });
  it('switches between list types', () => {
    expect(renderMarkdown('* a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });
  it('renders the ranked-teams style answer', () => {
    const html = renderMarkdown('1. **4414** – **307.5** avg (10 matches)\n2. **6800** – **275.0** avg');
    expect(html).toBe(
      '<ol><li><strong>4414</strong> – <strong>307.5</strong> avg (10 matches)</li><li><strong>6800</strong> – <strong>275.0</strong> avg</li></ol>'
    );
  });
});

describe('tables', () => {
  it('renders a table with alignment', () => {
    const html = renderMarkdown('| Team | Balls |\n|:--|--:|\n| 5940 | 25 |\n| 254 | **10** |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th style="text-align:left">Team</th>');
    expect(html).toContain('<th style="text-align:right">Balls</th>');
    expect(html).toContain('<td style="text-align:right"><strong>10</strong></td>');
    expect(html.match(/<tr>/g)).toHaveLength(3);
  });
  it('pads short rows', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 |')).toContain('<td></td>');
  });
});

describe('code blocks', () => {
  it('renders fenced code verbatim and escaped, without formatting inside', () => {
    const html = renderMarkdown('```js\nconst a = "**x**" < 2;\n```');
    expect(html).toBe('<pre><code class="lang-js">const a = &quot;**x**&quot; &lt; 2;</code></pre>');
  });
});

describe('math', () => {
  it('renders inline and display LaTeX with KaTeX', () => {
    const inline = renderMarkdown('Accuracy is $\\frac{scored}{shots}$ overall.');
    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain('$');
    const display = renderMarkdown('$$\\sum_{i=1}^{n} x_i$$');
    expect(display).toContain('katex-display');
    expect(renderMarkdown('\\(a^2\\) and \\[b^2\\]')).toContain('katex');
  });
  it('treats money as money, not math', () => {
    expect(renderMarkdown('It costs $5 and $6 total')).toBe('<p>It costs $5 and $6 total</p>');
  });
  it('does not format Markdown characters inside math', () => {
    const html = renderMarkdown('$a*b*c$');
    expect(html).toContain('katex');
    expect(html).not.toContain('<em>');
  });
  it('survives broken LaTeX without throwing', () => {
    expect(() => renderMarkdown('$\\frac{1$ and $$\\notacommand{$$')).not.toThrow();
  });
});

describe('symbols', () => {
  it('replaces ASCII stand-ins with the symbols', () => {
    expect(symbols('a -&gt; b &gt;= 3 &lt;= 4 != 5 +/- 1 ... 2 x 3')).toBe('a → b ≥ 3 ≤ 4 ≠ 5 ± 1 … 2 × 3');
    expect(symbols('a &lt;-&gt; b &lt;- c')).toBe('a ↔ b ← c');
  });
  it('applies to text but not inside code', () => {
    expect(renderMarkdown('x -> y and `a >= b`')).toBe('<p>x → y and <code>a &gt;= b</code></p>');
  });
});

describe('links and safety', () => {
  it('renders http links and drops dangerous ones', () => {
    expect(renderMarkdown('[TBA](https://www.thebluealliance.com/event/2026cc)')).toContain(
      '<a href="https://www.thebluealliance.com/event/2026cc" target="_blank" rel="noopener noreferrer">TBA</a>'
    );
    const bad = renderMarkdown('[x](javascript:alert(1)) [y](data:text/html,hi)');
    expect(bad).not.toMatch(/href|javascript:alert/);
    expect(bad).toContain('x');
  });
  it('escapes HTML so model text cannot inject markup', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **ok** <script>bad()</script> "q"');
    expect(html).not.toMatch(/<img|<script/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>ok</strong>');
  });
  it('escapes HTML inside tables, headings and link labels', () => {
    const html = renderMarkdown('# <b>x</b>\n\n| <i>h</i> |\n|--|\n| <u>c</u> |\n\n[<s>l</s>](https://a.b)');
    expect(html).not.toMatch(/<b>|<i>|<u>|<s>/);
  });
  it('cannot be tricked into restoring a placeholder it did not create', () => {
    expect(renderMarkdown('9999')).toBe('<p>9999</p>');
  });
  it('prevents KaTeX placeholders and emphasis regexes from breaking out of <a href="..."> (XSS-03)', () => {
    const mathInUrl = renderMarkdown('[link](https://example.com/$x$)');
    expect(mathInUrl).not.toContain('<a ');
    expect(mathInUrl).not.toContain('href=');
    const starInUrl = renderMarkdown('[label*](https://example.com/*path)');
    expect(starInUrl).toBe(
      '<p><a href="https://example.com/*path" target="_blank" rel="noopener noreferrer">label*</a></p>'
    );
  });
});
