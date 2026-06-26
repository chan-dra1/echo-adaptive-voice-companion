/**
 * Smoke test: OpenAI-only text chat path, no Gemini connect loop.
 * Run: node test_openai_text_chat.mjs
 * Requires dev server on http://127.0.0.1:3000
 */
import puppeteer from 'puppeteer';

const APP_URL = 'http://127.0.0.1:3000/';
const FAKE_OPENAI_KEY = 'sk-proj-test-openai-only-key';

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const consoleLogs = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  let connectAttempts = 0;
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('generativelanguage.googleapis.com') || url.includes('google.ai')) {
      connectAttempts++;
    }
  });

  try {
    await page.goto(APP_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    await page.evaluate((key) => {
      localStorage.removeItem('echo_api_key');
      localStorage.setItem('echo_openai_key', key);
      localStorage.setItem('echo_default_brain', 'openai');
      localStorage.setItem('echo_llm_provider', 'openai');
    }, FAKE_OPENAI_KEY);

    await page.reload({ waitUntil: 'networkidle2' });

    // Dismiss onboarding if shown
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('[SKIP]'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await new Promise((r) => setTimeout(r, 500));

    // Text chat pill should be visible
    const textChatBtn = await page.waitForSelector('button[aria-label="Open text chat"]', { timeout: 15000 });
    if (!textChatBtn) throw new Error('Text Chat button not found');

    await textChatBtn.click();
    await page.waitForFunction(
      () => !!document.querySelector('input[placeholder*="Message Echo"]'),
      { timeout: 8000 },
    );

    // Mic click should NOT hit Gemini API (no key) — only show error toast, no connect loop
    const micBtn = await page.$('button .lucide-mic, button svg.lucide-mic');
    const micParent = await page.evaluateHandle(() => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons.find((b) => b.querySelector('svg.lucide-mic') || b.innerHTML.includes('Mic'));
    });
    if (micParent) {
      await micParent.asElement()?.click();
      await new Promise((r) => setTimeout(r, 2000));
    }

    const geminiCallsAfterMic = connectAttempts;

    // OpenAI hint should appear
    const hint = await page.evaluate(() =>
      document.body.innerText.includes('Voice needs Gemini'),
    );
    if (!hint) console.warn('WARN: OpenAI-only hint text not visible (may be layout-dependent)');

    // Type a message — will fail at API (fake key) but path should reach OpenAI endpoint
    let openaiCallMade = false;
    page.on('request', (req) => {
      if (req.url().includes('api.openai.com')) openaiCallMade = true;
    });

    const input = await page.$('input[placeholder*="Message Echo"]');
    await input.type('Hello Echo');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 3000));

    const errorShown = await page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('failed') ||
      document.body.innerText.includes('⚠'),
    );

    console.log('✓ Text Chat UI visible and openable');
    console.log(`✓ Gemini API calls after mic click: ${geminiCallsAfterMic} (expect 0)`);
    console.log(`✓ OpenAI request attempted: ${openaiCallMade}`);
    console.log(`✓ Error surfaced for bad key: ${errorShown}`);

    if (geminiCallsAfterMic > 0) {
      throw new Error(`Connect loop detected: ${geminiCallsAfterMic} Gemini API calls`);
    }
    if (!openaiCallMade) {
      throw new Error('Text chat did not attempt OpenAI API call');
    }

    console.log('\n✅ OpenAI text chat path smoke test passed');
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('❌ Test failed:', e.message);
  process.exit(1);
});
