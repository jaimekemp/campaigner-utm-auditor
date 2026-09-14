chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || !tab.id) return;

  // allFrames: true allows the script to tunnel into Campaigner's preview <iframe>
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id, allFrames: true },
      func: scrapeFrameLinks
    },
    (injectionResults) => {
      if (!injectionResults || injectionResults.length === 0) {
        document.getElementById("content").innerHTML =
          '<div class="empty-state">Unable to inspect this page. Ensure you have Campaigner preview open.</div>';
        return;
      }

      // Aggregate all links scraped across the parent window and any nested iframes
      const aggregatedLinks = [];
      injectionResults.forEach((frame) => {
        if (frame && Array.isArray(frame.result)) {
          aggregatedLinks.push(...frame.result);
        }
      });

      if (aggregatedLinks.length === 0) {
        const badge = document.getElementById("summary-badge");
        badge.textContent = "0 Links";
        document.getElementById("content").innerHTML =
          '<div class="empty-state">No internal SFU or Eventbrite links detected.</div>';
        return;
      }

      // Audit and evaluate consistency across all collected links
      const auditData = processAndAuditLinks(aggregatedLinks);
      renderReport(auditData);
    }
  );
});

// Executed inside each frame context
function scrapeFrameLinks() {
  const anchors = Array.from(document.querySelectorAll("a[href]"));

  // 1. Filter out mailto: links and blank hrefs
  const validAnchors = anchors.filter((a) => {
    const href = a.getAttribute("href") ? a.href.trim() : "";
    return href && !href.toLowerCase().startsWith("mailto:");
  });

  // 2. Target SFU and Eventbrite destinations
  const targetAnchors = validAnchors.filter((a) => {
    const href = a.href.toLowerCase();
    return href.includes("sfu.ca") || href.includes("eventbrite");
  });

  return targetAnchors.map((a) => {
    let linkText = a.innerText ? a.innerText.trim() : "";
    if (!linkText) {
      const img = a.querySelector("img");
      if (img && img.getAttribute("alt")) {
        linkText = `[Image: ${img.getAttribute("alt").trim()}]`;
      } else if (img) {
        linkText = "[Image Link]";
      } else {
        linkText = "[Text Link]";
      }
    }

    return {
      name: linkText,
      url: a.href.trim()
    };
  });
}

