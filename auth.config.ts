import type { NextAuthConfig } from "next-auth";
import { ADMIN_AREA_PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Edge-safe portion of the Auth.js configuration.
 *
 * This module MUST NOT import Prisma or any Node-only dependency, because it is
 * bundled into middleware (edge runtime). The Credentials provider (which uses
 * Prisma) lives in ./auth.ts, which is only imported by Node-runtime code.
 *
 * The student-facing platform is anonymous: every portal route and every public
 * API route is reachable without a session. Only `/admin` (and `/login`) require
 * an administrator account.
 */

// Portal routes are public; the API routes carry their own authorization.
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/student/login",
  "/events",
  "/polls",
  "/announcements",
  "/about",
  "/privacy",
  "/accessibility",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
}

const STUDENT_HOME = "/student";
const ADMIN_HOME = "/admin";

export const authConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8, // 8 hours absolute
    updateAge: 60 * 15, // refresh the cookie at most every 15 minutes
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id as string;
        token.roles = (user.roles as string[] | undefined) ?? [];
        token.permissions = (user.permissions as string[] | undefined) ?? [];
        token.sessionVersion = (user.sessionVersion as number | undefined) ?? 0;
        token.userType = (user.userType as string | undefined) ?? "ADMIN";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.roles = (token.roles as string[]) ?? [];
        session.user.permissions = (token.permissions as string[]) ?? [];
        session.user.sessionVersion = (token.sessionVersion as number) ?? 0;
        session.user.userType =
          (token.userType as "ADMIN" | "STUDENT" | undefined) ?? "ADMIN";
      }
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = Boolean(auth?.user?.id);
      const userType = auth?.user?.userType ?? "ADMIN";
      const isStudent = userType === "STUDENT";

      // Signed-in users never see a login screen.
      if (pathname === "/login" || pathname === "/student/login") {
        if (isLoggedIn) {
          return Response.redirect(
            new URL(isStudent ? STUDENT_HOME : ADMIN_HOME, request.nextUrl),
          );
        }
        return true;
      }

      if (isPublicPath(pathname)) return true;

      // Student portal.
      if (pathname === STUDENT_HOME || pathname.startsWith(`${STUDENT_HOME}/`)) {
        if (!isLoggedIn) {
          const url = new URL("/student/login", request.nextUrl);
          url.searchParams.set("callbackUrl", pathname);
          return Response.redirect(url);
        }
        if (!isStudent) {
          return Response.redirect(new URL(ADMIN_HOME, request.nextUrl));
        }
        return true;
      }

      // Everything else (currently only /admin) requires an admin session.
      if (!isLoggedIn) {
        const url = new URL("/login", request.nextUrl);
        if (pathname !== "/") url.searchParams.set("callbackUrl", pathname);
        return Response.redirect(url);
      }

      // Administrative area requires at least one administrative permission.
      if (pathname.startsWith("/admin")) {
        if (isStudent) {
          return Response.redirect(new URL(STUDENT_HOME, request.nextUrl));
        }
        const permissions = auth?.user?.permissions ?? [];
        const allowed = ADMIN_AREA_PERMISSIONS.some((p) =>
          permissions.includes(p),
        );
        if (!allowed) return Response.redirect(new URL("/events", request.nextUrl));
      }

      return true;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;