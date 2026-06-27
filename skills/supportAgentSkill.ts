/**
 * supportAgentSkill.ts
 *
 * Replaces Intercom/Zendesk-lite (~$74/mo) for small business support.
 * Provides a fully local support knowledge-base (stored in localStorage),
 * a semantic word-overlap search, and a self-contained embeddable FAQ widget.
 *
 * Tools:
 *   - save_support_kb        Add a Q&A pair to the support knowledge base
 *   - answer_support_question  Find the best matching answers for a question
 *   - list_support_kb        List all KB entries, optionally filtered by category
 *   - export_support_widget  Generate a standalone HTML FAQ widget snippet
 *
 * No external dependencies. All data lives in localStorage under 'echo_support_kb'.
 */

import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';

const KB_KEY = 'echo_support_kb';

// Common question words that inflate scores without adding topical signal
const STOPWORDS = new Set([
    'the','and','for','that','this','with','from','how','what','why','when','who',
    'can','you','your','are','was','not','but','have','been','will','does','did',
    'has','had','its','they','them','our','their','would','could','should','about',
    'into','which','also','just','all','any','more','use','used','set','get','put',
    'let','see','come','some','such','than','then','only','make','made','very',
    'each','most','over','both','need','help','want','know','find','work','used',
    'do','my','me','we','it','in','on','at','by','to','as','of','or','if','an','be',
]);

function scoreWords(text: string): string[] {
    return text.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

interface KBEntry {
    id: string;
    question: string;
    answer: string;
    category: string;
    tags: string[];
    createdAt: number;
}

function loadKB(): KBEntry[] {
    try {
        const raw = localStorage.getItem(KB_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveKB(kb: KBEntry[]): void {
    localStorage.setItem(KB_KEY, JSON.stringify(kb));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool declarations
// ─────────────────────────────────────────────────────────────────────────────

const saveSupportKbDecl: FunctionDeclaration = {
    name: 'save_support_kb',
    description: 'Add a question-and-answer pair to the support knowledge base stored locally. Use this to teach Echo how to answer common customer questions.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            question: {
                type: Type.STRING,
                description: 'The customer question to store (e.g. "How do I reset my password?").',
            },
            answer: {
                type: Type.STRING,
                description: 'The answer to the question.',
            },
            category: {
                type: Type.STRING,
                description: 'Category for the entry (e.g. "billing", "technical", "general"). Defaults to "general".',
            },
            tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Optional tags to associate with the entry (e.g. ["password", "account"]).',
            },
        },
        required: ['question', 'answer'],
    },
};

const answerSupportQuestionDecl: FunctionDeclaration = {
    name: 'answer_support_question',
    description: 'Search the support knowledge base for answers to a customer question. Returns the top 3 matches ranked by relevance.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            question: {
                type: Type.STRING,
                description: 'The question to search for in the knowledge base.',
            },
        },
        required: ['question'],
    },
};

const listSupportKbDecl: FunctionDeclaration = {
    name: 'list_support_kb',
    description: 'List all entries in the support knowledge base, with an optional filter by category.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            category: {
                type: Type.STRING,
                description: 'Optional category to filter by (e.g. "billing"). If omitted, returns all entries.',
            },
        },
        required: [],
    },
};

const exportSupportWidgetDecl: FunctionDeclaration = {
    name: 'export_support_widget',
    description: 'Generate a complete self-contained HTML FAQ widget snippet. Paste it into any website to add a floating support chat button with an expandable FAQ panel — no backend or external dependencies required.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            company_name: {
                type: Type.STRING,
                description: 'Your company or product name, shown in the widget header.',
            },
            accent_color: {
                type: Type.STRING,
                description: 'CSS color for the widget accent (button, headings). Defaults to "#6366f1".',
            },
            widget_title: {
                type: Type.STRING,
                description: 'Optional title shown in the FAQ panel header. Defaults to "<company_name> Support".',
            },
        },
        required: ['company_name'],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Skill
// ─────────────────────────────────────────────────────────────────────────────

