// Database Seeder for Book Ingestion Progress and Question Banks
const { db } = require('./db');
const fs = require('node:fs');
const path = require('node:path');

console.log('Seeding SQLite database...');

const manifestPath = path.join(__dirname, 'storage', 'converted_md', 'manifest.json');
const qbDir = path.join(__dirname, 'storage', 'app', 'question_bank');

// 1. Seed Questions from Question Bank JSON files
const domainFiles = [
    { file: 'remedial_law.json', domain: 'Remedial Law, Legal & Judicial Ethics, Practical Exercises', weight: 25, bookKey: '2026 DAY 3 Blue Phoenix Remedial Law Legal & Judicial Ethics with Practical Exercises' },
    { file: 'civil_law.json', domain: 'Civil Law and Land Titles and Deeds', weight: 20, bookKey: '2026 DAY 2 Blue Phoenix Civil Law' },
    { file: 'commercial_tax_law.json', domain: 'Commercial and Taxation Laws', weight: 20, bookKey: '2026 DAY 1 Blue Phoenix Commercial & Taxation Laws' },
    { file: 'political_law.json', domain: 'Political and Public International Law', weight: 15, bookKey: '2026 DAY 1 Blue Phoenix Political & Public Interntional Law' },
    { file: 'criminal_law.json', domain: 'Criminal Law', weight: 10, bookKey: '2026 DAY 3 Blue Phoenix Criminal Law' },
    { file: 'labor_law.json', domain: 'Labor Law and Social Legislation', weight: 10, bookKey: '2026 DAY 2 Blue Phoenix Labor Law & Social Legislations' }
];

let totalQuestions = 0;
const insertQuestionStmt = db.prepare(`
    INSERT INTO questions (
        id, domain, type, topic, subject_hierarchy, difficulty, 
        fact_pattern, interrogatory, suggested_answer, extracted_rule, 
        options, correct_answer, explanation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        fact_pattern = excluded.fact_pattern,
        interrogatory = excluded.interrogatory,
        suggested_answer = excluded.suggested_answer,
        options = excluded.options,
        correct_answer = excluded.correct_answer,
        explanation = excluded.explanation
`);

const extractedTopicsSet = new Set();

domainFiles.forEach(df => {
    const fpath = path.join(qbDir, df.file);
    if (!fs.existsSync(fpath)) return;
    
    const dObj = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
    dObj.items.forEach(item => {
        extractedTopicsSet.add(item.topic.toLowerCase().trim());
        insertQuestionStmt.run(
            item.id,
            dObj.domain,
            item.type,
            item.topic,
            JSON.stringify(item.subject_hierarchy || [dObj.domain]),
            item.difficulty || 'hard',
            item.fact_pattern || null,
            item.interrogatory || null,
            item.suggested_answer ? JSON.stringify(item.suggested_answer) : null,
            item.extracted_rule ? JSON.stringify(item.extracted_rule) : null,
            item.options ? JSON.stringify(item.options) : null,
            item.correct_answer || null,
            item.explanation || null
        );
        totalQuestions++;
    });
});

console.log(`Inserted / Updated ${totalQuestions} questions in questions table.`);

// 2. Parse TOC from converted markdown books and seed book_metadata and syllabus_sections
const insertBookStmt = db.prepare(`
    INSERT INTO book_metadata (
        id, book_title, domain, weight_percentage, total_pages, total_sections, extracted_sections, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        total_pages = excluded.total_pages,
        total_sections = excluded.total_sections,
        extracted_sections = excluded.extracted_sections,
        status = excluded.status
`);

const insertSectionStmt = db.prepare(`
    INSERT INTO syllabus_sections (
        id, book_id, domain, hierarchy_path, topic_title, page_number, is_extracted, essay_count, mcq_count, extracted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        is_extracted = excluded.is_extracted,
        essay_count = excluded.essay_count,
        mcq_count = excluded.mcq_count,
        extracted_at = excluded.extracted_at
`);

domainFiles.forEach(df => {
    const mdPath = path.join(__dirname, 'storage', 'converted_md', `${df.bookKey}.md`);
    if (!fs.existsSync(mdPath)) return;
    
    const content = fs.readFileSync(mdPath, 'utf-8');
    const lines = content.split('\n');
    
    let totalPages = 100;
    const pageMatch = content.match(/\*\*Total Pages\*\*:\s*(\d+)/);
    if (pageMatch) totalPages = parseInt(pageMatch[1], 10);
    
    // Parse TOC bullet points
    let inTOC = false;
    const sections = [];
    
    for (const line of lines) {
        if (line.startsWith('## Table of Contents')) {
            inTOC = true;
            continue;
        }
        if (inTOC && line.startsWith('---')) {
            break; // End of TOC
        }
        if (inTOC && line.trim().startsWith('-')) {
            const m = line.match(/- \*\*(.+?)\*\*(?: \((?:Page|page) (\d+)\))?/);
            if (m) {
                const title = m[1].trim();
                const page = m[2] ? parseInt(m[2], 10) : 1;
                sections.push({ title, page });
            }
        }
    }
    
    let extractedCount = 0;
    sections.forEach((sec, idx) => {
        const secId = `${df.file.replace('.json', '')}_sec_${idx + 1}`;
        const isMatched = Array.from(extractedTopicsSet).some(et => 
            sec.title.toLowerCase().includes(et) || et.includes(sec.title.toLowerCase())
        );
        
        const isExtracted = isMatched ? 1 : 0;
        if (isExtracted) extractedCount++;
        
        insertSectionStmt.run(
            secId,
            df.bookKey,
            df.domain,
            `${df.domain} > ${sec.title}`,
            sec.title,
            sec.page,
            isExtracted,
            isExtracted ? 1 : 0,
            isExtracted ? 1 : 0,
            isExtracted ? new Date().toISOString() : null
        );
    });
    
    insertBookStmt.run(
        df.bookKey,
        df.bookKey,
        df.domain,
        df.weight,
        totalPages,
        sections.length,
        extractedCount,
        extractedCount > 0 ? 'active_extraction' : 'pending'
    );
    
    console.log(`Seeded book '${df.domain}': ${sections.length} syllabus sections (${extractedCount} extracted).`);
});

console.log('Database seeding complete.');
