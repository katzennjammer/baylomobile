import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { Prisma } from "@/generated/prisma/client"
import { notSuspendedWhere } from "@/lib/moderation"

/**
 * Block enforcement, in the QUERY LAYER.
 *
 * The rule this module exists to make structural: BLOCKED CONTENT NEVER REACHES
 * THE CLIENT. Not "reaches it and is filtered", not "reaches it with a flag the
 * client is asked to honour" — never leaves the database. Post-fetch filtering
 * fails three ways that a WHERE clause does not:
 *
 *   - it puts the blocked user's rows on the wire, where a client bug, a proxy
 *     log or a devtools panel is enough to undo the block;
 *   - it silently shortens pages (fetch 20, filter 3, show 17), so pagination
 *     drifts and "load more" eventually returns an empty page that is not the
 *     end of the list;
 *   - it is opt-in per call site, so the next screen someone writes is
 *     unfiltered by default.
 *
 * BOTH DIRECTIONS, ALWAYS. A block is one row (see the Block model), and every
 * check below asks two questions of it: have I blocked them, and have they
 * blocked me. Either answer hides the content. Enforcing one direction only
 * would mean a harasser keeps seeing the person who blocked them, which is
 * backwards — the person who blocked is the one being protected.
 */

// ── The filter fragments ─────────────────────────────────────────────────────

/**
 * A `where` fragment for a USER relation: "this user is not blocked either way
 * with respect to `viewerId`".
 *
 * Prisma compiles the two `none` conditions into NOT EXISTS subqueries, so this
 * is ONE SQL statement with no prefetch — no round trip to collect block ids,
 * and no `IN (...)` list that grows without bound as a popular account
 * accumulates blockers.
 *
 * Read it as: the candidate has made no block against me, and has received no
 * block from me.
 */
export function userNotBlocked(viewerId: string): Prisma.UserWhereInput {
  return {
    blocksMade: { none: { blockedId: viewerId } },
    blocksReceived: { none: { blockerId: viewerId } },
  }
}

/**
 * The same, expressed on an ITEM: its owner is not blocked either way.
 *
 * This is the fragment the feed, browse and search all spread into their
 * existing `where`. It composes with whatever else is there — status, category,
 * the keyset cursor — because it only adds a constraint on the `user` relation
 * and touches no other key.
 */
export function itemNotBlocked(viewerId: string): Prisma.ItemWhereInput {
  return { user: { is: userNotBlocked(viewerId) } }
}

/**
 * Item visibility for a signed-in viewer, in one fragment.
 *
 * Three things that are always true together on a public read path and were
 * therefore easy to apply separately and get two-thirds right:
 *   - the owner is not blocked either way;
 *   - the owner is not currently suspended;
 *   - a moderator has not taken the listing down.
 *
 * Every feed/browse/search/detail query spreads THIS rather than either half.
 */
export function visibleItemWhere(viewerId: string): Prisma.ItemWhereInput {
  return {
    moderationHiddenAt: null,
    user: {
      is: {
        ...userNotBlocked(viewerId),
        // A suspended seller cannot sign in, so they cannot answer a message,
        // accept an offer or turn up to a meetup. Leaving their listings in the
        // feed would send people to a counterparty who is structurally unable
        // to reply -- and would let a suspension be waited out by an account
        // that kept collecting trade requests the whole time.
        //
        // notSuspendedWhere() and not `suspendedAt: null`: see the note on that
        // function for why the shorthand turns every timed suspension permanent.
        ...notSuspendedWhere(),
      },
    },
  }
}

// ── The point checks ─────────────────────────────────────────────────────────

export type BlockDirection = "none" | "byViewer" | "byOther" | "mutual"

/**
 * Which way, if either, a block runs between two users. ONE query.
 *
 * Returns the direction rather than a boolean because the three cases want
 * different words in front of a human: "You blocked this person", "This
 * conversation is unavailable", and for the blocker's own settings list,
 * an unblock button. A boolean would force each call site to re-query to find
 * out which.
 */
export async function blockDirection(
  viewerId: string,
  otherId: string,
): Promise<BlockDirection> {
  if (viewerId === otherId) return "none"

  const rows = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: otherId },
        { blockerId: otherId, blockedId: viewerId },
      ],
    },
    select: { blockerId: true },
  })

  const byViewer = rows.some((r) => r.blockerId === viewerId)
  const byOther = rows.some((r) => r.blockerId === otherId)
  if (byViewer && byOther) return "mutual"
  if (byViewer) return "byViewer"
  if (byOther) return "byOther"
  return "none"
}

