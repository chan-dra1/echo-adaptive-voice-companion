import puppeteer from 'puppeteer';
import { join } from 'path';

const API_KEY = 'AIzaSyBB0YKHm4KuitM4G5G_a-eh2_CuNuF56yA';
const APP_URL = 'http://127.0.0.1:3000/';
const ARTIFACT_DIR = '/Users/ncsr/.gemini/antigravity/brain/f3100df7-9229-45dc-9f1f-dc059f85f26e';

console.log('🤖 Starting dynamic skill integration test...');

async function run() {
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
    console.log(`🔗 Navigating to ${APP_URL}...`);
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });

    console.log('🔑 Setting API key and inserting dynamic skill into IndexedDB...');
    await page.evaluate((key) => {
      localStorage.setItem('echo_api_key', key);
      
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('echo-dynamic-skills', 1);
        req.onupgradeneeded = (e) => {
          const db = req.result;
          if (!db.objectStoreNames.contains('skills')) {
            db.createObjectStore('skills', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('skills', 'readwrite');
          const store = tx.objectStore('skills');
          
          store.put({
            id: 'fetch_crypto_price_id',
            name: 'fetch_crypto_price',
            description: 'Fetch the current price of a cryptocurrency.',
            schema: {
              name: 'fetch_crypto_price',
              description: 'Fetch the current price of a cryptocurrency.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  cryptoid: { type: 'STRING', description: 'The ID of the cryptocurrency (e.g., bitcoin).' },
                  currency: { type: 'STRING', description: 'The target currency (e.g., usd).' }
                },
                required: ['cryptoid']
              }
            },
            jsCode: `skill = {
              execute: async (toolName, args) => {
                const cryptoid = args.cryptoid || 'bitcoin';
                const currency = args.currency || 'usd';
                try {
                  const response = await fetch(\`https://api.coingecko.com/api/v3/simple/price?ids=\${cryptoid}&vs_currencies=\${currency}\`);
                  if (!response.ok) {
                    throw new Error('Network response was not ok');
                  }
                  return await response.json();
                } catch (error) {
                  return { error: error.message };
                }
              }
            };`,
            permissions: { fetchAllowlist: ['api.coingecko.com'] },
            createdAt: Date.now(),
            approvedAt: Date.now()
          });
          
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    }, API_KEY);

    console.log('🔄 Reloading page to load the dynamic skill...');
    await page.reload({ waitUntil: 'networkidle2' });

    console.log('🎙️ Connecting microphone to start the Live session...');
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
    console.log('Clicked connect button:', clicked);

    console.log('💬 Locating text chat input to query Echo...');
    const inputSelector = 'input[placeholder*="Message Echo"]';
    await page.waitForSelector(inputSelector);
    
    console.log('✍️ Querying: "What is the current price of Bitcoin?"...');
    await page.type(inputSelector, 'What is the current price of Bitcoin?');
    await page.keyboard.press('Enter');

    console.log('⏱️ Monitoring tool call and output for 15 seconds...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log('📸 Taking final screenshot...');
    await page.screenshot({ path: join(ARTIFACT_DIR, 'crypto_skill_test.png') });
    console.log('📸 Screenshot saved: crypto_skill_test.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    console.log('🔒 Closing browser...');
    await browser.close();
    process.exit(0);
  }
}

run();
