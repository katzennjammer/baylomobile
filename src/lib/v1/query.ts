import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { invalid } from "./envelope"

/**
 * Query-string parsing for /api/v1.
 *
 * Two rules, and the second is the one that matters:
 *
 *   1. Every parameter goes through zod, including `cursor` and `limit`.
 *   2. UNKNOWN PARAMETERS ARE REJECTED. Not ignored.
 *
 * Rule 2 is why the schemas here are strict objects. `?catgeory=BOOKS` silently
 * ignored is a filter that did nothing while looking like it did something, and
 * the response — every item, unfiltered — is indistinguishable from a correct
 * one. Failing loudly turns a silent wrong answer into a 400 the client author
 * sees on the first run.
 */

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 50

/**
 * `cursor` and `limit`, shared by every list.
 *
 * limit is coerced from its string form, must be a positive integer, and is
 * CAPPED rather than clamped silently — asking for 500 is a client bug and it
 * gets told so, instead of quietly receiving 50 and paginating on a wrong
 * assumption about page size.
 */
export const paginationShape = {
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(MAX_LIMIT, `limit cannot exceed ${MAX_LIMIT}`)
    .optional()
    .default(DEFAULT_LIMIT),
}

export type ParsedQuery<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }

/**
 * Parses and validates the query string against a strict schema.
 *
 * A repeated parameter (`?limit=1&limit=2`) is rejected rather than resolved by
 * a first-or-last rule, because either rule is a guess about what the caller
 * meant.
 */
export function parseQuery<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): ParsedQuery<z.infer<S>> {
  const sp = req.nextUrl.searchParams
  const raw: Record<string, string> = {}

  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key)
    if (all.length > 1) {
      return {
        ok: false,
        response: invalid(`Repeated query parameter "${key}" — send it once`),
      }
    }
    raw[key] = all[0]
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join(".") || "query"
    // An unrecognised key reads as a plain "unknown parameter" rather than
    // zod's internal wording, since that is the error a client author is most
    // likely to hit and most likely to have caused with a typo.
    const message =
      issue?.code === "unrecognized_keys"
        ? `Unknown query parameter(s): ${(issue as unknown as { keys: string[] }).keys.join(", ")}`
        : `${field}: ${issue?.message ?? "invalid query"}`
    return { ok: false, response: invalid(message) }
  }

  return { ok: true, data: parsed.data }
}
