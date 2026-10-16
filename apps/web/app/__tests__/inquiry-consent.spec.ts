import { applyConsentFields } from "../services/[slug]/consent";

describe("applyConsentFields", () => {
  it("sends explicit false for unchecked boxes, never an omitted field", () => {
    const form = new FormData();
    applyConsentFields(form, { accepted: false, marketing: false, version: "v1" });
    expect(form.get("consentAccepted")).toBe("false");
    expect(form.get("marketingConsent")).toBe("false");
    expect(form.get("consentVersion")).toBe("v1");
  });

  it("keeps marketing independent of the required consent", () => {
    const form = new FormData();
    applyConsentFields(form, { accepted: true, marketing: false, version: "v1" });
    expect(form.get("consentAccepted")).toBe("true");
    expect(form.get("marketingConsent")).toBe("false");
    const only = new FormData();
    applyConsentFields(only, { accepted: false, marketing: true, version: "v1" });
    expect(only.get("consentAccepted")).toBe("false");
    expect(only.get("marketingConsent")).toBe("true");
  });

  it("overwrites values a tampered DOM could have injected into the form", () => {
    const form = new FormData();
    form.append("consentAccepted", "true");
    form.append("marketingConsent", "true");
    form.append("consentVersion", "forged");
    applyConsentFields(form, { accepted: false, marketing: false, version: "v1" });
    expect(form.getAll("consentAccepted")).toEqual(["false"]);
    expect(form.getAll("marketingConsent")).toEqual(["false"]);
    expect(form.getAll("consentVersion")).toEqual(["v1"]);
  });
});
