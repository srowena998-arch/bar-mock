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

CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    action_name TEXT NOT NULL,
    model TEXT,
    prompt_snippet TEXT,
    params_json TEXT,
    response_snippet TEXT,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    status TEXT DEFAULT 'SUCCESS',
    details_json TEXT,
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

        // Recent detailed attempts for deep pedagogical analysis
        const recentAttempts = db.prepare(`
            SELECT 
                ca.id,
                ca.question_id,
                ca.user_answer,
                ca.ai_score,
                ca.ai_feedback,
                ca.ai_breakdown,
                ca.attempted_at,
                q.domain,
                q.topic,
                q.type,
                q.interrogatory,
                q.fact_pattern
            FROM candidate_attempts ca
            JOIN questions q ON ca.question_id = q.id
            ORDER BY ca.attempted_at DESC
            LIMIT 8
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

const getCandidateFullEvaluationHistory = () => {
    try {
        const essayAttempts = db.prepare(`
            SELECT 
                ca.id,
                ca.question_id,
                ca.user_answer,
                ca.ai_score,
                ca.ai_feedback,
                ca.ai_breakdown,
                ca.attempted_at,
                q.domain,
                q.topic,
                q.interrogatory,
                q.fact_pattern,
                q.extracted_rule
            FROM candidate_attempts ca
            JOIN questions q ON ca.question_id = q.id
            WHERE q.type = 'essay'
            ORDER BY ca.attempted_at DESC
            LIMIT 15
        `).all();

        const mcqAttempts = db.prepare(`
            SELECT 
                ca.id,
                ca.question_id,
                ca.user_answer,
                ca.ai_score,
                ca.ai_feedback,
                ca.attempted_at,
                q.domain,
                q.topic,
                q.interrogatory as question,
                q.options,
                q.correct_answer,
                q.explanation
            FROM candidate_attempts ca
            JOIN questions q ON ca.question_id = q.id
            WHERE q.type = 'mcq'
            ORDER BY ca.attempted_at DESC
            LIMIT 15
        `).all();

        const essayAvgRow = db.prepare(`
            SELECT AVG(ca.ai_score) as avg_score, COUNT(ca.id) as count 
            FROM candidate_attempts ca 
            JOIN questions q ON ca.question_id = q.id 
            WHERE q.type = 'essay'
        `).get();

        const mcqAvgRow = db.prepare(`
            SELECT AVG(ca.ai_score) as avg_score, COUNT(ca.id) as count 
            FROM candidate_attempts ca 
            JOIN questions q ON ca.question_id = q.id 
            WHERE q.type = 'mcq'
        `).get();

        return {
            total_attempts: (essayAvgRow?.count || 0) + (mcqAvgRow?.count || 0),
            essays: {
                total: essayAvgRow?.count || 0,
                average_score: essayAvgRow && essayAvgRow.avg_score ? Math.round(essayAvgRow.avg_score * 10) / 10 : 0,
                attempts: essayAttempts
            },
            mcqs: {
                total: mcqAvgRow?.count || 0,
                average_score: mcqAvgRow && mcqAvgRow.avg_score ? Math.round(mcqAvgRow.avg_score * 10) / 10 : 0,
                attempts: mcqAttempts
            }
        };
    } catch (e) {
        console.error('Error fetching full candidate evaluation history:', e);
        return {
            total_attempts: 0,
            essays: { total: 0, average_score: 0, attempts: [] },
            mcqs: { total: 0, average_score: 0, attempts: [] }
        };
    }
};

const recordAIAuditLog = ({ event_type, action_name, model, prompt_snippet, params_json, response_snippet, tokens_in = 0, tokens_out = 0, latency_ms = 0, status = 'SUCCESS', details = {} }) => {
    try {
        const id = 'LOG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const stmt = db.prepare(`
            INSERT INTO ai_audit_logs 
            (id, event_type, action_name, model, prompt_snippet, params_json, response_snippet, tokens_in, tokens_out, latency_ms, status, details_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            id,
            event_type || 'AI_CALL',
            action_name || 'Generic AI Action',
            model || getConfig('default_model') || 'qwen3.7-plus',
            typeof prompt_snippet === 'string' ? prompt_snippet.slice(0, 1000) : JSON.stringify(prompt_snippet || '').slice(0, 1000),
            typeof params_json === 'string' ? params_json : JSON.stringify(params_json || {}),
            typeof response_snippet === 'string' ? response_snippet.slice(0, 1500) : JSON.stringify(response_snippet || '').slice(0, 1500),
            tokens_in || (typeof prompt_snippet === 'string' ? Math.ceil(prompt_snippet.length / 4) : 0),
            tokens_out || (typeof response_snippet === 'string' ? Math.ceil(response_snippet.length / 4) : 0),
            latency_ms || 0,
            status || 'SUCCESS',
            JSON.stringify(details || {})
        );
        return id;
    } catch(e) {
        console.error('Error writing to ai_audit_logs:', e);
        return null;
    }
};

const getAIAuditLogs = ({ limit = 100, event_type = null } = {}) => {
    try {
        let sql = 'SELECT * FROM ai_audit_logs';
        const params = [];
        if (event_type && event_type !== 'all') {
            sql += ' WHERE event_type = ?';
            params.push(event_type);
        }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);
        const rows = db.prepare(sql).all(...params);
        return rows.map(r => ({
            ...r,
            params: r.params_json ? (typeof r.params_json === 'string' ? JSON.parse(r.params_json) : r.params_json) : {},
            details: r.details_json ? (typeof r.details_json === 'string' ? JSON.parse(r.details_json) : r.details_json) : {}
        }));
    } catch(e) {
        console.error('Error fetching ai_audit_logs:', e);
        return [];
    }
};

const clearAIAuditLogs = () => {
    try {
        db.prepare('DELETE FROM ai_audit_logs').run();
        return true;
    } catch(e) {
        return false;
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
    getCandidateAnalytics,
    getCandidateFullEvaluationHistory,
    recordAIAuditLog,
    getAIAuditLogs,
    clearAIAuditLogs
};
