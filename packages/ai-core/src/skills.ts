import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { AiSkillDto, AiToolRisk } from "@nexus/contracts";
import { containsSecret } from "@nexus/utils";
import { parseFrontmatter } from "./frontmatter";
import { isRisk, RISK_ORDER } from "./risk";

/**
 * Agent Skills loader. A skill is a folder `ai/skills/<name>/` with a SKILL.md (frontmatter +
 * markdown body) and optional references/, scripts/, assets/, evals/. Skills are versioned with
 * the code (git) and immutable at runtime; executions record name + version + content hash.
 */
export const REQUIRED_SKILL_SECTIONS = [
  "Trigger",
  "Scope",
  "Inputs",
  "Workflow",
  "Output contract",
  "Security boundary",
  "Related skills",
] as const;

export interface LoadedSkill extends AiSkillDto {
  body: string;
  dir: string;
}

export class SkillValidationError extends Error {}

const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function parseSkill(source: string, dir: string, knownTools: Set<string>): LoadedSkill {
  const { data, body } = parseFrontmatter(source);
  const name = data.name;
  const description = data.description;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const where = `skill ${typeof name === "string" ? name : dir}`;

  if (typeof name !== "string" || !NAME_RE.test(name)) throw new SkillValidationError(`${where}: invalid name`);
  if (path.basename(dir) !== name) throw new SkillValidationError(`${where}: folder name must equal skill name`);
  if (typeof description !== "string" || description.length < 20 || description.length > 1024) {
    throw new SkillValidationError(`${where}: description must be 20-1024 characters`);
  }
  const version = meta.version;
  if (typeof version !== "string" || !SEMVER_RE.test(version)) throw new SkillValidationError(`${where}: metadata.version must be x.y.z`);
  const declaredRisk = meta.risk;
  if (!isRisk(declaredRisk)) throw new SkillValidationError(`${where}: metadata.risk must be READ | WRITE_LOW_RISK | WRITE_HIGH_RISK`);
  const tools = Array.isArray(meta.tools) ? (meta.tools as string[]) : [];
  for (const tool of tools) {
    if (!knownTools.has(tool)) throw new SkillValidationError(`${where}: unknown tool "${tool}"`);
  }
  const triggers = Array.isArray(meta.triggers) ? (meta.triggers as string[]) : [];
  if (triggers.length === 0) throw new SkillValidationError(`${where}: metadata.triggers must list at least one trigger`);
  for (const section of REQUIRED_SKILL_SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, "mi").test(body)) throw new SkillValidationError(`${where}: missing "## ${section}" section`);
  }
  if (containsSecret(source)) throw new SkillValidationError(`${where}: skill files must not contain secrets`);

  return {
    name,
    description,
    version,
    scope: typeof meta.scope === "string" ? meta.scope : "marketing",
    triggers,
    tools,
    maxRisk: declaredRisk as AiToolRisk,
    related: Array.isArray(meta.related) ? (meta.related as string[]) : [],
    contentHash: crypto.createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex"),
    body,
    dir,
  };
}

/** Loads and validates every skill under `skillsDir`; also checks tool risk and related links. */
export function loadSkills(skillsDir: string, toolRisks: Map<string, AiToolRisk>): LoadedSkill[] {
  if (!fs.existsSync(skillsDir)) throw new SkillValidationError(`skills directory not found: ${skillsDir}`);
  const knownTools = new Set(toolRisks.keys());
  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(skillsDir, d.name);
      const file = path.join(dir, "SKILL.md");
      if (!fs.existsSync(file)) throw new SkillValidationError(`skill ${d.name}: SKILL.md missing`);
      return parseSkill(fs.readFileSync(file, "utf8"), dir, knownTools);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const names = new Set(skills.map((s) => s.name));
  for (const skill of skills) {
    for (const rel of skill.related) {
      if (!names.has(rel)) throw new SkillValidationError(`skill ${skill.name}: related skill "${rel}" does not exist`);
    }
    // A skill may not use a tool riskier than it declares.
    for (const tool of skill.tools) {
      const risk = toolRisks.get(tool)!;
      if (RISK_ORDER[risk] > RISK_ORDER[skill.maxRisk]) {
        throw new SkillValidationError(`skill ${skill.name}: tool "${tool}" is ${risk} but the skill declares ${skill.maxRisk}`);
      }
    }
  }
  return skills;
}

export function toSkillDto(skill: LoadedSkill): AiSkillDto {
  const { body: _body, dir: _dir, ...dto } = skill;
  return dto;
}
