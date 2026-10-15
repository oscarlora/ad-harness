'use client';
// An ad's markdown file, edited in place: click a block or table cell to edit its markdown (Enter in a cell is a
// line break, Esc is done); drag the grips to reorder blocks, table rows and columns. Each change saves to disk
// at once; changes on disk show live, and a block being typed in keeps the typing. Clicking a grip selects its
// block, row or column and opens its actions (Delete / Backspace deletes it). Selecting text (or a row's Comment
// action) leaves a note on it for the agent, as on the video in the Edit step.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiBase, postJson } from '../../lib/client/api.js';
import { isTyping } from '../../lib/client/hooks.js';
import { Notes } from '../edit/Editor.js';
import { IcGrip } from '../icons.js';
import Markdown, { blockKind, Inline, inSections, parseDoc, serializeDoc, tableCells, tableRow } from './Markdown.js';
import { useFileText } from './parts.js';

const SAVE_MS = 300;
let lastId = Date.now(); // not 0: a hot reload restarts the count while old ids live on
const selecting = () => !!window.getSelection()?.toString().trim();

// Ranges of quote in root's blocks and cells (each line of it on its own: a line break isn't in the text).
function findRanges(root, quote) {
  const out = [];
  for (const el of root.querySelectorAll('.mde__view, .mde__cell')) {
    const nodes = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = '';
    while (walk.nextNode()) { nodes.push([walk.currentNode, text.length]); text += walk.currentNode.data; }
    const at = (i) => { const [n, o] = nodes.findLast(([, s]) => s <= i); return [n, i - o]; };
    for (const seg of quote.split(/\s*\n\s*/).filter((s) => s.length > 1)) {
      for (let i = text.indexOf(seg); i >= 0; i = text.indexOf(seg, i + seg.length)) {
        const r = new Range();
        r.setStart(...at(i));
        r.setEnd(...at(i + seg.length - 1)); r.setEnd(r.endContainer, r.endOffset + 1);
        out.push(r);
      }
    }
  }
  return out;
}

// Marks each pending note's quote in root (CSS Custom Highlight API; the focused note darker), again when doc changes.
function useNoteMarks(root, notes, focus, doc) {
  useEffect(() => {
    if (!root.current || !window.CSS?.highlights) return undefined;
    const marks = [], focused = [];
    for (const n of notes) if (n.status !== 'approved' && n.quote) (n.id === focus ? focused : marks).push(...findRanges(root.current, n.quote));
    CSS.highlights.set('mde-note', new Highlight(...marks));
    CSS.highlights.set('mde-note-focus', new Highlight(...focused));
    return () => { CSS.highlights.delete('mde-note'); CSS.highlights.delete('mde-note-focus'); };
  }, [root, notes, focus, doc]);
}

// The floating "Comment" button over a text selection, then the note field: { quote, x, y, writing?, text? }.
function NoteField({ ask, setAsk, onSave }) {
  const style = { left: Math.min(ask.x, window.innerWidth - 336), top: ask.y };
  if (!ask.writing) {
    return <button type="button" className="btn btn--mini mde__ask" style={style} onMouseDown={(e) => e.preventDefault()} onClick={() => setAsk({ ...ask, writing: true, text: '' })}>Comment</button>;
  }
  return (
    <div className="ed__compose mde__compose" style={style}>
      <textarea
        autoFocus rows={2} value={ask.text} placeholder="Leave a note for the agent"
        onChange={(e) => setAsk({ ...ask, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAsk(null);
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSave(ask); }
        }}
      />
    </div>
  );
}

// Remote blocks take the ids of identical local ones, so unchanged blocks stay put.
function withIds(blocks, prev = []) {
  const free = new Map();
  for (const b of prev) free.set(b.src, [...(free.get(b.src) || []), b.id]);
  return blocks.map((b) => ({ ...b, id: free.get(b.src)?.shift() ?? ++lastId }));
}

const move = (arr, from, to, after) => {
  const out = arr.slice();
  const [x] = out.splice(from, 1);
  out.splice(to - (from < to ? 1 : 0) + (after ? 1 : 0), 0, x);
  return out;
};

