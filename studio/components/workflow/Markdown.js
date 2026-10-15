// Minimal markdown → React (headings, lists, tables, inline marks, <br>; no other HTML), plus table and document helpers.
// Server code imports this file too: keep it free of client-only code.

// "| a | b \\| c |" → ['a', 'b \\| c'].
export const tableCells = (l) => l.trim().replace(/^\||(?<!\\)\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
// ['a', ''] → "| a | |".
export const tableRow = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : ' ')).join('|')}|`;
// "|---|:-:|", or a row of empty cells.
export const isSeparator = (cells) => cells.every((c) => /^:?-*:?$/.test(c));

const INLINE = /(<br\s*\/?>|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*)/gi;

export function Inline({ text }) {
  return String(text || '').split(INLINE).map((t, i) => {
    if (i % 2 === 0) return t.replace(/\\\|/g, '|');
    if (t.startsWith('<')) return <br key={i} />;
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
    out.push({ p: para.join('<br>') }); // a line break stays one, as in the doc it came from
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

// ---- an editable document ----
// Blocks split on blank lines; a table and an <!-- HTML comment --> are blocks of their own.
// parseDoc → { blocks: [{ src, gap }], tail } (gap and tail: the blank lines before a block and at the end); serializeDoc reverses it exactly.
const isComment = (l) => l.trimStart().startsWith('<!--');
export function parseDoc(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  let gap = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { gap.push(lines[i++]); continue; }
    const start = i;
    if (isComment(lines[i])) { while (i < lines.length && !lines[i].includes('-->')) i++; i++; }
    else if (isTable(lines[i])) while (i < lines.length && isTable(lines[i])) i++;
    else while (i < lines.length && lines[i].trim() && !isTable(lines[i]) && !isComment(lines[i])) i++;
    blocks.push({ src: lines.slice(start, i).join('\n'), gap });
    gap = [];
  }
  return { blocks, tail: gap };
}
export const serializeDoc = (doc) => doc.blocks.filter((b) => b.src.trim())
  .flatMap((b) => [...b.gap, ...b.src.split('\n')]).concat(doc.tail).join('\n');
export const blockKind = (src) => (isTable(src) ? 'table' : isComment(src) ? 'comment' : 'text');

// A section starts at a heading or a whole-line bold caps label ("**LINES TO CAMERA**") and runs to the next one.
const SECTION = /^(?:#{1,6}\s+(.+?)|\*\*([^a-z*]+?):?\*\*:?)\s*$/;
// For each block, whether it falls in a section whose name matches re.
export function inSections(blocks, re) {
  let cur = '';
  return blocks.map(({ src }) => {
    const m = blockKind(src) === 'text' && SECTION.exec(src.split('\n')[0]);
    if (m) cur = m[1] || m[2];
    return !!cur && re.test(cur);
  });
}
