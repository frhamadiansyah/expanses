/**
 * When a capture says it happened.
 *
 * A notification is stamped by the phone, so a printed date is only ever better information — and only when it is
 * whole. Nothing here guesses a year or an order that was not printed: a partial date is not a date, and the caller
 * falls back to when the capture arrived.
 */

/** Month names and abbreviations, both languages, by their first three letters. */
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  mei: 5,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  agu: 8,
  ags: 8,
  sep: 9,
  oct: 10,
  okt: 10,
  nov: 11,
  dec: 12,
  des: 12,
};

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function monthOf(token: string): number | null {
  return MONTHS[token.toLowerCase().slice(0, 3)] ?? null;
}

function valid(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2999) return false;
  if (month < 1 || month > 12) return false;
  // A day the month does not have is a misread, not a date: 30 February is no day to file money on.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

function timeOf(hourText: string | undefined, minuteText: string | undefined, meridiem: string | undefined): string | null {
  if (hourText === undefined || minuteText === undefined) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === 'pm';
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 23) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

interface Candidate {
  at: number;
  iso: string;
}

/** Every ISO-ish shape of a date, as a pattern with the parts it captured. */
const PATTERNS: readonly { source: RegExp; read: (m: RegExpExecArray) => { year: number; month: number; day: number; time: string | null } | null }[] = [
  {
    // 2026-09-29, with an optional time.
    source: /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?/g,
    read: (m) => ({
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      time: timeOf(m[4], m[5], undefined),
    }),
  },
  {
    // 29 Sep 2026 · 29 September 2026, with an optional time after it — a bullet between the two is still one stamp.
    source: /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:[,\s•·|]+(?:pukul\s+|jam\s+|at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AaPp][Mm]))?)?/g,
    read: (m) => {
      const month = monthOf(m[2] ?? '');
      return month === null ? null : { year: Number(m[3]), month, day: Number(m[1]), time: timeOf(m[4], m[5], m[6]) };
    },
  },
  {
    // Sep 29, 2026, with an optional time after it.
    source: /([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})(?:[,\s•·|]+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([AaPp][Mm]))?)?/g,
    read: (m) => {
      const month = monthOf(m[1] ?? '');
      return month === null ? null : { year: Number(m[3]), month, day: Number(m[2]), time: timeOf(m[4], m[5], m[6]) };
    },
  },
  {
    // 29/09/2026 — day first, the order this part of the world writes, with an optional time.
    source: /(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::\d{2})?)?/g,
    read: (m) => ({ year: Number(m[3]), month: Number(m[2]), day: Number(m[1]), time: timeOf(m[4], m[5], undefined) }),
  },
];

/**
 * The first date the text printed, as `YYYY-MM-DDTHH:mm` — or `YYYY-MM-DD` when no time was printed — and null when
 * it printed none.
 *
 * The earliest match in the text wins, whichever spelling it used, because the first date on a receipt is when the
 * receipt is for; a later "printed 12/01/2027" under it is about the paper, not the money.
 */
export function findDateTime(text: string): string | null {
  const candidates: Candidate[] = [];
  for (const { source, read } of PATTERNS) {
    const pattern = new RegExp(source.source, source.flags);
    let match = pattern.exec(text);
    while (match !== null) {
      const parts = read(match);
      if (parts && valid(parts.year, parts.month, parts.day)) {
        const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
        candidates.push({ at: match.index, iso: parts.time === null ? date : `${date}T${parts.time}` });
      }
      match = pattern.exec(text);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0]!.iso;
}

/**
 * The day a capture happened on, where the owner was.
 *
 * The phone stamps a capture with its own offset (`2026-09-30T06:30:00+07:00`), and the day is the one written there:
 * cutting the string is right, and turning it into UTC first is what filed every capture before seven in the morning
 * on the day before. A stamp written in UTC (`…Z`) carries no local day of its own, so it is read as the day on this
 * device, which is where it was captured.
 */
export function capturedDayOf(iso: string): string {
  if (!/Z$/i.test(iso)) return iso.slice(0, 10);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso.slice(0, 10);
  return `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
