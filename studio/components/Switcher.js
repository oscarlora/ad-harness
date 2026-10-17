'use client';
// Workspace and brand in one picker: the brand's initials, an invisible select (brands grouped by workspace) over them. Selection is URL-driven; the current brand is remembered in localStorage for `/`.
import { createContext, useContext, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { brandUrl } from '../lib/client/api.js';
import { words } from '../lib/client/format.js';
import { tabOr } from './BrandPage.js';

export const LAST_KEY = 'ad-production-kit-studio:last';

// [{ workspace, brand }] → Map(workspace → [brand names])
export function groupByWorkspace(brands) {
  const groups = new Map();
  for (const b of brands) groups.set(b.workspace, [...(groups.get(b.workspace) || []), b.brand]);
  return groups;
}

// Every brand, listed by the layout on each page load; error: why listing failed.
const BrandsContext = createContext({ brands: [], error: null });
export function BrandsProvider({ brands, error, children }) {
  return <BrandsContext.Provider value={{ brands, error }}>{children}</BrandsContext.Provider>;
}
export const useBrands = () => useContext(BrandsContext);

export default function Switcher({ ws, brand }) {
  const { brands } = useBrands();
  const router = useRouter();
  const pathname = usePathname();
  // A brand switch lands on the same tab's top level.
  const tab = tabOr(pathname?.split('/')[3]);

  useEffect(() => {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ws, brand, tab })); } catch {}
  }, [ws, brand, tab]);

  const groups = groupByWorkspace(brands);

  return (
    <div className="switcher" title={`${ws} / ${words(brand)}`}>
      <span className="switcher__mark" aria-hidden="true">{words(brand).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
      <select aria-label="Brand" value={`${ws}/${brand}`} onChange={(e) => { const [w, b] = e.target.value.split('/'); router.push(brandUrl(w, b, tab)); }}>
        {[...groups].map(([w, bs]) => (
          <optgroup key={w} label={w}>
            {bs.map((b) => <option key={b} value={`${w}/${b}`}>{words(b)}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
