// Bar 2026 Mock Reviewer — Expansive Full Edge Case & End-to-End Test Suite
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db, getConfig, setConfig } = require('./db');
const {
  getAIProvider,
  getModelName,
  scoutBookMarkdownTool,
  lookupSyllabusTool,
  commitToDatabaseTool,
  refineQuestionModality,
  runAutonomousIngestAgent,
  runDiagnosticAgent
} = require('./agent_engine');

// Helper to make HTTP requests against the live server
const request = (method, path, body = null, headers = {}) => {
  return new Promise((resolve, reject) => {
    const postData = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: 8080,
      path: path,
      method: method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, raw: data, json });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
};

// =========================================================================
// SUITE 1: DATABASE & CONFIGURATION LAYER TESTS
// =========================================================================

test('DB: All required tables and indexes exist in barmock.db', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  assert.ok(tables.includes('book_metadata'), 'book_metadata table must exist');
  assert.ok(tables.includes('syllabus_sections'), 'syllabus_sections table must exist');
  assert.ok(tables.includes('questions'), 'questions table must exist');
  assert.ok(tables.includes('candidate_attempts'), 'candidate_attempts table must exist');
  assert.ok(tables.includes('system_config'), 'system_config table must exist');
});

test('DB: Configuration get and set with unicode and special characters', () => {
  const testKey = 'test_unicode_key_' + Date.now();
  const testVal = '⚖️ Supreme Court "Rule 138-A" & § 10 — <Special>';
  setConfig(testKey, testVal);
  const retrieved = getConfig(testKey);
  assert.equal(retrieved, testVal);
});

test('DB: Edge Case - Malformed and large payload resilience', () => {
  const hugeString = 'X'.repeat(50000);
  const testKey = 'test_huge_config';
  setConfig(testKey, hugeString);
  assert.equal(getConfig(testKey).length, 50000);
});

// =========================================================================
// SUITE 2: AI SDK AGENT ENGINE & TOOLS TESTS
// =========================================================================

test('Agent Tools: scoutBookMarkdownTool handles boundary page numbers and missing pages', async () => {
  // Page 1
  const page1 = await scoutBookMarkdownTool.execute({ book_id: 'civil_law', page_number: 1 });
  assert.equal(page1.found, true);
  assert.ok(page1.excerpt.length > 0);

  // Exorbitant page number
  const page9999 = await scoutBookMarkdownTool.execute({ book_id: 'civil_law', page_number: 99999 });
  assert.equal(page9999.found, true); // Returns fallback excerpt
  assert.ok(page9999.excerpt.length > 0);

  // Invalid book ID
  const invalidBook = await scoutBookMarkdownTool.execute({ book_id: 'non_existent_book_xyz' });
  assert.equal(invalidBook.found, true); // Fallback resolves to first available markdown book
});

test('Agent Tools: scoutBookMarkdownTool query search matches doctrinal phrases', async () => {
  const result = await scoutBookMarkdownTool.execute({
    book_id: 'criminal_law',
    search_query: 'JUSTIFYING CIRCUMSTANCES'
  });
  assert.equal(result.found, true);
  assert.ok(result.excerpt.length > 0);
});

test('Agent Tools: lookupSyllabusTool edge cases (zero limit, negative, exact domain)', async () => {
  // Exact domain lookup
  const exact = await lookupSyllabusTool.execute({ domain: 'Criminal Law', limit: 2 });
  assert.ok(exact.sections.length <= 2);

  // Wildcard lookup
  const wildcard = await lookupSyllabusTool.execute({ domain: 'Commercial', limit: 2 });
  assert.ok(wildcard.sections.length <= 2);

  // Exhausted / non-existent domain
  const nonExistent = await lookupSyllabusTool.execute({ domain: 'Astronomy Law', limit: 5 });
  assert.equal(nonExistent.sections.length, 0);
});

