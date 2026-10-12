import { Inter } from 'next/font/google';
import { BrandsProvider } from '../components/Switcher.js';
import { listBrands } from '../lib/server/brands.js';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = {
  title: 'Ad Harness',
  description: 'Ad Harness Studio: the ads board, media library and workflow for every brand.',
};

export default function RootLayout({ children }) {
  let brands = [];
  try { brands = listBrands(); } catch {}
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <BrandsProvider brands={brands}>
          <main className="page">{children}</main>
        </BrandsProvider>
      </body>
    </html>
  );
}
