import { auth } from "@/lib/auth"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth")
  const isPublicRoute = req.nextUrl.pathname === "/login" // If we had a login page

  if (!isLoggedIn && !isAuthRoute && !isPublicRoute) {
    return Response.redirect(new URL("/api/auth/signin", req.nextUrl))
  }
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
}
