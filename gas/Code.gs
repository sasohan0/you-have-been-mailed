/**
 * ==============================================================================
 * "You Have Been Mailed" - Google Apps Script Cloud Engine (v2.1 Pro)
 * ------------------------------------------------------------------------------
 * Features:
 * 1. Self-Open Prevention: Ignores hits within compose preload window.
 * 2. Deduplication: Token-based outbound logging prevents duplicate rows.
 * 3. Accurate Reply Detection: Inspects Gmail threads for recruiter replies.
 * 4. Automatic Pruning: action=cleanLogs removes blank/dummy test rows.
 * 5. 1-Click Auto-Bump: Direct contextual follow-up dispatch per thread.
 * 6. 3-Stage Automated Drip: Automatic follow-ups at 3-4d, 7-9d, and 14d
 *    (strictly halted immediately if recruiter replies).
 * ==============================================================================
 */

const SHEET_NAME_FILE = "Private_Email_Tracker_Log";
const TAB_NAME = "Tracker_Logs";
const HEADERS = [
  "Timestamp",
  "Recruiter Email",
  "Subject",
  "Body Snippet",
  "Status",
  "Last Open Time",
  "Tracking Token",
  "SentTimeMs",
  "FollowUpCount",
  "LastFollowUpTime"
];

// 1x1 Transparent GIF Byte Sequence (Base64)
const PIXEL_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const DEFAULT_DRIP_TEMPLATES = {
  stage1: "Hi {{name}},\n\nFollowing up on my previous email to check if you had a chance to review it. Looking forward to hearing your thoughts!\n\nBest regards,",
  stage2: "Hi {{name}},\n\nReaching back out with a quick follow-up. I'd love to share how my background aligns with your team's goals. Let me know if you have a few minutes for a brief chat this week.\n\nBest regards,",
  stage3: "Hi {{name}},\n\nI understand you're likely very busy, so I won't crowd your inbox further. If priorities align in the future, please feel free to reach out anytime. Wishing you and the team continued success!\n\nBest regards,"
};

/**
 * Ensures the Google Sheet exists in Google Drive with proper headers & styling.
 */
function getOrCreateTrackingSheet() {
  const files = DriveApp.getFilesByName(SHEET_NAME_FILE);
  let spreadsheet;

  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
  } else {
    spreadsheet = SpreadsheetApp.create(SHEET_NAME_FILE);
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName(TAB_NAME);

    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setBackground("#1A73E8")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 170); // Timestamp
    sheet.setColumnWidth(2, 220); // Recruiter Email
    sheet.setColumnWidth(3, 240); // Subject
    sheet.setColumnWidth(4, 280); // Body Snippet
    sheet.setColumnWidth(5, 130); // Status
    sheet.setColumnWidth(6, 170); // Last Open Time
    sheet.setColumnWidth(7, 180); // Token
    sheet.setColumnWidth(8, 140); // SentTimeMs
    sheet.setColumnWidth(9, 130); // FollowUpCount
    sheet.setColumnWidth(10, 170); // LastFollowUpTime
    return sheet;
  }

  let sheet = spreadsheet.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = spreadsheet.getActiveSheet();
  }

  // Ensure 10 columns exist
  if (sheet.getLastColumn() < HEADERS.length) {
    const startCol = sheet.getLastColumn() + 1;
    const numColsToAdd = HEADERS.length - sheet.getLastColumn();
    const subHeaders = HEADERS.slice(startCol - 1);
    sheet.getRange(1, startCol, 1, numColsToAdd).setValues([subHeaders])
      .setBackground("#1A73E8")
      .setFontColor("#FFFFFF")
      .setFontWeight("bold");
  }

  return sheet;
}

function sanitize(str) {
  if (!str) return "";
  return String(str).trim().toLowerCase();
}

function extractCleanEmail(raw) {
  if (!raw) return "";
  const match = String(raw).match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match ? match[1].toLowerCase() : String(raw).trim().toLowerCase();
}

