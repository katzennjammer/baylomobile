import NextAuth from "next-auth"
import { authConfig } from "./auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)

export default auth(function proxy(req) {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  if (isLoggedIn && (pathname === "/" || pathname.startsWith("/auth/"))) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  if (!isLoggedIn && pathname.startsWith("/dashboard")) {
    const loginUrl = new URL("/auth/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // /admin is staff-only, and THIS IS NOT THE CHECK THAT ENFORCES THAT.
  //
  // The proxy runs at the edge with no database access: it can read the NextAuth
  // JWT and nothing else, and the JWT does not carry the role. Putting the role
  // in the token would make it a 30-day cached copy of a permission, so a
  // moderator whose access was revoked would keep it until their token expired.
  //
  // So this does the one thing it can do correctly — bounce a signed-out
  // visitor to the login page instead of rendering a shell they cannot use —
  // and the real check happens twice against the database: in
  // src/app/admin/layout.tsx for the pages, and in requireRole() for every
  // /api/admin route. Deleting this block changes nothing about who can read a
  // report.
  if (!isLoggedIn && pathname.startsWith("/admin")) {
    const loginUrl = new URL("/auth/login", req.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }
})

export const config = {
  matcher: ["/", "/auth/:path*", "/dashboard/:path*", "/admin/:path*"],
}
