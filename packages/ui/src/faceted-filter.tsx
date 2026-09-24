import React from "react";

export interface FacetCategory {
  id: string;
  name: string;
  count?: number;
}

export interface FacetProductType {
  id: string;
  label: string;
}

export interface FacetedFilterProps {
  categories: FacetCategory[];
  selectedCategoryIds: string[];
  onCategoryToggle: (categoryId: string) => void;
  productTypes?: FacetProductType[];
  selectedProductTypes?: string[];
  onProductTypeToggle?: (productType: string) => void;
  minPrice?: number;
  maxPrice?: number;
  onPriceChange?: (min?: number, max?: number) => void;
  currency?: string;
  onReset?: () => void;
  className?: string;
}

export function FacetedFilter({
  categories,
  selectedCategoryIds,
  onCategoryToggle,
  productTypes,
  selectedProductTypes = [],
  onProductTypeToggle,
  minPrice,
  maxPrice,
  onPriceChange,
  currency = "USD",
  onReset,
  className = "",
}: FacetedFilterProps) {
  const hasActiveFilters =
    selectedCategoryIds.length > 0 ||
    selectedProductTypes.length > 0 ||
    minPrice != null ||
    maxPrice != null;

  return (
    <aside className={`w-full space-y-6 text-sm ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <h3 className="font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <span>🔍</span> Filter Catalog
        </h3>
        {hasActiveFilters && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
          >
            Reset All
          </button>
        )}
      </div>

      {/* Categories Facet */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Categories</h4>
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {categories.map((cat) => {
            const isChecked = selectedCategoryIds.includes(cat.id);
            return (
              <label
                key={cat.id}
                className="flex items-center justify-between gap-2 text-slate-700 hover:text-slate-900 cursor-pointer select-none py-0.5"
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onCategoryToggle(cat.id)}
                    className="w-4 h-4 rounded text-[#0037b0] focus:ring-blue-500 border-slate-300"
                  />
                  <span className={`${isChecked ? "font-semibold text-slate-900" : ""}`}>{cat.name}</span>
                </div>
                {cat.count != null && (
                  <span className="text-xs text-slate-400 font-mono">({cat.count})</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Product Type Facet */}
      {productTypes && productTypes.length > 0 && onProductTypeToggle && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Product Type</h4>
          <div className="flex flex-wrap gap-1.5">
            {productTypes.map((pt) => {
              const isSelected = selectedProductTypes.includes(pt.id);
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => onProductTypeToggle(pt.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                    isSelected
                      ? "bg-blue-50 text-[#0037b0] border-blue-200 font-semibold"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {pt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Price Range Facet */}
      {onPriceChange && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Price Range ({currency})
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Min</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={minPrice ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  onPriceChange(val, maxPrice);
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Max</label>
              <input
                type="number"
                min="0"
                placeholder="Any"
                value={maxPrice ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  onPriceChange(minPrice, val);
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
