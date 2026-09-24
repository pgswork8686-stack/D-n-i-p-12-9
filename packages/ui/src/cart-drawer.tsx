import React from "react";
import { formatPriceString } from "./price-display";

export interface CartDrawerItem {
  id: string;
  name: string;
  variantName?: string;
  unitAmountMinor: number;
  quantity: number;
  thumbnailUrl?: string | null;
}

export interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartDrawerItem[];
  currency?: string;
  onUpdateQuantity?: (itemId: string, quantity: number) => void;
  onRemoveItem?: (itemId: string) => void;
  onCheckout?: () => void;
  checkoutUrl?: string;
}

export function CartDrawer({
  isOpen,
  onClose,
  items,
  currency = "USD",
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
  checkoutUrl = "/checkout",
}: CartDrawerProps) {
  if (!isOpen) return null;

  const subtotalMinor = items.reduce(
    (sum, it) => sum + it.unitAmountMinor * it.quantity,
    0,
  );

  return (
    <div className="fixed inset-0 z-50 overflow-hidden font-sans">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛍️</span>
              <h2 className="text-lg font-bold text-slate-900">Your Cart</h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-[#0037b0]">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Item List */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {items.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <span className="text-4xl block">🛒</span>
                <p className="font-semibold text-slate-700">Your cart is empty</p>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Explore our digital catalog of themes, plugins, and cloud hosting assets to get started.
                </p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/60"
                >
                  <div className="w-12 h-12 rounded-lg bg-blue-100/70 text-[#0037b0] flex items-center justify-center font-bold text-base shrink-0">
                    {item.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold text-slate-900 truncate">{item.name}</h4>
                    {item.variantName && (
                      <p className="text-xs text-slate-500 font-medium">{item.variantName}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-bold text-[#0037b0] font-mono">
                        {formatPriceString(item.unitAmountMinor * item.quantity, currency)}
                      </span>
                      <div className="flex items-center gap-2">
                        {onUpdateQuantity && (
                          <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden text-xs">
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                              className="px-2 py-1 hover:bg-slate-100 text-slate-600"
                            >
                              -
                            </button>
                            <span className="px-2 py-1 font-semibold text-slate-800">{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                              className="px-2 py-1 hover:bg-slate-100 text-slate-600"
                            >
                              +
                            </button>
                          </div>
                        )}
                        {onRemoveItem && (
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.id)}
                            className="text-xs text-rose-500 hover:text-rose-700 ml-1 font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer & Checkout Action */}
          {items.length > 0 && (
            <div className="p-6 border-t border-slate-100 bg-slate-50/50 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 font-medium">Subtotal</span>
                <span className="text-lg font-extrabold text-slate-900 font-mono">
                  {formatPriceString(subtotalMinor, currency)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Taxes, VAT, and discounts calculated authoritatively at checkout.
              </p>
              {onCheckout ? (
                <button
                  type="button"
                  onClick={onCheckout}
                  className="w-full py-3 px-4 rounded-xl font-bold bg-[#0037b0] hover:bg-[#002c8f] text-white shadow-sm hover:shadow transition-all text-center block"
                >
                  Proceed to Checkout →
                </button>
              ) : (
                <a
                  href={checkoutUrl}
                  className="w-full py-3 px-4 rounded-xl font-bold bg-[#0037b0] hover:bg-[#002c8f] text-white shadow-sm hover:shadow transition-all text-center block"
                >
                  Proceed to Checkout →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
