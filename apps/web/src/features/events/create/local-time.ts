export type LocalTimeResult = { startsAt: string; error?: never } | { startsAt?: never; error: string };

/** Resolve a wall-clock value in its chosen zone, without the device's local timezone. */
export function resolveLocalTime(value: string, timezone: string): LocalTimeResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { error: 'Укажи дату и время начала.' };
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day); wall.setUTCHours(hour, minute, 0, 0);
  if (year < 1000 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day || hour > 23 || minute > 59) {
    return { error: 'Проверь календарную дату и время.' };
  }
  let formatter: Intl.DateTimeFormat;
  try {
    // Intl also accepts numeric offsets; the API requires a named IANA zone.
    if (!timezone || /^[+−-]/.test(timezone)) throw new RangeError();
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch { return { error: 'Укажи существующую IANA-зону, например Asia/Krasnoyarsk.' }; }
  const partsAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    const date = new Date(0);
    date.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    date.setUTCHours(Number(parts.hour), Number(parts.minute), Number(parts.second), 0);
    return date.getTime();
  };
  const naive = wall.getTime();
  const offsets = new Set<number>();
  // Sample both sides of seasonal/date-line transitions, including non-hour shifts.
  for (let hours = -48; hours <= 48; hours++) {
    const sample = naive + hours * 3_600_000;
    offsets.add(partsAt(sample) - sample);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => partsAt(instant) === naive);
  if (!candidates.length) return { error: 'В этой зоне такого местного времени не существует. Выбери другое время.' };
  if (candidates.length > 1) return { error: 'В этой зоне время повторяется при переводе часов. Выбери однозначное время.' };
  return { startsAt: new Date(candidates[0]).toISOString() };
}
