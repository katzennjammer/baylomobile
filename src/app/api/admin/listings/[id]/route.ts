import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, notFound, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { writeAudit } from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/listings/[id] — hide or restore a listing.
 *
 * ONE route with an `action`, not /hide and /unhide, so the two halves cannot
 * drift: they write the same audit shape, take the same required reason, and
 * flip the same single column. Two files would eventually have two idea of what
 * "hidden" means.
 *
 * WHAT HIDING DOES: sets Item.moderationHiddenAt. That is the whole mechanism.
 * Every read path in the app already filters `moderationHiddenAt: null` in its
 * WHERE clause (see visibleItemWhere() in @/lib/blocking), so one column write
 * removes the listing from the feed, browse, search, both profile screens, item
 * detail, offers and trade initiation at once.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   It does not touch `status`. The owner's own lifecycle (AVAILABLE, OWNED,
 *   IN_TRADE, TRADED) is theirs and a takedown must not silently rewrite it —
 *   restoring the listing would otherwise have to guess what it used to be.
 *   The prior status goes into the audit row's `detail` regardless, because
 *   "what did this look like before we touched it" is the question an appeal
 *   asks.
 *
 *   It does not cancel a trade the item is in. Same reasoning as blocking: the
 *   item may already have changed hands at a meetup, and this system has no
 *   mechanism that could recover it. See the note on the DeferredContract model.
 *   A moderator who needs the trade stopped has to say so to the parties; the
 *   database will not pretend it can undo a physical handover.
 */

const bodySchema = z.strictObject({
  action: z.enum(["hide", "unhide"]),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required — it is written to the audit log")
    .max(1000),
  /** The report this answers, if it came from the queue. */
  reportId: z.string().min(1).max(64).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response
  const actor = gate.actor

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const { action, reason, reportId } = parsed.data

  const item = await prisma.item.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, userId: true, moderationHiddenAt: true },
  })
  if (!item) return notFound("Listing not found")

  const alreadyHidden = item.moderationHiddenAt !== null
  if (action === "hide" && alreadyHidden) {
    return conflict("That listing is already hidden", { code: "ALREADY_HIDDEN" })
  }
  if (action === "unhide" && !alreadyHidden) {
    return conflict("That listing is not hidden", { code: "NOT_HIDDEN" })
  }

  const now = new Date()

  // The column write and the audit row in ONE transaction. An audit row written
  // afterwards on its own connection is one that can fail to exist for a change
  // that did happen, and a moderation log with holes invites the reader to
  // trust the rows that are there.
  await prisma.$transaction(async (tx) => {
    await tx.item.update({
      where: { id },
      data: { moderationHiddenAt: action === "hide" ? now : null },
    })
    await writeAudit(tx, {
      actorId: actor.id,
      action: action === "hide" ? "LISTING_HIDDEN" : "LISTING_UNHIDDEN",
      targetType: "LISTING",
      targetId: id,
      reportId: reportId ?? null,
      reason,
      // The listing as it read at the moment of the takedown. The title in
      // particular: an owner who edits it afterwards would otherwise leave the
      // audit row pointing at an id and nothing a human recognises.
      detail: {
        title: item.title,
        ownerId: item.userId,
        // Recorded, never written. See the note above on why `status` is left
        // alone — this is here so an appeal can see what it was.
        statusAtAction: item.status,
        previousModerationHiddenAt: item.moderationHiddenAt,
      },
    })
  })

  return ok({
    listing: { id, moderationHiddenAt: action === "hide" ? now : null },
    audited: true,
  })
}
