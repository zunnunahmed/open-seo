# Upstream OpenSEO Update Manager

## Behaviour

- Runs every Monday at **03:17 UTC** (09:17 Bangladesh time), and on demand from Actions → **OpenSEO Upstream Update Review** → Run workflow.
- Fetches `every-app/open-seo` `main`, compares it with this fork's current `main`.
- If upstream is already incorporated, exits successfully without a PR (the initial manual validation on 2026-10-21 observed this condition).
- If an upstream review PR is already open, exits instead of creating duplicate PRs.
- Otherwise creates a temporary `sync/upstream-YYYYMMDD-RUN_ID` branch with a Markdown impact report in `docs/upstream-reviews/`.
- If Git merges cleanly, the branch contains upstream changes plus the report. If conflicts occur, it **aborts the merge** and creates a **report-only blocked PR**, listing unresolved paths. Never mistake a report-only PR for applied upstream changes.
- Explicitly starts the existing `CI` workflow on the review branch. CI does not deploy Cloudflare.
- Never merges, enables auto-merge, or deploys the production Worker.

## GitHub permissions required

GitHub Actions → General → Workflow permissions:
- Ensure the repository permits workflows to create pull requests. Depending on organization policy, enable **Allow GitHub Actions to create and approve pull requests**. The reviewer itself never approves or merges.
- The workflow requests `contents: write`, `pull-requests: write`, and `actions: write`; it receives no Cloudflare or Google secrets.

If an update is available but PR creation fails, review that workflow's job logs and check these settings. Do not add personal access tokens until necessary and approved.

## Review gates

1. Inspect changed files, conflict report, and the actual incoming upstream diff.
2. Audit changes touching GSC/GA4 OAuth, per-project provider routing, DataForSEO billing, treg requests/cache and CSV/Excel exports.
3. Check migration files and Alchemy or GitHub workflow changes for resource/security impacts.
4. Require passing CI and manually test affected app flows. Green CI alone is not proof of integration correctness.
5. Manually approve and merge the PR to `main` only after resolving conflicts. Do **not** merge a report-only conflict PR.
6. Trigger `OpenSEO Cloudflare Self-Host (Manual)` with operation `deploy` and confirmation `DEPLOY` only after approval and backup checks.

## Notes

GitHub scheduled workflows run on the default branch and may execute later than the stated cron during heavy GitHub load. Scheduled Actions can be disabled for inactive repositories or by repository settings. The review report only highlights likely custom touchpoints and textual Git conflicts; dependency or behavioural regressions still require manual testing.

The workflow has been manually dry-run on 2026-10-21: successful, no update review PR created because the fork already contained the fetched upstream HEAD.
