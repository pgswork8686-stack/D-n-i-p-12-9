import { NexusApiClient } from "@nexus/sdk";
import { resolveApiUrl } from "@nexus/utils";

export function getApiUrl(): string {
  return resolveApiUrl();
}

export function getApiClient(token?: string | null): NexusApiClient {
  return new NexusApiClient({
    baseUrl: getApiUrl(),
    token: token || undefined,
  });
}

