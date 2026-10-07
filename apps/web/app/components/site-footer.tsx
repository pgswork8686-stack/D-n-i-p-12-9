import Link from "next/link";
import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "Sản phẩm",
    links: [
      { href: "/products?productType=DOWNLOADABLE_ASSET", label: "Theme & UI Kit" },
      { href: "/products?productType=LICENSED_SOFTWARE", label: "Plugin & phần mềm" },
      { href: "/products?productType=EXTERNAL_MANAGED_LICENSE", label: "License quản lý hộ" },
      { href: "/products?sort=newest", label: "Mới phát hành" },
    ],
  },
  {
    title: "Hỗ trợ",
    links: [
      { href: "/blog", label: "Hướng dẫn & Blog" },
      { href: `${process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001"}/tickets`, label: "Gửi yêu cầu hỗ trợ" },
      { href: `${process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001"}/downloads`, label: "Tải xuống của tôi" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="container-site grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm leading-6 text-muted">
            Chợ sản phẩm số cho người làm web Việt: theme, plugin, UI kit và license phần mềm.
            Thanh toán chuyển khoản VietQR, nhận hàng tự động.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-sm font-semibold text-ink">{col.title}</h2>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted transition-colors hover:text-brand">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="container-site py-6 text-xs text-muted">
          © {new Date().getFullYear()} NexusTheme. Thanh toán được xác nhận tự động qua ngân hàng.
        </p>
      </div>
    </footer>
  );
}
