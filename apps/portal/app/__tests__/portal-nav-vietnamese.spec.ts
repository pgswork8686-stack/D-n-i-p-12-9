import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("B4 Portal shell Vietnamese labels", () => {
  const shell = readFileSync(join(__dirname, "../components/portal-shell.tsx"), "utf8");
  it("shows the navigation and account actions in Vietnamese, in the Figma sidebar order", () => {
    const order = [
      "Tổng quan", "Sản phẩm của tôi", "Trung tâm tải xuống", "License", "Kích hoạt tên miền",
      "Đơn hàng", "Hỗ trợ", "Thông báo", "Thông tin cá nhân", "Bảo mật",
    ].map(label => shell.indexOf(`label: "${label}"`));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const text of ["Dự án dịch vụ", "Tài khoản khách hàng", "Về cửa hàng", "Đăng xuất", "Mở hoặc đóng menu"]) {
      expect(shell).toContain(text);
    }
  });
  it("still uses the server feature flags and never enables disabled modules by translation", () => {
    expect(shell).toContain("features[item.feature] === true");
    expect(shell).toContain("/v1/features");
  });
});
