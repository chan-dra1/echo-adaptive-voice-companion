# Echo - Deployment & Production Guide

This codebase is production-ready for deployment to modern web hosting platforms like Vercel, Netlify, or AWS Amplify.

## 1. Environment Configuration

### Frontend (Required)
Copy `.env.example` to `.env` in the root directory:
```bash
cp .env.example .env
```

Edit `.env` and add your keys:
- `VITE_API_KEY`: Your Google Gemini API Key (Required).
- `VITE_SERP_API_KEY`: SerpAPI Key for real-time web search (Optional).

### Backend (Optional - Local Voice)
The Python server (`server.py`) is optional. It provides high-quality local text-to-speech using Coqui TTS.
- If you don't run this server, Echo will fall back to browser-based TTS or Gemini's native voice.
- To run:
  1. Install Python 3.9+.
  2. Install dependencies: `pip install -r requirements.txt` (Note: `TTS` package is heavy).
  3. Run: `python server.py`.

## 2. Building for Production

To create an optimized production build:

```bash
npm install
npm run build
```

This will generate a `dist/` folder containing static assets.

## 3. Deploying to Vercel (Recommended)

1. Push this repository to GitHub.
2. Import the project in Vercel.
3. Configure Environment Variables in Vercel dashboard:
   - `VITE_API_KEY`
   - `VITE_SERP_API_KEY`
4. Deploy!

## 4. Deploying with Vercel CLI (Fastest)

Since you have the Vercel CLI installed (`v50.5.2`), you can deploy directly from your terminal:

1.  Run:
    ```bash
    vercel
    ```
2.  Follow the prompts:
    - Set up and deploy? [Y]
    - Which scope? [Select your account]
    - Link to existing project? [N]
    - Project Name? [echo-adaptive-voice-companion]
    - Directory? [./]
    - Settings? [N] (It will auto-detect Vite)
3.  **Production Deploy**:
    ```bash
    vercel --prod
    ```

## 5. Codebase Cleanup Notes

- **Sandbox Scripts**: Removed.
- **Console Logs**: Minimized for cleaner console output.
- **Error Handling**: `AgentSkillService` and `GeminiLiveService` have try/catch blocks for tool execution.
- **Visuals**: A new "Recent Chats" widget appears on the home screen when you start fresh, ensuring easy access to history.

## Troubleshooting

- **Missing History?**: Click the "Clock" icon in the top right, or look for "Recent Memories" on the home screen.
- **Voice Issues?**: Ensure permissions are granted. If using Local Voice, ensure `server.py` is running on `localhost:8000`.
