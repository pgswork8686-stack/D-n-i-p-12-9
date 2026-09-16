/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@nexus/ui", "@nexus/contracts", "@nexus/sdk", "@nexus/utils"],
};

module.exports = nextConfig;
