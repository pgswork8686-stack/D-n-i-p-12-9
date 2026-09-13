import { NexusApiClient } from "./client";

describe("NexusApiClient", () => {
  let client: NexusApiClient;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = mockFetch;
    client = new NexusApiClient({ baseUrl: "https://api.example.com" });
  });

  describe("getCategoryProducts", () => {
    it("forwards currency and sort query parameters properly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        }),
      });

      await client.getCategoryProducts("wordpress-plugins", {
        currency: "VND",
        sort: "price_asc",
        page: 2,
        limit: 10,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("/categories/wordpress-plugins/products?");
      const url = new URL(callUrl);
      expect(url.searchParams.get("currency")).toBe("VND");
      expect(url.searchParams.get("sort")).toBe("price_asc");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("limit")).toBe("10");
    });
  });

  describe("listPublicProducts", () => {
    it("forwards currency and sort query parameters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        }),
      });

      await client.listPublicProducts({
        currency: "USD",
        sort: "price_desc",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      const url = new URL(callUrl);
      expect(url.searchParams.get("currency")).toBe("USD");
      expect(url.searchParams.get("sort")).toBe("price_desc");
    });
  });
});
