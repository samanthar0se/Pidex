# OpenAI GPT-5.x and Codex Agent Prompting Guidance

## Research question

What do recent first-party OpenAI sources say about initiative, scope control, testing, verification, autonomy, and minimal edits, especially where agent prompts can cause overtesting or reluctance to start small?

## Evidence boundary

- **Research date:** 2026-07-21 UTC.
- **Primary-source rule:** The ranked list uses OpenAI documentation, OpenAI Cookbook material, OpenAI GitHub repositories, and OpenAI engineering posts only.
- **Date basis:** For Cookbook and GitHub files, the date is the latest official commit containing the quoted text. For OpenAI engineering pages without a displayed publication date, the date is the official engineering sitemap `lastmod`; this is explicitly not treated as a publication date. For undated live documentation, the retrieval date is recorded instead.
- **Access note:** `openai.com` pages returned an access challenge to direct `curl` in this environment. Their canonical URLs were confirmed in OpenAI's official engineering sitemap, and the page text was read through a read-only text rendering. The canonical OpenAI URL remains the cited source; the renderer is not an authority.
- **Quote rule:** Excerpts below are copied from the cited source. Bracketed commentary is analysis, not source text.

## Ranked sources

### 1. Using GPT-5.6 — current model guidance

- **Date:** Not stated on the page; retrieved 2026-07-21 UTC.
- **Canonical URL:** https://developers.openai.com/api/docs/guides/latest-model/gpt-5.6.md
- **Relevant section:** `Prompting best practices`.

> Removing repeated instructions and examples and simplifying tool descriptions can improve task performance and token efficiency. In a sample of internal coding-agent eval runs, configurations with leaner system prompts improved evaluation scores by roughly 10–15% while reducing total tokens by 41–66% and cost by 33–67%.
>
> GPT-5.6 can be proactive and persistent when carrying out multi-step tasks. Define what level of action each request authorizes so the model can continue safe, in-scope work without unnecessary pauses while stopping before external, destructive, costly, or scope-expanding actions.
>
> For requests to change, build, or fix, make the requested in-scope local changes and run relevant non-destructive validation without asking first.
>
> Multiple, parallel, or dependent calls alone do not justify Programmatic Tool Calling. Prefer direct, non-PTC tool calls when: One call is sufficient.

**Why it maps:** This is the clearest current guidance against both prompt bloat and unjustified extra loops. It pairs initiative with an explicit scope boundary, and validation with relevance rather than exhaustive checking. The “one call is sufficient” rule is a direct guard against overtesting or over-tooling; “without asking first” addresses reluctance to begin an in-scope change.

### 2. Codex bundled GPT-5.6 prompting guidance

- **Date:** 2026-07-15, official Codex repository commit `2be648ba4a6c159a3d80b1c07e7323cbd5efef8f`.
- **Canonical URL:** https://github.com/openai/codex/blob/2be648ba4a6c159a3d80b1c07e7323cbd5efef8f/codex-rs/skills/src/assets/samples/openai-docs/references/prompting-guide.md
- **Source role:** Codex's bundled OpenAI Docs skill says the live model-specific section is canonical, then supplies migration judgment for GPT-5.6.

> Resolve the request in the fewest useful tool loops, but do not let loop minimization outrank correctness, required evidence, calculations, or required citations.
>
> After each result, ask whether the core request can now be answered with useful evidence. If yes, answer. If required evidence is still missing, name the missing fact and use the smallest useful fallback.
>
> After making changes, run the most relevant validation available:
> - targeted tests for changed behavior
> - type checks or lint checks when applicable
> - build checks for affected packages
> - a minimal smoke test when full validation is too expensive

**Why it maps:** This source gives a stopping rule that is neither “test everything” nor “skip verification.” It makes the smallest useful fallback and the minimal smoke test first-class options, which directly counters overtesting. “Fewest useful loops” also discourages repeated searches or retries, while the surrounding autonomy guidance permits starting work without waiting for unnecessary clarification.

