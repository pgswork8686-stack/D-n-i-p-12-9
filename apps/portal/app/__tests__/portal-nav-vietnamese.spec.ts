import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("B4 Portal shell Vietnamese labels", () => {
  const shell = readFileSync(join(__dirname, "../components/portal-shell.tsx"), "utf8");
  it("shows the navigation and account actions in Vietnamese", () => {
    for (const text of [
      "Tổng quan", "Đơn hàng của tôi", "Sản phẩm của tôi",
      "Tải xuống", "Dự án dịch vụ", "Yêu cầu hỗ trợ", "Tài khoản",
      "Đăng xuất", "Mở hoặc đóng menu",
    ]) {
      expect(shell).toContain(text);
    }
  });
  it("still uses the server feature flags and never enables disabled modules by translation", () => {
    expect(shell).toContain("features[item.feature] === true");
    expect(shell).toContain("/v1/features");
  });
});
