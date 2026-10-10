// The app is self-contained: brand data is reached at runtime via lib/server/harness.js
// (dynamic file:// imports), so bundling and file tracing stay scoped to studio/.
const appDir = import.meta.dirname;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // One dev server per build dir (Next's instance lock). dev.mjs sets NEXT_DIST_DIR per
  // harness-assigned port so parallel sessions on one machine each get their own instance.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: appDir,
  // Server routes touch brand files via runtime-dynamic paths; nothing to trace for deploy
  // bundles, so silence the tracer instead of letting it glob the app dir.
  outputFileTracingExcludes: { '*': ['./**'] },
  turbopack: { root: appDir },
};

export default nextConfig;
