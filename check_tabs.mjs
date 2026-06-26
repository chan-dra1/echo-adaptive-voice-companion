import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222'
    });
    const pages = await browser.pages();
    console.log('=== OPEN TABS ===');
    for (let i = 0; i < pages.length; i++) {
      console.log(`[Tab ${i}] Title: ${await pages[i].title()}`);
      console.log(`      URL: ${pages[i].url()}`);
    }
    await browser.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
})();
