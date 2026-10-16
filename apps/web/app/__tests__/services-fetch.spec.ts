import { getService, listServices } from "../lib/server-api";

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

  it("throws for service detail outages", async () => {
    await expect(getService("x", jest.fn().mockResolvedValue(response(500)))).rejects.toThrow("500");
  });
});
