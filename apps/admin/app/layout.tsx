import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "./context/auth-context";
import { ResponsiveTables } from "./components/responsive-tables";

const sans = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "NexusTheme Admin",
    template: "%s | NexusTheme Admin",
  },
  description: "Quản trị sản phẩm, đơn hàng, quyền sử dụng, nội dung và tự động hóa.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3155D9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={sans.variable}>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-card"
        >
          Bỏ qua tới nội dung
        </a>
        <AuthProvider>{children}</AuthProvider>
        <ResponsiveTables />
      </body>
    </html>
  );
}