/**
 * Allowlist for image URLs that the server will fetch, or hand to a third party
 * to fetch on its behalf.
 *
 * `imageUrl` on the AI routes is request body — a string an attacker writes.
 * Passing it to fetch() makes this server an HTTP client aimed wherever the
 * caller likes: cloud instance metadata at 169.254.169.254, anything bound to
 * localhost, anything inside the VPC. Passing it to Anthropic's URL image
 * source does the same thing with someone else's fetcher and our API key.
 *
 * The check is an allowlist and not a blocklist on purpose. Blocking known-bad
 * hosts loses to DNS names that resolve to loopback, IPv6 forms, decimal-encoded
 * IPs and redirects. Requiring the host to be exactly the Cloudinary delivery
 * domain, over https, on our own cloud's path, has no such surface: the only
 * URLs that pass are ones our own upload route produced.
 */

const CLOUDINARY_HOST = "res.cloudinary.com"

export interface UrlCheck {
  ok: boolean
  /** Safe to return to the caller — names no internal detail. */
  reason?: string
}

/**
 * True only for `https://res.cloudinary.com/<our-cloud>/...`.
 *
 * Rejects any other host, any other scheme, embedded credentials, and an
 * explicit port. Credentials and ports are rejected rather than ignored because
 * `https://res.cloudinary.com@127.0.0.1/` is a URL whose host is 127.0.0.1, and
 * a reader skimming for "res.cloudinary.com" will not notice.
 */
export function isAllowedImageUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, reason: "imageUrl must be a URL string" }
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "imageUrl is not a valid URL" }
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "imageUrl must use https" }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "imageUrl must not contain credentials" }
  }
  if (url.port) {
    return { ok: false, reason: "imageUrl must not specify a port" }
  }
  if (url.hostname.toLowerCase() !== CLOUDINARY_HOST) {
    return { ok: false, reason: "imageUrl must be a Cloudinary delivery URL" }
  }

  // Pin to our own cloud as well as the host. Cloudinary serves every customer
  // from this one domain, so the host alone still leaves the server fetching
  // arbitrary strangers' assets on request.
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  if (cloudName) {
    const firstSegment = url.pathname.split("/").filter(Boolean)[0]
    if (firstSegment !== cloudName) {
      return { ok: false, reason: "imageUrl must be a Cloudinary delivery URL" }
    }
  }

  return { ok: true }
}

/**
 * fetch() for an allowlisted image URL.
 *
 * `redirect: "manual"` is load-bearing: without it Cloudinary — or anyone who
 * can get a URL onto that host — could 302 the server to an internal address,
 * and the allowlist would have checked only the first hop. A 3xx is treated as
 * a failure, not followed.
 *
 * Throws a bare Error. Callers must not put its message, or the URL, in a
 * response or a log line: both are attacker-controlled and the difference
 * between failure modes is what turns a blocked SSRF into a working port
 * scanner.
 */
export async function fetchAllowedImage(url: string, timeoutMs = 10_000): Promise<Buffer> {
  const check = isAllowedImageUrl(url)
  if (!check.ok) throw new Error("blocked")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { redirect: "manual", signal: controller.signal })
    if (res.status >= 300 && res.status < 400) throw new Error("blocked")
    if (!res.ok) throw new Error("unavailable")
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}
