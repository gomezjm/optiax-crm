/**
 * Parsing money the way a Colombian owner types it.
 *
 * `formatMoney` renders 89000 as "$ 89.000" (es-CO: `.` groups thousands, `,`
 * is the decimal mark). So a plain `Number("89.000")` — which is 89 — would
 * silently turn a $89.000 blouse into an $89 one. Prices are typed by hand all
 * day on this screen, so the parse follows the same convention the app prints.
 */

/** Parsed price, or undefined when the input isn't a usable non-negative number. */
export function parsePriceInput(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (cleaned === '') return undefined;

  const dots = (cleaned.match(/\./g) ?? []).length;
  const commas = (cleaned.match(/,/g) ?? []).length;

  let normalized: string;
  if (commas > 0) {
    // A comma is always the decimal mark in es-CO; dots before it group thousands.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
    // Any further commas are noise ("1,5,5") — reject rather than guess.
    if (commas > 1) return undefined;
  } else if (dots > 1) {
    // "1.234.000" — repeated dots can only be thousands separators.
    normalized = cleaned.replace(/\./g, '');
  } else if (dots === 1 && /\.\d{3}$/.test(cleaned)) {
    // "89.000" — three trailing digits after a lone dot is the thousands form.
    normalized = cleaned.replace('.', '');
  } else {
    // "89.5" (or plain digits) — a genuine decimal.
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