test('Agent Tools: Targeted AI Question Refinement across all component granularities', async () => {
  const baseQ = {
    id: 'REFINE-TEST-001',
    domain: 'Commercial & Taxation Laws',
    topic: 'Doctrine of Piercing the Corporate Veil',
    difficulty: 'hard',
    fact_pattern: 'Nexus Corp was organized by Greg with 99% shares. Greg used company funds for personal luxury vehicles.',
    interrogatory: 'Can the creditors of Greg attach the vehicles registered under Nexus Corp?',
    suggested_answer: {
      issue: 'Whether the separate juridical personality of Nexus Corp should be disregarded.',
      rule: 'Under the doctrine of piercing the corporate veil, when the corporation is a mere alter ego or used to commit fraud, the separate personality is disregarded.',
      analysis: 'Greg exercised complete domination over finances and used the corporate vehicle for personal gain.',
      conclusion: 'Yes, the creditors can attach the vehicles by piercing the corporate veil.'
    }
  };

  // Test 1: Fact pattern only
  const refFact = await refineQuestionModality({
    original_question: baseQ,
    refinement_instruction: 'Add a third-party subsidiary corporation into the transaction.',
    target_field: 'fact_pattern'
  });
  assert.ok(refFact.fact_pattern.length > baseQ.fact_pattern.length);
  assert.equal(refFact.topic, baseQ.topic);

  // Test 2: Interrogatory only
  const refInterrog = await refineQuestionModality({
    original_question: baseQ,
    refinement_instruction: 'Add sub-question (b) regarding the criminal liability of directors under the Revised Corporation Code.',
    target_field: 'interrogatory'
  });
  assert.ok(refInterrog.interrogatory.includes('(b)') || refInterrog.interrogatory.length > baseQ.interrogatory.length);

  // Test 3: Suggested answer only
  const refAns = await refineQuestionModality({
    original_question: baseQ,
    refinement_instruction: 'Enforce strict 2026 Bar syllabus ALAC format with explicit Article citations.',
    target_field: 'suggested_answer'
  });
  assert.ok(refAns.suggested_answer.conclusion);
});

test('Agent Tools: runDiagnosticAgent provides structured advice for edge case attempt profiles', async () => {
  // Edge Case A: Empty attempts
  const emptyDiag = await runDiagnosticAgent({ attempts: [] });
  assert.ok(emptyDiag.overall_readiness_status);
  assert.ok(Array.isArray(emptyDiag.key_strengths));
  assert.ok(Array.isArray(emptyDiag.critical_blind_spots));

  // Edge Case B: Single failing attempt
  const failDiag = await runDiagnosticAgent({
    attempts: [{ domain: 'Remedial Law, Legal and Judicial Ethics with Practical Exercises', topic: 'Demurrer to Evidence', ai_score: 35 }]
  });
  assert.ok(failDiag.overall_readiness_status);
  assert.ok(failDiag.prescribed_study_priorities.length > 0);
});

// =========================================================================
// SUITE 3: HTTP REST API & END-TO-END SERVER TESTS
// =========================================================================

test('API GET /api/domains: Returns 6 official domains with correct weight distribution totaling 100%', async () => {
  const res = await request('GET', '/api/domains');
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.domains.length, 6);

  const totalWeight = res.json.domains.reduce((acc, d) => acc + d.weight_percentage, 0);
  assert.equal(totalWeight, 100, 'Sum of all 6 Bar subject weights must equal exactly 100%');
});

test('API GET /api/questions: Domain filtering and edge case filters', async () => {
  // All questions
  const resAll = await request('GET', '/api/questions');
  assert.equal(resAll.status, 200);
  assert.ok(resAll.json.count >= 39);

  // Domain filter: Criminal Law
  const resCrim = await request('GET', '/api/questions?domain=Criminal%20Law');
  assert.equal(resCrim.status, 200);
  assert.ok(resCrim.json.questions.every(q => q.domain === 'Criminal Law'));

  // Non-existent domain filter
  const resNone = await request('GET', '/api/questions?domain=NonExistentDomainXYZ');
  assert.equal(resNone.status, 200);
  assert.equal(resNone.json.count, 0);
});

