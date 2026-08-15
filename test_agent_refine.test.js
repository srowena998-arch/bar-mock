// Bar 2026 Mock Reviewer — Automated Test Suite (TDD) for AI SDK Targeted Refinement & Ingestion
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./db');
const { 
  getAIProvider, 
  getModelName,
  scoutBookMarkdownTool, 
  lookupSyllabusTool, 
  commitToDatabaseTool,
  refineQuestionModality,
  runAutonomousIngestAgent
} = require('./agent_engine');

test('TDD: scoutBookMarkdownTool searches converted markdown reviewer pages', async () => {
  const result = await scoutBookMarkdownTool.execute({
    book_id: 'criminal_law',
    page_number: 10
  });

  assert.equal(result.found, true);
  assert.ok(result.excerpt.length > 100);
  assert.ok(result.excerpt.includes('<!-- PAGE 10 -->') || result.excerpt.length > 0);
});

test('TDD: lookupSyllabusTool queries unextracted syllabus sections from SQLite', async () => {
  const result = await lookupSyllabusTool.execute({
    domain: 'all',
    limit: 3
  });

  assert.ok(Array.isArray(result.sections));
  assert.ok(result.sections.length > 0);
  assert.ok(result.sections[0].topic_title);
});

test('TDD: Targeted AI Refinement applies precise modifications to a Bar essay', async () => {
  const sampleQuestion = {
    id: 'TEST-ESSAY-001',
    domain: 'Criminal Law',
    topic: 'Mistake of Fact vs Aberratio Ictus',
    difficulty: 'hard',
    fact_pattern: 'On Jan 5, 2024, Mario fired at a silhouette in the dark, believing it to be a robber, but it turned out to be his brother Carlos.',
    interrogatory: '(a) Is Mario criminally liable for the killing of Carlos?',
    suggested_answer: {
      issue: 'Whether Mario is exempt from criminal liability by reason of mistake of fact.',
      rule: 'Under the doctrine in People v. Ah Chong, mistake of fact is a complete defense when the act would have been lawful had the facts been as the accused believed them to be, without negligence.',
      analysis: 'Mario believed in good faith that his life was in imminent danger, without opportunity for further reflection.',
      conclusion: 'Mario should be acquitted of homicide by reason of mistake of fact.'
    }
  };

  const instruction = 'Modify the interrogatory to include a second question (b) regarding civil liability.';
  
  const refined = await refineQuestionModality({
    original_question: sampleQuestion,
    refinement_instruction: instruction,
    target_field: 'interrogatory'
  });

  assert.ok(refined);
  assert.ok(refined.interrogatory.includes('(b)') || refined.interrogatory.length > sampleQuestion.interrogatory.length);
  // Unchanged fields should remain intact
  assert.equal(refined.topic, sampleQuestion.topic);
  assert.ok(refined.suggested_answer);
});

test('TDD: commitToDatabaseTool inserts and persists refined question to SQLite', async () => {
  const testSectionId = 'test_sec_' + Date.now();
  
  // Insert temporary section
  db.prepare(`
    INSERT INTO syllabus_sections (id, book_id, domain, topic_title, page_number, is_extracted, hierarchy_path)
    VALUES (?, 'criminal_law', 'Criminal Law', 'Test Section for TDD', 50, 0, 'Test Hierarchy')
  `).run(testSectionId);

  const commitRes = await commitToDatabaseTool.execute({
    section_id: testSectionId,
    domain: 'Criminal Law',
    topic: 'Test Section for TDD',
    essay_fact_pattern: 'Sample fact pattern for unit testing.',
    essay_interrogatory: '(a) State the legal rule.',
    suggested_answer: {
      issue: 'Sample issue',
      rule: 'Sample rule',
      analysis: 'Sample analysis',
      conclusion: 'Sample conclusion'
    },
    mcq_question: 'Sample MCQ Question?',
    mcq_options: ['A) Option A', 'B) Option B', 'C) Option C', 'D) Option D'],
    mcq_correct_answer: 'A',
    mcq_explanation: 'Explanation for testing.'
  });

  assert.equal(commitRes.success, true);
  assert.ok(commitRes.essay_id);
  assert.ok(commitRes.mcq_id);

  // Verify in SQLite
  const savedEssay = db.prepare('SELECT * FROM questions WHERE id = ?').get(commitRes.essay_id);
  assert.ok(savedEssay);
  assert.equal(savedEssay.topic, 'Test Section for TDD');

  // Verify section was updated
  const updatedSec = db.prepare('SELECT is_extracted FROM syllabus_sections WHERE id = ?').get(testSectionId);
  assert.equal(updatedSec.is_extracted, 1);
});
