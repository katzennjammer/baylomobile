import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import Anthropic from "@anthropic-ai/sdk"
import { isAllowedImageUrl } from "@/lib/safe-image-url"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { imageUrlSchema, parseBody } from "@/lib/validation"

// Presence only. This used to log the key's first 12 characters at module load;
// that is `sk-ant-api03` for every key Anthropic issues, so it disclosed no
// secret, but it also answered no question that a boolean does not.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[identify] ANTHROPIC_API_KEY is not set — item identification will fail")
}

const anthropic = new Anthropic()

const VALID_CATEGORIES = ["ELECTRONICS","CLOTHING","BAGS","BEAUTY","ACCESSORIES","FURNITURE","BOOKS","GAMING","SPORTS","BIKES","TOYS","TOOLS","MUSIC","ART","COLLECTIBLES","PETS","PLANTS","FOOD","SERVICES","OTHER"]
const VALID_CONDITIONS  = ["NEW","LIKE_NEW","GOOD","FAIR","POOR"]

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Every call bills a vision request to our Anthropic account.
  const limited = enforceRateLimit("aiIdentify", session.user.id)
  if (limited) return limited

  const parsed = await parseBody(req, imageUrlSchema)
  if (!parsed.ok) return parsed.response
  const { imageUrl } = parsed.data

  // The URL is handed to Anthropic's own fetcher. Without this check the
  // endpoint is a request proxy: an attacker names any host, and our API key
  // pays for the fetch. Checked before the call, not inside the try — a blocked
  // URL is a bad request, not an AI failure.
  const allowed = isAllowedImageUrl(imageUrl)
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason }, { status: 400 })
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: imageUrl },
          },
          {
            type: "text",
            text: `Identify this item for a secondhand trade marketplace listing. Return ONLY valid JSON — no markdown, no code fences, no explanation:
{"name":"<concise item name, max 6 words>","category":"<ELECTRONICS|CLOTHING|BAGS|BEAUTY|ACCESSORIES|FURNITURE|BOOKS|GAMING|SPORTS|BIKES|TOYS|TOOLS|MUSIC|ART|COLLECTIBLES|PETS|PLANTS|FOOD|SERVICES|OTHER>","condition":"<NEW|LIKE_NEW|GOOD|FAIR|POOR>","tags":["<tag1>","<tag2>","<tag3>"]}`,
          },
        ],
      }],
    })

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : ""
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : {}

    return NextResponse.json({
      name:      typeof result.name === "string" ? result.name : "",
      category:  VALID_CATEGORIES.includes(result.category as string) ? result.category : "OTHER",
      condition: VALID_CONDITIONS.includes(result.condition as string) ? result.condition : "GOOD",
      tags:      Array.isArray(result.tags) ? (result.tags as unknown[]).filter(t => typeof t === "string").slice(0, 5) : [],
    })
  } catch (e) {
    // The exception stays server-side. It previously went back to the caller as
    // `_error: String(e)`, which hands out upstream status codes and API error
    // bodies to anyone who can provoke a failure.
    console.error("[identify] AI call failed:", e instanceof Error ? e.message : "unknown error")
    return NextResponse.json({ name: "", category: "OTHER", condition: "GOOD", tags: [] })
  }
}
