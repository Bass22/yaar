/**
 * A number typed at the office (Q.10): shown with a space between thousands while it is typed —
 * « 10 000 » —, read back without them. Anything else than whole digits is left as typed: the
 * screen refuses it further on, it is never silently corrected.
 */
export function grouped(typed: string | number): string {
  const text = String(typed);
  return /^\d+$/.test(text) ? text.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : text;
}

/** What a box holds, its spaces taken out. */
export function typedNumber(event: Event): string {
  return (event.target as HTMLInputElement).value.replace(/\s/g, '');
}

/** The currency as the office writes it next to an amount: « FCFA » for the franc CFA (decision of the founder, 2026-11-13). */
export function currencyWord(code: string | null | undefined): string {
  return code === 'XOF' ? 'FCFA' : (code ?? '');
}

/** What an input holds, as typed. */
export function typedText(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/** A business day as the office reads it: `2026-11-14` → « 14/11/2026 ». */
export const dayWords = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
