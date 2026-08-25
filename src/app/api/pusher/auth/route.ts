import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import pusher from "@/lib/pusher"

/** `presence-chat-<idA>-<idB>`, ids sorted. See the parse in POST below. */
const PRESENCE_CHAT_PREFIX = "presence-chat-"

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // pusher-js on the web posts application/x-www-form-urlencoded; the native
  // SDK posts JSON. Parsing JSON as a query string does not fail loudly — it
  // succeeds and yields one nonsense key, so socket_id and channel_name both
  // come back empty and the request 403s on the channel check below, which
  // looks like an authorisation problem rather than a parsing one.
  const contentType = req.headers.get("content-type") ?? ""
  let socketId = ""
  let channelName = ""

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null)
    if (body && typeof body === "object") {
      const b = body as Record<string, unknown>
      if (typeof b.socket_id === "string") socketId = b.socket_id
      if (typeof b.channel_name === "string") channelName = b.channel_name
    }
  } else {
    const params = new URLSearchParams(await req.text())
    socketId = params.get("socket_id") ?? ""
    channelName = params.get("channel_name") ?? ""
  }

  if (!socketId || !channelName) {
    return NextResponse.json({ error: "socket_id and channel_name are required" }, { status: 400 })
  }

  const myId = session.user.id

  // Exact equality. Every message, offer and trade event is published to the
  // recipient's own `private-user-<id>` channel, so this one comparison is what
  // stands between a caller and someone else's private traffic.
  const isOwnPrivate = channelName === `private-user-${myId}`

  // Presence pair channels are `presence-chat-<idA>-<idB>` with the two ids
  // sorted. The previous check was `channelName.includes(myId)` — a substring
  // test, which authorises any channel name that happens to contain the
  // caller's id anywhere in it. That held only by accident: cuids are all the
  // same length, so one cannot be a substring of another. Parsing the name and
  // requiring the caller to be one of the two named participants does not
  // depend on that accident.
  const isPresencePair = (() => {
    if (!channelName.startsWith(PRESENCE_CHAT_PREFIX)) return false
    const parts = channelName.slice(PRESENCE_CHAT_PREFIX.length).split("-")
    if (parts.length !== 2) return false
    const [a, b] = parts
    if (!a || !b || a === b) return false
    // Canonical ordering, so one conversation is one channel rather than two.
    if ([a, b].slice().sort().join("-") !== `${a}-${b}`) return false
    return a === myId || b === myId
  })()

  if (!isOwnPrivate && !isPresencePair) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (channelName.startsWith("presence-")) {
    const authData = pusher.authorizeChannel(socketId, channelName, {
      user_id: myId,
      user_info: { name: session.user.name ?? "" },
    })
    return NextResponse.json(authData)
  }

  const authData = pusher.authorizeChannel(socketId, channelName)
  return NextResponse.json(authData)
}
