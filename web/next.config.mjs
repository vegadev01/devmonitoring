// The browser only ever talks to this origin; /api/* is proxied to the API container.
const API = process.env.API_INTERNAL_URL || "http://localhost:4000";

/** @type {import('next').NextConfig} */
export default {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
};
