// Text formatters for the pages.

// Folder and record slugs as words: "Burned-Out-Woman" → "Burned Out Woman".
export const words = (s) => String(s || '').replace(/[-_]+/g, ' ').trim();

// An ISO time as a short local date and time; '' when missing or invalid.
export const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(+d) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; };

// Seconds as m:ss, or m:ss.hh with `fine` (the editor); 0:00 when unknown.
export function clock(s, fine = false) {
  const x = Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = Math.floor(x / 60), r = x - m * 60;
  return `${m}:${fine ? (Math.floor(r * 100) / 100).toFixed(2).padStart(5, '0') : String(Math.floor(r)).padStart(2, '0')}`;
}
