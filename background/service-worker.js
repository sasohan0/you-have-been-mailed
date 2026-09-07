/**
 * ==============================================================================
 * "You Have Been Mailed" - Manifest V3 Background Service Worker (v2.1 Pro)
 * ------------------------------------------------------------------------------
 * Manages background network relays (to bypass Gmail page CSP), chrome.storage
 * synchronization, and periodic alarm-driven status checks.
 * ==============================================================================
 */

// Helper: Safely fetch JSON without crashing on network error or HTML error pages
async function safeFetchJson(url, options = {}) {
  try {
    const controller = new AbortController();
    const timeout = options.timeout || 25000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const fetchOptions = { ...options, signal: controller.signal };
    delete fetchOptions.timeout;

    const res = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (parseErr) {
      console.log('[You Have Been Mailed] Non-JSON response received from Apps Script Web App:', text.slice(0, 100));
      return {
        status: 'error',
        message: 'Non-JSON response from Apps Script. Verify deployment access is set to "Anyone".'
      };
    }
  } catch (netErr) {
    console.log('[You Have Been Mailed] Background fetch notice:', netErr.message || netErr);
    return {
      status: 'error',
      message: netErr.message || 'Network request failed'
    };
  }
}

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
    console.warn('Auto-inject notice:', err.message || err);
  }
}

// Dynamic rules to filter out own downloads from sender's Gmail tabs
const SELF_FILTER_RULE_ID = 1001;
const SELF_FILTER_RULE_USERCONTENT_ID = 1002;

async function setupSelfDownloadFilter() {
  if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [SELF_FILTER_RULE_ID, SELF_FILTER_RULE_USERCONTENT_ID]
      });
      console.log('[You Have Been Mailed] Network filter initialized cleanly.');
    } catch (err) {
      console.warn('[You Have Been Mailed] declarativeNetRequest notice:', err.message || err);
    }
  }
}

// Lifecycle: Install & Update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[You Have Been Mailed] Extension installed/updated:', details.reason);

  try {
    const stored = await chrome.storage.local.get(['webAppUrl', 'trackingEnabled']);
    if (typeof stored.trackingEnabled === 'undefined') {
      await chrome.storage.local.set({ trackingEnabled: true });
    }

    // Setup background alarm for periodic check (every 30 minutes)
    if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.create) {
      chrome.alarms.create('yhbm-periodic-sync', { periodInMinutes: 30 });
    }

    await setupSelfDownloadFilter();
    await autoInjectGmailTabs();
  } catch (err) {
    console.warn('[You Have Been Mailed] onInstalled notice:', err.message || err);
  }
});

