/*
  "My team": a manager picks their Sleeper username once, and the site
  follows them around — their matchup is pinned first on Home, their row
  is highlighted in every table and list, and their Records in Reach come
  first.

  It's saved in this browser only (localStorage), so there's no login and
  nothing to set up. Every page loads this file: it adds a star button to
  the top bar, opens the picker, and tints whichever rows, cards and lists
  belong to the picked manager. Pages never need to know — they just show
  usernames (or put data-username="..." on a cell that shows a team name)
  and this file finds them, including content a page draws later.

  Pure helpers (get/set/isMine, managerNamesFromData) work without a page,
  so they're unit-tested; the DOM parts are checked in a real browser.
*/
const MyTeam = (function () {
  const STORAGE_KEY = "funtasy.myTeam";
  const CHANGE_EVENT = "myteam:change";

  // The nearest of these around a matched name is what gets the highlight.
  const ROW_SELECTOR = "tr, .pr-phone-item, .hs-item, .sos-row, .road-row, .strip-row, .pr-mini-row, .streak-row, .lr-item, .rank-list-row, .career-card, .mu-side, .lw-side, .draft-list-row, .trophy-card, .cr-row, .tm-card, .tm-pick, .tm-hero, .tm-h2h-row";
  // A game's card lights up whole when either of its sides is the picked team's.
  const CARD_SELECTOR = ".mu-card, .mu-featured, .lw-row";
  // Never decorate the chrome (nav, the picker itself) or the My Team card, which already says who you are.
  // data-no-mine marks a name that is only there as context (the team a champion beat), so it
  // never lights up the card it sits on.
  const SKIP_SELECTOR = ".site-nav, .nav-drawer, .myteam-overlay, .my-team-card, [data-no-mine], script, style, noscript";

  let memory = null; // fallback when the browser blocks localStorage
  let managersPromise = null;
  let button = null;

  function normalize(text) {
    return String(text == null ? "" : text).trim().toLowerCase();
  }

  function get() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v ? v : memory;
    } catch (err) {
      return memory;
    }
  }

  function store(username) {
    memory = username || null;
    try {
      if (username) localStorage.setItem(STORAGE_KEY, username);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // storage blocked (private window, etc.): the in-memory copy still works for this visit
    }
  }

  function isMine(name) {
    const me = normalize(get());
    return !!me && normalize(name) === me;
  }

  function notify() {
    refreshButton();
    decorate(typeof document !== "undefined" ? document.body : null);
    try {
      document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { username: get() } }));
    } catch (err) {
      // no DOM (unit tests)
    }
  }

  function set(username) {
    const clean = String(username == null ? "" : username).trim();
    store(clean || null);
    notify();
  }

  function clear() {
    set(null);
  }

  // ---- the list of managers to pick from -------------------------------
  // Straight from the weekly Power Rankings snapshot (every current manager
  // is in it), or the ROS file if that isn't posted yet. No Sleeper call,
  // so the picker opens instantly on any page.
  function managerNamesFromData(snapshot, strength) {
    const names = [];
    const seen = new Set();
    const add = (n) => {
      const key = normalize(n);
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(String(n).trim());
    };
    ((snapshot && snapshot.rows) || []).forEach((r) => add(r.username || r.teamName));
    if (!names.length) Object.keys((strength && strength.teams) || {}).forEach(add);
    return names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  function loadManagers() {
    if (!managersPromise) {
      managersPromise = Promise.all([
        fetchJsonSafe(POWER_RANKINGS_SNAPSHOT_FILE, null),
        fetchJsonSafe(TEAM_STRENGTH_FILE, { teams: {} }),
      ]).then(([snapshot, strength]) => managerNamesFromData(snapshot, strength));
    }
    return managersPromise;
  }

  // ---- the highlight ------------------------------------------------------
  function markRowFor(el) {
    if (!el || !el.closest || el.closest(SKIP_SELECTOR)) return;
    const headCell = el.closest("thead th");
    if (headCell) {
      // A name used as a column header: tint the name, not the whole header row.
      headCell.classList.add("mine-name");
      return;
    }
    const row = el.closest(ROW_SELECTOR);
    if (!row) {
      el.classList.add("mine-name");
      return;
    }
    row.classList.add("mine");
    const card = row.closest(CARD_SELECTOR);
    if (card) card.classList.add("mine");
  }

  function decorate(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(".mine, .mine-name").forEach((el) => el.classList.remove("mine", "mine-name"));
    const me = normalize(get());
    if (!me) return;

    root.querySelectorAll("[data-username]").forEach((el) => {
      if (normalize(el.getAttribute("data-username")) === me) markRowFor(el);
    });

    if (typeof document === "undefined" || !document.createTreeWalker) return;
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || text.length > 80) continue;
      if (normalize(text) === me) markRowFor(node.parentElement);
    }
  }

  function startObserver() {
    if (typeof MutationObserver === "undefined" || !document.body) return;
    let queued = false;
    new MutationObserver(() => {
      if (queued || !get()) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        decorate(document.body);
      }, 120);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // ---- the star button in the top bar ---------------------------------------
  const STAR_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8z"/></svg>';

  function refreshButton() {
    if (!button) return;
    const me = get();
    button.classList.toggle("is-set", !!me);
    button.setAttribute("aria-label", me ? `Your team: ${me}. Change it.` : "Pick your team");
    button.title = me ? `Your team: ${me}` : "Pick your team";
    button.innerHTML = STAR_SVG + (me ? `<span class="myteam-name">${escapeHtml(me)}</span>` : "");
  }

  function mountButton() {
    const nav = document.querySelector(".site-nav");
    if (!nav || nav.querySelector(".myteam-btn")) return;
    button = document.createElement("button");
    button.type = "button";
    button.className = "myteam-btn";
    button.addEventListener("click", openPicker);
    const toggle = nav.querySelector(".nav-toggle");
    nav.insertBefore(button, toggle || null);
    refreshButton();
  }

  // ---- the picker ----------------------------------------------------------------
  function closePicker() {
    const overlay = document.querySelector(".myteam-overlay");
    if (overlay) overlay.remove();
    document.removeEventListener("keydown", onKeydown);
    if (button) button.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") closePicker();
  }

  function pickerBodyHtml(names) {
    const me = normalize(get());
    if (!names.length) {
      return `
        <p>Type your Sleeper username exactly as it shows in the league.</p>
        <div class="myteam-grid" style="grid-template-columns:1fr auto;">
          <input class="myteam-opt" id="myteam-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="username" />
          <button class="myteam-opt" type="button" data-save>Save</button>
        </div>`;
    }
    return `
      <p>Pick your Sleeper username once. Your matchup is pinned first, your row is highlighted in every table, and your Records in Reach come first.</p>
      <div class="myteam-grid">
        ${names
          .map((n) => `<button class="myteam-opt${normalize(n) === me ? " selected" : ""}" type="button" data-pick="${escapeHtml(n)}">${escapeHtml(n)}</button>`)
          .join("")}
      </div>`;
  }

  async function openPicker() {
    if (document.querySelector(".myteam-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "myteam-overlay";
    overlay.innerHTML = `
      <div class="myteam-modal" role="dialog" aria-modal="true" aria-labelledby="myteam-title">
        <h2 id="myteam-title">Who are you?</h2>
        <div id="myteam-body"><p>Loading managers…</p></div>
        <div class="myteam-actions">
          <button type="button" data-clear>Clear</button>
          <button type="button" data-close>Done</button>
        </div>
        <p class="myteam-note">Saved on this device only — no login.</p>
      </div>`;
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) return closePicker();
      const pick = e.target.closest("[data-pick]");
      if (pick) {
        set(pick.getAttribute("data-pick"));
        return closePicker();
      }
      if (e.target.closest("[data-clear]")) {
        clear();
        return closePicker();
      }
      if (e.target.closest("[data-close]")) return closePicker();
      if (e.target.closest("[data-save]")) {
        const input = overlay.querySelector("#myteam-input");
        if (input && input.value.trim()) {
          set(input.value);
          closePicker();
        }
      }
    });

    const names = await loadManagers().catch(() => []);
    const body = overlay.querySelector("#myteam-body");
    if (!body) return; // closed while loading
    body.innerHTML = pickerBodyHtml(names);
    const focusTarget = body.querySelector(".selected") || body.querySelector("button, input");
    if (focusTarget) focusTarget.focus();
  }

  function init() {
    mountButton();
    decorate(document.body);
    startObserver();
    // Anything on a page can open the picker with data-myteam-open.
    document.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest("[data-myteam-open]")) openPicker();
    });
  }

  if (typeof document !== "undefined" && document.addEventListener && document.querySelector) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  return {
    STORAGE_KEY,
    CHANGE_EVENT,
    get,
    set,
    clear,
    isMine,
    normalize,
    managerNamesFromData,
    decorate,
    open: openPicker,
  };
})();
