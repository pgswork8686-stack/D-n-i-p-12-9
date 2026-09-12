import { Test, TestingModule } from "@nestjs/testing";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { AUTH_SERVICE } from "../auth/auth.constants";
import { DevMockAuthProvider } from "@nexus/auth";
import { Request } from "express";

describe("QueueController", () => {
  let controller: QueueController;

  const mockQueueService = {
    dispatchTestJob: jest.fn().mockResolvedValue({
      jobId: "job_123",
      correlationId: "req_test",
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: AUTH_SERVICE,
          useValue: new DevMockAuthProvider(),
        },
      ],
    }).compile();

    controller = module.get<QueueController>(QueueController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("dispatches test job with valid type", async () => {
    const mockReq = { correlationId: "req_test" } as Request;
    const result = await controller.dispatchTestJob(mockReq, {
      type: "system-ping",
      payload: { test: true },
    });

    expect(result.status).toBe("enqueued");
    expect(result.jobId).toBe("job_123");
  });

  it("rejects disallowed job type", async () => {
    const mockReq = { correlationId: "req_test" } as Request;
    await expect(
      controller.dispatchTestJob(mockReq, {
        type: "malicious-type",
      }),
    ).rejects.toThrow("Invalid job type");
  });
});
