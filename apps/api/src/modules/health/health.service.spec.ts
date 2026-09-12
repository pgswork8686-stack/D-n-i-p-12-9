import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HealthService } from "./health.service";
import { STORAGE_SERVICE, IStorageService } from "../storage/storage.interface";

describe("HealthService", () => {
  let service: HealthService;

  const mockStorageService: Partial<IStorageService> = {
    isHealthy: jest.fn().mockResolvedValue({
      status: "ok",
      latencyMs: 12,
    }),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue("redis://localhost:6379"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: STORAGE_SERVICE,
          useValue: mockStorageService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should check storage health using storage service", async () => {
    const storageResult = await service.checkStorage();
    expect(storageResult.status).toBe("ok");
    expect(storageResult.latencyMs).toBe(12);
  });
});