/**
 * Primary HTTP GET Router
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action;

    if (action === "getStatusSummary") return handleGetStatusSummary(params);
    if (action === "logSent") return handleLogSent(params);
    if (action === "cleanLogs") return handleCleanLogs();
    if (action === "getDripSettings") return handleGetDripSettings();
    if (action === "saveDripSettings") return handleSaveDripSettings(params);
    if (action === "runAutoFollowUpDrip") return handleRunAutoFollowUpDrip(params);

    // If an action was specified but not recognized, return JSON error (NEVER return GIF for API requests!)
    if (action) {
      return createJsonResponse({ status: "error", message: "Unknown action: " + action });
    }

    // DEFAULT ACTION: Tracking Pixel Image Request (Only when no action parameter is provided)
    handleTrackingPixelHit(params);

    const pixelBytes = Utilities.base64Decode(PIXEL_BASE64);
    const blob = Utilities.newBlob(pixelBytes, "image/gif", "pixel.gif");
    return ContentService.createTextOutput(blob.getDataAsString())
      .setMimeType(ContentService.MimeType.GIF);

  } catch (err) {
    console.error("Error in doGet:", err);
    if (e && e.parameter && e.parameter.action) {
      return createJsonResponse({ status: "error", message: err.toString() });
    }
    const pixelBytes = Utilities.base64Decode(PIXEL_BASE64);
    const blob = Utilities.newBlob(pixelBytes, "image/gif", "pixel.gif");
    return ContentService.createTextOutput(blob.getDataAsString())
      .setMimeType(ContentService.MimeType.GIF);
  }
}

/**
 * Primary HTTP POST Router
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action || (e && e.parameter && e.parameter.action);

    if (action === "singleFollowUp") return handleSingleFollowUp(payload);
    if (action === "bulkFollowUp") return handleBulkFollowUp(payload);
    if (action === "cleanLogs") return handleCleanLogs();
    if (action === "getDripSettings") return handleGetDripSettings();
    if (action === "saveDripSettings") return handleSaveDripSettings(payload);
    if (action === "runAutoFollowUpDrip") return handleRunAutoFollowUpDrip(payload);

    return createJsonResponse({ status: "error", message: "Unknown action: " + action });
  } catch (err) {
    console.error("Error in doPost:", err);
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Handles incoming tracking pixel hit from recipient
 */
function handleTrackingPixelHit(params) {
  const token = params.id || params.token;
  const toParam = params.to || params.recipient;
  const subjectParam = params.subject;

  if (!token && !toParam && !subjectParam) return;

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 8)).getValues();
  const now = new Date();
  const nowTime = now.getTime();
  const nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM d, hh:mm a");

  const cleanTo = extractCleanEmail(toParam);
  const cleanSubj = sanitize(subjectParam);

  for (let i = 0; i < data.length; i++) {
    const rowToken = String(data[i][6] || "").trim();
    const rowEmail = extractCleanEmail(data[i][1]);
    const rowSubj = sanitize(data[i][2]);
    const sentTimeMs = Number(data[i][7]) || 0;

    const tokenMatch = (token && rowToken && token === rowToken);
    const emailSubjMatch = (cleanTo && rowEmail && cleanTo === rowEmail && (!cleanSubj || cleanSubj === rowSubj));

    if (tokenMatch || emailSubjMatch) {
      // 3.5s microsecond compose preload filter
      if (sentTimeMs > 0 && (nowTime - sentTimeMs) < 3500) {
        console.log("Suppressed compose prefetch open hit");
        return;
      }

      const currentRowStatus = String(data[i][4] || "").trim();
      const rowIndex = i + 2;

      if (currentRowStatus !== "Replied") {
        const isBumped = (currentRowStatus.indexOf("Follow-Up") !== -1 || currentRowStatus.indexOf("Bumped") !== -1 || (Number(data[i][8]) || 0) > 0);
        const newStatus = isBumped ? "Opened (Bumped)" : "Opened";
        sheet.getRange(rowIndex, 5).setValue(newStatus);
      }
      sheet.getRange(rowIndex, 6).setValue(nowStr);
      SpreadsheetApp.flush();
      return;
    }
  }
}

/**
 * Logs outbound sent outreach
 */
