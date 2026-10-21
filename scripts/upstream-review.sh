#!/usr/bin/env bash
set -euo pipefail

# Intended for the weekly/manual GitHub Action. Never merges main or deploys.
UPSTREAM_REPO="${UPSTREAM_REPO:-every-app/open-seo}"
BASE_BRANCH="${BASE_BRANCH:-main}"
RUN_ID="${GITHUB_RUN_ID:?GitHub Actions run ID required}"
TODAY="$(date -u +%Y%m%d)"
BRANCH="sync/upstream-${TODAY}-${RUN_ID}"
REPORT="docs/upstream-reviews/${TODAY}-${RUN_ID}.md"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add upstream "https://github.com/${UPSTREAM_REPO}.git" 2>/dev/null || git remote set-url upstream "https://github.com/${UPSTREAM_REPO}.git"
git fetch --no-tags upstream main

UPSTREAM_SHA="$(git rev-parse upstream/main)"
FORK_SHA="$(git rev-parse HEAD)"
echo "Upstream: ${UPSTREAM_SHA}; fork: ${FORK_SHA}" >> "${GITHUB_STEP_SUMMARY}"

if git merge-base --is-ancestor "${UPSTREAM_SHA}" HEAD; then
  echo "No new upstream commits to review." >> "${GITHUB_STEP_SUMMARY}"
  exit 0
fi

# Never open parallel update PRs. First review the existing one.
OPEN_COUNT="$(gh pr list --base "${BASE_BRANCH}" --state open --json headRefName --jq '[.[] | select(.headRefName | startswith("sync/upstream-"))] | length')"
if [[ "${OPEN_COUNT}" -gt 0 ]]; then
  echo "An upstream review PR is already open; review/close it before the next sync." >> "${GITHUB_STEP_SUMMARY}"
  exit 0
fi

MERGE_BASE="$(git merge-base HEAD upstream/main)"
mapfile -t CHANGED < <(git diff --name-only "${MERGE_BASE}" upstream/main)
touch /tmp/upstream-conflicts.txt
git switch -c "${BRANCH}"

STATUS="ready"
if ! git merge --no-commit --no-ff upstream/main >/tmp/upstream-merge.log 2>&1; then
  STATUS="conflicts"
  git diff --name-only --diff-filter=U > /tmp/upstream-conflicts.txt
  git merge --abort
else
  git commit -m "Review upstream OpenSEO changes (${UPSTREAM_SHA:0:12})"
fi

mkdir -p "$(dirname "${REPORT}")"
{
  echo "# OpenSEO Upstream Review — ${TODAY}"
  echo
  echo "**Status:** ${STATUS}"
  echo
  echo "- Upstream: \`${UPSTREAM_REPO}@${UPSTREAM_SHA}\`"
  echo "- Fork baseline: \`${FORK_SHA}\`"
  echo "- GitHub Actions run: \`${RUN_ID}\`"
  echo "- No production deployment or \`main\` merge is authorized by this report."
  echo
  echo "## Merge conflicts"
  if [[ -s /tmp/upstream-conflicts.txt ]]; then
    sed 's/^/- \`/; s/$/\`/' /tmp/upstream-conflicts.txt
    echo
    echo "**BLOCKED:** This branch contains only the review report based on current main."
    echo "The upstream changes have NOT been merged into this PR. Resolve conflicts in a separate"
    echo "review branch, then run CI and request explicit human approval before merge."
  else
    echo "No textual merge conflicts detected. Review semantic compatibility anyway."
  fi
  echo
  echo "## Custom integration and deployment touchpoints"
  echo "Review any upstream changes touching these files especially carefully:"
  echo
  TOUCHES=0
  for file in "${CHANGED[@]}"; do
    case "${file}" in
      src/server/custom/*|src/serverFunctions/treg*|src/client/features/backlinks/*|src/client/features/search-performance/*|src/server/features/gsc/*|src/serverFunctions/projectContext.ts|src/client/features/integrations/*|deploy/*|.github/workflows/*|src/server/lib/runtime-env.ts|src/server/lib/dataforseo/*|src/serverFunctions/searchPerformance.ts|package.json|pnpm-lock.yaml|src/db/*)
        echo "- \`${file}\`"
        TOUCHES=$((TOUCHES+1))
        ;;
    esac
  done
  if [[ "${TOUCHES}" -eq 0 ]]; then echo "No listed custom touchpoints changed upstream (still test thoroughly)."; fi
  echo
  echo "## Upstream changed files"
  echo "${#CHANGED[@]} changed path(s) since common ancestor."
  echo
  printf '%s\n' "${CHANGED[@]}" | sed 's/^/- \`/; s/$/\`/'
  echo
  echo "## Mandatory human review checklist"
  echo "- [ ] Review the upstream diff, workflow permissions, dependencies and migrations."
  echo "- [ ] Verify custom GSC URL categories, category bar chart, five-sheet Excel export."
  echo "- [ ] Verify GSC and GA4 OAuth, per-project provider settings, and DataForSEO."
  echo "- [ ] Verify treg Backlinks summary, saved list data, token isolation, quotas and billing."
  echo "- [ ] Run CI, tests, and a staged Cloudflare build before production."
  echo "- [ ] Obtain explicit approval to merge into \`main\`."
  echo "- [ ] Deploy Cloudflare ONLY using the existing manual deployment workflow."
} > "${REPORT}"

git add "${REPORT}"
git commit -m "Document upstream review and custom integration impact"
git push --set-upstream origin "${BRANCH}"

TITLE="[Upstream Review] OpenSEO ${TODAY} (${STATUS})"
if [[ "${STATUS}" == "conflicts" ]]; then
  TITLE="[Upstream Review — CONFLICTS] OpenSEO ${TODAY}"
fi
gh pr create --base "${BASE_BRANCH}" --head "${BRANCH}" --title "${TITLE}" --body-file "${REPORT}"
# GitHub does not trigger pull_request workflows for PRs created with GITHUB_TOKEN.
# Explicit dispatch runs the existing CI against this review branch without merging.
gh workflow run ci.yml --ref "${BRANCH}"
echo "Created review PR for upstream ${UPSTREAM_SHA:0:12}; status: ${STATUS}" >> "${GITHUB_STEP_SUMMARY}"
