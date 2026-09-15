/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fase 11: produces .next/standalone — a minimal, self-contained server
  // bundle (only the traced dependencies actually used, not the full
  // node_modules). Dockerfile.prod copies exactly this instead of the
  // whole node_modules tree. Has no effect on `next dev` (Fase 1's dev
  // Dockerfile is unaffected).
  output: 'standalone',
  webpack: (config, { dev }) => {
    // Necesario para que el hot-reload funcione de forma confiable dentro
    // de un volumen Docker en algunos hosts (WSL2, algunos setups de macOS),
    // donde los eventos de filesystem nativos no siempre llegan al contenedor.
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