/** True if a block exists in either direction. */
export async function isBlockedEitherWay(viewerId: string, otherId: string): Promise<boolean> {
  return (await blockDirection(viewerId, otherId)) !== "none"
}

/**
 * The gate on every path where one user reaches for another: sending a message,
 * proposing a trade, making an offer.
 *
 * Returns a ready-to-return 403 or null, matching enforceRateLimit() and the
 * reputation gates.
 *
 * ON THE ERROR MESSAGE, which is a real decision and not copy: it is THE SAME
 * TEXT in both directions. A blocker sees "You cannot contact this person" and
 * so does the person they blocked. Telling the blocked party "X has blocked
 * you" hands a harasser a delivery receipt — confirmation that they got under
 * someone's skin, and a signal to switch to a second account. The blocker
 * already knows what they did; the UI they clicked the button in says so. The
 * wire does not need to.
 */
export async function enforceNotBlocked(
  viewerId: string,
  otherId: string,
  what = "contact this person",
): Promise<NextResponse | null> {
  if (!(await isBlockedEitherWay(viewerId, otherId))) return null
  return NextResponse.json(
    { error: `You cannot ${what}.`, code: "BLOCKED" },
    { status: 403 },
  )
}

// ── What a block deliberately does NOT do ────────────────────────────────────

/**
 * The trades and contracts that survive a block, for the confirmation the
 * blocker is shown.
 *
 * BLOCKING MID-TRADE DOES NOT CANCEL THE TRADE, AND BLOCKING A CREDITOR DOES
 * NOT VOID THE DEBT. Both are reversals, and this system does not do reversals:
 * see the note on the DeferredContract model, which cannot even express getting
 * an item back, because the item changed hands at a meetup and no software here
 * can recover it.
 *
 * The concrete failure being avoided is not hypothetical. If a block cancelled
 * an active trade, then blocking would be a unilateral undo button for a deal
 * the other party has already handed over goods for. If a block voided a
 * Deferred Points Agreement, then BLOCKING YOUR CREDITOR WOULD BE HOW YOU CLEAR
 * A DEBT — one tap, and a contract the tier system, the deadline sweep and the
 * default record are all built around evaporates. Every debtor would find that
 * within a week.
 *
 * So the line is drawn at NEW EXPOSURE, not existing obligation:
 *
 *   REFUSED after a block   messaging, new trade requests, new offers, seeing
 *                           each other's listings — everything that starts
 *                           something.
 *   UNCHANGED after a block the trade's own state machine (accept, confirm,
 *                           complete, cancel), the DPA's balance, deadline,
 *                           extension, sweep, default and auto-payment.
 *
 * Which leaves one honest rough edge, named here rather than discovered later:
 * two people mid-handover who can no longer message each other. That is the
 * blocker's own choice and it is recoverable — the in-person confirmation codes
 * do not need chat, either party may still cancel the trade, and unblocking
 * restores messaging — so it is a worse experience for the blocker, not a trap.
 * The alternative, letting a block be selectively porous "just for this trade",
 * reopens exactly the channel someone blocked to close.
 *
 * This function exists so the block route can SAY all that at the moment it
 * matters, with the actual trade and contract in front of the user.
 */
export async function blockConsequences(viewerId: string, otherId: string) {
  const [trades, contracts] = await Promise.all([
    prisma.tradeRequest.findMany({
      where: {
        status: { in: ["PENDING", "ACCEPTED", "CONFIRMING"] },
        OR: [
          { senderId: viewerId, receiverId: otherId },
          { senderId: otherId, receiverId: viewerId },
        ],
      },
      select: {
        id: true,
        status: true,
        requestedItem: { select: { title: true } },
        offeredItem: { select: { title: true } },
      },
    }),
    prisma.deferredContract.findMany({
      where: {
        status: { in: ["PENDING_ACCEPT", "ACTIVE", "DEFAULTED"] },
        OR: [
          { debtorId: viewerId, creditorId: otherId },
          { debtorId: otherId, creditorId: viewerId },
        ],
      },
      select: {
        id: true,
        status: true,
        amountLeaves: true,
        amountPaidLeaves: true,
        deadline: true,
        debtorId: true,
      },
    }),
  ])

  return {
    activeTrades: trades.map((t) => ({
      id: t.id,
      status: t.status,
      // Named so the warning can be specific: "your trade for X is unaffected".
      offeredItem: t.offeredItem.title,
      requestedItem: t.requestedItem.title,
    })),
    openContracts: contracts.map((c) => ({
      id: c.id,
      status: c.status,
      outstanding: c.amountLeaves - c.amountPaidLeaves,
      deadline: c.deadline,
      youOwe: c.debtorId === viewerId,
    })),
  }
}
