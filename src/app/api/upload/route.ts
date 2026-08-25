import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import { v2 as cloudinary } from "cloudinary"
import { sanitizeImage } from "@/lib/image-sanitize"
import { enforceRateLimit } from "@/lib/rate-limit-config"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Before formData() — the body is buffered into memory by that call, so a
    // limit applied afterwards has already paid the cost it was meant to avoid.
    const limited = enforceRateLimit("upload", session.user.id)
    if (limited) return limited

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be under 10 MB" }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // The client's declared MIME type is not consulted. sanitizeImage decodes
    // the actual bytes — that is the content check — and re-encodes them
    // WITHOUT metadata, which is what removes the GPS coordinates that phone
    // cameras write into every photo taken at home.
    let sanitized
    try {
      sanitized = await sanitizeImage(buffer)
    } catch {
      return NextResponse.json({ error: "File must be a valid image" }, { status: 415 })
    }

    const result = await new Promise<{ secure_url: string; width: number; height: number }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: "baylo",
          resource_type: "image",
          // Belt and braces on top of the strip above: Cloudinary is told not to
          // retain metadata on its side either.
          image_metadata: false,
        },
        (error, result) => {
          if (error || !result) reject(error)
          else resolve(result as { secure_url: string; width: number; height: number })
        }
      // The sanitised buffer is what gets uploaded, so the ORIGINAL stored by
      // Cloudinary is already metadata-free. Uploading the raw bytes and
      // serving a stripped derivative would leave the original addressable by
      // removing the transformation segment from the delivery URL.
      ).end(sanitized.buffer)
    })

    console.log(`[upload] Cloudinary stored: ${result.width}×${result.height}`)
    return NextResponse.json({ url: result.secure_url, width: result.width, height: result.height })
  } catch (err) {
    console.error("[upload/image] Upload failed:", err instanceof Error ? err.message : "unknown error")
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
