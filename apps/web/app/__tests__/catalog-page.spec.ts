import { validCatalogPage } from "../products/page";

describe("B3 Storefront catalog page validation", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["0", 1],
    ["-1", 1],
    ["2xyz", 1],
    ["abc", 1],
    ["9999999", 1],
    ["1", 1],
    ["17", 17],
  ])("normalizes %s as %s", (raw, expected) => {
    expect(validCatalogPage(raw)).toBe(expected);
  });
});
