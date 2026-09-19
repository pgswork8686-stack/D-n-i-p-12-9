import { NexusApiClient } from "@nexus/sdk";
import { resolveApiUrl } from "@nexus/utils";

export function getApiUrl(): string {
  return resolveApiUrl();
}

export function getApiClient(token?: string | null): NexusApiClient {
  return new NexusApiClient({
    baseUrl: resolveApiUrl(),
    token: token || undefined,
  });
}

export const API_URL = (() => {
  try {
    return resolveApiUrl();
  } catch {
    return "";
  }
})();

