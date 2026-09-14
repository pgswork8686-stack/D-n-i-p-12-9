import { Test, TestingModule } from "@nestjs/testing";
import { DownloadsController } from "./downloads.controller";
import { DownloadsService } from "./downloads.service";
import { AuthGuard } from "../auth/auth.guard";

describe("DownloadsController", () => {
  let controller: DownloadsController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      requestDownload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadsController],
      providers: [
        {
          provide: DownloadsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DownloadsController>(DownloadsController);
  });

  it("delegates to downloadsService.requestDownload", async () => {
    mockService.requestDownload.mockResolvedValue({
      downloadUrl: "https://signed.url",
      fileName: "theme.zip",
      expiresIn: 180,
    });

    const req = {
      user: { id: "u-1" },
      ip: "127.0.0.1",
      headers: { "user-agent": "jest" },
    };

    const dto = {
      entitlementId: "ent-1",
      versionId: "ver-1",
      fileId: "f-1",
    };

    const res = await controller.requestDownload(dto, req);
    expect(res.downloadUrl).toBe("https://signed.url");
    expect(mockService.requestDownload).toHaveBeenCalledWith(
      "u-1",
      dto,
      "127.0.0.1",
      "jest",
    );
  });
});
