# Contributing to You Have Been Mailed

First off, thank you for considering contributing to **You Have Been Mailed**! It's people like you that make this open-source recruiter outreach tracker better for everyone.

---

## 🧭 Code of Conduct
This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## 🛠️ How Can I Contribute?

### 1. Reporting Bugs
- Ensure the bug was not already reported by searching on GitHub under [Issues](https://github.com/sasohan0/you-have-been-mailed/issues).
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/sasohan0/you-have-been-mailed/issues/new?template=bug_report.md).
- Include clear steps to reproduce and any error messages from `chrome://extensions/?errors`.

### 2. Suggesting Enhancements
- Check if your idea has already been suggested under [Issues](https://github.com/sasohan0/you-have-been-mailed/issues).
- Open a [Feature Request](https://github.com/sasohan0/you-have-been-mailed/issues/new?template=feature_request.md) with a detailed description of the proposed feature and why it would benefit job seekers.

### 3. Submitting Pull Requests (PRs)
1. **Fork the repo** and create your branch from `main`:
   ```bash
   git checkout -b feature/amazing-feature
   ```
2. **Make your changes**:
   - Adhere strictly to **Zero External Dependencies** for the core extension (vanilla JS, CSP-compliant, no npm builds needed).
   - Ensure privacy: Never send user data to third-party servers. All data stays strictly in the user's personal Google Sheet and Apps Script container.
3. **Verify syntax**:
   ```bash
   node -c dashboard/dashboard.js background/service-worker.js content/content.js
   ```
4. **Commit your changes**:
   - Write clear, meaningful commit messages (e.g. `feat: add custom follow-up reminder interval`).
5. **Push to your fork** and submit a Pull Request.

---

## 🌟 Support the Project
Even if you don't write code, you can support us by:
- ⭐ **Starring this repository on GitHub** to help other job seekers discover it!
- 📢 Sharing it on LinkedIn or Twitter/X using templates in [SHARE.md](SHARE.md).
- 💬 Giving feedback and sharing your job search success stories.
