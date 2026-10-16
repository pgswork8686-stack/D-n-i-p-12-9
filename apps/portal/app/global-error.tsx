"use client";

import "./globals.css";
import { SystemPage } from "@nexus/ui";

/** SY03 — last-resort boundary when the root layout itself fails. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="vi">
      <body>
        <main>
          <SystemPage
            code="500"
            title="Có lỗi hệ thống"
            description="Trang không thể hiển thị lúc này. Vui lòng thử lại sau giây lát."
            reference={error?.digest}
            actions={
              <>
                <button type="button" onClick={() => reset()} className="btn-primary">
                  Thử lại
                </button>
                <a href="/" className="btn-ghost">
                  Về trang tổng quan
                </a>
              </>
            }
          />
        </main>
      </body>
    </html>
  );
}
