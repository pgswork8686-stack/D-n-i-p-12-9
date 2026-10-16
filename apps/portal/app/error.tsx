"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SystemPage } from "@nexus/ui";

/** SY03 — portal error boundary. */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Portal error:", error?.message);
  }, [error]);

  return (
    <main id="main">
      <SystemPage
        code="500"
        title="Có lỗi hệ thống"
        description="Không thể hiển thị trang lúc này. Quyền sử dụng và đơn hàng của bạn không bị ảnh hưởng."
        reference={error?.digest}
        actions={
          <>
            <button type="button" onClick={() => reset()} className="btn-primary">
              Thử lại
            </button>
            <Link href="/" className="btn-ghost">
              Về trang tổng quan
            </Link>
          </>
        }
      />
    </main>
  );
}
