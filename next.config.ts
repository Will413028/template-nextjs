import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  // Do not announce the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
  // cacheComponents stays off: a prerendered shell carries scripts without this request's nonce, which the CSP's
  // 'strict-dynamic' blocks, so the page never hydrates (Next.js CSP guide: PPR is incompatible with nonces).
  async headers() {
    return [
      {
        source: "/(.*)",
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

export default createNextIntlPlugin()(nextConfig);
