# treg Backlinks Summary Pilot

Implementation branch: `feature/treg-backlinks-pilot`

The server-only adapter is `src/server/custom/providers/treg/client.ts`.
It uses `POST https://treg.to/call/serpstat.web.backlinks.summary` with the
`X-Treg-Token` header and the Serpstat `getSummaryV2` JSON-RPC request.
The estimated catalog price as checked on 2026-10-21 is $0.0025 per call,
not a guaranteed bill. Verify pricing before real calls.

## Safety boundary

- `CUSTOM_TREG_ENABLED` must be `true` and `TREG_API_TOKEN` must exist
  in the server runtime for the opt-in helper to work.
- No credential is yet configured in GitHub/Cloudflare.
- **No production route/UI/MCP tool calls this adapter yet**. DataForSEO is
  unchanged and remains default. This work does not deploy.
- The pilot accepts bare domains only, does not retry paid calls, and never
  silently falls back to another paid provider.
- Unknown response fields remain null rather than made-up values. Mapping
  requires validation against a real, authorised (paid) API response.
- Before UI routing, implement an explicit per-request budget gate, cost
  recording, cache isolation, and provider-selection UI. Do not simply swap
  provider inside existing DataForSEO billing code.

## Test command

`pnpm exec vitest run src/server/custom/providers/treg/client.test.ts`

## Next steps

1. Validate TypeScript and Vitest in the feature branch.
2. With approval, obtain a scoped treg team token and add it to Actions Secrets.
3. Validate one live call with known cost approval, confirm response fields.
4. Add provider-aware billing/cache and opt-in API route/UI.
5. Test on a nonproduction deployment, merge, then manual Cloudflare deploy.
