import { NextResponse } from "next/server"

/**
 * The /api/v1 response envelope.
 *
 * Every response — success or failure — is `{ data, error, meta }`. `data` is
 * null on failure, `error` is null on success, and the client never has to
 * branch on shape to find out which happened. That uniformity is the whole
 * point: the existing routes return a bare object on success and
 * `{ error: string }` on failure, so a caller has to know each route's two
 * shapes. Here it knows one.
 *
 * `meta` carries pagination and anything else about the response rather than in
 * it — nextCursor, the filters actually applied. It is always present, `{}` when
 * there is nothing to say.
 */
export interface Envelope<T> {
  data: T | null
  error: { code: ApiErrorCode; message: string } | null
  meta: Record<string, unknown>
}

/**
 * Stable, branchable error codes.
 *
 * The code is the contract: SCREAMING_SNAKE, and it does not change once
 * shipped. `message` is for humans, and may be reworded at any time — a client
 * that branches on message text is broken by design, so the code exists to give
 * it something it is allowed to depend on.
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED:  401,
  FORBIDDEN:        403,
  NOT_FOUND:        404,
  RATE_LIMITED:     429,
  INTERNAL_ERROR:   500,
}

/** A success envelope. `meta` defaults to `{}` rather than being omitted. */
export function ok<T>(data: T, meta: Record<string, unknown> = {}) {
  return NextResponse.json<Envelope<T>>({ data, error: null, meta }, { status: 200 })
}

/**
 * A failure envelope, with the HTTP status that belongs to the code.
 *
 * The status is derived from the code rather than passed alongside it, so the
 * two can never disagree — a 200 carrying `{ error: … }` is exactly the kind of
 * thing this prevents.
 */
export function fail(code: ApiErrorCode, message: string, meta: Record<string, unknown> = {}) {
  return NextResponse.json<Envelope<never>>(
    { data: null, error: { code, message }, meta },
    { status: STATUS[code] },
  )
}

/** 401. The only correct response to a missing or unusable session. */
export const unauthenticated = () =>
  fail("UNAUTHENTICATED", "Sign in to continue")

/**
 * 404 for both "absent" and "not yours".
 *
 * Deliberately not 403. A 403 confirms the row exists, which is a disclosure in
 * itself — the current /api/items/[id] already takes this line for REMOVED and
 * hidden listings, and v1 keeps it.
 */
export const notFound = (what = "Not found") => fail("NOT_FOUND", what)

/** 400 with a human-readable reason. */
export const invalid = (message: string) => fail("VALIDATION_ERROR", message)
