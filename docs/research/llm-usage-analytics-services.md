# Lightweight Self-Hosted LLM Usage Analytics

## Research question

Which lightweight, batteries-included services can be installed to analyze LLM token usage, estimated cost, and request activity, with a preference for local or self-hosted operation?

## Recommendation

**Start with Arize Phoenix** if the application can emit traces. It is the best balance of low operational weight, useful built-in analytics, Windows-friendly installation, and project maturity:

- The complete service can run as one Python package with `pip install arize-phoenix` and `phoenix serve`, or as one Docker container. [S1](https://github.com/Arize-ai/phoenix#run-locally) [S2](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker)
- SQLite is the default local/single-user backend; PostgreSQL is optional for production or multi-user deployment. Persist the SQLite working directory rather than relying on temporary container storage. [S2](https://arize.com/docs/phoenix/self-hosting/deployment-options/docker) [S3](https://arize.com/docs/phoenix/self-hosting/architecture)
- Its prebuilt project dashboard includes estimated USD cost, top models by cost and tokens, prompt/completion token usage, cache/reasoning token details, latency, errors, and tool activity. [S4](https://arize.com/docs/phoenix/tracing/llm-traces/metrics)
- It calculates costs from captured token counts and a built-in model pricing table, supports custom prices in the UI, and rolls costs up across spans, traces, sessions, projects, and experiments. [S5](https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking)
- It accepts OpenTelemetry/OpenInference traces and has first-party TypeScript packages and instrumentations for OpenAI, Anthropic, Vercel AI SDK, LangChain.js, Claude Agent SDK, and MCP. This is a good match for a TypeScript service and avoids putting a new gateway in the request path. [S1](https://github.com/Arize-ai/phoenix#typescript-subpackages)

**Use `llmview` for a disposable local trial** if the main requirement is intercepting existing tools with almost no integration work. It is a single approximately 10 MB Go binary with a web dashboard and local SQLite database, and publishes a Windows executable. It tracks OpenAI, Anthropic, and Ollama calls through provider base-URL overrides and includes per-call cost, search, replay, export, and a session budget ceiling. [S6](https://github.com/uucz/llmview)

The important qualification is maturity: `llmview` was created in March 2026, had three GitHub stars, and only two releases in the repository snapshot inspected on 2026-07-21. Treat it as a useful local tool, not yet as trusted production infrastructure. [E1](https://api.github.com/repos/uucz/llmview) [E2](https://api.github.com/repos/uucz/llmview/releases)

## Shortlist

| Service | Footprint | Collection model | Analytics included | Best use | Main drawback |
|---|---|---|---|---|---|
| **Arize Phoenix** | One Python process or container; SQLite by default | OpenTelemetry/OpenInference instrumentation | Strong token/cost dashboard, traces, latency, errors, evals, prompt tools | Application-owned observability | Requires instrumentation; not a transparent proxy |
| **llmview** | One Windows/Linux/macOS binary; SQLite | Reverse proxy via provider base URLs | Live calls, tokens, cost, replay, export, budget cap | Fast local Windows trial | Extremely young project; only three providers documented |
| **llm.log** | One Go binary; SQLite; no Docker | `HTTPS_PROXY` interception with a locally trusted MITM CA | Excellent local web/TUI cost analytics, 800+ model prices, exports and pruning | Broad local CLI/tool capture on Linux/macOS | No Windows release; young project; installs a local CA and stores prompts/responses |
| **LiteLLM Proxy** | One application container plus PostgreSQL for tracking/UI; Redis for multi-instance production | Central LLM gateway | Spend by key/user/team/model/provider, budgets, keys, routing, broad provider support | Gateway and governance are also required | PostgreSQL is mandatory for tracking features; materially heavier than Phoenix |
| **OpenLIT** | OpenLIT + ClickHouse + OpenTelemetry Collector | OpenTelemetry-native auto-instrumentation | Cost, tokens, latency, traces, metrics, safety/evaluation features | Existing OTel/ClickHouse environments | Three components make a clean install heavier |

## Detailed assessment

### Arize Phoenix: best overall

Phoenix is unusually close to “batteries included” without requiring a database stack. The package contains the server, collector, UI, and SQLite-backed persistence. It can later move to PostgreSQL without changing the instrumentation model. [S1](https://github.com/Arize-ai/phoenix) [S3](https://arize.com/docs/phoenix/self-hosting/architecture)

The tradeoff is that Phoenix does not discover arbitrary LLM traffic on the machine. The application must emit suitable spans. Its automatic cost calculation needs model/provider identity and token counts; supported OpenInference instrumentations capture these automatically, while manual OpenTelemetry spans must provide the documented attributes. [S5](https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking)

Phoenix is source-available under Elastic License 2.0 rather than an OSI-approved permissive license. Its self-hosted edition is documented as having no feature limitations, but license compatibility should be reviewed before redistribution or embedding. [S1](https://github.com/Arize-ai/phoenix#copyright-patent-and-license) [S7](https://arize.com/docs/phoenix/self-hosting)

### llmview: lightest Windows option

`llmview` changes `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, or `OLLAMA_HOST` so traffic passes through its local reverse proxy. Unlike a system-wide TLS-interception proxy, this does not require installing a certificate authority. The dashboard and SQLite database ship in the same MIT-licensed binary. [S6](https://github.com/uucz/llmview)

Its documented budget is a single session cost ceiling rather than mature per-user/team accounting. Provider support is limited to OpenAI, Anthropic, and Ollama. Most importantly, its age and tiny user base mean reliability, pricing updates, migrations, and security have not had broad exposure.

### llm.log: most polished tiny local proxy

`llm.log` is the most feature-complete of the tiny proxies inspected. It captures known LLM domains through `HTTPS_PROXY`, stores compressed request/response bodies and metadata in SQLite, provides web and terminal dashboards, calculates costs from automatically updated pricing for more than 800 models, exports CSV/JSON/JSONL, and can prune bodies while retaining usage metadata. [S8](https://github.com/lanesket/llm.log)

It is not currently a straightforward native Windows choice. Its official releases inspected on 2026-07-21 only contain macOS and Linux binaries, and its proxy activation documentation covers macOS and Linux. It could be tested in WSL, but that will not automatically observe native Windows applications. [E3](https://api.github.com/repos/lanesket/llm.log/releases) [S8](https://github.com/lanesket/llm.log#proxy-activation)

Its interception design also has a larger security surface: setup creates and trusts a local CA, and full prompts and responses are stored by default. It only MITMs known LLM domains, but the CA private key and local database still require protection. The project was created in March 2026 and had 18 stars in the inspected snapshot, so it carries the same maturity caveat as `llmview`. [E4](https://api.github.com/repos/lanesket/llm.log)

### LiteLLM: choose when a gateway is desirable

LiteLLM is the strongest gateway rather than the lightest analytics service. It normalizes more than 100 providers and automatically calculates known-model spend. Its tracking model supports keys, users, teams, daily activity, model/provider breakdowns, budgets, and an Admin UI. [S9](https://docs.litellm.ai/docs/proxy/cost_tracking) [S10](https://docs.litellm.ai/docs/proxy/virtual_keys)

The analytics path requires PostgreSQL and a proxy master key. Production guidance adds Redis for multiple instances. This is justified if centralized provider credentials, virtual keys, routing, quotas, or budget enforcement are goals; it is excessive if the only goal is a local token/cost dashboard. [S10](https://docs.litellm.ai/docs/proxy/virtual_keys) [S11](https://docs.litellm.ai/docs/proxy/deploy)

### OpenLIT: good OTel stack, not truly tiny

OpenLIT offers automatic OpenTelemetry-native instrumentation and real-time cost, token, latency, trace, and evaluation features. Its self-hosted platform requires three components: OpenLIT, ClickHouse, and an OpenTelemetry Collector. Existing ClickHouse or OTel infrastructure can be reused, but a fresh install is a three-service Docker Compose stack. [S12](https://docs.openlit.io/latest/openlit/installation) [S13](https://docs.openlit.io/latest/sdk/overview)

This makes OpenLIT attractive when OpenTelemetry is already an architectural commitment and higher-volume analytics justify ClickHouse. Phoenix is simpler for a first local installation.

## Options not recommended for this requirement

- **Langfuse** is mature and feature-rich, but its current self-hosted v3 architecture uses two application containers plus PostgreSQL, ClickHouse, Redis/Valkey, and S3-compatible blob storage. It is not lightweight. [S14](https://langfuse.com/self-hosting)
- **Helicone** is a credible gateway/observability platform, but its official self-hosted production path is oriented around Kubernetes and supporting cloud infrastructure. It does not beat LiteLLM for this specific lightweight requirement. [S15](https://docs.helicone.ai/getting-started/self-host/kubernetes)
- **TokenLens** advertises an impressive local SQLite dashboard, budgets, forecasting, prompt-waste detection, routing, guardrails, and Prometheus output, but the inspected repository was created in March 2026, had seven stars, no GitHub releases, and uses GPL-3.0. Its background-service instructions are not documented for Windows. It is a watchlist candidate rather than a first install. [S16](https://github.com/stephenlthorn/token-lens) [E5](https://api.github.com/repos/stephenlthorn/token-lens)
- **Lunary** has suitable analytics, but current official self-hosting documentation states that Docker, Docker Compose, and Kubernetes self-hosting are Enterprise Edition features and require PostgreSQL. [S17](https://docs.lunary.ai/more/self-hosting/docker-compose)

## Practical choice for Pidex

Pidex is a TypeScript application, so the least invasive durable path is:

1. Run Phoenix locally with persistent SQLite storage.
2. Add `@arizeai/phoenix-otel` and the relevant OpenInference instrumentation at the Host's LLM-call boundary.
3. Attach stable Pidex identifiers such as Project, Workspace, Session, and Run as span attributes while avoiding secrets and unnecessary prompt contents.
4. Let Phoenix derive costs from model and token attributes; add custom model pricing only where the built-in table does not match the actual provider contract.
5. Keep Phoenix bound to localhost for the first trial. Add authentication/TLS or a protected reverse proxy before any LAN exposure.

If the immediate goal is instead to observe unmodified native Windows clients, download `llmview-windows-amd64.exe`, point one test client's provider base URL at it, and treat the resulting data as disposable until the tool has been security-reviewed.

## Security and accuracy boundaries

- Proxy and tracing products can capture prompts, responses, tool arguments, retrieved documents, and credentials accidentally placed in payloads. Default to metadata and token counts where full content is unnecessary.
- A local dashboard without documented authentication should remain on loopback. “Self-hosted” does not by itself make LAN or internet exposure safe.
- Cost figures are estimates derived from token counts and a pricing table, not provider invoices. Provider tiers, cache categories, batch discounts, negotiated prices, and stale model mappings can cause differences. LiteLLM explicitly documents a discrepancy-debugging workflow; Phoenix supports custom pricing for the same reason. [S9](https://docs.litellm.ai/docs/proxy/cost_tracking) [S5](https://arize.com/docs/phoenix/tracing/how-to-tracing/cost-tracking)
- Transparent proxies become part of the availability path for LLM calls. Instrumentation-based export generally has a smaller failure blast radius and should be configured not to block application requests when the analytics backend is unavailable.
- Phoenix collects basic product web analytics by default, but documents that trace/evaluation data is not collected and supports disabling this with `PHOENIX_TELEMETRY_ENABLED=false`. [S1](https://github.com/Arize-ai/phoenix#telemetry)

## Evidence snapshot

Research was performed against first-party documentation, repositories, release feeds, and GitHub repository metadata on **2026-07-21 UTC**. GitHub popularity numbers are only maturity signals and will change.

| Repository | Stars | Created | Last push in snapshot | Reported license metadata |
|---|---:|---|---|---|
| `Arize-ai/phoenix` | 10,658 | 2022-11-09 | 2026-07-21 | GitHub API did not classify; repository states ELv2 |
| `BerriAI/litellm` | 54,254 | 2023-07-27 | 2026-07-21 | GitHub API did not classify |
| `openlit/openlit` | 2,628 | 2024-01-23 | 2026-07-21 | Apache-2.0 |
| `lanesket/llm.log` | 18 | 2026-03-15 | 2026-04-04 | MIT |
| `stephenlthorn/token-lens` | 7 | 2026-03-11 | 2026-03-15 | GPL-3.0 |
| `uucz/llmview` | 3 | 2026-03-17 | 2026-03-18 | MIT |

Repository metadata sources: [Phoenix](https://api.github.com/repos/Arize-ai/phoenix), [LiteLLM](https://api.github.com/repos/BerriAI/litellm), [OpenLIT](https://api.github.com/repos/openlit/openlit), [llm.log](https://api.github.com/repos/lanesket/llm.log), [TokenLens](https://api.github.com/repos/stephenlthorn/token-lens), and [llmview](https://api.github.com/repos/uucz/llmview).
