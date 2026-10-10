// Minimal markdown → React, enough for the harness's own docs (storyboards, briefs, voices):
// headings, paragraphs, bullet/numbered lists (indented continuation lines join their item),
// tables, and inline bold / italic / code / links. HTML comments are dropped. No raw HTML.
// Also the table-row helpers the server's own markdown readers share (no client code here).

// "| a | b |" → ['a', 'b'].
export const tableCells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
// A header-separator row ("|---|:-:|"), or one with every cell empty.
export const isSeparator = (cells) => cells.every((c) => /^:?-*:?$/.test(c));

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/g;

export function Inline({ text }) {
  return String(text || '').split(INLINE).map((t, i) => {
    if (i % 2 === 0) return t;
    if (t.startsWith('**')) return <strong key={i}><Inline text={t.slice(2, -2)} /></strong>;
    if (t.startsWith('`')) return <code key={i}>{t.slice(1, -1)}</code>;
    if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t);
      return /^https?:/.test(href) ? <a key={i} href={href} target="_blank" rel="noreferrer">{label}</a> : label;
    }
    return <em key={i}>{t.slice(1, -1)}</em>;
  });
}

const isTable = (l) => /^\s*\|/.test(l);
const ITEM = /^\s*(?:[-*]|\d+\.)\s+/;
const isHeading = (l) => /^#{1,6}\s/.test(l);

function blocks(md) {
  const lines = String(md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (isHeading(l)) { out.push({ h: l.replace(/^#+\s*/, '') }); i++; continue; }
    if (isTable(l)) {
      const rows = [];
      while (i < lines.length && isTable(lines[i])) rows.push(tableCells(lines[i++]));
      const body = rows.slice(1).filter((r) => !isSeparator(r));
      out.push({ table: { head: rows[0], body } });
      continue;
    }
    if (ITEM.test(l)) {
      const items = [];
      while (i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isHeading(lines[i])) {
        if (ITEM.test(lines[i])) items.push(lines[i].replace(ITEM, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      out.push({ list: items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isHeading(lines[i]) && !ITEM.test(lines[i])) para.push(lines[i++].trim());
    out.push({ p: para.join(' ') });
  }
  return out;
}

export default function Markdown({ text }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        if (b.h != null) return <h3 key={i}><Inline text={b.h} /></h3>;
        if (b.list) return <ul key={i}>{b.list.map((t, k) => <li key={k}><Inline text={t} /></li>)}</ul>;
        if (b.table) {
          return (
            <div key={i} className="md__table">
              <table>
                <thead><tr>{b.table.head.map((c, k) => <th key={k}><Inline text={c} /></th>)}</tr></thead>
                <tbody>{b.table.body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}><Inline text={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        return <p key={i}><Inline text={b.p} /></p>;
      })}
    </div>
  );
}
