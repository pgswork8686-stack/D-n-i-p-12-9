import { generateCorrelationId } from "./correlation";

describe("Utils Package - Correlation", () => {
  it("generates a valid correlation ID with prefix", () => {
    const id = generateCorrelationId("test");
    expect(id).toMatch(/^test_[0-9a-f-]+$/);
  });
});