// Runs in popup context: parses URLs, verifies tracking rules, and checks uniformity
function processAndAuditLinks(rawItems) {
  const parsedItems = rawItems.map((item, index) => {
    const rawUrl = item.url;
    const linkNumber = index + 1;
    const issues = [];
    const highlights = [];
    let params = null;

    // Syntax checks
    if ((rawUrl.match(/\?/g) || []).length > 1) {
      issues.push("Duplicate '?' detected (broken query structure)");
    }
    if (rawUrl.includes("#") && rawUrl.includes("?") && rawUrl.indexOf("#") < rawUrl.indexOf("?")) {
      issues.push("Anchor (#) placed before query (?) string");
      highlights.push("#");
    }

    try {
      const parsed = new URL(rawUrl);
      params = {
        utm_id: parsed.searchParams.get("utm_id") || "",
        utm_source: parsed.searchParams.get("utm_source") || "",
        utm_medium: parsed.searchParams.get("utm_medium") || "",
        utm_campaign: parsed.searchParams.get("utm_campaign") || "",
        utm_content: parsed.searchParams.get("utm_content") || "",
        aff: parsed.searchParams.get("aff") || ""
      };

      // Detect misspelled tracking keys
      for (const [key] of parsed.searchParams.entries()) {
        if (
          key.startsWith("utm_") &&
          !["utm_id", "utm_source", "utm_medium", "utm_campaign", "utm_content"].includes(key)
        ) {
          issues.push(`Misspelled tracking key: "${key}"`);
          highlights.push(key);
        }
      }

      if (parsed.hostname.includes("eventbrite") && params.aff !== "campaigner") {
        issues.push("Eventbrite link missing affiliate parameter ('aff=campaigner')");
      }
    } catch (e) {
      issues.push("Malformed or unparseable URL");
    }

    return {
      index: linkNumber,
      name: item.name,
      url: rawUrl,
      params: params,
      issues: issues,
      highlights: highlights
    };
  });

  // Calculate consensus values across the email
  const getConsensus = (paramKey) => {
    const counts = {};
    parsedItems.forEach((item) => {
      if (item.params && item.params[paramKey]) {
        counts[item.params[paramKey]] = (counts[item.params[paramKey]] || 0) + 1;
      }
    });
    let consensus = "";
    let max = 0;
    for (const val in counts) {
      if (counts[val] > max) {
        max = counts[val];
        consensus = val;
      }
    }
    return consensus;
  };

  const consensusUTMs = {
    utm_id: getConsensus("utm_id") || "cstudies",
    utm_source: getConsensus("utm_source") || "campaigner",
    utm_medium: getConsensus("utm_medium") || "email",
    utm_campaign: getConsensus("utm_campaign"),
    utm_content: getConsensus("utm_content")
  };

  const consistencyReport = {
    utm_id: new Set(),
    utm_source: new Set(),
    utm_medium: new Set(),
    utm_campaign: new Set(),
    utm_content: new Set()
  };

  const mismatchTracker = {
    utm_id: [],
    utm_source: [],
    utm_medium: [],
    utm_campaign: [],
    utm_content: []
  };

  parsedItems.forEach((item) => {
    if (item.params) {
      ["utm_id", "utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach((key) => {
        const val = item.params[key];
        const displayVal = val && val.trim() !== "" ? val : "(missing)";
        consistencyReport[key].add(displayVal);

        if (consensusUTMs[key] && val !== consensusUTMs[key]) {
          item.issues.push(
            `Inconsistency: ${key} is "${displayVal}" (Expected: "${consensusUTMs[key]}")`
          );
          mismatchTracker[key].push(`Link #${item.index}`);

          if (val) {
            item.highlights.push(val);
          }
        }
      });
    }
    item.pass = item.issues.length === 0;
  });

  const discrepancies = [];
  ["utm_id", "utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach((key) => {
    if (consistencyReport[key].size > 1) {
      const affectedLinks = mismatchTracker[key].join(", ");
      discrepancies.push(
        `Inconsistency: <strong>${key}</strong> mismatch on <strong>${affectedLinks}</strong>`
      );
    }
  });

  return {
    items: parsedItems,
    summaryParams: {
      utm_id: [...consistencyReport.utm_id],
      utm_source: [...consistencyReport.utm_source],
      utm_medium: [...consistencyReport.utm_medium],
      utm_campaign: [...consistencyReport.utm_campaign],
      utm_content: [...consistencyReport.utm_content]
    },
    discrepancies: discrepancies
  };
}

