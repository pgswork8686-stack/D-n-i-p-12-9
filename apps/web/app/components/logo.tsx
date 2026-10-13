import Link from "next/link";

/** `inverted` renders the wordmark in white for navy backgrounds (footer). */
export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="NexusTheme — Trang chủ">
      <svg aria-hidden viewBox="0 0 32 32" className="h-8 w-8">
        <rect width="32" height="32" rx="9" className="fill-brand" />
        <path d="M10 22V10l12 12V10" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-lg font-extrabold tracking-tight ${inverted ? "text-white" : "text-ink"}`}>
        Nexus<span className={inverted ? "text-[#93B4FF]" : "text-brand"}>Theme</span>
      </span>
    </Link>
  );
}
