"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ErrorSummary, FormField, Notice } from "@nexus/ui";
import type { CreateServiceInquiryResponse, ServiceConsentConfigDto } from "@nexus/contracts";
import { API_URL } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildConsultFields, isConfirmedConsultResponse, resolveConsultServiceSlug } from "../lib/consult";
import { validateConsult, type ConsultErrors, type ConsultInput } from "../lib/home-catalog";
import { applyConsentFields, DEV_CONSENT_VERSION } from "../services/[slug]/consent";

const WEBSITE_TYPES = [
  "Bán hàng & thương mại điện tử",
  "Doanh nghiệp & dịch vụ",
  "Blog & tin tức",
  "Web app / Mobile app",
  "Chatbot AI",
  "Khác",
];

const EMPTY: ConsultInput = { name: "", email: "", phone: "", websiteType: WEBSITE_TYPES[0], message: "", consent: false };

function newSubmissionKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** The server's own message for client errors (validation, stale policy, rate limit), a neutral one otherwise. */
async function failureMessage(res: Response): Promise<string> {
  if (res.status === 429) return "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.";
  if (res.status === 503) return "Hệ thống tạm thời chưa nhận được yêu cầu. Vui lòng thử lại sau ít phút.";
  const fallback = "Không gửi được yêu cầu. Vui lòng thử lại.";
  try {
    const body = await res.json();
    const raw = Array.isArray(body?.message) ? body.message[0] : body?.message;
    if (raw && res.status >= 400 && res.status < 500 && res.status !== 401) return String(raw);
  } catch {
    // keep the fallback
  }
  return fallback;
}

/**
 * ST01 R8. Sends the request to the Services inquiry API (`POST /v1/service-inquiries`), which stores
 * it, records consent with the server's own policy version and timestamp, and notifies staff.
 * Nothing is reported as sent unless the API answered 201.
 */
