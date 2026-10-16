"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SystemPage } from "@nexus/ui";

/** SY03 — admin error boundary. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Admin error:", error?.message);
  }, [error]);

  return (
    <main id="main">
      <SystemPage
        code="500"
        title="Có lỗi hệ thống"
        description="Thao tác chưa hoàn tất. Không có thay đổi nào được ghi nếu máy chủ chưa xác nhận — hãy tải lại dữ liệu trước khi thử lại."
        reference={error?.digest}
        actions={
          <>
            <button type="button" onClick={() => reset()} className="btn-primary">
              Thử lại
            </button>
            <Link href="/" className="btn-ghost">
              Về tổng quan
            </Link>
          </>
        }
      />
    </main>
  );
}
