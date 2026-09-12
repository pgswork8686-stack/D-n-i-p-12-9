import { generateCorrelationId, normalizeDomain } from "./correlation";

describe("Utils Package", () => {
  it("generates a valid correlation ID with prefix", () => {
    const id = generateCorrelationId("test");
    expect(id).toMatch(/^test_[0-9a-f-]+$/);
  });

  it("normalizes domains properly", () => {
    expect(normalizeDomain("https://my-domain.com/path")).toBe("my-domain.com");
    expect(normalizeDomain("http://sub.domain.vn:8080/")).toBe("sub.domain.vn");
  });
});