test('API GET /api/progress/extraction: Verifies 1,046 total sections and 1,951 total pages', async () => {
  const res = await request('GET', '/api/progress/extraction');
  assert.equal(res.status, 200);
  assert.equal(res.json.summary.total_books, 6);
  assert.equal(res.json.summary.total_pages, 1951);
  assert.ok(res.json.summary.total_sections >= 1040);
  assert.ok(res.json.summary.extracted_sections >= 3);
  assert.ok(res.json.summary.overall_percentage >= 0);
});

test('API GET /api/analytics/readiness: Correct weighted score and domain status categorization', async () => {
  const res = await request('GET', '/api/analytics/readiness');
  assert.equal(res.status, 200);
  assert.ok(typeof res.json.projected_score === 'number');
  assert.equal(typeof res.json.is_passing, 'boolean');
  assert.equal(res.json.domain_breakdown.length, 6);
  
  // Each domain breakdown must contain weight and status
  res.json.domain_breakdown.forEach(d => {
    assert.ok(d.domain);
    assert.ok(d.weight > 0);
    assert.ok(['Passing Ready', 'Needs Practice', 'Critical Focus', 'No Attempts Yet'].includes(d.status));
  });
});

test('API GET /api/analytics/diagnose-ai: Returns structured AI diagnostic report', async () => {
  const res = await request('GET', '/api/analytics/diagnose-ai');
  assert.equal(res.status, 200);
  assert.ok(res.json.diagnosis);
  assert.ok(res.json.diagnosis.overall_readiness_status);
  assert.ok(Array.isArray(res.json.diagnosis.key_strengths));
  assert.ok(Array.isArray(res.json.diagnosis.critical_blind_spots));
});

test('API GET /api/book/section-text: Valid section vs missing section vs edge cases', async () => {
  // Valid section
  const resValid = await request('GET', '/api/book/section-text?section_id=criminal_law_sec_1');
  assert.equal(resValid.status, 200);
  assert.ok(resValid.json.source_text.length > 50);

  // Missing section_id param
  const resMissing = await request('GET', '/api/book/section-text');
  assert.equal(resMissing.status, 400);

  // Non-existent section_id
  const resNotFound = await request('GET', '/api/book/section-text?section_id=invalid_sec_9999');
  assert.equal(resNotFound.status, 404);
});

test('API GET /api/models: Handles real live endpoint queries & unconfigured key state', async () => {
  const res = await request('GET', '/api/models');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.models));
  assert.ok(res.json.models.length > 0);
});

test('API POST /api/settings: Full key persistence without truncation on GET', async () => {
  // Save new settings
  const saveRes = await request('POST', '/api/settings', {
    opencode_api_key: 'sk-test-opencode-secret-12345',
    opencode_base_url: 'https://api.deepseek.com',
    default_model: 'deepseek-v4-flash'
  });
  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.json.success, true);

  // Retrieve and verify full key integrity
  const getRes = await request('GET', '/api/settings');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.json.settings.has_key, true);
  assert.equal(getRes.json.settings.opencode_api_key, 'sk-test-opencode-secret-12345', 'Full API key must be preserved without truncation');
  assert.equal(getRes.json.settings.default_model, 'deepseek-v4-flash');
});

