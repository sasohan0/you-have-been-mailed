/**
 * ==============================================================================
 * "You Have Been Mailed" - Gmail Content Script Engine (v2 Robust)
 * ------------------------------------------------------------------------------
 * Features:
 * 1. Deep Compose Dialog Traverser: Extracts true Recruiter & Subject reliably.
 * 2. Deduplicated Outbound Logging: 1 single tokenized log event per email.
 * 3. Self-Open Neutralizer: Blocks sender's browser from loading pixels in Sent box.
 * 4. WhatsApp Checkmark Badges in the exact marked zone (between Star and Recipient).
 * ==============================================================================
 */

(function () {
  'use strict';

  // Strict domain guard: ONLY run on Gmail (mail.google.com)
  if (!window.location.hostname || !window.location.hostname.includes('mail.google.com')) {
    return;
  }

  // Suppress "Extension context invalidated" noise caused by developer extension reloads
  window.addEventListener('error', function (event) {
    const msg = event?.message || event?.error?.message || '';
    if (typeof msg === 'string' && (msg.includes('Extension context invalidated') || msg.includes('context invalidated'))) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return true;
    }
  }, true);

  const trackingConfig = {
    webAppUrl: '',
    trackingEnabled: true
  };

  const trackingSummaryCache = {
    timestamp: 0,
    items: [],
    emailMap: new Map(),
    subjectMap: new Map()
  };

  let isScanningRows = false;
  let statusPollTimer = null;

  // Context validation to prevent "Extension context invalidated" errors upon reload
  function isContextValid() {
    try {
      if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) return false;
      const id = chrome.runtime.id;
      if (!id) return false;
      return typeof chrome.runtime.getManifest === 'function' && Boolean(chrome.runtime.getManifest());
    } catch (e) {
      return false;
    }
  }

  // Safe wrapper around chrome.runtime.sendMessage to prevent unhandled context errors
  function safeSendMessage(message, callback) {
    if (!isContextValid()) return;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
      chrome.runtime.sendMessage(message, (response) => {
        try {
          if (chrome.runtime.lastError) {
            // benign context invalidation or message port closed
            return;
          }
          if (callback && isContextValid()) {
            callback(response);
          }
        } catch (cbErr) {
          // ignore
        }
      });
    } catch (err) {
      // context invalidated during extension reload
    }
  }

  // Initialize configuration from storage
  function loadConfiguration() {
    if (!isContextValid()) return;

    try {
      chrome.storage.local.get(['webAppUrl', 'trackingEnabled'], (result) => {
        if (!isContextValid()) return;
        if (result.webAppUrl) trackingConfig.webAppUrl = result.webAppUrl.trim();
        if (typeof result.trackingEnabled !== 'undefined') trackingConfig.trackingEnabled = result.trackingEnabled;
        console.log('[You Have Been Mailed] Engine mounted. Tracking active:', trackingConfig.trackingEnabled);
        if (trackingConfig.webAppUrl) {
          fetchTrackingSummary(true);
        }
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!isContextValid()) return;
        if (areaName === 'local') {
          if (changes.webAppUrl) trackingConfig.webAppUrl = changes.webAppUrl.newValue ? changes.webAppUrl.newValue.trim() : '';
          if (changes.trackingEnabled) trackingConfig.trackingEnabled = changes.trackingEnabled.newValue;
          if (trackingConfig.webAppUrl) fetchTrackingSummary(true);
        }
      });
    } catch (e) {
      // Ignore if context is tearing down
    }
  }

  function extractEmail(rawText) {
    if (!rawText) return '';
    const match = String(rawText).match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase().trim() : '';
  }

  function normalizeSubject(subject) {
    if (!subject) return '';
    return String(subject)
      .replace(/^(re|fwd|fw):\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // ----------------------------------------------------------------------------
  // MODULE 1: Full-Scope Dialog Detection & Parameter Extraction
  // ----------------------------------------------------------------------------

  function isSendTarget(el) {
    if (!el) return null;

    const btn = el.closest('[role="button"], button, div.T-I, div.aoO');
    if (!btn) return null;

    const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();

    if (
      tooltip.includes('send') ||
      aria.includes('send') ||
      text === 'send' ||
      text.startsWith('send ') ||
      btn.classList.contains('aoO') ||
      btn.classList.contains('T-I-atl')
    ) {
      if (aria.includes('more send options') || tooltip.includes('more send options')) {
        return null;
      }
      return btn;
    }

    return null;
  }

  /**
   * Climbs all the way up to find the full compose dialog/form
   */
  function findFullComposeDialog(targetEl) {
    let cur = targetEl;
    let outermost = null;

    while (cur && cur !== document.body) {
      if (
        cur.getAttribute('role') === 'dialog' ||
        cur.classList.contains('AD') ||
        cur.classList.contains('M9') ||
        cur.classList.contains('inboxsdk__compose') ||
        cur.querySelector('input[name="subjectbox"]') ||
        cur.querySelector('div[name="to"]') ||
        cur.tagName === 'FORM'
      ) {
        outermost = cur;
      }
      cur = cur.parentElement;
    }

    if (outermost) return outermost;

    // Fallbacks
    return targetEl.closest('div[role="dialog"], div.AD, div.M9, form') ||
      document.querySelector('div[role="dialog"]') ||
      document.querySelector('div.AD') ||
      document.querySelector('div.M9') ||
      document.body;
  }

  function findEditor(dialog) {
    return dialog.querySelector('div[role="textbox"], div.Am.Al.editable, div[contenteditable="true"]');
  }

  /**
   * Scrapes recipient name or email with comprehensive fallbacks
   */
  function scrapeRecipient(dialog) {
    if (!dialog) return '';

    // 1. Explicit email or hovercard attribute
    const attrEls = dialog.querySelectorAll('[email], [data-hovercard-id], input[peoplekit-id]');
    for (const el of attrEls) {
      const em = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.value;
      if (em && em.includes('@')) return em.toLowerCase().trim();
      if (em && em.length > 2) return em.toLowerCase().trim();
    }

    // 2. Chips inside "To" field (.vR, .vN, div[name="to"])
    const chips = dialog.querySelectorAll('.vR .vN, div[name="to"] .vN, div[name="to"] [role="option"], div.aoD span, div[name="to"] span');
    for (const chip of chips) {
      const em = chip.getAttribute('email') || chip.getAttribute('data-hovercard-id');
      if (em) return em.toLowerCase().trim();
      const text = chip.innerText || chip.textContent || '';
      const extracted = extractEmail(text);
      if (extracted) return extracted;
      const cleanText = text.replace(/to:|recipient:|[\n\r]/gi, '').trim();
      if (cleanText && cleanText.length > 1) return cleanText.toLowerCase();
    }

    // 3. Fallback: input fields
    const inputs = dialog.querySelectorAll('input[name="to"], div[name="to"] input, input[aria-label*="To" i]');
    for (const inp of inputs) {
      const val = inp.value ? inp.value.trim() : '';
      const extracted = extractEmail(val);
      if (extracted) return extracted;
      if (val && val.length > 1) return val.toLowerCase();
    }

    // 4. Any text in the "To" row
    const toRow = dialog.querySelector('div[name="to"], tr.fA, div.aoD');
    if (toRow) {
      const text = toRow.innerText || toRow.textContent || '';
      const extracted = extractEmail(text);
      if (extracted) return extracted;
      const clean = text.replace(/to:|recipient:|[\n\r]/gi, '').trim();
      if (clean && clean.length > 1) return clean.toLowerCase();
    }

    return '';
  }

  /**
   * Scrapes subject line from compose dialog
   */
  function scrapeSubject(dialog) {
    if (!dialog) return '(No Subject)';
    const inp = dialog.querySelector('input[name="subjectbox"], input[name="subject"]');
    if (inp && inp.value && inp.value.trim()) return inp.value.trim();

    // Fallback for thread replies
    const h2 = document.querySelector('h2.hP, div.ha h2');
    if (h2 && h2.innerText && h2.innerText.trim()) return h2.innerText.trim();

    return '(No Subject)';
  }

  function showTrackingToast(recipient) {
    let toast = document.getElementById('yhbm-inbox-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yhbm-inbox-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 24px;
        background-color: #0F172A;
        color: #FFFFFF;
        padding: 12px 18px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: all 0.3s ease;
      `;
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <span style="color: #34D399; font-weight: bold; font-size: 15px;">✓✓</span>
      <span><strong>You Have Been Mailed:</strong> Tracking active for <em>${recipient || 'outreach email'}</em></span>
    `;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
      }
    }, 3500);
  }

  /**
   * Main Send interceptor (100% Synchronous DOM Injection)
   */
  function handleSendEvent(targetEl) {
    try {
      const webAppUrl = trackingConfig.webAppUrl;
      const enabled = trackingConfig.trackingEnabled;

      if (!enabled || !webAppUrl) {
        console.log('[You Have Been Mailed] Tracking inactive or URL not set');
        return;
      }

      const dialog = findFullComposeDialog(targetEl);
      const editor = findEditor(dialog);

      if (!editor) {
        console.warn('[You Have Been Mailed] Compose editor not found');
        return;
      }

      // Check if already injected to prevent duplicates
      if (editor.querySelector('img[data-tracked], .yhbm-tracker-node')) {
        return;
      }

      const recipient = scrapeRecipient(dialog);
      const subject = scrapeSubject(dialog);
      const bodySnippet = (editor.innerText || editor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);

      // Generate unique token for this email
      const token = 'm_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      console.log('[You Have Been Mailed] Intercepted Send! Injecting tracking pixel synchronously:', { token, recipient, subject });

      // Synchronously inject 1x1 tracking pixel into message body
      const trackingUrl = `${webAppUrl}?id=${encodeURIComponent(token)}&to=${encodeURIComponent(recipient)}&subject=${encodeURIComponent(subject)}&t=${Date.now()}`;
      
      const pixelSpan = document.createElement('span');
      pixelSpan.className = 'yhbm-tracker-node';
      pixelSpan.setAttribute('data-tracked', token);
      pixelSpan.style.cssText = 'line-height:0 !important; font-size:0 !important; display:block !important;';
      pixelSpan.innerHTML = `<img src="${trackingUrl}" width="1" height="1" alt="" border="0" data-tracked="${token}" style="width:1px !important; height:1px !important; border:0 !important; outline:none !important; opacity:0.01 !important; display:block !important;" />`;

      editor.appendChild(pixelSpan);

      // Single-Channel Outbound Logging (Zero Duplicates, Asynchronous in background)
      safeSendMessage({
        action: 'logSent',
        webAppUrl: webAppUrl,
        token: token,
        recipient: recipient,
        subject: subject,
        body: bodySnippet
      });

      showTrackingToast(recipient);

      // Trigger status summary refresh after 2.5s
      setTimeout(() => fetchTrackingSummary(true), 2500);

    } catch (err) {
      console.warn('[You Have Been Mailed] handleSendEvent note:', err.message || err);
    }
  }

  function initSendListeners() {
    // 1. Hook on mousedown (fires before click to guarantee pixel is in DOM before Gmail captures it)
    document.addEventListener('mousedown', function (e) {
      if (!isContextValid()) return;
      try {
        const sendBtn = isSendTarget(e.target);
        if (sendBtn) {
          handleSendEvent(sendBtn);
        }
      } catch (err) {}
    }, true);

    // 2. Hook on click (failsafe)
    document.addEventListener('click', function (e) {
      if (!isContextValid()) return;
      try {
        const sendBtn = isSendTarget(e.target);
        if (sendBtn) {
          handleSendEvent(sendBtn);
        }
      } catch (err) {}
    }, true);

    // 3. Hook on keyboard shortcut (Ctrl+Enter / Cmd+Enter)
    document.addEventListener('keydown', function (e) {
      if (!isContextValid()) return;
      try {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          const activeEl = document.activeElement;
          if (activeEl) {
            handleSendEvent(activeEl);
          }
        }
      } catch (err) {}
    }, true);
  }

  // ----------------------------------------------------------------------------
  // MODULE 2: Self-Open Prevention in Sent Box
  // ----------------------------------------------------------------------------

  function neutraliseSelfOpensInView() {
    if (!isContextValid()) return;
    try {
      // Only neutralize when the SENDER is looking at their own Sent folder (#sent)
      if (!window.location.hash || !window.location.hash.toLowerCase().includes('#sent')) {
        return;
      }
      const imgs = document.querySelectorAll('div.a3s img[data-tracked], div.a3s img[src*="script.google.com"], div.a3s img[src*="googleusercontent.com"][src*="script.google.com"]');
      imgs.forEach(img => {
        if (!img.dataset.blocked) {
          img.dataset.blocked = "true";
          img.removeAttribute('src'); // Stop sender browser from fetching in Sent box!
        }
      });
    } catch (e) {
      // Ignore during teardown
    }
  }

  // ----------------------------------------------------------------------------
  // MODULE 3: Status Summary Fetching & Sync
  // ----------------------------------------------------------------------------

  function fetchTrackingSummary(forceRefresh = false) {
    if (!isContextValid()) {
      if (statusPollTimer) clearTimeout(statusPollTimer);
      return;
    }
    if (!trackingConfig.webAppUrl) return;

    const now = Date.now();
    if (!forceRefresh && (now - trackingSummaryCache.timestamp < 4000)) {
      renderBadgesOnVisibleRows();
      return;
    }

    safeSendMessage({
      action: 'getStatusSummary',
      webAppUrl: trackingConfig.webAppUrl
    }, (response) => {
      if (!response || response.status !== 'success') {
        return;
      }

      const data = response.data || [];
      trackingSummaryCache.timestamp = Date.now();
      trackingSummaryCache.items = data;

      renderBadgesOnVisibleRows();
    });
  }

  // ----------------------------------------------------------------------------
  // MODULE 4: WhatsApp Checkmarks In The Exact Marked Zone (Sent Box)
  // ----------------------------------------------------------------------------

  function getBadgeSvg(type) {
    if (type === 'sent') {
      // Single Gray Tick (✓)
      return `<svg class="yhbm-icon" viewBox="0 0 16 16" width="13" height="13">
        <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/>
      </svg>`;
    } else if (type === 'opened') {
      // Double Blue Ticks (✓✓)
      return `<svg class="yhbm-icon" viewBox="0 0 16 16" width="16" height="13">
        <path d="M8.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L2.324 8.384a.757.757 0 1 1 1.06-1.06l2.094 2.093L8.95 4.992a.252.252 0 0 1 .02-.022Zm4.5 0a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02l-.5-.5a.75.75 0 1 1 1.06-1.06l.04.04 3.42-4.52a.252.252 0 0 1 .02-.022Z"/>
      </svg>`;
    } else if (type === 'replied') {
      // Green Envelope (✉️)
      return `<svg class="yhbm-icon" viewBox="0 0 16 16" width="13" height="13">
        <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4Zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1H2Zm13 2.383-4.708 2.825L15 11.105V5.383Zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741ZM1 11.105l4.708-2.897L1 5.383v5.722Z"/>
      </svg>`;
    }
    return '';
  }

  function formatFriendlyTime(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoStr;
    }
  }

  /**
   * Matches a Gmail thread row (tr.zA) strictly to tracked items with 1-to-1 claiming
   */
  function matchRowToTrackedItem(row, claimedSet) {
    if (!trackingSummaryCache.items || trackingSummaryCache.items.length === 0) return null;

    const recipEl = row.querySelector('div.yW, td.yX');
    const rowRecipText = (recipEl?.innerText || '').toLowerCase();
    const rowSubjEl = row.querySelector('span.bog, span.bqe');
    const rowSubjText = normalizeSubject(rowSubjEl?.innerText || '');
    const rowSnippetText = (row.querySelector('span.y2')?.innerText || '').toLowerCase();

    // Extract email from DOM attributes
    let rowAttrEmail = '';
    const emailAttr = recipEl?.querySelector('[email], [data-hovercard-id], [title*="@"]') ||
                      row.querySelector('div.yW [email], div.yW [data-hovercard-id], td.yX [email], td.yX [data-hovercard-id], [email], [data-hovercard-id]');
    if (emailAttr) {
      const raw = emailAttr.getAttribute('email') || emailAttr.getAttribute('data-hovercard-id') || emailAttr.getAttribute('title') || '';
      rowAttrEmail = extractEmail(raw) || raw.toLowerCase().trim();
    } else if (recipEl && (recipEl.getAttribute('email') || recipEl.getAttribute('data-hovercard-id'))) {
      const raw = recipEl.getAttribute('email') || recipEl.getAttribute('data-hovercard-id');
      rowAttrEmail = extractEmail(raw) || raw.toLowerCase().trim();
    }

    if (!rowRecipText && !rowSubjText) return null;

    const rawSubj = (rowSubjEl?.innerText || '').trim();
    // Skip badges on outgoing auto-bump message lines so badges strictly anchor to the main outreach thread
    const isOutgoingBumpLine = /^re:\s*/i.test(rawSubj) && (
      rowSnippetText.includes('just wanted to follow up') ||
      rowSnippetText.includes('following up on my') ||
      rowSnippetText.includes('circling back')
    );
    if (isOutgoingBumpLine) {
      return null;
    }

    const cleanRowRecip = rowRecipText.replace(/^to:\s*/i, '').trim();

    let bestItem = null;
    let bestScore = -1;

    // Search for best matching item using multi-factor scoring
    for (let i = 0; i < trackingSummaryCache.items.length; i++) {
      const item = trackingSummaryCache.items[i];
      if (claimedSet.has(item.rowIndex)) continue;

      const itemRecip = (item.recruiterEmail || '').toLowerCase().trim();
      const itemRecipUser = itemRecip.includes('@') ? itemRecip.split('@')[0] : '';
      const itemSubj = normalizeSubject(item.subject);
      const itemSnippet = (item.bodySnippet || '').toLowerCase().trim();

      let score = 0;

      // 1. Subject Alignment
      if (itemSubj && rowSubjText) {
        if (itemSubj === rowSubjText) {
          score += 40;
        } else if (rowSubjText.includes(itemSubj) || itemSubj.includes(rowSubjText)) {
          score += 20;
        } else {
          // Disqualified if subjects conflict
          continue;
        }
      } else if (!itemSubj || itemSubj === '(no subject)') {
        score += 5;
      }

      // 2. Snippet Alignment (Essential when multiple outreach emails share identical subjects)
      let snippetMatched = false;
      const cleanSnippet = itemSnippet.replace(/^[-–—:\s]+/, '').slice(0, 30).trim();
      if (cleanSnippet && rowSnippetText && rowSnippetText.includes(cleanSnippet)) {
        score += 60; // Direct snippet confirmation
        snippetMatched = true;
      }

      // 3. Recipient Email Alignment
      let recipMatch = false;
      if (rowAttrEmail && itemRecip && (rowAttrEmail === itemRecip || rowAttrEmail.includes(itemRecipUser) || itemRecip.includes(rowAttrEmail))) {
        score += 50;
        recipMatch = true;
      } else if (itemRecip && (rowRecipText.includes(itemRecip) || (itemRecipUser && itemRecipUser.length > 2 && rowRecipText.includes(itemRecipUser)) || (cleanRowRecip && cleanRowRecip.length > 2 && (itemRecip.includes(cleanRowRecip) || cleanRowRecip.includes(itemRecipUser))))) {
        score += 35;
        recipMatch = true;
      }

      // STRICT ISOLATION: A row cannot claim an item meant for another recipient unless snippet explicitly confirms it
      if (!recipMatch && !snippetMatched) {
        continue; // Prevent item from being stolen by a different conversation!
      }

      // 4. Distinction between bumped threads and replied threads
      if (item.followUpCount > 0 && (rowRecipText.includes('me') || rowRecipText.includes('2') || rowRecipText.includes('3'))) {
        score += 15;
      }

      if (score > bestScore && score >= 25) {
        bestScore = score;
        bestItem = item;
      }
    }

    if (bestItem) {
      claimedSet.add(bestItem.rowIndex);
      return bestItem;
    }

    return null;
  }

  /**
   * Renders WhatsApp badges strictly in Sent box with 1-to-1 correspondence
   */
  function renderBadgesOnVisibleRows() {
    // CRITICAL: Badges belong ONLY in the Sent Outbox (#sent)!
    // If user is in Inbox (#inbox), Starred, Drafts, etc., DO NOT RENDER!
    if (!window.location.hash || !window.location.hash.toLowerCase().includes('#sent')) {
      // Remove any stray badges from non-sent views
      document.querySelectorAll('.yhbm-badge-container').forEach(el => el.remove());
      return;
    }

    if (isScanningRows) return;
    isScanningRows = true;

    try {
      const rows = document.querySelectorAll('tr.zA');
      if (!rows || rows.length === 0) {
        isScanningRows = false;
        return;
      }

      const claimedSet = new Set();

      requestAnimationFrame(() => {
        rows.forEach((row) => {
          const trackedItem = matchRowToTrackedItem(row, claimedSet);
          const existingBadge = row.querySelector('.yhbm-badge-container');

          if (!trackedItem) {
            if (existingBadge) existingBadge.remove();
            return;
          }

          const status = trackedItem.status || 'Sent';
          const followUpCount = Number(trackedItem.followUpCount) || 0;
          const hasFollowUp = followUpCount > 0 || status.indexOf('Follow-Up') !== -1 || status.indexOf('Bumped') !== -1;
          const badgeId = `yhbm-${trackedItem.rowIndex}-${status}-${followUpCount}`;

          if (existingBadge && existingBadge.getAttribute('data-badge-id') === badgeId) {
            return;
          }

          if (existingBadge) {
            existingBadge.remove();
          }

          const container = document.createElement('span');
          container.className = 'yhbm-badge-container';
          container.setAttribute('data-badge-id', badgeId);
          container.style.cssText = 'display: inline-flex; align-items: center; margin-right: 6px; vertical-align: middle;';

          let badgeClass = 'yhbm-badge-sent';
          let iconType = 'sent';
          let tooltipText = `Sent to ${trackedItem.recruiterEmail || 'Recipient'}`;

          if (status === 'Replied') {
            badgeClass = 'yhbm-badge-replied';
            iconType = 'replied';
            tooltipText = `Replied by ${trackedItem.recruiterEmail || 'Recipient'}`;
          } else if (status === 'Opened' || status.indexOf('Opened') !== -1 || trackedItem.lastOpenTime) {
            badgeClass = 'yhbm-badge-opened';
            iconType = 'opened';
            const openTimeFormatted = formatFriendlyTime(trackedItem.lastOpenTime);
            tooltipText = `Opened ${openTimeFormatted ? 'on ' + openTimeFormatted : ''}`;
          }

          let followUpBadgeHtml = '';
          // Only show Bumped badge if actual follow-ups were dispatched (and not pure unbumped replies)
          if (hasFollowUp && (status !== 'Replied' || followUpCount > 0)) {
            const countLabel = followUpCount > 1 ? ` (${followUpCount}x)` : '';
            const followUpTimeText = trackedItem.lastFollowUpTime ? ` on ${trackedItem.lastFollowUpTime}` : '';
            followUpBadgeHtml = `<span class="yhbm-badge-followup" title="Follow-Up sent${followUpTimeText}">⚡ Bumped${countLabel}</span>`;
            tooltipText += ` • ⚡ Follow-Up #${followUpCount || 1} sent${followUpTimeText}`;
          }

          const overdueDot = (trackedItem.isOverdue && status !== 'Replied') ? '<span class="yhbm-overdue-dot" title="3+ days without reply"></span>' : '';

          container.innerHTML = `
            <span class="yhbm-badge ${badgeClass}">
              ${getBadgeSvg(iconType)}
              ${overdueDot}
            </span>
            ${followUpBadgeHtml}
            <span class="yhbm-tooltip">${tooltipText}</span>
          `;

          // INJECTION ZONE: Right before recipient name in div.yW or td.yX (The exact marked zone!)
          const recipientDiv = row.querySelector('div.yW');
          if (recipientDiv) {
            recipientDiv.prepend(container);
          } else {
            const recipientTd = row.querySelector('td.yX');
            if (recipientTd) {
              recipientTd.prepend(container);
            }
          }
        });

        isScanningRows = false;
      });
    } catch (err) {
      isScanningRows = false;
    }
  }

  // ----------------------------------------------------------------------------
  // MODULE 5: Engine Mounting
  // ----------------------------------------------------------------------------

  function startEngine() {
    loadConfiguration();
    initSendListeners();

    const observer = new MutationObserver(() => {
      if (!isContextValid()) {
        observer.disconnect();
        if (statusPollTimer) clearTimeout(statusPollTimer);
        return;
      }
      neutraliseSelfOpensInView();
      renderBadgesOnVisibleRows();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Dynamic Adaptive Polling: Every 6s in Sent box, 25s elsewhere
    function scheduleDynamicPoll() {
      if (!isContextValid()) return;
      const isSent = Boolean(window.location.hash && window.location.hash.toLowerCase().includes('#sent'));
      const delay = isSent ? 6000 : 25000;
      statusPollTimer = setTimeout(() => {
        if (isContextValid()) {
          fetchTrackingSummary(true);
          scheduleDynamicPoll();
        }
      }, delay);
    }
    scheduleDynamicPoll();

    // Instant sync when user switches back to Gmail tab
    window.addEventListener('focus', () => {
      if (isContextValid() && window.location.hash && window.location.hash.toLowerCase().includes('#sent')) {
        fetchTrackingSummary(true);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isContextValid() && window.location.hash && window.location.hash.toLowerCase().includes('#sent')) {
        fetchTrackingSummary(true);
      }
    });

    // Instant sync when user clicks into Sent folder
    window.addEventListener('hashchange', () => {
      if (window.location.hash && window.location.hash.toLowerCase().includes('#sent')) {
        fetchTrackingSummary(true);
      } else {
        document.querySelectorAll('.yhbm-badge-container').forEach(el => el.remove());
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startEngine);
  } else {
    startEngine();
  }

})();
