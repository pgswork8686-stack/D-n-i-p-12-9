import type { ConsultInput } from "./home-catalog";

/**
 * ST01 R8 sends its consultation request to the Services inquiry API (`POST /v1/service-inquiries`).
 * The form has no "service" or "company" field (Figma), so both are derived here, in one place,
 * and the original choices are kept in the request text so staff lose nothing.
 */

export const DEFAULT_CONSULT_SERVICE = "custom-web-app-development";

/** "Loại website" options that have their own service in the catalog; everything else is a custom build. */
const SERVICE_BY_WEBSITE_TYPE: Record<string, string> = {
  "Chatbot AI": "ai-chatbot-development",
};

/**
 * Picks the service for the chosen website type, but only one that is currently ACTIVE.
 * Falls back to the default custom-build service, and returns null when that is not available
 * either (the page then shows the support CTA instead of a form that would be refused).
 */
export function resolveConsultServiceSlug(websiteType: string, activeSlugs: readonly string[]): string | null {
  const preferred = SERVICE_BY_WEBSITE_TYPE[websiteType];
  if (preferred && activeSlugs.includes(preferred)) return preferred;
  return activeSlugs.includes(DEFAULT_CONSULT_SERVICE) ? DEFAULT_CONSULT_SERVICE : null;
}

/** True when a form can be offered at all: the default service must be ACTIVE. */
export function canOfferConsultForm(activeSlugs: readonly string[]): boolean {
  return activeSlugs.includes(DEFAULT_CONSULT_SERVICE);
}

/**
 * Maps the ST01 fields onto the inquiry API's required ones.
 * - companyName: the form is for individuals too, so the person's name stands in; the API requires a value.
 * - requirements: the website type is prefixed to the message because the API has no field for it.
 * Consent fields are added separately (see applyConsentFields) so they are always explicit.
 */
export function buildConsultFields(input: ConsultInput, serviceSlug: string, submissionKey: string): Record<string, string> {
  const name = input.name.trim();
  const fields: Record<string, string> = {
    serviceSlug,
    companyName: name,
    contactName: name,
    contactEmail: input.email.trim().toLowerCase(),
    requirements: `Loại website: ${input.websiteType}\n\n${input.message.trim()}`,
    submissionKey,
  };
  const phone = input.phone.trim();
  if (phone) fields.contactPhone = phone;
  return fields;
}
