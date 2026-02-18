/**
 * Personalized Learning Service
 *
 * This service learns from the user's speech patterns and creates a personalized AI
 * that responds in the user's style. Everything is stored LOCALLY - no server uploads.
 *
 * Features:
 * - Learns vocabulary and phrases from user's speech
 * - Analyzes conversation patterns
 * - Stores communication style preferences
 * - Creates personalized response templates
 * - 100% private - all data stays on user's device
 */

interface UserSpeechPattern {
  id: string;
  timestamp: number;
  transcript: string;
  context: string; // What were they responding to?
  sentiment: 'positive' | 'negative' | 'neutral' | 'excited' | 'serious';
  length: 'short' | 'medium' | 'long';
  vocabulary: string[]; // Unique words used
  fillerWords: string[]; // "um", "like", "you know"
  structurePattern: 'direct' | 'storytelling' | 'analytical' | 'casual';
}

interface UserPersonality {
  // Communication style
  formalityLevel: number; // 0-10 (0=very casual, 10=very formal)
  verbosity: number; // 0-10 (0=brief, 10=detailed)
  emotionalExpression: number; // 0-10 (0=reserved, 10=expressive)

  // Common patterns
  commonPhrases: Map<string, number>; // phrase -> frequency
  favoriteWords: Map<string, number>; // word -> frequency
  fillerWordUsage: Map<string, number>; // "um" -> frequency

  // Conversation style
  typicalResponseLength: number; // average words per response
  questionAsking: number; // how often they ask questions
  interruptionTendency: number; // how often they interrupt
  pauseFrequency: number; // how often they pause

  // Vocabulary
  vocabularyRichness: number; // unique words / total words
  technicalLanguageUsage: number; // technical terms frequency
  slangUsage: number; // informal language frequency

  // Emotional patterns
  dominantSentiment: 'positive' | 'neutral' | 'serious';
  excitementLevel: number; // 0-10
  empathyLevel: number; // 0-10
}

export class PersonalizedLearningService {
  private dbName = 'echo_personalized_learning';
  private db: IDBDatabase | null = null;

  // In-memory cache for quick access
  private personality: UserPersonality | null = null;
  private speechPatterns: UserSpeechPattern[] = [];

  constructor() {
    this.initializeDB();
  }

