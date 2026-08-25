import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import { v2 as cloudinary } from "cloudinary"
import { detectAudioFormat } from "@/lib/image-sanitize"
import { enforceRateLimit } from "@/lib/rate-limit-config"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_AUDIO_BYTES = 10 * 1024 * 1024 // 10 MB ≈ 2 min of webm audio

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Before formData() buffers the body — see the note in ../route.ts.
    const limited = enforceRateLimit("upload", session.user.id)
    if (limited) return limited

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    if (file.size === 0) {
      return NextResponse.json({ error: "No audio was captured" }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: "Voice message must be under 10 MB (approx. 2 minutes)" }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // The old allowlist checked `file.type` and then defeated itself with
    // `|| file.type.startsWith("audio/")`. Either way it read a client-supplied
    // header. This reads the container's magic bytes.
    if (!detectAudioFormat(buffer)) {
      return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 })
    }

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: "baylo/audio", resource_type: "video" },
        (error, result) => {
          if (error || !result) reject(error)
          else resolve(result as { secure_url: string })
        }
      ).end(buffer)
    })

    return NextResponse.json({ url: result.secure_url })
  } catch (err) {
    console.error("[upload/audio] Upload failed:", err instanceof Error ? err.message : "unknown error")
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
