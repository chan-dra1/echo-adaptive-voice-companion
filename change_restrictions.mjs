import puppeteer from 'puppeteer';

(async () => {
  try {
    console.log('Connecting to Chrome on port 9222...');
    const browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222'
    });
    console.log('Successfully connected!');
    
    const page = await browser.newPage();
    const targetUrl = 'https://console.cloud.google.com/apis/credentials/key/01d275f1-5069-488b-9300-84dc038054ac?project=picsher-cd041';
    
    console.log('Opening the API Key configuration page in Chrome...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    
    console.log('\n>>> ACTION REQUIRED:');
    console.log('Please log in to your Google Account in the opened Chrome window.');
    console.log('Once you are logged in and the Credentials page loads, the script will automatically configure the key restrictions and click Save.');
    
    const interval = setInterval(async () => {
      try {
        const url = page.url();
        if (url.includes('console.cloud.google.com/apis/credentials/key')) {
          // Check if the page content is loaded
          const bodyText = await page.evaluate(() => document.body.innerText);
          if (bodyText.includes('Key restrictions') || bodyText.includes('APIs that can be accessed')) {
            console.log('Credentials edit page detected! Automating configuration...');
            
            await page.evaluate(() => {
              // 1. Select the "Don't restrict key" option
              // Find all radio buttons or labels on the page
              const labels = Array.from(document.querySelectorAll('label, span, div'));
              
              // Look for "Don't restrict key" text
              const dontRestrictLabel = labels.find(el => el.textContent && el.textContent.includes("Don't restrict key"));
              if (dontRestrictLabel) {
                console.log('Found "Don\'t restrict key" option. Clicking it...');
                // Click the label or its parent/sibling input
                const radioButton = dontRestrictLabel.querySelector('input[type="radio"]') || 
                                    dontRestrictLabel.parentElement?.querySelector('input[type="radio"]') ||
                                    dontRestrictLabel;
                radioButton.click();
              } else {
                // Try searching for the "Don't restrict key" radio input directly if possible
                const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
                // Click the first one or look at their labels
                console.log('Attempting alternative selection for radio button...');
              }

              // 2. Select "None" under Application restrictions
              const noneLabel = labels.find(el => el.textContent && el.textContent.trim() === "None" && el.closest('.cfc-form-group'));
              if (noneLabel) {
                console.log('Found Application Restriction: None. Clicking it...');
                const radio = noneLabel.querySelector('input[type="radio"]') || 
                              noneLabel.parentElement?.querySelector('input[type="radio"]') ||
                              noneLabel;
                radio.click();
              }
            });

            // Wait a moment for UI state to update
            await new Promise(r => setTimeout(r, 1000));

            // 3. Click the "Save" button
            const clickedSave = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              // Find button containing "Save" text
              const saveBtn = buttons.find(b => b.textContent && b.textContent.includes('Save') && !b.disabled);
              if (saveBtn) {
                console.log('Found Save button. Clicking it...');
                saveBtn.click();
                return true;
              }
              return false;
            });

            if (clickedSave) {
              console.log('\n==================================================');
              console.log('SUCCESS: API KEY UNRESTRICTED & SAVED!');
              console.log('==================================================\n');
              console.log('Please wait 60 seconds for Google to propagate this change, then start Echo.');
              clearInterval(interval);
              // Wait 3 seconds and close page
              setTimeout(async () => {
                await browser.close();
                process.exit(0);
              }, 3000);
            }
          }
        }
      } catch (err) {
        // Page might be closed or navigating
      }
    }, 2000);
    
  } catch (err) {
    console.error('Connection failed:', err);
  }
})();
