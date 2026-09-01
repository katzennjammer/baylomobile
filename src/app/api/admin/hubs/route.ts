import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { parseQuery } from "@/lib/v1/query"
import { writeAudit } from "@/lib/moderation"
import {
  SAFE_ZONE_HUB_SELECT,
  SAFE_ZONE_TYPE_VALUES,
  v1Hub,
  type SafeZoneHubRow,
} from "@/lib/safe-zones"

export const dynamic = "force-dynamic"

/**
 * The admin hub surface.
 *
 *   GET  /api/admin/hubs — every hub, active and not, with listing counts.
 *   POST /api/admin/hubs — create one.
 *
 * THERE IS NO DELETE, HERE OR IN [id]. Deactivation is the only way a hub
 * leaves circulation, because a DELETE would take the ItemSafeZone rows with it
 * and every listing offered there would silently lose the only answer it had to
 * "where would we meet?". The database backs this up rather than trusting the
 * route: ItemSafeZone.hubId is ON DELETE RESTRICT, so the same rule holds for
 * somebody at a SQL prompt.
 *
 * WHY A HUB WRITE IS AUDITED AT ALL. Every other AdminAction row is about a
 * person or their content; these are about shared infrastructure. But a hub
 * coordinate that quietly moved 400 metres, with no record of who moved it, is
 * a worse failure than most takedowns — people navigate to these places, and
 * the first sign of trouble is two strangers standing in different car parks.
 * `reason` is required for the same reason it is everywhere else in this tree.
 */

// ── GET ──────────────────────────────────────────────────────────────────────

const querySchema = z.strictObject({
  city: z.string().trim().min(1).max(80).optional(),
  /** "active" | "inactive" | omitted for both. */
  status: z.enum(["active", "inactive"]).optional(),
})

export async function GET(req: NextRequest) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { city, status } = parsed.data

  const rows = await prisma.safeZoneHub.findMany({
    where: {
      ...(city ? { city } : {}),
      ...(status ? { isActive: status === "active" } : {}),
    },
    select: {
      ...SAFE_ZONE_HUB_SELECT,
      createdAt: true,
      // The number an admin needs before deactivating anything: how many
      // listings are about to be flagged unavailable. Deactivating a hub with
      // 200 listings on it and deactivating an empty one are very different
      // acts, and the queue should not make them look the same.
      _count: { select: { items: true } },
    },
    orderBy: [{ city: "asc" }, { name: "asc" }],
  })

  return ok({
    hubs: rows.map((r) => ({
      ...v1Hub(r as SafeZoneHubRow),
      createdAt: r.createdAt,
      itemCount: r._count.items,
    })),
  })
}

// ── POST ─────────────────────────────────────────────────────────────────────

/**
 * Coordinate bounds are the full legal range, not a box around Cebu.
 *
 * A Philippines-shaped bounding box would catch a transposed lat/lng today and
 * reject the first hub in another country later, and the second failure lands
 * on somebody who has no idea a box exists. Range-checking is validation;
 * geography is a product decision that does not belong in a zod schema.
 */
const latSchema = z.number().min(-90).max(90)
const lngSchema = z.number().min(-180).max(180)

const createSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  type: z.enum(SAFE_ZONE_TYPE_VALUES),
  address: z.string().trim().min(1).max(300),
  latitude: latSchema,
  longitude: lngSchema,
  city: z.string().trim().min(1).max(80),
  // Required, and min(1) after trimming. See the schema note: "meet at the
  // mall" is not a meeting point, and an optional landmark is a landmark
  // nobody fills in.
  landmark: z
    .string()
    .trim()
    .min(1, "A landmark is required — say which door, desk or court")
    .max(200),
  /**
   * Defaults TRUE. A hub created through this route is one somebody just typed
   * out on purpose; making them flip a second switch to make it real would only
   * produce hubs that exist and are invisible.
   */
  isActive: z.boolean().optional().default(true),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required — it is written to the audit log")
    .max(1000),
})

export async function POST(req: NextRequest) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response
  const actor = gate.actor

  const parsed = await parseJsonBody(req, createSchema)
  if (!parsed.ok) return parsed.response
  const { reason, ...hub } = parsed.data

  // Two hubs with the same name in the same city are almost always a second
  // admin adding one that already exists, and the cost of the false positive is
  // one reworded name. Not a unique index: "Barangay Basak Hall" legitimately
  // exists in both Lapu-Lapu and Mandaue, and a constraint that has to encode
  // that is a constraint that will be wrong about the next pair.
  const clash = await prisma.safeZoneHub.findFirst({
    where: { name: hub.name, city: hub.city },
    select: { id: true },
  })
  if (clash) {
    return conflict(`A hub named "${hub.name}" already exists in ${hub.city}`, {
      code: "DUPLICATE_HUB",
      hubId: clash.id,
    })
  }

  // The row and its audit entry in ONE transaction. An audit row written
  // afterwards on its own connection can fail to exist for a change that did
  // happen, and a log with holes invites the reader to trust the rows that are
  // there.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.safeZoneHub.create({
      data: hub,
      select: { ...SAFE_ZONE_HUB_SELECT, createdAt: true },
    })
    await writeAudit(tx, {
      actorId: actor.id,
      action: "HUB_CREATED",
      targetType: "HUB",
      targetId: row.id,
      reason,
      // The whole hub as created. These are coordinates people walk to; the
      // audit records what they were on day one so a later "it moved" has
      // something to be measured against.
      detail: {
        name: row.name,
        type: row.type,
        city: row.city,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        landmark: row.landmark,
        isActive: row.isActive,
      },
    })
    return row
  })

  return ok(
    { hub: { ...v1Hub(created as SafeZoneHubRow), createdAt: created.createdAt, itemCount: 0 }, audited: true },
  )
}