  /**
   * Initialize IndexedDB for local storage
   */
  private async initializeDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.loadPersonality();
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Store speech patterns
        if (!db.objectStoreNames.contains('speechPatterns')) {
          const patternsStore = db.createObjectStore('speechPatterns', { keyPath: 'id' });
          patternsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store personality profile
        if (!db.objectStoreNames.contains('personality')) {
          db.createObjectStore('personality', { keyPath: 'id' });
        }

        // Store learned phrases
        if (!db.objectStoreNames.contains('learnedPhrases')) {
          const phrasesStore = db.createObjectStore('learnedPhrases', { keyPath: 'phrase' });
          phrasesStore.createIndex('frequency', 'frequency', { unique: false });
        }
      };
    });
  }

  /**
   * Learn from a user's speech
   * This is called every time the user speaks
   */
  async learnFromSpeech(
    transcript: string,
    context: string,
    aiResponse?: string
  ): Promise<void> {
    const pattern = this.analyzeSpeech(transcript, context);

    // Store the pattern
    await this.storeSpeechPattern(pattern);

    // Update personality profile
    this.updatePersonality(pattern);

    // Extract and store useful phrases
    await this.extractPhrases(transcript);
  }

  /**
   * Analyze a piece of speech for patterns
   */
  private analyzeSpeech(transcript: string, context: string): UserSpeechPattern {
    const words = transcript.toLowerCase().split(/\s+/);

    // Detect filler words
    const fillerWords = this.detectFillerWords(words);

    // Analyze sentiment
    const sentiment = this.detectSentiment(transcript);

    // Determine length category
    const length = words.length < 10 ? 'short' : words.length < 30 ? 'medium' : 'long';

    // Analyze structure
    const structurePattern = this.detectStructure(transcript);

    // Extract unique vocabulary
    const vocabulary = Array.from(new Set(words.filter(w => w.length > 3)));

    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      transcript,
      context,
      sentiment,
      length,
      vocabulary,
      fillerWords,
      structurePattern,
    };
  }

  /**
   * Detect filler words the user commonly uses
   */
  private detectFillerWords(words: string[]): string[] {
    const fillers = ['um', 'uh', 'like', 'you know', 'sort of', 'kind of',
                     'actually', 'basically', 'literally', 'i mean', 'well'];

    return words.filter(word => fillers.includes(word.toLowerCase()));
  }

  /**
   * Detect sentiment/tone of speech
   */
  private detectSentiment(text: string): 'positive' | 'negative' | 'neutral' | 'excited' | 'serious' {
    const lowerText = text.toLowerCase();

    // Check for excitement markers
    if (text.includes('!') || lowerText.includes('wow') || lowerText.includes('amazing')) {
      return 'excited';
    }

    // Check for positive words
    const positiveWords = ['good', 'great', 'love', 'awesome', 'fantastic', 'excellent'];
    if (positiveWords.some(word => lowerText.includes(word))) {
      return 'positive';
    }

    // Check for negative words
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst'];
    if (negativeWords.some(word => lowerText.includes(word))) {
      return 'negative';
    }

    // Check for serious tone
    if (text.length > 100 && !text.includes('!') && !text.includes('?')) {
      return 'serious';
    }

    return 'neutral';
  }

  /**
   * Detect how the user structures their responses
   */
  private detectStructure(text: string): 'direct' | 'storytelling' | 'analytical' | 'casual' {
    const lowerText = text.toLowerCase();

    // Direct: Short, to the point
    if (text.split(/\s+/).length < 15) {
      return 'direct';
    }

    // Storytelling: Uses narrative words
    const storyWords = ['so', 'then', 'and then', 'after that', 'first', 'next'];
    if (storyWords.some(word => lowerText.includes(word))) {
      return 'storytelling';
    }

    // Analytical: Uses reasoning words
    const analyticalWords = ['because', 'therefore', 'however', 'although', 'consequently'];
    if (analyticalWords.some(word => lowerText.includes(word))) {
      return 'analytical';
    }

    return 'casual';
  }

  /**
   * Store speech pattern in IndexedDB
   */
  private async storeSpeechPattern(pattern: UserSpeechPattern): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['speechPatterns'], 'readwrite');
      const store = transaction.objectStore('speechPatterns');
      const request = store.add(pattern);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Extract and store commonly used phrases
   */
  private async extractPhrases(text: string): Promise<void> {
    if (!this.db) return;

    // Extract 2-3 word phrases
    const words = text.split(/\s+/);
    const phrases: string[] = [];

    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`.toLowerCase());

      if (i < words.length - 2) {
        phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`.toLowerCase());
      }
    }

    // Store or update frequency
    for (const phrase of phrases) {
      await this.updatePhraseFrequency(phrase);
    }
  }

  /**
   * Update how often a phrase is used
   */
  private async updatePhraseFrequency(phrase: string): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction(['learnedPhrases'], 'readwrite');
    const store = transaction.objectStore('learnedPhrases');

    const getRequest = store.get(phrase);

    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      const frequency = existing ? existing.frequency + 1 : 1;

      store.put({ phrase, frequency });
    };
  }

  /**
   * Update personality profile based on new speech pattern
   */
  private async updatePersonality(pattern: UserSpeechPattern): Promise<void> {
    if (!this.personality) {
      this.personality = this.createDefaultPersonality();
    }

    // Update formality based on vocabulary
    const formalWords = pattern.vocabulary.filter(w => w.length > 8);
    const formalityScore = (formalWords.length / pattern.vocabulary.length) * 10;
    this.personality.formalityLevel = this.smoothUpdate(
      this.personality.formalityLevel,
      formalityScore
    );

    // Update verbosity
    const wordCount = pattern.transcript.split(/\s+/).length;
    const verbosityScore = Math.min(wordCount / 10, 10);
    this.personality.verbosity = this.smoothUpdate(
      this.personality.verbosity,
      verbosityScore
    );

    // Update emotional expression
    const emotionalScore = pattern.sentiment === 'excited' ? 8 :
                          pattern.sentiment === 'positive' ? 6 :
                          pattern.sentiment === 'negative' ? 4 : 5;
    this.personality.emotionalExpression = this.smoothUpdate(
      this.personality.emotionalExpression,
      emotionalScore
    );

    // Update common phrases
    pattern.vocabulary.forEach(word => {
      const count = this.personality!.favoriteWords.get(word) || 0;
      this.personality!.favoriteWords.set(word, count + 1);
    });

    // Update filler words
    pattern.fillerWords.forEach(filler => {
      const count = this.personality!.fillerWordUsage.get(filler) || 0;
      this.personality!.fillerWordUsage.set(filler, count + 1);
    });

    // Save to IndexedDB
    await this.savePersonality();
  }

  /**
   * Smooth update: gradual change (80% old, 20% new)
   */
  private smoothUpdate(oldValue: number, newValue: number): number {
    return oldValue * 0.8 + newValue * 0.2;
  }

  /**
   * Create default personality profile
   */
  private createDefaultPersonality(): UserPersonality {
    return {
      formalityLevel: 5,
      verbosity: 5,
      emotionalExpression: 5,
      commonPhrases: new Map(),
      favoriteWords: new Map(),
      fillerWordUsage: new Map(),
      typicalResponseLength: 50,
      questionAsking: 0.2,
      interruptionTendency: 0,
      pauseFrequency: 0,
      vocabularyRichness: 0,
      technicalLanguageUsage: 0,
      slangUsage: 0,
      dominantSentiment: 'neutral',
      excitementLevel: 5,
      empathyLevel: 5,
    };
  }

  /**
   * Save personality to IndexedDB
   */
  private async savePersonality(): Promise<void> {
    if (!this.db || !this.personality) return;

    // Convert Maps to arrays for storage
    const personalityData = {
      id: 'user_personality',
      ...this.personality,
      commonPhrases: Array.from(this.personality.commonPhrases.entries()),
      favoriteWords: Array.from(this.personality.favoriteWords.entries()),
      fillerWordUsage: Array.from(this.personality.fillerWordUsage.entries()),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['personality'], 'readwrite');
      const store = transaction.objectStore('personality');
      const request = store.put(personalityData);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load personality from IndexedDB
   */
  private async loadPersonality(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['personality'], 'readonly');
      const store = transaction.objectStore('personality');
      const request = store.get('user_personality');

      request.onsuccess = () => {
        const data = request.result;
        if (data) {
          this.personality = {
            ...data,
            commonPhrases: new Map(data.commonPhrases),
            favoriteWords: new Map(data.favoriteWords),
            fillerWordUsage: new Map(data.fillerWordUsage),
          };
        }
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Generate personalized system prompt
   * This tells the AI to respond like the user would
   */
  generatePersonalizedPrompt(): string {
    if (!this.personality) {
      return 'Respond naturally in a conversational manner.';
    }

    const {
      formalityLevel,
      verbosity,
      emotionalExpression,
      favoriteWords,
      fillerWordUsage
    } = this.personality;

    // Get top favorite words
    const topWords = Array.from(favoriteWords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    // Get top filler words
    const topFillers = Array.from(fillerWordUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([filler]) => filler);

    const prompt = `
PERSONALIZED COMMUNICATION STYLE:

You are responding in a personalized way that matches this user's communication style.

FORMALITY LEVEL: ${formalityLevel}/10 ${
  formalityLevel < 3 ? '(Very casual - use informal language)' :
  formalityLevel < 7 ? '(Conversational - balanced tone)' :
  '(Professional - use formal language)'
}

VERBOSITY: ${verbosity}/10 ${
  verbosity < 3 ? '(Brief - keep responses short and concise)' :
  verbosity < 7 ? '(Moderate - balanced response length)' :
  '(Detailed - provide thorough, detailed responses)'
}

EMOTIONAL EXPRESSION: ${emotionalExpression}/10 ${
  emotionalExpression < 3 ? '(Reserved - minimal emotional language)' :
  emotionalExpression < 7 ? '(Balanced - moderate emotion)' :
  '(Expressive - use emotional, enthusiastic language)'
}

VOCABULARY PREFERENCES:
This user commonly uses these words: ${topWords.join(', ')}
Try to naturally incorporate these words when relevant.

SPEECH PATTERNS:
${topFillers.length > 0 ? `Common filler words: ${topFillers.join(', ')}
Use these occasionally for natural speech.` : ''}

INSTRUCTIONS:
1. Match the user's communication style
2. Use vocabulary they're comfortable with
3. Match their level of formality
4. Match their typical response length
5. Show similar emotional expression
6. Respond as if YOU are the user talking to someone else

Remember: You're learning to communicate like THIS specific user.
`;

    return prompt;
  }

  /**
   * Get statistics about learned patterns
   */
  getStatistics(): {
    totalPatterns: number;
    uniqueWords: number;
    commonPhrases: string[];
    personalityScore: any;
  } {
    if (!this.personality) {
      return {
        totalPatterns: 0,
        uniqueWords: 0,
        commonPhrases: [],
        personalityScore: null,
      };
    }

    const topPhrases = Array.from(this.personality.commonPhrases.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase]) => phrase);

    return {
      totalPatterns: this.speechPatterns.length,
      uniqueWords: this.personality.favoriteWords.size,
      commonPhrases: topPhrases,
      personalityScore: {
        formality: this.personality.formalityLevel,
        verbosity: this.personality.verbosity,
        emotional: this.personality.emotionalExpression,
      },
    };
  }

  /**
   * Clear all learned data (privacy)
   */
  async clearAllData(): Promise<void> {
    if (!this.db) return;

    const stores = ['speechPatterns', 'personality', 'learnedPhrases'];

    for (const storeName of stores) {
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    this.personality = null;
    this.speechPatterns = [];
  }

  /**
   * Export learned data (for backup or transfer)
   */
  async exportData(): Promise<string> {
    const data = {
      personality: this.personality ? {
        ...this.personality,
        commonPhrases: Array.from(this.personality.commonPhrases.entries()),
        favoriteWords: Array.from(this.personality.favoriteWords.entries()),
        fillerWordUsage: Array.from(this.personality.fillerWordUsage.entries()),
      } : null,
      patterns: await this.getAllPatterns(),
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Import learned data
   */
  async importData(jsonData: string): Promise<void> {
    const data = JSON.parse(jsonData);

    if (data.personality) {
      this.personality = {
        ...data.personality,
        commonPhrases: new Map(data.personality.commonPhrases),
        favoriteWords: new Map(data.personality.favoriteWords),
        fillerWordUsage: new Map(data.personality.fillerWordUsage),
      };
      await this.savePersonality();
    }

    if (data.patterns) {
      for (const pattern of data.patterns) {
        await this.storeSpeechPattern(pattern);
      }
    }
  }

  /**
   * Get all stored patterns
   */
  private async getAllPatterns(): Promise<UserSpeechPattern[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['speechPatterns'], 'readonly');
      const store = transaction.objectStore('speechPatterns');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export const personalizedLearning = new PersonalizedLearningService();
