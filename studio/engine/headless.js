// Headless page for tools/edit-video.mjs: renders the same engine Studio previews, to an MP4 or to stills.
// Query: plan (path under /f/), mode = export | audio | frames, scale, from, to, at (comma-separated seconds), boxes.
import { compose } from './doc.js';
import { createEngine, exportVideo } from './index.js';

const q = new URLSearchParams(location.search);
const post = (path, body) => fetch(path, { method: 'POST', body });

async function main() {
  const planUrl = new URL(`/f/${q.get('plan')}`, location.href);
  const get = async (u) => (await fetch(u)).json();
  const own = await get(planUrl);
  const raw = own.base ? compose(own, await get(new URL(own.base, planUrl))) : own;
  const scale = +(q.get('scale') || 1);
  const [W, H] = raw.size || [1080, 1920];
  const even = (n) => 2 * Math.round(n / 2);
  const canvas = new OffscreenCanvas(even(W * scale), even(H * scale));
  const url = (src) => new URL(src, planUrl).href;
  const engine = await createEngine({ canvas, url });
  const doc = await engine.load(raw, raw.fx ? url(raw.fx) : null);
  const t0 = performance.now();
  if (q.get('mode') === 'frames') {
    const times = (q.get('at') || '0').split(',').map(Number);
    const boxes = JSON.parse(q.get('boxes') || '[]'); // per moment: a [x, y, w, h] frame fraction to outline, or null
    const sheet = new OffscreenCanvas(canvas.width * Math.min(times.length, 4), canvas.height * Math.ceil(times.length / 4));
    const sx = sheet.getContext('2d');
    for (const [i, t] of times.entries()) {
      await engine.render(t);
      const x = (i % 4) * canvas.width, y = Math.floor(i / 4) * canvas.height;
      sx.drawImage(canvas, x, y);
      const b = boxes[i];
      if (b) {
        sx.strokeStyle = '#FF2D2D';
        sx.lineWidth = Math.max(3, canvas.width / 150);
        sx.strokeRect(x + b[0] * canvas.width, y + b[1] * canvas.height, Math.max(4, b[2] * canvas.width), Math.max(4, b[3] * canvas.height));
      }
      sx.font = `600 ${Math.round(canvas.width / 18)}px sans-serif`;
      sx.fillStyle = '#000000a0';
      sx.fillRect(x, y, canvas.width / 3.2, canvas.width / 11);
      sx.fillStyle = '#fff';
      sx.fillText(`${t.toFixed(2)}s`, x + canvas.width / 40, y + canvas.width / 14);
    }
    await post('/out?offset=0', await sheet.convertToBlob({ type: 'image/png' }));
  } else if (q.get('mode') === 'audio') {
    await post('/out?offset=0', wav(await engine.mix(), +(q.get('from') || 0), q.get('to') ? +q.get('to') : doc.duration));
  } else {
    let chain = Promise.resolve();
    const write = (data, pos) => { const copy = data.slice(); chain = chain.then(() => post(`/out?offset=${pos}`, copy)); };
    let last = 0;
    await exportVideo({
      engine, canvas, write,
      from: +(q.get('from') || 0), to: q.get('to') ? +q.get('to') : doc.duration,
      bitrate: 12e6 * scale * scale,
      onProgress: (p) => { if (p - last >= 0.05) { last = p; post('/progress', String(p)); } },
    });
    await chain;
  }
  await engine.close();
  return { ms: Math.round(performance.now() - t0), duration: doc.duration, errors: engine.errors };
}

// 16-bit PCM WAV of [a, b) of an AudioBuffer.
function wav(buf, a, b) {
  const ch = buf.numberOfChannels, s = Math.round(a * buf.sampleRate), n = Math.max(0, Math.min(buf.length, Math.round(b * buf.sampleRate)) - s);
  const v = new DataView(new ArrayBuffer(44 + n * ch * 2)), data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  [...'RIFF'].forEach((x, i) => v.setUint8(i, x.charCodeAt(0)));
  [...'WAVEfmt '].forEach((x, i) => v.setUint8(8 + i, x.charCodeAt(0)));
  [...'data'].forEach((x, i) => v.setUint8(36 + i, x.charCodeAt(0)));
  v.setUint32(4, 36 + n * ch * 2, true); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); v.setUint32(40, n * ch * 2, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) v.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, data[c][s + i])) * 32767, true);
  return v.buffer;
}

main().then((r) => post('/done', JSON.stringify(r)), (e) => post('/done', JSON.stringify({ error: `${e?.message || e}` })));
