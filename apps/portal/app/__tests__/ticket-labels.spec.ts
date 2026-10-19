import { categoryLabel, priorityLabel, TICKET_FILTERS } from "../lib/ticket-labels";

describe("ticket labels", () => {
  it("translates known codes and passes unknown ones through", () => {
    expect(priorityLabel("URGENT")).toBe("Khẩn cấp");
    expect(priorityLabel("X")).toBe("X");
    expect(categoryLabel("LICENSING")).toBe("License");
    expect(categoryLabel(null)).toBe("—");
    expect(TICKET_FILTERS[0]).toEqual({ value: "ALL", label: "Tất cả" });
  });
});
