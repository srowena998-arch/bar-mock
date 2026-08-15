// Database initialization and repository using Node 24 native node:sqlite
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, 'barmock.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
CREATE TABLE IF NOT EXISTS book_metadata (
    id TEXT PRIMARY KEY,
    book_title TEXT NOT NULL,
    domain TEXT NOT NULL,
    weight_percentage INTEGER NOT NULL,
    total_pages INTEGER NOT NULL,
    total_sections INTEGER NOT NULL,
    extracted_sections INTEGER DEFAULT 0,
    status TEXT DEFAULT 'in_progress',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS syllabus_sections (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    hierarchy_path TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    page_number INTEGER,
    is_extracted INTEGER DEFAULT 0,
    essay_count INTEGER DEFAULT 0,
    mcq_count INTEGER DEFAULT 0,
    extracted_at DATETIME
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    type TEXT NOT NULL, -- 'essay' | 'mcq'
    topic TEXT NOT NULL,
    subject_hierarchy TEXT NOT NULL, -- JSON array
    difficulty TEXT DEFAULT 'hard',
    fact_pattern TEXT,
    interrogatory TEXT,
    suggested_answer TEXT, -- JSON object
    extracted_rule TEXT, -- JSON object
    options TEXT, -- JSON array for MCQ
    correct_answer TEXT,
    explanation TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    ai_score INTEGER,
    ai_feedback TEXT,
    ai_breakdown TEXT, -- JSON {issue, rule, analysis, conclusion}
    attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS eval_run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT DEFAULT 'single',
    test_id TEXT NOT NULL,
    test_name TEXT,
    category TEXT,
    passed INTEGER NOT NULL,
    duration_ms INTEGER,
    metrics TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Set default system configurations if not already set
const getConfig = (key) => {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    return row ? row.value : null;
};

const setConfig = (key, value) => {
    db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run(key, value, value);
};

const recordEvalLog = (log) => {
    try {
        const stmt = db.prepare(`
            INSERT INTO eval_run_logs (run_type, test_id, test_name, category, passed, duration_ms, metrics, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            log.run_type || 'single',
            log.test_id,
            log.test_name || log.name || '',
            log.category || '',
            log.passed ? 1 : 0,
            log.duration_ms || log.durationMs || 0,
            typeof log.metrics === 'object' ? JSON.stringify(log.metrics) : (log.metrics || '{}'),
            typeof log.details === 'object' ? JSON.stringify(log.details) : (log.details || '{}')
        );
    } catch(err) {
        console.error('Failed to record eval log to SQLite:', err.message);
    }
};

const getEvalLogs = (limit = 50) => {
    try {
        const rows = db.prepare(`
            SELECT id, run_type, test_id, test_name, category, passed, duration_ms, metrics, details, created_at
            FROM eval_run_logs
            ORDER BY id DESC
            LIMIT ?
        `).all(limit);

        return rows.map(r => ({
            ...r,
            passed: Boolean(r.passed),
            metrics: r.metrics ? JSON.parse(r.metrics) : {},
            details: r.details ? JSON.parse(r.details) : {}
        }));
    } catch(e) {
        return [];
    }
};

const getLatestEvalMap = () => {
    try {
        const rows = db.prepare(`
            SELECT e1.test_id, e1.test_name, e1.category, e1.passed, e1.duration_ms, e1.metrics, e1.details, e1.created_at
            FROM eval_run_logs e1
            JOIN (
                SELECT test_id, MAX(id) as max_id
                FROM eval_run_logs
                GROUP BY test_id
            ) e2 ON e1.id = e2.max_id
        `).all();

        const map = {};
        for (const r of rows) {
            map[r.test_id] = {
                test_id: r.test_id,
                name: r.test_name,
                category: r.category,
                passed: Boolean(r.passed),
                status: r.passed ? 'PASSED' : 'FAILED',
                duration_ms: r.duration_ms,
                metrics: r.metrics ? JSON.parse(r.metrics) : {},
                details: r.details ? JSON.parse(r.details) : {},
                timestamp: r.created_at
            };
        }
        return map;
    } catch(e) {
        return {};
    }
};

const getCandidateAnalytics = () => {
    try {
        const totalAttempts = db.prepare('SELECT COUNT(*) as count FROM candidate_attempts').get().count;
        const avgScoreRow = db.prepare('SELECT AVG(ai_score) as avg_score FROM candidate_attempts').get();
        const avgScore = avgScoreRow && avgScoreRow.avg_score ? Math.round(avgScoreRow.avg_score * 10) / 10 : 0;
        
        // Domain breakdown
        const domainStats = db.prepare(`
            SELECT 
                q.domain,
                COUNT(ca.id) as attempts,
                ROUND(AVG(ca.ai_score), 1) as avg_score,
                MAX(ca.ai_score) as highest_score
            FROM candidate_attempts ca
            JOIN questions q ON ca.question_id = q.id
            GROUP BY q.domain
            ORDER BY avg_score DESC
        `).all();

        // Recent attempts
        const recentAttempts = db.prepare(`
            SELECT 
                ca.id,
                ca.question_id,
                ca.ai_score,
                ca.ai_feedback,
                ca.attempted_at,
                q.domain,
                q.topic,
                q.type
            FROM candidate_attempts ca
            JOIN questions q ON ca.question_id = q.id
            ORDER BY ca.attempted_at DESC
            LIMIT 5
        `).all();

        // Total questions available in DB
        const totalQuestions = db.prepare('SELECT COUNT(*) as count FROM questions').get().count;
        const essayCount = db.prepare("SELECT COUNT(*) as count FROM questions WHERE type = 'essay'").get().count;
        const mcqCount = db.prepare("SELECT COUNT(*) as count FROM questions WHERE type = 'mcq'").get().count;

        return {
            total_attempts: totalAttempts,
            overall_average: avgScore,
            passing_status: avgScore >= 75 ? 'ON TRACK TO PASS (>=75%)' : (totalAttempts === 0 ? 'NO ATTEMPTS YET' : 'NEEDS REINFORCEMENT (<75%)'),
            domain_breakdown: domainStats,
            recent_attempts: recentAttempts,
            question_bank_stats: {
                total: totalQuestions,
                essays: essayCount,
                mcqs: mcqCount
            }
        };
    } catch (e) {
        console.error('Error fetching candidate analytics:', e);
        return {
            total_attempts: 0,
            overall_average: 0,
            passing_status: 'NO ATTEMPTS YET',
            domain_breakdown: [],
            recent_attempts: [],
            question_bank_stats: { total: 0, essays: 0, mcqs: 0 }
        };
    }
};

if (!getConfig('opencode_base_url')) {
    setConfig('opencode_base_url', 'https://api.opencode.com/v1');
}
if (!getConfig('default_model')) {
    setConfig('default_model', 'deepseek-chat');
}

module.exports = {
    db,
    getConfig,
    setConfig,
    recordEvalLog,
    getEvalLogs,
    getLatestEvalMap,
    getCandidateAnalytics
};
