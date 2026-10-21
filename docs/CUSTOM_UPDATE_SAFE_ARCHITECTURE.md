# Update-safe architecture for Zunnun's OpenSEO fork

Status: Architecture documented; treg runtime integration NOT implemented.
Repository: zunnunahmed/open-seo
Upstream: every-app/open-seo
Last review: 2026-10-21

## Current code and deployment audit

- OpenSEO version is 0.1.14 (`package.json`).
- Keywords facade: `src/server/features/keywords/services/KeywordResearchService.ts`; implementations in `services/research/`.
- Backlinks facade: `src/server/features/backlinks/services/BacklinksService.ts`; data access and cache in `backlinksServiceData.ts`.
- Existing provider and billing boundary: `src/server/lib/dataforseo/client.ts`. It reserves and settles credits; preserve this logic.
- Infrastructure: `deploy/alchemy/alchemy.run.ts` and `.github/workflows/selfhost-cloudflare-manual.yml`.
- The current deployment workflow runs only on `workflow_dispatch`; no auto-deploy on a push or upstream release.
- Cloudflare D1, KV, R2 and Access infrastructure is provisioned by Alchemy. Do not overwrite state, rename resources, or destroy deployments during feature work.

## Intended boundaries

```text
OpenSEO UI / MCP actions
          |
Existing feature services (Keywords / Backlinks / Domain)
          |
Feature-level provider router (opt-in, initially DataForSEO-only)
          |------------------------------------|
Existing DataForSEO client             New custom/treg adapter
(existing billing/cache untouched)    (isolated authentication, rate limits,
                                       response validation, provider cost rules)
          |------------------------------------|
           Normalized, source-labelled outputs
```

### Suggested new files (do not create until implementation)

- `src/server/custom/providers/contracts.ts`: typed query and normalized response contracts, units, data provenance.
- `src/server/custom/providers/router.ts`: explicit provider opt-in per supported capability; defaults to DataForSEO.
- `src/server/custom/providers/treg/client.ts`: server-side API client; never ships token to client.
- `src/server/custom/providers/treg/mappers.ts`: response normalization, location/language and error handling.
- `src/server/custom/providers/treg/pricing.ts`: endpoint cost estimates, logging, budget checks.
- `src/server/custom/providers/treg/*.test.ts`: mock calls only; no paid live API in CI.
- `src/client/components/custom/ProviderSelector.tsx`: optional UI switch, only after server validation.

### Integration order

1. Add new, isolated files and tests with no behavior change.
2. Implement backlinks summary as a pilot; verify scope, available columns, prices and caching keys.
3. Add feature routing behind disabled-by-default flag: `CUSTOM_TREG_ENABLED=false`.
4. Connect one service boundary with minimal upstream code changes.
5. Show source, freshness and estimated cost before paid queries.
6. Expand to keyword research then domain overview after schema compatibility tests.

Important: treg's provider catalog prices and exact token authentication must be checked against current official API documentation before coding. DataForSEO and treg units are not automatically interchangeable. The prior presence of a treg MCP connector in ChatGPT is NOT an OpenSEO API credential.

## Compatibility and correctness rules

- Never use provider fallback after a paid task may already have been charged unless retry safety is established.
- Preserve DataForSEO billing and limits; separately record treg spend in its actual USD values.
- Cache keys must include provider, capability, location, language, target scope, filter set and data schema version.
- Enforce per-project and account usage limits; do not expose credentials, account identifiers or raw OAuth grants to browser.
- Record provider provenance, timestamps and source IDs to prevent false data comparisons.
- Keep Cloudflare Worker compatibility (fetch/Web Crypto; no Node-only packages in runtime).
- Existing GSC/GA4 OAuth secrets and encryption key must remain stable.
- No production schema migrations without a backup, validation and explicit authorization.

## Upstream update process

1. Check upstream commits/releases; never merge into production automatically.
2. Bring upstream into a temporary branch based on `main`; preserve a backup/tag of the current working SHA.
3. Review changed files, especially feature-service boundaries, auth, D1 migrations, Alchemy config and deploy scripts.
4. Resolve conflicts and test DataForSEO, GSC, GA4, Cloudflare Access, project switching and custom treg functionality.
5. Run `pnpm install --frozen-lockfile`, `pnpm test:ci`, `pnpm build`, then dedicated provider contract tests.
6. Review migration and Worker resource changes; require human approval for deploy.
7. Merge tested branch to `main`; trigger existing manual Cloudflare workflow with operation `deploy` and confirmation `DEPLOY`.
8. Smoke-test live site; revert to last good commit and redeploy if safe. Be aware code rollback does not automatically roll back D1 schema/data.

Recommended branches:
- `main`: production release source.
- `feature/treg-provider`: new work, via pull requests.
- `sync/upstream-YYYYMMDD`: temporary merge validation; no automatic deployment.

## Secrets

- Keep `DATAFORSEO_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET` and Cloudflare credentials in repository Actions Secrets.
- For treg, add a scoped credential only after consulting official authentication guidance; use a distinct secret name such as `TREG_API_TOKEN` and forward it only to the server runtime.
- Do not paste any secret into issues, screenshots, public source, job logs or client JS.
- Merely adding an Actions secret does not expose it to Cloudflare. Deployment binding and runtime code must explicitly support it.

## Acceptance checklist for treg pilot

- DataForSEO paths remain unchanged when feature flag is off.
- Provider request never runs client-side and does not log secrets.
- Prices, units and provider provenance are shown accurately.
- Low/high volume and error/timeout/rate limit cases covered.
- Source data normalization tested against non-secret fixtures.
- Production rollback documented and rehearsed.
- Upstream merge has no silent feature regression.

This document is a safe architecture plan, not a claim that treg has already been connected.
