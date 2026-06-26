import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222'
    });
    
    // We can open the page or use the existing page
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('aistudio.google.com/app/apikey'));
    if (!page) {
      page = await browser.newPage();
      await page.goto('https://aistudio.google.com/app/apikey', { waitUntil: 'networkidle2' });
    }
    
    // Grant clipboard read permission
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(page.url(), ['clipboard-read']);
    
    // Let's find all copy buttons
    const keyData = await page.evaluate(async () => {
      // Find all rows in the API keys table or elements containing keys
      const copyButtons = Array.from(document.querySelectorAll('button'));
      // Filter buttons that have a class or attributes indicating copy
      // Usually they have icon buttons or specific classes. Let's find buttons with icon
      const copyBtns = copyButtons.filter(b => b.innerHTML.includes('copy') || (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Copy')));
      
      console.log(`Found ${copyBtns.length} copy buttons`);
      
      const keys = [];
      for (let i = 0; i < copyBtns.length; i++) {
        copyBtns[i].click();
        // Wait a brief moment
        await new Promise(r => setTimeout(r, 500));
        try {
          const text = await navigator.clipboard.readText();
          keys.push(text);
        } catch (e) {
          keys.push('Error reading clipboard: ' + e.message);
        }
      }
      return keys;
    });
    
    console.log('Scraped Keys:', keyData);
    await browser.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
})();
