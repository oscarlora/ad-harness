'use client';
// `/`: redirect to the last-used brand unless ?all=1, else list every brand by workspace.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { brandUrl } from '../lib/client/api.js';
import { TABS, tabOr } from './BrandPage.js';
import { groupByWorkspace, LAST_KEY } from './Switcher.js';

export default function HomeIndex({ brands, error }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wantsAll = new URLSearchParams(window.location.search).has('all');
    if (!wantsAll) {
      try {
        const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
        if (last && brands.some((b) => b.workspace === last.ws && b.brand === last.brand)) {
          router.replace(brandUrl(last.ws, last.brand, tabOr(last.tab)));
          return;
        }
      } catch {}
    }
    setReady(true);
  }, [brands, router]);

  if (!ready) return null;

  return (
    <div className="home">
      <h1>Ad Production Kit</h1>
      <p className="home__lede">Every brand in this project — its ads board, media library and workflow, live.</p>
      {error && <div className="empty-state">{error}</div>}
      {!error && brands.length === 0 && (
        <div className="empty-state">
          No brands found under <code>workspaces/</code>. Pull one first:{' '}
          <code>node tools/sync-brand.mjs --pull workspaces/&lt;WS&gt;/&lt;Brand&gt;</code>
        </div>
      )}
      {[...groupByWorkspace(brands)].map(([w, names]) => (
        <section key={w} className="home__ws">
          <div className="eyebrow">{w}</div>
          <div className="home__grid">
            {names.map((b) => (
              <Link key={b} href={brandUrl(w, b, 'board')} className="brand-card">
                <div className="brand-card__name">{b}</div>
                <div className="brand-card__links">{Object.values(TABS).map((t) => <span key={t}>{t}</span>)}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
