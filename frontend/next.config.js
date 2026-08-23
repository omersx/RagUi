/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output slims the production Docker image (~300MB less node_modules).
  // Enabled only for container builds so local dev/`next start` stays unchanged.
  output: process.env.NEXT_OUTPUT_MODE === "standalone" ? "standalone" : undefined,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Proxy /api to the backend in dev — avoids CORS headaches entirely
    if (process.env.NODE_ENV === "development") {
      const target = process.env.BACKEND_ORIGIN || "http://localhost:8000";
      return [
        {
          source: "/api/:path*",
          destination: `${target}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
