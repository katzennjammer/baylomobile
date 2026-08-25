import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { markVerified } from "@/lib/verification"
import { rateLimit, clientIp } from "@/lib/rate-limit"
import { RATE_LIMITS } from "@/lib/rate-limit-config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        if (!credentials?.email || !credentials?.password) return null

        // Both this provider and /api/auth/token check the same bcrypt hash in
        // the same column. Rate limiting only the latter left the web callback
        // as an unlimited oracle against every account, which an attacker would
        // simply use instead. Same budget, same key shape, one shared table.
        const email = String(credentials.email).trim().toLowerCase()
        // `request` is documented as present here, but a missing or oddly
        // shaped one must not throw out of authorize() — that would turn the
        // limiter into an availability bug. Falling back to a constant key
        // still limits; it just limits more coarsely.
        let ip = "unknown"
        try {
          const headers = (request as unknown as { headers?: Headers })?.headers
          if (headers && typeof headers.get === "function") {
            ip = clientIp(request as unknown as Request)
          }
        } catch { /* keep "unknown" */ }
        const limit = rateLimit(
          `loginWeb:${ip}:${email}`,
          RATE_LIMITS.loginWeb.limit,
          RATE_LIMITS.loginWeb.windowMs,
        )
        if (!limit.ok) return null

        // Lowercased, matching the native endpoint and the Google exchange.
        const user = await prisma.user.findUnique({ where: { email } })

        if (!user || !user.password) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isValid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.avatar,
        }
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/auth/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const existing = await prisma.user.findUnique({ where: { email: user.email! } })
        if (existing) {
          user.id = existing.id
        } else {
          const created = await prisma.user.create({
            data: {
              name: user.name ?? "Baylo User",
              email: user.email!,
              avatar: user.image,
            },
          })
          user.id = created.id
        }

        // Google sign-in verifies the account. This used to be implicit — a
        // Google user had no password, and "no password" was what the app read
        // as verified. It is now an explicit flag, set here and by the native
        // endpoint, and phone OTP will set the same one.
        //
        // markVerified() also awards VERIFY_ACCOUNT and the one-time signup
        // grant, and is idempotent, so a returning user credits nothing.
        await markVerified(user.id!)
      }
      return true
    },
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token?.id) session.user.id = token.id as string
      return session
    },
  },
})
