# Bar 2026 Mock Reviewer — Agent Seed Brief

Overnight build. Single named user (examinee, family member). Ship tonight.
Stack: Laravel + Svelte 5/Inertia/Tailwind (David's usual stack).
Builder: Antigravity harness (agentic, subscription-based) — this SAME agent
does BOTH jobs: (1) reads the source books and writes the question-bank
content, using its own judgment/understanding, and (2) builds the app logic
around it. No prism-php/prism, no separate LLM API wiring, no conversational
AI at app runtime, no live API cost for the end user. The harness IS the
content generator — this is not a mechanical "chunk → template → API call"
pipeline. Treat content generation as an agent task with judgment and a
stopping condition per unit, not a batch script looping blind.

## What this is
A static mock question bank of essay-type items only, authored by the
harness reading each book directly, served to a simple mobile-first
practice UI. Answers are self-scored by the user pasting into their own
ChatGPT/Claude via a copy-paste flow — NOT an API integration, and not the
harness's job either.

## CONFIRMED: essay-only format (verified against 2026 Bar Bulletin No. 1)
The 2026 Bar is 20 essay-type questions per subject session, each graded
0-100% (≈5% per question), typed directly on the exam platform. There is
NO MCQ component in the current format — that was a 2011-2013 experiment
(60/40, then 20/80 MCQ/essay splits) that no longer applies today. Do NOT
build an MCQ modality anywhere in this app. All generated content is
essay/SA (short-answer, IRAC-graded) only. This isn't a scope trim for
time — it's a correctness fix: MCQ would train against a format the real
exam doesn't use. All harness effort goes into essay variety instead:
more fact-pattern variations per sub-topic/doctrine (different parties,
different trigger facts, same underlying rule) rather than splitting
output across a second item type.

## Inputs the agent will receive
7 PDF books, each a "syllabus-illustrated reviewer" for one Bar subject
(e.g. "BAR EXAM 2026 — Civil Law — Syllabus-Based Illustrated Reviewer").
These will be converted to Markdown (Docling or equivalent) before/during
ingestion — treat PDF→MD conversion as an expected first step, not
something to design around blindly. Actual heading structure/fidelity is
unconfirmed until the agent inspects the real converted output — don't
hardcode assumptions about heading depth beyond what's below; verify against
real extracted text first.

## How the harness should actually work through a book (task spec, not script)
- Process one book at a time, one sub-topic/section at a time — not the
  whole PDF in one shot, and not fixed-length blind chunks either.
- Per section: read and actually understand it (don't skim-summarize), then
  decide the right number of questions for that section based on how dense/
  exam-relevant it is — thin sections get fewer or zero items, dense
  black-letter sections get more. This is the whole point of using the
  harness instead of a script: judgment over uniform output.
- Never sever a stated rule from its illustrating example/case when deciding
  section boundaries — if the book's own structure keeps them together,
  keep them together.
- Per section, define a clear "done" signal (e.g. "produced N items covering
  this section's distinct sub-points, or determined section has no
  examinable content") so the harness doesn't loop, over-analyze one topic,
  or drift into adjacent sections.
- Hallucination lock applies regardless of harness vs. script: do NOT invent
  statute numbers, EO numbers, or case citations not present in the actual
  source text being read.

## Confirmed exam parameters (source: Bar Bulletin No. 1, S. 2025, Oct 16 2025;
subsequent bulletins 2-4 are logistics-only, no scope changes)
- 3 days: Sept 6, 9, 13, 2026. Two subjects/day (AM + PM).
- Cutoff: only law/jurisprudence as of June 30, 2025 is examinable.
- Passing: 75% weighted average.
- Subject weights (must drive mock bank proportions):
  | Subject | Weight | Suggested essay item pool |
  |---|---|---|
  | Remedial Law, Legal & Judicial Ethics, Practical Exercises | 25% | 50 essay items |
  | Civil Law and Land Titles and Deeds | 20% | 40 essay items |
  | Commercial and Taxation Laws | 20% | 40 essay items |
  | Political and Public International Law | 15% | 30 essay items |
  | Criminal Law | 10% | 20 essay items |
  | Labor Law and Social Legislation | 10% | 20 essay items |
  (Numbers are ceiling targets for an overnight build, not a hard requirement —
  scale down uniformly if generation time/budget is tight. Keep proportions.)

## Section boundaries / metadata (still applies, harness decides in-line)
- Respect the book's own hierarchy: Subject > Major Topic > Sub-topic.
- Every generated item gets tagged with this path — needed later for
  subject-weighted quiz selection, not optional metadata.
- Do NOT attempt image/diagram parsing (flowcharts, succession trees, tables-
  as-images). Skip visual elements; read narrative text + genuine Markdown
  tables only. This is a scope cut, not an oversight — don't let the agent
  rabbit-hole into vision parsing tonight.

## Output format (what the harness writes per item, one-time, static)
- One essay item per section is the default target — harness can produce
  more per section for dense/high-yield doctrines (e.g. multiple fact-
  pattern variations testing the same rule differently) per the judgment
  rule above. No MCQ items, per the format confirmation above.
- Write each as a JSON block matching the essay schema/example already in
  the research doc (fact_pattern + interrogatory + suggested_answer in
  IRAC form + difficulty) — reuse that schema verbatim, don't reinvent.
  Drop the MCQ portion of that schema entirely.
- Save to `storage/app/question_bank/` as static JSON (or seed straight into
  a DB table if that's faster for the harness to wire up) — runtime app
  reads these, no live model calls when the user is actually using the app.
- Essay style must match real Bar essay conventions: multi-party named
  scenario, specific dates, closes with a direct interrogatory ("Is X
  liable?", "Can Y recover?", "How should the court rule?").

## Scoring flow (the "ChatGPT redirect", finalized)
- NOT a `?q=` URL prefill — confirmed unreliable (browsers/proxies truncate
  around ~2000 chars; a full scoring payload runs 3500-6000 chars → HTTP 414
  or silent truncation risk). Do not build this as the primary path.
- Primary flow: "Copy Evaluation Prompt" button → `navigator.clipboard
  .writeText()` bundles question + source context + model IRAC answer + user's
  typed answer + grading instructions into one payload → separate "Open
  ChatGPT" (or Claude) link to a plain new-chat URL, no params → user pastes
  manually.
- The full scoring system/user prompt template (IRAC-weighted: Issue 10%,
  Rule 30%, Analysis 50%, Conclusion 10%, with shotgun-answer penalty) is
  already drafted in the research doc — reuse verbatim.

## Explicit scope cuts for tonight (do not let agent expand into these)
- No MCQ modality anywhere — not in generation, not in UI. Format confirmed
  essay-only; see confirmation block above.
- No live/API-based grading — copy-paste only.
- No image/diagram extraction from source PDFs.
- No custom syllabus taxonomy build — the books are already syllabus-
  structured, ingestion should follow their existing headings.
- No auth/multi-user system needed — single user.
- No `?q=` URL-prefill as primary UX — copy-paste is primary, URL-prefill if
  attempted at all is a bonus, not a dependency.

## Order of execution for the agent
1. Convert one book PDF → Markdown, inspect real structure before assuming
   heading depth/fidelity matches the outline above.
2. Work through that one book's sections per the task spec above, as a
   smoke test — check the output quality/pacing feels right before doing
   the other 6 books.
3. Once pattern is validated, continue through remaining books the same way.
4. Build practice UI: pick a subject/topic (or "random, weighted by exam
   proportions") → shows one essay fact-pattern + interrogatory → textarea
   for the user's own answer → "Copy Evaluation Prompt" button + "Open
   ChatGPT/Claude" link, per the scoring flow above. No MCQ UI at all.
5. Wire subject-weighted question selection so practice sessions reflect
   real exam proportions, not uniform random across subjects.

## Division of labor, explicit
- Content authoring (reading books, writing questions/answers) = harness,
  using judgment, per the task spec above. Not a script, not an external API.
- App logic (Laravel routes/models, Svelte quiz UI, copy-to-clipboard scoring
  flow) = harness, same session, standard dev work.
- Actual essay grading at use-time = the human user, manually, via their own
  ChatGPT/Claude tab. Never the harness, never an API call, at runtime.