// Periodic alarm handler
if (typeof chrome !== 'undefined' && chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'yhbm-periodic-sync') {
      try {
        const { webAppUrl } = await chrome.storage.local.get('webAppUrl');
        if (webAppUrl) {
          const json = await safeFetchJson(`${webAppUrl}?action=getStatusSummary`, { cache: 'no-store' });
          if (json && json.status === 'success' && json.summary) {
            await chrome.storage.local.set({ cachedSummary: json.summary });
            const overdueCount = json.summary.overdue || 0;
            if (overdueCount > 0) {
              await chrome.action.setBadgeText({ text: String(overdueCount) });
              await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
            } else {
              await chrome.action.setBadgeText({ text: '' });
            }

            // Automatically execute scheduled drip cycle if enabled in settings
            if (json.summary.dripEnabled) {
              await safeFetchJson(`${webAppUrl}?action=runAutoFollowUpDrip`, {
                method: 'GET',
                cache: 'no-store'
              });
            }
          }
        }
      } catch (err) {
        console.log('[You Have Been Mailed] Background alarm sync notice:', err.message || err);
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

        const json = await safeFetchJson(`${targetUrl}?action=getStatusSummary`, {
          method: 'GET',
          cache: 'no-store'
        });

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

        try {
          const queryUrl = new URL(targetUrl);
          queryUrl.searchParams.set('action', 'logSent');
          queryUrl.searchParams.set('token', message.token || ('m_' + Date.now()));
          queryUrl.searchParams.set('recipient', message.recipient || '');
          queryUrl.searchParams.set('to', message.recipient || '');
          queryUrl.searchParams.set('subject', message.subject || '');
          queryUrl.searchParams.set('body', message.body || '');

          const json = await safeFetchJson(queryUrl.toString(), {
            method: 'GET',
            cache: 'no-store'
          });

          // Refresh and cache summary
          safeFetchJson(`${targetUrl}?action=getStatusSummary`, { cache: 'no-store' })
            .then(sumJson => {
              if (sumJson && sumJson.summary) {
                chrome.storage.local.set({ cachedSummary: sumJson.summary });
              }
            }).catch(() => {});

          sendResponse(json);
          return;
        } catch (urlErr) {
          sendResponse({ status: 'error', message: 'Invalid target Web App URL format' });
          return;
        }
      }

      // 3. ACTION: testConnection
      if (action === 'testConnection') {
        const targetUrl = message.webAppUrl;
        if (!targetUrl) {
          sendResponse({ status: 'error', message: 'No Web App URL provided' });
          return;
        }

        const json = await safeFetchJson(`${targetUrl}?action=getStatusSummary`, {
          method: 'GET',
          cache: 'no-store'
        });

        if (json && json.summary) {
          await chrome.storage.local.set({ cachedSummary: json.summary });
        }
        sendResponse({ status: json.status || 'success', summary: json.summary || null });
        return;
      }

      // 4. ACTION: singleFollowUp (1-Click Contextual Auto-Bump)
      if (action === 'singleFollowUp') {
        const targetUrl = message.webAppUrl;
        if (!targetUrl) {
          sendResponse({ status: 'error', message: 'No Web App URL provided' });
          return;
        }

        const json = await safeFetchJson(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'singleFollowUp',
            email: message.email || message.recruiterEmail,
            subject: message.subject,
            message: message.message,
            rowIndex: message.rowIndex
          })
        });

        sendResponse(json);
        return;
      }

      // 5. ACTION: bulkFollowUp
      if (action === 'bulkFollowUp') {
        const targetUrl = message.webAppUrl;
        const targets = message.targets || [];

        const json = await safeFetchJson(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'bulkFollowUp',
            targets: targets
          })
        });

        sendResponse(json);
        return;
      }

      // 6. ACTION: runAutoFollowUpDrip (Manual or scheduled trigger, with optional targets)
      if (action === 'runAutoFollowUpDrip') {
        const targetUrl = message.webAppUrl;
        const json = await safeFetchJson(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'runAutoFollowUpDrip',
            force: message.force,
            targets: message.targets || []
          })
        });
        sendResponse(json);
        return;
      }

      // 7. ACTION: getDripSettings & saveDripSettings
      if (action === 'getDripSettings') {
        const targetUrl = message.webAppUrl;
        const json = await safeFetchJson(`${targetUrl}?action=getDripSettings`, {
          method: 'GET',
          cache: 'no-store'
        });
        sendResponse(json);
        return;
      }

      if (action === 'saveDripSettings') {
        const targetUrl = message.webAppUrl;
        const json = await safeFetchJson(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'saveDripSettings',
            enabled: message.enabled,
            stage1: message.stage1,
            stage2: message.stage2,
            stage3: message.stage3
          })
        });
        sendResponse(json);
        return;
      }

      // 8. ACTION: openDashboard
      if (action === 'openDashboard') {
        const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
        await chrome.tabs.create({ url: dashboardUrl });
        sendResponse({ status: 'success' });
        return;
      }

      sendResponse({ status: 'error', message: `Unknown action: ${action}` });
    } catch (err) {
      console.warn('[You Have Been Mailed] SW notice:', err.message || err);
      sendResponse({ status: 'error', message: err.toString() });
    }
  })();

  return true; // Keep message channel open for async response
});

// Run on worker startup
autoInjectGmailTabs();
setupSelfDownloadFilter();
