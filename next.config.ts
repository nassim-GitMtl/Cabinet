import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Cache Components is intentionally disabled: every authenticated page reads the
// session and tenant-scoped data at request time. We never cache patient,
// clinical or financial data on the server. See docs/ARCHITECTURE.md.
const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  // Self-contained server bundle for the clinic Docker image (no node_modules at runtime).
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
