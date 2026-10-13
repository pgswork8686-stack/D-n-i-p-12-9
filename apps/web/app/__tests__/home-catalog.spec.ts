import type { CategoryDto, PublicProductListItemDto } from "@nexus/contracts";
import {
  findTopicCategory,
  flattenCategories,
  navCategories,
  pickPrice,
  validateConsult,
  type ConsultInput,
} from "../lib/home-catalog";

const cat = (slug: string, sortOrder: number, extra: Partial<CategoryDto> = {}): CategoryDto =>
  ({
    id: slug,
    name: slug.toUpperCase(),
    slug,
    sortOrder,
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
    parentId: null,
    ...extra,
  }) as CategoryDto;

const product = (extra: Partial<PublicProductListItemDto>): PublicProductListItemDto =>
  ({ id: "p", slug: "p", name: "P", productType: "LICENSED_SOFTWARE", fulfillmentType: "INTERNAL_LICENSE", categories: [], ...extra }) as PublicProductListItemDto;

describe("ST01 home catalog helpers", () => {
  describe("navCategories", () => {
    it("keeps only root categories, in admin sort order", () => {
      const tree = [cat("web-app", 5), cat("theme-wordpress", 1), cat("child", 0, { parentId: "theme-wordpress" }), cat("chatbot-ai", 7)];
      expect(navCategories(tree).map((c) => c.slug)).toEqual(["theme-wordpress", "web-app", "chatbot-ai"]);
    });

    it("caps the number of nav entries", () => {
      const tree = Array.from({ length: 12 }, (_, i) => cat(`c${i}`, i));
      expect(navCategories(tree, 8)).toHaveLength(8);
    });
  });

  describe("topic resolution", () => {
    const tree = [cat("wordpress", 1, { children: [cat("ban-hang", 1, { parentId: "wordpress" })] }), cat("design", 2), cat("chatbot-ai", 3)];
    const flat = flattenCategories(tree);

    it("flattens children so sub-categories can be matched", () => {
      expect(flat.map((c) => c.slug)).toEqual(["wordpress", "ban-hang", "design", "chatbot-ai"]);
    });

    it("matches a topic by its preferred slugs", () => {
      expect(findTopicCategory(flat, "wordpress")?.slug).toBe("wordpress");
      expect(findTopicCategory(flat, "uiKits")?.slug).toBe("design");
      expect(findTopicCategory(flat, "chatbot")?.slug).toBe("chatbot-ai");
    });

    it("returns undefined when the catalog has no such category, so the row is hidden", () => {
      expect(findTopicCategory(flat, "mobileApp")).toBeUndefined();
      expect(findTopicCategory(flat, "plugins")).toBeUndefined();
    });

    it("prefers the first slug in the list when several exist", () => {
      const both = flattenCategories([cat("wordpress", 1), cat("theme-wordpress", 2)]);
      expect(findTopicCategory(both, "wordpress")?.slug).toBe("theme-wordpress");
    });
  });

  describe("pickPrice", () => {
    it("uses the VND price when present", () => {
      expect(pickPrice(product({ minPricesByCurrency: { VND: 890000, USD: 3500 } }))).toEqual({ amount: 890000, currency: "VND" });
    });

    it("falls back to the API minimum in another currency", () => {
      expect(pickPrice(product({ minPrice: { currency: "USD" as never, amount: 1900 } }))).toEqual({ amount: 1900, currency: "USD" });
    });

    it("returns null when the product has no price", () => {
      expect(pickPrice(product({}))).toBeNull();
    });
  });

  describe("validateConsult", () => {
    const valid: ConsultInput = { name: "Khách Demo", email: "khach@demo.vn", phone: "", websiteType: "Khác", message: "", consent: true };

    it("accepts a complete form without a phone number", () => {
      expect(validateConsult(valid)).toEqual({});
    });

    it("requires name, a valid email and consent", () => {
      expect(validateConsult({ ...valid, name: " ", email: "sai-email", consent: false })).toEqual({
        name: "Vui lòng nhập họ và tên",
        email: "Email chưa đúng định dạng",
        consent: "Vui lòng đồng ý để chúng tôi liên hệ tư vấn",
      });
    });

    it("accepts Vietnamese phone formats and rejects malformed ones", () => {
      expect(validateConsult({ ...valid, phone: "0901 234 567" })).toEqual({});
      expect(validateConsult({ ...valid, phone: "+84901234567" })).toEqual({});
      expect(validateConsult({ ...valid, phone: "12345" }).phone).toBe("Số điện thoại chưa đúng định dạng");
    });
  });
});
