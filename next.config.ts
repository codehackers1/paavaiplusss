import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Anchor Next's build tracing to THIS repo so it is never confused by
  // stray lockfiles elsewhere on the drive.
  outputFileTracingRoot: path.join(__dirname),
  // Native / engine-backed packages must stay external to the server bundler.
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
  // Linting is run explicitly via `npm run lint`; it must not gate the
  // production build (see README "Verification").
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Sensible security headers for a college-only deployment. A reverse proxy
  // or platform may add HSTS; documented in SECURITY.md.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
