/**
 * Opaque keyset cursors.
 *
 * A cursor encodes the sort key of the last row on the page PLUS that row's id.
 * Both halves are load-bearing. Sorting on a timestamp alone breaks the moment
 * two rows share one — offset pagination drops or repeats rows on ties, and a
 * bare `createdAt < :last` filter skips every sibling of the boundary row. The
 * id is the tiebreaker that makes the ordering total, so a page boundary always
 * falls between two distinct rows.
 *
 * It is base64url of JSON, and it is opaque ON PURPOSE. Clients must treat it as
 * a token: the day the sort key changes, a client that parsed it breaks, and a
 * client that echoed it back does not.
 */

export interface Keyset {
  /** The sort key of the last row of the page — ISO date string or a number. */
  k: string | number
  /** That row's id: the tiebreaker that makes the ordering total. */
  id: string
}

export function encodeCursor(key: string | number | Date, id: string): string {
  const k = key instanceof Date ? key.toISOString() : key
  return Buffer.from(JSON.stringify({ k, id }), "utf8").toString("base64url")
}

/**
 * Decodes a cursor, or returns null if it is malformed.
 *
 * Null means "reject the request", never "start from the beginning". A garbled
 * cursor that silently restarted pagination would look to a client like an
 * infinite list that never advances, which is far harder to diagnose than a 400.
 */
export function decodeCursor(raw: string | null | undefined): Keyset | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!parsed || typeof parsed !== "object") return null
    const { k, id } = parsed as Record<string, unknown>
    if (typeof id !== "string" || !id) return null
    if (typeof k !== "string" && typeof k !== "number") return null
    return { k, id }
  } catch {
    return null
  }
}

/** A decoded cursor whose sort key is a Date, or null when it is not usable. */
export function cursorDate(c: Keyset | null): Date | null {
  if (!c || typeof c.k !== "string") return null
  const d = new Date(c.k)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Slices one extra row off a page fetched with `take: limit + 1`.
 *
 * Fetching one more row than asked for is how "is there a next page?" gets
 * answered without a second COUNT query. The extra row is dropped from the
 * response and only its existence is reported.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => string,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  return {
    page,
    nextCursor: hasMore && last ? toCursor(last) : null,
  }
}

/**
 * The keyset WHERE clause for a descending (newest-first) createdAt sort.
 *
 * Reads as: strictly older than the boundary row, or exactly as old but with a
 * smaller id. Returns undefined for the first page so it can be spread into a
 * `where` unconditionally.
 */
export type OlderThanClause = {
  OR: [
    { createdAt: { lt: Date } },
    { AND: [{ createdAt: Date }, { id: { lt: string } }] },
  ]
}

export function olderThan(c: Keyset | null): OlderThanClause | undefined {
  const d = cursorDate(c)
  if (!d || !c) return undefined
  return {
    OR: [
      { createdAt: { lt: d } },
      { AND: [{ createdAt: d }, { id: { lt: c.id } }] },
    ],
  }
}
