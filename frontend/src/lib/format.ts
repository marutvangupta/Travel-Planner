export const inr = (n: number): string => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const inrShort = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 100000) return `₹${(n / 100000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, "")}L`;
  if (a >= 1000) return `₹${(n / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `₹${Math.round(n)}`;
};

export const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const duration = (m: number): string => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  return h ? `${h}h` : `${r}m`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const shortDate = (iso: string): string => {
  const d = parseDate(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const dayName = (iso: string): string => DOW[parseDate(iso).getDay()];
export const dateRange = (a: string, b: string): string => {
  const da = parseDate(a);
  const db = parseDate(b);
  if (da.getMonth() === db.getMonth()) return `${da.getDate()}–${db.getDate()} ${MONTHS[da.getMonth()]} ${db.getFullYear()}`;
  return `${shortDate(a)} – ${shortDate(b)} ${db.getFullYear()}`;
};
export const daysBetween = (a: string, b: string): number => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000) + 1;
export const cityName = (destination: string): string => destination.split(",")[0].trim();
export const toIso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (iso: string, n: number): string => {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
};
export const titleCase = (s: string): string => s.replace(/(^|\s|-)\w/g, (c) => c.toUpperCase());
