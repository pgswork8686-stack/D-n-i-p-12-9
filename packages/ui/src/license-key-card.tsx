import React, { useState } from "react";

export interface LicenseKeyCardProps {
  licenseKey: string;
  status?: string;
  productName?: string;
  activationsUsed?: number;
  maxActivations?: number | null;
  expiresAt?: string | null;
  className?: string;
  onCopy?: () => void;
}

export function maskLicenseKey(key: string): string {
  if (!key || key.length < 8) return "••••••••••••";
  const clean = key.replace(/[^A-Za-z0-9]/g, "");
  if (clean.length <= 8) return `${clean.substring(0, 4)}••••`;
  const first = clean.substring(0, 4);
  const last = clean.substring(clean.length - 4);
  return `${first}-••••-••••-${last}`;
}

export function LicenseKeyCard({
  licenseKey,
  status = "ACTIVE",
  productName,
  activationsUsed = 0,
  maxActivations = 1,
  expiresAt,
  className = "",
  onCopy,
}: LicenseKeyCardProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(licenseKey);
    }
    setCopied(true);
    if (onCopy) onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColors: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    SUSPENDED: "bg-amber-50 text-amber-700 border-amber-200",
    REVOKED: "bg-rose-50 text-rose-700 border-rose-200",
    EXPIRED: "bg-slate-50 text-slate-600 border-slate-200",
  };

  const badgeClass = statusColors[status.toUpperCase()] || "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <div className={`p-5 rounded-2xl bg-white border border-slate-200/90 shadow-sm space-y-4 ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between gap-3">
        {productName ? (
          <div>
            <h4 className="text-sm font-bold text-slate-900 leading-tight">{productName}</h4>
            <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">License Key</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">License Key</span>
        )}
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${badgeClass}`}>
          {status}
        </span>
      </div>

      {/* Key Box */}
      <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/60 font-mono text-sm">
        <span className="font-semibold text-slate-800 tracking-wider truncate select-all">
          {revealed ? licenseKey : maskLicenseKey(licenseKey)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            title={revealed ? "Hide Key" : "Show Key"}
          >
            {revealed ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors border ${
              copied
                ? "bg-emerald-600 text-white border-emerald-600"
                : "bg-blue-50 text-[#0037b0] border-blue-200 hover:bg-blue-100"
            }`}
            title="Copy License Key"
          >
            {copied ? "Copied! ✓" : "Copy 📋"}
          </button>
        </div>
      </div>

      {/* Meta Footer */}
      <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100">
        <div>
          Activations:{" "}
          <span className="font-semibold text-slate-700">
            {activationsUsed} / {maxActivations ?? "Unlimited"}
          </span>
        </div>
        {expiresAt ? (
          <div>
            Expires:{" "}
            <span className="font-semibold text-slate-700">
              {new Date(expiresAt).toLocaleDateString()}
            </span>
          </div>
        ) : (
          <div className="text-emerald-600 font-medium">Lifetime Access ✨</div>
        )}
      </div>
    </div>
  );
}
