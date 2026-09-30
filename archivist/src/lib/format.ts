/** Pure formatting helpers shared by the server and the UI (no database access). */

/** "ACME SUPPLY CO." -> "Acme Supply Co."; leaves mixed case alone. */
export function humanCase(s: string) {
  if (s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** "lab_report" -> "Lab report". */
export const typeLabel = (name: string) => {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const isoDate = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-27" -> "Jul 27, 2026". */
export const humanDate = (iso: string | null | undefined) => {
  const d = isoDate(iso);
  return d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : null;
};

/** "/Finance/Invoices" -> "Finance › Invoices"; root -> "Library". */
export const breadcrumb = (path: string | null | undefined) =>
  !path || path === "/" ? "Library" : path.slice(1).split("/").join(" › ");
