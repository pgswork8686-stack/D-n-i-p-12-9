import * as fs from "fs";
import * as path from "path";
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import {
  AiProvider,
  LoadedSkill,
  MarketingPorts,
  ToolRegistry,
  createMarketingToolRegistry,
  createProvider,
  loadSkills,
  resolveAiProviderConfig,
} from "@nexus/ai-core";

/** Ports are bound per execution; the registry built here only serves metadata (names, risks). */
const NO_PORTS: MarketingPorts = new Proxy({} as MarketingPorts, {
  get: () => async () => {
    throw new Error("metadata-only registry");
  },
});

export function resolveSkillsDir(): string | null {
  const candidates = [
    process.env.AI_SKILLS_DIR,
    path.resolve(__dirname, "../../../../../ai/skills"), // apps/api/dist/modules/ai → repo root
    path.resolve(__dirname, "../../../../ai/skills"), // ts-node from apps/api/src/modules/ai
    path.resolve(process.cwd(), "ai/skills"),
    path.resolve(process.cwd(), "../../ai/skills"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Loads skills and the AI provider once at boot.
 * - Invalid skill files are a code defect → the API refuses to start.
 * - Missing skills directory or an unsafe provider configuration in production disables only
 *   the AI feature (503), so commerce keeps working; nothing silently falls back to unsafe mode.
 */
@Injectable()
export class AiRuntimeService implements OnModuleInit {
  private readonly logger = new Logger("AiRuntime");
  private skills: LoadedSkill[] = [];
  private provider: AiProvider = createProvider({ provider: "none", model: null, apiKey: null, timeoutMs: 30000 });
  private disabledReason: string | null = null;
  readonly metadataRegistry: ToolRegistry = createMarketingToolRegistry(NO_PORTS);

  onModuleInit() {
    const dir = resolveSkillsDir();
    if (!dir) {
      this.disabledReason = "Không tìm thấy thư mục ai/skills (đặt AI_SKILLS_DIR)";
      this.logger.error(this.disabledReason);
    } else {
      this.skills = loadSkills(dir, this.metadataRegistry.risks());
      this.logger.log(`Loaded ${this.skills.length} AI skills from ${dir}`);
    }
    try {
      const cfg = resolveAiProviderConfig(process.env);
      this.provider = createProvider(cfg);
      this.logger.log(`AI provider: ${cfg.provider}${cfg.model ? ` (${cfg.model})` : ""}`);
    } catch (err: any) {
      this.disabledReason = `Cấu hình AI không an toàn: ${err.message}`;
      this.logger.error(this.disabledReason);
    }
  }

  assertEnabled() {
    if (this.disabledReason) throw new ServiceUnavailableException(`Tính năng AI đang tắt: ${this.disabledReason}`);
  }

  getSkills(): LoadedSkill[] {
    return this.skills;
  }

  getProvider(): AiProvider {
    return this.provider;
  }

  status() {
    return { enabled: !this.disabledReason, reason: this.disabledReason, provider: this.provider.name, model: this.provider.model, skills: this.skills.length };
  }
}
