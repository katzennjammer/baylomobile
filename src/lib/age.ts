/**
 * The age gate. Baylo is 18+, and this file is where that is true.
 *
 * ── A DATE OF BIRTH IS A CALENDAR FACT, NOT AN INSTANT ──────────────────────
 *
 * It crosses the wire as `"2008-09-03"` and nothing else. The moment a client
 * sends a timestamp instead, a user in UTC+8 born exactly eighteen years ago
 * hands the server a value that lands on the 2nd once it has been parsed in UTC
 * — and for exactly that person, on exactly that day, the difference between
 * the 2nd and the 3rd is the difference between being let in and being refused.
 * `parseDateOfBirth` therefore refuses anything that is not a bare `YYYY-MM-DD`
 * rather than being generous and letting `Date` guess.
 *
 * Stored as a `DATE` column, for the same reason — see `prisma/schema.prisma`.
 *
 * The client does this same arithmetic in `../../baylo-mobile/src/lib/dob.ts`,
 * so that a refusal is instant and legible rather than a round trip. That copy
 * is a convenience; THIS one is the rule. A client-side gate is one anybody
 * skips by calling the endpoint directly.
 */

/** Completed years required to hold an account. */
export const MIN_AGE = 18

/** The oldest date of birth that is accepted as real rather than as a typo. */
export const MAX_AGE = 120

export interface DateParts {
  year: number
  /** 1–12, NOT the 0–11 that `Date` uses. */
  month: number
  day: number
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days in a month, leap years included. `month` is 1-based. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the NEXT month is the last day of this one — the only form of
  // this that needs no leap-year branch of its own.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Parses `YYYY-MM-DD` into parts, or returns null.
 *
 * Null for a wrong shape, a month outside 1–12, a day the month does not have,
 * a date in the future, and a year more than `MAX_AGE` ago. The day check is
 * what makes `2009-02-31` a rejection rather than a silent roll into March,
 * which is what `new Date("2009-02-31")` would do on some engines and NaN on
 * others — neither of which is an answer.
 */
export function parseDateOfBirth(value: string, today = new Date()): DateParts | null {
  const match = ISO_DATE.exec(value.trim())
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null

  const now = todayParts(today)
  // Not in the future, and not implausibly far in the past. The second bound
  // is what stops a mistyped year from being stored as a date nothing else in
  // the system can reason about.
  if (compare({ year, month, day }, now) > 0) return null
  if (year < now.year - MAX_AGE) return null

  return { year, month, day }
}

/** Today in UTC, as parts. The server has one clock and it is this one. */
export function todayParts(today = new Date()): DateParts {
  return {
    year: today.getUTCFullYear(),
    month: today.getUTCMonth() + 1,
    day: today.getUTCDate(),
  }
}

/** Negative if `a` is earlier than `b`, 0 if the same day, positive if later. */
function compare(a: DateParts, b: DateParts): number {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

/**
 * Completed years between two calendar dates.
 *
 * Counts a birthday as reached ON the day, which is what every jurisdiction
 * means by an age. The comparison is on the (month, day) pair rather than on
 * two timestamps, so it cannot be moved by a time zone or by a daylight-saving
 * boundary — the client's copy of this function is written the same way for
 * exactly that reason.
 */
export function ageOn(dob: DateParts, today: DateParts): number {
  let age = today.year - dob.year
  const beforeBirthday =
    today.month < dob.month || (today.month === dob.month && today.day < dob.day)
  if (beforeBirthday) age -= 1
  return age
}

/** True when this date of birth clears the gate today. */
export function isAdult(dob: DateParts, today = new Date()): boolean {
  return ageOn(dob, todayParts(today)) >= MIN_AGE
}

/**
 * The value handed to Prisma for a `DATE` column.
 *
 * Midnight UTC, deliberately. The column stores no time, so the only thing this
 * has to guarantee is that the DATE the driver serialises is the one that was
 * entered — and midnight UTC is the single instant that survives every
 * serialisation the stack does on the way down.
 */
export function toStoredDate(dob: DateParts): Date {
  return new Date(Date.UTC(dob.year, dob.month - 1, dob.day))
}

/** The inverse, for anything that reads the column back out. */
export function fromStoredDate(value: Date): DateParts {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}
