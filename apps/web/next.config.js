const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle for the production Docker image.
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@nexus/ui", "@nexus/contracts", "@nexus/sdk"],
  experimental: {
    // Trace workspace packages from the monorepo root.
    outputFileTracingRoot: path.join(__dirname, "../../"),
    workerThreads: false,
    cpus: 1,
  },
};

module.exports = nextConfig;
