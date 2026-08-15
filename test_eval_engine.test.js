const test = require('node:test');
const assert = require('node:assert/strict');
const { EVAL_TEST_CASES, runSingleEvaluation, runAllEvaluations, estimateTokens } = require('./eval_engine');

const BASE_URL = 'http://localhost:8080';

async function request(method, path, body = null) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test('Eval Suite: 7 Standard Benchmarks Defined', () => {
  assert.equal(EVAL_TEST_CASES.length, 7);
  EVAL_TEST_CASES.forEach(tc => {
    assert.ok(tc.id);
    assert.ok(tc.name);
    assert.ok(tc.category);
    assert.ok(tc.expectedAssert);
  });
});

test('Eval Helper: Token estimation metrics', () => {
  const text = 'This is a test legal question for bar candidates.';
  const tokens = estimateTokens(text);
  assert.ok(tokens > 5 && tokens < 20);
});

test('API GET /api/evals/test-cases: Returns all standard test cases', async () => {
  const res = await request('GET', '/api/evals/test-cases');
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.test_cases.length, 7);
});

test('API POST /api/evals/run-single: Executes vector chunk diet benchmark', async () => {
  const res = await request('POST', '/api/evals/run-single', {
    test_id: 'eval_vector_diet'
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.result.passed, true);
  assert.ok(res.json.result.metrics.chunk_token_diet);
  assert.ok(res.json.result.metrics.token_savings.includes('%'));
});

test('API POST /api/evals/run-single: Executes adaptive RAG entity grounding benchmark', async () => {
  const res = await request('POST', '/api/evals/run-single', {
    test_id: 'eval_anti_hallucination'
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.result.passed, true);
  assert.equal(res.json.result.metrics.adaptive_rag_status, 'ACCURATE SOURCE ATTRIBUTION');
});

test('API POST /api/evals/run-single: Executes supplemental web search retrieval benchmark', async () => {
  const res = await request('POST', '/api/evals/run-single', {
    test_id: 'eval_websearch_supplement'
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.result.passed, true);
  assert.equal(res.json.result.metrics.supplemental_search_status, 'AUTONOMOUS WEB RETRIEVAL ACTIVE');
});

test('API POST /api/evals/run-all: Executes full throttled benchmark suite', async () => {
  const res = await request('POST', '/api/evals/run-all');
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.equal(res.json.scorecard.total_tests, 7);
  assert.equal(res.json.scorecard.passed_count, 7);
  assert.equal(res.json.scorecard.overall_score, '100%');
});
