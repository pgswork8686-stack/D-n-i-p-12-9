import { getService, getServiceConsent, listServices, loadConsultOffer } from "../lib/server-api";

const response = (status: number, body: unknown = {}) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe("services catalog fetch semantics", () => {
  const original = process.env.INTERNAL_API_URL;
  beforeAll(() => {
    process.env.INTERNAL_API_URL = "http://api.internal:4000";
  });
  afterAll(() => {
    process.env.INTERNAL_API_URL = original;
  });

  it("returns the published services", async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(200, [{ slug: "api-integration" }]));
    await expect(listServices(fetchFn)).resolves.toEqual([{ slug: "api-integration" }]);
    expect(fetchFn).toHaveBeenCalledWith("http://api.internal:4000/v1/services", { cache: "no-store" });
  });

  it("treats 404 as 'module disabled' so the page can 404 instead of leaking", async () => {
    await expect(listServices(jest.fn().mockResolvedValue(response(404)))).resolves.toBeNull();
  });

  it("throws on 5xx so outages show the error state, not an empty catalog", async () => {
    await expect(listServices(jest.fn().mockResolvedValue(response(503)))).rejects.toThrow("503");
  });

  it("throws on network failures", async () => {
    await expect(listServices(jest.fn().mockRejectedValue(new TypeError("fetch failed")))).rejects.toThrow(
      "Unable to connect",
    );
  });

  it("returns null for unknown or unpublished service slugs and encodes the slug", async () => {
    const fetchFn = jest.fn().mockResolvedValue(response(404));
    await expect(getService("../admin", fetchFn)).resolves.toBeNull();
    expect(fetchFn.mock.calls[0][0]).toBe("http://api.internal:4000/v1/services/..%2Fadmin");
  });

  describe("consent config", () => {
    const ok = { version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy" };

    it("returns the server's version and policy link", async () => {
      const fetchFn = jest.fn().mockResolvedValue(response(200, ok));
      await expect(getServiceConsent(fetchFn)).resolves.toEqual({ version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy" });
      expect(fetchFn).toHaveBeenCalledWith("http://api.internal:4000/v1/service-inquiries/consent", { cache: "no-store" });
    });

    it.each([
      ["a missing version", { privacyPolicyUrl: ok.privacyPolicyUrl }],
      ["a missing policy link", { version: ok.version }],
      ["a javascript: policy link", { ...ok, privacyPolicyUrl: "javascript:alert(1)" }],
      ["a non-URL policy link", { ...ok, privacyPolicyUrl: "privacy" }],
    ])("refuses to render the form with %s", async (_label, body) => {
      await expect(getServiceConsent(jest.fn().mockResolvedValue(response(200, body)))).rejects.toThrow("incomplete");
    });

    it("throws on outages and when the module is off", async () => {
      await expect(getServiceConsent(jest.fn().mockResolvedValue(response(503)))).rejects.toThrow("503");
      await expect(getServiceConsent(jest.fn().mockResolvedValue(response(404)))).rejects.toThrow("404");
    });
  });

  it("throws for service detail outages", async () => {
    await expect(getService("x", jest.fn().mockResolvedValue(response(500)))).rejects.toThrow("500");
  });
});

describe("loadConsultOffer (homepage consultation form)", () => {
  const original = process.env.INTERNAL_API_URL;
  beforeAll(() => {
    process.env.INTERNAL_API_URL = "http://api.internal:4000";
  });
  afterAll(() => {
    process.env.INTERNAL_API_URL = original;
  });

  const consent = { version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy" };
  const route = (table: Record<string, Response>) =>
    jest.fn(async (url: string) => {
      const path = url.replace("http://api.internal:4000", "");
      if (!table[path]) throw new Error(`unexpected ${path}`);
      return table[path];
    }) as unknown as typeof fetch;

  it("offers the form when the custom-build service is active and the consent config is valid", async () => {
    const f = route({
      "/v1/services": response(200, [{ slug: "custom-web-app-development" }, { slug: "ai-chatbot-development" }]),
      "/v1/service-inquiries/consent": response(200, consent),
    });
    await expect(loadConsultOffer(f)).resolves.toEqual({ consent, serviceSlugs: ["custom-web-app-development", "ai-chatbot-development"] });
  });

  it.each([
    ["the Services module is off (404)", { "/v1/services": response(404) }],
    ["the API is failing (503)", { "/v1/services": response(503) }],
    ["the default service is not published", { "/v1/services": response(200, [{ slug: "api-integration" }]) }],
    ["the consent config is missing", { "/v1/services": response(200, [{ slug: "custom-web-app-development" }]), "/v1/service-inquiries/consent": response(404) }],
    ["the consent config is malformed", { "/v1/services": response(200, [{ slug: "custom-web-app-development" }]), "/v1/service-inquiries/consent": response(200, { version: "", privacyPolicyUrl: "x" }) }],
  ])("falls back to null (support CTA) when %s", async (_label, table) => {
    await expect(loadConsultOffer(route(table as Record<string, Response>))).resolves.toBeNull();
  });

  it("never throws, even when the network does", async () => {
    await expect(loadConsultOffer(jest.fn().mockRejectedValue(new TypeError("fetch failed")))).resolves.toBeNull();
  });
});
