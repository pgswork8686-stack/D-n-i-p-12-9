"use client";

import { useState } from "react";
import { ErrorSummary, FormField, Notice } from "@nexus/ui";
import { validateConsult, type ConsultErrors, type ConsultInput } from "../lib/home-catalog";

const WEBSITE_TYPES = [
  "Bán hàng & thương mại điện tử",
  "Doanh nghiệp & dịch vụ",
  "Blog & tin tức",
  "Web app / Mobile app",
  "Chatbot AI",
  "Khác",
];

const EMPTY: ConsultInput = { name: "", email: "", phone: "", websiteType: WEBSITE_TYPES[0], message: "", consent: false };

/**
 * ST01 R8. There is no API to receive consultation requests yet
 * (docs/frontend/route-audit.md §2), so a valid submission is NOT sent or
 * stored anywhere — the form says so explicitly instead of faking success.
 */
export function ConsultForm() {
  const [values, setValues] = useState<ConsultInput>(EMPTY);
  const [errors, setErrors] = useState<ConsultErrors>({});
  const [attempts, setAttempts] = useState(0);
  const [simulated, setSimulated] = useState(false);

  const set = <K extends keyof ConsultInput>(key: K, value: ConsultInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSimulated(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateConsult(values);
    setErrors(found);
    setAttempts((n) => n + 1);
    setSimulated(Object.keys(found).length === 0);
  };

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-2xl bg-surface p-6 text-left shadow-lift sm:p-8" aria-describedby="consult-note">
      <div className="space-y-5">
        <ErrorSummary
          focusKey={attempts}
          errors={{ "consult-name": errors.name, "consult-email": errors.email, "consult-phone": errors.phone, "consult-consent": errors.consent }}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <FormField id="consult-name" label="Họ và tên" required error={errors.name}>
            <input className="field-input" autoComplete="name" value={values.name} onChange={(e) => set("name", e.target.value)} />
          </FormField>
          <FormField id="consult-email" label="Email liên hệ" required error={errors.email}>
            <input className="field-input" type="email" autoComplete="email" value={values.email} onChange={(e) => set("email", e.target.value)} />
          </FormField>
          <FormField id="consult-type" label="Loại website cần làm">
            <select className="field-input" value={values.websiteType} onChange={(e) => set("websiteType", e.target.value)}>
              {WEBSITE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </FormField>
          <FormField id="consult-phone" label="Số điện thoại" hint="Không bắt buộc" error={errors.phone}>
            <input className="field-input" type="tel" autoComplete="tel" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
          </FormField>
        </div>
        <FormField id="consult-message" label="Mô tả nhu cầu">
          <textarea
            className="field-input min-h-[112px] py-3"
            placeholder="Ví dụ: website bán mỹ phẩm, cần thanh toán VietQR và giao diện đẹp trên điện thoại…"
            value={values.message}
            onChange={(e) => set("message", e.target.value)}
          />
        </FormField>
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
            Tôi đồng ý để NexusTheme liên hệ tư vấn qua email hoặc điện thoại.
          </label>
          {errors.consent && (
            <p id="consult-consent-error" className="field-error">
              {errors.consent}
            </p>
          )}
        </div>
        <button type="submit" className="btn-primary w-full">
          Gửi yêu cầu tư vấn
        </button>
        <div id="consult-note" aria-live="polite">
          {simulated ? (
            <Notice tone="warning" title="Mô phỏng — yêu cầu chưa được gửi">
              Kênh nhận yêu cầu tư vấn trực tuyến đang được hoàn thiện. Thông tin bạn nhập không được lưu hay gửi đi.
            </Notice>
          ) : (
            <p className="text-center text-xs text-muted">
              Tính năng đang hoàn thiện: yêu cầu hiện chưa được gửi tới đội ngũ tư vấn.
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
