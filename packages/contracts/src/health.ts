export type ServiceStatus = "ok" | "error";

export interface DependencyHealth {
  status: ServiceStatus;
  latencyMs?: number;
  message?: string;
}

export interface HealthCheckResponse {
  status: ServiceStatus;
  service: string;
  version?: string;
  timestamp: string;
  dependencies?: {
    database?: DependencyHealth;
    redis?: DependencyHealth;
    storage?: DependencyHealth;
    [key: string]: DependencyHealth | undefined;
  };
}
