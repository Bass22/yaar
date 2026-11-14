/** A phone number as typed, kept and sent: its spaces taken out — « +221 77 123 45 67 » is +221771234567. */
export const compactPhone = (typed: string): string => typed.replace(/\s/g, '');

/**
 * A number of Senegal as one says it (demand of the founder, 2026-11-13): « +221 77 123 45 67 »,
 * grouped while it is typed. Any other number is shown as kept: no grouping is made up.
 */
export function phoneWords(phone: string): string {
  const national = /^\+221(\d{0,9})$/.exec(phone)?.[1];
  if (national === undefined) return phone;
  const groups = [national.slice(0, 2), national.slice(2, 5), national.slice(5, 7), national.slice(7, 9)].filter((group) => group !== '');
  return ['+221', ...groups].join(' ');
}
