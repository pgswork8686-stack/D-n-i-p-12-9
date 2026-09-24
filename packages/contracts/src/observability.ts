export interface StructuredLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  correlationId: string;
  service: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  ip?: string;
  userAgent?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface SecurityHeadersConfig {
  contentSecurityPolicy?: string;
  strictTransportSecurity?: string;
  xContentTypeOptions: "nosniff";
  xFrameOptions: "DENY" | "SAMEORIGIN";
  xXssProtection: string;
  referrerPolicy: string;
  permissionsPolicy: string;
}

export interface DisasterRecoverySnapshot {
  snapshotId: string;
  timestamp: string;
  databaseName: string;
  format: "gzip" | "pg_dump_custom";
  sizeBytes: number;
  sha256Checksum: string;
  storagePath: string;
  verified: boolean;
}

export interface CutoverChecklistSummary {
  phase:
    | "PRE_CUTOVER"
    | "MAINTENANCE_WINDOW"
    | "DATA_MIGRATION"
    | "DNS_SWITCH"
    | "POST_CUTOVER_VERIFY";
  rpoMinutesTarget: number;
  rtoMinutesTarget: number;
  allChecksPassed: boolean;
  timestamp: string;
}
