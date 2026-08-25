import { tryParseMsg } from "@/lib/chat-helpers"

/**
 * The one place a message becomes a `kind` and a one-line `preview`.
 *
 * Message.content is either plain text or a JSON envelope with a `type`. Four
 * separate files currently reimplement that ladder — and they have already
 * drifted, disagreeing about what an offer_update reads as. The native client
 * is not going to become the fifth: it receives `kind` and `preview` already
 * computed and never parses content itself.
 *
 * `kind` is the stable token to branch on; `preview` is human text that may be
 * reworded at any time.
 */

export type MessageKind =
  | "text"
  | "image"
  | "voice"
  | "offer"
  | "offer_update"
  | "shared_post"

const KNOWN: Record<string, MessageKind> = {
  image: "image",
  voice: "voice",
  audio: "voice",
  offer: "offer",
  offer_update: "offer_update",
  shared_post: "shared_post",
  post: "shared_post",
}

export function describeMessage(content: string): { kind: MessageKind; preview: string } {
  const payload = tryParseMsg(content)

  if (!payload) {
    // Plain text. Collapsed to one line and truncated — a preview is a strip in
    // a list, and newlines in it break the row height.
    const flat = content.replace(/\s+/g, " ").trim()
    return { kind: "text", preview: flat.length > 140 ? `${flat.slice(0, 139)}…` : flat }
  }

  const kind = KNOWN[payload.type] ?? "text"

  switch (kind) {
    case "image": {
      const caption = (payload as { caption?: unknown }).caption
      return {
        kind,
        preview: typeof caption === "string" && caption.trim() ? caption.trim() : "Sent a photo",
      }
    }
    case "voice": {
      const duration = (payload as { duration?: unknown }).duration
      const secs = typeof duration === "number" && duration > 0 ? Math.round(duration) : null
      return { kind, preview: secs ? `Voice message · ${secs}s` : "Voice message" }
    }
    case "offer":
      return { kind, preview: "Sent a trade offer" }
    case "offer_update": {
      const status = (payload as { status?: unknown }).status
      const s = typeof status === "string" ? status.toLowerCase() : null
      return {
        kind,
        preview:
          s === "accepted" ? "Accepted the offer"
          : s === "declined" ? "Declined the offer"
          : "Updated the offer",
      }
    }
    case "shared_post":
      return { kind, preview: "Shared a listing" }
    default: {
      // A `type` this build does not know about. Reported as text with an empty
      // preview rather than leaking the raw JSON envelope into a chat list.
      return { kind: "text", preview: "" }
    }
  }
}
