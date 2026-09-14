import { Test, TestingModule } from "@nestjs/testing";
import { AdminVersionsController } from "./admin-versions.controller";
import { DownloadsService } from "./downloads.service";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";

describe("AdminVersionsController", () => {
  let controller: AdminVersionsController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      createVersion: jest.fn(),
      listVersions: jest.fn(),
      getVersion: jest.fn(),
      addFile: jest.fn(),
      publishVersion: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminVersionsController],
      providers: [
        {
          provide: DownloadsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminVersionsController>(AdminVersionsController);
  });

  it("creates a product version", async () => {
    mockService.createVersion.mockResolvedValue({ id: "v-1", version: "1.0.0" });
    const req = { user: { id: "admin-1" } };

    const res = await controller.createVersion("prod-1", { version: "1.0.0" }, req);
    expect(res.id).toBe("v-1");
    expect(mockService.createVersion).toHaveBeenCalledWith("prod-1", { version: "1.0.0" }, "admin-1");
  });

  it("lists product versions", async () => {
    mockService.listVersions.mockResolvedValue([{ id: "v-1", version: "1.0.0" }]);
    const res = await controller.listVersions("prod-1");
    expect(res).toHaveLength(1);
    expect(mockService.listVersions).toHaveBeenCalledWith("prod-1");
  });

  it("gets product version", async () => {
    mockService.getVersion.mockResolvedValue({ id: "v-1" });
    const res = await controller.getVersion("v-1");
    expect(res.id).toBe("v-1");
  });

  it("adds file to product version", async () => {
    mockService.addFile.mockResolvedValue({ id: "f-1" });
    const req = { user: { id: "admin-1" } };
    const res = await controller.addFile("v-1", { fileName: "plugin.zip" }, req);
    expect(res.id).toBe("f-1");
    expect(mockService.addFile).toHaveBeenCalledWith("v-1", { fileName: "plugin.zip" }, "admin-1");
  });

  it("publishes product version", async () => {
    mockService.publishVersion.mockResolvedValue({ success: true });
    const req = { user: { id: "admin-1" } };
    const res = await controller.publishVersion("v-1", req);
    expect(res.success).toBe(true);
    expect(mockService.publishVersion).toHaveBeenCalledWith("v-1", "admin-1");
  });
});
