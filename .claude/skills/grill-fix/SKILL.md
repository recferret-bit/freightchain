---
name: grill-fix
description: >
  Grill a large change against the idea that produced it, then fix what the
  grill finds. Before the code review, grill the business value of the feature
  and stop until the user answers those questions; challenge a vague answer
  once. Three different models each review the feature from scratch, one after
  another; confirmed bugs, gaps, misconfigurations, and security holes are
  fixed between passes. Then check that tests exist and pass, and that the
  changed code is strict, clean, and in line with the frameworks it uses. Use
  when the user runs /grill-fix, or asks to grill, harden, or review-and-fix a
  big task, uncommitted work, or a feature against the original idea.
argument-hint: "[what to review]"
---

# Grill-fix

You orchestrate. Before the three reviews, one pass grills the business value and you stop until the user answers. The three reviews are three separate subagents, run one at a time. You do not review in their place, and you do not spawn the next pass before the current one has finished and its findings file is on disk.

Scratch directory: `/tmp/grill-fix-<8 hex chars>/`. Create it first. All paths below live there. Inline the absolute paths in every subagent prompt.

Tell the user which pass is starting, in one line, before each spawn.

## 1. Subject

Resolve the code under review in this order:

1. This message names a target (paths, a feature, a PR number or URL, a branch). That target is the subject. Also include uncommitted changes that touch the same files.
2. Otherwise, if `git status --porcelain` is non-empty, the subject is the uncommitted work: staged, unstaged, and untracked.
3. Otherwise the subject is the current branch versus its merge-base with `origin/main`, or `origin/master` if `origin/main` does not exist.

No subject and no idea: stop. Say there is nothing to grill.

Write `files.txt` (one path per line) and `diff.patch` (unified diff, `git -c color.ui=false -c color.diff=false`). For untracked text files, list them in `files.txt` and let the reviewer read them. Skip `node_modules`, build output, lockfiles that are the whole change, and secret files (`.env`, `deploy/.env`, `deploy/secrets/`). If a secret file is part of the change, name it in the report and do not read its values.

## 2. Idea

Write `idea.md` before the first review.

- Quote the user's request from this conversation: the task the code was supposed to satisfy. When this message is only `/grill-fix`, use the earlier messages that specified the work.
- Number the requirements. Each one must be markable `met`, `missing`, `partial`, or `contradicted`.
- Note what is out of scope.
- For each touched area in this repo, read the matching `docs/agents/<topic>.md` (the table is in `AGENTS.md`) and add only the hard rules that this feature can violate. Do not paste those files.

If the conversation never stated the task, recover the idea from the PR body, the branch commits, and docs the diff edits. Label that block `inferred`.

## 3. Business value

Spawn one read-only subagent before any code review. Description: `[grill] value`. Read Models first and pick this pass's model with rule 1. It writes `value-questions.md` and nothing else.

Its job:

- Read `idea.md`, `files.txt`, and `diff.patch`. Read the changed files only to see what the change does.
- Grill the business value of this feature. Do not file bugs. The code review comes later.
- Write 3 to 6 questions. Each one names a concrete stake in this diff (a person, a payout, a promise already made, a cost this change adds, or a behavior this change is supposed to change) and asks for a consequence only the user knows.
- A question the repository can answer, a question that restates a requirement, or a generic question that would fit any feature does not count. Replace it.
- No suggested answers, no options, no scoring.

```
## Questions
### Q1
<second person, one paragraph, ends with the question>
```

If the file is missing or every question is generic, rewrite the questions once yourself. Stop if they are still empty.

Ask the user in the chat and end the turn. Ask in prose, not as choices. One line: answer these before the code is reviewed; restating the feature is not an answer. Then the questions, numbered. Then the scratch path, so the next turn resumes the same directory.

Do not spawn a review pass in the turn that asks. If this message already states the value, ask only what is still open.

On the next message, resume that scratch directory. Do not re-ask a question they answered. Write `value.md`: the question, the answer verbatim, and a mark.

- `held` — names a person, a cost, or an observable, and says what changes.
- `thin` — a reply arrived and still does not, after the one challenge below.
- `declined` — they said to skip, or to just review the code.
- `unanswered` — no reply. Do not continue while any question is `unanswered`.

Challenge: for each answer that only repeats `idea.md`, says people want it, or names no person, cost, or observable, send one reply. Quote the weak sentence. Ask what changes for whom, or what they would look at to know it failed. One challenge round for the set. The reply to that challenge is the record. A decline is not challenged.

Append each `held` answer to the requirements the reviewers walk, as `V1`…. Same marks as the `R` items. `thin`, `declined`, and `unanswered` are not requirements. Reviewers must not invent a value to fill them.

Then continue at Models.

## 4. Models

Read the `spawn_subagent` schema before the first spawn. When it accepts `model`, pick three distinct ids from the values the schema allows:

1. A model other than the parent session's model. Prefer the strongest reasoning id in the list.
2. An id from a different provider family than pass 1, when the list has one.
3. A third id, distinct from the first two.

Fewer than three allowed ids: reuse, and record the reuse in `ledger.md`. Never invent an id. If a spawn that set `model` fails because the session forces model inheritance, retry that spawn once without `model` and record `parent` for that pass.

