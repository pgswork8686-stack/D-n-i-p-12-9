import { buildConsultFields, canOfferConsultForm, DEFAULT_CONSULT_SERVICE, isConfirmedConsultResponse, resolveConsultServiceSlug } from "../lib/consult";
import type { ConsultInput } from "../lib/home-catalog";

const ALL = ["custom-web-app-development", "ai-chatbot-development", "api-integration"];
const input: ConsultInput = { name: "  Nguyễn Văn A ", email: " A@Example.COM ", phone: " 0901 234 567 ", websiteType: "Bán hàng & thương mại điện tử", message: " Cần shop mỹ phẩm ", consent: true };

describe("resolveConsultServiceSlug", () => {
  it("routes Chatbot AI to its own service when it is active", () => {
    expect(resolveConsultServiceSlug("Chatbot AI", ALL)).toBe("ai-chatbot-development");
  });

  it("sends every other website type to the custom-build service", () => {
    for (const t of ["Bán hàng & thương mại điện tử", "Doanh nghiệp & dịch vụ", "Blog & tin tức", "Web app / Mobile app", "Khác"]) {
      expect(resolveConsultServiceSlug(t, ALL)).toBe(DEFAULT_CONSULT_SERVICE);
    }
  });

  it("falls back to the default service when the specific one is not active", () => {
    expect(resolveConsultServiceSlug("Chatbot AI", ["custom-web-app-development"])).toBe(DEFAULT_CONSULT_SERVICE);
  });

  it("returns null, never an inactive slug, when the default service is not active either", () => {
    expect(resolveConsultServiceSlug("Chatbot AI", ["ai-chatbot-development"])).toBe("ai-chatbot-development");
    expect(resolveConsultServiceSlug("Khác", ["ai-chatbot-development"])).toBeNull();
    expect(resolveConsultServiceSlug("Khác", [])).toBeNull();
  });
});

describe("canOfferConsultForm", () => {
  it("needs the default custom-build service to be active", () => {
    expect(canOfferConsultForm(ALL)).toBe(true);
    expect(canOfferConsultForm(["ai-chatbot-development"])).toBe(false);
    expect(canOfferConsultForm([])).toBe(false);
  });
});

describe("buildConsultFields", () => {
  it("maps the ST01 fields onto the inquiry API fields", () => {
    expect(buildConsultFields(input, "custom-web-app-development", "key-1")).toEqual({
      serviceSlug: "custom-web-app-development",
      companyName: "Nguyễn Văn A",
      contactName: "Nguyễn Văn A",
      contactEmail: "a@example.com",
      requirements: "Loại website: Bán hàng & thương mại điện tử\n\nCần shop mỹ phẩm",
      submissionKey: "key-1",
      contactPhone: "0901 234 567",
    });
  });

  it("omits an empty phone number instead of sending a blank field", () => {
    expect("contactPhone" in buildConsultFields({ ...input, phone: "  " }, "s", "k")).toBe(false);
  });

  it("never carries consent: that is added explicitly and separately", () => {
    const fields = buildConsultFields(input, "s", "k");
    expect(Object.keys(fields).some((k) => /consent/i.test(k))).toBe(false);
  });
});


describe("isConfirmedConsultResponse", () => {
  const accepted = { inquiryNumber: "SI-261016-A1B2C3", status: "NEW" };

  it("accepts only an HTTP 201 containing a valid created inquiry reference", () => {
    expect(isConfirmedConsultResponse(201, accepted)).toBe(true);
    for (const httpStatus of [200, 202, 204, 400, 500]) {
      expect(isConfirmedConsultResponse(httpStatus, accepted)).toBe(false);
    }
  });

  it("never shows a success state for an incomplete or forged 201 response", () => {
    for (const response of [null, {}, { status: "NEW" }, { inquiryNumber: "OTHER-123", status: "NEW" },
      { inquiryNumber: "SI-261016-A1B2C3", status: "FAILED" }, { inquiryNumber: 123, status: "NEW" }]) {
      expect(isConfirmedConsultResponse(201, response)).toBe(false);
    }
  });
});
