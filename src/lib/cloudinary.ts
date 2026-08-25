/**
 * Inject Cloudinary transformation params into a stored URL so images are
 * served at the right size with automatic format (WebP/AVIF) and quality.
 * Pass `unoptimized` on the Next.js <Image> when using this — Cloudinary
 * already handles optimisation, double-proxying degrades quality.
 */
export function cloudinaryUrl(
  url: string,
  opts: { w?: number; h?: number; crop?: "fill" | "fit" | "limit" } = {}
): string {
  if (!url || !url.includes("res.cloudinary.com")) return url;
  // Avoid double-transforming if we already injected params
  if (/\/upload\/[^/]*(?:f_|q_|w_|h_)/.test(url)) return url;

  const parts: string[] = ["f_auto", "q_auto:good"];
  if (opts.w) parts.push(`w_${opts.w}`);
  if (opts.h) parts.push(`h_${opts.h}`);
  if (opts.crop) parts.push(`c_${opts.crop}`);

  return url.replace(/\/upload\//, `/upload/${parts.join(",")}/`);
}
