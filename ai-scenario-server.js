const http = require('http');
const { exec } = require('child_process');

const server = http.createServer((req, res) => {
  // Enable CORS so the mcp-inspector UI can call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/run-scenario') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const { url, prompt } = JSON.parse(body);
        console.log(`\n🚀 Received Dynamic Scenario Request!`);
        console.log(`URL: ${url}`);
        console.log(`Prompt: ${prompt}`);

        // A basic playwright script that opens a VISIBLE browser
        // Using process.env prevents multiline prompts from breaking the script syntax!
        const script = `
          const { chromium } = require('playwright');
          (async () => {
            console.log('Launching browser...');
            const browser = await chromium.launch({ headless: false, slowMo: 300 });
            const page = await browser.newPage();
            
            console.log('Navigating to ' + process.env.TEST_URL);
            await page.goto(process.env.TEST_URL, { waitUntil: 'networkidle' }).catch(e => console.log('Navigation took too long, continuing...'));
            
            if (process.env.TEST_PROMPT.toLowerCase().includes('login')) {
              console.log('Simulating login flow...');
              try {
                let emailInput = page.locator('input[type="email"]');
                if (await emailInput.count() === 0) emailInput = page.locator('input[name="email"]');
                if (await emailInput.count() === 0) emailInput = page.locator('input[type="text"]').first();
                await emailInput.fill('qarajendra4893@gmail.com');
                
                const passInput = page.locator('input[type="password"]').first();
                await passInput.fill('rgp@1234');
                
                const btn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Continue")').first();
                await btn.click();
              } catch(err) {
                console.log('Could not complete login flow automatically.');
              }
            }

            console.log('Scenario complete. Taking a screenshot of the final result...');
            await page.waitForTimeout(4000); // Wait for animations to settle
            const path = require('path');
            const screenshotPath = path.join(__dirname, 'scenario-result.png');
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log('Screenshot saved to: ' + screenshotPath);
            await browser.close();
          })();
        `;
        
        const fs = require('fs');
        const path = require('path');
        const tempScriptPath = path.join(__dirname, 'temp-scenario.js');
        
        fs.writeFileSync(tempScriptPath, script, 'utf8');

        // Execute the script as a child process using the temporary file
        const childEnv = Object.assign({}, process.env, { 
          TEST_URL: url, 
          TEST_PROMPT: prompt 
        });

        exec(`node temp-scenario.js`, { env: childEnv }, (err, stdout, stderr) => {
          if (err) console.error('Error running scenario:', err);
          if (stderr) console.error('Playwright Error:', stderr);
          if (stdout) console.log('Script Output:', stdout);
          
          // Cleanup temp file
          try { fs.unlinkSync(tempScriptPath); } catch(e) {}
        });

        // Respond immediately to the frontend UI
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', message: 'Browser launched successfully!' }));
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = 9301;
server.listen(PORT, () => {
  console.log(`🤖 AI Scenario Backend Server running on http://localhost:${PORT}`);
  console.log('Ready to receive scenario requests from the UI!');
});