### 3. Codex Prompting Guide — GPT-5.3-Codex guidance

- **Date:** 2026-03-04, official Cookbook commit `7379810d01589f91b367c17fb0619db02bf39345`.
- **Canonical URL:** https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
- **Versioned source permalink:** https://github.com/openai/openai-cookbook/blob/7379810d01589f91b367c17fb0619db02bf39345/examples/gpt-5/codex_prompting_guide.ipynb

> The most critical snippets are those covering autonomy and persistence, codebase exploration, tool use, and frontend quality. You should also remove all prompting for the model to communicate an upfront plan, preambles, or other status updates during the rollout, as this can cause the model to stop abruptly before the rollout is complete.
>
> - Default expectation: deliver working code, not just a plan. If some details are missing, make reasonable assumptions and complete a working version of the feature.
>
> - Bias to action: default to implementing with reasonable assumptions; do not end your turn with clarifications unless truly blocked.

**Why it maps:** OpenAI explicitly identifies upfront-plan/status prompting as a cause of premature stopping in this Codex configuration. That is direct evidence for reducing reluctance to start. The warning is not permission to expand scope: the same starter prompt says to make reasonable assumptions and deliver the requested working result, not an unrelated redesign.

### 4. GPT-5 prompting guide — agentic eagerness and coding

- **Date:** 2026-07-20, official Cookbook commit `0aaed0f1d32f83a43732c9cc23283a037a801782`.
- **Canonical URL:** https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide
- **Versioned source permalink:** https://github.com/openai/openai-cookbook/blob/0aaed0f1d32f83a43732c9cc23283a037a801782/examples/gpt-5/gpt-5_prompting_guide.ipynb

> - Avoid over searching for context. If needed, run targeted searches in one parallel batch.
>
> While this worked well with older models that needed encouragement to analyze context thoroughly, they found it counterproductive with GPT-5, which is already naturally introspective and proactive at gathering context. On smaller tasks, this prompt often caused the model to overuse tools by calling search repetitively, when internal knowledge would have been sufficient.
>
> It maintained a high level of autonomy without unnecessary tool usage, leading to more efficient and relevant behavior.
>
> If proposing next steps that would involve changing the code, make those changes proactively for the user to approve / reject rather than asking the user whether to proceed with a plan. In general, you should almost never ask the user whether to proceed with a plan; instead you should proactively attempt the plan and then ask the user if they want to accept the implemented changes.

**Why it maps:** This is direct first-party evidence of overtesting-like behavior: repeated search on small tasks caused unnecessary tool use. It also gives the counter-rule for reluctance: make a scoped proposed change proactively instead of pausing to ask whether to execute a plan.

### 5. GPT-5.2 Prompting Guide — scope drift and incremental evaluation

- **Date:** 2025-12-16, official Cookbook commit `e76ac2e5a23cfc7f6ceeb24690f4184dc56fde2b`.
- **Canonical URL:** https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-2_prompting_guide
- **Versioned source permalink:** https://github.com/openai/openai-cookbook/blob/e76ac2e5a23cfc7f6ceeb24690f4184dc56fde2b/examples/gpt-5/gpt-5-2_prompting_guide.ipynb

> GPT-5.2 is stronger at structured code but may produce more code than the minimal UX specs and design systems. To stay within the scope, explicitly forbid extra features and uncontrolled styling.
>
> - Implement EXACTLY and ONLY what the user requests.
> - No extra features, no added components, no UX embellishments.
> - If any instruction is ambiguous, choose the simplest valid interpretation.
>
> Step 1: Switch models, don’t change prompts yet. Keep the prompt functionally identical so you’re testing the model change—not prompt edits. Make one change at a time.
>
> Step 5: Re-run Evals after each small change. Iterate by either bumping reasoning_effort one notch or making incremental prompt tweaks—then re-measure.

**Why it maps:** The source identifies scope drift as a GPT-5.2 failure mode and prescribes the simplest valid interpretation. Its one-change-at-a-time migration loop is a controlled alternative to broad prompt rewrites; it prevents overtesting from becoming an uncontrolled experiment while still requiring measurement after a small change.

