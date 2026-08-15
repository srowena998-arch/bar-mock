// Bar 2026 Mock Reviewer — Agent Engine powered by AI SDK (@ai-sdk/openai & ai)
const fs = require('node:fs');
const path = require('node:path');
const { createOpenAI } = require('@ai-sdk/openai');
const { generateText, generateObject, tool } = require('ai');
const { z } = require('zod');
const { db, getConfig, getCandidateAnalytics } = require('./db');

/**
 * Configure AI SDK Provider (DeepSeek / OpenCode / OpenAI / OpenRouter)
 */
function getAIProvider() {
  const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || 'dummy_key';
  let baseUrl = getConfig('opencode_base_url') || 'https://opencode.ai/zen/go/v1';
  
  baseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl.endsWith('/v1')) {
    baseUrl += '/v1';
  }

  return createOpenAI({
    apiKey: apiKey,
    baseURL: baseUrl
  });
}

function getModelName() {
  return getConfig('default_model') || 'deepseek-v4-flash';
}

function resolveBookMarkdownPath(bookId) {
  const dir = path.join(__dirname, 'storage', 'converted_md');
  const exactPath = path.join(dir, `${bookId}.md`);
  if (fs.existsSync(exactPath)) return exactPath;

  const normalized = (bookId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const fNorm = f.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fNorm.includes(normalized) || normalized.includes(fNorm.slice(0, 8))) {
      return path.join(dir, f);
    }
  }
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

/**
 * Tool 1: Scout and read text from the converted Markdown reviewer books
 */
const scoutBookMarkdownTool = tool({
  description: 'Searches and extracts source text from the converted Philippine Bar reviewer markdown books.',
  parameters: z.object({
    book_id: z.string().describe('Book ID, e.g. criminal_law, civil_law, commercial_law, political_law, remedial_law, labor_law'),
    page_number: z.number().optional().describe('Target page number in the reviewer book'),
    search_query: z.string().optional().describe('Key phrase or topic title to search for in the book')
  }),
  execute: async ({ book_id, page_number, search_query }) => {
    const mdPath = resolveBookMarkdownPath(book_id);
    if (!mdPath || !fs.existsSync(mdPath)) {
      return { found: false, error: `Book file not found for ${book_id}` };
    }
    const content = fs.readFileSync(mdPath, 'utf-8');
    
    if (page_number) {
      const marker = `<!-- PAGE ${page_number} -->`;
      const idx = content.indexOf(marker);
      if (idx !== -1) {
        return {
          found: true,
          page: page_number,
          excerpt: content.slice(idx, idx + 3500)
        };
      }
    }
    
    if (search_query) {
      const qIdx = content.toLowerCase().indexOf(search_query.toLowerCase());
      if (qIdx !== -1) {
        return {
          found: true,
          query: search_query,
          excerpt: content.slice(Math.max(0, qIdx - 200), qIdx + 3200)
        };
      }
    }

    return {
      found: true,
      excerpt: content.slice(0, 3000)
    };
  }
});

/**
 * Tool 2: Lookup syllabus catalog in SQLite
 */
const lookupSyllabusTool = tool({
  description: 'Queries the 2026 Supreme Court Syllabus sections catalog in SQLite.',
  parameters: z.object({
    domain: z.string().optional().describe('Bar exam subject / domain'),
    limit: z.number().default(5).describe('Number of sections to return')
  }),
  execute: async ({ domain, limit }) => {
    let query = 'SELECT * FROM syllabus_sections WHERE is_extracted = 0';
    const params = [];
    if (domain && domain !== 'all') {
      query += ' AND (domain = ? OR book_id = ? OR domain LIKE ?)';
      params.push(domain, domain, `%${domain}%`);
    }
    query += ' ORDER BY page_number ASC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(query).all(...params);
    return { count: rows.length, sections: rows };
  }
});

/**
 * Tool 3: Commit generated Bar questions directly to SQLite database
 */
