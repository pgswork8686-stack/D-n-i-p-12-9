/** Version the API reports in development when no reviewed policy has been configured. */
export const DEV_CONSENT_VERSION = "dev-unreviewed";

export interface ConsentChoice {
  /** Required consent to process the data in this request. */
  accepted: boolean;
  /** Independent, optional marketing opt-in. */
  marketing: boolean;
  /** Version shown to the customer, echoed back so the server can detect a stale form. */
  version: string;
}

/**
 * Writes the consent fields explicitly. Browsers omit unchecked checkboxes from FormData, and a
 * missing field must never be mistaken for a decision, so both are always sent as literal
 * "true"/"false". The server still decides what is stored (its own version and clock).
 */
export function applyConsentFields(form: FormData, choice: ConsentChoice): void {
  form.delete("consentAccepted");
  form.delete("marketingConsent");
  form.delete("consentVersion");
  form.set("consentAccepted", choice.accepted ? "true" : "false");
  form.set("marketingConsent", choice.marketing ? "true" : "false");
  form.set("consentVersion", choice.version);
}
