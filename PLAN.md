# Plan: Support Custom AI Providers (OpenRouter, OpenCode Zen, Kilo Gateway)

## Summary

Build a generic custom AI provider framework that lets admins and users add OpenAI-compatible API providers (OpenRouter, OpenCode Zen, Kilo Gateway, or any compatible endpoint). Custom provider models are merged into the existing model selector alongside Vercel AI Gateway models.

## Status: Implemented

All phases complete. Lint, typecheck, and build pass.

## Changes

### New files
- `apps/web/lib/custom-providers.ts` — Types, CRUD, model fetching from provider `/models` endpoints
- `apps/web/lib/custom-providers-env.ts` — Env-var-based admin providers (`CUSTOM_PROVIDER_*`)
- `apps/web/app/api/settings/custom-providers/route.ts` — CRUD API endpoint (GET/POST/PATCH/DELETE)
- `apps/web/app/settings/custom-providers-section.tsx` — Settings UI for managing providers
- `apps/web/lib/db/migrations/0038_sturdy_sunfire.sql` — Drizzle migration

### Modified files
- `apps/web/lib/db/schema.ts` — Added `custom_providers` table (id, user_id, name, base_url, api_key, is_enabled)
- `apps/web/app/api/models/route.ts` — Merges custom provider models with gateway models
- `apps/web/app/api/chat/_lib/model-selection.ts` — Resolves `GatewayConfig` for custom provider models
- `packages/agent/open-agent.ts` — Added `gatewayConfig` to `AgentModelSelection`, passes to `gateway()`
- `apps/web/app/workflows/chat.ts` — Loads custom provider configs at runtime via `loadCustomProviderConfigs()`
- `apps/web/app/settings/models/page.tsx` — Added Custom Providers section
- `apps/web/components/provider-icons.tsx` — Added OpenRouter, Kilo, OpenCode icons + display names
- `apps/web/.env.example` — Documented `CUSTOM_PROVIDER_*` env vars

### Model ID convention
Custom provider model IDs use `<provider-name>/<model-id-from-provider>` format:
- `openrouter/anthropic/claude-sonnet-4.5`
- `kilo/openai/gpt-5.4`
- `zen/deepseek/deepseek-r1`

The first segment identifies which custom provider config to use for API routing. The rest is passed as the model ID to the provider's API.

### Data flow
1. User adds provider in Settings → stored in `custom_providers` table (or env vars for admin)
2. `GET /api/models` fetches models from gateway + all enabled custom providers, merges them
3. User selects a custom provider model in chat
4. `resolveChatModelSelection()` detects the provider prefix, loads the `GatewayConfig`
5. `openAgent.prepareCall()` passes `gatewayConfig` to `gateway(modelId, { config })`
6. `createGateway({ baseURL, apiKey })` routes to the custom provider's OpenAI-compatible API

## Follow-up hardening (post-implementation review)

- **Ownership guards**: `getCustomProviderByKey()` filters by `user_id` (no admin config leak); disabled user providers can be re-enabled/deleted; admin providers are immutable from the user CRUD API.
- **SSRF protection**: provider `baseUrl` must be `https://` and is rejected when it resolves to a loopback, private/link-local/reserved IP (incl. IPv4-mapped IPv6) or a reserved host suffix (`.local`, `.internal`, `.home.arpa`); the same check is applied at fetch time for env-var providers.
- **Model-id sanity**: user provider names are trimmed, restricted to letters/numbers/spaces/`_`/`-`, and cannot shadow a built-in gateway provider prefix (`openai`, `anthropic`, ...).
- **Scope fix**: `GET /api/models` loads only the requesting user's providers (admin-enabled + user-enabled) instead of querying every enabled row.
- **Variant overrides**: user model-variant `providerOptions` for custom models are remapped from the model-prefix key to the `openai` key, since custom endpoints are OpenAI-compatible.

Additions: `apps/web/lib/custom-providers.test.ts` (ownership + validation/SSRF tests), schema/SSRF helpers in `apps/web/lib/custom-providers.ts`, `remapCustomProviderOptions` in `packages/agent/models.ts`.