# 🚀 Deploy Echo to Vercel - Complete Guide

## Quick Deploy (5 Minutes)

### Option 1: Deploy with Vercel CLI (Fastest)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy!
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? echo-ai (or whatever you want)
# - Directory? ./
# - Build command? npm run build
# - Output directory? dist

# 4. Your app is live! 🎉
# URL: https://echo-ai-xyz.vercel.app
```

### Option 2: Deploy via GitHub (Recommended for updates)

```bash
# 1. Initialize git repo
git init
git add .
git commit -m "Initial commit: Echo AI"

# 2. Create GitHub repo
# Go to github.com/new
# Name: echo-adaptive-voice-companion

# 3. Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/echo-adaptive-voice-companion.git
git branch -M main
git push -u origin main

# 4. Connect to Vercel
# Go to vercel.com/new
# Import your GitHub repo
# Click Deploy
```

### Option 3: One-Click Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/echo-adaptive-voice-companion)

---

## 🔧 Environment Variables Setup

### In Vercel Dashboard:

1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add these:

```
VITE_GEMINI_API_KEY = YOUR_GEMINI_API_KEY
VITE_SUPABASE_URL = (optional - for cloud sync)
VITE_SUPABASE_ANON_KEY = (optional - for cloud sync)
VITE_SERP_API_KEY = (optional - for web search)
VITE_RAPIDAPI_KEY = (optional - for travel deals)
```

---

## ✅ Post-Deployment Checklist

- [ ] App loads at your Vercel URL
- [ ] Voice recording works
- [ ] Gemini API connects
- [ ] LocalStorage persists data
- [ ] VoiceVault encrypts properly
- [ ] All features working

---

## 🌐 Custom Domain (Optional)

```bash
# Add custom domain in Vercel dashboard
# Settings → Domains → Add Domain

# Example: echo.yourdomain.com
```

---

## 🔄 Auto-Deploy Updates

Any push to `main` branch automatically deploys!

```bash
# Make changes
git add .
git commit -m "Added new feature"
git push

# ✓ Auto-deploys to Vercel
```

---

## 🐛 Troubleshooting

### Build Fails?
```bash
# Test locally first
npm run build

# If successful locally but fails on Vercel:
# Check Node version in vercel.json
```

### API Keys Not Working?
- Make sure variables start with `VITE_`
- Redeploy after adding variables
- Check browser console for errors

### CORS Issues?
- Already handled in vercel.json
- If persists, add to vite.config.ts

---

Ready to deploy? Run: `vercel` 🚀
