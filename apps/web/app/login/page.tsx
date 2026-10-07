import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "../components/auth-form";

export const metadata: Metadata = { title: "Đăng nhập", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="container-site flex justify-center py-12 md:py-20">
      <div className="w-full max-w-md">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </div>
    </div>
  );
}
