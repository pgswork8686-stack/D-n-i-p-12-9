import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUSTHEME — Marketplace",
  description: "Digital Product Commerce Platform",
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
