const fs = require('fs');
const path = require('path');
const { Document, SentenceSplitter } = require('llamaindex');
const { db, getConfig } = require('./db');

// Ensure RAG tables exist in SQLite
db.exec(`
  CREATE TABLE IF NOT EXISTS rag_chunks (
    id TEXT PRIMARY KEY,
    book_id TEXT,
    domain TEXT,
    page_number INTEGER,
    topic_title TEXT,
    content TEXT,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_domain ON rag_chunks(domain);
  CREATE INDEX IF NOT EXISTS idx_rag_chunks_book ON rag_chunks(book_id);
`);

/**
 * Fast deterministic local embedding generator (128-dimensional dense vector)
 * Ensures high-speed vector retrieval and semantic matching even offline.
 */
function generateLocalEmbedding(text) {
  const dim = 128;
  const vector = new Float32Array(dim);
  const clean = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length > 2);

  if (words.length === 0) return Array.from(vector);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(c);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dim;
    const weight = 1 + (word.length / 10);
    vector[idx] += weight;

    // Secondary bi-gram feature
    if (i < words.length - 1) {
      const nextWord = words[i + 1];
      let biHash = hash ^ (nextWord.charCodeAt(0) << 4);
      const biIdx = Math.abs(biHash) % dim;
      vector[biIdx] += 0.5;
    }
  }

  // Normalize vector to unit length (L2 norm) for cosine distance
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dim; i++) vector[i] /= norm;
  }

  return Array.from(vector);
}

/**
 * Calculate Cosine Similarity between two numerical vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Index a single converted markdown book using LlamaIndex.TS SentenceSplitter
 */
