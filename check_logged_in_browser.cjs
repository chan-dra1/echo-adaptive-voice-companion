const puppeteer = require('puppeteer');

(async () => {
  const ports = [9222, 9223, 9224];
  let connected = false;

  for (const port of ports) {
    try {
      console.log(`Checking remote Chrome debugging on port ${port}...`);
      const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
      connected = true;
      const pages = await browser.pages();
      console.log(`Successfully connected to Chrome on port ${port}! Open tabs count: ${pages.length}`);

      for (let i = 0; i < pages.length; i++) {
        const url = pages[i].url();
        const title = await pages[i].title();
        console.log(`Tab [${i}]: "${title}" -> ${url}`);

        // If this tab is Supabase or AI Studio, let's extract inputs or tokens
        if (url.includes('supabase.com')) {
          console.log(`--> Inspecting Supabase page...`);
          await pages[i].screenshot({ path: `/Users/ncsr/.gemini/antigravity/brain/f3100df7-9229-45dc-9f1f-dc059f85f26e/supabase_tab_${i}.png` });
        }
        if (url.includes('aistudio.google.com')) {
          console.log(`--> Inspecting Google AI Studio page...`);
          await pages[i].screenshot({ path: `/Users/ncsr/.gemini/antigravity/brain/f3100df7-9229-45dc-9f1f-dc059f85f26e/aistudio_tab_${i}.png` });
        }
      }

      await browser.disconnect();
      break;
    } catch (err) {
      console.log(`Port ${port} not open: ${err.message}`);
    }
  }

  if (!connected) {
    console.log('NO_REMOTE_CHROME_FOUND');
  }
})();
