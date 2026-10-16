/** Pure validation, executed before any authentication request. */
export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): string | null {
  if (!currentPassword) return "Vui lòng nhập mật khẩu hiện tại.";
  if (newPassword.length < 8) return "Mật khẩu mới cần tối thiểu 8 ký tự.";
  if (currentPassword === newPassword) return "Mật khẩu mới phải khác mật khẩu hiện tại.";
  if (newPassword !== confirmation) return "Hai mật khẩu mới không trùng khớp.";
  return null;
}
