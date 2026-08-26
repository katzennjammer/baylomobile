import { NextRequest } from "next/server"
import { z } from "zod"
import { Prisma } from "@/generated/prisma/client"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, cursorDate } from "@/lib/v1/cursor"
import { describeMessage } from "@/lib/v1/message-preview"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/messages/conversations — the conversation list.
 *
 * TWO queries. This endpoint exists because the screen it replaces does not
 * have one: messages/page.tsx pulls EVERY message the viewer has ever sent or
 * received, joins both user rows onto each, and dedupes to a conversation list
 * in JavaScript. It is the worst thing in the audit, and it gets worse linearly
 * with use.
 *
 *   1  raw: latest message id per partner, with a correlated unread count,
 *      keyset-paginated on (lastAt, partnerId), blocked partners excluded by a
 *      NOT EXISTS inside the grouping subquery
 *   2  hydrate exactly those message rows with their two participants
 *
 * The first is raw SQL and that is not a lapse from the plain-Prisma rule that
 * governs /home. "Latest row per group" has no Prisma expression — the
 * alternatives are a correlated subquery per conversation (an N+1) or fetching
 * everything and reducing in memory, which is precisely the bug being removed.
 * The raw statement is fully parameterised; no value is interpolated.
 */

const querySchema = z.strictObject({ ...paginationShape })

/** One row of the grouping query. */
interface ThreadRow {
  partnerId: string
  lastAt: Date
  lastMessageId: string
  unreadCount: bigint | number
}

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  const cAt = cursorDate(cursor)
  const cId = cursor?.id ?? null

  // ── 1 ── one row per partner: when the thread last moved, which message that
  // was, and how many of theirs are still unread.
  //
  // The keyset is (lastAt, partnerId). partnerId is the tiebreaker, so two
  // threads whose last message landed in the same millisecond still paginate
  // without dropping or repeating either.
  const threads = await prisma.$queryRaw<ThreadRow[]>`
    SELECT
      t.partnerId AS partnerId,
      t.lastAt    AS lastAt,
      (SELECT m2.id FROM Message m2
        WHERE (m2.senderId = ${viewerId} AND m2.receiverId = t.partnerId)
           OR (m2.receiverId = ${viewerId} AND m2.senderId = t.partnerId)
        ORDER BY m2.createdAt DESC, m2.id DESC
        LIMIT 1) AS lastMessageId,
      (SELECT COUNT(*) FROM Message m3
        WHERE m3.receiverId = ${viewerId}
          AND m3.senderId = t.partnerId
          AND m3.read = 0) AS unreadCount
    FROM (
      SELECT
        CASE WHEN m.senderId = ${viewerId} THEN m.receiverId ELSE m.senderId END AS partnerId,
        MAX(m.createdAt) AS lastAt
      FROM Message m
      WHERE (m.senderId = ${viewerId} OR m.receiverId = ${viewerId})
        -- Blocked threads are HIDDEN, NOT DELETED. The messages stay in the
        -- table (a moderator reading a harassment report needs them); the
        -- thread stops appearing in either party's list.
        --
        -- This is a NOT EXISTS inside the grouping subquery, and the placement
        -- is the point: filtering after the GROUP BY would still let a blocked
        -- partner consume one of the limit-plus-one rows, silently shortening
        -- the page and breaking the (lastAt, partnerId) keyset promise that a
        -- full page means there is more. Filtered here, the blocked partner is
        -- never a group at all.
        --
        -- Both directions, one clause: the pair is checked whichever way round
        -- the block was made.
        AND NOT EXISTS (
          SELECT 1 FROM Block b
          WHERE (b.blockerId = ${viewerId}
                 AND b.blockedId = CASE WHEN m.senderId = ${viewerId} THEN m.receiverId ELSE m.senderId END)
             OR (b.blockedId = ${viewerId}
                 AND b.blockerId = CASE WHEN m.senderId = ${viewerId} THEN m.receiverId ELSE m.senderId END)
        )
      GROUP BY partnerId
    ) t
    WHERE ${
      cAt && cId
        ? Prisma.sql`(t.lastAt < ${cAt} OR (t.lastAt = ${cAt} AND t.partnerId < ${cId}))`
        : Prisma.sql`1 = 1`
    }
    ORDER BY t.lastAt DESC, t.partnerId DESC
    LIMIT ${limit + 1}
  `

  const hasMore = threads.length > limit
  const pageThreads = hasMore ? threads.slice(0, limit) : threads
  const lastRow = pageThreads[pageThreads.length - 1]
  const nextCursor =
    hasMore && lastRow ? encodeCursor(new Date(lastRow.lastAt), lastRow.partnerId) : null

  if (pageThreads.length === 0) {
    return ok({ conversations: [] }, { nextCursor: null })
  }

  // ── 2 ── hydrate exactly those messages. Both participants come along, so the
  // partner is picked in memory rather than costing a third query.
  const messages = await prisma.message.findMany({
    where: { id: { in: pageThreads.map((t) => t.lastMessageId) } },
    select: {
      id: true,
      content: true,
      createdAt: true,
      senderId: true,
      tradeId: true,
      sender: { select: { id: true, name: true, avatar: true } },
      receiver: { select: { id: true, name: true, avatar: true } },
    },
  })
  const byId = new Map(messages.map((m) => [m.id, m]))

  const conversations = pageThreads.flatMap((t) => {
    const m = byId.get(t.lastMessageId)
    if (!m) return [] // partner with no readable last message; skip rather than emit a hole
    const partner = m.sender.id === viewerId ? m.receiver : m.sender
    const { kind, preview } = describeMessage(m.content)
    return [
      {
        partner,
        lastMessage: {
          id: m.id,
          kind,
          preview,
          fromMe: m.senderId === viewerId,
          createdAt: m.createdAt,
        },
        unreadCount: Number(t.unreadCount),
        tradeId: m.tradeId,
      },
    ]
  })

  return ok({ conversations }, { nextCursor })
}
