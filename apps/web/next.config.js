/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