// A cell holds line breaks as <br> and pipes as \|.
const cellText = (c = '') => c.replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|');
const textCell = (t) => t.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const isRule = (cells) => cells.every((c) => /^:?-+:?$/.test(c));
const cellAt = (src, r, c) => tableCells(src.split('\n')[r] || '')[c] || '';
function setCell(src, r, c, text) {
  const lines = src.split('\n');
  if (r >= lines.length) return src;
  const cells = tableCells(lines[r]);
  while (cells.length <= c) cells.push('');
  cells[c] = textCell(text);
  lines[r] = tableRow(cells);
  return lines.join('\n');
}
// Rewrite every row's cells (padded to the widest row); fn(cells, empty) gets '---' as empty on the rule row.
function mapCols(src, fn) {
  const rows = src.split('\n').map(tableCells);
  const n = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const empty = isRule(r) ? '---' : '';
    const cells = fn([...r, ...Array(n - r.length).fill(empty)], empty);
    return empty ? `|${cells.join('|')}|` : tableRow(cells);
  }).join('\n');
}
const blankRow = (lines) => tableRow(Array(Math.max(...lines.map((l) => tableCells(l).length))).fill(''));

// A textarea that grows with its text and keeps its own draft while focused: a value from outside replaces the
// draft only when it differs by more than `same` allows (the cell form trims what the user is still typing).
function Area({ value, onChange, onDone, same = (a, b) => a === b }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  useEffect(() => { setDraft((d) => (same(d, value) ? d : value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { const el = ref.current; el.style.height = '0'; el.style.height = `${el.scrollHeight}px`; }, [draft]);
  useEffect(() => { const el = ref.current; el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, []);
  return (
    <textarea
      ref={ref} className="mde__area" value={draft} rows={1} spellCheck
      onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur(); }}
      onBlur={onDone}
    />
  );
}

// Grips: grip(payload) renders a handle that drags to reorder (onto zone(kind, at, axis, onDrop) targets) and,
// clicked, selects payload { kind, from } and opens menuFor(payload): [[label, action]], Delete last.
function useGrips(menuFor) {
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const [sel, setSel] = useState(null); // { kind, from, x, y }
  const isSel = (kind, at) => sel?.kind === kind && sel.from === at;
  useEffect(() => {
    if (!sel) return undefined;
    const close = () => setSel(null);
    const onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); menuFor(sel).at(-1)[1](sel); close(); }
    };
    const onDown = (e) => { if (!e.target.closest('.mde__menu, .mde__grip')) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', close, true); };
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const grip = (payload) => (
    <span className="mde__handle">
      <span
        draggable className="mde__grip" title="Drag to move, click for actions" aria-label="Drag to move, click for actions" aria-pressed={isSel(payload.kind, payload.from)}
        onDragStart={(e) => { setSel(null); drag.current = payload; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }}
        onDragEnd={() => { drag.current = null; setOver(null); }}
        onClick={(e) => {
          e.stopPropagation();
          const rc = e.currentTarget.getBoundingClientRect();
          setSel(isSel(payload.kind, payload.from) ? null : { ...payload, x: rc.left, y: rc.bottom + 4 });
        }}
      ><IcGrip /></span>
      {isSel(payload.kind, payload.from) && (
        <span className="mde__menu" role="menu" style={{ left: sel.x, top: sel.y }}>
          {menuFor(sel).map(([label, run], i, all) => (
            <button key={label} type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); run(sel); setSel(null); }}>
              {label}{i === all.length - 1 && <kbd>Del</kbd>}
            </button>
          ))}
        </span>
      )}
    </span>
  );
  const zone = (kind, at, axis, onDrop) => ({
    'data-drop': over?.kind === kind && over.at === at ? (axis === 'x' ? (over.after ? 'right' : 'left') : (over.after ? 'below' : 'above')) : undefined,
    onDragOver: (e) => {
      if (drag.current?.kind !== kind) return;
      e.preventDefault();
      const rc = e.currentTarget.getBoundingClientRect();
      const after = axis === 'x' ? e.clientX > rc.left + rc.width / 2 : e.clientY > rc.top + rc.height / 2;
      if (over?.kind !== kind || over.at !== at || over.after !== after) setOver({ kind, at, after });
    },
    onDrop: (e) => {
      const d = drag.current;
      if (d?.kind !== kind) return;
      e.preventDefault();
      if (d.from !== at) onDrop(d.from, at, over?.after);
      drag.current = null;
      setOver(null);
    },
  });
  return { grip, zone, isSel };
}

