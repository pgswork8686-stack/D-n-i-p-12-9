"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { SystemPage } from "@nexus/ui";

/** SY03 — storefront error boundary (500 / network failure). */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log privately without leaking internal details or URLs into the DOM
    console.error("Public Storefront Error:", error?.message);
  }, [error]);

  return (
    <SystemPage
      code="500"
      title="Hệ thống đang bận"
      description="Dịch vụ tạm thời gián đoạn. Dữ liệu của bạn không bị ảnh hưởng — vui lòng thử lại sau giây lát."
      reference={error?.digest}
      actions={
        <>
          <button type="button" onClick={() => reset()} className="btn-primary">
            <RefreshCw aria-hidden className="h-4 w-4" /> Thử lại
          </button>
          <Link href="/" className="btn-ghost">
            Về trang chủ
          </Link>
        </>
      }
    />
  );
}
