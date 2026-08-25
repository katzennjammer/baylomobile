import type { NextConfig } from "next";

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` for styles is required by the inline `style={{...}}` props
 * used throughout the dashboard; `'unsafe-eval'` is NOT granted. `connect-src`
 * includes the Pusher endpoints the realtime client opens and the Nominatim
 * endpoint the pickup map geocodes against — anything not listed cannot be
 * reached from a page, which is what makes the policy worth having.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://res.cloudinary.com https://lh3.googleusercontent.com https://*.tile.openstreetmap.org https://unpkg.com",
  "media-src 'self' blob: https://res.cloudinary.com",
  "font-src 'self' data:",
  "connect-src 'self' https://res.cloudinary.com https://*.pusher.com wss://*.pusher.com https://nominatim.openstreetmap.org",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // Only meaningful over HTTPS; browsers ignore it on plain http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(self), payment=()" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },

  experimental: {
    // Route Handlers have no default body cap, so `await req.formData()` would
    // buffer an arbitrarily large upload into memory before the route's own
    // 10 MB check could run. 12 MB leaves headroom for multipart overhead on a
    // legitimate 10 MB file while still bounding the allocation.
    serverActions: { bodySizeLimit: "12mb" },
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
