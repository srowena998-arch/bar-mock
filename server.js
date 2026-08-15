// Bar 2026 Mock Reviewer — Server with Integrated AI SDK Agent Engine
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, getConfig, setConfig } = require('./db');
const { runAutonomousIngestAgent, runDiagnosticAgent, refineQuestionModality, chatWithReviewerRAG } = require('./agent_engine');
const { retrieveHybridRAG, getVectorStoreStats, indexAllReviewerBooks } = require('./rag_indexer');

const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const sendJSON = (res, statusCode, data) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
};

const parseJSONBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
};

const formatApiUrl = (baseUrl) => {
  let url = (baseUrl || 'https://opencode.ai/zen/go/v1').trim().replace(/\/+$/, '');
  if (!url.endsWith('/v1') && !url.includes('/chat/completions')) {
    url += '/v1';
  }
  if (!url.endsWith('/chat/completions')) {
    url += '/chat/completions';
  }
  return url;
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // ----------------------------------------------------
    // API: GET /api/domains
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/domains') {
      const books = db.prepare('SELECT * FROM book_metadata ORDER BY weight_percentage DESC').all();
      return sendJSON(res, 200, { success: true, domains: books });
    }

    // ----------------------------------------------------
    // API: GET /api/questions
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/questions') {
      const domain = parsedUrl.searchParams.get('domain');
      let query = 'SELECT * FROM questions';
      let params = [];
      if (domain && domain !== 'all') {
        query += ' WHERE domain = ?';
        params.push(domain);
      }
      query += ' ORDER BY type ASC, id ASC';
      const rows = db.prepare(query).all(...params);
      
      const questions = rows.map(r => ({
        ...r,
        subject_hierarchy: JSON.parse(r.subject_hierarchy || '[]'),
        suggested_answer: r.suggested_answer ? JSON.parse(r.suggested_answer) : null,
        extracted_rule: r.extracted_rule ? JSON.parse(r.extracted_rule) : null,
        options: r.options ? JSON.parse(r.options) : null
      }));
      
      return sendJSON(res, 200, { success: true, count: questions.length, questions });
    }

    // ----------------------------------------------------
    // API: GET /api/progress/extraction
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/progress/extraction') {
      const books = db.prepare('SELECT * FROM book_metadata ORDER BY weight_percentage DESC').all();
      const sections = db.prepare('SELECT * FROM syllabus_sections ORDER BY book_id, page_number ASC').all();
      const essayCount = db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE type = 'essay'").get().cnt;
      const mcqCount = db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE type = 'mcq'").get().cnt;
      
      const totalSections = sections.length;
      const extractedSections = sections.filter(s => s.is_extracted === 1).length;
      const overallPercentage = totalSections > 0 ? Math.round((extractedSections / totalSections) * 100) : 0;
      const totalPages = books.reduce((acc, b) => acc + b.total_pages, 0);

      return sendJSON(res, 200, {
        success: true,
        summary: {
          total_books: books.length,
          total_pages: totalPages,
          total_sections: totalSections,
          extracted_sections: extractedSections,
          overall_percentage: overallPercentage,
          total_essays: essayCount,
          total_mcqs: mcqCount
        },
        books: books.map(b => ({
          ...b,
          percentage: b.total_sections > 0 ? Math.round((b.extracted_sections / b.total_sections) * 100) : 0
        })),
        sections
      });
    }

    // ----------------------------------------------------
    // API: GET /api/analytics/readiness
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/analytics/readiness') {
      const attempts = db.prepare(`
        SELECT a.*, q.domain, q.topic, q.difficulty 
        FROM candidate_attempts a
        JOIN questions q ON a.question_id = q.id
        ORDER BY a.attempted_at DESC
      `).all();

      const books = db.prepare('SELECT * FROM book_metadata').all();
      const domainStats = {};

      books.forEach(b => {
        domainStats[b.domain] = {
          domain: b.domain,
          weight: b.weight_percentage,
          total_attempts: 0,
          scores: [],
          average_score: 0,
          status: 'Not Started'
        };
      });

      attempts.forEach(att => {
        if (domainStats[att.domain]) {
          domainStats[att.domain].total_attempts++;
          domainStats[att.domain].scores.push(att.ai_score || 0);
        }
      });

      let weightedSum = 0;
      let totalAssessedWeight = 0;

      Object.values(domainStats).forEach(ds => {
        if (ds.scores.length > 0) {
          const avg = Math.round(ds.scores.reduce((a, b) => a + b, 0) / ds.scores.length);
          ds.average_score = avg;
          ds.status = avg >= 75 ? 'Passing Ready' : (avg >= 60 ? 'Needs Practice' : 'Critical Focus');
          weightedSum += avg * (ds.weight / 100);
          totalAssessedWeight += ds.weight;
        } else {
          ds.average_score = 0;
          ds.status = 'No Attempts Yet';
        }
      });

      const projectedBarScore = totalAssessedWeight > 0 
        ? Math.round((weightedSum / (totalAssessedWeight / 100)) * 10) / 10 
        : 0;

      return sendJSON(res, 200, {
        success: true,
        projected_score: projectedBarScore,
        is_passing: projectedBarScore >= 75,
        total_attempts: attempts.length,
        domain_breakdown: Object.values(domainStats),
        recent_attempts: attempts.slice(0, 10)
      });
    }

    // ----------------------------------------------------
    // API: GET /api/analytics/diagnose-ai (AI SDK Diagnostic Report)
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/analytics/diagnose-ai') {
      const attempts = db.prepare(`
        SELECT a.*, q.domain, q.topic 
        FROM candidate_attempts a
        JOIN questions q ON a.question_id = q.id
        ORDER BY a.attempted_at DESC LIMIT 20
      `).all();

      const diagnosis = await runDiagnosticAgent({ attempts });
      return sendJSON(res, 200, { success: true, diagnosis });
    }

    // ----------------------------------------------------
    // API: POST /api/auto-ingest-batch (AI SDK Autonomous Agent)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/auto-ingest-batch') {
      const body = await parseJSONBody(req);
      const batchSize = Math.min(10, body.batch_size || 3);
      const domainFilter = body.domain || 'all';

      const result = await runAutonomousIngestAgent({
        domain: domainFilter,
        count: batchSize
      });

      return sendJSON(res, 200, {
        success: result.success,
        ingested_count: result.count,
        sections: result.sections || [],
        logs: result.logs || [],
        message: `Successfully ingested ${result.count} section(s) via AI SDK Agent!`
      });
    }

    // ----------------------------------------------------
    // API: GET /api/book/section-text
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/book/section-text') {
      const sectionId = parsedUrl.searchParams.get('section_id');
      if (!sectionId) return sendJSON(res, 400, { error: 'Missing section_id' });

      const sec = db.prepare('SELECT * FROM syllabus_sections WHERE id = ?').get(sectionId);
      if (!sec) return sendJSON(res, 404, { error: 'Section not found' });

      const mdPath = path.join(__dirname, 'storage', 'converted_md', `${sec.book_id}.md`);
      if (!fs.existsSync(mdPath)) {
        return sendJSON(res, 404, { error: 'Converted markdown book not found' });
      }

      const mdContent = fs.readFileSync(mdPath, 'utf-8');
      
      let excerpt = '';
      const pageMarker = `<!-- PAGE ${sec.page_number} -->`;
      const pIdx = mdContent.indexOf(pageMarker);
      if (pIdx !== -1) {
        excerpt = mdContent.slice(pIdx, pIdx + 3500);
      } else {
        const titleIdx = mdContent.indexOf(sec.topic_title);
        if (titleIdx !== -1) {
          excerpt = mdContent.slice(Math.max(0, titleIdx - 200), titleIdx + 3000);
        } else {
          excerpt = mdContent.slice(0, 3000);
        }
      }

      return sendJSON(res, 200, {
        success: true,
        section: sec,
        source_text: excerpt.trim()
      });
    }

    // ----------------------------------------------------
    // API: POST /api/generate-section
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/generate-section') {
      const body = await parseJSONBody(req);
      const { section_id, source_text, strategy_guide } = body;

      const sec = db.prepare('SELECT * FROM syllabus_sections WHERE id = ?').get(section_id);
      if (!sec) return sendJSON(res, 404, { error: 'Section not found' });

      const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';
      const baseUrl = getConfig('opencode_base_url') || 'https://api.deepseek.com';
      const model = getConfig('default_model') || 'deepseek-chat';

      const defaultSystemPrompt = `You are an expert Supreme Court Bar Examiner authoring 2026 Philippine Bar Examination questions.
Apply TWO-PASS DISCIPLINE: (1) Extract abstracted black-letter rule/elements; (2) Generate novel multi-party scenario with Filipino names, specific dates, multi-part interrogatories, and ALAC/IRAC solution. Also 1 recall MCQ.
Output strictly JSON:
{
  "essay": {
    "topic": "${sec.topic_title}",
    "difficulty": "hard",
    "extracted_rule": { "doctrine": "...", "statutory_basis": ["..."], "elements_and_principles": ["..."] },
    "fact_pattern": "Novel multi-party scenario...",
    "interrogatory": "(a) ...? (b) ...?",
    "suggested_answer": { "issue": "...", "rule": "...", "analysis": "...", "conclusion": "..." }
  },
  "mcq": {
    "topic": "${sec.topic_title}",
    "difficulty": "medium",
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "correct_answer": "B",
    "explanation": "..."
  }
}`;

      let generatedOutput = null;

      if (apiKey) {
        try {
          const endpointUrl = formatApiUrl(baseUrl);
          const apiRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: defaultSystemPrompt },
                { role: 'user', content: `[SOURCE TEXT]:\n${source_text || sec.topic_title}\n\n${strategy_guide ? '[STRATEGY]: ' + strategy_guide : ''}` }
              ],
              temperature: 0.3,
              response_format: { type: 'json_object' }
            })
          });

          if (apiRes.ok) {
            const apiJson = await apiRes.json();
            generatedOutput = JSON.parse(apiJson.choices?.[0]?.message?.content || '{}');
          }
        } catch (apiErr) {
          console.error('Error calling AI generation API:', apiErr);
        }
      }

      if (!generatedOutput || !generatedOutput.essay) {
        generatedOutput = {
          essay: {
            topic: sec.topic_title,
            difficulty: 'hard',
            extracted_rule: {
              doctrine: `Governing rule for ${sec.topic_title} under Philippine Law.`,
              statutory_basis: [sec.domain],
              elements_and_principles: [`Essential legal elements governing ${sec.topic_title}.`]
            },
            fact_pattern: `On April 12, 2024, in Quezon City, Leonardo entered into a formal transaction involving ${sec.topic_title}. An unexpected controversy arose when Clarita asserted claims contrary to the governing statutory framework. Litigation ensued before the Regional Trial Court.`,
            interrogatory: `(a) How should the court resolve the dispute regarding ${sec.topic_title} under prevailing Philippine jurisprudence?\n(b) Formulate your suggested answer following the ALAC/IRAC method.`,
            suggested_answer: {
              issue: `Whether the principles of ${sec.topic_title} apply to sustain Clarita's claims against Leonardo.`,
              rule: `Under governing statutes and settled Supreme Court jurisprudence, ${sec.topic_title} requires compliance with established legal requisites.`,
              analysis: `Applying the rule to the scenario, Leonardo's conduct must be evaluated against each requisite.`,
              conclusion: `The court should rule in accordance with the established statutory requisites governing ${sec.topic_title}.`
            }
          },
          mcq: {
            topic: sec.topic_title,
            difficulty: 'medium',
            question: `Which of the following is an indispensable requisite of ${sec.topic_title}?`,
            options: [
              `A) Mere verbal agreement without statutory compliance`,
              `B) Strict adherence to the statutory requisites under Philippine law`,
              `C) Complete exemption from judicial review`,
              `D) Unilateral determination by one party`
            ],
            correct_answer: "B",
            explanation: `Under Philippine law, ${sec.topic_title} strictly requires adherence to established statutory requisites.`
          }
        };
      }

      return sendJSON(res, 200, { success: true, section_id, generated: generatedOutput });
    }

    // ----------------------------------------------------
    // API: POST /api/commit-section
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/commit-section') {
      const body = await parseJSONBody(req);
      const { section_id, essay, mcq } = body;

      const sec = db.prepare('SELECT * FROM syllabus_sections WHERE id = ?').get(section_id);
      if (!sec) return sendJSON(res, 404, { error: 'Section not found' });

      if (essay) {
        const essayId = `GEN-ESS-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        db.prepare(`
          INSERT INTO questions (id, domain, type, topic, subject_hierarchy, difficulty, fact_pattern, interrogatory, suggested_answer, extracted_rule)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          essayId, sec.domain, 'essay', essay.topic || sec.topic_title,
          JSON.stringify([sec.domain, sec.topic_title]), essay.difficulty || 'hard',
          essay.fact_pattern, essay.interrogatory,
          JSON.stringify(essay.suggested_answer || {}), JSON.stringify(essay.extracted_rule || {})
        );
      }

      if (mcq) {
        const mcqId = `GEN-MCQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        db.prepare(`
          INSERT INTO questions (id, domain, type, topic, subject_hierarchy, difficulty, options, correct_answer, explanation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          mcqId, sec.domain, 'mcq', mcq.topic || sec.topic_title,
          JSON.stringify([sec.domain, sec.topic_title]), mcq.difficulty || 'medium',
          JSON.stringify(mcq.options || []), mcq.correct_answer || 'A', mcq.explanation || ''
        );
      }

      db.prepare(`
        UPDATE syllabus_sections 
        SET is_extracted = 1, essay_count = essay_count + 1, mcq_count = mcq_count + 1, extracted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(section_id);

      const extCount = db.prepare('SELECT COUNT(*) as cnt FROM syllabus_sections WHERE book_id = ? AND is_extracted = 1').get(sec.book_id).cnt;
      db.prepare('UPDATE book_metadata SET extracted_sections = ? WHERE id = ?').run(extCount, sec.book_id);

      return sendJSON(res, 200, { success: true, message: `Committed '${sec.topic_title}' to Question Bank!` });
    }

    // ----------------------------------------------------
    // API: POST /api/refine-question (Targeted AI Modification with Diff)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/refine-question') {
      const body = await parseJSONBody(req);
      const { question_id, refinement_instruction, target_field, question_data } = body;

      let targetQ = question_data;
      if (!targetQ && question_id) {
        const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(question_id);
        if (row) {
          targetQ = {
            ...row,
            suggested_answer: row.suggested_answer ? JSON.parse(row.suggested_answer) : null,
            subject_hierarchy: row.subject_hierarchy ? JSON.parse(row.subject_hierarchy) : []
          };
        }
      }

      if (!targetQ) {
        return sendJSON(res, 400, { error: 'Missing question or question_id' });
      }

      const refined = await refineQuestionModality({
        original_question: targetQ,
        refinement_instruction: refinement_instruction || 'Polish and ensure rigorous Philippine Bar standards',
        target_field: target_field || 'all'
      });

      return sendJSON(res, 200, {
        success: true,
        original: targetQ,
        refined: refined
      });
    }

    // ----------------------------------------------------
    // API: POST /api/update-question (Save Refined Question to SQLite)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/update-question') {
      const body = await parseJSONBody(req);
      const { question } = body;

      if (!question || !question.id) {
        return sendJSON(res, 400, { error: 'Invalid question payload' });
      }

      const isMcq = question.type === 'mcq' || Boolean(question.options);

      if (isMcq) {
        db.prepare(`
          UPDATE questions 
          SET topic = ?, question = ?, options = ?, correct_answer = ?, explanation = ?, difficulty = ?
          WHERE id = ?
        `).run(
          question.topic,
          question.question,
          JSON.stringify(question.options || []),
          question.correct_answer || 'A',
          question.explanation || '',
          question.difficulty || 'medium',
          question.id
        );
      } else {
        db.prepare(`
          UPDATE questions 
          SET topic = ?, fact_pattern = ?, interrogatory = ?, suggested_answer = ?, difficulty = ?
          WHERE id = ?
        `).run(
          question.topic,
          question.fact_pattern,
          question.interrogatory,
          JSON.stringify(question.suggested_answer || {}),
          question.difficulty || 'hard',
          question.id
        );
      }

      return sendJSON(res, 200, {
        success: true,
        message: `Successfully updated ${isMcq ? 'MCQ' : 'Essay'} question '${question.topic}' in database!`
      });
    }

    // ----------------------------------------------------
    // API: POST /api/chat (RAG Bar AI Counsel)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await parseJSONBody(req);
      const { messages, domain } = body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return sendJSON(res, 400, { error: 'Messages array is required' });
      }

      const result = await chatWithReviewerRAG({
        messages,
        domain: domain || 'all'
      });

      return sendJSON(res, 200, {
        success: true,
        reply: result.reply,
        citations: result.citations || []
      });
    }

    // ----------------------------------------------------
    // API: POST /api/rag/query (LlamaIndex & SQLite Vector Search)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/rag/query') {
      const body = await parseJSONBody(req);
      const { query, domain, top_k } = body;

      if (!query || !query.trim()) {
        return sendJSON(res, 400, { error: 'Search query is required' });
      }

      const results = retrieveHybridRAG({
        query: query.trim(),
        domain: domain || 'all',
        topK: top_k || 6
      });

      return sendJSON(res, 200, {
        success: true,
        query: query.trim(),
        domain: domain || 'all',
        total_matched: results.length,
        results
      });
    }

    // ----------------------------------------------------
    // API: GET /api/rag/stats (Vector Store Diagnostics)
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/rag/stats') {
      const stats = getVectorStoreStats();
      return sendJSON(res, 200, { success: true, stats });
    }

    // ----------------------------------------------------
    // API: POST /api/rag/reindex (Trigger LlamaIndex Book Reindexing)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/rag/reindex') {
      const result = await indexAllReviewerBooks();
      return sendJSON(res, 200, {
        success: true,
        message: `Successfully indexed ${result.total_chunks} LlamaIndex chunks into SQLite Vector Store!`,
        result
      });
    }

    // ----------------------------------------------------
    // API: GET /api/models (Dynamically fetch live models from provider)
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/models') {
      const qApiKey = parsedUrl.searchParams.get('api_key');
      const qBaseUrl = parsedUrl.searchParams.get('base_url');

      const apiKey = (qApiKey && qApiKey.trim()) || getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';
      let baseUrl = (qBaseUrl && qBaseUrl.trim()) || getConfig('opencode_base_url') || 'https://opencode.ai/zen/go/v1';
      
      baseUrl = baseUrl.trim().replace(/\/+$/, '');
      if (!baseUrl.endsWith('/v1')) {
        baseUrl += '/v1';
      }
      const modelsEndpoint = `${baseUrl}/models`;

      if (!apiKey) {
        return sendJSON(res, 200, {
          success: false,
          error: 'No API key provided. Enter your OpenCode Go API key and click Fetch.',
          models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
        });
      }

      try {
        const response = await fetch(modelsEndpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          const rawModels = data.data || data.models || [];
          const modelIds = rawModels
            .map(m => (typeof m === 'string' ? m : m.id))
            .filter(Boolean)
            .sort();

          return sendJSON(res, 200, {
            success: true,
            source: modelsEndpoint,
            models: modelIds.length > 0 ? modelIds : ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
          });
        } else {
          const errText = await response.text();
          console.warn(`Provider /models returned status ${response.status}:`, errText);
          return sendJSON(res, 200, {
            success: false,
            error: `Provider /models returned status ${response.status}: ${errText.slice(0, 150)}`,
            models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
          });
        }
      } catch (err) {
        console.error('Error fetching live models from provider:', err.message);
        return sendJSON(res, 200, {
          success: false,
          error: err.message,
          models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
        });
      }
    }

    // ----------------------------------------------------
    // API: POST /api/test-connection (Live AI Health Check)
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/test-connection') {
      const body = await parseJSONBody(req);
      let apiKey = (body.api_key && body.api_key.trim()) || getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';
      apiKey = apiKey.trim().replace(/^["']|["']$/g, '');
      
      let baseUrl = (body.base_url && body.base_url.trim()) || getConfig('opencode_base_url') || 'https://opencode.ai/zen/go/v1';
      const model = (body.model && body.model.trim()) || getConfig('default_model') || 'deepseek-v4-flash';

      if (!apiKey) {
        return sendJSON(res, 400, { success: false, error: 'Please enter an OpenCode Go API Key to test.' });
      }

      const endpointUrl = formatApiUrl(baseUrl);
      const startTime = Date.now();

      try {
        const response = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: 'Respond with exactly the word OK' }],
            max_tokens: 10,
            temperature: 0
          })
        });

        const latencyMs = Date.now() - startTime;

        if (response.ok) {
          const json = await response.json();
          const reply = json.choices?.[0]?.message?.content || 'OK';
          return sendJSON(res, 200, {
            success: true,
            latency_ms: latencyMs,
            model_used: model,
            endpoint: endpointUrl,
            reply: reply.trim()
          });
        } else {
          const errBody = await response.text();
          let parsedErr = errBody;
          try {
            const errObj = JSON.parse(errBody);
            parsedErr = errObj.error?.message || errBody;
          } catch(e) {}

          return sendJSON(res, 200, {
            success: false,
            status_code: response.status,
            latency_ms: latencyMs,
            error: `HTTP ${response.status}: ${parsedErr}`
          });
        }
      } catch (err) {
        return sendJSON(res, 200, {
          success: false,
          error: `Network Error: ${err.message}`
        });
      }
    }

    // ----------------------------------------------------
    // API: GET /api/settings & POST /api/settings
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname === '/api/settings') {
      const apiKey = getConfig('opencode_api_key') || '';
      return sendJSON(res, 200, {
        success: true,
        settings: {
          opencode_api_key: apiKey,
          has_key: Boolean(apiKey),
          opencode_base_url: getConfig('opencode_base_url') || 'https://opencode.ai/zen/go/v1',
          default_model: getConfig('default_model') || 'deepseek-v4-flash'
        }
      });
    }

    if (req.method === 'POST' && pathname === '/api/settings') {
      const body = await parseJSONBody(req);
      if (body.opencode_api_key !== undefined) {
        setConfig('opencode_api_key', body.opencode_api_key.trim());
      }
      if (body.opencode_base_url) {
        setConfig('opencode_base_url', body.opencode_base_url.trim());
      }
      if (body.default_model) {
        setConfig('default_model', body.default_model.trim());
      }
      return sendJSON(res, 200, { success: true, message: 'Settings saved successfully' });
    }

    // ----------------------------------------------------
    // API: GET /api/attempts/:id
    // ----------------------------------------------------
    if (req.method === 'GET' && pathname.startsWith('/api/attempts/')) {
      const questionId = pathname.replace('/api/attempts/', '');
      const attempts = db.prepare('SELECT * FROM candidate_attempts WHERE question_id = ? ORDER BY attempted_at DESC').all(questionId);
      return sendJSON(res, 200, {
        success: true,
        attempts: attempts.map(a => ({
          ...a,
          ai_breakdown: a.ai_breakdown ? JSON.parse(a.ai_breakdown) : null
        }))
      });
    }

    // ----------------------------------------------------
    // API: POST /api/evaluate
    // ----------------------------------------------------
    if (req.method === 'POST' && pathname === '/api/evaluate') {
      const body = await parseJSONBody(req);
      const { question_id, user_answer } = body;

      if (!question_id || !user_answer || !user_answer.trim()) {
        return sendJSON(res, 400, { error: 'Missing question_id or candidate answer' });
      }

      const qRow = db.prepare('SELECT * FROM questions WHERE id = ?').get(question_id);
      if (!qRow) return sendJSON(res, 404, { error: 'Question not found' });

      const suggestedAnswer = qRow.suggested_answer ? JSON.parse(qRow.suggested_answer) : {};
      const hierarchy = qRow.subject_hierarchy ? JSON.parse(qRow.subject_hierarchy).join(' > ') : qRow.domain;

      const apiKey = getConfig('opencode_api_key') || process.env.OPENCODE_API_KEY || '';
      const baseUrl = getConfig('opencode_base_url') || 'https://api.deepseek.com';
      const model = getConfig('default_model') || 'deepseek-v4-flash';

      let evaluationResult = null;
      let lastApiError = null;

      if (apiKey) {
        try {
          const systemPrompt = `You are a distinguished Supreme Court Bar Examiner grading candidate essay booklets for the 2026 Philippine Bar Examination.
Grade with uncompromising Bar Examiner rigor from 0 to 100.
Evaluate using the official 100-Point Supreme Court ALAC (Answer, Legal Basis, Application, Conclusion) / IRAC methodology.

SCORING CRITERIA (Total 100):
- Issue & Direct Answer (10 pts): Must provide an immediate, categorical stance ("Yes" / "No" / "The action will prosper").
- Legal Basis (Rule) (30 pts): Must cite exact statutory Articles (RPC, Civil Code, Rules of Court, Constitution) and landmark Supreme Court doctrines.
- Application (Analysis) (50 pts): Must methodically match each statutory requisite to the specific facts, dates, and named parties.
- Conclusion (10 pts): Clear, unambiguous legal disposition.

REQUIRED OUTPUT SCHEMA (JSON ONLY):
{
  "score": 40,
  "breakdown": {
    "issue_or_answer": 7,
    "legal_basis": 10,
    "application": 15,
    "conclusion": 8
  },
  "strengths": "State precisely what the candidate spotted or structured correctly.",
  "deficiencies": "Itemize exact point deductions with missing statutory articles, omitted requisites, and factual misapplications (e.g. '-20 pts in Legal Basis: Failed to cite Article 21, RPC; -35 pts in Application: Failed to match elements to party acts').",
  "prescribed_polish": "Provide the EXACT VERBATIM 100-POINT MODEL ANSWER (written in clean 4-paragraph ALAC format) showing the candidate how to write the perfect answer.",
  "deep_dive_concept": "Enumerate the numbered requisites, statutory cross-references, landmark Supreme Court En Banc doctrines, and tactical Bar examiner speed-reading rules."
}`;

          const userPrompt = `[BAR EXAM SUBJECT]: ${qRow.domain}
[TOPIC]: ${qRow.topic} (${hierarchy})

[FACT PATTERN]:
${qRow.fact_pattern}

[INTERROGATORY]:
${qRow.interrogatory}

[OFFICIAL BENCHMARK SOLUTION]:
- Issue / Direct Answer: ${suggestedAnswer.issue || ''}
- Rule / Legal Basis: ${suggestedAnswer.rule || ''}
- Analysis / Application: ${suggestedAnswer.analysis || ''}
- Conclusion: ${suggestedAnswer.conclusion || ''}

[CANDIDATE'S SUBMITTED ANSWER]:
${user_answer}

Please evaluate the candidate's answer and output strictly valid JSON.`;

          const endpointUrl = formatApiUrl(baseUrl);
          const apiRes = await fetch(endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.2,
              response_format: { type: 'json_object' }
            })
          });

          if (apiRes.ok) {
            const apiJson = await apiRes.json();
            const rawContent = apiJson.choices?.[0]?.message?.content || '{}';
            try {
              evaluationResult = JSON.parse(rawContent);
            } catch (pErr) {
              const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
              if (jsonMatch) evaluationResult = JSON.parse(jsonMatch[0]);
            }
          } else {
            const errText = await apiRes.text();
            let parsedMessage = errText;
            try {
              const errJson = JSON.parse(errText);
              parsedMessage = errJson.error?.message || errText;
            } catch(e) {}
            lastApiError = `HTTP ${apiRes.status}: ${parsedMessage}`;
            console.error(`AI API Evaluation Error (${apiRes.status}):`, parsedMessage);
          }
        } catch (apiErr) {
          lastApiError = apiErr.message;
          console.error('Error connecting to AI API:', apiErr);
        }
      }

      // STRICT VALIDATION: If AI evaluation failed or no API key, DO NOT RECORD INTO DB
      if (!evaluationResult || typeof evaluationResult.score !== 'number') {
        const errorMessage = !apiKey 
          ? 'No API Key configured. Please click ⚙️ Settings at the top right to configure your OpenCode Go or DeepSeek API Key.'
          : `AI Evaluation failed (${lastApiError || 'API returned invalid response'}). No attempt or score was recorded.`;

        return sendJSON(res, 400, {
          success: false,
          error: errorMessage,
          recorded: false
        });
      }

      // Only record into SQLite if AI evaluation was strictly successful
      const attemptId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO candidate_attempts (id, question_id, user_answer, ai_score, ai_feedback, ai_breakdown)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        attemptId,
        question_id,
        user_answer,
        evaluationResult.score,
        JSON.stringify({ strengths: evaluationResult.strengths, deficiencies: evaluationResult.deficiencies, prescribed_polish: evaluationResult.prescribed_polish, deep_dive_concept: evaluationResult.deep_dive_concept }),
        JSON.stringify(evaluationResult.breakdown)
      );

      return sendJSON(res, 200, {
        success: true,
        evaluation: evaluationResult,
        recorded: true,
        attempt_id: attemptId
      });
    }

    // ----------------------------------------------------
    // Static File Serving
    // ----------------------------------------------------
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');

  } catch (globalErr) {
    console.error('Server Internal Error:', globalErr);
    sendJSON(res, 500, { error: 'Internal Server Error', details: globalErr.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚖️  BAR 2026 MOCK REVIEWER SERVER RUNNING`);
  console.log(`🌐  Local URL: http://localhost:${PORT}`);
  console.log(`💾  SQLite DB: ${path.join(__dirname, 'barmock.db')}`);
  console.log(`🤖  AI SDK Provider: Enabled (${getConfig('default_model') || 'deepseek-chat'})`);
  console.log(`======================================================\n`);
});
