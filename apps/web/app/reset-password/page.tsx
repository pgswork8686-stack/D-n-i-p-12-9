import type { Metadata } from "next";
import { ResetPasswordForm } from "../components/reset-password-form";

export const metadata: Metadata = { title: "Đặt lại mật khẩu", robots: { index: false } };

export default function ResetPasswordPage() {
  return (
    <div className="container-site flex justify-center py-12 md:py-20">
      <div className="w-full max-w-md"><ResetPasswordForm /></div>
    </div>
  );
}
