"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip, X } from "lucide-react";
import {
  SERVICE_FILE_MAX_BYTES,
  SERVICE_INQUIRY_MAX_FILES,
  type CreateServiceInquiryResponse,
  type ServiceBudgetRange,
  type ServiceTimeline,
} from "@nexus/contracts";
import { API_URL, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const BUDGETS: { value: ServiceBudgetRange; label: string }[] = [
  { value: "UNDER_20M", label: "Dưới 20 triệu" },
  { value: "FROM_20M_TO_50M", label: "20 – 50 triệu" },
  { value: "FROM_50M_TO_100M", label: "50 – 100 triệu" },
  { value: "FROM_100M_TO_300M", label: "100 – 300 triệu" },
  { value: "OVER_300M", label: "Trên 300 triệu" },
  { value: "UNDECIDED", label: "Chưa xác định" },
];

const TIMELINES: { value: ServiceTimeline; label: string }[] = [
  { value: "ASAP", label: "Càng sớm càng tốt" },
  { value: "WITHIN_1_MONTH", label: "Trong 1 tháng" },
  { value: "ONE_TO_THREE_MONTHS", label: "1 – 3 tháng" },
  { value: "THREE_TO_SIX_MONTHS", label: "3 – 6 tháng" },
  { value: "FLEXIBLE", label: "Linh hoạt" },
];

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";
const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3001";

function newSubmissionKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function InquiryForm({ serviceSlug, ctaLabel }: { serviceSlug: string; ctaLabel: string }) {
  const { user, token } = useAuth();
  // One key per filled-in form: double clicks and network retries return the same inquiry.
  const submissionKey = useMemo(newSubmissionKey, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<CreateServiceInquiryResponse | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > SERVICE_FILE_MAX_BYTES) {
        setError(`“${f.name}” vượt quá ${SERVICE_FILE_MAX_BYTES / (1024 * 1024)} MB.`);
        continue;
      }
      if (next.length >= SERVICE_INQUIRY_MAX_FILES) {
        setError(`Tối đa ${SERVICE_INQUIRY_MAX_FILES} tệp.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("serviceSlug", serviceSlug);
    form.set("submissionKey", submissionKey);
    const features = String(form.get("desiredFeatures") || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    form.set("desiredFeatures", JSON.stringify(features));
    for (const key of ["contactPhone", "budgetRange", "timeline"]) {
      if (!form.get(key)) form.delete(key);
    }
    form.delete("files");
    for (const f of files) form.append("files", f, f.name);

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/v1/service-inquiries`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        let message = res.status === 429 ? "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau." : "Không gửi được yêu cầu. Vui lòng thử lại.";
        try {
          const body = await res.json();
          const raw = Array.isArray(body?.message) ? body.message[0] : body?.message;
          if (raw && res.status >= 400 && res.status < 500 && res.status !== 401) message = String(raw);
        } catch {
          // keep default
        }
        throw new ApiError(res.status, message);
      }
      setDone((await res.json()) as CreateServiceInquiryResponse);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="text-center" role="status">
        <CheckCircle2 aria-hidden className="mx-auto h-12 w-12 text-cta" />
        <h3 className="mt-3 text-lg font-semibold text-ink">Đã nhận yêu cầu</h3>
        <p className="mt-2 text-sm text-muted">
          Mã yêu cầu: <span className="font-mono font-semibold text-ink">{done.inquiryNumber}</span>
        </p>
        <p className="mt-2 text-sm text-muted">Chúng tôi sẽ liên hệ qua email trong 1 ngày làm việc.</p>
        {user && (
          <a href={`${PORTAL_URL}/services`} className="btn-ghost mt-5 w-full">
            Theo dõi trên Customer Portal
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="inq-website">Website</label>
        <input id="inq-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <label htmlFor="inq-company" className="field-label">
          Tên doanh nghiệp *
        </label>
        <input id="inq-company" name="companyName" required maxLength={200} className="field-input" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inq-name" className="field-label">
            Người liên hệ *
          </label>
          <input id="inq-name" name="contactName" required maxLength={120} autoComplete="name" className="field-input" />
        </div>
        <div>
          <label htmlFor="inq-phone" className="field-label">
            Số điện thoại
          </label>
          <input id="inq-phone" name="contactPhone" type="tel" maxLength={20} autoComplete="tel" className="field-input" />
        </div>
      </div>
      <div>
        <label htmlFor="inq-email" className="field-label">
          Email *
        </label>
        <input
          id="inq-email"
          name="contactEmail"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={user?.email || ""}
          className="field-input"
        />
      </div>
      <div>
        <label htmlFor="inq-req" className="field-label">
          Nội dung yêu cầu *
        </label>
        <textarea
          id="inq-req"
          name="requirements"
          required
          maxLength={5000}
          rows={5}
          placeholder="Mô tả bài toán, đối tượng sử dụng, hệ thống hiện có…"
          className="field-input py-2.5"
        />
      </div>
      <div>
        <label htmlFor="inq-features" className="field-label">
          Chức năng mong muốn <span className="font-normal text-muted">(mỗi dòng một chức năng)</span>
        </label>
        <textarea id="inq-features" name="desiredFeatures" rows={3} maxLength={4000} className="field-input py-2.5" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inq-budget" className="field-label">
            Ngân sách dự kiến
          </label>
          <select id="inq-budget" name="budgetRange" defaultValue="" className="field-input">
            <option value="">Không bắt buộc</option>
            {BUDGETS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inq-timeline" className="field-label">
            Thời gian mong muốn
          </label>
          <select id="inq-timeline" name="timeline" defaultValue="" className="field-input">
            <option value="">Không bắt buộc</option>
            {TIMELINES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="field-label">Tài liệu đính kèm</span>
        {user ? (
          <>
            <button type="button" onClick={() => fileInput.current?.click()} className="btn-ghost w-full">
              <Paperclip aria-hidden className="h-4 w-4" />
              Chọn tệp (PDF, ảnh, DOCX, XLSX, PPTX, TXT)
            </button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Bỏ ${f.name}`}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="ml-2 text-muted hover:text-danger"
                    >
                      <X aria-hidden className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-xs text-muted">
              Tối đa {SERVICE_INQUIRY_MAX_FILES} tệp, mỗi tệp {SERVICE_FILE_MAX_BYTES / (1024 * 1024)} MB.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            <Link href={`/login?next=/services/${serviceSlug}`} className="font-medium text-brand hover:underline">
              Đăng nhập
            </Link>{" "}
            để đính kèm tài liệu và theo dõi yêu cầu trên Customer Portal.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
        {submitting ? "Đang gửi…" : ctaLabel}
      </button>
    </form>
  );
}
