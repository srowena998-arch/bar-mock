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
    availableModels: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
    modelFetchSource: '',
    settings: {
      opencode_api_key: '',
      opencode_base_url: 'https://api.deepseek.com',
      default_model: 'deepseek-v4-flash',
      has_key: false
    },
    
    // Toast notification state
    toastVisible: false,
    toastMessage: '',
    
    async init() {
      await this.loadQuestions();
      await this.loadDomains();
      await this.loadSettings();
      await this.loadExtractionProgress();
      await this.loadReadinessAnalytics();
      await this.fetchLiveModels();
      this.startTimer();
      this.loadSavedEssayAnswer();
      
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
    
    async loadQuestions() {
      try {
        const res = await fetch('/api/questions');
        if (res.ok) {
          const data = await res.json();
          const qList = data.questions || [];
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

    async applyRefinedQuestion() {
      if (!this.refinePreviewData || !this.refinePreviewData.refined) return;
      
      try {
        const res = await fetch('/api/update-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: this.refinePreviewData.refined })
        });

        if (res.ok) {
          this.showToastNotification('💾 Refined question committed to SQLite DB!');
          this.showRefineModal = false;
          await this.loadQuestions();
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

    async sendChatMessage(customPrompt = null) {
      const prompt = (customPrompt || this.chatInput || '').trim();
      if (!prompt || this.isChatLoading) return;

      this.chatMessages.push({ role: 'user', content: prompt });
      this.chatInput = '';
      this.isChatLoading = true;

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
    
    showToastNotification(msg) {
      this.toastMessage = msg;
      this.toastVisible = true;
      setTimeout(() => {
        this.toastVisible = false;
      }, 4000);
    }
  }));
});
