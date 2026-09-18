import { NexusApiClient } from "@nexus/sdk";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function getApiClient(token?: string | null): NexusApiClient {
  return new NexusApiClient({
    baseUrl: API_URL,
    token: token || undefined,
  });
}

export { API_URL };
