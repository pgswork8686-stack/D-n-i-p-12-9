export interface SystemJobPayload {
  jobId: string;
  type: string;
  correlationId: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface SystemJobResult {
  success: boolean;
  jobId: string;
  processedAt: string;
}
