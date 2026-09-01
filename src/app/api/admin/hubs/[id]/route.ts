import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, notFound, invalid } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { writeAudit } from "@/lib/moderation"
import {
  SAFE_ZONE_HUB_SELECT,
  SAFE_ZONE_TYPE_VALUES,
  v1Hub,
  type SafeZoneHubRow,
} from "@/lib/safe-zones"

export const dynamic = "force-dynamic"

/**
 * PATCH /api/admin/hubs/[id] — edit a hub, or turn it on and off.
 *
 * ONE route rather than /edit and /deactivate, matching
 * /api/admin/listings/[id]: the two halves write the same audit shape, take the
 * same required reason, and touch the same row. Two files would eventually hold
 * two ideas of what a hub is.
 *
 * WHAT DEACTIVATION DOES: sets isActive false. That is the whole mechanism, and
 * everything about the feature falls out of where that flag is read —
 *
 *   GET /api/v1/hubs            filters on it, so the hub leaves the picker and
 *                               nothing can newly select it.
 *   resolveHubIds()             refuses it as a NEW association but permits a
 *                               listing that already had it to keep it.
 *   item detail                 still returns it, with isActive false, so a
 *                               listing offered there says so and is flagged.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: touch ItemSafeZone. Not one row. A listing
 * whose meetup point closed keeps pointing at it — the client strikes it
 * through and the owner picks somewhere else when they next edit. Cascading the
 * deactivation into the join table would be a moderator action that silently
 * rewrites hundreds of other people's listings, and it is unrecoverable: there
 * is no record of which listings used to name the hub, so reactivating it
 * cannot put them back.
 *
 * There is no DELETE. See the note in ../route.ts, and the RESTRICT on the FK
 * that enforces it below the application.
 */

const latSchema = z.number().min(-90).max(90)
const lngSchema = z.number().min(-180).max(180)

/**
 * Every field optional — a PATCH may name any subset — plus a required reason.
 *
 * `.refine` rather than letting an empty patch through: a request that changes
 * nothing still writes an audit row saying a moderator changed something, and a
 * log that records non-events is a log people learn to skim.
 */
const patchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    type: z.enum(SAFE_ZONE_TYPE_VALUES).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    latitude: latSchema.optional(),
    longitude: lngSchema.optional(),
    city: z.string().trim().min(1).max(80).optional(),
    landmark: z
      .string()
      .trim()
      .min(1, "A landmark is required — say which door, desk or court")
      .max(200)
      .optional(),
    isActive: z.boolean().optional(),
    reason: z
      .string()
      .trim()
      .min(1, "A reason is required — it is written to the audit log")
      .max(1000),
  })
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => k !== "reason" && v[k as keyof typeof v] !== undefined,
      ),
    { message: "Nothing to change — send at least one field besides `reason`" },
  )

/**
 * Latitude and longitude move together or not at all.
 *
 * Half a coordinate pair is never a correction, it is a typo mid-edit, and the
 * result is a pin in the sea off Bohol that nobody notices until somebody
 * drives to it. Cheap to refuse, expensive to discover.
 */
function coordinatePairIntact(body: { latitude?: number; longitude?: number }) {
  return (body.latitude === undefined) === (body.longitude === undefined)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response
  const actor = gate.actor

  const { id } = await params
  const parsed = await parseJsonBody(req, patchSchema)
  if (!parsed.ok) return parsed.response
  const { reason, ...changes } = parsed.data

  if (!coordinatePairIntact(changes)) {
    return invalid("Send latitude and longitude together, or neither")
  }

  const before = await prisma.safeZoneHub.findUnique({
    where: { id },
    select: { ...SAFE_ZONE_HUB_SELECT, _count: { select: { items: true } } },
  })
  if (!before) return notFound("Safe-Zone hub not found")

  // Which of the three verbs this is. A toggle of isActive is the interesting
  // one and gets its own audit action, because "who closed this hub, and why"
  // is a different question from "who fixed its address" and searching one log
  // line for both is how the answer gets lost.
  const toggling = changes.isActive !== undefined && changes.isActive !== before.isActive
  const action = toggling
    ? changes.isActive
      ? ("HUB_REACTIVATED" as const)
      : ("HUB_DEACTIVATED" as const)
    : ("HUB_UPDATED" as const)

  // Only the fields that actually moved, so the audit's `detail` reads as a
  // diff rather than a re-statement of the whole row.
  const moved: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(changes) as (keyof typeof changes)[]) {
    const next = changes[key]
    const prev = (before as Record<string, unknown>)[key]
    if (next !== undefined && next !== prev) moved[key] = { from: prev, to: next }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.safeZoneHub.update({
      where: { id },
      // ItemSafeZone is not touched. See the note at the top of this file —
      // that omission is the feature, not an oversight.
      data: changes,
      select: { ...SAFE_ZONE_HUB_SELECT, createdAt: true },
    })
    await writeAudit(tx, {
      actorId: actor.id,
      action,
      targetType: "HUB",
      targetId: id,
      reason,
      detail: {
        name: before.name,
        city: before.city,
        changed: moved,
        // How many listings this decision lands on. Recorded at the moment of
        // the act because it is the number that makes a deactivation
        // proportionate or not, and it will have drifted by the time anyone
        // reads the row.
        itemsAffected: before._count.items,
      },
    })
    return row
  })

  return ok({
    hub: {
      ...v1Hub(updated as SafeZoneHubRow),
      createdAt: updated.createdAt,
      itemCount: before._count.items,
    },
    action,
    audited: true,
  })
}