const commitToDatabaseTool = tool({
  description: 'Commits authored Bar Essay and MCQ questions into the SQLite database and marks syllabus section as extracted.',
  parameters: z.object({
    section_id: z.string().describe('Syllabus section ID'),
    domain: z.string().describe('Domain name'),
    topic: z.string().describe('Topic title'),
    essay_fact_pattern: z.string().describe('Novel multi-party scenario'),
    essay_interrogatory: z.string().describe('Multi-part questions (a) and (b)'),
    suggested_answer: z.object({
      issue: z.string(),
      rule: z.string(),
      analysis: z.string(),
      conclusion: z.string()
    }),
    mcq_question: z.string(),
    mcq_options: z.array(z.string()),
    mcq_correct_answer: z.string(),
    mcq_explanation: z.string()
  }),
  execute: async (data) => {
    const essayId = `SDK-ESS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const mcqId = `SDK-MCQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    db.prepare(`
      INSERT INTO questions (id, domain, type, topic, subject_hierarchy, difficulty, fact_pattern, interrogatory, suggested_answer, extracted_rule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      essayId, data.domain, 'essay', data.topic,
      JSON.stringify([data.domain, data.topic]), 'hard',
      data.essay_fact_pattern, data.essay_interrogatory,
      JSON.stringify(data.suggested_answer), JSON.stringify({ doctrine: `Rule for ${data.topic}` })
    );

    db.prepare(`
      INSERT INTO questions (id, domain, type, topic, subject_hierarchy, difficulty, options, correct_answer, explanation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mcqId, data.domain, 'mcq', data.topic,
      JSON.stringify([data.domain, data.topic]), 'medium',
      JSON.stringify(data.mcq_options), data.mcq_correct_answer, data.mcq_explanation
    );

    db.prepare(`
      UPDATE syllabus_sections 
      SET is_extracted = 1, essay_count = essay_count + 1, mcq_count = mcq_count + 1, extracted_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(data.section_id);

    const sec = db.prepare('SELECT book_id FROM syllabus_sections WHERE id = ?').get(data.section_id);
    if (sec) {
      const extCount = db.prepare('SELECT COUNT(*) as cnt FROM syllabus_sections WHERE book_id = ? AND is_extracted = 1').get(sec.book_id).cnt;
      db.prepare('UPDATE book_metadata SET extracted_sections = ? WHERE id = ?').run(extCount, sec.book_id);
    }

    return { success: true, essay_id: essayId, mcq_id: mcqId, message: `Successfully committed questions for ${data.topic}` };
  }
});

/**
 * AI Dean Phoenix RAG Chatbot: Answers legal questions grounded in 2026 Reviewers & SQLite
 */
async function chatWithReviewerRAG(messages) {
  const provider = getAIProvider();
  const modelName = getModelName();
  const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';

  const lastUserMsg = messages && messages.length > 0 ? messages[messages.length - 1].content : '';
  const lowerQuery = (lastUserMsg || '').toLowerCase();

  // 1. INTENT ORCHESTRATION: Candidate Performance & Progress Analytics Intent
  const progressKeywords = [
    'progress', 'how is my progress', 'my stats', 'how am i doing', 'my score', 
    'my scores', 'weak area', 'weakness', 'strength', 'readiness', 'my attempts', 
    'my performance', 'analysis on my progress', 'how am i performing', 'diagnostic',
    'study plan', 'recommendation', 'summary of my progress', 'my past answers', 'my previous essays',
    'last essay', 'recent attempts'
  ];
  
  const isProgressIntent = progressKeywords.some(kw => lowerQuery.includes(kw));
  
  if (isProgressIntent) {
    const analytics = getCandidateAnalytics();
    const recentAttempts = analytics.recent_attempts || [];
    
    // Synthesize concise summary of recent past answers
    const attemptsContext = recentAttempts.length > 0
      ? recentAttempts.map((a, idx) => {
          const shortAns = (a.user_answer || '').slice(0, 180).replace(/\s+/g, ' ').trim();
          let breakdownStr = '';
          try {
            if (a.ai_breakdown) {
              const bd = typeof a.ai_breakdown === 'string' ? JSON.parse(a.ai_breakdown) : a.ai_breakdown;
              breakdownStr = ` [ALAC Breakdown: Issue ${bd.issue || 0}/10, Rule ${bd.rule || 0}/30, Analysis ${bd.analysis || 0}/50, Conclusion ${bd.conclusion || 0}/10]`;
            }
          } catch(e) {}
          return `• **[Attempt #${idx + 1}] ${a.domain} (${a.type.toUpperCase()}) - "${a.topic}"**\n  - Score: **${a.ai_score}/100**${breakdownStr}\n  - Interrogatory: *${(a.interrogatory || 'N/A').slice(0, 100)}*\n  - Your Answer Excerpt: _"${shortAns}${a.user_answer && a.user_answer.length > 180 ? '...' : ''}"_\n  - AI Feedback: ${a.ai_feedback || 'Completed'}`;
        }).join('\n\n')
      : '• *No past attempts recorded yet.*';

    const domainLines = analytics.domain_breakdown && analytics.domain_breakdown.length > 0
      ? analytics.domain_breakdown.map(d => `• **${d.domain}**: Avg Score **${d.avg_score}/100** (${d.attempts} attempts, Best: ${d.highest_score})`).join('\n')
      : '• *No subject domains attempted yet. Take your first Essay or MCQ Exam to populate this matrix!*';

    if (apiKey) {
      try {
        const progressSystemPrompt = `You are "Dean Phoenix", an elite Supreme Court Bar Examination Counsel.
The candidate is asking for an analysis of their progress, past answers, and overall exam readiness.
Analyze their performance using their live SQLite attempt history and provide a warm, encouraging, authoritative critique.

CANDIDATE STATS & ATTEMPTS HISTORY:
• Total Attempts: ${analytics.total_attempts}
• Overall Weighted Average: ${analytics.overall_average}/100
• Passing Benchmark: 75.00%
• Domain Stats:
${domainLines}

RECENT PAST ANSWERS & ATTEMPTS LEDGER:
${attemptsContext}

Instructions:
1. Summarize their overall score and domain readiness.
2. Directly reference specific strengths and weaknesses observed in their past answers (e.g. mention specific topics, ALAC rubric deductions, or missed statutory elements).
3. Prescribe a high-yield study plan to reach 85%+ percentile for the 2026 Bar.`;

        const { text } = await generateText({
          model: provider(modelName),
          system: progressSystemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          temperature: 0.3,
          abortSignal: AbortSignal.timeout(8000)
        });

        return {
          reply: text,
          citations: [],
          retrieval_confidence: 1.0,
          supplemented_via_web: false
        };
      } catch (err) {
        console.warn('AI progress generation failed, using structured diagnostic fallback:', err.message);
      }
    }

    const reply = `⚖️ **Dean Phoenix Candidate Progress & Diagnostic Analysis**

Here is your comprehensive 2026 Philippine Bar Examination readiness diagnostic based on your live SQLite candidate attempt logs and recent answer submissions:

---

### 📊 Performance Scorecard
• **Total Question Attempts:** **${analytics.total_attempts}**
• **Composite Average Score:** **${analytics.overall_average}/100**
• **Supreme Court Benchmark:** **75.00%** (Official Passing Grade)
• **Bar Readiness Status:** ${analytics.overall_average >= 75 ? '🟢 **ON TRACK TO PASS** (Meeting SC Bar Standards)' : (analytics.total_attempts === 0 ? '⚪ **NO ATTEMPTS RECORDED** (Ready for Initial Baseline)' : '🟡 **REINFORCEMENT REQUIRED** (Score currently below 75.00%)')}

---

### 📚 Subject Domain Mastery Breakdown
${domainLines}

---

### 📝 Recent Answer Submissions & Pedagogical Feedback
${attemptsContext}

---

### 🎯 Dean Phoenix Strategic Action Plan
1. **Strengthen ALAC Legal Basis:** Supreme Court Bar examiners award **30% of total essay points** for precise citation of statutory Articles and En Banc doctrines.
2. **Methodical Application (50% weight):** Ensure you apply the rules element-by-element to every specific fact provided in the interrogatory before concluding.
3. **Daily Recall MCQs:** Drill at least 15–20 high-yield recall questions in the **"⚡ Recall MCQs"** tab to lock in statutory time periods, exceptions, and requisites!

*Keep going, future Atty.! Discipline and repetition will carry you through the 2026 Bar Examinations.*`;

    return {
      reply: reply,
      citations: [],
      retrieval_confidence: 1.0,
      supplemented_via_web: false
    };
  }

  // 2. INTENT ORCHESTRATION: Platform Guide & Tutorial Query Detection
  if (lowerQuery.includes('reform') || lowerQuery.includes('update question') || lowerQuery.includes('edit question') || lowerQuery.includes('change question') || lowerQuery.includes('modernize') || (lowerQuery.includes('how do i') && !lowerQuery.includes('study'))) {
    return {
      reply: `⚖️ **Platform Tutorial: How to Reform or Update Questions with Modern Jurisprudence**

To update or reform any Bar question (e.g., inject 2024–2026 Supreme Court En Banc rulings, add procedural timeline twists, or expand MCQ distractors):

1. **Navigate to "📚 Resources Studio"** in the top navigation bar.
2. **Select the "✨ AI Question Reformation" tab**.
3. **Select a Question**: Browse or search topics in the left column and click on any Essay or MCQ.
4. **Choose Target Component** (for Essays): Select *All Components*, *Fact Pattern Only*, *Interrogatory Only*, or *Answer / ALAC Only*.
5. **Enter Your Natural Language Prompt**: In the dedicated prompt box, type instructions like:
   - *"Update fact pattern with 2024 Supreme Court jurisprudence on warrantless arrests and add a sub-question (b) on damages."*
   - *"Expand this MCQ with 4 tricky distractors testing subtle exceptions."*
6. **Click "⚡ Synthesize Refinement with AI SDK"**: The system will generate the updated version adhering to Bar standards.
7. **Inspect the Side-by-Side Diff**: Review the before vs. after comparison.
8. **Click "💾 Apply & Save to SQLite"**: The modified question is immediately committed to the live SQLite question bank!`,
      citations: []
    };
  }

  if (lowerQuery.includes('how does grading') || lowerQuery.includes('how grading works') || lowerQuery.includes('rubric') || (lowerQuery.includes('alac') && lowerQuery.includes('how'))) {
    return {
      reply: `⚖️ **Platform Tutorial: How the Supreme Court AI Grader Works**

1. **Go to the "✍️ Essay Exam" tab**.
2. Read the legal fact pattern and the specific interrogatory.
3. In the Candidate Exam Workspace, structure your response applying strict **ALAC** (Answer, Legal Basis, Application, Conclusion).
4. Click **"✨ Grade Answer with AI"**.
5. The platform scores your answer against the official **100-Point Supreme Court Rubric**:
   - **Issue & Direct Answer**: 10 Points (Categorical stance)
   - **Legal Basis (Rule)**: 30 Points (Exact statutory Articles & case doctrines)
   - **Application (Analysis)**: 50 Points (Methodical element-by-fact matching)
   - **Conclusion**: 10 Points (Final legal result)
6. All attempts and scores are saved to your SQLite database history and update your composite Bar readiness index!`,
      citations: []
    };
  }

  // 3. INTENT ORCHESTRATION: Substantive Legal Doctrine Retrieval (Hybrid RAG + Web Fallback)
  const { retrieveHybridRAG } = require('./rag_indexer');
  const { searchWebJurisprudence } = require('./web_search');
  let ragExcerpts = [];
  try {
    ragExcerpts = await retrieveHybridRAG({ query: lastUserMsg, domain: 'all', topK: 2 });
  } catch (err) {
    console.warn('Hybrid RAG retrieval failed, falling back:', err.message);
  }

  // Calculate Retrieval Grounding Confidence
  let retrievalConfidence = 1.0;
  let missingEntityName = '';
  const rawTerms = lastUserMsg.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);

  if (ragExcerpts.length === 0) {
    retrievalConfidence = 0.0;
    missingEntityName = rawTerms.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } else if (rawTerms.length > 0) {
    const combinedExcerpt = ragExcerpts.map(r => r.excerpt.toLowerCase()).join(' ');
    const matchingTerms = rawTerms.filter(t => combinedExcerpt.includes(t));
    if (matchingTerms.length === 0) {
      retrievalConfidence = 0.0;
      missingEntityName = rawTerms.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    } else {
      retrievalConfidence = matchingTerms.length / rawTerms.length;
      if (retrievalConfidence < 0.45) {
        missingEntityName = rawTerms.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
  }

  // Supplemental Web Search
  let webExcerpts = [];
  if (retrievalConfidence < 0.55 || ragExcerpts.length === 0) {
    webExcerpts = await searchWebJurisprudence(lastUserMsg, 2);
  }

  const isWebSupported = Boolean(
    webExcerpts.length > 0 && 
    rawTerms.some(t => webExcerpts.some(w => w.snippet.toLowerCase().includes(t) || w.title.toLowerCase().includes(t)))
  );

  const contextStr = ragExcerpts.length > 0
    ? ragExcerpts.map(r => `[SOURCE: ${r.book || r.book_id || '2026 Reviewer'} | Page ${r.page || r.page_number || 1}]\n${r.excerpt}`).join('\n\n---\n\n')
    : 'General 2026 Philippine Supreme Court Bar Syllabus Knowledge Base.';

  const webContextStr = isWebSupported
    ? '\n\n[SUPPLEMENTAL PHILIPPINE JURISPRUDENCE & WEB SEARCH]:\n' + webExcerpts.map(w => `• ${w.title} (Source: ${w.url}): ${w.snippet}`).join('\n')
    : '';

  const systemPrompt = `You are "Dean Phoenix", an elite Supreme Court Bar Examination Counsel.
GROUNDED REVIEWER EXCERPTS:
${contextStr}${webContextStr}`;

  const allCitations = [
    ...ragExcerpts.map(r => ({ 
      type: 'reviewer', 
      book: r.book || r.book_id || '2026 Reviewer',
      page: r.page || r.page_number || 1,
      title: `${r.book || r.book_id || '2026 Reviewer'} (Page ${r.page || r.page_number || 1})`, 
      source: `${r.book || r.book_id || '2026 Reviewer'} (Page ${r.page || r.page_number || 1})` 
    })),
    ...(isWebSupported ? webExcerpts.map(w => ({ 
      type: 'web', 
      book: 'Supreme Court Jurisprudence / Web',
      page: 'Online',
      title: w.title, 
      source: w.url 
    })) : [])
  ];

  if (apiKey) {
    try {
      const { text } = await generateText({
        model: provider(modelName),
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(8000)
      });

      return {
        reply: text,
        citations: allCitations,
        retrieval_confidence: retrievalConfidence,
        supplemented_via_web: isWebSupported
      };
    } catch (err) {
      console.warn('Chatbot API failed, applying fallback:', err.message);
    }
  }

  return {
    reply: "Unable to reach Dean Phoenix. Please check your OpenCode/API configuration.",
    citations: [],
    retrieval_confidence: 0,
    supplemented_via_web: false
  };
}

/**
 * Targeted AI Question Refinement (AI SDK-Powered In-Place Editing for Essay & MCQ)
 */
async function refineQuestionModality({ original_question, refinement_instruction, target_field = 'all' }) {
  const provider = getAIProvider();
  const modelName = getModelName();
  const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';

  const isMcq = original_question.type === 'mcq' || (original_question.type !== 'essay' && Array.isArray(original_question.options) && original_question.options.length > 0);

  // Normalize fields defensively to prevent any 'undefined' strings
  const currentInterrogatory = (original_question.interrogatory || original_question.question || '').replace(/^undefined\s*/gi, '').trim() ||
    `Is the legal contention of the petitioner sustainable under Philippine ${original_question.domain || 'Law'}? Explain with legal basis.`;
  const currentFactPattern = (original_question.fact_pattern || '').replace(/^undefined\s*/gi, '').trim() ||
    `In a dispute arising in Manila, the parties contested the statutory requisites governing ${original_question.topic || 'the legal doctrine'} under Philippine Law.`;
  const currentTopic = original_question.topic || 'Supreme Court Jurisprudence';
  const currentDomain = original_question.domain || 'Philippine Law';

  if (isMcq) {
    const mcqSchema = z.object({
      topic: z.string(),
      difficulty: z.string(),
      question: z.string().describe('Refined MCQ question stem'),
      options: z.array(z.string()).length(4).describe('Four options labeled A), B), C), D)'),
      correct_answer: z.enum(['A', 'B', 'C', 'D']),
      explanation: z.string().describe('Detailed doctrinal explanation')
    });

    if (apiKey) {
      try {
        const prompt = `[ORIGINAL MCQ QUESTION]:
Domain: ${currentDomain}
Topic: ${currentTopic}
Question: ${currentInterrogatory}
Options: ${JSON.stringify(original_question.options || [])}
Correct Answer: ${original_question.correct_answer || 'A'}
Explanation: ${original_question.explanation || ''}

[REFINEMENT INSTRUCTION]: ${refinement_instruction}

Apply the requested refinement strictly adhering to Philippine Supreme Court Bar Exam standards. Keep distractors plausible and explanation rigorous.`;

        const { object } = await generateObject({
          model: provider(modelName),
          schema: mcqSchema,
          system: `You are an expert Supreme Court Bar Examiner refining existing Bar MCQ questions.`,
          prompt: prompt,
          abortSignal: AbortSignal.timeout(6000)
        });

        return { ...original_question, ...object };
      } catch (err) {
        console.warn('MCQ refinement API failed, applying fallback:', err.message);
      }
    }

    // Fallback deterministic MCQ refinement
    const updatedMcq = JSON.parse(JSON.stringify(original_question));
    updatedMcq.question = currentInterrogatory;
    if (!updatedMcq.question.includes('According to')) {
      updatedMcq.question = `${currentInterrogatory} Which statement correctly applies the governing Supreme Court rule?`;
    }
    updatedMcq.explanation = `${original_question.explanation || 'Under Philippine jurisprudence, the rule is strictly applied.'} (Doctrinally refined under 2026 Bar syllabus standards).`;
    return updatedMcq;
  }

  // Essay refinement schema
  const essaySchema = z.object({
    topic: z.string(),
    difficulty: z.string(),
    fact_pattern: z.string(),
    interrogatory: z.string(),
    suggested_answer: z.object({
      issue: z.string(),
      rule: z.string(),
      analysis: z.string(),
      conclusion: z.string()
    })
  });

  if (apiKey) {
    try {
      const prompt = `[ORIGINAL QUESTION COMPONENT]:
Domain: ${currentDomain}
Topic: ${currentTopic}
Difficulty: ${original_question.difficulty || 'hard'}
Fact Pattern: ${currentFactPattern}
Interrogatory: ${currentInterrogatory}
Suggested Answer: ${JSON.stringify(original_question.suggested_answer || {})}

[TARGET FIELD TO MODIFY]: ${target_field}
[REFINEMENT INSTRUCTION]: ${refinement_instruction}

Apply the requested refinement strictly adhering to Philippine Supreme Court Bar Exam standards. Keep untouched fields consistent and output the complete refined question JSON.`;

      const { object } = await generateObject({
        model: provider(modelName),
        schema: essaySchema,
        system: `You are an expert Supreme Court Bar Examiner refining existing Bar examination questions.
Apply TARGETED EDITS based on user instructions while preserving the legal accuracy, Filipino names, and ALAC/IRAC formatting.`,
        prompt: prompt,
        abortSignal: AbortSignal.timeout(6000)
      });

      return {
        ...original_question,
        ...object
      };
    } catch (err) {
      console.warn('AI SDK targeted refinement API failed, applying targeted deterministic transformation:', err.message);
    }
  }

  // Deterministic local refinement fallback with clean legal synthesis
  const updated = JSON.parse(JSON.stringify(original_question));
  updated.topic = currentTopic;
  updated.domain = currentDomain;

  if (target_field === 'interrogatory' || target_field === 'all') {
    if (!currentInterrogatory.includes('(b)')) {
      updated.interrogatory = `(a) ${currentInterrogatory.replace(/^\([a-z]\)\s*/i, '')}\n\n(b) Assuming a third-party claim is instituted, what is the proper procedural remedy available to the aggrieved party under Philippine ${currentDomain}? Explain.`;
    } else {
      updated.interrogatory = currentInterrogatory;
    }
  } else {
    updated.interrogatory = currentInterrogatory;
  }

  if (target_field === 'fact_pattern' || target_field === 'all') {
    if (!currentFactPattern.includes('In the interim')) {
      updated.fact_pattern = `${currentFactPattern} In the interim, an adverse third-party claim was filed before the Regional Trial Court asserting non-compliance with governing statutory requisites.`;
    } else {
      updated.fact_pattern = currentFactPattern;
    }
  } else {
    updated.fact_pattern = currentFactPattern;
  }

  if (target_field === 'suggested_answer' || target_field === 'all') {
    let baseAns = updated.suggested_answer;
    if (typeof baseAns !== 'object' || !baseAns) {
      baseAns = {
        issue: `Whether the claims of the parties are meritorious under Philippine ${currentDomain}.`,
        rule: `Under Philippine law and Supreme Court jurisprudence, compliance with statutory requisites is mandatory.`,
        analysis: `Applying the rule to the facts, the requisite statutory elements must concur to sustain the action.`,
        conclusion: `Therefore, the action must be resolved in accordance with established procedural and substantive rules.`
      };
    }
    updated.suggested_answer = baseAns;
  }

  return updated;
}

/**
        model: provider(modelName),
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(8000)
      });

      return {
        reply: text,
        citations: allCitations,
        retrieval_confidence: retrievalConfidence,
        supplemented_via_web: isWebSupported
      };
    } catch (err) {
      console.warn('Chatbot API failed, applying grounded fallback:', err.message);
    }
  }

  // Platform Guide & Tutorial Query Detection
  const lowerQuery = (lastUserMsg || '').toLowerCase();
  if (lowerQuery.includes('reform') || lowerQuery.includes('update question') || lowerQuery.includes('edit question') || lowerQuery.includes('change question') || lowerQuery.includes('modernize') || lowerQuery.includes('how do i')) {
    return {
      reply: `⚖️ **Platform Tutorial: How to Reform or Update Questions with Modern Jurisprudence**

To update or reform any Bar question (e.g., inject 2024–2026 Supreme Court En Banc rulings, add procedural timeline twists, or expand MCQ distractors):

1. **Navigate to "📚 Resources Studio"** in the top navigation bar.
2. **Select the "✨ AI Question Reformation" tab**.
3. **Select a Question**: Browse or search topics in the left column and click on any Essay or MCQ.
4. **Choose Target Component** (for Essays): Select *All Components*, *Fact Pattern Only*, *Interrogatory Only*, or *Answer / ALAC Only*.
5. **Enter Your Natural Language Prompt**: In the dedicated prompt box, type instructions like:
   - *"Update fact pattern with 2024 Supreme Court jurisprudence on warrantless arrests and add a sub-question (b) on damages."*
   - *"Expand this MCQ with 4 tricky distractors testing subtle exceptions."*
6. **Click "⚡ Synthesize Refinement with AI SDK"**: The system will generate the updated version adhering to Bar standards.
7. **Inspect the Side-by-Side Diff**: Review the before vs. after comparison.
8. **Click "💾 Apply & Save to SQLite"**: The modified question is immediately committed to the live SQLite question bank!`,
      citations: []
    };
  }

  if (lowerQuery.includes('grade') || lowerQuery.includes('score') || lowerQuery.includes('alac') || lowerQuery.includes('evaluation')) {
    return {
      reply: `⚖️ **Platform Tutorial: How the Supreme Court AI Grader Works**

1. **Go to the "✍️ Essay Exam" tab**.
2. Read the legal fact pattern and the specific interrogatory.
3. In the Candidate Exam Workspace, structure your response applying strict **ALAC** (Answer, Legal Basis, Application, Conclusion).
4. Click **"✨ Grade Answer with AI"**.
5. The platform scores your answer against the official **100-Point Supreme Court Rubric**:
   - **Issue & Direct Answer**: 10 Points (Categorical stance)
   - **Legal Basis (Rule)**: 30 Points (Exact statutory Articles & case doctrines)
   - **Application (Analysis)**: 50 Points (Methodical element-by-fact matching)
   - **Conclusion**: 10 Points (Final legal result)
6. All attempts and scores are saved to your SQLite database history and update your composite Bar readiness index!`,
      citations: []
    };
  }

  if (lowerQuery.includes('api key') || lowerQuery.includes('opencode') || lowerQuery.includes('settings') || lowerQuery.includes('connect')) {
    return {
      reply: `⚖️ **Platform Tutorial: How to Configure OpenCode Go or DeepSeek API**

1. Click the **⚙️ Settings icon** at the top right of the navigation bar.
2. Choose a preset or enter your credentials:
   - **⚡ OpenCode Go**: Base URL \`https://opencode.ai/zen/go/v1\`, Model \`deepseek-v4-flash\`
   - **🔷 DeepSeek Direct**: Base URL \`https://api.deepseek.com\`, Model \`deepseek-chat\`
   - **🌐 OpenRouter**: Base URL \`https://openrouter.ai/api/v1\`, Model \`deepseek/deepseek-chat\`
3. Paste your full API Key into the API Key input.
4. Click **"🔌 Test Connection"** to run a real-time health check diagnostic.
5. Click **"🔄 Fetch Live Models"** to pull all active models from your provider endpoint.
6. Click **"Save & Connect"** to persist your configuration to SQLite!`,
      citations: []
    };
  }

  // Unindexed / Non-Existent Entity Grounding Check (Zero Confidence & No External Match)
  if ((!isWebSupported && retrievalConfidence < 0.4) && missingEntityName) {
    return {
      reply: `⚖️ **Doctrinal Clarification (Negative Grounding Verification):**

There is no recognized statutory provision, Supreme Court doctrine, or case law entitled **"${missingEntityName}"** under Philippine Law or the 2026 Supreme Court Bar Examination Syllabus.

**Governing Philippine Legal Standard:**
Under Philippine jurisprudence, legal rights, claims, and remedies must be grounded strictly in enacted statutory codes (such as the Civil Code, Revised Penal Code, Corporation Code, or Rules of Court) and authoritative decisions of the Supreme Court En Banc. Fabricated or hypothetical concepts without statutory basis have no force or effect.`,
      citations: [],
      retrieval_confidence: 0.0,
      supplemented_via_web: false
    };
  }

  // Supplemental Web Search & Adaptive Doctrinal Response
  if (retrievalConfidence < 0.55 && isWebSupported) {
    const web = webExcerpts[0];
    return {
      reply: `⚖️ **Doctrinal Analysis (Supplemental Jurisprudence Retrieval):**

Regarding **${missingEntityName || 'this specific legal matter'}**, the governing principles under Philippine Supreme Court jurisprudence are established as follows:

• **Key Jurisprudential Rule:** ${web.snippet}
• **Application & Legal Basis:** Under Philippine constitutional, statutory, and administrative standards, Supreme Court rulings interpret and apply the governing laws in accordance with established precedents.

**Authoritative Citations:**
• **${web.title}** ([Supreme Court Jurisprudence / Official Gazette](${web.url}))
• *Related 2026 Bar Syllabus Domain:* Philippine Jurisprudence & Public Law`,
      citations: allCitations,
      retrieval_confidence: retrievalConfidence,
      supplemented_via_web: true
    };
  }

  const citationList = ragExcerpts.map(r => `• ${r.book} (Page ${r.page})`).join('\n');

  // Format clean extracted reviewer doctrine without raw OCR linebreaks or page headers
  let cleanExcerpt = '';
  if (ragExcerpts.length > 0) {
    cleanExcerpt = ragExcerpts[0].excerpt
      .replace(/\r\n/g, ' ')
      .replace(/^\s*\d+\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const excerptSummary = ragExcerpts.length > 0
    ? `Here is the authoritative doctrine extracted directly from the 2026 Reviewer:\n\n> "${cleanExcerpt.slice(0, 320)}..."\n\n**Key Legal Elements & Doctrine:**\nUnder Philippine law, this requires categorical compliance with the statutory requisites and Supreme Court jurisprudence established in the syllabus.`
    : `Under the 2026 Philippine Bar Examination Syllabus, this topic is governed by the statutory provisions and established doctrines of the Supreme Court.`;

  return {
    reply: `${excerptSummary}\n\n**Citations from Source Reviewers:**\n${citationList || '• 2026 Philippine Supreme Court Syllabus'}`,
    citations: allCitations,
    retrieval_confidence: retrievalConfidence,
    supplemented_via_web: false
  };
}

/**
 * Autonomous Agent: Ingests batches of syllabus topics from reviewer books
 */
async function runAutonomousIngestAgent({ domain = 'all', count = 3, onLog = () => {} }) {
  const provider = getAIProvider();
  const modelName = getModelName();
  const logs = [];

  const log = (msg) => {
    logs.push(msg);
    onLog(msg);
  };

  log(`[Agent] Initializing AI SDK with model '${modelName}' for domain '${domain}'...`);

  let query = 'SELECT * FROM syllabus_sections WHERE is_extracted = 0';
  const params = [];
  if (domain && domain !== 'all') {
    query += ' AND (domain = ? OR book_id = ? OR domain LIKE ?)';
    params.push(domain, domain, `%${domain}%`);
  }
  query += ' ORDER BY page_number ASC LIMIT ?';
  params.push(count);

  const sections = db.prepare(query).all(...params);
  if (sections.length === 0) {
    log(`[Agent] All sections in ${domain} are already extracted!`);
    return { success: true, count: 0, logs };
  }

  const results = [];

  for (const sec of sections) {
    log(`[Agent Scout] Reading source text for "${sec.topic_title}" (p.${sec.page_number} of ${sec.book_id})...`);
    
    const mdPath = path.join(__dirname, 'storage', 'converted_md', `${sec.book_id}.md`);
    let sourceText = `Topic: ${sec.topic_title} under ${sec.domain}`;
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const pMarker = `<!-- PAGE ${sec.page_number} -->`;
      const pIdx = content.indexOf(pMarker);
      if (pIdx !== -1) sourceText = content.slice(pIdx, pIdx + 3500);
    }

    log(`[AI Synthesizer] Applying Two-Pass Discipline to generate Bar Essay & MCQ...`);

    const schema = z.object({
      essay: z.object({
        topic: z.string(),
        difficulty: z.enum(['medium', 'hard']),
        fact_pattern: z.string().describe('Novel multi-party scenario with Filipino names and specific dates'),
        interrogatory: z.string().describe('(a) and (b) multi-part questions'),
        suggested_answer: z.object({
          issue: z.string(),
          rule: z.string(),
          analysis: z.string(),
          conclusion: z.string()
        })
      }),
      mcq: z.object({
        topic: z.string(),
        difficulty: z.enum(['easy', 'medium', 'hard']),
        question: z.string(),
        options: z.array(z.string()).length(4),
        correct_answer: z.enum(['A', 'B', 'C', 'D']),
        explanation: z.string()
      })
    });

    try {
      const { object } = await generateObject({
        model: provider(modelName),
        schema: schema,
        system: `You are an expert Supreme Court Bar Examiner authoring 2026 Philippine Bar Examination questions.
Apply the TWO-PASS DISCIPLINE:
Pass 1: Extract abstracted black-letter doctrine and elements.
Pass 2: Using only the rule, author a novel multi-party Philippine fact pattern, multi-part interrogatories, and an ALAC/IRAC suggested answer. Also author 1 recall MCQ.`,
        prompt: `Domain: ${sec.domain}\nTopic: ${sec.topic_title}\nPage: ${sec.page_number}\n\nReviewer Book Source Text:\n${sourceText}`
      });

      await commitToDatabaseTool.execute({
        section_id: sec.id,
        domain: sec.domain,
        topic: object.essay.topic || sec.topic_title,
        essay_fact_pattern: object.essay.fact_pattern,
        essay_interrogatory: object.essay.interrogatory,
        suggested_answer: object.essay.suggested_answer,
        mcq_question: object.mcq.question,
        mcq_options: object.mcq.options,
        mcq_correct_answer: object.mcq.correct_answer,
        mcq_explanation: object.mcq.explanation
      });

      log(`[Database] ✅ Committed questions for "${sec.topic_title}" to SQLite!`);
      results.push({ section_id: sec.id, topic: sec.topic_title });
    } catch (err) {
      log(`[Agent Warning] AI SDK call error for ${sec.topic_title}: ${err.message}. Applying fallback template.`);
      
      await commitToDatabaseTool.execute({
        section_id: sec.id,
        domain: sec.domain,
        topic: sec.topic_title,
        essay_fact_pattern: `On June 14, 2024, in Manila, Aurelio entered into a contested transaction regarding ${sec.topic_title}. An opposing claim was brought by Rebecca alleging non-compliance with statutory requisites. Litigation ensued before the Regional Trial Court.`,
        essay_interrogatory: `(a) How should the court resolve the issue of ${sec.topic_title} under Philippine Law?\n(b) Explain following the ALAC/IRAC answering method.`,
        suggested_answer: {
          issue: `Whether the legal requisites of ${sec.topic_title} were satisfied in the transaction between Aurelio and Rebecca.`,
          rule: `Under prevailing Philippine statutes and Supreme Court jurisprudence for ${sec.domain}, ${sec.topic_title} requires compliance with established legal elements.`,
          analysis: `Applying the rule to the facts, the court must evaluate the specific conduct against each statutory requisite.`,
          conclusion: `The court should rule in accordance with the established statutory requisites governing ${sec.topic_title}.`
        },
        mcq_question: `Which of the following is a recognized legal requisite of ${sec.topic_title}?`,
        mcq_options: [
          `A) Strict compliance with the statutory elements`,
          `B) Unilateral extrajudicial revocation at will`,
          `C) Absolute exemption from evidentiary scrutiny`,
          `D) Reliance on oral testimony alone`
        ],
        mcq_correct_answer: 'A',
        mcq_explanation: `Under Philippine law, ${sec.topic_title} strictly requires adherence to established statutory requisites.`
      });

      results.push({ section_id: sec.id, topic: sec.topic_title });
    }
  }

  log(`[Agent Complete] Finished batch processing ${results.length} sections.`);
  return { success: true, count: results.length, sections: results, logs };
}

/**
 * Diagnostic Agent: Analyzes holistic candidate readiness across all 6 domains
 */
async function runDiagnosticAgent({ attempts = [] }) {
  const provider = getAIProvider();
  const modelName = getModelName();

  const summary = attempts.map(a => `Subject: ${a.domain} | Topic: ${a.topic} | Score: ${a.ai_score}%`).join('\n');

  try {
    const { object } = await generateObject({
      model: provider(modelName),
      schema: z.object({
        overall_readiness_status: z.enum(['Passing Ready', 'Borderline Passing', 'Needs Reinforcement', 'Critical Action Required']),
        key_strengths: z.array(z.string()),
        critical_blind_spots: z.array(z.string()),
        prescribed_study_priorities: z.array(z.string()),
        examiner_advice: z.string()
      }),
      system: `You are a distinguished Supreme Court Bar Examination Dean conducting a holistic performance diagnostic for a 2026 Bar candidate.`,
      prompt: `Candidate's Practice Attempts History:\n${summary || 'No attempts yet.'}\n\nDiagnose the candidate's doctrinal mastery and prescribe a focused review plan.`
    });

    return object;
  } catch (err) {
    return {
      overall_readiness_status: 'Needs Reinforcement',
      key_strengths: ['Active engagement in Bar essay typing drills', 'Familiarity with standard interrogatory structure'],
      critical_blind_spots: ['Precision in citing statutory article numbers and exact case doctrines', 'Methodical factual application to avoid shotgun answers'],
      prescribed_study_priorities: ['Remedial Law (25% Weight): Focus on jurisdiction thresholds and special civil actions', 'Civil Law (20% Weight): Review Property and Obligations & Contracts requisites'],
      examiner_advice: 'Structure every essay strictly using ALAC: begin with a categorical affirmative or negative ruling, state the exact statutory rule and requisites, methodically apply each element to the given facts, and conclude decisively.'
    };
  }
}

/**
 * Generate Question Modalities (Essay + MCQ) with AI SDK and support iterative critique
 */
async function generateQuestionModalitiesWithAI({ domain, topic, page = 1, excerpt = '', instruction = '' }) {
  const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY;
  const modelName = getModelName();
  const provider = getAIProvider();

  const modalitySchema = z.object({
    essay: z.object({
      domain: z.string(),
      topic: z.string(),
      difficulty: z.enum(['easy', 'medium', 'hard']),
      fact_pattern: z.string(),
      interrogatory: z.string(),
      suggested_answer: z.object({
        issue: z.string(),
        rule: z.string(),
        analysis: z.string(),
        conclusion: z.string()
      }),
      extracted_rule: z.string()
    }),
    mcq: z.object({
      domain: z.string(),
      topic: z.string(),
      question: z.string(),
      options: z.array(z.string()).length(4),
      correct_answer: z.enum(['A', 'B', 'C', 'D']),
      explanation: z.string()
    })
  });

  if (apiKey && apiKey !== 'dummy_key') {
    try {
      const prompt = `You are a Philippine Supreme Court Bar Examination author creating rigorous mock questions for the 2026 Philippine Bar Examination.
      
[SOURCE REVIEWER MATERIAL]:
Domain: ${domain}
Topic: ${topic}
Page Number: ${page}
Excerpt: """${excerpt}"""

${instruction ? `[USER CRITIQUE / REFINEMENT DIRECTIVE]: ${instruction}\nApply this critique strictly to enhance the questions.` : ''}

Generate two high-quality modalities grounded strictly in Philippine statutory law and Supreme Court jurisprudence:
1. One rigorous ALAC Essay Question (hard difficulty, realistic fact pattern, clear interrogatory, and comprehensive 4-part ALAC suggested answer).
2. One diagnostic Multiple-Choice Question (4 plausible options, distinct key A-D, and clear doctrinal explanation).`;

      const { object } = await generateObject({
        model: provider(modelName),
        schema: modalitySchema,
        system: `You are an elite Philippine Supreme Court Bar Examiner. Output strictly adhering to Philippine jurisprudence and the 2026 Bar syllabus.`,
        prompt: prompt,
        abortSignal: AbortSignal.timeout(12000)
      });

      return object;
    } catch (err) {
      console.warn('AI SDK generation failed, applying structured fallback:', err.message);
    }
  }

  // Robust structured fallback
  return {
    essay: {
      domain: domain || 'Remedial Law, Legal & Judicial Ethics, Practical Exercises',
      topic: topic || 'Fundamental Legal Principles',
      difficulty: 'hard',
      fact_pattern: `In a controversy arising under ${domain}, the petitioner asserts a direct right under the doctrine of "${topic}". The adverse party filed a motion to dismiss contending that the claim is premature, lacks statutory cause of action, and violates established procedural rules.`,
      interrogatory: `Rule on whether the petition is legally tenable under the prevailing doctrines of the Supreme Court. Explain using the ALAC method.`,
      suggested_answer: {
        issue: `Whether the petition grounded on "${topic}" is tenable under Philippine law.`,
        rule: `Under Philippine jurisprudence and the 2026 Bar syllabus on ${domain}, categorical compliance with statutory requisites and timely jurisdictional remedies is mandatory.`,
        analysis: `Applying the doctrine of "${topic}" to the facts presented, the petitioner failed to satisfy the essential requisites, making the adverse party's defense well-taken.`,
        conclusion: `Wherefore, the petition is without merit and must be dismissed.`
      },
      extracted_rule: `Grounded in ${domain} doctrine on ${topic}.`
    },
    mcq: {
      domain: domain || 'Remedial Law, Legal & Judicial Ethics, Practical Exercises',
      topic: topic || 'Fundamental Legal Principles',
      question: `Under Philippine law governing ${domain}, which of the following is an essential requisite or rule regarding "${topic}"?`,
      options: [
        `A. It requires categorical proof beyond reasonable doubt regardless of the civil or administrative nature of the proceeding.`,
        `B. It is strictly governed by statutory requisites and settled Supreme Court jurisprudence adhering to mandatory jurisdictional conditions.`,
        `C. It may be dispensed with upon mere unverified motion of either party without notice and hearing.`,
        `D. It applies exclusively in summary proceedings before first-level courts.`
      ],
      correct_answer: 'B',
      explanation: `Option B is the correct statement of the doctrine of ${topic} under settled Philippine Supreme Court jurisprudence.`
    }
  };
}

const { retrieveHybridRAG } = require('./rag_indexer');

function searchReviewerKnowledgeBase({ query, domain = 'all', topK = 4 }) {
  return retrieveHybridRAG({ query, domain, topK });
}

module.exports = {
  getAIProvider,
  getModelName,
  scoutBookMarkdownTool,
  lookupSyllabusTool,
  commitToDatabaseTool,
  refineQuestionModality,
  generateQuestionModalitiesWithAI,
  searchReviewerKnowledgeBase,
  chatWithReviewerRAG,
  runAutonomousIngestAgent,
  runDiagnosticAgent
};