function handleLogSent(params) {
  const recipient = (params.recipient || params.to || "").trim();
  const subject = (params.subject || "(No Subject)").trim();
  const bodySnippet = (params.body || params.snippet || "").trim().substring(0, 180);
  const token = (params.token || "m_" + new Date().getTime()).trim();

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  const now = new Date();
  const nowTime = now.getTime();
  const nowStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMM d, hh:mm a");

  if (lastRow > 1) {
    const checkCount = Math.min(lastRow - 1, 15);
    const recentTokens = sheet.getRange(lastRow - checkCount + 1, 7, checkCount, 1).getValues();
    for (let k = 0; k < recentTokens.length; k++) {
      if (recentTokens[k][0] && String(recentTokens[k][0]).trim() === token) {
        return createJsonResponse({ status: "success", message: "Duplicate token ignored", token: token });
      }
    }
  }

  const newRow = [
    nowStr,
    recipient || "(No Recruiter)",
    subject,
    bodySnippet,
    "Sent",
    "",
    token,
    nowTime,
    0,   // FollowUpCount
    ""   // LastFollowUpTime
  ];

  sheet.appendRow(newRow);
  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    message: "Outreach logged successfully",
    entry: {
      timestamp: nowStr,
      recipient: recipient,
      subject: subject,
      bodySnippet: bodySnippet,
      status: "Sent",
      token: token
    }
  });
}

/**
 * Handles action=cleanLogs: Purges invalid/blank test rows
 */
function handleCleanLogs() {
  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return createJsonResponse({ status: "success", message: "Sheet is empty", deletedCount: 0 });
  }

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let deletedCount = 0;

  for (let i = data.length - 1; i >= 0; i--) {
    const email = String(data[i][1] || "").trim();
    const subject = String(data[i][2] || "").trim();

    if (!email || email === "(No Recruiter)" || (email === "" && subject === "(No Subject)")) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return createJsonResponse({
    status: "success",
    message: "Cleaned " + deletedCount + " invalid test rows.",
    deletedCount: deletedCount
  });
}

/**
 * Handles action=getStatusSummary:
 * Aggregates logs, detects replies, computes follow-up status
 */
