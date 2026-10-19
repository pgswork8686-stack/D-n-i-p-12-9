import { catalogStatusLabel, fulfillmentLabel, productTypeLabel } from "../lib/catalog-labels";

describe("catalog labels", () => {
  it("translates known codes and keeps unknown codes visible", () => {
    expect(productTypeLabel("LICENSED_SOFTWARE")).toBe("Phần mềm có license");
    expect(fulfillmentLabel("DIGITAL_DOWNLOAD")).toBe("Tải xuống");
    expect(catalogStatusLabel("ACTIVE")).toBe("Đang bán");
    expect(catalogStatusLabel("WEIRD")).toBe("WEIRD");
    expect(productTypeLabel(null)).toBe("—");
  });
});
