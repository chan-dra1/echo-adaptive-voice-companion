import puppeteer from 'puppeteer';
import { join } from 'path';

const APP_URL = 'http://127.0.0.1:3000/';
const ARTIFACT_DIR = '/Users/ncsr/.gemini/antigravity/brain/f3100df7-9229-45dc-9f1f-dc059f85f26e';

async function run() {
  console.log('🚀 Starting Verification of Full Audio & Connection Flow...');
  
  // Launch browser with fake media devices (microphone sends a constant tone)
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', (msg) => {
    console.log(`[Browser Console - ${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    console.error(`[Browser JS Error] ${err.toString()}`);
  });

  try {
    console.log(`🔗 1. Navigating to ${APP_URL}...`);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: join(ARTIFACT_DIR, 'step1_navigation.png') });

    console.log('🔗 2. Skipping onboarding...');
    const onboardingSkipped = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const skipBtn = elements.find(e => e.textContent && e.textContent.includes('[SKIP]'));
      if (skipBtn) {
        skipBtn.click();
        return true;
      }
      return false;
    });
    console.log('Onboarding skipped click result:', onboardingSkipped);
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: join(ARTIFACT_DIR, 'step2_onboarding_skipped.png') });

    const geminiKey = process.env.GEMINI_API_KEY || '';
    console.log('🔗 3. Injecting Gemini Key & Model configurations directly...');
    await page.evaluate((key) => {
      if (key) localStorage.setItem('echo_api_key', key);
      localStorage.setItem('echo_live_model', 'gemini-2.5-flash-native-audio-preview-12-2025');
      localStorage.setItem('echo_default_brain', 'gemini');
      localStorage.setItem('echo_voice_engine', 'gemini_live');
      localStorage.setItem('echo_stealth_mode', 'false');
    }, geminiKey);

    console.log('🔗 4. Reloading the page to apply settings...');
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));

    // Skip onboarding again if it appears after reload
    await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      const skipBtn = elements.find(e => e.textContent && e.textContent.includes('[SKIP]'));
      if (skipBtn) skipBtn.click();
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: join(ARTIFACT_DIR, 'step3_post_reload.png') });

    console.log('🔗 5. Clicking the green mic button to establish live session...');
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const micButton = buttons.find(b => 
        b.className.includes('rounded-full') && 
        b.className.includes('p-6')
      );
      if (micButton) {
        micButton.click();
        return true;
      }
      return false;
    });
    console.log('Mic button clicked status:', clicked);
    await new Promise(r => setTimeout(r, 5000)); // Wait for connection to open
    await page.screenshot({ path: join(ARTIFACT_DIR, 'step4_after_connect.png') });

    console.log('🔗 6. Sending text message over Live session to trigger speech response...');
    await page.evaluate(() => {
      if (window.liveService) {
        window.liveService.sendTextMessage("Hello! Please speak back and say: Audio output is fully operational.");
      } else {
        console.error('window.liveService is not defined!');
      }
    });

    console.log('🔗 7. Monitoring volume levels for audio activity...');
    let maxOutputVol = 0;
    for (let i = 0; i < 15; i++) {
      const levels = await page.evaluate(() => {
        return {
          inputVol: window._lastInputVol || 0,
          outputVol: window._lastOutputVol || 0,
          audioContextState: window.AudioContext ? 'defined' : 'undefined'
        };
      });
      console.log(`[Second ${i}] Input Volume: ${levels.inputVol.toFixed(2)} | Output Volume: ${levels.outputVol.toFixed(2)}`);
      if (levels.outputVol > maxOutputVol) {
        maxOutputVol = levels.outputVol;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    
    await page.screenshot({ path: join(ARTIFACT_DIR, 'step5_after_audio.png') });

    console.log(`\n==================================================`);
    console.log(`VERIFICATION SUMMARY:`);
    console.log(`Maximum Output Volume recorded: ${maxOutputVol.toFixed(2)}`);
    if (maxOutputVol > 0) {
      console.log(`✅ SUCCESS: Audio output was generated and processed successfully!`);
    } else {
      console.log(`❌ FAILURE: No audio output was detected.`);
    }
    console.log(`==================================================\n`);

  } catch (error) {
    console.error('❌ Verification flow failed:', error);
  } finally {
    await browser.close();
    console.log('🔒 Browser closed.');
    process.exit(0);
  }
}

run();
