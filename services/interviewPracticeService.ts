/**
 * interviewPracticeService.ts — Interview practice engine.
 *
 * Echo acts as the interviewer, records answers, scores them,
 * and gives structured feedback. This is a SKILL BUILDER — not a cheat tool.
 * All session data stored locally (encrypted by vault at a higher layer).
 */

export type InterviewType =
    | 'behavioral'
    | 'technical'
    | 'system-design'
    | 'product-sense'
    | 'case-study'
    | 'hr';

export type DifficultyLevel = 'junior' | 'mid' | 'senior' | 'lead';

export interface InterviewQuestion {
    id: string;
    type: InterviewType;
    difficulty: DifficultyLevel;
    text: string;
    followUps: string[];
    scoringCriteria: string[];
    hints: string[];
    exemplarPoints: string[];
}

export interface QuestionScore {
    questionId: string;
    questionText: string;
    userAnswer: string;
    score: number;         // 0–10
    strengths: string[];
    improvements: string[];
    suggestedAnswer?: string;
    timeSeconds: number;
}

export interface PracticeSession {
    id: string;
    startedAt: number;
    endedAt?: number;
    type: InterviewType;
    difficulty: DifficultyLevel;
    role: string;
    company?: string;
    questions: QuestionScore[];
    overallScore?: number;
    overallFeedback?: string;
}

