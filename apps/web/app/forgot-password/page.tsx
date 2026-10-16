import type { Metadata } from "next";
import { ForgotPasswordForm } from "../components/forgot-password-form";

export const metadata: Metadata = { title: "Khôi phục mật khẩu", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <div className="container-site flex justify-center py-12 md:py-20">
      <div className="w-full max-w-md"><ForgotPasswordForm /></div>
    </div>
  );
}
