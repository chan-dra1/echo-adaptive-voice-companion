# Echo - Adaptive Voice Companion

## 🔮 Vision
**Echo** is not just another voice assistant; it is a **sophisticated thought partner** designed to mirror your best self. Unlike generic AI, Echo adapts its personality, tone, and advice to match *you*—creating a deeply personalized, high-rapport connection.

Born from a collaboration between visionary user ideas and advanced Google AI models, Echo represents the next generation of **Multimodal AI Companions**.

---

## 🚀 Key Features

### 1. **Adaptive "Mirror" Persona**
*   **Dynamic Matching:** Echo analyzes your conversation style (casual vs. formal, technical vs. simple) and adjusts its own personality to match.
*   **High Rapport:** It feels like talking to a close friend or a dedicated mentor, not a robot.

### 2. **Real-Time Multimodal Intelligence**
*   **Gemini Live API:** Powered by Google's latest Gemini 2.0 Flash models for sub-second latency.
*   **Screen Sharing (Vision):** Echo can "see" your screen. Click the **Monitor Icon** to share context—ask for help with code, design reviews, or document analysis.
*   **Multilingual Native:** Speak in Hindi, Spanish, Japanese, or English—Echo responds instantly in your language.

### 3. **Real-World Grounding**
*   **Live Data:** Integrated with **Google Search** tools.
*   **Answers Anything:** Ask about:
    *   *Sports Scores:* "Who won the Lakers game?"
    *   *Stock Market:* "What's NVIDIA trading at?"
    *   *Weather:* "Is it raining in London?"
    *   *News:* "Latest tech headlines."

### 4. **Smart Long-Term Memory**
*   **Context Retention:** Echo remembers facts about you (goals, preferences, projects) across sessions.
*   **Proactive Help:** Uses stored memories to give better, more relevant advice over time.

### 5. **Premium UI/UX**
*   **Glassmorphism Design:** A modern, beautiful dark-mode interface with frosted glass effects (`backdrop-blur-xl`).
*   **Reactive Visuals:** Dynamic background gradients that glow and pulse based on connection status.
*   **Smart Setup:** Automatically detects missing API keys and guides you through setup.

---

## 🛠️ Technical Implementation

*   **Frontend:** React + Vite + TypeScript
*   **Styling:** Tailwind CSS (Custom Dark Theme)
*   **AI Core:** Google GenAI SDK (`@google/genai`)
*   **Voice Processing:**
    *   Web Audio API for real-time PCM audio streaming.
    *   Custom VAD (Voice Activity Detection) algorithm for natural turn-taking.
    *   Low-latency buffering tweak (`0.005` silence threshold).
*   **Screen Capture:** Native `getDisplayMedia` stream processed via Canvas for efficient token usage (1 FPS).

---

## 📜 Origin Story
This project was conceptualized and built via **AI Studio** collaboration.
*   **User Vision:** A need for a fast, "real" conversational partner that improves over time.
*   **AI Execution:** Implemented agentically, handling everything from audio buffer management to UI glassmorphism.

> *"Echo is the assistant that grows with you."*
