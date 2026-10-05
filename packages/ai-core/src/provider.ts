/**
 * Model provider abstraction. Workflows depend on `AiProvider`, never on a vendor SDK, so the
 * provider can be swapped (or disabled) by configuration. Phase 19 workflows are deterministic
 * and stay correct with the default `none` provider; a model, when configured, only writes the
 * optional narrative, and its output is validated before use.
 *
 * Keys come from server-side environment variables only (never NEXT_PUBLIC_*), and are never
 * logged. Endpoints are fixed per provider to avoid SSRF through configuration.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string | null;
  complete(input: { system: string; user: string; maxTokens?: number; signal?: AbortSignal }): Promise<string>;
}

export class NoopProvider implements AiProvider {
  readonly name = "none";
  readonly model = null;
  async complete(): Promise<string> {
    throw new Error("No AI provider configured");
  }
}

const ENDPOINTS = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
} as const;

export type ProviderName = "none" | keyof typeof ENDPOINTS;

export interface ProviderConfig {
  provider: ProviderName;
  model: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

export class ProviderConfigError extends Error {}

/** Reads AI_PROVIDER / AI_MODEL / OPENAI_API_KEY / ANTHROPIC_API_KEY. Fails closed in production. */
export function resolveAiProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const provider = (env.AI_PROVIDER || "none").trim().toLowerCase();
  const isProduction = env.NODE_ENV === "production";
  if (provider !== "none" && provider !== "openai" && provider !== "anthropic") {
    throw new ProviderConfigError(`AI_PROVIDER "${provider}" không được hỗ trợ (none | openai | anthropic)`);
  }
  for (const key of Object.keys(env)) {
    if (/^NEXT_PUBLIC_.*(OPENAI|ANTHROPIC|AI_.*KEY)/i.test(key)) {
      throw new ProviderConfigError(`${key}: khoá AI không được đặt trong biến NEXT_PUBLIC_* (sẽ lộ ra trình duyệt)`);
    }
  }
  const timeoutMs = Math.min(Math.max(Number(env.AI_TIMEOUT_MS) || 30000, 1000), 120000);
  if (provider === "none") return { provider: "none", model: null, apiKey: null, timeoutMs };

  const apiKey = (provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY)?.trim() || null;
  const placeholder = !apiKey || /^(changeme|change-me|placeholder|your[-_]|xxx|test)/i.test(apiKey);
  if (placeholder) {
    if (isProduction) throw new ProviderConfigError(`AI_PROVIDER=${provider} nhưng thiếu khoá API hợp lệ (fail-closed ở production)`);
    return { provider: "none", model: null, apiKey: null, timeoutMs };
  }
  const model = env.AI_MODEL?.trim() || (provider === "openai" ? "gpt-4o-mini" : "claude-sonnet-5-5");
  return { provider, model, apiKey, timeoutMs };
}

export function createProvider(config: ProviderConfig, fetchImpl: typeof fetch = fetch): AiProvider {
  if (config.provider === "none" || !config.apiKey) return new NoopProvider();
  const { provider, model, apiKey, timeoutMs } = config;
  return {
    name: provider,
    model,
    async complete({ system, user, maxTokens = 800, signal }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      signal?.addEventListener("abort", () => controller.abort());
      try {
        const res =
          provider === "openai"
            ? await fetchImpl(ENDPOINTS.openai, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
              })
            : await fetchImpl(ENDPOINTS.anthropic, {
                method: "POST",
                signal: controller.signal,
                headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
              });
        if (!res.ok) throw new Error(`AI provider ${provider} trả về HTTP ${res.status}`);
        const body: any = await res.json();
        const text = provider === "openai" ? body?.choices?.[0]?.message?.content : body?.content?.find?.((c: any) => c.type === "text")?.text;
        if (typeof text !== "string") throw new Error(`AI provider ${provider} trả về dữ liệu không hợp lệ`);
        return text;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
