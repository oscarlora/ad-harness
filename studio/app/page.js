import { listBrands } from '../lib/server/brands.js';
import HomeIndex from '../components/HomeIndex.js';

export const dynamic = 'force-dynamic';

export default function Home() {
  let brands = [];
  let error = null;
  try { brands = listBrands(); } catch (e) { error = String(e?.message || e); }
  return <HomeIndex brands={brands} error={error} />;
}