// ── Question bank ─────────────────────────────────────────────────────────────
export const QUESTION_BANK: InterviewQuestion[] = [
    // Behavioral
    {
        id: 'b1', type: 'behavioral', difficulty: 'mid',
        text: 'Tell me about a time you had to meet a tight deadline. What did you do?',
        followUps: ['What trade-offs did you make?', 'Would you do anything differently?'],
        scoringCriteria: ['Specific situation given (STAR)', 'Actions described clearly', 'Results quantified', 'Reflection shown'],
        hints: ['Use STAR: Situation, Task, Action, Result', 'Include actual numbers if possible'],
        exemplarPoints: ['Named a real project', 'Prioritized ruthlessly', 'Communicated proactively', 'Shipped on time with quality'],
    },
    {
        id: 'b2', type: 'behavioral', difficulty: 'mid',
        text: 'Describe a conflict you had with a coworker. How did you resolve it?',
        followUps: ['What would you do differently?', 'What did you learn about yourself?'],
        scoringCriteria: ['Shows empathy', 'Took initiative to resolve', 'Outcome described', 'No blame-shifting'],
        hints: ['Focus on behavior, not personality', 'Show you listened actively'],
        exemplarPoints: ['Sought to understand the other perspective', 'Found common ground', 'Clear positive outcome'],
    },
    {
        id: 'b3', type: 'behavioral', difficulty: 'senior',
        text: 'Tell me about a time you had to lead without authority.',
        followUps: ['How did you build consensus?', 'What was the biggest obstacle?'],
        scoringCriteria: ['Influence strategy described', 'Stakeholder management shown', 'Outcome achieved', 'Leadership style reflected'],
        hints: ['Emphasize coalition-building and communication'],
        exemplarPoints: ['Created shared vision', 'Addressed concerns proactively', 'Delivered cross-team result'],
    },
    {
        id: 'b4', type: 'behavioral', difficulty: 'junior',
        text: 'Tell me about yourself and why you are interested in this role.',
        followUps: ['What drew you to our company specifically?', 'Where do you see yourself in 3 years?'],
        scoringCriteria: ['Concise 2-min pitch', 'Connects background to role', 'Shows enthusiasm', 'Future-oriented'],
        hints: ['Past → Present → Future structure works well'],
        exemplarPoints: ['Clear narrative arc', 'Specific interest in role', 'Growth mindset shown'],
    },
    // Technical
    {
        id: 't1', type: 'technical', difficulty: 'mid',
        text: 'Explain how you would design a URL shortener like bit.ly.',
        followUps: ['How would you handle 1M users?', 'How do you prevent collisions?', 'Analytics tracking?'],
        scoringCriteria: ['Hashing strategy', 'Database schema', 'Scalability considered', 'Edge cases mentioned'],
        hints: ['Think about read/write ratio', 'Base62 encoding is common'],
        exemplarPoints: ['Key-value store for redirects', 'Cache popular URLs', 'Rate limiting', 'Analytics as async jobs'],
    },
    {
        id: 't2', type: 'technical', difficulty: 'junior',
        text: 'What is the difference between var, let, and const in JavaScript?',
        followUps: ['Give an example of a closure bug caused by var', 'When would you use const vs let?'],
        scoringCriteria: ['Scope explained', 'Hoisting mentioned', 'Temporal dead zone for let/const'],
        hints: ['Focus on scope (function vs block) and mutability'],
        exemplarPoints: ['var: function-scoped, hoisted', 'let: block-scoped, no TDZ issues', 'const: immutable binding'],
    },
    {
        id: 't3', type: 'technical', difficulty: 'senior',
        text: 'How would you optimize a React app that is rendering slowly?',
        followUps: ['How do you profile it?', 'What tools would you use?', 'What is React.memo?'],
        scoringCriteria: ['Profiler usage', 'Re-render identification', 'Memoization strategies', 'Code splitting'],
        hints: ['Start with React DevTools Profiler', 'Look for unnecessary re-renders first'],
        exemplarPoints: ['React.memo, useMemo, useCallback', 'Virtualization for long lists', 'Lazy loading', 'Bundle analysis'],
    },
    // System Design
    {
        id: 's1', type: 'system-design', difficulty: 'senior',
        text: 'Design a real-time notification system (like WhatsApp read receipts).',
        followUps: ['How do you handle offline users?', 'How do you scale to 100M users?'],
        scoringCriteria: ['WebSocket or SSE choice justified', 'Message queue usage', 'Persistence strategy', 'Scale plan'],
        hints: ['Consider push vs pull', 'Think about message ordering guarantees'],
        exemplarPoints: ['WebSocket for active users', 'Queue (Kafka) for durability', 'Fan-out service', 'Redis for presence'],
    },
    // Product Sense
    {
        id: 'p1', type: 'product-sense', difficulty: 'mid',
        text: 'How would you improve Spotify\'s onboarding for new users?',
        followUps: ['How would you measure success?', 'What would you NOT do?'],
        scoringCriteria: ['User empathy shown', 'Data-driven framing', 'Clear success metric', 'Prioritization explained'],
        hints: ['Define the problem first — who is the new user?'],
        exemplarPoints: ['Personalized taste quiz', 'Social graph import', 'Quick-start playlist', 'A/B test plan'],
    },
    // HR
    {
        id: 'h1', type: 'hr', difficulty: 'junior',
        text: 'What are your salary expectations?',
        followUps: ['Is that negotiable?', 'What is most important to you beyond salary?'],
        scoringCriteria: ['Research shown', 'Range given (not single number)', 'Confidence maintained', 'Non-monetary values added'],
        hints: ['Research market rates on Levels.fyi or Glassdoor before responding'],
        exemplarPoints: ['Gave a researched range', 'Prioritized growth and impact', 'Remained positive'],
    },
    {
        id: 'h2', type: 'hr', difficulty: 'mid',
        text: 'Why are you leaving your current job?',
        followUps: ['What would make you stay?', 'What went wrong?'],
        scoringCriteria: ['Positive framing', 'No badmouthing', 'Focused on growth', 'Honest but professional'],
        hints: ['Focus on what you are moving TOWARD, not what you are fleeing'],
        exemplarPoints: ['Framed as growth opportunity', 'Acknowledged positives of current role', "Connected to target company's strengths"],
    },
];

// ── Session store ─────────────────────────────────────────────────────────────
const STORAGE_KEY = 'echo_interview_sessions';

function loadSessions(): PracticeSession[] {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
}
function saveSessions(sessions: PracticeSession[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(-50)));
}

// ── Active session singleton ───────────────────────────────────────────────────
let activeSession: PracticeSession | null = null;
let questionStartTime = 0;

export function startPracticeSession(opts: {
    type: InterviewType;
    difficulty: DifficultyLevel;
    role: string;
    company?: string;
}): PracticeSession {
    activeSession = {
        id: `sess_${Date.now()}`,
        startedAt: Date.now(),
        type: opts.type,
        difficulty: opts.difficulty,
        role: opts.role,
        company: opts.company,
        questions: [],
    };
    questionStartTime = Date.now();
    return activeSession;
}