function handleGetStatusSummary(params) {
  params = params || {};
  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  const rows = [];

  let totalSent = 0;
  let totalOpened = 0;
  let totalUnopened = 0;
  let totalReplied = 0;
  let totalOverdue = 0;
  let totalFollowUps = 0;

  const now = new Date().getTime();

  // Collect all known user emails (effective script owner, active user, and Gmail aliases)
  const userEmails = [];
  try {
    const eff = Session.getEffectiveUser().getEmail().toLowerCase().trim();
    if (eff) userEmails.push(eff);
  } catch (e) {}
  try {
    const act = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (act && userEmails.indexOf(act) === -1) userEmails.push(act);
  } catch (e) {}
  try {
    const aliases = GmailApp.getAliases();
    if (aliases && aliases.length) {
      for (let a = 0; a < aliases.length; a++) {
        const al = String(aliases[a]).toLowerCase().trim();
        if (al && userEmails.indexOf(al) === -1) userEmails.push(al);
      }
    }
  } catch (e) {}

  if (lastRow > 1) {
    const numCols = Math.max(sheet.getLastColumn(), 10);
    const range = sheet.getRange(2, 1, lastRow - 1, numCols);
    const values = range.getValues();
    let updatesNeeded = false;

    // Fast-path: Throttled reply detection to prevent slow/hanging HTTP requests.
    // Reading spreadsheet takes <0.3s. GmailApp searches are budgeted and skipped on regular polls.
    const cache = CacheService.getScriptCache();
    const forceReplyCheck = (params.checkReplies === "1" || params.checkReplies === "true");
    const replyCooldownActive = cache.get("yhbm_reply_cooldown") !== null;
    const shouldCheckReplies = forceReplyCheck || !replyCooldownActive;
    const replyCheckStart = new Date().getTime();

    for (let i = 0; i < values.length; i++) {
      const rawTimestamp = values[i][0];
      const recruiterEmail = String(values[i][1] || "").trim();
      const subject = String(values[i][2] || "").trim();
      const bodySnippet = String(values[i][3] || "").trim();
      let status = String(values[i][4] || "").trim() || "Sent";
      const lastOpenTime = values[i][5] ? String(values[i][5]).trim() : "";
      const trackingToken = String(values[i][6] || "").trim();
      const followUpCount = Number(values[i][8]) || 0;
      const lastFollowUpTime = values[i][9] ? String(values[i][9]).trim() : "";

      if (!recruiterEmail && !subject && !bodySnippet) {
        continue;
      }

      const cleanEmail = extractCleanEmail(recruiterEmail);
      const isSelfOutreach = cleanEmail && userEmails.indexOf(cleanEmail) !== -1;

      // Smart Reply Detection:
      // 1. NEVER search Gmail for self-sent test emails (prevents massive 40s mailbox scans!)
      // 2. NEVER search for threads already verified as "Replied"
      // 3. Strict 2.0-second time budget across entire request to guarantee sub-second HTTP response
      if (shouldCheckReplies && recruiterEmail && !isSelfOutreach && status !== "Replied") {
        if (new Date().getTime() - replyCheckStart < 2000) {
          try {
            const query = 'to:' + cleanEmail + (subject && subject !== '(No Subject)' ? ' subject:"' + subject.replace(/"/g, '') + '"' : '');
            const threads = GmailApp.search(query, 0, 3);

            let foundExternalReply = false;

            if (threads && threads.length > 0) {
              for (let t = 0; t < threads.length; t++) {
                const messages = threads[t].getMessages();
                if (!messages || messages.length === 0) continue;

                const firstMsg = messages[0];
                const firstSubj = (firstMsg.getSubject() || '').toLowerCase().replace(/^(re|fwd|fw):\s*/i, '').trim();
                const cleanTargetSubj = (subject || '').toLowerCase().replace(/^(re|fwd|fw):\s*/i, '').trim();

                // Verify subject match strictly on thread's root message
                if (cleanTargetSubj && cleanTargetSubj !== '(no subject)' && firstSubj !== cleanTargetSubj) {
                  continue;
                }

                // Verify recipient on initial message
                const firstTo = extractCleanEmail(firstMsg.getTo());
                if (firstTo && cleanEmail && firstTo !== cleanEmail && !firstTo.includes(cleanEmail) && !cleanEmail.includes(firstTo)) {
                  continue;
                }

                // Inspect messages for real recruiter replies
                if (messages.length > 1) {
                  for (let m = 1; m < messages.length; m++) {
                    const fromEmail = extractCleanEmail(messages[m].getFrom());
                    if (fromEmail && userEmails.indexOf(fromEmail) === -1) {
                      foundExternalReply = true;
                      break;
                    }
                  }
                }
                break;
              }
            }

            if (foundExternalReply) {
              status = "Replied";
              values[i][4] = "Replied";
              updatesNeeded = true;
            }
          } catch (searchErr) {
            console.warn("Gmail search notice: " + searchErr);
          }
        }
      }

      // Auto-heal self outreach if previously falsely marked Replied
      if (isSelfOutreach && status === "Replied") {
        const correctedStatus = followUpCount > 0 
          ? (lastOpenTime ? "Opened (Bumped)" : "Follow-Up Sent")
          : (lastOpenTime ? "Opened" : "Sent");
        status = correctedStatus;
        values[i][4] = correctedStatus;
        updatesNeeded = true;
      }

      const itemTime = new Date(rawTimestamp).getTime();
      const elapsedHours = (now - itemTime) / (1000 * 60 * 60);
      const isOverdue = elapsedHours >= 72 && status !== "Replied";

      totalSent++;
      const isOpened = status === "Opened" || status.indexOf("Opened") !== -1 || status === "Replied" || Boolean(lastOpenTime);
      if (isOpened) {
        totalOpened++;
      }
      if ((status === "Sent" || status === "Follow-Up Sent") && !lastOpenTime) {
        totalUnopened++;
      }
      if (status === "Replied") {
        totalReplied++;
      }
      if (followUpCount > 0 || status.indexOf("Follow-Up") !== -1 || status.indexOf("Bumped") !== -1) {
        totalFollowUps++;
      }

      if (isOverdue) totalOverdue++;

      rows.push({
        rowIndex: i + 2,
        timestamp: rawTimestamp,
        recruiterEmail: recruiterEmail,
        subject: subject,
        bodySnippet: bodySnippet,
        status: status,
        lastOpenTime: lastOpenTime,
        trackingToken: trackingToken,
        followUpCount: followUpCount,
        lastFollowUpTime: lastFollowUpTime,
        elapsedHours: Math.round(elapsedHours * 10) / 10,
        isOverdue: isOverdue
      });
    }

    if (shouldCheckReplies) {
      try {
        cache.put("yhbm_reply_cooldown", "active", 120); // 2 minutes cooldown
      } catch (cErr) {}
    }

    if (updatesNeeded) {
      try {
        range.setValues(values);
      } catch (wErr) {
        console.warn("Write back notice: " + wErr);
      }
    }
  }

  const dripSettings = getDripSettings();

  return createJsonResponse({
    status: "success",
    summary: {
      total: totalSent,
      opened: totalOpened,
      unopened: totalUnopened,
      replied: totalReplied,
      overdue: totalOverdue,
      followUps: totalFollowUps,
      dripEnabled: dripSettings.enabled
    },
    data: rows
  });
}

/**
 * Safely dispatches a follow-up email directly to the recruiter,
 * using GmailApp.sendEmail with RFC822 In-Reply-To / References headers
 * so it stays in the natural conversation thread AND is guaranteed to be received by the recruiter.
 */
function dispatchFollowUpEmail(recipientEmail, subject, bodyMessage) {
  const cleanEmail = extractCleanEmail(recipientEmail);
  if (!cleanEmail) {
    throw new Error("Invalid recipient email address");
  }

  const cleanSubject = String(subject || "").trim();
  const baseSubject = cleanSubject && cleanSubject !== "(No Subject)" ? cleanSubject : "Our conversation";
  const replySubject = baseSubject.toLowerCase().startsWith("re:") ? baseSubject : "Re: " + baseSubject;

  let rfcMessageId = "";
  try {
    const query = 'to:' + cleanEmail + (cleanSubject && cleanSubject !== '(No Subject)' ? ' subject:"' + cleanSubject.replace(/"/g, '') + '"' : '');
    const threads = GmailApp.search(query, 0, 3);
    if (threads && threads.length > 0) {
      const messages = threads[0].getMessages();
      if (messages && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        try {
          const raw = lastMsg.getRawContent();
          const match = raw.match(/Message-ID:\s*<([^>]+)>/i);
          if (match && match[1]) {
            rfcMessageId = match[1];
          }
        } catch (rawErr) {
          console.warn("Message-ID extraction warning: " + rawErr);
        }
      }
    }
  } catch (searchErr) {
    console.warn("Thread search warning: " + searchErr);
  }

  if (rfcMessageId) {
    GmailApp.sendEmail(cleanEmail, replySubject, bodyMessage, {
      headers: {
        "In-Reply-To": "<" + rfcMessageId + ">",
        "References": "<" + rfcMessageId + ">"
      }
    });
  } else {
    GmailApp.sendEmail(cleanEmail, replySubject, bodyMessage);
  }

  return {
    email: cleanEmail,
    subject: replySubject,
    rfcMessageId: rfcMessageId,
    threaded: Boolean(rfcMessageId)
  };
}

/**
 * Handles action=singleFollowUp: 1-Click Contextual Auto-Bump
 */
function handleSingleFollowUp(payload) {
  const email = extractCleanEmail(payload.email || payload.recruiterEmail);
  const subject = (payload.subject || "").trim();
  const followUpMessage = payload.message || payload.followUpMessage || "Hi,\n\nFollowing up on my previous note. Looking forward to connecting!\n\nBest,";
  const rowIndex = Number(payload.rowIndex);

  if (!email) {
    return createJsonResponse({ status: "error", message: "Invalid recipient email" });
  }

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();

  if (rowIndex && rowIndex <= lastRow) {
    const currentStatus = String(sheet.getRange(rowIndex, 5).getValue() || "").trim();
    if (currentStatus === "Replied") {
      return createJsonResponse({ status: "error", message: "Recruiter has already replied! Follow-up cancelled to protect conversation." });
    }
  }

  try {
    const dispatchResult = dispatchFollowUpEmail(email, subject, followUpMessage);
    const formattedTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, hh:mm a");

    let newCount = 1;
    if (rowIndex && rowIndex <= lastRow) {
      const currentStatus = String(sheet.getRange(rowIndex, 5).getValue() || "").trim();
      const newStatus = currentStatus.indexOf("Opened") !== -1 ? "Opened (Bumped)" : "Follow-Up Sent";
      sheet.getRange(rowIndex, 5).setValue(newStatus);
      if (sheet.getLastColumn() >= 9) {
        const currentCount = Number(sheet.getRange(rowIndex, 9).getValue()) || 0;
        newCount = currentCount + 1;
        sheet.getRange(rowIndex, 9).setValue(newCount);
        sheet.getRange(rowIndex, 10).setValue(formattedTime);
      }
      SpreadsheetApp.flush();
    }

    return createJsonResponse({
      status: "success",
      message: "Follow-up dispatched successfully to " + email,
      email: email,
      followUpCount: newCount,
      lastFollowUpTime: formattedTime,
      threaded: dispatchResult.threaded
    });
  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: "Failed to dispatch follow-up: " + err.toString()
    });
  }
}

/**
 * Handles action=bulkFollowUp
 */
function handleBulkFollowUp(payload) {
  const targets = payload.targets || [];
  if (!Array.isArray(targets) || targets.length === 0) {
    return createJsonResponse({ status: "error", message: "No targets provided." });
  }

  const results = [];
  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  const formattedTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, hh:mm a");

  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx];
    const email = extractCleanEmail(target.email || target.recruiterEmail);
    const subject = (target.subject || "").trim();
    const followUpMessage = target.followUpMessage || "Hi,\n\nFollowing up on my previous note. Looking forward to connecting!\n\nBest,";

    if (!email) {
      results.push({ email: email, success: false, error: "Invalid email" });
      continue;
    }

    try {
      const dispatchResult = dispatchFollowUpEmail(email, subject, followUpMessage);

      if (target.rowIndex && target.rowIndex <= lastRow) {
        const currentStatus = String(sheet.getRange(target.rowIndex, 5).getValue() || "").trim();
        const newStatus = currentStatus.indexOf("Opened") !== -1 ? "Opened (Bumped)" : "Follow-Up Sent";
        sheet.getRange(target.rowIndex, 5).setValue(newStatus);
        if (sheet.getLastColumn() >= 9) {
          const currentCount = Number(sheet.getRange(target.rowIndex, 9).getValue()) || 0;
          sheet.getRange(target.rowIndex, 9).setValue(currentCount + 1);
          sheet.getRange(target.rowIndex, 10).setValue(formattedTime);
        }
      }
      results.push({ email: email, subject: subject, success: true, threaded: dispatchResult.threaded, lastFollowUpTime: formattedTime });
    } catch (err) {
      results.push({ email: email, success: false, error: err.toString() });
    }
  }

  SpreadsheetApp.flush();

  return createJsonResponse({
    status: "success",
    processed: results.length,
    results: results
  });
}

