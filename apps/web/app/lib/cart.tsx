"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { CartDto } from "@nexus/contracts";
import { apiFetch } from "./api";
import { useAuth } from "./auth";
import { DEFAULT_CURRENCY } from "./format";

interface CartState {
  cart: CartDto | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  addItem: (variantId: string, priceId?: string) => Promise<void>;
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

const CartContext = createContext<CartState | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [cart, setCart] = useState<CartDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<CartDto>) => {
      setIsLoading(true);
      setError(null);
      try {
        setCart(await fn());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không cập nhật được giỏ hàng.");
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!token) {
      setCart(null);
      return;
    }
    await run(() => apiFetch<CartDto>(`/cart?currency=${DEFAULT_CURRENCY}`, { token })).catch(() => {});
  }, [token, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addItem = useCallback(
    (variantId: string, priceId?: string) =>
      run(() =>
        apiFetch<CartDto>("/cart/items", {
          method: "POST",
          token,
          body: { variantId, priceId, quantity: 1, currency: DEFAULT_CURRENCY },
        }),
      ),
    [token, run],
  );

  const updateQuantity = useCallback(
    (itemId: string, quantity: number) =>
      run(() =>
        apiFetch<CartDto>(`/cart/items/${itemId}?currency=${DEFAULT_CURRENCY}`, {
          method: "PATCH",
          token,
          body: { quantity },
        }),
      ),
    [token, run],
  );

  const removeItem = useCallback(
    (itemId: string) =>
      run(() =>
        apiFetch<CartDto>(`/cart/items/${itemId}?currency=${DEFAULT_CURRENCY}`, {
          method: "DELETE",
          token,
        }),
      ),
    [token, run],
  );

  return (
    <CartContext.Provider value={{ cart, isLoading, error, refresh, addItem, updateQuantity, removeItem }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
