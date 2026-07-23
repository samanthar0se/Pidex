# TASK

Review branch `{{BRANCH}}` for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are an expert code reviewer. Your job is **not just to comment** — actively improve the code on this branch, and explain what you changed.

# CONTEXT

Read `CONTEXT.md`, `.sandcastle/CODING_STANDARDS.md`, and any relevant ADRs under `docs/adr/` before starting.

<linked-issue>

!`gh issue view {{ISSUE_NUMBER}} --comments`

</linked-issue>

<diff-to-main>

This is a **summary** of the diff — changed files with added/removed line counts, not the full patch:

!`git diff main..HEAD --stat`

The full patch is deliberately omitted here because it can be very long. Go deeper on the files that matter: run `git diff main..HEAD -- <path>` on the changed files above to read the actual changes before reviewing.

</diff-to-main>

# REVIEW PROCESS

## 1. Analyse with the `code-review` skill

Use the **`code-review` skill** (It is supplied by the `samanthar0se/pi-mattpococks-skills` Pi package.) to produce the review. It analyses the diff along two axes — **Standards** and **Spec** — using parallel sub-agents. Its findings are the **single source of truth** for what's wrong with this branch: act only on what it reports, not on a separate ad-hoc pass of your own.

Invoke it with everything it needs, so it does **not** run its own discovery and does **not** prompt or pause:

- **Fixed point:** `main`. The diff to review is `git diff main...HEAD`. Do not ask for a fixed point — it is `main`.
- **Spec:** issue #{{ISSUE_NUMBER}} — already fetched above in `<linked-issue>`. Pass this as the spec. Do **not** look for `docs/agents/issue-tracker.md` and do **not** run `/setup-matt-pocock-skills`; the spec is provided. If the linked issue is a **PRD** (it has sub-issues), pull them with `gh api repos/$GH_REPO/issues/{{ISSUE_NUMBER}}/sub_issues` and treat each closed sub-issue as a sub-requirement; code for an _open_ sub-issue is a scope violation.
- **Standards:** `.sandcastle/CODING_STANDARDS.md` is this repo's documented standard — feed it as the standards source. The skill's built-in smell baseline applies on top, but a documented repo standard always wins.

The skill is read-only and produces a report; it does not edit code. That report — its Standards findings and its Spec findings — is your worklist for the steps below.

## 2. Act on the skill's findings

Work through the skill's findings and resolve each one on this branch:

- For any **correctness/robustness** finding, write a test that exercises it and try to actually break it. If you can break it, fix it. Cover the edge cases the skill flagged (empty/zero/negative inputs, missing optional fields, null/undefined, off-by-one, races, regressions in adjacent code).
- For any **quality/standards** finding, improve the code: reduce nesting, eliminate redundancy, improve names, consolidate related logic, drop comments that restate obvious code, avoid nested ternaries (prefer if/else or switch), choose clarity over brevity. Apply `.sandcastle/CODING_STANDARDS.md`.
- For any **spec** finding (missing coverage, scope creep, misinterpretation), do **not** silently "fix" missing spec coverage by adding code yourself — call it out in the `summary` and (where line-anchored) the inline comments for the human reviewer to decide.

**Preserve functionality.** When improving code, never change what it does — only how it does it. All original features, outputs, and behaviours must remain intact.

# EXECUTION

1. Run `npm run typecheck` and `npm run test` — confirm the current state passes.
2. Make improvements + write any new edge-case tests. Stage and commit them as a **single squashed commit** on this branch with a message starting with `CLANKER: Review -`.
3. Run `npm run typecheck` and `npm run test` again. If either fails, fix it before continuing — do not leave the branch broken.

If the code is already clean, make no commits.
