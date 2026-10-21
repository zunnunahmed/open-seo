# OpenSEO

> Open source alternative to Semrush and Ahrefs

OpenSEO is an SEO tool for _the people_. If tools like Semrush or Ahrefs are too expensive or bloated, OpenSEO is a pay-as-you-go alternative that you actually control.

> All-in-one SEO tool for you and your AI agent.

Connect with any agent like Claude Code, OpenClaw or Hermes. We have pre-built skills, but you can build your own to tailor OpenSEO to your needs.

<img width="100%" alt="openseo-keyword-research" src="https://github.com/user-attachments/assets/8ebdc439-3e72-41ab-8bde-8cda771ef2e8" />

## This Fork: Custom SEO Features and Updates

This repository is **Zunnun's customized fork** of [every-app/open-seo](https://github.com/every-app/open-seo). The upstream project and its original documentation are preserved; changes below apply specifically to this fork.

### Custom features

- **GSC URL categories:** Performance (>1,000 clicks), Good (500–1,000), Fair (100–499), Weak (1–99), Dead (0 clicks among GSC-returned page URLs), plus suggested SEO actions.
- **GSC Insights exports:** Category distribution chart, summary CSV, SVG chart, and one **.xlsx workbook with five category worksheets**. Current export source is limited to the first 1,000 returned page URLs, and excludes missing sitemap-only URLs.
- **Project-level SEO data providers:** Save DataForSEO / treg / Both preference per project. The current treg research path covers Backlinks; it does not replace all OpenSEO modules.
- **treg (Serpstat) Backlinks:** Manually requested summary, detailed referring domains/backlinks, per-project saved list snapshots, and CSV export. Individual provider queries can incur charges.
- **SERP keyword clustering (Research → Keyword Clustering):** Paste or upload up to 5,000 keywords. Their top-10 Google results come from DataForSEO's standard queue (about $0.0006 per keyword, with the cost confirmed before starting), and keywords are grouped by shared URLs in soft, strict or balanced mode. Threshold changes are instant and free. Shows cluster volume, likely page type, SERP features, top domains, competitor coverage, your ranking page and cannibalization, with CSV exports. A project domain is optional.
- **Sitemap monitoring and Google index coverage:** Monthly count of sitemap-listed URLs (works with or without a project domain). With Search Console connected, sitemap URLs are checked with the URL Inspection API, up to 500 a day per project, showing indexed / not indexed / not checked, the not-indexed reasons, and a CSV export.
- **Cloudflare self-host:** Production deployments are performed only through the manually confirmed GitHub workflow.

### Upstream Update Manager

[Full update procedure](./docs/UPSTREAM_UPDATE_MANAGER.md) · [Weekly workflow](./.github/workflows/upstream-update-review.yml) · [Update-safe architecture](./docs/CUSTOM_UPDATE_SAFE_ARCHITECTURE.md)

The automated workflow checks **every Monday at 03:17 UTC** for changes to `every-app/open-seo`:

1. Compare upstream `main` with this fork's `main`.
2. If there are new upstream changes, prepare a temporary `sync/upstream-*` review branch, summarize files touching custom integrations, and attempt a merge into the **review branch only**.
3. If conflicts occur, abort the merge and open a **blocked, report-only PR** listing conflicts. Do not merge such a PR into production.
4. Open a pull request for review and dispatch CI on the review branch. Review migrations, security, GSC/GA4 OAuth, DataForSEO/treg routing, and existing custom exports.
5. **Never automatically merge, approve or deploy.** Merge only after manual review and approval, then run [Cloudflare self-host deployment](./.github/workflows/selfhost-cloudflare-manual.yml) with operation `deploy` and confirmation `DEPLOY`.

GitHub Actions must be permitted to create pull requests under repository Actions settings. Initial manual execution on 2026-10-21 succeeded and reported no new upstream changes to review.

## Hosted Version

Try OpenSEO for free on our website. If you want to support the project, a hosted subscription is $10/month.

[openseo.so](https://openseo.so)

## Why use OpenSEO?

- Best in class MCP and AI Skills.
- Modern, simple UI.
  - Focused workflows instead of a bloated, complex SEO suite.
- No subscriptions.
  - Bring your own DataForSEO API key and pay only for what you use.
- Fork and vibe code your own custom tool.

## Main SEO Workflows

- Keyword research
- Rank tracking
- Competitor Insights
- Backlinks
- Site Audits
- AI Visibility

## OpenSEO MCP & Agent Skills

OpenSEO exposes an MCP server so AI agents like Claude Code, OpenClaw, and Hermes can use your SEO data directly. Agent Skills are reusable workflows that guide your agent through SEO tasks using the MCP.

- [Set up ChatGPT web or desktop](https://openseo.so/docs/chatgpt) (works on Free and paid ChatGPT plans)
- [Set up Codex](https://openseo.so/docs/codex-plugin)
- [Set up OpenSEO MCP](https://openseo.so/docs/mcp)
- [Set up OpenSEO Agent Skills](https://openseo.so/docs/skills/setup)

## Self-Hosting

OpenSEO supports two self-hosting paths:

- **Simple: Docker (Best for testing it out)** - For personal use on your own machine. See [`docs/SELF_HOSTING_DOCKER.md`](./docs/SELF_HOSTING_DOCKER.md).
  - Unless you already are self-hosting other apps and are confident doing so, we recommend self-hosting with Cloudflare as opposed to Railway, Coolify or Dokploy.
  - We plan to make it simpler to host on those platforms in the next few months.
- **Recommended: Cloudflare** - For internet-facing self-hosting across multiple devices or with your team (works on the free plan). See [`docs/SELF_HOSTING_CLOUDFLARE.md`](./docs/SELF_HOSTING_CLOUDFLARE.md).

Either way, you need a DataForSEO API key to get SEO data. See [`docs/DATAFORSEO_API_KEY.md`](./docs/DATAFORSEO_API_KEY.md).

## Costs

OpenSEO needs a [DataForSEO](https://dataforseo.com/?aff=255379) API key so that you can get SEO data. You pay them directly when self hosting.

See [openseo.so/pricing](https://openseo.so/pricing)

When you self host, your costs will be slightly lower than the estimates on our website. The way the hosted service makes money is by charging 28% extra for every request we make to DataForSEO.

## Local Development

See [`docs/LOCAL_DEVELOPMENT.md`](./docs/LOCAL_DEVELOPMENT.md).

## Contributing

Creating clear issues is the best way to contribute.

Read more here: [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md)

We have this skill: `/simple-issue-description` which helps.

```sh
npx skills add every-app/open-seo --skill simple-issue-description
```

## Community

Join Discord to chat: [Discord](https://discord.gg/c9uGs3cFXr)

Follow along for updates:

- Follow on X: https://x.com/bensenescu
- Sign up for the mailing list on our website: [openseo.so](https://openseo.so)