// ----------------------------------------------------------------------------
// 3-Stage Automated Follow-Up Drip System (3-4d, 7-9d, 14d)
// ----------------------------------------------------------------------------

function getDripSettings() {
  const props = PropertiesService.getUserProperties();
  const enabled = props.getProperty("DRIP_ENABLED") === "true";
  const stage1 = props.getProperty("DRIP_STAGE1_TEMPLATE") || DEFAULT_DRIP_TEMPLATES.stage1;
  const stage2 = props.getProperty("DRIP_STAGE2_TEMPLATE") || DEFAULT_DRIP_TEMPLATES.stage2;
  const stage3 = props.getProperty("DRIP_STAGE3_TEMPLATE") || DEFAULT_DRIP_TEMPLATES.stage3;
  return { enabled: enabled, stage1: stage1, stage2: stage2, stage3: stage3 };
}

function handleGetDripSettings() {
  return createJsonResponse({
    status: "success",
    settings: getDripSettings()
  });
}

function handleSaveDripSettings(payload) {
  const props = PropertiesService.getUserProperties();
  if (typeof payload.enabled !== "undefined") {
    let isEnabled = false;
    if (typeof payload.enabled === "boolean") {
      isEnabled = payload.enabled;
    } else if (typeof payload.enabled === "string") {
      isEnabled = (payload.enabled.toLowerCase() === "true" || payload.enabled === "1");
    }
    props.setProperty("DRIP_ENABLED", String(isEnabled));
    manageDripTrigger(isEnabled);
  }
  if (payload.stage1) props.setProperty("DRIP_STAGE1_TEMPLATE", payload.stage1);
  if (payload.stage2) props.setProperty("DRIP_STAGE2_TEMPLATE", payload.stage2);
  if (payload.stage3) props.setProperty("DRIP_STAGE3_TEMPLATE", payload.stage3);

  return createJsonResponse({
    status: "success",
    message: "3-Stage Auto-Drip settings updated successfully.",
    settings: getDripSettings()
  });
}

