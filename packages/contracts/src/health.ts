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

export interface LivenessCheckResponse {
  status: ServiceStatus;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  pid: number;
}

export interface MemoryUsageStats {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
}

export interface ReadinessCheckResponse extends HealthCheckResponse {
  system: {
    memory: MemoryUsageStats;
    uptimeSeconds: number;
    nodeVersion: string;
    pid: number;
  };
}