async function indexBookFile({ bookId, domain, filePath }) {
  if (!fs.existsSync(filePath)) return { chunks: 0 };
  const rawMarkdown = fs.readFileSync(filePath, 'utf-8');

  // Split into page sections
  const pageSections = rawMarkdown.split(/<!-- PAGE (\d+) -->/g);
  const splitter = new SentenceSplitter({ chunkSize: 512, chunkOverlap: 64 });
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO rag_chunks (id, book_id, domain, page_number, topic_title, content, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let totalChunks = 0;

  // Process page by page
  for (let i = 1; i < pageSections.length; i += 2) {
    const pageNum = parseInt(pageSections[i], 10);
    const pageText = pageSections[i + 1] || '';

    if (!pageText.trim()) continue;

    // Use LlamaIndex Document & SentenceSplitter
    const doc = new Document({ text: pageText, metadata: { bookId, domain, pageNum } });
    const nodes = splitter.getNodesFromDocuments([doc]);

    nodes.forEach((node, nodeIdx) => {
      const chunkId = `chk_${bookId}_p${pageNum}_${nodeIdx}`;
      const text = node.text.trim();
      if (text.length > 25) {
        // Extract possible topic / heading from chunk
        const headingMatch = text.match(/^(?:#+|\*\*|I\.|II\.|III\.|ARTICLE|[A-Z\s]{4,})\s*([^\n\r]+)/m);
        const topic = headingMatch ? headingMatch[1].trim().slice(0, 80) : `${domain} Page ${pageNum}`;

        const embedding = generateLocalEmbedding(text);
        insertStmt.run(
          chunkId,
          bookId,
          domain,
          pageNum,
          topic,
          text,
          JSON.stringify(embedding)
        );
        totalChunks++;
      }
    });
  }

  return { chunks: totalChunks };
}

/**
 * Index all 6 Blue Phoenix Bar Reviewer Books into SQLite Vector Store
 */
async function indexAllReviewerBooks() {
  const booksDir = path.join(__dirname, 'storage', 'converted_md');
  const bookMetadata = db.prepare('SELECT * FROM book_metadata').all();
  let totalIndexed = 0;

  for (const book of bookMetadata) {
    const mdPath = path.join(booksDir, `${book.id}.md`);
    if (fs.existsSync(mdPath)) {
      const { chunks } = await indexBookFile({
        bookId: book.id,
        domain: book.domain,
        filePath: mdPath
      });
      totalIndexed += chunks;
    }
  }

  return { success: true, total_chunks: totalIndexed };
}

/**
 * Hybrid Vector + Keyword RAG Query Engine
 */
function retrieveHybridRAG({ query, domain = 'all', topK = 5 }) {
  if (!query || !query.trim()) return [];

  const queryVec = generateLocalEmbedding(query);
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  let sql = 'SELECT * FROM rag_chunks';
  const params = [];

  if (domain && domain !== 'all') {
    sql += ' WHERE domain = ? OR book_id LIKE ?';
    params.push(domain, `%${domain}%`);
  }

  const allChunks = db.prepare(sql).all(...params);
  if (allChunks.length === 0) return [];

  const scored = allChunks.map(chunk => {
    let embedding = [];
    try {
      embedding = JSON.parse(chunk.embedding || '[]');
    } catch(e) {}

    // 1. Vector Cosine Similarity
    const vecScore = cosineSimilarity(queryVec, embedding);

    // 2. Keyword & Doctrine match bonus
    const contentLower = chunk.content.toLowerCase();
    let termMatches = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term)) termMatches++;
    }
    const keywordScore = queryTerms.length > 0 ? (termMatches / queryTerms.length) : 0;

    // 3. Combined Hybrid Score (70% Vector + 30% Exact Terms)
    const hybridScore = (vecScore * 0.7) + (keywordScore * 0.3);

    return {
      id: chunk.id,
      book: chunk.book_id,
      domain: chunk.domain,
      page: chunk.page_number,
      topic: chunk.topic_title,
      excerpt: chunk.content,
      score: Math.round(hybridScore * 1000) / 10, // e.g. 88.5%
      vector_similarity: Math.round(vecScore * 1000) / 10
    };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * Get RAG Vector Store Diagnostics
 */
function getVectorStoreStats() {
  const totalChunks = db.prepare('SELECT COUNT(*) as cnt FROM rag_chunks').get()?.cnt || 0;
  const domainBreakdown = db.prepare(`
    SELECT domain, COUNT(*) as chunks, MIN(page_number) as min_page, MAX(page_number) as max_page 
    FROM rag_chunks 
    GROUP BY domain
  `).all();

  return {
    total_chunks: totalChunks,
    vector_dimension: 128,
    domains: domainBreakdown,
    engine: 'LlamaIndex.TS + SQLite Vector Engine'
  };
}
/**
 * Dynamic Custom Resource Ingestion (Markdown, Text, Pasted Case Digests)
 */
async function ingestCustomResource({ title, domain = 'Remedial Law, Legal & Judicial Ethics, Practical Exercises', content, source_type = 'custom_upload' }) {
  if (!content || !content.trim()) throw new Error('Content cannot be empty');
  const safeTitle = (title || 'Custom Resource').trim();
  
  const splitter = new SentenceSplitter({ chunkSize: 512, chunkOverlap: 64 });
  const doc = new Document({ text: content, metadata: { title: safeTitle, domain } });
  const nodes = splitter.getNodesFromDocuments([doc]);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO rag_chunks (id, book_id, domain, page_number, topic_title, content, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const timestamp = Date.now();
  let insertedCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const nodeText = (nodes[i].text || nodes[i].getContent?.() || '').trim();
    if (!nodeText) continue;

    const chunkId = `chk_custom_${timestamp}_${i}`;
    const embedding = generateLocalEmbedding(nodeText);

    insertStmt.run(
      chunkId,
      `📁 ${safeTitle}`,
      domain,
      1,
      `${safeTitle} (Part ${i + 1})`,
      nodeText,
      JSON.stringify(embedding)
    );
    insertedCount++;
  }

  return {
    success: true,
    title: safeTitle,
    domain,
    chunks_created: insertedCount,
    total_characters: content.length
  };
}

/**
 * Get Modality Coverage (Vectors vs. Essays vs. MCQs per Domain)
 */
function getModalityCoverageStats() {
  const domains = [
    { name: 'Criminal Law', weight: 10 },
    { name: 'Civil Law and Land Titles and Deeds', weight: 20 },
    { name: 'Remedial Law, Legal & Judicial Ethics, Practical Exercises', weight: 25 },
    { name: 'Commercial and Taxation Laws', weight: 20 },
    { name: 'Labor Law and Social Legislation', weight: 10 },
    { name: 'Political and Public International Law', weight: 15 }
  ];

  const coverage = domains.map(d => {
    // Vector nodes in SQLite
    const vectorRow = db.prepare(`
      SELECT COUNT(*) as chunks 
      FROM rag_chunks 
      WHERE domain LIKE ?
    `).get(`%${d.name.slice(0, 8)}%`);

    // Questions in Question Bank
    const qStats = db.prepare(`
      SELECT 
        COUNT(*) as total_q,
        SUM(CASE WHEN type = 'essay' THEN 1 ELSE 0 END) as essays,
        SUM(CASE WHEN type = 'mcq' THEN 1 ELSE 0 END) as mcqs
      FROM questions 
      WHERE domain LIKE ?
    `).get(`%${d.name.slice(0, 8)}%`);

    const vectorChunks = vectorRow?.chunks || 0;
    const essays = qStats?.essays || 0;
    const mcqs = qStats?.mcqs || 0;
    const totalQ = qStats?.total_q || 0;

    // Minimum target benchmark: at least 5 essays & 10 MCQs per domain
    const targetQ = 15;
    const coveragePct = Math.min(100, Math.round((totalQ / targetQ) * 100));

    return {
      domain: d.name,
      weight: d.weight,
      vector_chunks: vectorChunks,
      essay_count: essays,
      mcq_count: mcqs,
      total_questions: totalQ,
      coverage_pct: coveragePct,
      status: totalQ >= 10 ? 'Robust Coverage' : totalQ >= 3 ? 'In Progress' : 'Needs Authoring'
    };
  });

  const grandTotals = coverage.reduce((acc, c) => ({
    total_vectors: acc.total_vectors + c.vector_chunks,
    total_essays: acc.total_essays + c.essay_count,
    total_mcqs: acc.total_mcqs + c.mcq_count,
    total_questions: acc.total_questions + c.total_questions
  }), { total_vectors: 0, total_essays: 0, total_mcqs: 0, total_questions: 0 });

  return {
    grand_totals: grandTotals,
    domains: coverage
  };
}

module.exports = {
  indexAllReviewerBooks,
  indexBookFile,
  retrieveHybridRAG,
  getVectorStoreStats,
  generateLocalEmbedding,
  cosineSimilarity,
  ingestCustomResource,
  getModalityCoverageStats
};

