// Motion for an ad's fx layers (env.motion): GSAP timelines and Three.js scenes, seeked to the frame being
// drawn, so the preview and the export show the same frame. Built once per clip; disposed when the doc reloads.
import { gsap } from 'gsap';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function motionKit() {
  const made = new Map();
  const drop = (id) => { made.get(id)?.dispose(); made.delete(id); };
  return {
    gsap, THREE, addons: { RoundedBoxGeometry },

    // A paused timeline, built by build(tl) once per clip, seeked to the clip's own time.
    timeline(c, t, build) {
      let m = made.get(c.id);
      if (!m) {
        const tl = gsap.timeline({ paused: true });
        build(tl);
        made.set(c.id, (m = { tl, dispose: () => tl.kill() }));
      }
      m.tl.seek(t - c.at, false);
      return m.tl;
    },

    // A 3D scene drawn into the clip's box (x, y = center, w, h; default the frame). setup(renderer) runs once
    // and returns { scene, camera, update(localT) }; update poses the scene for that moment.
    three(ctx, c, t, env, setup) {
      const bw = c.w ?? env.W, bh = c.h ?? env.H;
      const w = Math.round(bw * env.k), h = Math.round(bh * env.k);
      let m = made.get(c.id);
      if (m && (m.w !== w || m.h !== h)) { drop(c.id); m = null; }
      if (!m) {
        const renderer = new THREE.WebGLRenderer({ canvas: new OffscreenCanvas(w, h), antialias: true, alpha: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        m = { w, h, renderer, ...setup(renderer), dispose: () => { renderer.dispose(); renderer.forceContextLoss(); } };
        made.set(c.id, m);
      }
      m.update(t - c.at);
      m.renderer.render(m.scene, m.camera);
      ctx.drawImage(m.renderer.domElement, (c.x ?? env.W / 2) - bw / 2, (c.y ?? env.H / 2) - bh / 2, bw, bh);
    },

    dispose() { for (const id of [...made.keys()]) drop(id); },
  };
}
