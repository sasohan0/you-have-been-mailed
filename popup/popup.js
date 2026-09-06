/**
 * ==============================================================================
 * Popup Controller - "You Have Been Mailed"
 * ==============================================================================
 */

document.addEventListener('DOMContentLoaded', async () => {
  const webAppUrlInput = document.getElementById('webAppUrl');
  const saveBtn = document.getElementById('saveBtn');
  const syncNowBtn = document.getElementById('syncNowBtn');
  const openDashboardBtn = document.getElementById('openDashboardBtn');
  const trackingToggle = document.getElementById('trackingToggle');
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const footerMsg = document.getElementById('footerMsg');

  const metricSent = document.getElementById('metricSent');
  const metricOpened = document.getElementById('metricOpened');
  const metricReplied = document.getElementById('metricReplied');
  const metricOverdue = document.getElementById('metricOverdue');

  // Load existing config and cached summary
  const stored = await chrome.storage.local.get(['webAppUrl', 'trackingEnabled', 'cachedSummary']);
  
  if (stored.webAppUrl) {
    webAppUrlInput.value = stored.webAppUrl;
    
    // Instantly show connected state & cached metrics (0 delay)
    setStatus('connected', 'Connected');
    setMessage('Connected to Google Sheet database.');
    
    if (stored.cachedSummary) {
      updateMetricsDisplay(stored.cachedSummary);
    }

    // Silently refresh in background without disturbing the connected pill
    silentSync(stored.webAppUrl);
  } else {
    setStatus('disconnected', 'Not Configured');
    setMessage('Paste your deployed Web App URL above.');
  }

  if (typeof stored.trackingEnabled !== 'undefined') {
    trackingToggle.checked = stored.trackingEnabled;
  }

  // Toggle Tracking Handler
  trackingToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ trackingEnabled: trackingToggle.checked });
    setMessage(trackingToggle.checked ? 'Tracking is active.' : 'Tracking is paused.');
  });

  // Save URL Handler
  saveBtn.addEventListener('click', async () => {
    const url = webAppUrlInput.value.trim();
    if (!url) {
      setStatus('disconnected', 'Empty URL');
      setMessage('Please provide a valid Google Apps Script Web App URL.');
      return;
    }

    if (!url.startsWith('https://script.google.com/macros/s/')) {
      setMessage('Warning: URL should typically start with https://script.google.com/macros/s/...');
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Testing...';
    setStatus('loading', 'Connecting...');

    await chrome.storage.local.set({ webAppUrl: url });
    await testAndSync(url, false);

    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  });

  // Sync Now Handler
  syncNowBtn.addEventListener('click', async () => {
    const { webAppUrl } = await chrome.storage.local.get('webAppUrl');
    if (!webAppUrl) {
      setMessage('Configure Web App URL first.');
      return;
    }
    syncNowBtn.disabled = true;
    setStatus('loading', 'Syncing...');
    await testAndSync(webAppUrl, false);
    syncNowBtn.disabled = false;
  });

  // Open Dashboard Handler
  openDashboardBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openDashboard' });
  });

  function updateMetricsDisplay(summary) {
    if (!summary) return;
    metricSent.textContent = summary.total ?? 0;
    metricOpened.textContent = summary.opened ?? 0;
    metricReplied.textContent = summary.replied ?? 0;
    metricOverdue.textContent = summary.overdue ?? 0;
  }

  // Background silent sync
  async function silentSync(url) {
    try {
      const response = await fetch(`${url}?action=getStatusSummary`, {
        method: 'GET',
        cache: 'no-store'
      });
      const res = await response.json();
      if (res && res.status === 'success' && res.summary) {
        updateMetricsDisplay(res.summary);
        await chrome.storage.local.set({ cachedSummary: res.summary });
      }
    } catch (e) {
      // Keep existing cached state on transient network hiccup
      console.warn('Silent sync error:', e);
    }
  }

  // Explicit test and sync
  async function testAndSync(url, silent = false) {
    if (!silent) {
      setStatus('loading', 'Connecting...');
      setMessage('Testing connection to Apps Script...');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${url}?action=getStatusSummary`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const res = await response.json();
      if (res && res.status === 'success') {
        setStatus('connected', 'Connected');
        setMessage('Connected to Google Sheet database.');

        if (res.summary) {
          updateMetricsDisplay(res.summary);
          await chrome.storage.local.set({ cachedSummary: res.summary });
        }

        // Notify background service worker to update action badge
        try {
          chrome.runtime.sendMessage({ action: 'getStatusSummary', webAppUrl: url }, () => {
            if (chrome.runtime.lastError) { /* ignore */ }
          });
        } catch (swErr) {}

        return true;
      } else {
        setStatus('disconnected', 'Response Error');
        setMessage(res.message || 'Apps Script returned an unexpected response.');
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      setStatus('disconnected', 'Connection Error');
      if (err.name === 'AbortError') {
        setMessage('Request timed out. Please check your Web App URL.');
      } else {
        setMessage('Connection failed: ' + (err.message || 'Check Web App permissions'));
      }
      return false;
    }
  }

  function setStatus(type, label) {
    statusPill.className = `status-pill status-${type}`;
    statusText.textContent = label;
  }

  function setMessage(msg) {
    footerMsg.textContent = msg;
  }
});
