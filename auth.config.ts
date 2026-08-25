import type { NextAuthConfig } from "next-auth"

// Minimal config safe for Edge runtime (no DB/Node.js-only imports).
// Used only by middleware.ts to verify JWT tokens.
// Full auth config with providers and DB callbacks lives in auth.ts.
export const authConfig = {
  providers: [],
  pages: { signIn: "/auth/login" },
  session: { strategy: "jwt" as const, maxAge: 30 * 24 * 60 * 60 },
} satisfies NextAuthConfig
