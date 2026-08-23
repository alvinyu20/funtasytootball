/*
  Nav drawer — hamburger toggle for the site-wide navigation. Kept as
  its own small, dependency-free file (rather than folded into
  animations.js) since every page needs it regardless of whether that
  page has any of the scroll/hover/dropdown animation features.
*/

function initNavDrawer() {
  const toggle = document.querySelector(".nav-toggle");
  const drawer = document.getElementById("nav-drawer");
  const backdrop = document.querySelector(".nav-backdrop");
  if (!toggle || !drawer) return;

  function closeDrawer() {
    drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function openDrawer() {
    drawer.classList.add("open");
    if (backdrop) backdrop.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  }

  toggle.addEventListener("click", () => {
    if (drawer.classList.contains("open")) closeDrawer();
    else openDrawer();
  });

  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  // Closing on link click matters even for a normal full-page
  // navigation (the drawer would otherwise still show "open" for an
  // instant during the page transition), and matters even more for
  // pages like season.html/draft.html where switching seasons via the
  // URL hash doesn't reload the page at all.
  drawer.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", closeDrawer);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

document.addEventListener("DOMContentLoaded", initNavDrawer);