const supportAgentSkill: Skill = {
    name: 'support_agent',
    description:
        'Replaces Intercom/Zendesk-lite (~$74/mo) for small business support. ' +
        'Maintains a local support knowledge base (save Q&A pairs, search by question, list by category) ' +
        'and generates a self-contained HTML FAQ widget you can paste into any website — no backend needed.',
    tools: [
        saveSupportKbDecl,
        answerSupportQuestionDecl,
        listSupportKbDecl,
        exportSupportWidgetDecl,
    ],
    execute: async (toolName, args) => {
        try {
            switch (toolName) {
                // ── save_support_kb ──────────────────────────────────────────
                case 'save_support_kb': {
                    const question = String(args?.question ?? '').trim();
                    const answer = String(args?.answer ?? '').trim();
                    if (!question) return { error: 'question is required' };
                    if (!answer) return { error: 'answer is required' };
                    const category = args?.category ? String(args.category).trim() : 'general';
                    const tags: string[] = Array.isArray(args?.tags)
                        ? args.tags.map((t: any) => String(t))
                        : [];
                    const kb = loadKB();
                    const id = crypto.randomUUID();
                    kb.push({ id, question, answer, category, tags, createdAt: Date.now() });
                    saveKB(kb);
                    return { saved: true, id, total_entries: kb.length };
                }

                // ── answer_support_question ──────────────────────────────────
                case 'answer_support_question': {
                    const question = String(args?.question ?? '').trim();
                    if (!question) return { error: 'question is required' };
                    const kb = loadKB();
                    if (kb.length === 0) {
                        return {
                            question,
                            answers: [],
                            total_searched: 0,
                            message: 'Knowledge base is empty. Use save_support_kb to add entries.',
                        };
                    }

                    // Score by meaningful-word overlap (stopwords and short words excluded)
                    const queryWords = new Set(scoreWords(question));

                    const scored = kb.map(entry => {
                        const entryWords = scoreWords(entry.question);
                        let score = 0;
                        for (const w of entryWords) {
                            if (queryWords.has(w)) score++;
                        }
                        // Also check answer text for keyword matches (half weight)
                        const answerWords = scoreWords(entry.answer);
                        for (const w of answerWords) {
                            if (queryWords.has(w)) score += 0.5;
                        }
                        return { entry, score };
                    });

                    // Sort descending, take top 3
                    scored.sort((a, b) => b.score - a.score);
                    const top3 = scored.slice(0, 3);

                    const answers = top3.map(({ entry, score }) => {
                        const confidence: 'high' | 'medium' | 'low' =
                            score >= 3 ? 'high' : score >= 1 ? 'medium' : 'low';
                        return {
                            question: entry.question,
                            answer: entry.answer,
                            category: entry.category,
                            score,
                            confidence,
                        };
                    });

                    return { question, answers, total_searched: kb.length };
                }

                // ── list_support_kb ──────────────────────────────────────────
                case 'list_support_kb': {
                    const kb = loadKB();
                    const category = args?.category ? String(args.category).trim() : undefined;
                    const filtered = category
                        ? kb.filter(e => e.category.toLowerCase() === category.toLowerCase())
                        : kb;
                    const uniqueCategories = [...new Set(kb.map(e => e.category))].sort();
                    return {
                        entries: filtered.map(e => ({
                            id: e.id,
                            question: e.question,
                            answer: e.answer,
                            category: e.category,
                            tags: e.tags,
                            createdAt: e.createdAt,
                        })),
                        total: filtered.length,
                        categories: uniqueCategories,
                    };
                }

                // ── export_support_widget ────────────────────────────────────
                case 'export_support_widget': {
                    const companyName = String(args?.company_name ?? '').trim();
                    if (!companyName) return { error: 'company_name is required' };
                    const accentColor = args?.accent_color
                        ? String(args.accent_color).trim()
                        : '#6366f1';
                    const widgetTitle = args?.widget_title
                        ? String(args.widget_title).trim()
                        : `${companyName} Support`;

                    const kb = loadKB();

                    // Build accordion items HTML
                    const accordionItems = kb.length === 0
                        ? '<p style="color:#6b7280;font-size:14px;margin:16px 0;">No FAQ entries yet. Add some via the support agent!</p>'
                        : kb.map((entry, idx) => `
      <div class="esw-item" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <button
          class="esw-q"
          onclick="(function(btn){var p=btn.nextElementSibling;var open=p.style.display==='block';document.querySelectorAll('#echo-support-widget .esw-a').forEach(function(el){el.style.display='none';});document.querySelectorAll('#echo-support-widget .esw-q').forEach(function(el){el.style.background='#fff';});if(!open){p.style.display='block';btn.style.background='${accentColor}18';}})(this)"
          style="width:100%;text-align:left;padding:14px 16px;background:#fff;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#111827;display:flex;justify-content:space-between;align-items:center;gap:8px;"
        >
          <span>${entry.question.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span style="color:${accentColor};flex-shrink:0;font-size:18px;line-height:1;">&#8964;</span>
        </button>
        <div class="esw-a" id="esw-a-${idx}" style="display:none;padding:12px 16px 14px;background:#f9fafb;font-size:14px;color:#374151;line-height:1.6;border-top:1px solid #e5e7eb;">
          ${entry.answer.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          ${entry.category !== 'general' ? `<br><span style="display:inline-block;margin-top:8px;font-size:11px;font-weight:600;color:${accentColor};text-transform:uppercase;letter-spacing:.05em;">${entry.category.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>` : ''}
        </div>
      </div>`).join('');

                    const html = `<!-- Echo Support Widget — generated by Echo AI -->
<div id="echo-support-widget">
  <style>
    #echo-support-widget * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #esw-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      background: ${accentColor}; color: #fff; font-size: 24px; line-height: 1;
      box-shadow: 0 4px 14px rgba(0,0,0,.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #esw-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,.3); }
    #esw-panel {
      position: fixed; bottom: 92px; right: 24px; z-index: 99998;
      width: 360px; max-height: 520px;
      background: #fff; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18);
      display: none; flex-direction: column; overflow: hidden;
    }
    #esw-panel.open { display: flex; }
    #esw-header {
      padding: 18px 20px; background: ${accentColor}; color: #fff;
      display: flex; align-items: center; justify-content: space-between;
    }
    #esw-header h3 { margin: 0; font-size: 16px; font-weight: 700; }
    #esw-close {
      background: none; border: none; color: #fff; font-size: 22px;
      cursor: pointer; line-height: 1; padding: 0 2px;
    }
    #esw-body { padding: 16px; overflow-y: auto; flex: 1; }
    #esw-footer {
      padding: 10px 16px; font-size: 11px; color: #9ca3af;
      border-top: 1px solid #f3f4f6; text-align: center;
    }
    @media (max-width: 400px) {
      #esw-panel { width: calc(100vw - 32px); right: 16px; bottom: 84px; }
    }
  </style>

  <!-- Floating button -->
  <button id="esw-btn" aria-label="Open support FAQ" onclick="(function(){var p=document.getElementById('esw-panel');p.classList.toggle('open');document.getElementById('esw-btn').innerHTML=p.classList.contains('open')?'&#10005;':'&#63;';})()">&#63;</button>

  <!-- FAQ Panel -->
  <div id="esw-panel" role="dialog" aria-label="${widgetTitle.replace(/"/g, '&quot;')}">
    <div id="esw-header">
      <h3>${widgetTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h3>
      <button id="esw-close" aria-label="Close" onclick="(function(){document.getElementById('esw-panel').classList.remove('open');document.getElementById('esw-btn').innerHTML='&#63;';})()">&#10005;</button>
    </div>
    <div id="esw-body">
      ${accordionItems}
    </div>
    <div id="esw-footer">Powered by <strong>${companyName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong> &middot; Built with Echo AI</div>
  </div>
</div>`;

                    return {
                        html,
                        entries_count: kb.length,
                        instructions:
                            'Paste this HTML snippet just before the closing </body> tag on any page. ' +
                            'No external scripts or stylesheets required. All styles are inlined. ' +
                            'The widget is purely static — it embeds the FAQ entries at export time.',
                    };
                }

                default:
                    return { error: `Tool not found: ${toolName}` };
            }
        } catch (e: any) {
            return { error: e?.message || String(e) };
        }
    },
};

export default supportAgentSkill;
