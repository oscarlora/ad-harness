'use client';
// Workspace / brand switcher. Selection is URL-driven; the current brand is remembered in localStorage for `/`.
import { createContext, useContext, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { brandUrl } from '../lib/client/api.js';
import { tabOr } from './BrandPage.js';

export const LAST_KEY = 'ad-production-kit-studio:last';

// [{ workspace, brand }] → Map(workspace → [brand names])
export function groupByWorkspace(brands) {
  const groups = new Map();
  for (const b of brands) groups.set(b.workspace, [...(groups.get(b.workspace) || []), b.brand]);
  return groups;
}

const BrandsContext = createContext([]);
export function BrandsProvider({ brands, children }) {
  return <BrandsContext.Provider value={brands}>{children}</BrandsContext.Provider>;
}

export default function Switcher({ ws, brand }) {
  const brands = useContext(BrandsContext);
  const router = useRouter();
  const pathname = usePathname();
  // A brand switch lands on the same tab's top level.
  const tab = tabOr(pathname?.split('/')[3]);

  useEffect(() => {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ws, brand, tab })); } catch {}
  }, [ws, brand, tab]);

  const groups = groupByWorkspace(brands);
  const brandsOf = (w) => groups.get(w) || [];

  return (
    <div className="switcher">
      <span className="switcher__sep" aria-hidden="true">/</span>
      <select className="select select--ghost" aria-label="Workspace" value={ws} onChange={(e) => router.push(brandUrl(e.target.value, brandsOf(e.target.value)[0], tab))}>
        {[...groups.keys()].map((w) => <option key={w} value={w}>{w}</option>)}
      </select>
      <span className="switcher__sep" aria-hidden="true">/</span>
      <select className="select select--ghost" aria-label="Brand" value={brand} onChange={(e) => router.push(brandUrl(ws, e.target.value, tab))}>
        {brandsOf(ws).map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>
  );
}
