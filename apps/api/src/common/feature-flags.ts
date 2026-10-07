import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  FeatureFlags,
  FeatureName,
  isFeatureEnabled,
  resolveFeatureFlags,
} from "@nexus/utils";

export const FEATURE_KEY = "nexus:feature";

/** Marks a controller/handler as belonging to a feature-flagged module. */
export const RequireFeature = (feature: FeatureName) =>
  SetMetadata(FEATURE_KEY, feature);

/**
 * Global guard: routes of a disabled module behave as if they do not exist
 * (404), so unfinished modules cannot be reached in production.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<FeatureName | undefined>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (feature && !isFeatureEnabled(feature)) {
      throw new NotFoundException();
    }
    return true;
  }
}

@Controller(["features", "v1/features"])
export class FeaturesController {
  /** Public: lets frontends hide navigation for disabled modules. */
  @Get()
  getFeatures(): FeatureFlags {
    return resolveFeatureFlags();
  }
}

export function describeFeatureFlags(): string {
  return Object.entries(resolveFeatureFlags())
    .map(([name, on]) => `${name}=${on ? "on" : "off"}`)
    .join(", ");
}
