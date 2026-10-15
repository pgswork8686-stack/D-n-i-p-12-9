import { GUARDS_METADATA } from "@nestjs/common/constants";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { FEATURE_KEY, FeatureFlagGuard } from "../../common/feature-flags";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../auth/require-permissions.decorator";
import { AuthGuard } from "../auth/auth.guard";
import { PermissionsGuard } from "../auth/permissions.guard";
import { OptionalAuthGuard } from "./optional-auth.guard";
import {
  AdminServiceInquiriesController,
  AdminServiceProjectsController,
  AdminServicesController,
  AdminServiceStaffController,
  MyServiceInquiriesController,
  MyServiceProjectsController,
  PublicServiceInquiriesController,
  PublicServicesController,
} from "./services.controllers";

const ALL = [
  PublicServicesController,
  PublicServiceInquiriesController,
  MyServiceInquiriesController,
  MyServiceProjectsController,
  AdminServicesController,
  AdminServiceInquiriesController,
  AdminServiceProjectsController,
  AdminServiceStaffController,
];

const ADMIN: any[] = [AdminServicesController, AdminServiceInquiriesController, AdminServiceProjectsController, AdminServiceStaffController];

function handlerNames(ctrl: any): string[] {
  return Object.getOwnPropertyNames(ctrl.prototype).filter((n) => n !== "constructor");
}

describe("Services controllers: authorization wiring", () => {
  it("gates every controller behind the services feature flag", () => {
    for (const ctrl of ALL) {
      expect(Reflect.getMetadata(FEATURE_KEY, ctrl)).toBe("services");
    }
  });

  it("protects customer controllers with AuthGuard", () => {
    for (const ctrl of [MyServiceInquiriesController, MyServiceProjectsController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, ctrl)).toEqual([AuthGuard]);
    }
  });

  it("protects admin controllers with AuthGuard + PermissionsGuard and a permission on every handler", () => {
    for (const ctrl of ADMIN) {
      expect(Reflect.getMetadata(GUARDS_METADATA, ctrl)).toEqual([AuthGuard, PermissionsGuard]);
      for (const name of handlerNames(ctrl)) {
        const perms = Reflect.getMetadata(PERMISSIONS_KEY, ctrl.prototype[name]);
        expect({ handler: `${ctrl.name}.${name}`, perms }).toEqual({
          handler: `${ctrl.name}.${name}`,
          perms: expect.arrayContaining([expect.any(String)]),
        });
      }
    }
  });

  it("requires manage permissions for every mutating admin handler", () => {
    const mutating: Array<[any, string, string[]]> = [
      [AdminServicesController, "create", ["service.manage"]],
      [AdminServicesController, "update", ["service.manage"]],
      [AdminServiceInquiriesController, "update", ["inquiry.manage"]],
      [AdminServiceInquiriesController, "convert", ["inquiry.manage", "project.manage"]],
      [AdminServiceProjectsController, "update", ["project.manage"]],
      [AdminServiceProjectsController, "assign", ["project.manage"]],
      [AdminServiceProjectsController, "unassign", ["project.manage"]],
      [AdminServiceProjectsController, "createMilestone", ["project.manage"]],
      [AdminServiceProjectsController, "updateMilestone", ["project.manage"]],
      [AdminServiceProjectsController, "postMessage", ["project.manage"]],
      [AdminServiceProjectsController, "uploadDocument", ["project.manage"]],
    ];
    for (const [ctrl, name, perms] of mutating) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, ctrl.prototype[name])).toEqual(perms);
    }
  });

  it("uses the optional guard on the public inquiry form", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicServiceInquiriesController)).toEqual([OptionalAuthGuard]);
  });
});

describe("OptionalAuthGuard", () => {
  const ctx = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it("lets anonymous requests through without calling AuthGuard", async () => {
    const inner = { canActivate: jest.fn() };
    const guard = new OptionalAuthGuard(inner as any);
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(inner.canActivate).not.toHaveBeenCalled();
  });

  it("rejects an invalid token instead of downgrading to anonymous", async () => {
    const inner = { canActivate: jest.fn().mockRejectedValue(new UnauthorizedException()) };
    const guard = new OptionalAuthGuard(inner as any);
    await expect(guard.canActivate(ctx({ authorization: "Bearer bad" }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe("services feature flag", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const ctxFor = (ctrl: any) =>
    ({ getHandler: () => ctrl.prototype.list, getClass: () => ctrl }) as any;

  it("returns 404 for services routes when FEATURE_SERVICES is off", () => {
    process.env.FEATURE_SERVICES = "false";
    const guard = new FeatureFlagGuard(new Reflector());
    expect(() => guard.canActivate(ctxFor(PublicServicesController))).toThrow(NotFoundException);
  });

  it("allows services routes when FEATURE_SERVICES is on", () => {
    process.env.FEATURE_SERVICES = "true";
    const guard = new FeatureFlagGuard(new Reflector());
    expect(guard.canActivate(ctxFor(PublicServicesController))).toBe(true);
  });
});
