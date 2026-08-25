import { NextResponse } from "next/server"
import { z } from "zod"
import { invalid } from "./envelope"

/**
 * Request-body parsing for /api/v1.
 *
 * The same job as parseBody() in @/lib/validation, with one difference that is
 * the reason this exists: the failure comes back in the v1 envelope. The older
 * helper returns a bare `{ error, issues }`, so a v1 route using it would answer
 * validation failures in one shape and every other failure in another — exactly
 * the two-shapes problem the envelope was introduced to remove.
 *
 * Schemas passed here should be `z.strictObject`, matching the query rule:
 * an unknown FIELD is a client bug for the same reason an unknown parameter is,
 * and silently dropping it means a request that did something other than what
 * it said reports success.
 */

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }

export async function parseJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, response: invalid("Body must be valid JSON") }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.join(".") || "(body)"
    const message =
      issue?.code === "unrecognized_keys"
        ? `Unknown field(s): ${(issue as unknown as { keys: string[] }).keys.join(", ")}`
        : `${field}: ${issue?.message ?? "invalid body"}`
    return { ok: false, response: invalid(message) }
  }

  return { ok: true, data: parsed.data }
}

/**
 * An ISO-8601 instant in the future, as a Date.
 *
 * Coerced through `new Date(...)` rather than accepting an epoch number, so a
 * client that sends `1767225600` (seconds, not milliseconds) gets a 400 instead
 * of a deadline in 1970.
 */
export const futureInstant = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date-time")
  .transform((s) => new Date(s))
