# 🤖 Proactive AI Features - Complete Guide

## What is Proactive AI?

Echo becomes your **personal assistant** that actively helps you with:
- 🛍️ Finding best deals & coupon codes
- ✈️ Booking flights & hotels
- 💪 Creating workout plans & reminders
- 📅 Scheduling tasks & events
- 🔍 Web browsing & research
- 🖼️ Finding products from images
- ⏰ Always active in background

---

## 🎯 Features Overview

### 1. **Web Search** (`search_web`)
```
You: "Find me the best laptop under $1000"
Echo: *searches web automatically*
      "I found 3 great options:
       1. Dell XPS 13 - $899 (Amazon)
       2. MacBook Air M1 - $949 (Best Buy)
       3. HP Spectre x360 - $799 (Walmart)"
```

### 2. **Coupon Codes** (`check_coupon_codes`)
```
You: "I want to buy from Nike"
Echo: *checks coupon codes*
      "I found 2 working codes for Nike:
       • SAVE20 - 20% off (expires in 7 days)
       • FREESHIP - Free shipping"
```

### 3. **Image Search** (`find_product_from_image`)
```
You: *uploads photo of shoes*
Echo: *reverse image search*
      "Found similar shoes:
       • Nike Air Max - $89.99 (Amazon)
       • Same model - $79.99 (Walmart) ✓ CHEAPEST
       Savings: $10.00"
```

### 4. **Set Reminders** (`set_reminder`)
```
You: "Remind me to go to the gym tomorrow at 6 PM"
Echo: *sets reminder*
      "✓ Reminder set: 'Go to gym' at 6:00 PM tomorrow
       I'll notify you!"
```

### 5. **Workout Plans** (`create_workout_plan`)
```
You: "I want to build muscle, 3 days a week"
Echo: *creates workout plan*
      "Created your plan:
       Monday: Chest & Triceps
       Wednesday: Back & Biceps
       Friday: Legs & Shoulders

       Setting reminders for each day..."
```

### 6. **Flight Search** (`search_flights`)
```
You: "Book a flight from LA to NYC next Friday"
Echo: *searches flights*
      "Found 5 options:
       • Delta 8:00 AM - $299 (nonstop)
       • United 2:00 PM - $249 (1 stop) ✓ CHEAPEST
       • American 6:00 PM - $310 (nonstop)"
```

### 7. **Price Comparison** (`compare_prices`)
```
You: "How much is the iPhone 15?"
Echo: *compares prices*
      "Comparing iPhone 15 prices:
       • Amazon: $799
       • Best Buy: $799
       • Walmart: $749 ✓ BEST DEAL
       Save $50 by buying from Walmart!"
```

### 8. **Schedule Tasks** (`schedule_task`)
```
You: "Check flight prices every day this week"
Echo: *schedules background task*
      "✓ Scheduled: I'll check flight prices daily
       and notify you if prices drop!"
```

---

## 🔧 Setup & Integration

### Step 1: Enable Function Calling in Gemini

```typescript
// In geminiLiveService.ts
import { PROACTIVE_AI_TOOLS, proactiveAI } from './proactiveAIService';

class GeminiLiveService {
  async connect(options) {
    // Enable function calling
    await this.client.connect({
      systemInstruction: proactiveAI.getSystemPrompt(),
      tools: PROACTIVE_AI_TOOLS,
      toolChoice: 'auto', // Let AI decide when to use tools
      ...options
    });
  }

  // Handle function calls from AI
  async onFunctionCall(functionCall) {
    const result = await proactiveAI.handleFunctionCall(
      functionCall.name,
      functionCall.arguments
    );

    // Send result back to AI
    await this.sendFunctionResponse(functionCall.id, result);
  }
}
```

### Step 2: Add API Keys (Optional but Recommended)

Create `.env` file:
```bash
# For real-time web search
VITE_SERP_API_KEY=your_serpapi_key

# For flight/hotel search
VITE_RAPIDAPI_KEY=your_rapidapi_key

# For coupon codes
VITE_COUPON_API_KEY=your_coupon_api_key
```

Get API keys:
- **SerpAPI**: https://serpapi.com (free tier: 100 searches/month)
- **RapidAPI**: https://rapidapi.com (various travel APIs)
- **RetailMeNot API**: For coupon codes

### Step 3: Enable Background Service

```typescript
// In App.tsx
import { proactiveAI } from './services/proactiveAIService';

function App() {
  useEffect(() => {
    // Enable proactive AI
    proactiveAI.setActive(true);

    // Listen for reminders
    window.addEventListener('echo-reminder', (e) => {
      const reminder = e.detail;
      // Show notification
      showToast(`Reminder: ${reminder.title}`);
    });

    return () => {
      proactiveAI.setActive(false);
    };
  }, []);
}
```

---

## 📱 Real-World Examples

### Example 1: Shopping Assistant
```
You: "I need a new office chair"

Echo: "Let me help you find the best deal!
       *searching web*

       Found 3 highly-rated options:

       1. Herman Miller Aeron - $1,295
          • 12-year warranty
          • Best ergonomics

       2. Steelcase Leap - $989 ✓ BEST VALUE
          • 4.8/5 stars
          • Free shipping

       3. Autonomous ErgoChair - $449
          • Budget-friendly
          • Good reviews

       Would you like me to check for coupon codes?
       I'll also set a price alert in case prices drop!"
```

### Example 2: Fitness Coach
```
You: "I want to get in shape for summer"

Echo: "Awesome! Let's create a plan for you.
       *creating workout plan*

       I've created a 12-week transformation plan:

       • 4 days/week strength training
       • 2 days/week cardio
       • 1 rest day

       This week's schedule:
       Monday: Upper Body (7:00 AM reminder set)
       Tuesday: Cardio - 30min run
       Thursday: Lower Body
       Friday: HIIT workout

       I'll send you reminders and track your progress!
       Want me to also find healthy meal plans?"
```

