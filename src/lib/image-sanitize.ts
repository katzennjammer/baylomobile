import sharp from "sharp"

/**
 * Turns an uploaded byte buffer into an image we are willing to store, or
 * throws.
 *
 * Two problems are solved in one pass, because both need the file actually
 * decoded and the decode is the expensive part.
 *
 * CONTENT VALIDATION. The upload routes checked `file.type`, which is the
 * Content-Type the client wrote into its own multipart part — `curl -F
 * 'file=@x.php;type=image/png'` passes that check. sharp either decodes the
 * bytes as an image or it does not, and that is the only opinion worth having.
 *
 * METADATA. sharp does not copy input metadata to its output unless
 * `withMetadata()` is called, so the re-encode below drops EXIF — GPS
 * coordinates included — along with IPTC, XMP and the colour profile.
 *
 * Stripping here rather than at delivery is deliberate and is the difference
 * between the fix working and not working. A Cloudinary eager transformation
 * produces a DERIVED asset with the metadata gone, but the original is still
 * stored and still addressable: the derived URL contains the public id, so
 * deleting the transformation segment from it fetches the untouched original
 * with the EXIF intact. The only way the stored bytes cannot leak a home
 * address is for the bytes we upload not to contain one.
 */

/** Formats we are prepared to decode and re-encode. */
const ALLOWED_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "gif", "avif", "tiff"])

/** Anything larger is re-encoded down; also caps decode cost. */
const MAX_DIMENSION = 4096

export interface SanitizedImage {
  buffer: Buffer
  format: string
  width: number
  height: number
}

export async function sanitizeImage(input: Buffer): Promise<SanitizedImage> {
  // `failOn: "none"` keeps sharp from rejecting images that merely carry
  // warnings; the format check below is what decides acceptance.
  const image = sharp(input, { failOn: "none", limitInputPixels: 268_402_689 })

  let meta: sharp.Metadata
  try {
    meta = await image.metadata()
  } catch {
    throw new Error("not_an_image")
  }

  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new Error("unsupported_format")
  }
  if (!meta.width || !meta.height) {
    throw new Error("not_an_image")
  }

  // `rotate()` with no argument bakes in the EXIF orientation before that tag
  // is discarded. Without it, stripping metadata silently turns every portrait
  // phone photo sideways.
  const pipeline = sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })

  // Re-encode to a concrete format. Animated GIF/WebP would lose their frames
  // in a still re-encode, so they keep their container.
  const output =
    meta.format === "gif" || (meta.format === "webp" && (meta.pages ?? 1) > 1)
      ? pipeline.webp({ quality: 82 })
      : meta.format === "png"
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.jpeg({ quality: 85, mozjpeg: true })

  const { data, info } = await output.toBuffer({ resolveWithObject: true })
  return { buffer: data, format: info.format, width: info.width, height: info.height }
}

/** Audio/video containers we accept, by magic bytes rather than by claim. */
const AUDIO_SIGNATURES: Array<{ name: string; test: (b: Buffer) => boolean }> = [
  { name: "ogg", test: (b) => b.subarray(0, 4).toString("latin1") === "OggS" },
  { name: "webm", test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { name: "mp3", test: (b) => b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { name: "wav", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE" },
  { name: "mp4", test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" },
  { name: "flac", test: (b) => b.subarray(0, 4).toString("latin1") === "fLaC" },
  { name: "aiff", test: (b) => b.subarray(0, 4).toString("latin1") === "FORM" },
]

/**
 * The container an audio buffer actually is, or null.
 *
 * sharp cannot help here, so this reads the signatures directly. It is still a
 * real check on the bytes rather than on the client's claim, which is the
 * property that was missing.
 */
export function detectAudioFormat(input: Buffer): string | null {
  if (input.length < 12) return null
  for (const sig of AUDIO_SIGNATURES) {
    try {
      if (sig.test(input)) return sig.name
    } catch {
      /* malformed buffer — not this format */
    }
  }
  return null
}