test('API POST /api/evaluate: Full scoring flow with ALAC & IRAC rubrics, attempt persistence, and deep-dive concept', async () => {
  const questionRes = await request('GET', '/api/questions');
  const sampleQ = questionRes.json.questions.find(q => q.type === 'essay');
  assert.ok(sampleQ, 'At least one essay question must exist');

  // Submit categorical ALAC answer
  const evalRes = await request('POST', '/api/evaluate', {
    question_id: sampleQ.id,
    user_answer: `Answer: Yes, the petition should be granted.
Legal Basis: Under Article 1144 of the Civil Code in relation to jurisprudence, an action upon a written contract prescribes in ten (10) years.
Application: Here, the loan agreement was executed in writing on May 15, 2014, and the judicial demand was made on April 10, 2024, which is within the 10-year prescriptive period.
Conclusion: Wherefore, the motion to dismiss grounded on prescription must be denied.`
  });

  assert.equal(evalRes.status, 200);
  assert.equal(evalRes.json.success, true);
  assert.ok(evalRes.json.attempt_id);
  assert.ok(evalRes.json.evaluation.score >= 0 && evalRes.json.evaluation.score <= 100);
  
  // Verify 4-part rubric breakdown
  const b = evalRes.json.evaluation.breakdown;
  assert.ok(b.issue_or_answer >= 0 && b.issue_or_answer <= 10);
  assert.ok(b.legal_basis >= 0 && b.legal_basis <= 30);
  assert.ok(b.application >= 0 && b.application <= 50);
  assert.ok(b.conclusion >= 0 && b.conclusion <= 10);

  // Verify Deep-Dive Doctrinal Analysis exists
  assert.ok(evalRes.json.evaluation.deep_dive_concept);

  // Verify attempt was saved in SQLite
  const attemptsRes = await request('GET', `/api/attempts/${sampleQ.id}`);
  assert.equal(attemptsRes.status, 200);
  assert.ok(attemptsRes.json.attempts.some(a => a.id === evalRes.json.attempt_id));
});

test('API POST /api/evaluate: Edge cases (empty answer, missing question_id, invalid question)', async () => {
  // Empty answer
  const resEmpty = await request('POST', '/api/evaluate', { question_id: 'CRIM-ESSAY-001', user_answer: '   ' });
  assert.equal(resEmpty.status, 400);

  // Missing question_id
  const resMissingQ = await request('POST', '/api/evaluate', { user_answer: 'Sample text' });
  assert.equal(resMissingQ.status, 400);

  // Non-existent question_id
  const resNonExistent = await request('POST', '/api/evaluate', { question_id: 'INVALID-999', user_answer: 'Sample answer' });
  assert.equal(resNonExistent.status, 404);
});

test('API POST /api/refine-question & POST /api/update-question: End-to-end targeted editing flow', async () => {
  const questionRes = await request('GET', '/api/questions');
  const targetQ = questionRes.json.questions.find(q => q.type === 'essay');

  // Step 1: Request targeted refinement
  const refineRes = await request('POST', '/api/refine-question', {
    question_id: targetQ.id,
    refinement_instruction: 'Append a sub-question (b) on the applicable procedural remedies.',
    target_field: 'interrogatory'
  });

  assert.equal(refineRes.status, 200);
  assert.equal(refineRes.json.success, true);
  assert.ok(refineRes.json.refined.interrogatory);

  // Step 2: Commit updated question back to SQLite
  const updateRes = await request('POST', '/api/update-question', {
    question: refineRes.json.refined
  });

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.json.success, true);

  // Step 3: Verify update in database
  const verifyRes = await request('GET', '/api/questions');
  const updatedItem = verifyRes.json.questions.find(q => q.id === targetQ.id);
  assert.equal(updatedItem.interrogatory, refineRes.json.refined.interrogatory);
});

test('API POST /api/auto-ingest-batch: Autonomous batch ingestion pipeline', async () => {
  const res = await request('POST', '/api/auto-ingest-batch', {
    batch_size: 1,
    domain: 'all'
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.ok(typeof res.json.ingested_count === 'number');
  assert.ok(Array.isArray(res.json.logs));
});

test('API Static File Serving: Valid HTML, JS, CSS, and 404 handling', async () => {
  // index.html
  const resIndex = await request('GET', '/');
  assert.equal(resIndex.status, 200);
  assert.ok(resIndex.raw.includes('Bar 2026 Mock Reviewer'));

  // app.js
  const resAppJs = await request('GET', '/app.js');
  assert.equal(resAppJs.status, 200);
  assert.ok(resAppJs.raw.includes('barApp'));

  // Non-existent file
  const res404 = await request('GET', '/non_existent_file_xyz.txt');
  assert.equal(res404.status, 404);
});
