import {
  isRecoveryCallback,
  passwordValidationError,
  recoveryRedirectUrl,
} from "../lib/password-recovery";

describe("ST10 Supabase password recovery", () => {
  it("uses the current site origin for the Supabase redirect", () => {
    expect(recoveryRedirectUrl("https://web-staging.example.vn")).toBe(
      "https://web-staging.example.vn/reset-password",
    );
  });

  it.each([
    ["", "#access_token=a&type=recovery", true],
    ["?code=pkce-code", "", true],
    ["?type=recovery", "", true],
    ["", "", false],
    ["", "#access_token=plain-signin", false],
    ["?error=access_denied&code=bad", "", false],
    ["", "#error=access_denied&type=recovery", false],
  ])("recognizes only candidate recovery callbacks: %s %s", (search, hash, expected) => {
    expect(isRecoveryCallback(search, hash)).toBe(expected);
  });

  it("rejects weak and mismatched passwords without accessing the network", () => {
    expect(passwordValidationError("short", "short")).toMatch(/8 ký tự/);
    expect(passwordValidationError("longpassword1", "differentpass")).toMatch(/chưa trùng/);
    expect(passwordValidationError("longpassword1", "longpassword1")).toBeNull();
  });
});
