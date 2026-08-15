# Bar 2026 Mock Reviewer — Addendum (read alongside AGENT_BRIEF.md)

Three strategy refinements on top of the original brief. Original brief's
core (harness-as-author, task-spec-not-script, hallucination lock, IRAC
scoring flow, copy-paste-to-ChatGPT delivery) still stands. This addendum
changes: how content gets organized, adds back a demoted MCQ modality, and
gives the harness a concrete technique for not copying the source books.

---

## 1. Segregate content per exam domain; weighting applies only at
## scoring/post-process time, not at generation time

- Store and generate content cleanly separated by the 6 exam domains
  (Remedial Law, Civil Law, Commercial/Taxation, Political Law, Criminal
  Law, Labor Law). Each domain's pool is self-contained.
- Do NOT bake the official 25/20/20/15/10/10 exam weighting into how much
  content gets generated per domain, and do NOT force weighted mixing
  during ordinary practice (user picks a domain, drills that domain).
- Weighting applies ONLY later, at aggregation: a "simulated full exam"
  mode assembling a weighted cross-domain session, or a readiness
  dashboard scoring overall preparedness against the official percentages.
  This is a scoring-time/UI-time concern, not a generation-time concern.
- Practical effect: harness generation work per domain is now independent
  — no need to balance output volume across domains while authoring depth
  matters more per-domain than volume-proportion between domains.

## 2. Mixed modality — essay/IRAC stays the core; MCQ returns as a
## demoted memorization aid, not a parallel exam simulation

- Core measured skill is still essay/SA, IRAC-graded — this is what
  actually mirrors the real 2026 exam (confirmed: essay-only, 20 Q per
  subject, 0-100% each) and what the copy-paste ChatGPT scoring flow
  targets. This does not change.
- MCQ is reintroduced strictly as a recall/memorization drill tool. UI
  should frame it as "quick recall check," never as equivalent to or a
  substitute for essay practice. No IRAC scoring applies to MCQ — it's
  simple right/wrong with an explanation, self-contained, no ChatGPT
  redirect needed for it.
- Because MCQ exists to reinforce memorization (not simulate issue-
  spotting), it's allowed to sit closer to the book's own stated rules,
  definitions, and elements — it doesn't carry the "must be a novel
  fact pattern" requirement that essay items do (see #3). Distinguishing
  similar doctrines, naming elements of a rule, recalling exceptions —
  all fair game for MCQ, drawn fairly directly from source concepts.

## 3. Essay items must test the RULE against NEW facts — not paraphrase
## the book's own worked example (this is the harness's hardest task)

Why this matters beyond "avoid copying": a Bar essay question exists to
test whether the examinee can spot which legal elements are triggered by
a fact pattern they've never seen before, then apply the rule correctly.
If a generated question is just the book's own illustrative example lightly
reworded, it tests recognition/recall instead of application — worse study
material, and it sits much closer to reproducing the source text than a
true novel fact pattern would.

**Two-pass technique to give the harness, per section:**

1. **Extraction pass.** Read the section. Output ONLY the abstracted legal
   rule/doctrine and its elements or requisites — stripped of the book's
   own narrative, its specific named parties, its dates, its illustrative
   story. Should read like a bare black-letter rule statement, e.g.:
   "Requisites for reconveyance based on an implied trust: (1) [x],
   (2) [y], (3) [z]." Nothing from the book's own example survives this
   step.
2. **Generation pass.** Using ONLY the extracted rule/elements from step 1
   as the seed (not the original book paragraph), construct an entirely
   new fact pattern: new party names, new dates, new specific circumstances
   — engineered so applying the extracted rule to these new facts produces
   a clean, gradable IRAC answer. The generated item should share zero
   identifying details with the book's own worked example.

This also naturally satisfies the existing hallucination-lock constraint
(rule must trace back to source) while solving the copy problem (facts
must not trace back to source) — same discipline, two different axes.

**Self-check instruction for the harness:** after generating each essay
item, compare it against the source section it came from. If more than a
short run of consecutive words matches the book's own example/narrative,
that's a signal to regenerate the fact pattern from the extracted rule
again — not to reword the existing draft. Rewording a copy is still a
copy; only a genuinely new scenario clears the bar.

---

## Inputs status
PDFs not yet staged/available as of this brief. Written to be handoff-ready
the moment books are available — don't block other prep on this. When
available: convert to Markdown first, inspect real heading structure before
assuming fidelity to any outline, same as the original brief's guidance.
