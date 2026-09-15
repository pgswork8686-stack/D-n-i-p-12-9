import { Test, TestingModule } from "@nestjs/testing";
import { UpdatesController } from "./updates.controller";
import { DownloadsService } from "./downloads.service";

describe("UpdatesController", () => {
  let controller: UpdatesController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      checkUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UpdatesController],
      providers: [
        {
          provide: DownloadsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<UpdatesController>(UpdatesController);
  });

  it("delegates checkUpdate to downloadsService", async () => {
    mockService.checkUpdate.mockResolvedValue({
      valid: true,
      updateAvailable: true,
      version: "2.0.0",
      downloadUrl: "https://signed.url",
    });

    const dto = {
      licenseKey: "NXS-1111-2222-3333-4444-5555-6666-7777-8888",
      domain: "example.com",
      productId: "prod-1",
      currentVersion: "1.0.0",
    };
    const req = { ip: "1.2.3.4", headers: { "user-agent": "WordPress/6.4" } };

    const res = await controller.checkUpdate(dto, req);
    expect(res.valid).toBe(true);
    expect(res.updateAvailable).toBe(true);
    expect(mockService.checkUpdate).toHaveBeenCalledWith(dto, "1.2.3.4", "WordPress/6.4");
  });
});
