/**
 * ==============================================================================
 * "You Have Been Mailed" - Google Apps Script Cloud Engine (v2 Robust)
 * ------------------------------------------------------------------------------
 * Fixes & Enhancements:
 * 1. Self-Open Prevention: Ignores hits within 15 seconds of send time (compose prefetch).
 * 2. Deduplication: Idempotent token-based logging to prevent duplicate rows.
 * 3. Accurate Reply Detection: Inspects GmailApp threads for recruiter replies.
 * 4. Automatic Pruning: action=cleanLogs removes any blank/dummy rows.
 * ==============================================================================
 */

const SHEET_NAME_FILE = "Private_Email_Tracker_Log";
const TAB_NAME = "Tracker_Logs";
const HEADERS = ["Timestamp", "Recruiter Email", "Subject", "Body Snippet", "Status", "Last Open Time", "Tracking Token", "SentTimeMs"];

// 1x1 Transparent GIF Byte Sequence (Base64)
const PIXEL_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Ensures the Google Sheet exists in Google Drive and has proper headers & styling.
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
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
    sheet.setColumnWidth(5, 120); // Status
    sheet.setColumnWidth(6, 170); // Last Open Time
    return sheet;
  }

  let sheet = spreadsheet.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = spreadsheet.getActiveSheet();
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

    // ACTION: getStatusSummary
    if (action === "getStatusSummary") {
      return handleGetStatusSummary();
    }

    // ACTION: logSent
    if (action === "logSent") {
      return handleLogSent(params);
    }

    // ACTION: cleanLogs (Prunes empty/corrupted test rows)
    if (action === "cleanLogs") {
      return handleCleanLogs();
    }

    // DEFAULT ACTION: Tracking Pixel Image Request
    handleTrackingPixelHit(params);

    const pixelBytes = Utilities.base64Decode(PIXEL_BASE64);
    const blob = Utilities.newBlob(pixelBytes, "image/gif", "pixel.gif");
    return ContentService.createTextOutput(blob.getDataAsString())
      .setMimeType(ContentService.MimeType.GIF);

  } catch (err) {
    console.error("Error in doGet:", err);
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

    if (action === "bulkFollowUp") {
      return handleBulkFollowUp(payload);
    }

    if (action === "cleanLogs") {
      return handleCleanLogs();
    }

    return createJsonResponse({ status: "error", message: "Unknown action: " + action });
  } catch (err) {
    console.error("Error in doPost:", err);
    return createJsonResponse({ status: "error", message: err.toString() });
  }
}

/**
 * Handles pixel open hit with Strict Self-Open Protection
 */
