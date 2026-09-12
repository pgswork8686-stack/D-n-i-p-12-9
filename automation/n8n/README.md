# n8n Automation Workflows (Placeholder)

This directory is reserved for n8n AI Content workflows in future phases.

## Principles from PROJECT_CONTEXT.md:
1. n8n does NOT write directly to PostgreSQL business-critical data.
2. Content workflows generate AI drafts and send them to the internal NestJS API (`POST /v1/internal/posts/draft`).
3. Human approval via CMS is required before publishing.
