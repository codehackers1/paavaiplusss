import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import authConfig from "@/auth.config";
import { prisma } from "@/lib/db/client";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { hashIp } from "@/lib/security/hash";
import { isEncryptionConfigured, decryptSecret } from "@/lib/security/encryption";
import { verifyPassword } from "@/lib/security/passwords";
import {
  clearLoginFailures,
  getLoginRateLimitState,
  identifierHash,
  recordLoginAttempt,
} from "@/lib/security/rate-limit";
import { verifyTotp } from "@/lib/security/totp";
import { recordAudit } from "@/lib/services/audit-service";
import { loginSchema } from "@/lib/validation/auth";

function clientIp(request: Request | undefined): string | null {
  const forwarded = request?.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request?.headers.get("x-real-ip") ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "College email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "Authenticator code", type: "text" },
        loginType: { label: "Login type", type: "text" },
      },
      async authorize(credentials, request) {
        const isStudent = credentials?.loginType === "student";
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.trim().toLowerCase();
        const idHash = identifierHash(email);
        const ipHash = hashIp(clientIp(request));

        const limit = await getLoginRateLimitState(idHash, ipHash);
        if (limit.limited) {
          await recordAudit({
            action: "auth.login.rate_limited",
            outcome: "FAILURE",
            ipHash,
            metadata: { identifier: idHash },
          });
          return null;
        }

        if (isStudent) {
          const student = await prisma.student.findUnique({ where: { email } });

          if (!student || student.status !== "ACTIVE") {
            await recordLoginAttempt(idHash, ipHash, false);
            await recordAudit({
              action: "auth.student.login.failed",
              outcome: "FAILURE",
              ipHash,
              metadata: { identifier: idHash, reason: "unknown_or_inactive" },
            });
            return null;
          }

          const passwordOk = await verifyPassword(
            parsed.data.password,
            student.passwordHash,
          );
          if (!passwordOk) {
            await recordLoginAttempt(idHash, ipHash, false);
            await recordAudit({
              action: "auth.student.login.failed",
              outcome: "FAILURE",
              ipHash,
              metadata: { identifier: idHash, reason: "bad_password" },
            });
            return null;
          }

          await clearLoginFailures(idHash);
          await recordLoginAttempt(idHash, ipHash, true);
          await prisma.student.update({
            where: { id: student.id },
            data: { lastLoginAt: new Date() },
          });
          await recordAudit({
            action: "auth.student.login.succeeded",
            outcome: "SUCCESS",
            ipHash,
            metadata: { studentId: student.id },
          });

          return {
            id: student.id,
            email: student.email,
            name: student.name,
            roles: ["STUDENT"],
            permissions: [],
            sessionVersion: student.sessionVersion,
            userType: "STUDENT",
          };
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            roles: { include: { role: true } },
          },
        });

        // Uniform failure path: never reveal whether the account exists.
        if (!user || user.status !== "ACTIVE") {
          await recordLoginAttempt(idHash, ipHash, false);
          await recordAudit({
            action: "auth.login.failed",
            outcome: "FAILURE",
            ipHash,
            metadata: { identifier: idHash, reason: "unknown_or_inactive" },
          });
          return null;
        }

        const passwordOk = await verifyPassword(
          parsed.data.password,
          user.passwordHash,
        );
        if (!passwordOk) {
          await recordLoginAttempt(idHash, ipHash, false);
          await recordAudit({
            actorUserId: user.id,
            action: "auth.login.failed",
            outcome: "FAILURE",
            ipHash,
          });
          return null;
        }

        if (user.mfaEnabled) {
          const secret =
            user.mfaSecret && isEncryptionConfigured()
              ? decryptSecret(user.mfaSecret)
              : null;
          const code = parsed.data.totp ?? "";
          if (!secret || !verifyTotp(secret, code)) {
            await recordLoginAttempt(idHash, ipHash, false);
            await recordAudit({
              actorUserId: user.id,
              action: "auth.mfa.failed",
              outcome: "FAILURE",
              ipHash,
            });
            return null;
          }
        }

        await clearLoginFailures(idHash);
        await recordLoginAttempt(idHash, ipHash, true);
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await recordAudit({
          actorUserId: user.id,
          action: "auth.login.succeeded",
          outcome: "SUCCESS",
          ipHash,
        });

        const roles = user.roles.map((membership) => membership.role.key);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          roles,
          permissions: permissionsForRoles(roles),
          sessionVersion: user.sessionVersion,
          userType: "ADMIN",
        };
      },
    }),
  ],
});
