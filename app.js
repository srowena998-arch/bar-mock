// Bar 2026 Mock Reviewer — Frontend Logic with Unified BeautifulUI Design, Diagnostics, and Auto-Ingest
document.addEventListener('alpine:init', () => {
  Alpine.data('barApp', () => ({
    domains: [],
    currentTab: 'dashboard',
    
    // Essay exam state
    selectedDomain: 'all',
    allEssays: [],
    essayList: [],
    currentEssayIdx: 0,
    userAnswer: '',
    showBenchmark: false,
    timerSeconds: 0,
    timerActive: true,
    timerString: '00:00',
    timerInterval: null,
    
    // AI Evaluation state
    isEvaluating: false,
    evaluationResult: null,
    recentAttempts: [],
    
    // Readiness Diagnostics
    readinessData: {
      projected_score: 0,
      is_passing: false,
      total_attempts: 0,
      domain_breakdown: [],
      recent_attempts: []
    },
    
    // MCQ State
    allMcqs: [],
    mcqList: [],
    currentMcqIdx: 0,
    mcqSelectedDomain: 'all',
    mcqAnswers: {},
    mcqScore: 0,
    
    // Extraction Progress & Studio State
    extractionData: {
      summary: { total_books: 6, total_pages: 1951, total_sections: 1046, extracted_sections: 3, overall_percentage: 1, total_essays: 20, total_mcqs: 19 },
      books: [],
      sections: []
    },
    selectedBookFilter: 'all',
    
    // Extraction Studio Active State
    studioDomain: '',
    studioSectionId: '',
    studioSectionText: '',
    studioStrategyGuide: '',
    isGeneratingSection: false,
    isBatchIngesting: false,
    batchLogs: [],
    generatedOutput: null,
    
    // Resources Studio State
    resourcesTab: 'progress', // 'progress' | 'reformation' | 'vector_hub' | 'inspector'
    reformationSearch: '',
    reformationDomain: 'all',
    reformationType: 'all',

    // LlamaIndex.TS & SQLite Vector RAG State
    ragSearchQuery: '',
    ragSearchDomain: 'all',
    ragSearchResults: [],
    isRagSearching: false,
    ragStats: null,

    // AI Quality Benchmarks & Evals State
    evalTestCases: [],
    evalResults: {},
    evalHistoryLogs: [],
    showEvalLogs: false,
    evalScorecard: null,
    isRunningEvals: false,
    activeEvalTestId: null,

    // Chatbot RAG State
    showChatbot: false,
    isChatLoading: false,
    chatInput: '',
    chatMessages: [
      {
        role: 'assistant',
        content: '⚖️ **Greetings, Bar Candidate.** I am **Dean Phoenix**, your Supreme Court Bar Examination Counsel. I have direct RAG access to all 1,951 pages of the 2026 Blue Phoenix Reviewers. Ask me any statutory question, doctrinal requisites, case law analysis, or clarification on Bar syllabus topics!',
        citations: []
      }
    ],

    // Live Stepped Scout & Critique Workbench State
    showScoutModal: false,
    scoutState: 'idle', // 'idle' | 'scouting' | 'streaming' | 'ready'
    scoutDomain: 'all',
    scoutSection: null,
    scoutGenerated: null,
    scoutActiveTab: 'essay', // 'essay' | 'mcq' | 'source'
    scoutCritiquePrompt: '',
    isScoutIterating: false,
    isScoutCommitting: false,
    scoutStreamExcerpt: '',
    scoutLogs: [],

    // Modality Coverage & Dynamic Document Ingestion State
    modalityCoverage: { grand_totals: { total_vectors: 0, total_essays: 0, total_mcqs: 0, total_questions: 0 }, domains: [] },
    showUploadModal: false,
    uploadTitle: '',
    uploadDomain: 'Remedial Law, Legal & Judicial Ethics, Practical Exercises',
    uploadContent: '',
    isUploadingResource: false,

    // Question Bank State & Bulk Actions
    questions: [],
    selectedQuestionIds: [],
    showBulkModal: false,
    bulkPrompt: '',
    isBulkProcessing: false,

    // Resource-Grounded Question Authoring Modal State
    showAuthorModal: false,
    isAuthoringQuestion: false,
    authorMode: 'ai_resource', // 'ai_resource' | 'manual'
    authorResourceTitle: 'all',
    authorDomain: 'Criminal Law',
    authorTopic: '',
    authorModality: 'both', // 'essay' | 'mcq' | 'both'
    authorCount: 1, // 1 | 3 | 5
    authorInstruction: '',
    isGeneratingFromResource: false,
    availableResources: [],
    newQuestion: {
      domain: 'Criminal Law',
      type: 'essay',
      topic: '',
      difficulty: 'hard',
      fact_pattern: '',
      interrogatory: '',
      suggested_answer: '',
      extracted_rule: '',
      options: ['', '', '', ''],
      correct_answer: 'A',
      explanation: ''
    },

    // Refinement Modal State
    showRefineModal: false,
    isRefining: false,
    refineInstruction: '',
    refineTargetField: 'all',
    refinePreviewData: null,
    refineItemType: 'essay',
    activeRefineQuestion: null,

    // Settings Modal State
    showSettingsModal: false,
    isFetchingModels: false,
    isTestingConnection: false,
    connectionResult: null,
    showApiKey: false,
    availableModels: [],
    modelFetchSource: '',
    settings: {
      opencode_api_key: '',
      opencode_model: 'deepseek-v4-flash',
      opencode_base_url: 'https://opencode.ai/api/v1',
      evaluation_strictness: 'lenient',
      has_key: false
    },
    
    // Toast notification state
    toastVisible: false,
    toastMessage: '',
    
    async init() {
      await this.loadQuestions();
      await this.loadDomains();
      await this.loadAvailableResources();
      await this.loadSettings();
      await this.loadExtractionProgress();
      await this.loadModalityCoverage();
      await this.loadReadinessAnalytics();
      await this.loadEvalTestCases();
      await this.loadLatestEvalResults();
      await this.loadEvalHistoryLogs();
      await this.loadVectorStats();
      this.fetchLiveModels();
      this.startTimer();
      this.loadSavedEssayAnswer();
      this.filterEssays();
      this.filterMcqs();

      if (window.location.search.includes('tab=evals') || window.location.search.includes('evals=true')) {
        this.currentTab = 'evals';
      }
      
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },
    
    async loadDomains() {
      try {
        const res = await fetch('/api/domains');
        if (res.ok) {
          const data = await res.json();
          this.domains = data.domains || [];
          if (this.domains.length > 0 && !this.studioDomain) {
            this.studioDomain = this.domains[0].domain;
          }
        }
      } catch (err) {
        console.warn('Domains load error:', err);
      }
    },

    async loadAvailableResources() {
      try {
        const res = await fetch('/api/resources/list');
        if (res.ok) {
          const data = await res.json();
          this.availableResources = data.resources || [];
        }
      } catch (err) {
        console.warn('Resources list error:', err);
      }
    },
    
    async loadQuestions() {
      try {
        const res = await fetch('/api/questions');
        if (res.ok) {
          const data = await res.json();
          const qList = data.questions || [];
          this.questions = qList;
          this.allEssays = qList.filter(q => q.type === 'essay').map(q => ({
            ...q,
            domainName: q.domain,
            domainWeight: this.getDomainWeight(q.domain)
          }));
          this.allMcqs = qList.filter(q => q.type === 'mcq').map(q => ({
            ...q,
            domainName: q.domain
          }));
          this.filterEssays();
          this.filterMcqs();
          if (this.questions.length > 0 && !this.activeRefineQuestion) {
            this.activeRefineQuestion = JSON.parse(JSON.stringify(this.questions[0]));
          }
        }
      } catch (err) {
        console.warn('Questions load error:', err);
      }
    },
    
    getDomainWeight(domainName) {
      const d = this.domains.find(x => x.domain === domainName || x.book_title?.includes(domainName));
      return d ? d.weight_percentage : 15;
    },
    
    async loadSettings() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          this.settings = { ...this.settings, ...data.settings };
        }
      } catch (e) {
        console.warn('Settings load error', e);
      }
    },

    async fetchLiveModels() {
      this.isFetchingModels = true;
      try {
        const queryParams = new URLSearchParams({
          api_key: this.settings.opencode_api_key || '',
          base_url: this.settings.opencode_base_url || ''
        });

        const res = await fetch(`/api/models?${queryParams.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            this.availableModels = data.models;
            this.modelFetchSource = data.source || '';
            if (data.success) {
              this.showToastNotification(`✨ Fetched ${data.models.length} real live models from provider!`);
            } else if (data.error) {
              this.showToastNotification(`ℹ️ ${data.error}`);
            }
          }
        }
      } catch (e) {
        console.warn('Could not fetch models dynamically:', e);
      } finally {
        this.isFetchingModels = false;
      }
    },

    async testConnection() {
      if (!this.settings.opencode_api_key) {
        this.showToastNotification('⚠️ Please enter an API key to test connection.');
        return;
      }

      this.isTestingConnection = true;
      this.connectionResult = null;

      try {
        const res = await fetch('/api/test-connection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: this.settings.opencode_api_key,
            base_url: this.settings.opencode_base_url,
            model: this.settings.default_model
          })
        });

        if (res.ok) {
          const data = await res.json();
          this.connectionResult = data;
          if (data.success) {
            this.showToastNotification(`🟢 Connected! (${data.latency_ms}ms) Model: ${data.model_used}`);
            await this.fetchLiveModels();
          } else {
            this.showToastNotification(`🔴 Connection Failed: ${data.error || 'Check key and URL'}`);
          }
        }
      } catch (e) {
        this.connectionResult = { success: false, error: e.message };
        this.showToastNotification(`🔴 Network Error: ${e.message}`);
      } finally {
        this.isTestingConnection = false;
      }
    },
    
    async saveSettings() {
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });
        if (res.ok) {
          this.showToastNotification('✅ API Settings saved to SQLite!');
          await this.loadSettings();
          await this.fetchLiveModels();
          this.showSettingsModal = false;
        }
      } catch (e) {
        this.showToastNotification('⚠️ Failed to save settings');
      }
    },
    
    async loadExtractionProgress() {
      try {
        const res = await fetch('/api/progress/extraction');
        if (res.ok) {
          this.extractionData = await res.json();
        }
      } catch (e) {
        console.warn('Extraction progress API failed', e);
      }
    },
    
    async loadReadinessAnalytics() {
      try {
        const res = await fetch('/api/analytics/readiness');
        if (res.ok) {
          this.readinessData = await res.json();
        }
      } catch (e) {
        console.warn('Analytics API error', e);
      }
    },

    // LlamaIndex.TS & SQLite Vector Hub Methods
    async loadRagStats() {
      try {
        const res = await fetch('/api/rag/stats');
        if (res.ok) {
          const data = await res.json();
          this.ragStats = data.stats;
        }
      } catch(e) {
        console.warn('RAG stats error', e);
      }
    },

    async performRagSemanticSearch() {
      if (!this.ragSearchQuery.trim()) {
        this.showToastNotification('⚠️ Enter a doctrine or keyword to search across 3,693 nodes');
        return;
      }

      this.isRagSearching = true;
      try {
        const res = await fetch('/api/rag/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: this.ragSearchQuery.trim(),
            domain: this.ragSearchDomain,
            top_k: 8
          })
        });

        if (res.ok) {
          const data = await res.json();
          this.ragSearchResults = data.results || [];
          this.showToastNotification(`🧠 Found ${this.ragSearchResults.length} vector-ranked chunks!`);
        }
      } catch (e) {
        this.showToastNotification('⚠️ Vector search query failed');
      } finally {
        this.isRagSearching = false;
      }
    },

    async reindexVectorStore() {
      this.isRagSearching = true;
      try {
        const res = await fetch('/api/rag/reindex', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.showToastNotification(data.message || 'Indexed books successfully!');
          await this.loadRagStats();
        }
      } catch(e) {
        this.showToastNotification('⚠️ Reindexing failed');
      } finally {
        this.isRagSearching = false;
      }
    },

    authorQuestionFromChunk(chunk) {
      if (!chunk) return;
      this.studioSectionText = chunk.excerpt;
      this.studioStrategyGuide = `Author a strict 2026 Philippine Bar Examination essay and MCQ directly testing the doctrine: "${chunk.topic}" on Page ${chunk.page} of ${chunk.book}.`;
      this.resourcesTab = 'inspector';
      this.showToastNotification(`✨ Loaded chunk from Page ${chunk.page} into Authoring Inspector!`);
    },

    // AI Quality Evaluation & Benchmarking Methods
    async loadEvalTestCases() {
      try {
        const res = await fetch('/api/evals/test-cases');
        if (res.ok) {
          const data = await res.json();
          this.evalTestCases = data.test_cases || [];
        }
      } catch(e) {
        console.warn('Failed to load eval test cases', e);
      }
    },

    async loadLatestEvalResults() {
      try {
        const res = await fetch('/api/evals/latest');
        if (res.ok) {
          const data = await res.json();
          if (data.results && Object.keys(data.results).length > 0) {
            this.evalResults = { ...data.results };
          }
        }
      } catch(e) {
        console.warn('Failed to load latest eval results', e);
      }
    },

    async loadEvalHistoryLogs() {
      try {
        const res = await fetch('/api/evals/history?limit=30');
        if (res.ok) {
          const data = await res.json();
          this.evalHistoryLogs = data.logs || [];
        }
      } catch(e) {
        console.warn('Failed to load eval history logs', e);
      }
    },

    async runSingleEval(testId) {
      this.activeEvalTestId = testId;
      try {
        const res = await fetch('/api/evals/run-single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test_id: testId })
        });
        if (res.ok) {
          const data = await res.json();
          this.evalResults[testId] = data.result;
          this.showToastNotification(`✨ ${data.result.name}: ${data.result.status}`);
          await this.loadEvalHistoryLogs();
        } else {
          this.showToastNotification(`⚠️ Eval failed for ${testId}`);
        }
      } catch (e) {
        this.showToastNotification(`⚠️ Error running eval: ${e.message}`);
      } finally {
        this.activeEvalTestId = null;
      }
    },

    async runAllEvals() {
      this.isRunningEvals = true;
      this.evalScorecard = null;
      this.evalResults = {};
      try {
        const res = await fetch('/api/evals/run-all', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          this.evalScorecard = data.scorecard;
          if (data.scorecard.results) {
            data.scorecard.results.forEach(r => {
              this.evalResults[r.test_id] = r;
            });
          }
          this.showToastNotification(`🎉 All Benchmarks Complete: ${data.scorecard.overall_score} Score!`);
          await this.loadEvalHistoryLogs();
        }
      } catch (e) {
        this.showToastNotification(`⚠️ Benchmark suite error: ${e.message}`);
      } finally {
        this.isRunningEvals = false;
      }
    },
    
    // Extraction Studio Actions
    get studioAvailableSections() {
      if (!this.studioDomain) return this.extractionData.sections || [];
      return (this.extractionData.sections || []).filter(s => s.domain === this.studioDomain);
    },
    
    async fetchStudioSectionText() {
      if (!this.studioSectionId) return;
      try {
        const res = await fetch(`/api/book/section-text?section_id=${encodeURIComponent(this.studioSectionId)}`);
        if (res.ok) {
          const data = await res.json();
          this.studioSectionText = data.source_text || '';
          this.generatedOutput = null;
        }
      } catch (e) {
        console.error('Failed to load section text', e);
      }
    },
    
    async generateSectionModalities() {
      if (!this.studioSectionId) {
        this.showToastNotification('⚠️ Please select a syllabus section first!');
        return;
      }
      
      this.isGeneratingSection = true;
      this.generatedOutput = null;
      
      try {
        const res = await fetch('/api/generate-section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section_id: this.studioSectionId,
            source_text: this.studioSectionText,
            strategy_guide: this.studioStrategyGuide
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          this.generatedOutput = data.generated;
          this.showToastNotification('⚡ High-calibre questions generated! Review & Commit below.');
        } else {
          this.showToastNotification('⚠️ Generation failed. Check server logs.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error during question generation.');
      } finally {
        this.isGeneratingSection = false;
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    async commitGeneratedQuestions() {
      if (!this.generatedOutput || !this.studioSectionId) return;
      
      try {
        const res = await fetch('/api/commit-section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section_id: this.studioSectionId,
            essay: this.generatedOutput.essay,
            mcq: this.generatedOutput.mcq
          })
        });
        
        if (res.ok) {
          this.showToastNotification('💾 Successfully saved to Question Bank & SQLite DB!');
          this.generatedOutput = null;
          await this.loadExtractionProgress();
          await this.loadQuestions();
        } else {
          this.showToastNotification('⚠️ Failed to commit to database.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Error saving to database.');
      }
    },
    
    // Targeted Refinement Actions in Resources Studio
    openRefineModalForQuestion(q) {
      if (!q) return;
      this.activeRefineQuestion = q;
      this.refineItemType = q.type || (q.options ? 'mcq' : 'essay');
      this.refinePreviewData = null;
      this.refineInstruction = '';
      this.refineTargetField = 'all';
      this.showRefineModal = true;
    },

    async executeRefineQuestion() {
      const q = this.activeRefineQuestion || (this.refineItemType === 'mcq' ? this.currentMcq : this.currentEssay);
      if (!q || !q.id) return;
      if (!this.refineInstruction.trim()) {
        this.showToastNotification('⚠️ Please enter an AI refinement instruction.');
        return;
      }

      this.isRefining = true;
      try {
        const res = await fetch('/api/refine-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: q.id,
            question_data: q,
            refinement_instruction: this.refineInstruction,
            target_field: this.refineTargetField
          })
        });

        if (res.ok) {
          const data = await res.json();
          this.refinePreviewData = data;
          this.showToastNotification('✨ Targeted refinement synthesized! Inspect diff below.');
        } else {
          this.showToastNotification('⚠️ Refinement failed.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error during refinement.');
      } finally {
        this.isRefining = false;
      }
    },

    selectQuestionToReform(q) {
      if (!q) return;
      this.activeRefineQuestion = JSON.parse(JSON.stringify(q));
      this.refinePreviewData = null;
      this.refineInstruction = '';
      this.refineItemType = q.type || (q.options ? 'mcq' : 'essay');
      this.refineTargetField = 'all';
    },

    async applyRefinedQuestion() {
      const qToSave = this.refinePreviewData?.refined || this.activeRefineQuestion;
      if (!qToSave || !qToSave.id) return;
      
      try {
        const res = await fetch('/api/update-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: qToSave })
        });

        if (res.ok) {
          this.showToastNotification('💾 Question changes committed to SQLite Question Bank!');
          this.showRefineModal = false;
          this.activeRefineQuestion = JSON.parse(JSON.stringify(qToSave));
          this.refinePreviewData = null;
          await this.loadQuestions();
          await this.loadModalityCoverage();
        } else {
          this.showToastNotification('⚠️ Failed to commit refined question.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Error saving refined question.');
      }
    },

    // RAG Bar Counsel Chatbot Actions
    toggleChatbot() {
      this.showChatbot = !this.showChatbot;
    },

    formatMarkdown(raw) {
      if (!raw) return '';
      let str = String(raw);

      // Escape basic HTML entities to avoid broken tags, while preserving structure
      str = str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Format Blockquotes (handles lines starting with &gt; or >)
      str = str.replace(/^(&gt;|>)\s*(.+)$/gm, '<blockquote class="border-l-3 border-amber-500 bg-amber-50/70 text-slate-800 pl-3 py-1.5 my-2 rounded-r italic font-serif text-[11.5px] leading-relaxed">$2</blockquote>');

      // Format Headings
      str = str.replace(/^###\s+(.+)$/gm, '<h5 class="font-bold text-slate-900 text-xs mt-2.5 mb-1 flex items-center gap-1.5">$1</h5>');
      str = str.replace(/^##\s+(.+)$/gm, '<h4 class="font-bold text-slate-900 text-sm mt-3 mb-1.5 flex items-center gap-1.5">$1</h4>');
      str = str.replace(/^#\s+(.+)$/gm, '<h3 class="font-bold text-slate-900 text-base mt-3.5 mb-2 flex items-center gap-1.5">$1</h3>');

      // Format Bold & Italic
      str = str.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-slate-950">$1</strong>');
      str = str.replace(/\*(.+?)\*/g, '<em class="italic text-slate-700">$1</em>');

      // Format Inline Code
      str = str.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-100 text-amber-900 border border-slate-200/60 font-mono text-[10.5px] font-semibold">$1</code>');

      // Format Numbered Lists (e.g. "1. Step description")
      str = str.replace(/^(\d+)\.\s+(.+)$/gm, '<div class="flex items-start gap-2 my-1 pl-0.5"><span class="font-bold font-mono text-[9.5px] text-amber-800 bg-amber-100/80 border border-amber-200/60 px-1.5 py-0.5 rounded mt-0.5 shrink-0">$1</span><span class="text-slate-800 leading-relaxed">$2</span></div>');

      // Format Bullet Lists (e.g. "• Item" or "- Item")
      str = str.replace(/^[•\-\*]\s+(.+)$/gm, '<div class="flex items-start gap-2 my-1 pl-0.5"><span class="text-amber-600 font-bold shrink-0 leading-tight">•</span><span class="text-slate-800 leading-relaxed">$1</span></div>');

      // Convert double newlines into clean paragraph gaps
      str = str.replace(/\n\n+/g, '<div class="h-2"></div>');
      str = str.replace(/\n/g, '<br/>');

      return str;
    },

    scrollChatToBottom() {
      setTimeout(() => {
        const container = document.getElementById('chatContainer');
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        }
      }, 50);
    },

    chatThinkingStep: 'Identifying Task & Intent...',
    chatDetectedIntent: 'RAG Reviewer Knowledge Retrieval',

    async sendChatMessage(customPrompt = null) {
      const prompt = (customPrompt || this.chatInput || '').trim();
      if (!prompt || this.isChatLoading) return;

      this.chatMessages.push({ role: 'user', content: prompt });
      this.chatInput = '';
      this.isChatLoading = true;

      // Identify Query Task & Intent for BeautifulUI Thought Indicator
      const lower = prompt.toLowerCase();
      if (lower.includes('progress') || lower.includes('score') || lower.includes('doing') || lower.includes('stats') || lower.includes('weak') || lower.includes('attempt') || lower.includes('past answer') || lower.includes('previous essay')) {
        this.chatDetectedIntent = 'Candidate Performance & Readiness Diagnostic';
        this.chatThinkingStep = 'Querying SQLite Candidate Attempts & Evaluating Past Answers...';
      } else if (lower.includes('reform') || lower.includes('update') || lower.includes('how to') || lower.includes('grade') || lower.includes('rubric') || lower.includes('setting')) {
        this.chatDetectedIntent = 'Platform Guide & System Navigation';
        this.chatThinkingStep = 'Retrieving Interactive Platform Workflows & Steps...';
      } else {
        this.chatDetectedIntent = 'Reviewer Doctrine & Hybrid RAG Retrieval';
        this.chatThinkingStep = 'Searching 1,951 Reviewer Pages & Supreme Court Jurisprudence...';
      }

      this.scrollChatToBottom();

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: this.chatMessages,
            domain: this.activeDomain
          })
        });

        if (res.ok) {
          const data = await res.json();
          this.chatMessages.push({
            role: 'assistant',
            content: data.reply,
            citations: data.citations || []
          });
        } else {
          this.chatMessages.push({
            role: 'assistant',
            content: '⚠️ Dean Phoenix encountered a connection issue. Please check your OpenCode Go API key in Settings.',
            citations: []
          });
        }
      } catch (err) {
        this.chatMessages.push({
          role: 'assistant',
          content: '⚠️ Network error while consulting the Bar Reviewer knowledge base.',
          citations: []
        });
      } finally {
        this.isChatLoading = false;
        this.scrollChatToBottom();
      }
    },

    askSuggestedQuestion(q) {
      this.sendChatMessage(q);
    },

    clearChat() {
      this.chatMessages = [
        {
          role: 'assistant',
          content: '⚖️ **Chat session reset.** How can I assist you in mastering the 2026 Bar syllabus today?',
          citations: []
        }
      ];
      this.scrollChatToBottom();
    },

    // Modality Coverage Stats Loader
    async loadModalityCoverage() {
      try {
        const res = await fetch('/api/resources/modality-coverage');
        if (res.ok) {
          const data = await res.json();
          if (data.stats) this.modalityCoverage = data.stats;
        }
      } catch (err) {
        console.warn('Failed to load modality coverage:', err);
      }
    },

    // Custom Resource Ingestion Actions
    openUploadModal() {
      this.uploadTitle = '';
      this.uploadContent = '';
      this.uploadDomain = this.activeDomain !== 'all' ? this.activeDomain : 'Remedial Law, Legal & Judicial Ethics, Practical Exercises';
      this.showUploadModal = true;
    },

    async uploadCustomResource() {
      if (!this.uploadContent.trim()) {
        this.showToastNotification('⚠️ Please enter or paste document content to ingest.');
        return;
      }

      this.isUploadingResource = true;
      try {
        const res = await fetch('/api/resources/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: this.uploadTitle.trim() || 'Custom Document',
            domain: this.uploadDomain,
            content: this.uploadContent.trim()
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToastNotification(`🎉 Successfully indexed ${data.result.chunks_created} vector chunks into SQLite!`);
          this.showUploadModal = false;
          await this.loadModalityCoverage();
          await this.loadVectorStats();
          this.vectorSearchQuery = this.uploadTitle.trim() || '';
          if (this.vectorSearchQuery) await this.executeVectorSearch();
        } else {
          this.showToastNotification(`⚠️ Ingestion failed: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        this.showToastNotification('⚠️ Network error during document ingestion.');
      } finally {
        this.isUploadingResource = false;
      }
    },

    // Handle File Drop / Select for Document Upload
    handleFileUpload(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      this.uploadTitle = file.name.replace(/\.[^/.]+$/, '');
      const reader = new FileReader();
      reader.onload = (e) => {
        this.uploadContent = e.target.result || '';
      };
      reader.readAsText(file);
    },

    // Interactive Question Authoring Modal
    openAuthorModal(chunk = null) {
      if (chunk) {
        this.newQuestion = {
          domain: chunk.domain || 'Criminal Law',
          type: 'essay',
          topic: chunk.topic || 'Supreme Court Jurisprudence',
          difficulty: 'hard',
          fact_pattern: `Fact Pattern based on ${chunk.book} (Page ${chunk.page}):\n${chunk.excerpt ? chunk.excerpt.slice(0, 400) + '...' : ''}`,
          interrogatory: `What is the legal liability and governing Supreme Court doctrine under Philippine law?`,
          suggested_answer: 'ALAC Breakdown:\nAnswer: ...\nLegal Basis: ...\nApplication: ...\nConclusion: ...',
          extracted_rule: 'Under Philippine law, this requires compliance with established statutory requisites.',
          options: ['Option A (Plausible distractor)', 'Option B (Correct answer)', 'Option C (Subtle exception)', 'Option D (Procedural distinction)'],
          correct_answer: 'B',
          explanation: `Directly grounded in ${chunk.book} (Page ${chunk.page}).`
        };
      } else {
        this.newQuestion = {
          domain: this.activeDomain !== 'all' ? this.activeDomain : 'Criminal Law',
          type: 'essay',
          topic: 'Target Legal Doctrine',
          difficulty: 'hard',
          fact_pattern: '',
          interrogatory: '',
          suggested_answer: '',
          extracted_rule: '',
          options: ['', '', '', ''],
          correct_answer: 'A',
          explanation: ''
        };
      }
      this.showAuthorModal = true;
    },

    toggleSelectAllQuestions(filteredList) {
      if (!filteredList || filteredList.length === 0) return;
      const allSelected = filteredList.every(q => this.selectedQuestionIds.includes(q.id));
      if (allSelected) {
        const idsToRemove = new Set(filteredList.map(q => q.id));
        this.selectedQuestionIds = this.selectedQuestionIds.filter(id => !idsToRemove.has(id));
      } else {
        const newIds = new Set([...this.selectedQuestionIds, ...filteredList.map(q => q.id)]);
        this.selectedQuestionIds = Array.from(newIds);
      }
    },

    toggleSelectQuestion(id) {
      const idx = this.selectedQuestionIds.indexOf(id);
      if (idx > -1) {
        this.selectedQuestionIds.splice(idx, 1);
      } else {
        this.selectedQuestionIds.push(id);
      }
    },

    isQuestionSelected(id) {
      return this.selectedQuestionIds.includes(id);
    },

    async executeBulkRefine() {
      if (this.selectedQuestionIds.length === 0) {
        this.showToastNotification('⚠️ Please select at least one question to refine.');
        return;
      }
      if (!this.bulkPrompt.trim()) {
        this.showToastNotification('⚠️ Please enter a bulk refinement prompt.');
        return;
      }

      this.isBulkProcessing = true;
      try {
        const res = await fetch('/api/questions/bulk-refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: this.selectedQuestionIds,
            instruction: this.bulkPrompt,
            target_field: 'all'
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToastNotification(`✨ Successfully refined ${data.updated_count} question(s) in bulk!`);
          this.showBulkModal = false;
          this.bulkPrompt = '';
          this.selectedQuestionIds = [];
          await this.loadQuestions();
        } else {
          this.showToastNotification(`⚠️ Bulk refinement failed: ${data.error || 'Unknown error'}`);
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error during bulk refinement.');
      } finally {
        this.isBulkProcessing = false;
      }
    },

    async executeBulkDelete() {
      if (this.selectedQuestionIds.length === 0) return;
      if (!confirm(`Are you sure you want to delete ${this.selectedQuestionIds.length} selected question(s) from SQLite?`)) {
        return;
      }

      this.isBulkProcessing = true;
      try {
        const res = await fetch('/api/questions/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: this.selectedQuestionIds })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToastNotification(`🗑️ Deleted ${data.deleted_count} question(s)!`);
          const deletedSet = new Set(this.selectedQuestionIds);
          this.selectedQuestionIds = [];
          if (this.activeRefineQuestion && deletedSet.has(this.activeRefineQuestion.id)) {
            this.activeRefineQuestion = null;
          }
          await this.loadQuestions();
          await this.loadModalityCoverage();
        } else {
          this.showToastNotification('⚠️ Bulk deletion failed.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Error deleting questions.');
      } finally {
        this.isBulkProcessing = false;
      }
    },

    async generateFromResource() {
      this.isGeneratingFromResource = true;
      try {
        const res = await fetch('/api/author-from-resource', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resource_title: this.authorResourceTitle,
            domain: this.authorDomain,
            topic: this.authorTopic.trim(),
            modality: this.authorModality,
            count: parseInt(this.authorCount) || 1,
            instruction: this.authorInstruction.trim()
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          this.showToastNotification(`🚀 ${data.message}`);
          this.showAuthorModal = false;
          this.authorTopic = '';
          this.authorInstruction = '';
          await this.loadQuestions();
          await this.loadModalityCoverage();
          if (data.questions && data.questions.length > 0) {
            const firstCreated = this.questions.find(q => q.id === data.questions[0].id);
            if (firstCreated) {
              this.selectQuestionToReform(firstCreated);
            }
          }
        } else {
          this.showToastNotification(`⚠️ Generation failed: ${data.error || 'Unknown error'}`);
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error generating questions from resource.');
      } finally {
        this.isGeneratingFromResource = false;
      }
    },

    // Autonomous Batch Ingestion
    async runBatchAutoIngest(count = 3) {
      this.isBatchIngesting = true;
      this.batchLogs.unshift(`[${new Date().toLocaleTimeString()}] 🚀 Initiating autonomous scout for ${count} unextracted sections in ${this.studioDomain || 'all subjects'}...`);
      
      try {
        const res = await fetch('/api/auto-ingest-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch_size: count,
            domain: this.studioDomain === 'all' ? null : this.studioDomain
          })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.ingested_count > 0) {
            data.sections.forEach(s => {
              this.batchLogs.unshift(`[${new Date().toLocaleTimeString()}] ✅ Synthesized & Ingested: "${s.topic}" (${s.domain})`);
            });
            this.showToastNotification(`🎉 Ingested ${data.ingested_count} sections automatically!`);
            await this.loadExtractionProgress();
            await this.loadQuestions();
          } else {
            this.batchLogs.unshift(`[${new Date().toLocaleTimeString()}] ℹ️ ${data.message}`);
            this.showToastNotification(data.message);
          }
        }
      } catch (e) {
        this.batchLogs.unshift(`[${new Date().toLocaleTimeString()}] ⚠️ Auto-ingest batch failed: ${e.message}`);
      } finally {
        this.isBatchIngesting = false;
      }
    },
    
    filterEssays() {
      if (this.selectedDomain === 'all') {
        this.essayList = [...this.allEssays];
      } else {
        this.essayList = this.allEssays.filter(q => q.domainName === this.selectedDomain);
      }
      this.currentEssayIdx = 0;
      this.showBenchmark = false;
      this.evaluationResult = null;
      this.loadSavedEssayAnswer();
      this.loadRecentAttempts();
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },
    
    filterMcqs() {
      if (this.mcqSelectedDomain === 'all') {
        this.mcqList = [...this.allMcqs];
      } else {
        this.mcqList = this.allMcqs.filter(q => q.domainName === this.mcqSelectedDomain);
      }
      this.currentMcqIdx = 0;
      this.$nextTick(() => {
        if (window.lucide) window.lucide.createIcons();
      });
    },
    
    get currentEssay() {
      return this.essayList[this.currentEssayIdx] || {};
    },
    
    get currentMcq() {
      return this.mcqList[this.currentMcqIdx] || {};
    },
    
    get wordCount() {
      if (!this.userAnswer || !this.userAnswer.trim()) return 0;
      return this.userAnswer.trim().split(/\s+/).length;
    },
    
    get filteredSections() {
      if (this.selectedBookFilter === 'all') {
        return this.extractionData.sections || [];
      }
      return (this.extractionData.sections || []).filter(s => s.domain === this.selectedBookFilter);
    },
    
    loadSavedEssayAnswer() {
      const q = this.currentEssay;
      if (q && q.id) {
        this.userAnswer = localStorage.getItem(`bar2026_essay_${q.id}`) || '';
      } else {
        this.userAnswer = '';
      }
    },
    
    saveAnswer() {
      const q = this.currentEssay;
      if (q && q.id) {
        localStorage.setItem(`bar2026_essay_${q.id}`, this.userAnswer);
      }
    },
    
    async loadRecentAttempts() {
      const q = this.currentEssay;
      if (!q || !q.id) return;
      try {
        const res = await fetch(`/api/attempts/${q.id}`);
        if (res.ok) {
          const data = await res.json();
          this.recentAttempts = data.attempts || [];
        }
      } catch (e) {
        this.recentAttempts = [];
      }
    },
    
    prevEssay() {
      if (this.currentEssayIdx > 0) {
        this.currentEssayIdx--;
        this.showBenchmark = false;
        this.evaluationResult = null;
        this.loadSavedEssayAnswer();
        this.loadRecentAttempts();
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    nextEssay() {
      if (this.currentEssayIdx < this.essayList.length - 1) {
        this.currentEssayIdx++;
        this.showBenchmark = false;
        this.evaluationResult = null;
        this.loadSavedEssayAnswer();
        this.loadRecentAttempts();
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    startDrill(domainName) {
      this.selectedDomain = domainName;
      this.filterEssays();
      this.currentTab = 'essay';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },
    
    startWeightedExam() {
      this.selectedDomain = 'all';
      this.filterEssays();
      this.currentTab = 'essay';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
    },
    
    // In-App Direct AI Grading
    async gradeWithAI() {
      const q = this.currentEssay;
      const text = this.userAnswer.trim();
      
      if (!text) {
        this.showToastNotification('⚠️ Please write your answer in the workspace first!');
        return;
      }
      
      this.isEvaluating = true;
      this.evaluationResult = null;
      
      try {
        const res = await fetch('/api/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_id: q.id,
            user_answer: text
          })
        });
        
        const data = await res.json();

        if (res.ok && data.success && data.evaluation) {
          this.evaluationResult = data.evaluation;
          this.showToastNotification(`✨ Graded: ${data.evaluation.score}% / 100% (Saved to DB)`);
          await this.loadRecentAttempts();
          await this.loadReadinessAnalytics();
        } else {
          const errorMsg = data.error || 'AI Evaluation failed. Please check your API key in Settings ⚙️';
          this.showToastNotification(`⚠️ ${errorMsg}`);
        }
      } catch (err) {
        console.error('Grade error:', err);
        this.showToastNotification('⚠️ Network error connecting to evaluation service.');
      } finally {
        this.isEvaluating = false;
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    copyEvaluationPrompt() {
      const q = this.currentEssay;
      const text = this.userAnswer.trim();
      if (!text) {
        this.showToastNotification('⚠️ Please write your answer in the workspace first!');
        return;
      }
      
      const ans = q.suggested_answer || {};
      const hierarchy = q.subject_hierarchy ? (Array.isArray(q.subject_hierarchy) ? q.subject_hierarchy.join(' > ') : q.subject_hierarchy) : q.domainName;
      
      const prompt = `[ROLE]
You are a distinguished Supreme Court Bar Examiner grading a candidate's answer for the 2026 Philippine Bar Examination.

[BAR EXAMINATION SUBJECT & TOPIC]
Subject: ${q.domainName}
Topic: ${q.topic}
Hierarchy: ${hierarchy}

[FACT PATTERN]
${q.fact_pattern}

[INTERROGATORY]
${q.interrogatory}

[OFFICIAL BENCHMARK SOLUTION (IRAC / ALAC)]
- ISSUE / ANSWER:
${ans.issue || 'Direct resolution of the interrogatory'}

- RULE / LEGAL BASIS:
${ans.rule || 'Statutory provisions, elements, and jurisprudence'}

- ANALYSIS / APPLICATION:
${ans.analysis || 'Application of legal elements to the specific facts'}

- CONCLUSION:
${ans.conclusion || 'Definite final answer'}

[CANDIDATE'S SUBMITTED ANSWER]
${text}

[GRADING METHODOLOGY & RUBRIC]
Grade the candidate's answer from 0% to 100%. Candidates may write in either standard IRAC or ALAC / CRAC:
1. LEGAL ISSUE / DIRECT ANSWER (10%): Categorical, unambiguous answer.
2. LEGAL BASIS & STATUTORY RULE (30%): Accurate citations, statutes, and elements.
3. FACTUAL APPLICATION & ANALYSIS (50%): Methodical application to the facts (heavily penalize shotgun answers).
4. CONCLUSION (10%): Decisive closing statement.

[OUTPUT EVALUATION FORMAT]
• Numerical Grade: [X] / 100%
• Component Breakdown: Issue/Answer [x/10], Legal Basis [x/30], Application [x/50], Conclusion [x/10]
• Strong Points: (1-2 sentences)
• Critical Deficiencies: (Exact elements or citations missed)
• Model Polish / Suggested Phrasing: (How to rephrase for 95%+)`;

      navigator.clipboard.writeText(prompt).then(() => {
        this.showToastNotification('📋 Full Prompt Copied to Clipboard!');
      }).catch(() => {
        this.showToastNotification('⚠️ Clipboard write failed.');
      });
    },
    
    // MCQ methods
    selectMcq(letter) {
      const q = this.currentMcq;
      if (this.mcqAnswers[q.id]) return;
      
      const isCorrect = (letter === q.correct_answer);
      this.mcqAnswers[q.id] = { selected: letter, isCorrect };
      if (isCorrect) this.mcqScore++;
    },
    
    prevMcq() {
      if (this.currentMcqIdx > 0) {
        this.currentMcqIdx--;
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    nextMcq() {
      if (this.currentMcqIdx < this.mcqList.length - 1) {
        this.currentMcqIdx++;
        this.$nextTick(() => { if (window.lucide) window.lucide.createIcons(); });
      }
    },
    
    startTimer() {
      if (this.timerInterval) clearInterval(this.timerInterval);
      this.timerInterval = setInterval(() => {
        if (this.timerActive) {
          this.timerSeconds++;
          const mins = String(Math.floor(this.timerSeconds / 60)).padStart(2, '0');
          const secs = String(this.timerSeconds % 60).padStart(2, '0');
          this.timerString = `${mins}:${secs}`;
        }
      }, 1000);
    },
    
    // Live Stepped Scout & Critique Workbench
    async openScoutModal(domain = 'all') {
      this.scoutDomain = domain;
      this.showScoutModal = true;
      this.scoutState = 'scouting';
      this.scoutSection = null;
      this.scoutGenerated = null;
      this.scoutActiveTab = 'essay';
      this.scoutCritiquePrompt = '';
      this.scoutStreamExcerpt = '';
      this.scoutLogs = [
        `[${new Date().toLocaleTimeString()}] 🔍 Searching 2026 Supreme Court Syllabus sections in ${domain === 'all' ? 'all 6 domains' : domain}...`
      ];

      try {
        const res = await fetch('/api/scout-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain })
        });

        if (!res.ok) {
          const err = await res.json();
          this.showToastNotification(`⚠️ Scouting failed: ${err.error || 'Unknown error'}`);
          this.showScoutModal = false;
          return;
        }

        const data = await res.json();
        this.scoutSection = data.section;
        this.scoutGenerated = data.generated;

        this.scoutLogs.push(`[${new Date().toLocaleTimeString()}] 📖 Discovered section: "${data.section.topic_title}" (Page ${data.section.page_number})`);
        this.scoutLogs.push(`[${new Date().toLocaleTimeString()}] 🧠 Streaming Blue Phoenix Reviewer excerpts and generating modalities...`);
        this.scoutState = 'streaming';

        // Streaming text typewriter effect
        const fullExcerpt = data.section.excerpt || 'Reviewer doctrine text loaded.';
        let charIndex = 0;
        const step = Math.max(12, Math.floor(fullExcerpt.length / 20));
        
        const streamInterval = setInterval(() => {
          charIndex += step;
          this.scoutStreamExcerpt = fullExcerpt.slice(0, charIndex);
          if (charIndex >= fullExcerpt.length) {
            clearInterval(streamInterval);
            this.scoutStreamExcerpt = fullExcerpt;
            this.scoutLogs.push(`[${new Date().toLocaleTimeString()}] ✨ ALAC Essay & MCQ generated! Ready for candidate review.`);
            this.scoutState = 'ready';
          }
        }, 30);

      } catch (err) {
        this.showToastNotification('⚠️ Network error while scouting.');
        this.showScoutModal = false;
      }
    },

    async iterateScoutPreview() {
      if (!this.scoutCritiquePrompt.trim()) {
        this.showToastNotification('⚠️ Please enter a critique or prompt.');
        return;
      }
      this.isScoutIterating = true;
      try {
        const res = await fetch('/api/scout-iterate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section: this.scoutSection,
            generated: this.scoutGenerated,
            critique: this.scoutCritiquePrompt
          })
        });

        if (res.ok) {
          const data = await res.json();
          this.scoutGenerated = data.generated;
          this.scoutLogs.push(`[${new Date().toLocaleTimeString()}] ⚡ Refined with critique: "${this.scoutCritiquePrompt}"`);
          this.scoutCritiquePrompt = '';
          this.showToastNotification('✨ Questions re-synthesized with your critique!');
        } else {
          this.showToastNotification('⚠️ Refinement failed.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Error refining preview.');
      } finally {
        this.isScoutIterating = false;
      }
    },

    async commitScoutPreview() {
      if (!this.scoutGenerated) return;
      this.isScoutCommitting = true;
      try {
        const res = await fetch('/api/scout-commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            section_id: this.scoutSection?.id,
            essay: this.scoutGenerated.essay,
            mcq: this.scoutGenerated.mcq
          })
        });

        if (res.ok) {
          this.showToastNotification('🎉 Successfully committed Essay & MCQ to Question Bank!');
          this.showScoutModal = false;
          await this.loadQuestions();
          await this.loadModalityCoverage();
          await this.loadExtractionProgress();
        } else {
          this.showToastNotification('⚠️ Error committing question.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error committing question.');
      } finally {
        this.isScoutCommitting = false;
      }
    },

    async resetCandidateProgress() {
      if (!confirm('Are you sure you want to reset all your candidate practice attempt history? This will reset domain analytics back to fresh status.')) {
        return;
      }
      try {
        const res = await fetch('/api/progress/reset', { method: 'POST' });
        if (res.ok) {
          this.showToastNotification('🔄 Candidate attempts reset to fresh clean status!');
          await this.loadReadinessAnalytics();
          await this.loadQuestions();
        } else {
          this.showToastNotification('⚠️ Reset failed.');
        }
      } catch (e) {
        this.showToastNotification('⚠️ Network error resetting progress.');
      }
    },

    showToastNotification(msg) {
      this.toastMessage = msg;
      this.toastVisible = true;
      setTimeout(() => {
        this.toastVisible = false;
      }, 4000);
    }
  }));
});