### 6. GPT-5.1 Prompting Guide — persistence and surgical prompt edits

- **Date:** 2026-01-15, official Cookbook commit `cad62ca31285f7891584f6ea89b62dc16f62af4a`.
- **Canonical URL:** https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-1_prompting_guide
- **Versioned source permalink:** https://github.com/openai/openai-cookbook/blob/cad62ca31285f7891584f6ea89b62dc16f62af4a/examples/gpt-5/gpt-5-1_prompting_guide.ipynb

> On long agentic tasks, we’ve noticed that GPT-5.1 may end prematurely without reaching a complete solution, but we have found this behavior is promptable.
>
> - Treat yourself as an autonomous senior pair-programmer: once the user gives a direction, proactively gather context, plan, implement, test, and refine without waiting for additional prompts at each step.
> - Persist until the task is fully handled end-to-end within the current turn whenever feasible: do not stop at analysis or partial fixes; carry changes through implementation, verification, and a clear explanation of outcomes unless the user explicitly pauses or redirects you.
> - Be extremely biased for action.
>
> Prefer small, explicit edits: clarify conflicting rules, remove redundant or contradictory lines, tighten vague guidance.

**Why it maps:** The first excerpt directly names reluctance/premature termination as an observed GPT-5.1 behavior and supplies an action-biased remedy. The second is a direct minimal-edit rule: fix the instruction causing the behavior rather than redesigning the whole prompt stack. The source still includes testing and verification in the completion loop, so initiative is not being treated as a substitute for checking work.

### 7. GPT-5.5 prompting guide in the official OpenAI Docs skill

- **Date:** 2026-04-24, official OpenAI Skills commit `da7611f0ddb078b641407842473e4fa308988516`.
- **Canonical URL:** https://github.com/openai/skills/blob/da7611f0ddb078b641407842473e4fa308988516/skills/.curated/openai-docs/references/prompting-guide.md
- **Source role:** The file is the official OpenAI Docs skill's GPT-5.5 fallback prompting guidance.

> Avoid carrying over every instruction from an older prompt stack. Legacy prompts often over-specify the process because earlier models needed more help staying on track. With GPT-5.5, that can add noise, narrow the model’s search space, or lead to overly mechanical answers.
>
> Resolve the user query in the fewest useful tool loops, but do not let loop minimization outrank correctness, accessible fallback evidence, calculations, or required citation tags for factual claims.
>
> Use the minimum evidence sufficient to answer correctly, cite it precisely, then stop.
>
> - targeted unit tests for changed behavior
> - a minimal smoke test when full validation is too expensive

**Why it maps:** This source distinguishes useful rigor from process over-specification. “Minimum evidence sufficient” and targeted/minimal validation are direct controls for overtesting. “Fewest useful loops” prevents a lean policy from turning into repeated retries, while the correctness exception prevents premature stopping.

### 8. GPT-5.2 Codex system prompt in the open-source Codex repository

- **Date:** 2026-07-15, official Codex repository commit `2be648ba4a6c159a3d80b1c07e7323cbd5efef8f`.
- **Canonical URL:** https://github.com/openai/codex/blob/2be648ba4a6c159a3d80b1c07e7323cbd5efef8f/codex-rs/core/gpt_5_2_prompt.md

> Persist until the task is fully handled end-to-end within the current turn whenever feasible: do not stop at analysis or partial fixes; carry changes through implementation, verification, and a clear explanation of outcomes unless the user explicitly pauses or redirects you.
>
> Changes should be minimal and focused on the task.
>
> When testing, your philosophy should be to start as specific as possible to the code you changed so that you can catch issues efficiently, then make your way to broader tests as you build confidence.
>
> When working in interactive approval modes like `untrusted`, or `on-request`, hold off on running tests or lint commands until the user is ready to finalize your output, because these commands take time to run and slow down iteration.
>
> If you’re operating in an existing codebase, you should make sure you do exactly what the user asks with surgical precision. Treat the surrounding codebase with respect, and don’t overstep.

