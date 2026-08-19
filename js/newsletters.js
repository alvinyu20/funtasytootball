let ALL_ISSUES = [];

async function renderNewsletters() {
  document.title = (SITE_TITLE ? SITE_TITLE + " — " : "") + "Newsletters";

  ALL_ISSUES = await fetchJsonSafe(NEWSLETTERS_FILE, []);
  ALL_ISSUES.sort((a, b) => new Date(b.date) - new Date(a.date));

  renderFromHash();
  window.addEventListener("hashchange", renderFromHash);
}

function renderFromHash() {
  const slug = decodeURIComponent(location.hash.replace(/^#/, ""));
  const listView = document.getElementById("newsletter-list-view");
  const detailView = document.getElementById("newsletter-detail-view");

  const issue = slug ? ALL_ISSUES.find((i) => i.slug === slug) : null;

  if (issue) {
    listView.style.display = "none";
    detailView.style.display = "";
    detailView.innerHTML = `
      <a class="back-link" href="#">&larr; All issues</a>
      <div class="newsletter-body" style="margin-top:16px;">
        <p class="scoreboard-eyebrow">${escapeHtml(issue.issue)} · ${formatDate(issue.date)}</p>
        <h1>${escapeHtml(issue.title)}</h1>
        <div class="content">${escapeHtml(issue.content)}</div>
      </div>`;
  } else {
    detailView.style.display = "none";
    listView.style.display = "";
    listView.innerHTML = ALL_ISSUES.length
      ? ALL_ISSUES.map(
          (i) => `
        <a class="newsletter-card" href="#${encodeURIComponent(i.slug)}">
          <div class="issue">${escapeHtml(i.issue)} · ${formatDate(i.date)}</div>
          <h3>${escapeHtml(i.title)}</h3>
          <p>${escapeHtml(i.summary || "")}</p>
        </a>`
        ).join("")
      : `<div class="empty-state">No issues yet. Ask me to draft one after this week's games.</div>`;
  }
}

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

document.addEventListener("DOMContentLoaded", renderNewsletters);