export function ConsultForm({ consent, serviceSlugs }: { consent: ServiceConsentConfigDto; serviceSlugs: string[] }) {
  const { token } = useAuth();
  // One key per filled-in form: double clicks and network retries return the same inquiry.
  const submissionKey = useMemo(newSubmissionKey, []);
  const [values, setValues] = useState<ConsultInput>(EMPTY);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<ConsultErrors>({});
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<CreateServiceInquiryResponse | null>(null);

  const set = <K extends keyof ConsultInput>(key: K, value: ConsultInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setFailure(null);
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validateConsult(values);
    setErrors(found);
    setAttempts((n) => n + 1);
    if (Object.keys(found).length > 0 || submitting) return;

    const slug = resolveConsultServiceSlug(values.websiteType, serviceSlugs);
    if (!slug) {
      setFailure("Dịch vụ tư vấn tạm thời chưa nhận yêu cầu. Vui lòng thử lại sau.");
      return;
    }

    const form = new FormData();
    for (const [k, v] of Object.entries(buildConsultFields(values, slug, submissionKey))) form.set(k, v);
    applyConsentFields(form, { accepted: values.consent, marketing, version: consent.version });
    // Honeypot: real visitors never fill it (hidden below); bots usually do.
    const honeypot = e.currentTarget.elements.namedItem("website");
    if (honeypot instanceof HTMLInputElement && honeypot.value) form.set("website", honeypot.value);

    setSubmitting(true);
    setFailure(null);
    try {
      const res = await fetch(`${API_URL}/v1/service-inquiries`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (res.status !== 201) {
        setFailure(await failureMessage(res));
        return;
      }
      const result: unknown = await res.json().catch(() => null);
      if (!isConfirmedConsultResponse(res.status, result)) {
        setFailure("Máy chủ chưa xác nhận mã yêu cầu. Vui lòng liên hệ hỗ trợ để kiểm tra.");
        return;
      }
      setDone(result);
    } catch {
      setFailure("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="rounded-2xl bg-surface p-6 text-center shadow-lift sm:p-8">
        <CheckCircle2 aria-hidden className="mx-auto h-12 w-12 text-cta" />
        <p className="mt-3 text-lg font-bold text-ink">Đã nhận yêu cầu tư vấn</p>
        <p className="mt-2 text-sm text-body">
          Mã yêu cầu: <span className="font-mono font-semibold text-ink">{done.inquiryNumber}</span>
        </p>
        <p className="mt-1 text-sm text-body">Chúng tôi sẽ liên hệ qua email trong 1 ngày làm việc.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl bg-surface p-6 text-left shadow-lift sm:p-8" aria-describedby="consult-note">
      {/* Honeypot: hidden from people and assistive tech. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="consult-website">Website</label>
        <input id="consult-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="space-y-5">
        <ErrorSummary
          focusKey={attempts}
          errors={{
            "consult-name": errors.name,
            "consult-email": errors.email,
            "consult-phone": errors.phone,
            "consult-message": errors.message,
            "consult-consent": errors.consent,
          }}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <FormField id="consult-name" label="Họ và tên" required error={errors.name}>
            <input className="field-input" autoComplete="name" maxLength={120} placeholder="Nguyễn Văn A" value={values.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField id="consult-email" label="Email liên hệ" required error={errors.email}>
            <input className="field-input" type="email" autoComplete="email" maxLength={254} placeholder="ban@congty.vn" value={values.email} onChange={(e) => set("email", e.target.value)} />
          </FormField>
          <FormField id="consult-type" label="Loại website cần làm">
            <select className="field-input" value={values.websiteType} onChange={(e) => set("websiteType", e.target.value)}>
              {WEBSITE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </FormField>
          <FormField id="consult-phone" label="Số điện thoại" hint="Không bắt buộc" error={errors.phone}>
            <input className="field-input" type="tel" autoComplete="tel" maxLength={20} placeholder="0901 234 567" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
        </div>
        <FormField id="consult-message" label="Mô tả nhu cầu" required error={errors.message}>
          <textarea
            className="field-input min-h-[112px] py-3"
            placeholder="Ví dụ: website bán mỹ phẩm, cần thanh toán VietQR và giao diện đẹp trên điện thoại…"
            value={values.message}
            onChange={(e) => set("message", e.target.value)}
          />
        </FormField>
        <div className="space-y-3">
          <div>
            <label htmlFor="consult-consent" className="flex cursor-pointer items-start gap-3 text-sm text-body">
              <input
                id="consult-consent"
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                checked={values.consent}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={errors.consent ? "consult-consent-error" : undefined}
                onChange={(e) => set("consent", e.target.checked)}
              />
              <span>
                Tôi đồng ý để NexusTheme xử lý thông tin trong yêu cầu này và liên hệ tư vấn, theo{" "}
                <a href={consent.privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline">
                  Chính sách quyền riêng tư
                </a>
                . *
              </span>
            </label>
            {errors.consent && (
              <p id="consult-consent-error" className="field-error">
                {errors.consent}
              </p>
            )}
          </div>
          <label htmlFor="consult-marketing" className="flex cursor-pointer items-start gap-3 text-sm text-body">
            <input
              id="consult-marketing"
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            <span>
              Tôi muốn nhận tin tức và ưu đãi qua email. <span className="text-muted">(Không bắt buộc, có thể rút lại bất cứ lúc nào.)</span>
            </span>
          </label>
          {consent.version === DEV_CONSENT_VERSION && (
            <p className="text-xs text-muted">Môi trường phát triển: chính sách quyền riêng tư chưa được duyệt.</p>
          )}
        </div>
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {submitting ? "Đang gửi…" : "Gửi yêu cầu tư vấn"}
        </button>
        <div id="consult-note" aria-live="polite">
          {failure && (
            <Notice tone="danger" title="Chưa gửi được yêu cầu">
              {failure}
            </Notice>
          )}
        </div>
      </div>
    </form>
  );
}
