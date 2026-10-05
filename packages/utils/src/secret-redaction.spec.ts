import { REDACTED, containsSecret, redactSecretText, redactSecretsDeep, summarizeForAudit } from "./secret-redaction";

describe("secret redaction", () => {
  const samples: Record<string, string> = {
    openai: "key is sk-proj-abcdefghijklmnopqrstuvwx1234",
    stripe: "use sk_live_51Habcdefghijkl please",
    webhook: "whsec_abcdefghijklmnop",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    bearer: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    db: "postgresql://postgres:supersecret@db.internal:5432/marketplace",
    license: "NXS-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF",
    assignment: "service_role_key=eyabc123456789",
    aws: "AKIAIOSFODNN7EXAMPLE",
  };

  it.each(Object.entries(samples))("redacts %s values", (_name, text) => {
    expect(containsSecret(text)).toBe(true);
    const out = redactSecretText(text);
    expect(out).toContain(REDACTED);
    expect(containsSecret(out)).toBe(false);
  });

  it("leaves ordinary marketing text untouched", () => {
    const text = "CPL tăng 25% so với tuần trước; kênh google_ads chi 1.200.000đ.";
    expect(containsSecret(text)).toBe(false);
    expect(redactSecretText(text)).toBe(text);
  });

  it("redacts by key and by value in nested structures", () => {
    const out = redactSecretsDeep({
      password: "hunter2",
      nested: { note: "token sk-ant-abcdefghijklmnopqrstuv", rows: [{ apiKey: "x" }, "plain"] },
    });
    expect(out.password).toBe(REDACTED);
    expect(out.nested.note).not.toContain("sk-ant-");
    expect((out.nested.rows[0] as any).apiKey).toBe(REDACTED);
    expect(out.nested.rows[1]).toBe("plain");
  });

  it("truncates oversized audit payloads after redaction", () => {
    const big = { text: "a".repeat(10_000) + " sk-proj-abcdefghijklmnopqrstuvwx" };
    const s = summarizeForAudit(big, 500) as any;
    expect(s.truncated).toBe(true);
    expect(s.preview.length).toBe(500);
    expect(JSON.stringify(summarizeForAudit({ k: "sk-proj-abcdefghijklmnopqrstuvwx" }))).not.toContain("sk-proj-");
  });
});