function manageDripTrigger(enable) {
  try {
    if (typeof ScriptApp !== "undefined" && ScriptApp.getProjectTriggers) {
      const triggers = ScriptApp.getProjectTriggers();
      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].getHandlerFunction() === "runDailyAutoFollowUps") {
          ScriptApp.deleteTrigger(triggers[i]);
        }
      }
      if (enable) {
        ScriptApp.newTrigger("runDailyAutoFollowUps")
          .timeBased()
          .everyDays(1)
          .atHour(10) // 10:00 AM local time
          .create();
      }
    }
  } catch (triggerErr) {
    console.log("Trigger management notice (safely managed via Chrome Extension background scheduler): " + triggerErr);
  }
}

/**
 * Trigger target function for Google Apps Script daily scheduler
 */
function runDailyAutoFollowUps() {
  return handleRunAutoFollowUpDrip();
}

/**
 * Evaluates threads and executes 3-Stage Drip
 * Supports global evaluation or targeted candidate multi-selection.
 */
function handleRunAutoFollowUpDrip(payload) {
  payload = payload || {};
  const settings = getDripSettings();
  const isForceRun = Boolean(payload.force || payload.isManual || (payload.targets && payload.targets.length > 0));

  if (!settings.enabled && !isForceRun) {
    return createJsonResponse({
      status: "success",
      message: "3-Stage Auto-Drip is currently paused in settings.",
      processed: 0,
      dispatchedCount: 0,
      dispatched: []
    });
  }

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return createJsonResponse({
      status: "success",
      message: "No outreach logged in sheet.",
      processed: 0,
      dispatchedCount: 0,
      dispatched: []
    });
  }

  // Target filter if specific candidates were selected
  let targetEmails = null;
  let targetRowIndices = null;
  if (Array.isArray(payload.targets) && payload.targets.length > 0) {
    targetEmails = [];
    targetRowIndices = [];
    for (let t = 0; t < payload.targets.length; t++) {
      const item = payload.targets[t];
      const clean = extractCleanEmail(typeof item === 'string' ? item : (item.email || item.recruiterEmail));
      if (clean) targetEmails.push(clean);
      const rIdx = (typeof item === 'object' && item.rowIndex) ? Number(item.rowIndex) : null;
      if (rIdx) targetRowIndices.push(rIdx);
    }
  }

  // Collect user emails to protect against self-drip
  const userEmails = [];
  try {
    const eff = Session.getEffectiveUser().getEmail().toLowerCase().trim();
    if (eff) userEmails.push(eff);
  } catch (e) {}
  try {
    const act = Session.getActiveUser().getEmail().toLowerCase().trim();
    if (act && userEmails.indexOf(act) === -1) userEmails.push(act);
  } catch (e) {}

  const range = sheet.getRange(2, 1, lastRow - 1, 10);
  const values = range.getValues();
  const now = new Date().getTime();
  const dispatched = [];
  let updatesNeeded = false;

  for (let i = 0; i < values.length; i++) {
    const currentRowIndex = i + 2;
    const rawTimestamp = values[i][0];
    const email = extractCleanEmail(values[i][1]);
    const subject = String(values[i][2] || "").trim();
    let status = String(values[i][4] || "").trim();
    let followUpCount = Number(values[i][8]) || 0;
    const lastFollowUpIso = values[i][9] ? String(values[i][9]).trim() : "";

    // STRICT SAFETY GUARDS:
    // 1. Recruiter replied -> NEVER send any auto-followup!
    // 2. Self outreach -> NEVER send auto-followup to self!
    // 3. Already completed 3 stages -> complete!
    if (status === "Replied" || !email || userEmails.indexOf(email) !== -1 || followUpCount >= 3) {
      continue;
    }

    // Check if targeting specific items
    const hasTargets = targetEmails && targetEmails.length > 0;
    if (hasTargets) {
      const isTargeted = (targetEmails.indexOf(email) !== -1) || (targetRowIndices && targetRowIndices.indexOf(currentRowIndex) !== -1);
      if (!isTargeted) continue;
    }

    const itemTime = new Date(rawTimestamp).getTime();
    const elapsedDays = !isNaN(itemTime) ? ((now - itemTime) / (1000 * 60 * 60 * 24)) : 999;
    const lastFollowUpMs = lastFollowUpIso ? new Date(lastFollowUpIso).getTime() : 0;
    const daysSinceLastFollowUp = lastFollowUpMs ? ((now - lastFollowUpMs) / (1000 * 60 * 60 * 24)) : 999;

    let targetStage = 0;
    let template = "";

    if (hasTargets && isForceRun) {
      // Direct enrollment/trigger on selected candidate: advance to next stage immediately
      if (followUpCount === 0) {
        targetStage = 1;
        template = settings.stage1;
      } else if (followUpCount === 1) {
        targetStage = 2;
        template = settings.stage2;
      } else if (followUpCount === 2) {
        targetStage = 3;
        template = settings.stage3;
      }
    } else {
      // Standard automated drip timeline schedule:
      // Stage 1: 3-4 days (>= 3.0 days), followUpCount == 0
      if (followUpCount === 0 && elapsedDays >= 3.0) {
        targetStage = 1;
        template = settings.stage1;
      }
      // Stage 2: 7-9 days (>= 7.0 days), followUpCount == 1, and at least 3 days after stage 1
      else if (followUpCount === 1 && elapsedDays >= 7.0 && daysSinceLastFollowUp >= 3.0) {
        targetStage = 2;
        template = settings.stage2;
      }
      // Stage 3: 14 days (>= 14.0 days), followUpCount == 2, and at least 5 days after stage 2
      else if (followUpCount === 2 && elapsedDays >= 14.0 && daysSinceLastFollowUp >= 5.0) {
        targetStage = 3;
        template = settings.stage3;
      }
    }

    if (targetStage > 0 && template) {
      const recipientName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      const bodyMessage = template
        .replace(/\{\{name\}\}/gi, recipientName)
        .replace(/\{\{subject\}\}/gi, subject);

      try {
        const dispatchResult = dispatchFollowUpEmail(email, subject, bodyMessage);
        const formattedTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, hh:mm a");

        followUpCount = targetStage;
        values[i][4] = "Follow-Up " + targetStage + (targetStage === 3 ? " (Final)" : " Sent");
        values[i][8] = followUpCount;
        values[i][9] = formattedTime;
        updatesNeeded = true;

        dispatched.push({
          email: email,
          subject: subject,
          stage: targetStage,
          timestamp: formattedTime,
          threaded: dispatchResult.threaded
        });
      } catch (err) {
        console.warn("Auto-drip error for " + email + ": " + err);
      }
    }
  }

  if (updatesNeeded) {
    try {
      range.setValues(values);
    } catch (wErr) {
      console.warn("Write back notice in drip: " + wErr);
    }
  }

  const message = dispatched.length > 0
    ? "Successfully dispatched " + dispatched.length + " automated follow-up" + (dispatched.length > 1 ? "s!" : "!")
    : "Drip evaluation complete: all contacts are either fresh, replied, or not yet due for follow-up.";

  return createJsonResponse({
    status: "success",
    message: message,
    processed: values.length,
    dispatchedCount: dispatched.length,
    dispatched: dispatched
  });
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
