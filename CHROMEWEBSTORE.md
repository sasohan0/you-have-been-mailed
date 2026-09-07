# Chrome Web Store Metadata: You Have Been Mailed

**Extension Name**: You Have Been Mailed  
**Version**: 1.0.0  
**Last Updated**: 2026-09-07  
**Category**: Productivity / Workflow  

---

## 1. Store Listing Copy

### Summary (132 characters max)
Private, lightweight recruiter email tracking and WhatsApp-style delivery checkmarks directly inside Gmail. Zero third-party servers.

### Detailed Description
You Have Been Mailed is an open, private, zero-subscription email tracking system designed for job hunters, founders, and professionals reaching out to recruiters and prospects.

Traditional email tracking tools use shared third-party proxy domains that frequently trigger enterprise spam filters (Proofpoint, Mimecast, Barracuda), sending your carefully written outreach emails directly into the spam folder.

"You Have Been Mailed" solves this problem permanently:
- 100% Private Cloud: Runs entirely on your personal Google Apps Script backend hosted on native Google Cloud infrastructure.
- Zero Commercial Footprints: No third-party servers, no analytics trackers, and no subscription fees.
- WhatsApp-Style Checkmarks in Gmail:
  • Single Gray Tick (✓) ➔ Sent & Delivered (Unopened).
  • Double Blue Ticks (✓✓) ➔ Opened (with exact timestamp tooltip on hover).
  • Green Envelope (✉️) ➔ Recruiter has Replied.
- Follow-Up Automation Dashboard: Easily see candidates whose threads are idling past 72+ hours and dispatch threaded auto-bumps in one click.

---

## 2. Permissions Justification

| Permission | Justification |
| :--- | :--- |
| `storage` | Required to securely persist the user's private Google Apps Script Web App URL and toggle tracking on or off locally. |
| `activeTab` | Allows the extension to interact with the active Gmail tab when opening settings or inspecting current compose elements. |
| `scripting` | Enables dynamic injection of tracking components and status badge elements inside the Gmail client UI. |

### Host Permissions Justification

| Host Pattern | Justification |
| :--- | :--- |
| `https://mail.google.com/*` | Required to hook into Gmail's compose interface and render delivery status checkmarks next to recruiter threads. |
| `https://*.google.com/*` | Required for authentication handshakes and communication with native Google services. |
| `https://script.google.com/*` | Required to communicate with your private Google Apps Script Web App backend. |
| `https://script.googleusercontent.com/*` | Required to fetch tracking summaries and logs returned by Google Apps Script web app executions. |

---

## 3. Privacy & Data Disclosures

- **Single Purpose**: Track outbound Gmail outreach emails and display read receipts using the user's personal Google Sheet and Google Apps Script.
- **Data Collection**: No personal data, email bodies, or contact lists are collected, sent, or sold to any developer or third party. All tracking pings travel exclusively between the recipient's email client, Google's infrastructure, and the user's own Google Sheet.
- **Storage**: Data is stored exclusively in the user's private Google Drive under `"Private_Email_Tracker_Log"` and locally in Chrome's `chrome.storage.local`.
