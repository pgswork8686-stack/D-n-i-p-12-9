import Link from "next/link";
import { Logo } from "./logo";
import type { NavCategory } from "../lib/home-catalog";

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

// Policy pages (ST13) are linked only when the CMS page is published, i.e. approved by PGS.
const SUPPORT: FooterLink[] = [
  { href: "/blog", label: "Hướng dẫn & Blog" },
  { href: `${PORTAL_URL}/tickets`, label: "Gửi yêu cầu hỗ trợ", external: true },
  { href: `${PORTAL_URL}/downloads`, label: "Tải xuống của tôi", external: true },
];

const ACCOUNT: FooterLink[] = [
  { href: PORTAL_URL, label: "Tài khoản của tôi", external: true },
  { href: `${PORTAL_URL}/orders`, label: "Đơn hàng", external: true },
  { href: `${PORTAL_URL}/licenses`, label: "License", external: true },
];

function Column({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-white">{title}</h2>
      <ul className="mt-4 space-y-3">
        {links.map((l) => (
          <li key={l.href}>
            {l.external ? (
              <a href={l.href} className="text-sm text-white/70 transition-colors hover:text-white">
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-sm text-white/70 transition-colors hover:text-white">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({
  categories = [],
  policies = [],
}: {
  categories?: NavCategory[];
  policies?: FooterLink[];
}) {
  const explore: FooterLink[] = [
    ...categories.map((c) => ({ href: `/products?category=${encodeURIComponent(c.slug)}`, label: c.name })),
    { href: "/products", label: "Tất cả sản phẩm" },
  ];
  return (
    <footer className="mt-24 bg-navy text-white">
      <div className="container-site grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo inverted />
          <p className="max-w-sm text-sm leading-6 text-white/70">
            Theme, plugin, UI kit, web app, mobile app và chatbot AI cho người làm web Việt. Thanh toán chuyển khoản
            VietQR, nhận mã nguồn và license tự động.
          </p>
        </div>
        <Column title="Khám phá" links={explore} />
        <Column title="Hỗ trợ" links={[...SUPPORT, ...policies]} />
        <Column title="Tài khoản" links={ACCOUNT} />
      </div>
      <div className="border-t border-white/10">
        <div className="container-site flex flex-col gap-2 py-6 text-xs text-white/60 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} NexusTheme. Sản phẩm số cho người làm web.</p>
          <p>Thanh toán VietQR · Đơn được xác nhận tự động qua ngân hàng</p>
        </div>
      </div>
    </footer>
  );
}