**Why it maps:** This is the strongest direct Codex-agent policy for proportional verification. It requires end-to-end completion and in-scope edits, but it explicitly starts testing narrowly and recognizes that tests can slow interactive work. That combination counters both overtesting and reluctance: do the change, then run the smallest useful check under the current execution mode.

### 9. Codex repository `AGENTS.md`

- **Date:** 2026-07-15, official Codex repository commit `2be648ba4a6c159a3d80b1c07e7323cbd5efef8f`.
- **Canonical URL:** https://github.com/openai/codex/blob/2be648ba4a6c159a3d80b1c07e7323cbd5efef8f/AGENTS.md

> - Do not add tests for values that are statically defined.
> - Do not add negative tests for logic that was removed.
>
> Unless the change is mechanical the total number of changed lines should not exceed 800 lines.
>
> If the change is larger, explore whether it can be split into reviewable stages and identify the smallest coherent stage to land first.

**Why it maps:** These are concrete anti-overtesting and minimal-edit rules, not general exhortations. They reject tests with no behavioral value and turn a large change into the smallest reviewable stage rather than requiring a broad rewrite before the first useful result.

### 10. Harness engineering: leveraging Codex in an agent-first world

- **Date:** Official OpenAI engineering sitemap `lastmod` 2026-06-10; publication date is not stated on the page.
- **Canonical URL:** https://openai.com/index/harness-engineering/

> In practice, this meant working depth-first: breaking down larger goals into smaller building blocks (design, code, review, test, etc), prompting the agent to construct those blocks, and using them to unlock more complex tasks.
>
> Plans are treated as first-class artifacts. Ephemeral lightweight plans are used for small changes, while complex work is captured in execution plans with progress and decision logs that are checked into the repository.
>
> The repository operates with minimal blocking merge gates. Pull requests are short-lived. Test flakes are often addressed with follow-up runs rather than blocking progress indefinitely. In a system where agent throughput far exceeds human attention, corrections are cheap, and waiting is expensive.

**Why it maps:** OpenAI's own agent-first engineering account recommends small building blocks and lightweight plans for small changes. Its “corrections are cheap, and waiting is expensive” observation is a direct argument against making every check a blocking gate, while the follow-up-run practice preserves verification without making the agent wait indefinitely.

### 11. Unrolling the Codex agent loop

- **Date:** Official OpenAI engineering sitemap `lastmod` 2026-06-24; publication date is not stated on the page.
- **Canonical URL:** https://openai.com/index/unrolling-the-codex-agent-loop/

> As you might imagine, an agent could decide to make hundreds of tool calls in a single turn, potentially exhausting the context window. For this reason, context window management is one of the agent’s many responsibilities.

**Why it maps:** This is an agent-loop constraint rather than a prompt snippet, but it gives a concrete systems reason to stop repeated tool use. An agent that keeps searching, testing, or retrying after the answer is already established can spend its context budget without improving the result; a stopping rule is therefore part of correctness, not merely latency optimization.

## Release provenance checked

The current official Codex release page connects the latest release to the GPT-5.6 prompting material:

- **Release:** Codex `0.145.0`, released 2026-07-21.
- **Canonical URL:** https://github.com/openai/codex/releases/tag/rust-v0.145.0
- **Direct excerpt:** “Updated the bundled OpenAI Docs skill with current GPT-5.6 model resolution, prompting, and migration guidance across macOS, Linux, and Windows.”

This release entry is provenance for the current bundled guidance, not an additional behavioral source; the behavioral excerpts are taken from the linked skill file in source 2.

## Unverified

None. Every URL in the ranked list and release provenance section was confirmed through an official HTTP response, an official OpenAI sitemap entry, or a version-pinned official GitHub permalink. The two OpenAI engineering pages were directly readable only through the access method noted in the evidence boundary; their canonical URLs themselves were confirmed by OpenAI's sitemap.
