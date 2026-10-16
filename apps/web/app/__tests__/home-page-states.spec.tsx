import { renderToStaticMarkup } from "react-dom/server";
import type { CategoryDto, PublicProductListItemDto } from "@nexus/contracts";

jest.mock("../lib/server-api", () => ({
  tryListProducts: jest.fn(),
  listProducts: jest.fn(),
  listCategories: jest.fn(),
  listPosts: jest.fn(),
  loadConsultOffer: jest.fn(),
}));

jest.mock("../lib/auth", () => ({ useAuth: () => ({ token: null, user: null }) }));

import * as api from "../lib/server-api";
import HomePage from "../page";

const mocked = api as jest.Mocked<typeof api>;
const page = (items: PublicProductListItemDto[], total = items.length) => ({ items, total, page: 1, limit: 10, totalPages: 1 });
const cat = (slug: string, name: string, sortOrder = 1): CategoryDto =>
  ({ id: slug, slug, name, sortOrder, status: "ACTIVE", createdAt: "", updatedAt: "", parentId: null, children: [] }) as unknown as CategoryDto;
const product = (slug: string, name: string): PublicProductListItemDto =>
  ({
    id: slug,
    slug,
    name,
    productType: "LICENSED_SOFTWARE",
    fulfillmentType: "INTERNAL_LICENSE",
    minPricesByCurrency: { VND: 890000 },
    categories: [{ id: "c", slug: "web-app", name: "Web App" }],
  }) as unknown as PublicProductListItemDto;

async function render() {
  return renderToStaticMarkup(await HomePage());
}

beforeEach(() => {
  jest.resetAllMocks();
  mocked.listPosts.mockResolvedValue(page([]) as never);
  mocked.listProducts.mockResolvedValue(page([]) as never);
  mocked.loadConsultOffer.mockResolvedValue(null);
});

describe("ST01 homepage states", () => {
  it("shows an error state, not an empty catalog, when the product API fails", async () => {
    mocked.tryListProducts.mockResolvedValue({ ok: false, data: page([]) } as never);
    mocked.listCategories.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Chưa tải được danh sách sản phẩm");
    expect(html).toContain("Thử lại");
    expect(html).not.toContain("Cửa hàng đang cập nhật sản phẩm");
  });

  it("shows the empty state and no showcase when the catalog has no products", async () => {
    mocked.tryListProducts.mockResolvedValue({ ok: true, data: page([]) } as never);
    mocked.listCategories.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("Cửa hàng đang cập nhật sản phẩm");
    expect(html).not.toContain("Mới phát hành");
    expect(html).not.toContain("Vừa cập nhật");
  });

  it("hides topic rows whose category does not exist in the catalog", async () => {
    mocked.tryListProducts.mockResolvedValue({ ok: true, data: page([product("a", "Sản phẩm A")]) } as never);
    mocked.listCategories.mockResolvedValue([cat("blog", "Blog")]);
    const html = await render();
    expect(html).not.toContain('id="wp-heading"');
    expect(html).not.toContain('id="tools-heading"');
    expect(html).not.toContain('id="solutions-heading"');
  });

  it("renders a topic row from a real category and uses the API total for its count", async () => {
    mocked.tryListProducts.mockResolvedValue({ ok: true, data: page([product("a", "Sản phẩm A")]) } as never);
    mocked.listCategories.mockResolvedValue([cat("web-app", "Web App")]);
    mocked.listProducts.mockResolvedValue(page([product("apex", "Apex SaaS"), product("booking", "BookingPro")], 17) as never);
    const html = await render();
    expect(html).toContain('id="solutions-heading"');
    expect(html).toContain("Apex SaaS");
    expect(html).toContain("Xem tất cả 17 sản phẩm");
    expect(mocked.listProducts).toHaveBeenCalledWith(expect.objectContaining({ category: "web-app" }));
  });

  it("builds category tabs and the hero category select from the API, in admin order", async () => {
    mocked.tryListProducts.mockResolvedValue({ ok: true, data: page([product("a", "Sản phẩm A")]) } as never);
    mocked.listCategories.mockResolvedValue([cat("chatbot-ai", "Chatbot AI", 7), cat("theme-wordpress", "Theme WordPress", 1)]);
    const html = await render();
    expect(html.indexOf("/products?category=theme-wordpress")).toBeLessThan(html.indexOf("/products?category=chatbot-ai"));
    expect(html).toContain('<option value="chatbot-ai">Chatbot AI</option>');
  });

  describe("consultation block", () => {
    const offer = {
      consent: { version: "2026-10", privacyPolicyUrl: "https://pgs.example/privacy" },
      serviceSlugs: ["custom-web-app-development", "ai-chatbot-development"],
    };
    beforeEach(() => {
      mocked.tryListProducts.mockResolvedValue({ ok: true, data: page([]) } as never);
      mocked.listCategories.mockResolvedValue([]);
    });

    it("shows only the support CTA when the Services module cannot take requests", async () => {
      mocked.loadConsultOffer.mockResolvedValue(null);
      const html = await render();
      expect(html).not.toContain('id="consult-name"');
      expect(html).not.toContain("Mô phỏng");
      expect(html).toContain("/tickets");
      expect(html).toContain("Gửi yêu cầu tư vấn");
    });

    it("shows the real form, with the policy link and an unticked marketing box, when requests can be taken", async () => {
      mocked.loadConsultOffer.mockResolvedValue(offer);
      const html = await render();
      expect(html).toContain('id="consult-name"');
      expect(html).not.toContain("Mô phỏng");
      expect(html).toContain('href="https://pgs.example/privacy"');
      expect(html).toContain('rel="noopener noreferrer"');
      // neither consent box is pre-ticked
      expect(html).not.toMatch(/id="consult-consent"[^>]*checked/);
      expect(html).not.toMatch(/id="consult-marketing"[^>]*checked/);
      expect(html).toContain('id="consult-marketing"');
    });

    it("labels the form as unreviewed while the server still reports the development policy version", async () => {
      mocked.loadConsultOffer.mockResolvedValue({ ...offer, consent: { ...offer.consent, version: "dev-unreviewed" } });
      expect(await render()).toContain("chính sách quyền riêng tư chưa được duyệt");
    });
  });});
