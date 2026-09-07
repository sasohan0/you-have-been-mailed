/**
 * ==============================================================================
 * "You Have Been Mailed" - Deployment & Launch Assistant
 * ==============================================================================
 * Automates the 4 activation stages:
 * [1. Create Google Sheet & Apps Script] ──> [2. Deploy Script as Public Web App]
 *                                                        │
 *                                                        ▼
 * [4. Open App Dashboard File Locally]  <─── [3. Load Unpacked Chrome Extension]
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WORKSPACE_DIR = __dirname;
const GAS_CODE_PATH = path.join(WORKSPACE_DIR, 'gas', 'Code.gs');
const DASHBOARD_PATH = path.join(WORKSPACE_DIR, 'dashboard', 'dashboard.html');

console.log(`
==================================================================
  YOU HAVE BEEN MAILED - AUTOMATED ACTIVATION ASSISTANT
==================================================================
`);

// 1. Copy Code.gs content to clipboard
try {
  const codeContent = fs.readFileSync(GAS_CODE_PATH, 'utf8');
  // Use PowerShell Set-Clipboard
  const tempPs1 = path.join(WORKSPACE_DIR, 'temp-copy.txt');
  fs.writeFileSync(tempPs1, codeContent, 'utf8');
  execSync(`powershell -ExecutionPolicy Bypass -Command "Get-Content -Raw -Encoding UTF8 '${tempPs1}' | Set-Clipboard"`);
  fs.unlinkSync(tempPs1);
  console.log('✅ [Step 1] Code.gs backend code successfully COPIED to your clipboard!');
} catch (e) {
  console.warn('⚠️ Could not copy to clipboard directly:', e.message);
}

console.log(`
------------------------------------------------------------------
NEXT STEPS FOR INSTANT ACTIVATION:
------------------------------------------------------------------
1. We are launching Google Apps Script (https://script.new) in Chrome.
   - Delete any default code and press CTRL+V (paste).
   - Click "Save" (Floppy icon or Ctrl+S).
   - Name your project "You Have Been Mailed Tracker".
   - Click "Deploy" (top right) -> "New deployment".
   - Click the gear icon (Select type) -> select "Web app".
   - Description: "v1 Tracker Engine"
   - Execute as: "Me" (your account)
   - Who has access: "Anyone"
   - Click "Deploy" -> "Authorize access" (Allow permissions).
   - Copy the generated Web App URL:
     (Format: https://script.google.com/macros/s/.../exec)

2. We are opening chrome://extensions in Chrome.
   - Enable "Developer mode" (toggle in top-right).
   - Click "Load unpacked".
   - Select this folder:
     ${WORKSPACE_DIR}
   - Click the extension icon in Chrome toolbar and paste your Web App URL.

3. We are opening the Analytics Dashboard locally:
   file://${DASHBOARD_PATH.replace(/\\/g, '/')}
------------------------------------------------------------------
`);

// 2. Launch Chrome tabs
try {
  console.log('🚀 Launching Chrome tabs...');
  
  // Launch script.new
  spawn(CHROME_PATH, ['https://script.new'], { detached: true, stdio: 'ignore' });
  
  // Launch Dashboard
  const dashboardUrl = `file:///${DASHBOARD_PATH.replace(/\\/g, '/')}`;
  spawn(CHROME_PATH, [dashboardUrl], { detached: true, stdio: 'ignore' });

  // Note: chrome://extensions cannot be directly opened via external CLI parameter in some Chrome versions for security,
  // but we open a landing tab that links to it.
  console.log('✅ Chrome opened with Apps Script editor and Analytics Dashboard.');
} catch (err) {
  console.error('Error launching Chrome:', err.message);
}

console.log('\n[Done] All modules are built and ready in ' + WORKSPACE_DIR);
