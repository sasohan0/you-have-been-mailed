/**
 * ==============================================================================
 * "You Have Been Mailed" - Analytics Control Dashboard Controller
 * ------------------------------------------------------------------------------
 * Zero-dependency, Manifest V3 CSP-compliant controller.
 * ==============================================================================
 */

document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // Application State
  const appState = {
    webAppUrl: '',
    logs: [],
    filter: 'all',
    searchQuery: '',
    selectedOverdue: new Set(),
    dripSettings: {
      enabled: false,
      stage1: '',
      stage2: '',
      stage3: ''
    },
    activeDripStage: 'stage1',
    singleBumpTarget: null
  };

  // Follow-Up Presets
  const presets = {
    gentle: "Hi {{name}},\n\nI just wanted to follow up on my previous note regarding \"{{subject}}\" and see if you had a chance to review it. Looking forward to connecting!\n\nBest regards,",
    value: "Hi {{name}},\n\nCircling back on our thread regarding \"{{subject}}\". I recently completed a relevant project and thought it might be directly pertinent to your team. Would love to share brief notes when convenient.\n\nBest,",
    closure: "Hi {{name}},\n\nFollowing up one last time on \"{{subject}}\". I realize you are likely busy or priorities may have shifted, so I will close the loop here unless I hear back. Wishing you all the best!\n\nBest,"
  };

  // Initialize default drip stage templates
  appState.dripSettings.stage1 = presets.gentle;
  appState.dripSettings.stage2 = presets.value;
  appState.dripSettings.stage3 = presets.closure;

  // DOM Elements
  const webAppInput = document.getElementById('webAppInput');
  const connectBtn = document.getElementById('connectBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const cleanLogsBtn = document.getElementById('cleanLogsBtn');
  const connDot = document.getElementById('connDot');
  const connLabel = document.getElementById('connLabel');

  const hudSent = document.getElementById('hudSent');
  const hudOpened = document.getElementById('hudOpened');
  const hudOpenRate = document.getElementById('hudOpenRate');
  const hudUnopened = document.getElementById('hudUnopened');
  const hudReplied = document.getElementById('hudReplied');
  const hudReplyRate = document.getElementById('hudReplyRate');
  const hudFollowUps = document.getElementById('hudFollowUps');

  const cardSent = document.querySelector('.card-sent');
  const cardOpened = document.querySelector('.card-opened');
  const cardUnopened = document.querySelector('.card-unopened');
  const cardReplied = document.querySelector('.card-replied');
  const cardFollowup = document.querySelector('.card-followup');

  const badgeTotalLogs = document.getElementById('badgeTotalLogs');
  const badgeOverdueLogs = document.getElementById('badgeOverdueLogs');

  const logsTableBody = document.getElementById('logsTableBody');
  const overdueTableBody = document.getElementById('overdueTableBody');
  const logSearchInput = document.getElementById('logSearchInput');
  const selectAllOverdue = document.getElementById('selectAllOverdue');
  const batchAutoBumpBtn = document.getElementById('batchAutoBumpBtn');
  const selectedBumpCount = document.getElementById('selectedBumpCount');
  const followUpMessageTemplate = document.getElementById('followUpMessageTemplate');

  // Modals & Single Auto-Bump
  const snippetModal = document.getElementById('snippetModal');
  const snippetModalTitle = document.getElementById('snippetModalTitle');
  const snippetModalMeta = document.getElementById('snippetModalMeta');
  const snippetModalBody = document.getElementById('snippetModalBody');
  const closeSnippetModal = document.getElementById('closeSnippetModal');
  const closeSnippetModalBtn = document.getElementById('closeSnippetModalBtn');

  const singleBumpModal = document.getElementById('singleBumpModal');
  const singleBumpRecipient = document.getElementById('singleBumpRecipient');
  const singleBumpSubject = document.getElementById('singleBumpSubject');
  const singleBumpMessage = document.getElementById('singleBumpMessage');
  const closeSingleBumpModal = document.getElementById('closeSingleBumpModal');
  const cancelSingleBumpBtn = document.getElementById('cancelSingleBumpBtn');
  const confirmSingleBumpBtn = document.getElementById('confirmSingleBumpBtn');

  // 3-Stage Drip Elements
  const dripToggle = document.getElementById('dripToggle');
  const dripStatusLabel = document.getElementById('dripStatusLabel');
  const dripTemplateTextarea = document.getElementById('dripTemplateTextarea');
  const saveDripSettingsBtn = document.getElementById('saveDripSettingsBtn');
  const runDripNowBtn = document.getElementById('runDripNowBtn');

  const batchModal = document.getElementById('batchModal');
  const batchRecipientCount = document.getElementById('batchRecipientCount');
  const batchPreviewBox = document.getElementById('batchPreviewBox');
  const closeBatchModal = document.getElementById('closeBatchModal');
  const cancelBatchBtn = document.getElementById('cancelBatchBtn');
  const confirmBatchBtn = document.getElementById('confirmBatchBtn');
  const toastContainer = document.getElementById('toastContainer');

  // ----------------------------------------------------------------------------
  // Storage & Initialization
  // ----------------------------------------------------------------------------

  async function loadInitialUrl() {
    let savedUrl = '';

    // 1. Try chrome.storage.local (extension context)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get('webAppUrl');
        if (stored && stored.webAppUrl) {
          savedUrl = stored.webAppUrl.trim();
        }
      } catch (err) {
        console.warn('Could not read from chrome.storage.local:', err);
      }
    }

    // 2. Fallback to localStorage (standalone web context)
    if (!savedUrl) {
      savedUrl = localStorage.getItem('yhbm_web_app_url') || '';
    }

    if (savedUrl) {
      appState.webAppUrl = savedUrl;
      webAppInput.value = savedUrl;
      await fetchStatusSummary();
      await loadDripSettings();
    } else {
      setConnectionStatus('offline', 'Not Connected');
    }
  }

  async function persistUrl(url) {
    appState.webAppUrl = url;
    localStorage.setItem('yhbm_web_app_url', url);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ webAppUrl: url });
      } catch (e) {}
    }
  }

  // ----------------------------------------------------------------------------
  // Event Listeners
  // ----------------------------------------------------------------------------

  // Connect Button
  connectBtn.addEventListener('click', async () => {
    const url = webAppInput.value.trim();
    if (!url) {
      showToast('Please enter a Google Apps Script Web App URL.', 'warning');
      return;
    }
    await persistUrl(url);
    await fetchStatusSummary();
    await loadDripSettings();
  });

  // Enter key on input connects
  webAppInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const url = webAppInput.value.trim();
      if (url) {
        await persistUrl(url);
        await fetchStatusSummary();
        await loadDripSettings();
      }
    }
  });

  // Refresh Button
  refreshBtn.addEventListener('click', async () => {
    await fetchStatusSummary();
  });

  // Export CSV Button
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      if (!appState.logs || appState.logs.length === 0) {
        showToast('No logs available to export.', 'warning');
        return;
      }
      const headers = ['Status', 'Recruiter Email', 'Subject', 'Body Snippet', 'Date Sent', 'Last Opened'];
      const rows = appState.logs.map(log => [
        `"${(log.status || '').replace(/"/g, '""')}"`,
        `"${(log.recruiterEmail || '').replace(/"/g, '""')}"`,
        `"${(log.subject || '').replace(/"/g, '""')}"`,
        `"${(log.bodySnippet || '').replace(/"/g, '""')}"`,
        `"${(log.timestamp || '').replace(/"/g, '""')}"`,
        `"${(log.lastOpenTime || '').replace(/"/g, '""')}"`
      ]);
      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `yhbm_tracking_logs_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Exported tracking logs as CSV.', 'success');
    });
  }

  // Clean / Purge Blank Rows Button
  if (cleanLogsBtn) {
    cleanLogsBtn.addEventListener('click', async () => {
      if (!appState.webAppUrl) {
        showToast('Please connect to your Apps Script Web App URL first.', 'warning');
        return;
      }
      if (!confirm('Purge empty, blank, or invalid test rows from Google Sheets?')) {
        return;
      }
      cleanLogsBtn.disabled = true;
      cleanLogsBtn.textContent = 'Purging...';
      try {
        const url = `${appState.webAppUrl}?action=cleanLogs&t=${Date.now()}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.status === 'success') {
          showToast(json.message || 'Successfully purged invalid test rows.', 'success');
          await fetchStatusSummary();
        } else {
          showToast(json.message || 'Failed to purge rows.', 'error');
        }
      } catch (err) {
        showToast('Error purging rows: ' + err.message, 'error');
      } finally {
        cleanLogsBtn.disabled = false;
        cleanLogsBtn.textContent = 'Purge Blank Rows';
      }
    });
  }

  // Tab Navigation Buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Filter Pills (All, Opened, Unopened, Replied)
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      appState.filter = pill.getAttribute('data-filter');
      renderLogsTable();
    });
  });

  // Search Input
  logSearchInput.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value.toLowerCase().trim();
    renderLogsTable();
  });

  // Clickable Metric HUD Cards to switch tabs / filter
  if (cardSent) cardSent.addEventListener('click', () => activateFilter('all'));
  if (cardOpened) cardOpened.addEventListener('click', () => activateFilter('Opened'));
  if (cardUnopened) cardUnopened.addEventListener('click', () => activateFilter('Sent'));
  if (cardReplied) cardReplied.addEventListener('click', () => activateFilter('Replied'));
  if (cardFollowup) cardFollowup.addEventListener('click', () => activateFilter('FollowedUp'));

  function activateFilter(filterName) {
    // Switch to tab-logs
    const logsTabBtn = document.querySelector('.tab-btn[data-tab="tab-logs"]');
    if (logsTabBtn) logsTabBtn.click();

    // Select pill
    document.querySelectorAll('.filter-pill').forEach(p => {
      if (p.getAttribute('data-filter') === filterName) {
        p.click();
      }
    });
  }

  // Follow-Up Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-preset');
      if (presets[key]) {
        followUpMessageTemplate.value = presets[key];
        showToast(`Loaded "${btn.textContent}" template.`, 'info');
      }
    });
  });

  // Event Delegation for Table Snippet Previews (CSP Safe)
  document.addEventListener('click', (e) => {
    const snippetEl = e.target.closest('.snippet-preview');
    if (snippetEl) {
      const email = snippetEl.getAttribute('data-email') || '';
      const subject = snippetEl.getAttribute('data-subject') || '';
      const snippet = snippetEl.getAttribute('data-snippet') || '';
      openSnippetModal(email, subject, snippet);
    }
  });

  // Close Snippet Modal
  [closeSnippetModal, closeSnippetModalBtn].forEach(el => {
    if (el) el.addEventListener('click', () => snippetModal.classList.remove('active'));
  });

  // Close Single Bump Modal
  [closeSingleBumpModal, cancelSingleBumpBtn].forEach(el => {
    if (el) el.addEventListener('click', () => singleBumpModal.classList.remove('active'));
  });

  // Close Batch Modal
  [closeBatchModal, cancelBatchBtn].forEach(el => {
    if (el) el.addEventListener('click', () => batchModal.classList.remove('active'));
  });

  // Close modals on clicking overlay backdrop
  [snippetModal, singleBumpModal, batchModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }
  });

  // ----------------------------------------------------------------------------
  // 1-Click Auto-Bump Modal Interactions
  // ----------------------------------------------------------------------------

  // Delegated click for row Auto-Bump button
  document.addEventListener('click', (e) => {
    const bumpBtn = e.target.closest('.btn-auto-bump');
    if (bumpBtn) {
      const email = bumpBtn.getAttribute('data-email') || '';
      const subject = bumpBtn.getAttribute('data-subject') || '';
      const snippet = bumpBtn.getAttribute('data-snippet') || '';
      const rowIndex = bumpBtn.getAttribute('data-row-idx') || '';
      openSingleBumpModal(email, subject, snippet, rowIndex);
    }
  });

  function openSingleBumpModal(email, subject, snippet, rowIndex) {
    appState.singleBumpTarget = { email, subject, snippet, rowIndex };
    if (singleBumpRecipient) singleBumpRecipient.textContent = email || '(No Email)';
    if (singleBumpSubject) singleBumpSubject.textContent = subject || '(No Subject)';

    const sampleName = email ? email.split('@')[0].replace(/[._]/g, ' ') : 'there';
    const initialMsg = presets.gentle
      .replace(/\{\{name\}\}/gi, sampleName)
      .replace(/\{\{subject\}\}/gi, subject || 'our conversation');

    if (singleBumpMessage) singleBumpMessage.value = initialMsg;
    if (singleBumpModal) singleBumpModal.classList.add('active');
  }

  // Presets inside Single Bump Modal
  document.querySelectorAll('.single-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-preset');
      if (presets[key] && appState.singleBumpTarget) {
        const email = appState.singleBumpTarget.email;
        const sampleName = email ? email.split('@')[0].replace(/[._]/g, ' ') : 'there';
        if (singleBumpMessage) {
          singleBumpMessage.value = presets[key]
            .replace(/\{\{name\}\}/gi, sampleName)
            .replace(/\{\{subject\}\}/gi, appState.singleBumpTarget.subject || 'our conversation');
        }
      }
    });
  });

  // Confirm Single Auto-Bump
  if (confirmSingleBumpBtn) {
    confirmSingleBumpBtn.addEventListener('click', async () => {
      if (!appState.singleBumpTarget) return;
      if (!appState.webAppUrl) {
        showToast('Please connect to your Apps Script URL first.', 'warning');
        return;
      }

      confirmSingleBumpBtn.disabled = true;
      confirmSingleBumpBtn.textContent = 'Dispatching Bump...';

      const target = appState.singleBumpTarget;
      const message = singleBumpMessage ? singleBumpMessage.value.trim() : '';

      try {
        let result = null;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          result = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'singleFollowUp',
              webAppUrl: appState.webAppUrl,
              email: target.email,
              subject: target.subject,
              message: message,
              rowIndex: target.rowIndex
            }, resolve);
          });
        }

        if (!result || result.status !== 'success') {
          const res = await fetch(appState.webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'singleFollowUp',
              email: target.email,
              subject: target.subject,
              message: message,
              rowIndex: target.rowIndex
            })
          });
          result = await res.json();
        }

        if (result && result.status === 'success') {
          showToast(`🚀 Threaded auto-bump dispatched to ${target.email}!`, 'success');
          if (singleBumpModal) singleBumpModal.classList.remove('active');
          appState.singleBumpTarget = null;
          await fetchStatusSummary();
        } else {
          throw new Error(result?.message || 'Failed to dispatch auto-bump');
        }
      } catch (err) {
        console.warn('[You Have Been Mailed] Single bump notice:', err.message || err);
        showToast(`Auto-bump failed: ${err.message}`, 'error');
      } finally {
        confirmSingleBumpBtn.disabled = false;
        confirmSingleBumpBtn.textContent = 'Send Auto-Bump Now';
      }
    });
  }

  // ----------------------------------------------------------------------------
  // 3-Stage Automated Follow-Up Drip System
  // ----------------------------------------------------------------------------

  function updateDripUI() {
    if (dripToggle) {
      dripToggle.checked = Boolean(appState.dripSettings.enabled);
    }
    if (dripStatusLabel) {
      dripStatusLabel.textContent = appState.dripSettings.enabled ? 'Active (Automated)' : 'Disabled';
      dripStatusLabel.style.color = appState.dripSettings.enabled ? '#059669' : 'var(--text-muted)';
    }

    document.querySelectorAll('[data-drip-stage]').forEach(btn => {
      const stage = btn.getAttribute('data-drip-stage');
      btn.classList.toggle('active', stage === appState.activeDripStage);
    });

    ['stage1', 'stage2', 'stage3'].forEach((s, idx) => {
      const stepEl = document.getElementById(`stageStep${idx + 1}`);
      if (stepEl) {
        stepEl.classList.toggle('active', s === appState.activeDripStage);
      }
    });

    if (dripTemplateTextarea) {
      dripTemplateTextarea.value = appState.dripSettings[appState.activeDripStage] || '';
    }
  }

  async function loadDripSettings() {
    if (!appState.webAppUrl) return;
    try {
      let result = null;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        result = await new Promise(resolve => {
          chrome.runtime.sendMessage({
            action: 'getDripSettings',
            webAppUrl: appState.webAppUrl
          }, resolve);
        });
      }

      if (!result || result.status !== 'success') {
        const res = await fetch(`${appState.webAppUrl}?action=getDripSettings`, { cache: 'no-store' });
        result = await res.json();
      }

      if (result && result.settings) {
        appState.dripSettings.enabled = Boolean(result.settings.enabled);
        if (result.settings.stage1) appState.dripSettings.stage1 = result.settings.stage1;
        if (result.settings.stage2) appState.dripSettings.stage2 = result.settings.stage2;
        if (result.settings.stage3) appState.dripSettings.stage3 = result.settings.stage3;
        updateDripUI();
      }
    } catch (err) {
      console.warn('[You Have Been Mailed] Could not load drip settings:', err);
    }
  }

  // Drip stage tab switching
  document.querySelectorAll('[data-drip-stage]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (dripTemplateTextarea) {
        appState.dripSettings[appState.activeDripStage] = dripTemplateTextarea.value;
      }
      appState.activeDripStage = btn.getAttribute('data-drip-stage');
      updateDripUI();
    });
  });

  // Drip toggle change
  if (dripToggle) {
    dripToggle.addEventListener('change', async () => {
      appState.dripSettings.enabled = dripToggle.checked;
      updateDripUI();
      await saveDripSettings(true);
    });
  }

  async function saveDripSettings(isSilent = false) {
    if (!appState.webAppUrl) {
      showToast('Please connect to your Apps Script URL first.', 'warning');
      return;
    }
    if (dripTemplateTextarea) {
      appState.dripSettings[appState.activeDripStage] = dripTemplateTextarea.value;
    }

    if (saveDripSettingsBtn) {
      saveDripSettingsBtn.disabled = true;
      saveDripSettingsBtn.textContent = 'Saving Rules...';
    }

    try {
      const payload = {
        action: 'saveDripSettings',
        webAppUrl: appState.webAppUrl,
        enabled: appState.dripSettings.enabled,
        stage1: appState.dripSettings.stage1,
        stage2: appState.dripSettings.stage2,
        stage3: appState.dripSettings.stage3
      };

      let result = null;
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        result = await new Promise(resolve => chrome.runtime.sendMessage(payload, resolve));
      }

      if (!result || result.status !== 'success') {
        const res = await fetch(appState.webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        result = await res.json();
      }

      if (result && result.status === 'success') {
        if (!isSilent) showToast('3-Stage Auto-Drip rules saved successfully!', 'success');
      } else {
        throw new Error(result?.message || 'Failed to save settings');
      }
    } catch (err) {
      showToast(`Error saving drip rules: ${err.message}`, 'error');
    } finally {
      if (saveDripSettingsBtn) {
        saveDripSettingsBtn.disabled = false;
        saveDripSettingsBtn.textContent = '💾 Save Drip Rules';
      }
    }
  }

  if (saveDripSettingsBtn) {
    saveDripSettingsBtn.addEventListener('click', () => saveDripSettings(false));
  }

  if (runDripNowBtn) {
    runDripNowBtn.addEventListener('click', async () => {
      if (!appState.webAppUrl) {
        showToast('Please connect to your Apps Script URL first.', 'warning');
        return;
      }

      runDripNowBtn.disabled = true;
      runDripNowBtn.textContent = 'Evaluating Drips...';

      try {
        let result = null;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          result = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'runAutoFollowUpDrip',
              webAppUrl: appState.webAppUrl
            }, resolve);
          });
        }

        if (!result || result.status !== 'success') {
          const res = await fetch(`${appState.webAppUrl}?action=runAutoFollowUpDrip`, { cache: 'no-store' });
          result = await res.json();
        }

        if (result && result.status === 'success') {
          const dispatched = result.dispatchedCount || (result.dispatched ? result.dispatched.length : 0);
          showToast(`⚡ Drip evaluation complete! Dispatched ${dispatched} follow-up(s).`, 'success');
          await fetchStatusSummary();
        } else {
          throw new Error(result?.message || 'Failed to execute drip cycle');
        }
      } catch (err) {
        showToast(`Drip execution notice: ${err.message}`, 'error');
      } finally {
        runDripNowBtn.disabled = false;
        runDripNowBtn.textContent = '⚡ Run Drip Evaluation Now';
      }
    });
  }

  // Select All Overdue Checkbox
  selectAllOverdue.addEventListener('change', (e) => {
    const overdueItems = appState.logs.filter(item => item.isOverdue && item.status !== 'Replied');
    if (e.target.checked) {
      overdueItems.forEach((_, idx) => appState.selectedOverdue.add(idx));
    } else {
      appState.selectedOverdue.clear();
    }
    renderOverdueTable();
  });

  // Batch Auto-Bumps Button Click
  batchAutoBumpBtn.addEventListener('click', () => {
    const overdueItems = appState.logs.filter(item => item.isOverdue && item.status !== 'Replied');
    const selected = Array.from(appState.selectedOverdue).map(idx => overdueItems[idx]).filter(Boolean);

    if (selected.length === 0) {
      showToast('Please select at least one overdue candidate to follow up.', 'warning');
      return;
    }

    batchRecipientCount.textContent = selected.length;
    const first = selected[0];
    const sampleName = first.recruiterEmail ? first.recruiterEmail.split('@')[0].replace(/[._]/g, ' ') : 'there';
    const sampleMsg = followUpMessageTemplate.value
      .replace(/\{\{name\}\}/gi, sampleName)
      .replace(/\{\{subject\}\}/gi, first.subject || 'our conversation');

    batchPreviewBox.textContent = `To: ${first.recruiterEmail}\nSubject: ${first.subject}\n\n${sampleMsg}`;
    batchModal.classList.add('active');
  });

  // Confirm Batch Dispatch
  confirmBatchBtn.addEventListener('click', async () => {
    const overdueItems = appState.logs.filter(item => item.isOverdue);
    const selected = Array.from(appState.selectedOverdue).map(idx => overdueItems[idx]).filter(Boolean);

    const targets = selected.map(item => {
      const name = item.recruiterEmail ? item.recruiterEmail.split('@')[0].replace(/[._]/g, ' ') : 'there';
      const message = followUpMessageTemplate.value
        .replace(/\{\{name\}\}/gi, name)
        .replace(/\{\{subject\}\}/gi, item.subject);

      return {
        email: item.recruiterEmail,
        subject: item.subject,
        followUpMessage: message,
        rowIndex: item.rowIndex
      };
    });

    confirmBatchBtn.disabled = true;
    confirmBatchBtn.textContent = 'Dispatching Bumps...';

    try {
      const res = await fetch(appState.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'bulkFollowUp',
          targets: targets
        })
      });
      const json = await res.json();

      if (json && json.status === 'success') {
        showToast(`Successfully dispatched ${json.processed || targets.length} threaded follow-ups!`, 'success');
        batchModal.classList.remove('active');
        appState.selectedOverdue.clear();
        await fetchStatusSummary();
      } else {
        throw new Error(json.message || 'Error processing follow-ups');
      }
    } catch (err) {
      console.warn('[You Have Been Mailed] Batch dispatch notice:', err.message || err);
      showToast(`Batch dispatch failed: ${err.message}`, 'error');
    } finally {
      confirmBatchBtn.disabled = false;
      confirmBatchBtn.textContent = 'Confirm & Send All';
    }
  });

  // Export CSV Handler
  exportCsvBtn.addEventListener('click', () => {
    if (!appState.logs || appState.logs.length === 0) {
      showToast('No data to export.', 'warning');
      return;
    }

    const headers = ["Timestamp", "Recruiter Email", "Subject", "Body Snippet", "Status", "Last Open Time"];
    const csvRows = [headers.join(",")];

    appState.logs.forEach(row => {
      const values = [
        `"${(row.timestamp || "").replace(/"/g, '""')}"`,
        `"${(row.recruiterEmail || "").replace(/"/g, '""')}"`,
        `"${(row.subject || "").replace(/"/g, '""')}"`,
        `"${(row.bodySnippet || "").replace(/"/g, '""')}"`,
        `"${(row.status || "").replace(/"/g, '""')}"`,
        `"${(row.lastOpenTime || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(values.join(","));
    });

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `YouHaveBeenMailed_Logs_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Exported CSV file.', 'success');
  });

  // Purge Blank/Corrupted Rows Handler
  if (cleanLogsBtn) {
    cleanLogsBtn.addEventListener('click', async () => {
      if (!appState.webAppUrl) {
        showToast('Please connect to your Apps Script Web App first.', 'warning');
        return;
      }

      cleanLogsBtn.disabled = true;
      cleanLogsBtn.textContent = 'Purging...';
      showToast('Purging blank test rows from Google Sheet...', 'info');

      try {
        const res = await fetch(`${appState.webAppUrl}?action=cleanLogs`, { method: 'GET', cache: 'no-store' });
        const json = await res.json();
        showToast(json.message || 'Purged blank test rows.', 'success');
        await fetchStatusSummary();
      } catch (err) {
        console.warn('[You Have Been Mailed] Purge notice:', err.message || err);
        showToast(`Purge failed: ${err.message}`, 'error');
      } finally {
        cleanLogsBtn.disabled = false;
        cleanLogsBtn.textContent = 'Purge Blank Rows';
      }
    });
  }

  // ----------------------------------------------------------------------------
  // Data Fetching & Sync (Dynamic Live Engine)
  // ----------------------------------------------------------------------------

  async function fetchStatusSummary(isSilent = false) {
    if (!appState.webAppUrl) {
      setConnectionStatus('offline', 'Not Connected');
      return;
    }

    if (!isSilent) {
      setConnectionStatus('syncing', 'Syncing...');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const response = await fetch(`${appState.webAppUrl}?action=getStatusSummary`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const json = await response.json();

      if (json && json.status === 'success') {
        const newLogs = json.data || [];
        
        // Detect newly opened emails in real time
        if (appState.logs && appState.logs.length > 0) {
          const oldStatusMap = new Map(appState.logs.map(l => [l.rowIndex, l.status]));
          newLogs.forEach(item => {
            const oldStatus = oldStatusMap.get(item.rowIndex);
            if (oldStatus === 'Sent' && item.status === 'Opened') {
              showToast(`👁️ ${item.recruiterEmail} just opened "${item.subject || 'your email'}"!`, 'success');
            }
          });
        }

        appState.logs = newLogs;
        updateHUD(json.summary || {});
        renderLogsTable();
        renderOverdueTable();
        setConnectionStatus('online', 'Connected');
        if (!isSilent) {
          showToast('Tracking data synchronized.', 'success');
        }
      } else {
        throw new Error(json.message || 'Unknown response from Apps Script');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (!isSilent) {
        console.warn('[You Have Been Mailed] Sync notice:', err.message || err);
        setConnectionStatus('offline', 'Disconnected');
        if (err.name === 'AbortError') {
          showToast('Connection timed out. Check your Apps Script URL.', 'error');
        } else {
          showToast(`Connection failed: ${err.message}`, 'error');
        }
      }
    }
  }

  // ----------------------------------------------------------------------------
  // Rendering Helpers
  // ----------------------------------------------------------------------------

  function updateHUD(summary) {
    const total = summary.total ?? appState.logs.length;
    let opened = summary.opened;
    let unopened = summary.unopened;
    let replied = summary.replied;
    let overdue = summary.overdue;
    let followUps = summary.followUps;

    if (typeof opened === 'undefined' && appState.logs.length > 0) {
      opened = appState.logs.filter(l => l.status === 'Opened' || l.status.indexOf('Opened') !== -1 || l.status === 'Replied' || l.lastOpenTime).length;
      unopened = appState.logs.filter(l => (l.status === 'Sent' || l.status === 'Follow-Up Sent') && !l.lastOpenTime).length;
      replied = appState.logs.filter(l => l.status === 'Replied').length;
      overdue = appState.logs.filter(l => l.isOverdue && l.status !== 'Replied').length;
      followUps = appState.logs.filter(l => (Number(l.followUpCount) > 0) || (l.status && (l.status.indexOf('Follow-Up') !== -1 || l.status.indexOf('Bumped') !== -1))).length;
    }

    opened = opened ?? 0;
    unopened = unopened ?? 0;
    replied = replied ?? 0;
    overdue = overdue ?? 0;
    followUps = followUps ?? 0;

    hudSent.textContent = total;
    hudOpened.textContent = opened;
    hudUnopened.textContent = unopened;
    hudReplied.textContent = replied;
    if (hudFollowUps) hudFollowUps.textContent = followUps;

    const openRate = total > 0 ? Math.round((opened / total) * 100) : 0;
    const replyRate = total > 0 ? Math.round((replied / total) * 100) : 0;

    hudOpenRate.textContent = `${openRate}% Open Rate`;
    hudReplyRate.textContent = `${replyRate}% Reply Rate`;

    badgeTotalLogs.textContent = total;
    badgeOverdueLogs.textContent = overdue;
  }

  function renderLogsTable() {
    if (!appState.logs || appState.logs.length === 0) {
      logsTableBody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <p>No email outreach logs detected yet. Send an email via Gmail to begin tracking.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const filtered = appState.logs.filter(item => {
      // Status filter
      if (appState.filter === 'Opened') {
        const isOpened = item.status === 'Opened' || item.status.indexOf('Opened') !== -1 || item.status === 'Replied' || Boolean(item.lastOpenTime);
        if (!isOpened) return false;
      } else if (appState.filter === 'Sent') {
        if ((item.status !== 'Sent' && item.status !== 'Follow-Up Sent') || item.lastOpenTime) return false;
      } else if (appState.filter === 'FollowedUp') {
        const isFollowedUp = (Number(item.followUpCount) > 0) || (item.status && (item.status.indexOf('Follow-Up') !== -1 || item.status.indexOf('Bumped') !== -1));
        if (!isFollowedUp) return false;
      } else if (appState.filter !== 'all' && item.status !== appState.filter) {
        return false;
      }
      // Search query
      if (appState.searchQuery) {
        const haystack = `${item.recruiterEmail} ${item.subject} ${item.bodySnippet}`.toLowerCase();
        if (!haystack.includes(appState.searchQuery)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      logsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No records matching current filters.</td></tr>`;
      return;
    }

    // Render rows
    logsTableBody.innerHTML = filtered.map(item => {
      const followUpCount = Number(item.followUpCount) || 0;
      const hasFollowUp = followUpCount > 0 || (item.status && (item.status.indexOf('Follow-Up') !== -1 || item.status.indexOf('Bumped') !== -1));

      let tickMarkup = '';
      if (item.status === 'Replied') {
        tickMarkup = `<span class="tick-badge tick-replied">✉️ Replied</span>`;
      } else if (item.status === 'Opened' || item.status.indexOf('Opened') !== -1 || item.lastOpenTime) {
        tickMarkup = `<span class="tick-badge tick-opened">✓✓ Opened</span>`;
        if (hasFollowUp) {
          tickMarkup += ` <span class="tick-badge tick-bumped" title="Follow-up sent">⚡ Bumped</span>`;
        }
      } else {
        tickMarkup = `<span class="tick-badge tick-sent">✓ Sent</span>`;
        if (hasFollowUp) {
          tickMarkup += ` <span class="tick-badge tick-bumped" title="Follow-up sent">⚡ Bumped</span>`;
        }
      }

      const cleanSubject = escapeHtml(item.subject || '(No Subject)');
      const cleanEmail = escapeHtml(item.recruiterEmail || '');
      const cleanSnippet = escapeHtml(item.bodySnippet || '');
      const dateSent = formatTimestamp(item.timestamp);
      const lastOpen = item.lastOpenTime ? formatTimestamp(item.lastOpenTime) : '<span style="color:#94A3B8;">—</span>';

      let followUpCell = '';
      if (item.status === 'Replied') {
        followUpCell = `<div style="text-align:center;"><span class="badge-replied-pill">✉️ Replied</span></div>`;
      } else if (hasFollowUp) {
        const countLabel = followUpCount > 1 ? ` (${followUpCount}x)` : '';
        const timeText = item.lastFollowUpTime ? `Sent ${item.lastFollowUpTime}` : 'Dispatched';
        followUpCell = `
          <div class="followup-proof-cell">
            <span class="badge-followup-pill" title="Live proof: follow-up dispatched directly to ${cleanEmail}">⚡ Bumped${countLabel}</span>
            <span class="followup-time-sub">${timeText}</span>
            <button type="button" class="btn btn-outline-bump btn-auto-bump" 
              data-row-idx="${item.rowIndex || ''}" 
              data-email="${cleanEmail}" 
              data-subject="${cleanSubject}" 
              data-snippet="${cleanSnippet}">
              Bump Again
            </button>
          </div>
        `;
      } else {
        followUpCell = `
          <div style="text-align:center;">
            <button type="button" class="btn btn-sm btn-auto-bump" 
              data-row-idx="${item.rowIndex || ''}" 
              data-email="${cleanEmail}" 
              data-subject="${cleanSubject}" 
              data-snippet="${cleanSnippet}">
              🚀 Auto-Bump
            </button>
          </div>
        `;
      }

      return `
        <tr>
          <td>${tickMarkup}</td>
          <td style="font-weight:600; color:var(--text-main);">${cleanEmail}</td>
          <td>${cleanSubject}</td>
          <td>
            <div class="snippet-preview" data-email="${cleanEmail}" data-subject="${cleanSubject}" data-snippet="${cleanSnippet}">
              ${cleanSnippet || '<span style="color:#94A3B8;">(Empty body)</span>'}
            </div>
          </td>
          <td style="color:var(--text-muted); font-size:12px;">${dateSent}</td>
          <td style="font-size:12px;">${lastOpen}</td>
          <td>${followUpCell}</td>
        </tr>
      `;
    }).join('');
  }

  function renderOverdueTable() {
    const overdueItems = appState.logs.filter(item => item.isOverdue && item.status !== 'Replied');
    badgeOverdueLogs.textContent = overdueItems.length;

    if (overdueItems.length === 0) {
      overdueTableBody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <p>🎉 All clear! No recruiter threads are pending beyond 72 hours.</p>
            </div>
          </td>
        </tr>
      `;
      appState.selectedOverdue.clear();
      updateBumpCount();
      return;
    }

    overdueTableBody.innerHTML = overdueItems.map((item, idx) => {
      const isChecked = appState.selectedOverdue.has(idx);
      const daysOld = Math.round((item.elapsedHours / 24) * 10) / 10;
      const cleanEmail = escapeHtml(item.recruiterEmail || '');
      const cleanSubject = escapeHtml(item.subject || '');
      const cleanSnippet = escapeHtml(item.bodySnippet || '');

      return `
        <tr>
          <td>
            <input type="checkbox" class="overdue-chk" data-idx="${idx}" ${isChecked ? 'checked' : ''}>
          </td>
          <td style="font-weight:600;">${cleanEmail}</td>
          <td>${cleanSubject}</td>
          <td>
            <div class="snippet-preview" data-email="${cleanEmail}" data-subject="${cleanSubject}" data-snippet="${cleanSnippet}">
              ${cleanSnippet || '(No body)'}
            </div>
          </td>
          <td>
            <span style="display:inline-block; padding:3px 8px; border-radius:4px; font-size:11.5px; font-weight:600; background-color:#FEE2E2; color:#DC2626;">
              ${daysOld} days overdue
            </span>
            ${(Number(item.followUpCount) > 0) ? `<div style="margin-top:4px;"><span class="badge-followup-pill" style="font-size:10px; padding:1px 6px;">⚡ Bumped (${item.followUpCount}x)</span><span style="font-size:10px; color:var(--text-muted); margin-left:4px;">${item.lastFollowUpTime || ''}</span></div>` : ''}
          </td>
          <td>
            <span class="tick-badge ${item.status === 'Opened' ? 'tick-opened' : 'tick-sent'}">
              ${item.status === 'Opened' ? '✓✓ Opened' : '✓ Sent'}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    // Attach listeners to newly rendered checkboxes
    document.querySelectorAll('.overdue-chk').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        if (e.target.checked) appState.selectedOverdue.add(idx);
        else appState.selectedOverdue.delete(idx);
        updateBumpCount();
      });
    });
  }

  function updateBumpCount() {
    selectedBumpCount.textContent = appState.selectedOverdue.size;
  }

  function openSnippetModal(email, subject, snippet) {
    snippetModalTitle.textContent = subject || 'Email Subject';
    snippetModalMeta.textContent = `Recipient: ${email}`;
    snippetModalBody.textContent = snippet || '(Empty snippet)';
    snippetModal.classList.add('active');
  }

  function setConnectionStatus(type, label) {
    connDot.className = `status-dot status-${type}`;
    connLabel.textContent = label;
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Dynamic Auto-Refresh Engine (every 8s silently in the background)
  setInterval(() => {
    if (appState.webAppUrl) {
      fetchStatusSummary(true);
    }
  }, 8000);

  // Instant refresh upon switching back to dashboard tab
  window.addEventListener('focus', () => {
    if (appState.webAppUrl) {
      fetchStatusSummary(true);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && appState.webAppUrl) {
      fetchStatusSummary(true);
    }
  });

  // Run initialization
  await loadInitialUrl();
});
