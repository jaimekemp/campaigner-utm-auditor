# 🟡 Campaigner UTM Auditor

A lightweight Google Chrome extension built for the Lifelong Learning team at Simon Fraser University. It scans campaign HTML in the Campaigner preview window, validates SFU and Eventbrite links against departmental tracking standards, flags UTM and parameter errors, and verifies tracking consistency across all links.

---

## 🚀 How to Install

You do not need to download anything from the Chrome Web Store. You can install it directly in Google Chrome in under a minute:

1. Click the green **Code** button at the top of this GitHub page and select **Download ZIP**.
2. Go to your computer's **Downloads** folder and unzip the file (double-click it on a Mac). 
3. Move the unzipped folder (`campaigner-utm-auditor`) somewhere safe on your computer where you won't accidentally delete it (like your `Documents` folder).
4. Open Google Chrome and enter `chrome://extensions/` in the URL bar.
5. In the top-right corner, toggle **Developer mode** to **ON**.
6. In the top-left corner, click the **Load unpacked** button.
7. Select your unzipped `campaigner-utm-auditor` folder.
8. Click the puzzle-piece icon in the top-right corner of your Chrome toolbar and **pin** the Lego UTM head to your bar!

---

## 🛠️ How to Use

1. Add UTM info in Campaigner, and then export and save the `.html` file.
2. Open your exported email `.html` file directly in Chrome.
3. Click the **Lego UTM icon** in your toolbar.
4. The auditor will inspect all internal links on the page:
   * **100% Valid:** If every link is formatted properly and shares uniform campaign parameters, a green validation badge appears.
   * **Mismatches / Errors:** The top summary card will flag discrepancies (e.g., mismatched `utm_campaign` values), and the specific links causing the issue will be labeled with red `FAIL` tags and direct highlighting on the offending text.

---

## 📋 Tracking Rules Checked

* **utm_id:** Must equal `cstudies`
* **utm_source:** Must equal `campaigner`
* **utm_medium:** Must equal `email`
* **utm_campaign:** Must be present and identical across all links
* **utm_content:** Must be present and identical across all links
* **Eventbrite links:** Must include `aff=campaigner`
* **Syntax:** Flags duplicate question marks (`?`) and prematurely placed anchor fragments (`#`)
* **Mailto:** Automatically excludes `mailto:` links