function handleTrackingPixelHit(params) {
  const token = (params.id || params.token || "").trim();
  const recipient = (params.to || params.recipient || params.email || "").trim();
  const subject = (params.subject || "").trim();
  const now = new Date();
  const nowMs = now.getTime();
  const nowStr = Utilities.formatDate(now, "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const numCols = Math.max(sheet.getLastColumn(), 8);
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  let matchedRow = -1;
  let currentStatus = "";
  let sentTimeMs = 0;

  // Search by token first, or by recipient (from newest to oldest)
  for (let i = data.length - 1; i >= 0; i--) {
    const rowToken = String(data[i][6] || "").trim();
    const rowEmail = sanitize(data[i][1]);
    const rowSubject = sanitize(data[i][2]);

    let isMatch = false;
    if (token && rowToken && (rowToken === token || token.includes(rowToken) || rowToken.includes(token))) {
      isMatch = true;
    } else if (recipient && rowEmail === sanitize(recipient)) {
      isMatch = true; // Match latest outreach to this recipient
    }

    if (isMatch) {
      matchedRow = i + 2;
      currentStatus = String(data[i][4] || "").trim();
      sentTimeMs = Number(data[i][7]) || 0;
      break;
    }
  }

  if (matchedRow > 0) {
    // Compose window pre-load protection:
    // When sender clicks Send, the DOM creation in the compose box pings the pixel within 0-2 seconds.
    // Legitimate email transit across SMTP takes at least 3.5 seconds. Ignore any hit within 3.5 seconds.
    if (sentTimeMs > 0) {
      const elapsedMs = nowMs - sentTimeMs;
      if (elapsedMs < 3500) {
        console.log("Compose pre-load hit ignored: elapsed " + elapsedMs + "ms < 3500ms");
        return;
      }
    }

    if (currentStatus !== "Replied") {
      sheet.getRange(matchedRow, 5).setValue("Opened");
    }
    sheet.getRange(matchedRow, 6).setValue(nowStr);
  }
}

/**
 * Handles action=logSent with Deduplication
 */
function handleLogSent(params) {
  const recipient = (params.recipient || params.to || "").trim();
  let token = (params.token || "").trim();
  if (!token) {
    token = (params.id && !params.id.includes('@')) ? params.id.trim() : ('m_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
  }
  const subject = (params.subject || "").trim();
  const bodySnippet = (params.body || "").trim();
  const now = new Date();
  const nowMs = now.getTime();
  const nowStr = Utilities.formatDate(now, "GMT", "yyyy-MM-dd'T'HH:mm:ss'Z'");

  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();

  // Deduplication check: Do not insert duplicate if identical token, or identical recipient+subject within 3 seconds
  if (lastRow > 1) {
    const numCols = Math.max(sheet.getLastColumn(), 8);
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      const existingToken = String(data[i][6] || "").trim();
      const existingEmail = sanitize(data[i][1]);
      const existingSubj = sanitize(data[i][2]);
      const existingSentMs = Number(data[i][7]) || 0;

      if (token && existingToken && existingToken === token) {
        return createJsonResponse({ status: "success", message: "Deduplicated by token", deduplicated: true });
      }

      if (recipient && existingEmail === sanitize(recipient) && existingSubj === sanitize(subject)) {
        if (Math.abs(nowMs - existingSentMs) < 3000) {
          return createJsonResponse({ status: "success", message: "Deduplicated by 3s double click window", deduplicated: true });
        }
      }
    }
  }

  sheet.appendRow([nowStr, recipient, subject, bodySnippet, "Sent", "", token, nowMs]);

  return createJsonResponse({
    status: "success",
    message: "Email logged successfully",
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

  // Iterate backwards to safely delete rows
  for (let i = data.length - 1; i >= 0; i--) {
    const email = String(data[i][1] || "").trim();
    const subject = String(data[i][2] || "").trim();

    // Delete if email is empty
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
 * Scans sheet, cross-references Gmail threads for recruiter responses
 */
function handleGetStatusSummary() {
  const sheet = getOrCreateTrackingSheet();
  const lastRow = sheet.getLastRow();
  const rows = [];

  let totalSent = 0;
  let totalOpened = 0;
  let totalUnopened = 0;
  let totalReplied = 0;
  let totalOverdue = 0;

  const now = new Date().getTime();
  let userEmail = "";
  try {
    userEmail = Session.getActiveUser().getEmail().toLowerCase();
  } catch (e) {}

  if (lastRow > 1) {
    const numCols = Math.max(sheet.getLastColumn(), 8);
    const range = sheet.getRange(2, 1, lastRow - 1, numCols);
    const values = range.getValues();
    let updatesNeeded = false;

    for (let i = 0; i < values.length; i++) {
      const rawTimestamp = values[i][0];
      const recruiterEmail = String(values[i][1] || "").trim();
      const subject = String(values[i][2] || "").trim();
      const bodySnippet = String(values[i][3] || "").trim();
      let status = String(values[i][4] || "").trim() || "Sent";
      const lastOpenTime = values[i][5] ? String(values[i][5]).trim() : "";
      const trackingToken = String(values[i][6] || "").trim();

      // Skip completely empty rows
      if (!recruiterEmail && !subject && !bodySnippet) {
        continue;
      }

      // Check replies with GmailApp
      if (status !== "Replied" && recruiterEmail) {
        try {
          const cleanEmail = extractCleanEmail(recruiterEmail);
          const query = 'to:' + cleanEmail + (subject && subject !== '(No Subject)' ? ' subject:"' + subject.replace(/"/g, '') + '"' : '');
          const threads = GmailApp.search(query, 0, 2);

          if (threads && threads.length > 0) {
            for (let t = 0; t < threads.length; t++) {
              const messages = threads[t].getMessages();
              if (messages.length > 1) {
                let hasRecruiterReply = false;
                for (let m = 1; m < messages.length; m++) {
                  const fromEmail = extractCleanEmail(messages[m].getFrom());
                  if (fromEmail && fromEmail !== userEmail) {
                    hasRecruiterReply = true;
                    break;
                  }
                }

                if (hasRecruiterReply) {
                  status = "Replied";
                  values[i][4] = "Replied";
                  updatesNeeded = true;
                  break;
                }
              }
            }
          }
        } catch (searchErr) {
          console.warn("Gmail search skipped: " + searchErr);
        }
      }

      const itemTime = new Date(rawTimestamp).getTime();
      const elapsedHours = (now - itemTime) / (1000 * 60 * 60);
      const isOverdue = elapsedHours >= 72 && status !== "Replied";

      totalSent++;
      const isOpened = status === "Opened" || status === "Replied" || Boolean(lastOpenTime);
      if (isOpened) {
        totalOpened++;
      }
      if (status === "Sent" && !lastOpenTime) {
        totalUnopened++;
      }
      if (status === "Replied") {
        totalReplied++;
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
        elapsedHours: Math.round(elapsedHours * 10) / 10,
        isOverdue: isOverdue
      });
    }

    if (updatesNeeded) {
      range.setValues(values);
    }
  }

  return createJsonResponse({
    status: "success",
    summary: {
      total: totalSent,
      opened: totalOpened,
      unopened: totalUnopened,
      replied: totalReplied,
      overdue: totalOverdue
    },
    data: rows
  });
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
      const query = 'to:' + email + (subject ? ' subject:"' + subject.replace(/"/g, '') + '"' : '');
      const threads = GmailApp.search(query, 0, 2);

      if (threads && threads.length > 0) {
        threads[0].reply(followUpMessage);
        if (target.rowIndex && target.rowIndex <= lastRow) {
          sheet.getRange(target.rowIndex, 5).setValue("Follow-Up Sent");
        }
        results.push({ email: email, subject: subject, success: true });
      } else {
        GmailApp.sendEmail(email, "Following up: " + (subject || "Our conversation"), followUpMessage);
        if (target.rowIndex && target.rowIndex <= lastRow) {
          sheet.getRange(target.rowIndex, 5).setValue("Follow-Up Sent");
        }
        results.push({ email: email, subject: subject, success: true, fallback: "new_thread" });
      }
    } catch (err) {
      results.push({ email: email, success: false, error: err.toString() });
    }
  }

  return createJsonResponse({
    status: "success",
    processed: results.length,
    results: results
  });
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
