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

  describe("phase 19 analytics & AI endpoints", () => {
    it("getAnalyticsOverview sends clientId and period as query parameters", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ totals: {} }) });
      await client.getAnalyticsOverview("c-1", "2031-03-10", "2031-03-16");
      expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/v1/analytics/overview?clientId=c-1&from=2031-03-10&to=2031-03-16");
    });

    it("createAiExecution posts the workflow request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "exec-1", status: "SUCCEEDED" }) });
      const res = await client.createAiExecution({ workflow: "weekly-marketing-review", tenantId: "t-1" });
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/ai/executions");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({ workflow: "weekly-marketing-review", tenantId: "t-1" });
      expect(res.id).toBe("exec-1");
    });

    it("surfaces API errors without leaking raw bodies", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ message: "Không tìm thấy tenant" }) });
      await expect(client.listAiContexts("t-x")).rejects.toThrow("Không tìm thấy tenant");
    });
  });
});
