/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@nexus/ui", "@nexus/contracts", "@nexus/sdk"],
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
};

module.exports = nextConfig;