// A table: grips live outside the grid, shown for the hovered row and column: each column's in the strip above
// its header, each row's in the left gutter.
function Table({ b, colRe, focus, setFocus, change, done, grip, zone, isSel }) {
  const [hover, setHover] = useState({ r: -1, c: -1 });
  const lines = b.src.split('\n');
  const rows = lines.map(tableCells);
  const n = Math.max(...rows.map((r) => r.length));
  const cols = [...Array(n).keys()].filter((c) => !colRe || colRe.test((rows[0][c] || '').replace(/\*/g, '').trim()));
  const colKind = `col${b.id}`, rowKind = `row${b.id}`;
  const sameCell = (x, y) => textCell(x).trim() === textCell(y).trim();
  const onOver = (e) => {
    const el = e.target.closest('[data-r], [data-c]');
    const r = el?.dataset.r != null ? +el.dataset.r : -1, c = el?.dataset.c != null ? +el.dataset.c : -1;
    if (r !== hover.r || c !== hover.c) setHover({ r, c });
  };
  const cell = (r, c, Tag) => {
    const editing = focus?.id === b.id && focus.r === r && focus.c === c;
    return (
      <Tag key={c} data-r={r} data-c={c} data-sel={isSel(colKind, c) || undefined} className={editing ? 'mde__cell is-editing' : 'mde__cell'} onClick={() => !editing && !selecting() && setFocus({ id: b.id, r, c })}>
        {editing
          ? <Area value={cellText(rows[r][c])} same={sameCell} onChange={(v) => change(b.id, (src) => setCell(src, r, c, v))} onDone={done} />
          : <Inline text={rows[r][c]} />}
      </Tag>
    );
  };
  const moveRow = (from, to, after) => change(b.id, (src) => move(src.split('\n'), from, to, after).join('\n'), true);
  const moveCol = (from, to, after) => change(b.id, (src) => mapCols(src, (cells) => move(cells, from, to, after)), true);
  const addRow = () => change(b.id, (src) => `${src}\n${blankRow(src.split('\n'))}`, true);
  const show = (on) => on || undefined;
  return (
    <div className="mde__table" onMouseMove={onOver} onMouseLeave={() => setHover({ r: -1, c: -1 })}>
      <div className="md__table">
        <table>
          <thead>
            <tr className="mde__handles">
              <th className="mde__gutter" />
              {cols.map((c) => (
                <th key={c} data-c={c} data-show={show(hover.c === c || isSel(colKind, c))} {...zone(colKind, c, 'x', moveCol)}>{grip({ kind: colKind, from: c })}</th>
              ))}
            </tr>
            <tr>
              <th className="mde__gutter" />
              {cols.map((c) => cell(0, c, 'th'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (i === 0 || (i === 1 && isRule(r)) ? null : (
              <tr key={i} {...zone(rowKind, i, 'y', moveRow)} data-sel={isSel(rowKind, i) || undefined}>
                <td className="mde__gutter" data-r={i} data-show={show(hover.r === i || isSel(rowKind, i))}>{grip({ kind: rowKind, from: i })}</td>
                {cols.map((c) => cell(i, c, 'td'))}
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <button type="button" className="mde__add" onClick={addRow}>New row</button>
    </div>
  );
}

// In a step's view, a "**Label:** text" block shows as a title over its text.
const LABELED = /^\*\*([^*]+?):\*\*\s*([\s\S]*)$/;
function Titled({ src }) {
  const [, title, text] = LABELED.exec(src);
  return <div className="md mde__titled"><h4>{title}</h4><Markdown text={text} /></div>;
}

// file: { name (relative to the ad folder), p, v }. view (else the whole file), as regex sources: only, the section
// names to show; pick, the blocks among them; cols, a table's columns by header.
export default function MdEditor({ ws, brand, ad, file, view, notes = [] }) {
  const only = view?.only && new RegExp(view.only, 'i'), pick = view?.pick && new RegExp(view.pick);
  const colRe = view?.cols && new RegExp(view.cols, 'i');
  const remote = useFileText(ws, brand, file.p, file.v);
  const [doc, setDoc] = useState(null);
  const [focus, setFocusState] = useState(null); // { id } a block, { id, r, c } a table cell
  const [error, setError] = useState('');
  const docRef = useRef(null), focusRef = useRef(null), baseRef = useRef(''), timer = useRef(0), written = useRef([]);
  const setFocus = (f) => { focusRef.current = f; baseRef.current = docRef.current?.blocks.find((b) => b.id === f?.id)?.src || ''; setFocusState(f); };

  const save = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = 0;
    const text = serializeDoc(docRef.current);
    written.current = [...written.current.slice(-4), text];
    baseRef.current = docRef.current.blocks.find((b) => b.id === focusRef.current?.id)?.src || '';
    postJson(`${apiBase(ws, brand)}/edit`, { ad, md: { name: file.name, text } }).then(() => setError(''), (e) => setError(String(e.message || e)));
  }, [ws, brand, ad, file.name]);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { if (timer.current) saveRef.current(); }, []);

  const put = (next, now) => {
    docRef.current = next;
    setDoc(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), now ? 0 : SAVE_MS);
  };
  const change = (id, fn, now) => put({ ...docRef.current, blocks: docRef.current.blocks.map((b) => (b.id === id ? { ...b, src: fn(b.src) } : b)) }, now);
  const moveBlock = (from, to, after) => {
    const ix = (id) => docRef.current.blocks.findIndex((b) => b.id === id);
    const blocks = move(docRef.current.blocks, ix(from), ix(to), after).map((b, i) => ({ ...b, gap: i && !b.gap.length ? [''] : b.gap }));
    put({ ...docRef.current, blocks }, true);
  };
  // A grip's actions; payload kinds: 'block' (from: block id), `row<id>` (from: line), `col<id>` (from: column).
  const menuFor = ({ kind, from }) => {
    const d = docRef.current;
    if (kind === 'block') {
      const i = d.blocks.findIndex((b) => b.id === from);
      return [
        ['Duplicate', () => put({ ...d, blocks: [...d.blocks.slice(0, i + 1), { src: d.blocks[i].src, gap: [''], id: ++lastId }, ...d.blocks.slice(i + 1)] }, true)],
        ['Delete', () => put({ ...d, blocks: d.blocks.filter((b) => b.id !== from) }, true)],
      ];
    }
    const id = Number(kind.slice(3));
    if (kind.startsWith('row')) {
      const lines = (fn) => change(id, (src) => { const l = src.split('\n'); fn(l); return l.join('\n'); }, true);
      return [
        ['Comment', ({ x, y }) => setAsk({ quote: tableCells(d.blocks.find((b) => b.id === id).src.split('\n')[from])[0].replace(/\*/g, ''), x, y, writing: true, text: '' })],
        ['Insert row above', () => lines((l) => l.splice(from, 0, blankRow(l)))],
        ['Insert row below', () => lines((l) => l.splice(from + 1, 0, blankRow(l)))],
        ['Duplicate row', () => lines((l) => l.splice(from + 1, 0, l[from]))],
        ['Delete row', () => lines((l) => l.splice(from, 1))],
      ];
    }
    const cols = (fn) => change(id, (src) => mapCols(src, fn), true);
    return [
      ['Insert column left', () => cols((c, empty) => [...c.slice(0, from), empty, ...c.slice(from)])],
      ['Insert column right', () => cols((c, empty) => [...c.slice(0, from + 1), empty, ...c.slice(from + 1)])],
      ['Delete column', () => cols((c) => c.filter((_, i) => i !== from))],
    ];
  };
  const { grip, zone, isSel } = useGrips(menuFor);

  // Notes: select text for the Comment button; the note field closes on Esc, a save, or a click elsewhere.
  const rootRef = useRef(null);
  const [ask, setAsk] = useState(null);
  const [noteFocus, setNoteFocus] = useState(null);
  useNoteMarks(rootRef, notes, noteFocus, doc);
  useEffect(() => {
    const onUp = (e) => {
      if (e.target.closest?.('.mde__ask, .mde__compose')) return;
      const s = window.getSelection(), quote = s?.toString().trim();
      if (!quote || !rootRef.current?.contains(s.anchorNode)) { setAsk((a) => (a?.writing && a.text ? a : null)); return; }
      const r = s.getRangeAt(0).getBoundingClientRect();
      setAsk({ quote: quote.slice(0, 1000), x: r.left, y: r.bottom + 6 });
    };
    const onScroll = () => setAsk((a) => (a?.writing ? a : null));
    document.addEventListener('mouseup', onUp);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mouseup', onUp); window.removeEventListener('scroll', onScroll, true); };
  }, []);
  const noteApi = (body) => postJson(`${apiBase(ws, brand)}/edit`, { ad, ...body }).catch((e) => setError(String(e.message || e)));
  const saveNote = ({ quote, text }) => {
    setAsk(null);
    window.getSelection()?.removeAllRanges();
    if (text.trim()) noteApi({ note: { file: file.name, quote, text } });
  };
  const pickNote = (n) => {
    setNoteFocus(n.id);
    findRanges(rootRef.current, n.quote || '')[0]?.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Done with a block: save, and re-split it if it now holds blank lines.
  const done = () => {
    setFocus(null);
    if (!docRef.current) return;
    const parsed = parseDoc(serializeDoc(docRef.current));
    const next = { ...parsed, blocks: withIds(parsed.blocks, docRef.current.blocks) };
    if (timer.current) put(next, true);
    else { docRef.current = next; setDoc(next); }
  };

  // The file changed on disk (not by this editor): take it, keeping the focused block's unsaved typing.
  useEffect(() => {
    if (remote == null || written.current.includes(remote)) return;
    const parsed = parseDoc(remote);
    const cur = docRef.current, f = focusRef.current;
    const blocks = withIds(parsed.blocks, cur?.blocks);
    const mine = f && cur?.blocks.find((b) => b.id === f.id);
    if (mine && !blocks.some((b) => b.id === f.id)) {
      let j = blocks.findIndex((b) => b.src === baseRef.current);
      if (j < 0) j = Math.min(cur.blocks.indexOf(mine), blocks.length - 1);
      if (j >= 0) {
        const unsaved = !!timer.current;
        const src = !unsaved ? blocks[j].src : f.r != null ? setCell(blocks[j].src, f.r, f.c, cellText(cellAt(mine.src, f.r, f.c))) : mine.src;
        blocks[j] = { ...blocks[j], id: f.id, src };
        baseRef.current = parsed.blocks[j].src;
      }
    }
    docRef.current = { ...parsed, blocks };
    setDoc(docRef.current);
  }, [remote]);

  if (!doc) return <p className="flow-note">Loading</p>;
  const shown = only ? inSections(doc.blocks, only) : null;
  const blocks = doc.blocks.filter((b, i) => !shown || (shown[i] && (pick ? pick.test(b.src) : blockKind(b.src) !== 'comment')));
  return (
    <div className="mde-doc">
      <div className="mde" ref={rootRef}>
        {error && <p className="mde__error">Not saved: {error}</p>}
        {!blocks.length && <p className="flow-note">Not in the brief yet.</p>}
        {blocks.map((b) => {
          const kind = blockKind(b.src);
          return (
            <div key={b.id} className="mde__block" {...zone('block', b.id, 'y', moveBlock)} data-sel={isSel('block', b.id) || undefined}>
              {kind !== 'table' && grip({ kind: 'block', from: b.id })}
              {kind === 'table' ? <Table b={b} colRe={colRe} focus={focus} setFocus={setFocus} change={change} done={done} grip={grip} zone={zone} isSel={isSel} />
                : focus?.id === b.id ? <Area value={b.src} same={(x, y) => x.trim() === y.trim()} onChange={(v) => change(b.id, () => v)} onDone={done} />
                : (
                  <div className="mde__view" onClick={(e) => { if (!e.target.closest('a') && !selecting()) setFocus({ id: b.id }); }}>
                    {kind === 'comment' ? <p className="mde__comment">{b.src.replace(/^\s*<!--\s*|\s*-->\s*$/g, '')}</p>
                      : pick && LABELED.test(b.src) ? <Titled src={b.src} /> : <Markdown text={b.src} />}
                  </div>
                )}
            </div>
          );
        })}
      </div>
      {notes.length > 0 && (
        <Notes notes={notes} focus={noteFocus} onPick={pickNote} onAction={noteApi} hint="Select text to leave a note."
          lead={(n) => n.quote && <span className="ed-note__quote">{n.quote}</span>} />
      )}
      {ask && <NoteField ask={ask} setAsk={setAsk} onSave={saveNote} />}
    </div>
  );
}
