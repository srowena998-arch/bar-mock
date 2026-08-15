const test = require('node:test');
const assert = require('node:assert/strict');
const { generateLocalEmbedding, cosineSimilarity, retrieveHybridRAG, getVectorStoreStats } = require('./rag_indexer');

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

test('Vector Math: Unit norm and cosine similarity metrics', () => {
  const vec1 = generateLocalEmbedding('Mistake of fact Ah Chong Revised Penal Code');
  const vec2 = generateLocalEmbedding('Ah Chong doctrine on mistake of fact under criminal law');
  const vec3 = generateLocalEmbedding('Piercing the corporate veil under Corporation Code');

  assert.equal(vec1.length, 128);
  assert.equal(vec2.length, 128);

  const simRelated = cosineSimilarity(vec1, vec2);
  const simUnrelated = cosineSimilarity(vec1, vec3);

  assert.ok(simRelated > simUnrelated, 'Related doctrines must have higher cosine similarity');
  assert.ok(simRelated >= 0.5, 'Semantically overlapping queries must score high cosine similarity');
});

test('Vector Store: 3,693 indexed chunks across 6 Reviewer books', () => {
  const stats = getVectorStoreStats();
  assert.ok(stats.total_chunks >= 3000, 'Must have at least 3,000 indexed LlamaIndex chunks');
  assert.equal(stats.vector_dimension, 128);
  assert.equal(stats.domains.length, 6, 'All 6 Bar domains must be indexed');
});

test('API GET /api/rag/stats: Returns vector metrics and domain breakdown', async () => {
  const res = await request('GET', '/api/rag/stats');
  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.ok(res.json.stats.total_chunks >= 3000);
  assert.equal(res.json.stats.domains.length, 6);
});

test('API POST /api/rag/query: Semantic vector retrieval with cosine scoring', async () => {
  const res = await request('POST', '/api/rag/query', {
    query: 'Res Judicata requisites bar by prior judgment',
    domain: 'all',
    top_k: 5
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.success, true);
  assert.ok(res.json.results.length > 0);

  const first = res.json.results[0];
  assert.ok(first.score > 0);
  assert.ok(first.page > 0);
  assert.ok(first.book);
  assert.ok(first.excerpt.length > 50);
});

test('API POST /api/rag/query: Edge cases (empty query, specific domain filtering)', async () => {
  // Empty query
  const resEmpty = await request('POST', '/api/rag/query', { query: '   ' });
  assert.equal(resEmpty.status, 400);

  // Domain filtered query
  const resFiltered = await request('POST', '/api/rag/query', {
    query: 'warrantless arrest in flagrante delicto',
    domain: 'Criminal Law',
    top_k: 3
  });
  assert.equal(resFiltered.status, 200);
  resFiltered.json.results.forEach(r => {
    assert.equal(r.domain, 'Criminal Law');
  });
});
