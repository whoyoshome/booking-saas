/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle copied by Dockerfile.prod; no effect on `next dev`.
  output: 'standalone',
  webpack: (config, { dev }) => {
    // Polling keeps hot reload working on Docker volumes where native
    // filesystem events do not reach the container (WSL2, some macOS setups).
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
