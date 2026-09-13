# Project Business/Input Checklist

This file tracks owner/business inputs required before dependent implementation can be considered production-ready. Agents must not invent missing commercial policy.

## A. Brand / domain
- [ ] Final project/brand name
- [ ] Primary domain
- [ ] Planned subdomains: web/app/admin/api/preview/status as applicable
- [ ] Logo / favicon / brand colors / typography

## B. Real catalog seed
Prepare at least 5–10 representative products covering the actual launch model.

For each product:
- [ ] name
- [ ] slug
- [ ] product type
- [ ] fulfillment type
- [ ] variants/SKUs
- [ ] commercial offers/prices
- [ ] currency
- [ ] billing type/interval
- [ ] license plan if applicable
- [ ] preview policy: STANDARD / PROTECTED / DISABLED

## C. Pricing policy
Must be decided before production commerce/entitlement:
- [ ] supported currencies (for example VND/USD)
- [ ] whether one variant may have multiple offers
- [ ] one-time / monthly / yearly rules
- [ ] tax/VAT inclusion/display policy
- [ ] discount/coupon launch scope
- [ ] explicit behavior when a selected offer becomes unavailable

Rule: agents must not silently map one offer to another currency/interval/plan without an explicit business mapping.

## D. License / entitlement policy
For each licensed product class:
- [ ] activation/site limit
- [ ] entitlement duration
- [ ] update duration
- [ ] support duration
- [ ] lifetime meaning, if offered
- [ ] what happens when update period expires
- [ ] what happens when support expires
- [ ] what happens when entitlement/license expires
- [ ] whether existing installed software continues to run
- [ ] whether new activations are blocked after expiry

These are separate policy axes; do not assume they expire together.

## E. Digital download policy
- [ ] file/package format
- [ ] versioning strategy
- [ ] which versions an entitlement may download
- [ ] download rate limits
- [ ] signed URL TTL policy
- [ ] retention/old-version policy

## F. External managed licensing (Elementor-style)
- [ ] actual upstream provider/account model
- [ ] official automation/API capability, if any
- [ ] manual operating procedure when no official API exists
- [ ] customer domain submission rules
- [ ] domain normalization/validation rules
- [ ] capacity/allocation limits
- [ ] activation SLA/statuses shown to customer
- [ ] revocation/deactivation procedure

Never place provider master credentials in Customer Portal or preview environments.

## G. Payment
Choose one first production provider:
- [ ] provider name
- [ ] supported currency/market
- [ ] merchant account readiness
- [ ] webhook/signature documentation
- [ ] test/sandbox credentials
- [ ] production credentials handling owner
- [ ] refund/reconciliation policy

Do not integrate multiple production gateways before the first is stable.

## H. Refund / revoke policy
Before production payment/refund:
- [ ] refund window
- [ ] full/partial refund rules
- [ ] entitlement behavior after refund
- [ ] download access after refund
- [ ] internal license revoke/suspend behavior
- [ ] external allocation deactivation behavior
- [ ] audit/support exception process

## I. Authentication/admin roles
- [ ] production Supabase project
- [ ] admin MFA policy
- [ ] initial super-admin owner(s)
- [ ] finance/support/product/content/ops responsibilities
- [ ] role approval/escalation procedure

## J. Infrastructure before staging/production
- [ ] Cloudflare account/domain DNS
- [ ] VPS/hosting target
- [ ] Coolify/Docker deployment
- [ ] private PostgreSQL
- [ ] private Redis
- [ ] Cloudflare R2/private storage
- [ ] transactional email provider
- [ ] secret management
- [ ] CI gates
- [ ] backup schedule
- [ ] restore test
- [ ] uptime/error monitoring
- [ ] log retention/redaction

## K. Legal/content before public launch
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Refund Policy
- [ ] License/EULA terms
- [ ] Support/Update policy
- [ ] Contact/business identity
- [ ] analytics consent/cookie policy if required

## Missing-input rule
When a phase depends on an unchecked item here, implementation may create a clearly labeled configurable placeholder only if the phase spec permits it. It must not invent a permanent business rule and present it as approved policy.
