// The edit document (an ad's edit.json): defaults, timing and keyframes. Schema: tools/edit-video.mjs --help.

// Easing curves, x in 0..1.
const back = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
function bounceOut(x) {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}
const EASE = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  ease: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  back,
  bounce: bounceOut,
  elastic: (x) => (x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
  hold: (x) => (x < 1 ? 0 : 1),
};
export const ease = (name, x) => (EASE[name] || EASE.ease)(Math.min(1, Math.max(0, x)));

// A number, or keyframes [[t, value, easing?], …] on the timeline clock; the easing shapes the move to the next key.
export function val(v, t, dflt) {
  if (v == null) return dflt;
  if (!Array.isArray(v) || !Array.isArray(v[0])) return v;
  if (t <= v[0][0]) return v[0][1];
  for (let i = 0; i < v.length - 1; i++) {
    const [t0, a, e] = v[i], [t1, b] = v[i + 1];
    if (t < t1) return typeof a === 'number' ? a + (b - a) * ease(e, (t - t0) / (t1 - t0)) : a;
  }
  return v[v.length - 1][1];
}
export const keyed = (v) => Array.isArray(v) && Array.isArray(v[0]);

const VISUAL = new Set(['video', 'image', 'text', 'captions', 'rect', 'custom']);
export const isVisual = (c) => VISUAL.has(c.type);
export const hasSound = (c) => c.type === 'audio' || (c.type === 'video' && !c.mute);

// Defaults filled in, clips sorted, each clip linked to its track and neighbours. Times are seconds.
export function normalize(raw) {
  const [W, H] = raw.size || [1080, 1920];
  const fps = raw.fps || 30;
  let end = 0;
  const tracks = (raw.tracks || []).map((tr, ti) => {
    const clips = (tr.clips || []).map((c, ci) => {
      const type = c.type || (c.src && /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i.test(c.src) ? 'audio' : c.src && /\.(png|jpe?g|webp|gif|avif)$/i.test(c.src) ? 'image' : c.src ? 'video' : c.lines ? 'captions' : 'text');
      const at = c.at ?? 0;
      let stop = c.end ?? (c.dur != null ? at + c.dur : null);
      if (type === 'captions' && stop == null) stop = Math.max(at, ...(c.lines || []).map((l) => l.end ?? 0));
      return { ...c, type, at, end: stop, rate: c.rate ?? 1, in: c.in ?? 0, id: c.id || `${ti}.${ci}` };
    }).sort((a, b) => a.at - b.at);
    return { ...tr, name: tr.name || `Track ${ti + 1}`, clips };
  });
  for (const tr of tracks) {
    tr.clips.forEach((c, i) => {
      c.track = tr;
      c.prev = tr.clips[i - 1] || null;
      c.next = tr.clips[i + 1] || null;
      if (c.end != null) end = Math.max(end, c.end);
    });
  }
  return { ...raw, W, H, fps, background: raw.background || '#000000', tracks, duration: raw.duration ?? end, raw };
}

// Media end for clips without one (set once the source duration is known).
export function settle(doc, durations) {
  let end = 0;
  for (const tr of doc.tracks) for (const c of tr.clips) {
    if (c.end == null) { const d = durations.get(c.src); c.end = d ? c.at + (d - c.in) / c.rate : c.at + 5; }
    end = Math.max(end, c.end);
  }
  if (doc.raw.duration == null) doc.duration = end;
  return doc;
}

// A transition belongs to the incoming clip and is centered on its cut; both clips play through it.
export const tin = (c) => (c.transition && c.prev && c.transition.type !== 'cut' ? c.transition.dur ?? 0.4 : 0);
const tout = (c) => (c.next ? tin(c.next) : 0);
export const live = (c, t) => t >= c.at - tin(c) / 2 && t < c.end + tout(c) / 2;

// Source time of a media clip at timeline time t.
export const srcTime = (c, t) => c.in + (t - c.at) * c.rate;
