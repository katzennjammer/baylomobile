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
})

export const config = {
  matcher: ["/", "/auth/:path*", "/dashboard/:path*"],
}
