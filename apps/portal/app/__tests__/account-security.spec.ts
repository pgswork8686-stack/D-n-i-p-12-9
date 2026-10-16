import { validatePasswordChange } from "../lib/account-security";

describe("PT14 account security", () => {
  it("requires the current password", () => {
    expect(validatePasswordChange("", "longpassword1", "longpassword1")).toMatch(/hiện tại/);
  });
  it("enforces minimum length", () => {
    expect(validatePasswordChange("existingpassword", "1234567", "1234567")).toMatch(/8 ký tự/);
  });
  it("rejects reusing the current password", () => {
    expect(validatePasswordChange("samepassword", "samepassword", "samepassword")).toMatch(/phải khác/);
  });
  it("rejects mismatch", () => {
    expect(validatePasswordChange("existingpassword", "newpassword1", "newpassword2")).toMatch(/không trùng/);
  });
  it("allows a valid distinct confirmed password", () => {
    expect(validatePasswordChange("existingpassword", "newpassword1", "newpassword1")).toBeNull();
  });
});