Each pass is a new subagent. Do not set `resume_from`. Call with `background: false` and `isolation: none` (the next pass must see the fixes). Description: `[grill] pass N`. If the tool returns before the pass finishes, wait on that task id before spawning the next one.

## 5. Review pass

Give the reviewer absolute paths to `idea.md`, `value.md`, `files.txt`, and `diff.patch`, plus this job:

- Read `idea.md` and `value.md` first. Then read every file in `files.txt` in full, and the callers and callees the feature depends on. The diff is a map. Review the current behavior.
- Start from scratch. There is no earlier review to confirm. Judge the tree as it is against the idea and the held answers.
- Walk every `R` and `V` requirement. The code can meet every `R` item and still miss a `V` item. That miss is a `gap`. Then walk the happy path, the error path, empty and boundary inputs, auth and trust boundaries, configuration and defaults, and persistence.
- Do not write questions for the user. Do not turn a `thin`, `declined`, or `unanswered` question into a finding.
- Missing behavior, behavior that contradicts the idea, and extra behavior that changes a promise are findings. A pre-existing bug is a finding only when this change depends on it or extends it.
- Look for misconfiguration (env, flags, defaults, deploy wiring, schema drift), security holes (authz, injection, secrets, money and escrow, cross-user access), logic gaps, and races.
- Record a missing test as `test-gap`. Do not write code or tests.
- A requirement the code satisfies is `met`. Do not invent a finding to fill the file.

The reviewer is read-only except for `pass-N.md`. It writes that file in this shape:

```
## Verdict
<does the current code match the idea and the held answers? 2-4 sentences>

## Checklist
- [met|missing|partial|contradicted] R<n>|V<n> <requirement> — <file:line or "absent">

## Findings
### F1 — blocker|bug|gap|security|misconfig|test-gap|quality
- File: path:line
- Evidence: <what the code does>
- Against: <requirement id or invariant>
- Fix: <the change, not a rewrite>
```

No findings: write the verdict, the checklist, and `## Findings` with nothing under it.

If the findings file is missing or empty after the subagent returns, stop. Report which pass failed. Do not continue.

## 6. Fix, then the next pass

Append to `ledger.md` after each pass. For every finding:

- Read the cited code. Drop the finding when the citation is wrong or the behavior is what the idea or a held answer asked for. Record the reason.
- Fix a confirmed `blocker`, `bug`, `gap`, `security`, or `misconfig` before the next pass. A large fix may be a fixer subagent on a model that did not write that finding. The fixer gets `idea.md`, `value.md`, and the confirmed findings, and changes only what those findings require.
- Do not close a hole by deleting a check, widening a permission, skipping a test, or weakening validation.
- Leave `quality` and `test-gap` for the later phases, unless the repair is required for correctness.

Pass 2 and pass 3 review the whole feature again, on the updated tree. They are not limited to the last fix.

Three passes always run. If pass 3's confirmed blockers were fixed, run one extra pass on a model other than pass 3's, then stop. Do not run a fifth pass. Anything still open stays in the report.

## 7. Tests

After the review loop:

- Map every `R` requirement, every held `V` answer, and every applied fix to a test. Write the missing test at the layer this repo already uses for that kind of code. The pyramid and the commands are in `docs/agents/verifying.md` and the server rules in `AGENTS.md`. Follow them. Do not invent a second set.
- A test counts only if it fails when the behavior regresses. A test that mocks away the code under test, or asserts only that a function was called, does not count.
- Run the narrowest command that covers the change, then the wider command `verifying.md` requires for those paths. Use a branch test database when that file says to.
- On red: fix the product or the test and rerun. Do not skip, `.only`, or delete an assertion to go green.
- A user-visible web change also gets the browser check that file names. Read the screenshots. Say what you exercised and what you did not.

## 8. Code quality

Spawn one more subagent after the tests are green. Use a model other than pass 3's when the schema allows. It may edit. Description: `[grill] quality`.

Scope is the files the original change and this skill touched. Read them in full. Fix only:

- Style that disagrees with the surrounding file
- Dead code, debug logs, and comments that restate the line, when this change introduced them
- A type assertion or ignore used to hide a real error
- Misuse of a framework those files already use. Read `AGENTS.md` and apply the hard rules for the touched paths. The rules that apply to this feature are already in `idea.md`.
- A new dependency, or a second way of doing something the codebase already does

Do not reformat untouched code. Do not rename a public API the idea did not ask to rename. If this pass edits a file, rerun the same tests. The report may call the code clean only when that rerun is green.

## 9. Report

Lead with whether the implementation now matches the idea and the held value. Then:

- Subject, file count, and whether the idea was quoted or inferred
- Business questions: id, mark, and the answer in one line. For each `held` answer, whether the code now delivers it
- One row per pass: model, confirmed findings, what was fixed, what was dropped
- Requirements still `missing`, `partial`, or `contradicted`
- Tests added, the commands, and the pass or fail line. Name any required suite that did not run
- Quality edits
- Open items you could not fix safely

Do not commit, push, or deploy. Say that, unless the user's current message also asked for a commit.
