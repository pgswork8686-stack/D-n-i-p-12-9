import React from "react";

export interface ProductVersionBadgeProps {
  version: string;
  channel?: "STABLE" | "BETA" | "LTS" | string;
  compatibility?: string[];
  className?: string;
}

export function ProductVersionBadge({
  version,
  channel = "STABLE",
  compatibility,
  className = "",
}: ProductVersionBadgeProps) {
  const channelClasses: Record<string, string> = {
    STABLE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    LTS: "bg-blue-50 text-blue-700 border-blue-200",
    BETA: "bg-amber-50 text-amber-700 border-amber-200",
  };

  const badgeClass = channelClasses[channel.toUpperCase()] || "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <div className={`inline-flex items-center flex-wrap gap-1.5 ${className}`}>
      {/* Version Tag */}
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold font-mono bg-slate-900 text-white">
        v{version.replace(/^v/, "")}
      </span>

      {/* Channel */}
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border ${badgeClass}`}>
        {channel}
      </span>

      {/* Compatibility Chips */}
      {compatibility && compatibility.length > 0 && (
        <div className="inline-flex items-center gap-1">
          {compatibility.map((c) => (
            <span
              key={c}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