### Example 3: Travel Planner
```
You: "I need to visit London in March"

Echo: "Perfect! Let me find the best deals.
       *searching flights*
       *searching hotels*

       FLIGHT OPTIONS:
       • British Airways: $620 (nonstop) - Best time
       • Virgin Atlantic: $580 (1 stop) ✓ CHEAPEST

       HOTEL RECOMMENDATIONS:
       • Premier Inn London - $89/night
       • Hilton London - $145/night
       • Budget Hostel - $35/night

       TOTAL TRIP COST:
       Budget: $820 (5 days)
       Comfort: $1,305

       Should I monitor prices and alert you if they drop?
       I can also create an itinerary with top attractions!"
```

### Example 4: Daily Assistant
```
Morning (7:00 AM):
Echo: "Good morning! Here's your day:

       🏋️ Gym session in 30 minutes
       📧 3 unread important emails
       ☀️ Weather: 72°F, sunny

       Your workout today:
       • Squats: 4x10
       • Bench Press: 4x8
       • Deadlifts: 3x8

       I found a 15% off coupon for that protein
       powder you were looking at yesterday.
       Want me to add it to cart?"
```

---

## ⚙️ Configuration

### Customize AI Behavior

```typescript
// In proactiveAIService.ts

// How proactive should AI be?
const proactivityLevel = {
  passive: 0,      // Only responds when asked
  balanced: 5,     // Offers help when relevant
  aggressive: 10   // Actively suggests and acts
};

// Set your preference
proactiveAI.setProactivityLevel(5); // Balanced

// What can AI do automatically?
const autoActions = {
  searchWeb: true,           // Auto-search when relevant
  checkCoupons: true,        // Auto-check coupon codes
  comparePrices: true,       // Auto-compare prices
  setReminders: false,       // Ask before setting reminders
  bookServices: false,       // Always ask before booking
  monitorPrices: true        // Auto-monitor price changes
};
```

### Privacy Settings

```typescript
// What data can AI access?
const permissions = {
  browseHistory: false,      // Don't track browsing
  location: false,           // Don't use location
  calendar: false,           // Don't access calendar
  contacts: false,           // Don't access contacts

  // Only use what user explicitly shares
  explicitOnly: true
};
```

---

## 🔐 Privacy & Security

### What's Stored Locally?
- ✅ Reminders & schedules
- ✅ Workout plans
- ✅ Shopping preferences
- ✅ Search history (optional)

### What's NEVER Stored?
- ❌ Credit card info
- ❌ Passwords
- ❌ Private conversations (unless you save them)

### Background Service
```typescript
// Control what runs in background
proactiveAI.backgroundSettings({
  checkReminders: true,      // Check reminders
  monitorPrices: true,       // Monitor price drops
  updateFlights: false,      // Don't auto-update flights
  runWhileSleeping: false    // Don't run when device sleeping
});
```

---

## 🚀 Deploy with All Features

### Deploy to Vercel with APIs

```bash
# 1. Deploy
vercel

# 2. Add environment variables in Vercel dashboard
VITE_GEMINI_API_KEY=...
VITE_SERP_API_KEY=...      # Optional: for real web search
VITE_RAPIDAPI_KEY=...      # Optional: for travel APIs
VITE_COUPON_API_KEY=...    # Optional: for coupon codes

# 3. Your proactive AI is live!
```

---

## 📊 Cost Estimation

### Free Tier (No external APIs):
- ✅ Basic function calling: FREE
- ✅ Local reminders: FREE
- ✅ Workout plans: FREE
- ⚠️ Web search: Limited (manual links)
- ⚠️ Coupons: Simulated results

### With APIs (~$10-20/month):
- ✅ Real-time web search
- ✅ Verified coupon codes
- ✅ Live flight prices
- ✅ Product price tracking
- ✅ Image reverse search

---

## 🎯 Usage Tips

### 1. Be Specific
```
❌ "Find flights"
✅ "Find cheapest flights from LA to NYC March 15-20"
```

### 2. Let AI Be Proactive
```
You: "I'm planning a vacation"
Echo: *automatically searches:*
      - Flight options
      - Hotel deals
      - Travel tips
      - Weather forecast
      - Packing checklist
```

### 3. Give Feedback
```
You: "That's too expensive"
Echo: *adjusts search:*
      "Searching for budget options under $500..."
```

### 4. Trust the Background Service
```
AI monitors in background:
- Price drops on saved items
- Flight price changes
- New coupon codes
- Reminder times

You get notified automatically!
```

---

## 🔄 Future Enhancements

Coming soon:
- [ ] Calendar integration
- [ ] Email automation
- [ ] Smart home control
- [ ] Car/ride booking
- [ ] Restaurant reservations
- [ ] Health tracking
- [ ] Bill payment reminders
- [ ] Investment tracking

---

## ❓ FAQ

**Q: Will it drain my battery?**
A: No! Background checks run once per minute, very light on resources.

**Q: Can I disable features I don't need?**
A: Yes! Each feature can be toggled on/off individually.

**Q: Does it work offline?**
A: Reminders & local features work offline. Web search needs internet.

**Q: Is my data secure?**
A: Yes! Everything stored locally, encrypted with your VoiceVault password.

**Q: Can I export my data?**
A: Yes! Export all reminders, plans, and settings anytime.

---

Ready to make Echo your personal AI assistant? 🚀

See `proactiveAIService.ts` for full implementation!
