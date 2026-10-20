/** First instant on the next local calendar day; handles zones with midnight transitions. */
export function nextLocalDay(reference: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = formatter.format(reference);
  let low = reference, high = reference + 48 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (formatter.format(middle) === day) low = middle; else high = middle;
  }
  return high;
}
