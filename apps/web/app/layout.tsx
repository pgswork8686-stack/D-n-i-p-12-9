import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "./components/site-header";
import { SiteFooter } from "./components/site-footer";

const sans = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "NexusTheme — Theme, plugin & license phần mềm cho người làm web",
    template: "%s | NexusTheme",
  },
  description:
    "Mua theme, plugin, Figma UI kit và license phần mềm. Thanh toán VietQR, nhận file và mã bản quyền tự động.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4F46E5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={sans.variable}>
      <body className="flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card"
        >
          Bỏ qua tới nội dung
        </a>
        <Providers>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
