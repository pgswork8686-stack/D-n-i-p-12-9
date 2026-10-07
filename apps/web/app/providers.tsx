"use client";

import { AuthProvider } from "./lib/auth";
import { CartProvider } from "./lib/cart";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>{children}</CartProvider>
    </AuthProvider>
  );
}
