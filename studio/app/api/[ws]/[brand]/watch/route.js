// Live refresh: SSE `change` events from a recursive fs.watch of outputs/ and inputs/media/_catalog/: the first
// change at once, the rest of a burst once it settles.
// The heartbeat keeps proxies from closing an idle connection.
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
      let debounce = null, lastSent = 0;
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
            // The first change goes out at once (an edit shows immediately); a burst after it collapses into one.
            const now = Date.now();
            if (now - lastSent > DEBOUNCE_MS) { lastSent = now; send('event: change\ndata: {}\n\n'); return; }
            clearTimeout(debounce);
            debounce = setTimeout(() => { lastSent = Date.now(); send('event: change\ndata: {}\n\n'); }, DEBOUNCE_MS);
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
