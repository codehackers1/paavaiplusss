import NextAuth from "next-auth";
import authConfig from "@/auth.config";

/**
 * Edge middleware. Uses only the edge-safe config (no Prisma). API routes are
 * excluded from the matcher and enforce their own authorization server-side.
 */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|txt|xml|woff2?)$).*)",
  ],
};
