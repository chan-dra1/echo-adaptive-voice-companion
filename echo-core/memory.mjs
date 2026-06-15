/**
 * memory.mjs — durable facts for the terminal brain.
 *
 * Persists things worth remembering about the user in the shared 'memories'
 * collection (so they also appear in the dashboard and survive restarts), and
 * recalls the relevant ones to inject into the brain's context on each turn.
 *
 * Recall is deliberately dependency-free: lightweight keyword overlap scoring,
 * not vector embeddings — so it works fully offline with no model. Good enough
 * to surface "you said your dog's name is Mango" when asked about the dog.
 */

const STOPWORDS = new Set(('a an the is are was were be been being am i you he she it we they ' +
    'my your his her its our their me him us them this that these those of to in on at for ' +
    'and or but if then so as by with from about into over after before do does did done ' +
    'have has had will would can could should may might must what who whom which when where ' +
    'why how not no yes get got make made just like want need please tell me my').split(/\s+/));

function tokens(s) {
    return String(s || '').toLowerCase()
        .replace(/'s\b/g, '')   // drop possessive so "dog's" matches "dog"
        .match(/[a-z0-9]+/g)?.filter(w => w.length > 2 && !STOPWORDS.has(w)) || [];
}

export function createMemory(store) {
    return {
        /** Store a durable fact. Returns the stored memory. */
        remember(text, key) {
            const clean = String(text || '').trim();
            if (!clean) throw new Error('Nothing to remember.');
            return store.add('memories', { text: clean, key: key || null });
        },

        all() { return store.all('memories'); },

        forget(id) { return store.remove('memories', id); },

        /**
         * Return up to `limit` stored facts most relevant to `query`, scored by
         * keyword overlap. Empty array if nothing meaningfully matches.
         */
        recall(query, limit = 5) {
            const q = new Set(tokens(query));
            if (!q.size) return [];
            const scored = store.all('memories').map(mem => {
                const mt = tokens(mem.text + ' ' + (mem.key || ''));
                let score = 0;
                for (const w of mt) if (q.has(w)) score++;
                return { mem, score };
            }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
            return scored.slice(0, limit).map(x => x.mem.text);
        },
    };
}

/** Detect "remember (that) …" / "note that …" / "don't forget …" → the fact, else null. */
export function extractRemember(input) {
    const m = String(input || '').match(/^\s*(?:remember|note|keep in mind|don'?t forget)\b(?:\s+that)?\s*[:,-]?\s*(.+)$/i);
    return m ? m[1].trim() : null;
}
