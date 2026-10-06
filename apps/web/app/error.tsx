"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

export default function GlobalError({
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
    <div className="container-site flex min-h-[60vh] items-center justify-center py-16">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Hệ thống đang bận</h1>
        <p className="mt-3 text-muted">Dịch vụ tạm thời gián đoạn. Vui lòng thử lại sau giây lát.</p>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" onClick={() => reset()} className="btn-primary">
            <RefreshCw aria-hidden className="h-4 w-4" /> Thử lại
          </button>
          <Link href="/" className="btn-ghost">
            Về trang chủ
          </Link>
        </div>
      </div>
    </div>
  );
}
