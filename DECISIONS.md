# DECISIONS

Durable architecture and business decisions. New decisions may supersede old ones; do not silently erase history.

## ADR-001 — V1 uses a modular monolith
Status: Accepted

NestJS remains a modular monolith for V1. Do not split into microservices without a separate architecture decision supported by operational need.

## ADR-002 — PostgreSQL is business source of truth
Status: Accepted

Redis/queues/cache accelerate work but do not become the authoritative store for orders, payments, entitlements, licenses, or allocations.

## ADR-003 — Entitlement is the access core
Status: Accepted

The core relation is:
`Order -> OrderItem -> Entitlement -> Fulfillment`.

Do not implement direct `Order -> License` shortcuts.

## ADR-004 — Backend owns critical state transitions
Status: Accepted

Frontends and n8n do not directly change order/payment/entitlement/license/allocation state. They call backend APIs; backend validates and commits authoritative state.

## ADR-005 — Payment success requires verified provider evidence
Status: Accepted

A redirect/success page is not payment proof. Only a verified signed provider event may transition payment/order state.

## ADR-006 — Private downloadable packages stay private
Status: Accepted

Distributable ZIP/assets are stored privately. Access requires entitlement validation and short-lived signed download grants/URLs. Permanent public package URLs are forbidden.

## ADR-007 — External managed licensing may be manual
Status: Accepted

If an official provider API/automation path is unavailable, V1 uses a `MANUAL_EXTERNAL` fulfillment workflow. Do not reverse-engineer private APIs or automate provider login bots.

## ADR-008 — Preview runtime is isolated from distributable source
Status: Accepted

Live Preview and the product package are separate security domains. Preview must never expose the private ZIP, original package storage key, provider secrets, license source, or private fulfillment credentials.

## ADR-009 — Preview protection is risk reduction, not an impossible anti-copy guarantee
Status: Accepted

Anything rendered as pixels can be visually copied or reconstructed. Security goal:
- prevent direct access to distributable source/package;
- raise cost of automated scraping/cloning;
- restrict sessions/rate/robots/hotlinking;
- optionally use remote-rendered preview for high-value assets.

Do not claim that browser-visible designs are impossible to recreate.

## ADR-010 — Price/offer identity is immutable after cart selection
Status: Accepted

A selected commercial offer is identified by its price/offer record, not variant alone. Monthly/yearly/currency offers must not silently replace each other. If a selected offer becomes invalid/unavailable, checkout fails and requires explicit customer action.

## ADR-011 — First production launch proves a vertical slice
Status: Accepted

Prioritize one real product completing:
`browse -> pay -> entitlement -> fulfillment -> repeat access`
before broad CMS/AI/affiliate/platform expansion.

## ADR-012 — One production payment provider first
Status: Accepted

Integrate and stabilize one production provider before adding additional gateways. Provider abstraction remains extensible, but breadth is deferred.

## ADR-013 — Agent-driven work follows phase specs and independent review
Status: Accepted

Implementation agents code/test/push; ChatGPT reviews architecture/business/security/concurrency. Agents must not self-merge phase PRs.
