import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires unsafe-inline/eval in dev; tighten in prod if needed
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://lh3.googleusercontent.com",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@google-cloud/storage", "firebase-admin"],
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async redirects() {
    return [
      {
        source: "/llms.txt",
        destination: "/llm.txt",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // Alias the historical `/mcp` connector URL to the canonical MCP route.
      // Some MCP clients (and existing Claude.ai connectors) were registered
      // against `/mcp`; discovery metadata is served on every path, so OAuth
      // succeeds, but the JSON-RPC POST then hit an HTML 404 ("authorized, but
      // no MCP server was found at the given URL"). Serve the same handler on
      // both paths so either connector URL works.
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/mcp/:path*", destination: "/api/mcp/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/s/:code*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
      {
        source: "/api/documents/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
