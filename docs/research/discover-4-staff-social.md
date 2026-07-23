# OpenAI Staff Sources on GPT-5, Codex, and Agent Prompting

## Research question

Find primary social posts, threads, and articles by identifiable OpenAI researchers, engineers, or developer-relations staff about prompting GPT-5-family models or Codex/agents, prioritizing concrete system-prompt wording and behavioral observations about overthinking, overtesting, verbosity, scope, incremental changes, and tool use.

## Evidence boundary

- Research date: **2026-07-21 UTC**.
- The deliverable below contains first-party OpenAI Developers/OpenAI pages and posts, plus posts by identifiable OpenAI staff whose profiles or official guide author pages establish the affiliation.
- Quotes are exact excerpts. Ellipses only mark omitted surrounding text; they do not fill gaps in the source.
- Official prompting guides are mutable. Their displayed publication dates and named contributors are recorded as observed on the linked pages.
- No unverified links are retained below. **Unverified leads: none.**

## Ranked primary sources

### 1. Codex Prompting Guide — direct system-prompt and behavior guidance

- **Source:** [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- **Source type:** First-party OpenAI Developers article/cookbook guide.
- **Displayed date:** February 25, 2026.
- **Author/role:** Noah MacCallum and Brian Fioca, named contributors on the official page; the page identifies them as guide contributors but does not state their job titles. The page links [Noah MacCallum's X profile](https://x.com/noahmacca) and [Brian Fioca's LinkedIn profile](https://www.linkedin.com/in/brian-fioca/).
- **Why it matters:** This is the closest primary source to the requested system-prompt wording. It explains how to migrate an agent harness, what to remove from the prompt, and what the starter prompt was optimized against.
- **Exact excerpts:**
  > "The most critical snippets are those covering autonomy and persistence, codebase exploration, tool use, and frontend quality."
  >
  > "You should also remove all prompting for the model to communicate an upfront plan, preambles, or other status updates during the rollout, as this can cause the model to stop abruptly before the rollout is complete."
  >
  > "This prompt began as the default GPT-5.1-Codex-Max prompt and was further optimized against internal evals for answer correctness, completeness, quality, correct tool usage and parallelism, and bias for action."
  >
  > "Overthinking / long time before first useful action (tool call or concrete plan)."
- **Context:** The first two excerpts are in the guide's migration/key-steps section. The third introduces the recommended starter prompt. The overthinking excerpt appears in the troubleshooting/metaprompting section's list of tracked failure modes. This is an article, not a repost or secondary summary.

### 2. Alexander Embiricos — long-lived Codex threads, steering, and parallel subagents

- **Direct post:** [X post](https://x.com/embirico/status/2046033614106931414)
- **Author/role:** [Alexander Embiricos](https://x.com/embirico), Codex at OpenAI; his X profile bio says `Codex @OpenAI`.
- **Date:** April 20, 2026, 01:10:01 UTC (X page's `datePublished` metadata).
- **Exact text:**
  > "Subagents + steering in Codex is pretty magical."
  >
  > "I'm slowly shifting to longer-lived threads. The thread is pretty much always active because I prompted it or an automation pinged it. Then, when I need anything new, I say \"using a subagent in parallel, do X\""
- **Thread context:** A first-person product/workflow observation posted by a Codex staff member. The post describes an always-running thread, automation-triggered work, steering, and a parallel-subagent instruction; no secondary commentary is used here.
- **Why it matters:** It is a concrete staff observation of agent persistence, incremental delegation, and parallel tool/agent use rather than a generic launch claim.

### 3. GPT-5.2 Prompting Guide — explicit scope, verbosity, routine-tool, and incremental-eval controls

- **Source:** [GPT-5.2 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-2_prompting_guide)
- **Source type:** First-party OpenAI Developers article/cookbook guide.
- **Displayed date:** December 11, 2025.
- **Author/role:** Mandeep Singh and Emre Okcular, named contributors on the official page; the page identifies them as guide contributors but does not state their job titles. The page links [Mandeep Singh's OpenAI GitHub profile](https://github.com/msingh-openai) and [Emre Okcular's LinkedIn profile](https://www.linkedin.com/in/emreokcular/).
- **Why it matters:** It gives unusually direct guidance for preventing scope drift and reducing unnecessary narration/tool activity.
- **Exact excerpts:**
  > "GPT-5.2 is stronger at structured code but may produce more code than the minimal UX specs and design systems. To stay within the scope, explicitly forbid extra features and uncontrolled styling."
  >
  > "Implement EXACTLY and ONLY what the user requests."
  >
  > "No extra features, no added components, no UX embellishments."
  >
  > "Avoid narrating routine tool calls (\"reading file…\", \"running tests…\")."
  >
  > "Re-run Evals after each small change. Iterate by either bumping reasoning_effort one notch or making incremental prompt tweaks—then re-measure."
- **Context:** The scope excerpts are from section 3.2, the routine-tool excerpt is from the user-updates guidance, and the last excerpt is from the migration/evaluation loop. The guide is first-party and names its contributors.

### 4. GPT-5.1 Prompting Guide — verbosity balance, premature termination, and parallel tools

- **Source:** [GPT-5.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-1_prompting_guide)
- **Source type:** First-party OpenAI Developers article/cookbook guide.
- **Displayed date:** November 13, 2025.
- **Author/role:** Samarth Madduru, named contributor on the official page; his [X profile](https://x.com/samarthmadduru) identifies him with `@openai`. The page identifies him as a guide contributor but does not state his job title.
- **Why it matters:** It records both sides of the verbosity/completeness tradeoff and directly documents premature ending on long agentic tasks.
- **Exact excerpts:**
  > "GPT-5.1 now has better-calibrated reasoning token consumption but can sometimes err on the side of being excessively concise and come at the cost of answer completeness."
  >
  > "While overall more detailed, GPT-5.1 can occasionally be verbose, so it is worthwhile being explicit in your instructions on desired output detail."
  >
  > "On long agentic tasks, we've noticed that GPT-5.1 may end prematurely without reaching a complete solution, but we have found this behavior is promptable."
  >
  > "GPT-5.1 also executes parallel tool calls more efficiently."
  >
  > "Parallelize tool calls whenever possible. Batch reads (read_file) and edits (apply_patch) to speed up the process."
- **Context:** These excerpts come from the guide's opening behavior notes, solution-persistence section, and tool-calling/parallelism section. They are guidance based on OpenAI's stated customer/internal observations, not independent commentary.

### 5. Noah MacCallum — direct long-running Codex behavior observation

- **Direct post:** [X post](https://x.com/noahmacca/status/2002583009489453186)
- **Author/role:** [Noah MacCallum](https://x.com/noahmacca), named contributor to the official Codex Prompting Guide above; the post is therefore attributable to an identifiable OpenAI guide contributor, though his X profile does not state a job title.
- **Date:** December 21, 2025, 03:32:50 UTC (X page's `datePublished` metadata).
- **Exact text:**
  > "Codex-5.2-xhigh doing a very impressive refactor (80 minutes in)"
  >
  > "Atlas agent building my cycling workouts for next week"
  >
  > "Scavenger's Reign playing on the side, sipping a Sanzo"
  >
  > "The year of agents"
- **Thread context:** Standalone first-person status observation. It reports a long-running `Codex-5.2-xhigh` refactor continuing while another agent builds a separate artifact; no repost or secondary interpretation is included.
- **Why it matters:** It is a concrete staff observation of long-horizon execution and concurrent agent work, complementing the formal guide's autonomy/tool guidance.

### 6. GPT-5 Prompting Guide — over-searching, scope calibration, incremental changes, and verbosity

- **Source:** [GPT-5 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
- **Source type:** First-party OpenAI Developers article/cookbook guide.
- **Displayed date:** August 7, 2025.
- **Author/role:** Anoop Kotha, Julian Lee, Eric Zakariasson, and Erin Kavanaugh, named contributors on the official page. The page links [Anoop Kotha's X profile](https://x.com/anoopkotha), [Julian Lee's X profile](https://x.com/julianl093), [Eric Zakariasson's X profile](https://x.com/ericzakariasson), and [Erin Kavanaugh's LinkedIn profile](https://www.linkedin.com/in/erinkavanaugh/). The page identifies them as guide contributors but does not state job titles.
- **Why it matters:** This is the foundational GPT-5 source for the requested behavior categories and includes a concrete system-prompt pattern.
- **Exact excerpts:**
  > "GPT-5 is, by default, thorough and comprehensive when trying to gather context in an agentic environment ... To reduce the scope of GPT-5’s agentic behavior—including limiting tangential tool-calling action and minimizing latency to reach a final answer—try the following:"
  >
  > "Avoid over searching for context. If needed, run targeted searches in one parallel batch."
  >
  > "When implementing incremental changes and refactors in existing apps, model-written code should adhere to existing style and design standards, and \"blend in\" to the codebase as neatly as possible."
  >
  > "The team initially found that the model produced verbose outputs, often including status updates and post-task summaries that, while technically relevant, disrupted the natural flow of the user."
  >
  > "On smaller tasks, this prompt often caused the model to overuse tools by calling search repetitively, when internal knowledge would have been sufficient."
- **Context:** The first three excerpts are from the agentic-eagerness and incremental-code sections. The last two are OpenAI's account of Cursor's GPT-5 alpha testing and prompt tuning, reproduced in this first-party guide; they are not a third-party Cursor article.

### 7. OpenAI Developers — GPT-5.2-Codex tool-use and long-context announcement

- **Direct post:** [X post](https://x.com/OpenAIDevs/status/2001723687373017313)
- **Author/role:** [OpenAI Developers](https://x.com/OpenAIDevs), official developer-relations account. Its X profile describes it as providing “Official updates for developers building with Codex & the OpenAI Platform.”
- **Date:** December 18, 2025, 18:38:11 UTC (X page's `datePublished` metadata).
- **Exact text:**
  > "Meet GPT-5.2-Codex, the best agentic coding model yet for complex, real-world software engineering."
  >
  > "With native compaction, better long-context understanding, and improved tool-calling, it is a more dependable partner for your hardest tasks."
  >
  > "Available in Codex starting today."
- **Thread context:** Standalone official developer update; it announces the Codex surface and names the three relevant behavior changes. It is not a repost or secondary commentary.
- **Why it matters:** It is a primary release statement tying GPT-5.2-Codex to compaction, long-running context, and tool calling.

### 8. OpenAI Developers — GPT-5-Codex is not a drop-in replacement

- **Direct post:** [X post](https://x.com/OpenAIDevs/status/1970535241556308242)
- **Author/role:** [OpenAI Developers](https://x.com/OpenAIDevs), official developer-relations account; the profile describes official Codex/OpenAI Platform developer updates.
- **Date:** September 23, 2025, 17:06:27 UTC (X page's `datePublished` metadata).
- **Exact text:**
  > "GPT-5-Codex is also ready to integrate into agentic coding apps and workflows."
  >
  > "We optimized the model for Codex, so it’s not a drop-in replacement for other models. Check out the prompt guide for best results."
- **Thread context:** Standalone developer post linking the official Codex Prompting Guide. It explicitly warns that the model's intended prompt/tool harness differs from a generic model integration.
- **Why it matters:** This is the clearest first-party social pointer to the separate Codex prompt contract.

## Cross-source index by requested behavior

| Behavior | Strongest primary records |
|---|---|
| Overthinking / time before first useful action | Codex Prompting Guide (#1); GPT-5 Prompting Guide's agentic-eagerness section (#6) |
| Over-searching / excess tool use | GPT-5 Prompting Guide (#6); GPT-5.2 Prompting Guide's routine-tool guidance (#3) |
| Verbosity and status updates | GPT-5 Prompting Guide (#6); GPT-5.1 Prompting Guide (#4); Codex Prompting Guide (#1) |
| Scope and incremental changes | GPT-5.2 Prompting Guide (#3); GPT-5 Prompting Guide (#6) |
| Long-running autonomy / persistence | Codex Prompting Guide (#1); Noah MacCallum post (#5); Alexander Embiricos post (#2) |
| Parallel tool or agent use | GPT-5.1 Prompting Guide (#4); Codex Prompting Guide (#1); Alexander Embiricos post (#2) |
| Compaction and long context | OpenAI Developers GPT-5.2-Codex post (#7) |
| Codex-specific harness/prompt boundary | OpenAI Developers GPT-5-Codex post (#8); Codex Prompting Guide (#1) |

## Verification notes

- X dates and text above were taken from the linked X pages' `SocialMediaPosting` JSON-LD (`articleBody`, `datePublished`, and author fields), not from reposts or search-result paraphrases.
- The four guide pages visibly show their publication dates, named contributor links, titles, and official `developers.openai.com` URLs.
- The source set intentionally does not include leaked prompts, Reddit discussions, news coverage, or third-party prompt summaries.
