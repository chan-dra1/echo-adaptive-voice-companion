# 🎙️ Echo - Adaptive Voice Companion

> **Your personalized AI assistant that learns how YOU speak, helps with daily tasks, and runs completely private on your device.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 Features

### 🧠 **Personalized Learning**
- Learns YOUR speaking style, vocabulary, and tone
- Responds like YOU would respond
- 100% private - all learning stored locally
- Export/import your personality

### 🎯 **Proactive AI Assistant**
- 🛍️ Finds best deals & coupon codes
- ✈️ Searches flights & hotels
- 💪 Creates workout plans & sets reminders
- 📅 Schedules tasks & monitors prices
- 🔍 Browses web & compares prices
- 🖼️ Finds products from images

### 🎤 **Voice Features**
- Real-time voice conversations
- Voice cloning with encrypted storage
- Natural interruption handling
- Human-like responses with "um", "ah", filler words

### 🔐 **Privacy-First**
- Everything stored locally (IndexedDB + localStorage)
- No data sent to external servers
- Encrypted voice samples
- Full user control

### ♿ **Accessibility**
- Full keyboard navigation
- Screen reader support
- ARIA labels throughout
- Focus indicators
- Responsive design

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/echo-adaptive-voice-companion.git
cd echo-adaptive-voice-companion
npm install
```

### 2. Add API Key

Create `.env` file:
```bash
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

Get your key: https://aistudio.google.com/app/apikey

### 3. Run Locally

```bash
npm run dev
```

Open: http://localhost:5173

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

**That's it!** 🎉

---

## 📖 Documentation

- [📝 Deployment Guide](DEPLOYMENT_GUIDE.md) - Deploy to Vercel/Supabase
- [🤖 Proactive AI Features](PROACTIVE_AI_FEATURES.md) - Shopping, reminders, flights
- [🧠 Personalized Learning](PERSONALIZED_AI_GUIDE.md) - AI that talks like you
- [🎙️ Interview Mode](INTERVIEW_MODE_GUIDE.md) - Natural conversations

---

## 🎯 Use Cases

### Personal Assistant
```
You: "I need new running shoes"
Echo: *searches web, finds deals, checks coupons*
      "Found Nike Air Zoom at $79 (normally $120)
       with code SAVE20. Want me to add to cart?"
```

### Fitness Coach
```
You: "Help me build muscle"
Echo: *creates workout plan*
      "Created 4-day plan:
       Mon: Chest & Triceps
       Wed: Back & Biceps
       Fri: Legs & Shoulders
       Sun: Rest

       Set reminders for each day?"
```

### Travel Planner
```
You: "Book flight to NYC next week"
Echo: *searches flights*
      "Found 3 options:
       Delta $299 (nonstop)
       United $249 (1 stop) ✓ CHEAPEST
       American $310 (nonstop)"
```

### Shopping Assistant
```
You: *uploads photo of jacket*
Echo: *image search*
      "Found that jacket:
       Amazon: $89.99
       Nordstrom: $120
       TJ Maxx: $69.99 ✓ BEST DEAL"
```

---

## 🛠️ Tech Stack

- **Frontend**: React 19 + TypeScript
- **Styling**: Tailwind CSS
- **AI**: Google Gemini Live API
- **Storage**: IndexedDB + localStorage
- **Voice**: WebAudio API + VAD
- **Deployment**: Vercel
- **Build**: Vite

---

## 📁 Project Structure

```
echo/
├── components/           # React components
│   ├── AudioVisualizer.tsx
│   ├── ChatPanel.tsx
│   ├── MemoryPanel.tsx
│   ├── VoiceVault.tsx
│   ├── InterviewMode.tsx
│   ├── PersonalizedLearningPanel.tsx
│   ├── Toast.tsx
│   ├── Button.tsx
│   └── Tooltip.tsx
├── services/            # Business logic
│   ├── geminiLiveService.ts
│   ├── personalizedLearningService.ts
│   ├── proactiveAIService.ts
│   ├── memoryService.ts
│   └── chatHistoryService.ts
├── config/              # Configuration
│   └── interviewPrompts.ts
├── hooks/               # Custom hooks
│   └── useToast.ts
└── types.ts            # TypeScript types
```

---

## 🔐 Privacy & Security

### What's Stored Locally?
- ✅ Speech patterns & learning data
- ✅ Voice recordings (encrypted)
- ✅ Conversation history
- ✅ Reminders & schedules
- ✅ User preferences

### What's Sent to Gemini?
- ✅ Current conversation only
- ✅ System instructions (how to respond)
- ❌ No voice recordings
- ❌ No personal learning data
- ❌ No browsing history

---

## 🚀 Deploy Now!

```bash
# Quick deploy (5 minutes)
vercel

# Your app will be live at: https://echo-xyz.vercel.app
```

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for full instructions.

---

**Built with ❤️ using Claude Code**

Deploy your own Echo: [![Deploy](https://vercel.com/button)](https://vercel.com/new)
