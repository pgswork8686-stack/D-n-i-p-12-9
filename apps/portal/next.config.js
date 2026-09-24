/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@nexus/ui", "@nexus/contracts", "@nexus/sdk", "@nexus/utils"],
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
        stream: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
