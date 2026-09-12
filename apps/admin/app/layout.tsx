import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUSTHEME — Super Admin",
  description: "Central Operations & CMS Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
