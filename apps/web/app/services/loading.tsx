export default function ServicesLoading() {
  return (
    <div className="container-site py-10 md:py-14" role="status" aria-live="polite">
      <span className="sr-only">Đang tải danh mục dịch vụ…</span>
      <div className="max-w-2xl space-y-3">
        <div className="h-4 w-28 animate-pulse rounded bg-line" />
        <div className="h-9 w-3/4 animate-pulse rounded bg-line" />
        <div className="h-4 w-full animate-pulse rounded bg-line" />
      </div>
      <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="card h-56 animate-pulse p-6">
            <div className="h-12 w-12 rounded-xl bg-line" />
            <div className="mt-5 h-5 w-2/3 rounded bg-line" />
            <div className="mt-3 h-4 w-full rounded bg-line" />
            <div className="mt-2 h-4 w-5/6 rounded bg-line" />
          </li>
        ))}
      </ul>
    </div>
  );
}