// Renders the audit output inside the popup
function renderReport(data) {
  const container = document.getElementById("content");

  const passCount = data.items.filter((r) => r.pass).length;
  const failCount = data.items.length - passCount;

  const formatVal = (vals) => {
    if (!vals || vals.length === 0) return '<span style="color:#94a3b8;">(not set)</span>';
    if (vals.length === 1) return `<strong>${vals[0]}</strong>`;
    return `<span style="color:#b91c1c; font-weight:700;">${vals.join(" <em>vs</em> ")}</span>`;
  };

  const isUniform = data.discrepancies.length === 0;

  function formatHighlightedUrl(rawUrl, highlights) {
    let output = rawUrl;
    if (!highlights || highlights.length === 0) return output;

    const unique = [...new Set(highlights)].filter(Boolean);

    unique.forEach((errStr) => {
      const literalSafe = errStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(
        new RegExp(literalSafe, "g"),
        `<span class="error-highlight">${errStr}</span>`
      );

      if (errStr.includes(" ")) {
        const plusVariant = errStr.replace(/ /g, "+");
        const plusSafe = plusVariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(
          new RegExp(plusSafe, "g"),
          `<span class="error-highlight">${plusVariant}</span>`
        );

        const percentVariant = encodeURIComponent(errStr);
        const percentSafe = percentVariant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(
          new RegExp(percentSafe, "g"),
          `<span class="error-highlight">${percentVariant}</span>`
        );
      }
    });

    return output;
  }

  // Detect if all required tracking parameters are absent across all links
  const allMissing = ["utm_id", "utm_source", "utm_medium", "utm_campaign", "utm_content"].every(
    (k) => !data.summaryParams[k] || data.summaryParams[k].length === 0 || data.summaryParams[k].every((v) => v === "(missing)")
  );

  // Status indicator text and color
  let configStatusHtml = "";
  if (allMissing) {
    configStatusHtml = '<span style="color:#c0001a; font-weight:700;">✕ Missing UTM parameters</span>';
  } else if (isUniform) {
    configStatusHtml = '<span style="color:#0d8035; font-weight:600;">● Uniform Across Links</span>';
  } else {
    configStatusHtml = '<span style="color:#b91c1c; font-weight:600;">▲ Mismatches Detected</span>';
  }

  // Top Summary Card
  const summaryHtml = `
    <div class="scoreboard">
      <div class="score-card pass">
        <div class="score-number">${passCount}</div>
        <div class="score-label">Passed Links</div>
      </div>
      <div class="score-card fail">
        <div class="score-number">${failCount}</div>
        <div class="score-label">Failed Links</div>
      </div>
    </div>

    <div class="summary-card ${allMissing || !isUniform ? 'alert-state' : ''}">
      <div class="summary-title">
        <span>Campaign UTM Configuration</span>
        ${configStatusHtml}
      </div>
      <ul class="utm-list">
        <li><span class="utm-key">utm_id:</span><span class="utm-val">${formatVal(data.summaryParams.utm_id)}</span></li>
        <li><span class="utm-key">utm_source:</span><span class="utm-val">${formatVal(data.summaryParams.utm_source)}</span></li>
        <li><span class="utm-key">utm_medium:</span><span class="utm-val">${formatVal(data.summaryParams.utm_medium)}</span></li>
        <li><span class="utm-key">utm_campaign:</span><span class="utm-val">${formatVal(data.summaryParams.utm_campaign)}</span></li>
        <li><span class="utm-key">utm_content:</span><span class="utm-val">${formatVal(data.summaryParams.utm_content)}</span></li>
      </ul>
      ${
        !isUniform
          ? `<div class="mismatch-alert">${data.discrepancies.join('<br/>')}</div>`
          : ''
      }
    </div>
    <div class="section-divider">Audited Links (${data.items.length})</div>
  `;

  // Itemized Cards with link names, highlighted URLs, and affiliate badges
  const cardsHtml = data.items
    .map((r) => {
      const issuesList = r.issues.map((i) => `<li>${i}</li>`).join("");
      const displayUrl = formatHighlightedUrl(r.url, r.highlights);

      // Explicit visual badge for Eventbrite affiliate verification
      let affBadgeHtml = "";
      if (r.url.toLowerCase().includes("eventbrite")) {
        const hasAff = r.params && r.params.aff === "campaigner";
        if (hasAff) {
          affBadgeHtml = '<span class="aff-badge pass" title="Eventbrite affiliate tracking confirmed">aff=campaigner ✓</span>';
        } else {
          const currentAff = r.params && r.params.aff ? `aff=${r.params.aff}` : "aff missing";
          affBadgeHtml = `<span class="aff-badge fail" title="Missing or invalid Eventbrite affiliate parameter">${currentAff} ✕</span>`;
        }
      }

      return `
        <div class="card">
          <div class="card-header">
            <span class="link-name" title="Link #${r.index}: ${r.name}">
              <strong style="color: #64748b; margin-right: 4px;">#${r.index}</strong> ${r.name}
              ${affBadgeHtml}
            </span>
            <span class="${r.pass ? "status-pass" : "status-fail"}">
              ${r.pass ? "PASS" : "FAIL"}
            </span>
          </div>
          <div class="url-text">${displayUrl}</div>
          ${
            r.pass
              ? '<div style="color:#0d8035; font-size:11px; margin-top:4px;">✓ Tracking validated</div>'
              : `<div class="issues"><ul>${issuesList}</ul></div>`
          }
        </div>
      `;
    })
    .join("");

  container.innerHTML = summaryHtml + cardsHtml;

  if (data.items.length > 0 && failCount === 0 && isUniform) {
    showValidationSplash();
  }
}

function showValidationSplash() {
  const splash = document.getElementById("success-splash");
  if (!splash) return;

  splash.style.display = "flex";
  splash.style.opacity = "1";

  setTimeout(() => {
    splash.style.opacity = "0";
    setTimeout(() => {
      splash.style.display = "none";
    }, 400); // Matches CSS transition duration
  }, 1500);
}