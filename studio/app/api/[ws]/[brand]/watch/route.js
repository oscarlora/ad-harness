// Live refresh — the reason this app exists. SSE stream backed by fs.watch (recursive; supported
// on macOS and Windows) over outputs/ and inputs/media/_catalog/. Debounced 400ms `change`
// events; a comment heartbeat every 25s keeps proxies from idling the connection out.
import { existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { brandRoute } from '../../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;
const DEBOUNCE_MS = 400;

export const GET = brandRoute((req, ctx) => {
  const dirs = [join(ctx.dir, 'outputs'), join(ctx.dir, 'inputs', 'media', '_catalog')].filter((d) => existsSync(d));

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (s) => { if (!closed) try { controller.enqueue(encoder.encode(s)); } catch { closed = true; } };
      const watchers = [];
      let debounce = null;
      const heartbeat = setInterval(() => send(': hb\n\n'), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(debounce);
        for (const w of watchers) try { w.close(); } catch {}
        try { controller.close(); } catch {}
      };
      send(`: watching ${dirs.length} dir(s)\n\n`);
      for (const dir of dirs) {
        try {
          const w = watch(dir, { recursive: true }, () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => send('event: change\ndata: {}\n\n'), DEBOUNCE_MS);
          });
          w.on('error', () => {});
          watchers.push(w);
        } catch {}
      }
    },
    cancel() { cleanup(); },
  });
  req.signal.addEventListener('abort', () => cleanup());

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