export function getActiveSession(): PracticeSession | null {
    return activeSession;
}

export function getQuestionsForSession(
    type: InterviewType,
    difficulty: DifficultyLevel,
    count = 5,
): InterviewQuestion[] {
    const filtered = QUESTION_BANK.filter(q =>
        (type === 'behavioral' ? q.type === 'behavioral' : q.type === type) &&
        (q.difficulty === difficulty || difficulty === 'mid')
    );
    // Shuffle + pick
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

export function recordAnswer(questionId: string, questionText: string, userAnswer: string): QuestionScore {
    const timeSeconds = Math.round((Date.now() - questionStartTime) / 1000);
    questionStartTime = Date.now();

    // Basic auto-score heuristics (real scoring done by Echo/Gemini via the prompt)
    const wordCount = userAnswer.trim().split(/\s+/).length;
    const hasStar = /situation|task|action|result/i.test(userAnswer);
    const hasNumbers = /\d+/.test(userAnswer);
    const tooShort = wordCount < 30;
    const tooLong  = wordCount > 350;

    let autoScore = 5;
    if (hasStar)    autoScore += 1.5;
    if (hasNumbers) autoScore += 1;
    if (tooShort)   autoScore -= 2;
    if (tooLong)    autoScore -= 0.5;
    autoScore = Math.min(10, Math.max(1, Math.round(autoScore)));

    const score: QuestionScore = {
        questionId,
        questionText,
        userAnswer,
        score: autoScore,
        timeSeconds,
        strengths: [],
        improvements: [],
    };

    if (activeSession) activeSession.questions.push(score);
    return score;
}

export function endSession(overallFeedback?: string): PracticeSession | null {
    if (!activeSession) return null;
    activeSession.endedAt = Date.now();
    if (activeSession.questions.length > 0) {
        activeSession.overallScore = Math.round(
            activeSession.questions.reduce((s, q) => s + q.score, 0) / activeSession.questions.length
        );
    }
    activeSession.overallFeedback = overallFeedback;

    const sessions = loadSessions();
    sessions.push(activeSession);
    saveSessions(sessions);

    const completed = activeSession;
    activeSession = null;
    return completed;
}

export function getAllSessions(): PracticeSession[] {
    return loadSessions().reverse(); // most recent first
}

export function buildInterviewSystemPrompt(session: PracticeSession, currentQ: InterviewQuestion): string {
    return `
[INTERVIEW PRACTICE MODE — ACTIVE]

You are now acting as a professional interviewer for: ${session.role}${session.company ? ` at ${session.company}` : ''}.
Interview type: ${session.type.toUpperCase()}  |  Difficulty: ${session.difficulty.toUpperCase()}

CURRENT QUESTION:
"${currentQ.text}"

SCORING CRITERIA (use these to evaluate the answer):
${currentQ.scoringCriteria.map(c => `• ${c}`).join('\n')}

FOLLOW-UP QUESTIONS (pick one if relevant):
${currentQ.followUps.map(f => `• ${f}`).join('\n')}

INSTRUCTIONS:
1. Listen to the user's answer fully before responding.
2. Give a concise score (X/10) and 2–3 specific strengths.
3. Give 1–2 concrete improvements with an example of how they could phrase it better.
4. Optionally, ask one follow-up question to dig deeper.
5. Keep your tone warm and constructive — you are a coach, not a judge.
6. After scoring, ask if they want to try again, hear a model answer, or move to the next question.

Remember: this is PRACTICE. Your goal is to build the user's real skills.
`.trim();
}

export const INTERVIEW_TYPE_LABELS: Record<InterviewType, string> = {
    behavioral: '🧠 Behavioral',
    technical: '💻 Technical',
    'system-design': '🏗️ System Design',
    'product-sense': '🎯 Product Sense',
    'case-study': '📊 Case Study',
    hr: '🤝 HR Round',
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
    junior: 'Junior (0–2y)',
    mid: 'Mid-level (2–5y)',
    senior: 'Senior (5–8y)',
    lead: 'Lead / Manager',
};
