import { processSystemJob } from "./processor";
import { Job } from "bullmq";
import { SystemJobPayload } from "@nexus/contracts";

describe("Worker Processor", () => {
  it("processes system job successfully and returns result", async () => {
    const mockJob = {
      id: "job_12345",
      name: "test-ping",
      data: {
        jobId: "job_12345",
        type: "test-ping",
        correlationId: "req_abc123",
        timestamp: new Date().toISOString(),
      },
    } as unknown as Job<SystemJobPayload>;

    const result = await processSystemJob(mockJob);
    expect(result.success).toBe(true);
    expect(result.jobId).toBe("job_12345");
    expect(result.processedAt).toBeDefined();
  });
});
