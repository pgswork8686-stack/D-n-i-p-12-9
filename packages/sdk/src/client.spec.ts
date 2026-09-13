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

  describe("commerce endpoints", () => {
    it("getCart queries /cart with currency parameter", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "cart-1", items: [] }),
      });

      const res = await client.getCart("VND");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain("/cart?currency=VND");
      expect(res.id).toBe("cart-1");
    });

    it("checkout sends POST to /checkout", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: { id: "ord-1", orderNumber: "ORD-123" },
          payment: { id: "pay-1" },
        }),
      });

      const res = await client.checkout({ currency: "USD" });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [callUrl, options] = mockFetch.mock.calls[0];
      expect(callUrl).toBe("https://api.example.com/checkout");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ currency: "USD" });
      expect(res.order.id).toBe("ord-1");
    });

    it("simulateTestPayment sends callback payload to /payments/test-callback", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          duplicate: false,
          paymentStatus: "SUCCEEDED",
          orderStatus: "PAID",
          message: "Payment event processed successfully",
        }),
      });

      const res = await client.simulateTestPayment({
        paymentId: "pay-1",
        externalEventId: "evt-123",
        eventType: "payment.succeeded",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [callUrl, options] = mockFetch.mock.calls[0];
      expect(callUrl).toBe("https://api.example.com/payments/test-callback");
      expect(options.method).toBe("POST");
      expect(res.orderStatus).toBe("PAID");
    });
  });
});

