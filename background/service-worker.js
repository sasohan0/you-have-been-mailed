/**
 * ==============================================================================
 * "You Have Been Mailed" - Manifest V3 Background Service Worker
 * ------------------------------------------------------------------------------
 * Manages background network relays (to bypass Gmail page CSP), chrome.storage
 * synchronization, and periodic alarm-driven status checks.
 * ==============================================================================
 */

// Auto-inject content scripts into all open Gmail tabs on install or worker start
async function autoInjectGmailTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://mail.google.com/*'] });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js']
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css']
        });
        console.log('[You Have Been Mailed] Auto-injected content script into tab:', tab.id);
      } catch (e) {
        // Tab might be in unloaded/restricted state
      }
    }
  } catch (err) {
    console.error('Auto-inject error:', err);
  }
}

// Dynamic rules to filter out own downloads from sender's Gmail tabs
const SELF_FILTER_RULE_ID = 1001;
const SELF_FILTER_RULE_USERCONTENT_ID = 1002;

async function setupSelfDownloadFilter() {
  if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
    try {
      // Clear any previous blocking rules so recipient mail tabs are never hindered
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [SELF_FILTER_RULE_ID, SELF_FILTER_RULE_USERCONTENT_ID]
      });
      console.log('[You Have Been Mailed] Network filter initialized cleanly.');
    } catch (err) {
      console.error('[You Have Been Mailed] declarativeNetRequest warning:', err);
    }
  }
}

// Lifecycle: Install & Update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[You Have Been Mailed] Extension installed/updated:', details.reason);
  
  // Initialize default storage values if not present
  const stored = await chrome.storage.local.get(['webAppUrl', 'trackingEnabled']);
  if (typeof stored.trackingEnabled === 'undefined') {
    await chrome.storage.local.set({ trackingEnabled: true });
  }

  // Setup background alarm for periodic check (every 30 minutes)
  if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.create) {
    chrome.alarms.create('yhbm-periodic-sync', { periodInMinutes: 30 });
  }

  // Setup network-level self-download blocker
  await setupSelfDownloadFilter();

  // Auto-inject into existing Gmail tabs
  await autoInjectGmailTabs();
});

// Periodic alarm handler
if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'yhbm-periodic-sync') {
      const { webAppUrl } = await chrome.storage.local.get('webAppUrl');
      if (webAppUrl) {
        try {
          const response = await fetch(`${webAppUrl}?action=getStatusSummary`);
          const json = await response.json();
          if (json && json.status === 'success' && json.summary) {
            await chrome.storage.local.set({ cachedSummary: json.summary });
            const overdueCount = json.summary.overdue || 0;
            if (overdueCount > 0) {
              await chrome.action.setBadgeText({ text: String(overdueCount) });
              await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
            } else {
              await chrome.action.setBadgeText({ text: '' });
            }
          }
        } catch (err) {
          console.error('[You Have Been Mailed] Background alarm sync error:', err);
        }
      }
    }
  });
}

// Message Passing Router for Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const action = message.action;

      // 1. ACTION: getStatusSummary
      if (action === 'getStatusSummary') {
        const targetUrl = message.webAppUrl;
        if (!targetUrl) {
          sendResponse({ status: 'error', message: 'No Web App URL provided' });
          return;
        }

        const res = await fetch(`${targetUrl}?action=getStatusSummary`, {
          method: 'GET',
          cache: 'no-store'
        });
        const json = await res.json();

        if (json && json.summary) {
          await chrome.storage.local.set({ cachedSummary: json.summary });
          const count = json.summary.overdue || 0;
          await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
          await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
        }

        sendResponse(json);
        return;
      }

      // 2. ACTION: logSent
      if (action === 'logSent') {
        const targetUrl = message.webAppUrl;
        if (!targetUrl) {
          sendResponse({ status: 'error', message: 'No Web App URL provided' });
          return;
        }

        const queryUrl = new URL(targetUrl);
        queryUrl.searchParams.set('action', 'logSent');
        queryUrl.searchParams.set('token', message.token || ('m_' + Date.now()));
        queryUrl.searchParams.set('recipient', message.recipient || '');
        queryUrl.searchParams.set('to', message.recipient || '');
        queryUrl.searchParams.set('subject', message.subject || '');
        queryUrl.searchParams.set('body', message.body || '');

        const res = await fetch(queryUrl.toString(), {
          method: 'GET',
          cache: 'no-store'
        });
        const json = await res.json();

        // Refresh and cache summary immediately
        try {
          const sumRes = await fetch(`${targetUrl}?action=getStatusSummary`, { cache: 'no-store' });
          const sumJson = await sumRes.json();
          if (sumJson && sumJson.summary) {
            await chrome.storage.local.set({ cachedSummary: sumJson.summary });
          }
        } catch (e) {}

        sendResponse(json);
        return;
      }

      // 3. ACTION: testConnection
      if (action === 'testConnection') {
        const targetUrl = message.webAppUrl;
        if (!targetUrl) {
          sendResponse({ status: 'error', message: 'No Web App URL provided' });
          return;
        }

        const res = await fetch(`${targetUrl}?action=getStatusSummary`, {
          method: 'GET',
          cache: 'no-store'
        });
        const json = await res.json();
        if (json && json.summary) {
          await chrome.storage.local.set({ cachedSummary: json.summary });
        }
        sendResponse({ status: 'success', summary: json.summary || null });
        return;
      }

      // 4. ACTION: bulkFollowUp
      if (action === 'bulkFollowUp') {
        const targetUrl = message.webAppUrl;
        const targets = message.targets || [];
        
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'bulkFollowUp',
            targets: targets
          })
        });
        const json = await res.json();
        sendResponse(json);
        return;
      }

      // 5. ACTION: openDashboard
      if (action === 'openDashboard') {
        const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
        await chrome.tabs.create({ url: dashboardUrl });
        sendResponse({ status: 'success' });
        return;
      }

      sendResponse({ status: 'error', message: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[You Have Been Mailed] SW notice:', err.message || err);
      sendResponse({ status: 'error', message: err.toString() });
    }
  })();

  return true; // Keep message channel open for async response
});

// Run on worker startup
autoInjectGmailTabs();
setupSelfDownloadFilter();
