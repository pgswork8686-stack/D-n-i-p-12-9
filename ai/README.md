# ai/ — AI Marketing OS content

This folder holds the **content** of the AI Marketing OS: skills, workflow specs, system
context and evals. The **code** that loads and enforces it lives in `packages/ai-core`.

```text
ai/
  skills/      Agent Skills (one folder per skill, SKILL.md + optional references/, evals/)
  workflows/   Human-readable workflow specs (the executable workflow is code in ai-core)
  contexts/    SYSTEM-level marketing context (seeded into the DB as version 1)
  evals/       Golden datasets used by the ai-core tests
```

## Why content and code are split

| Concern | Lives in | Why |
|---|---|---|
| Skill instructions, scope, security boundary | `ai/skills/*/SKILL.md` | Reviewed like docs, versioned in git, readable by any Agent Skills–compatible tool |
| Skill loading, validation, tool risk policy | `packages/ai-core` | Typed, unit-tested, shared by API and acceptance tests |
| Workflows (`weekly-marketing-review`) | `packages/ai-core/src/workflows` | Workflows decide which tools run; that is a security decision and must be code |
| ORGANIZATION / CLIENT context | Database (`ai_contexts`, `ai_context_versions`) | Per-tenant, edited at runtime, append-only versions, audited |
| SYSTEM context | `ai/contexts/system.json` → DB version 1 | Ships with the product; changes go through code review |

Skills are immutable at runtime. Every execution stores the skill names, the workflow version
and the context version ids it used, so a report can always be traced back to its inputs.

## Skill format

Compatible in spirit with Agent Skills:

```yaml
---
name: marketing-analytics            # = folder name
description: What it does and when to use it (20–1024 chars)
metadata:
  version: 0.1.0                     # semver
  scope: marketing
  risk: READ                         # highest tool risk the skill may use
  tools: [analytics.get_period_measures]
  triggers:
    - "phân tích KPI"
  related: [campaign-analysis]
---
```

The body must contain these sections (validated by `loadSkills`): **Trigger, Scope, Inputs,
Workflow, Output contract, Security boundary, Related skills**. A skill may not reference an
unknown tool, a tool riskier than its declared `risk`, an unknown related skill, or anything
that looks like a secret.

## Safety rules (enforced in code, not by prompt)

1. Tools carry a risk class: `READ`, `WRITE_LOW_RISK`, `WRITE_HIGH_RISK`.
2. `WRITE_HIGH_RISK` never runs without a human approval bound to the exact payload, approved by
   someone other than the requester. Phase 19 high-risk tools are dry-run stubs.
3. There is no tool that executes arbitrary SQL. Analytics tools are fixed, tenant-scoped queries.
4. The tenant comes from the authenticated execution, never from model output.
5. Everything that is not the system prompt (analytics rows, context text, fetched pages) is
   untrusted data and is wrapped with `wrapUntrusted`; instructions inside it are ignored.
6. Inputs, tool calls and outputs are stored redacted (`redactSecretsDeep`).
