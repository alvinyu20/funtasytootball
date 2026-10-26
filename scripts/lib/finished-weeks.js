/*
  Which weeks of a season are finished, for the build scripts.

  The site's pages and these scripts must agree on what counts as a result,
  so this runs the site's own rule (DeepHistory.completedThroughWeek in
  js/deep-history.js) instead of keeping a second copy of it. A week in
  progress already has partial scores in Sleeper's data; none of the files
  built here may count it until its last game is final.
*/
const { loadSiteModules } = require("./load-site-modules");

let engine = null;
function deepHistory() {
  if (!engine) engine = loadSiteModules(["deep-history.js"]).DeepHistory;
  return engine;
}

// The last finished week of an archived (or freshly fetched) season entry.
// `nflWeek` is Sleeper's week-in-progress at the time the data was saved,
// when known (the backup records it); without it the rosters' win/loss
// records decide.
function finishedThrough(seasonEntry, nflWeek) {
  return deepHistory().completedThroughWeek({
    league: seasonEntry && seasonEntry.league,
    rosters: seasonEntry && seasonEntry.rosters,
    nflWeek: nflWeek == null ? null : nflWeek,
  });
}

// weeks: [{ week, ... }] -> only the finished ones.
function finishedWeeksOf(seasonEntry, weeks, nflWeek) {
  const through = finishedThrough(seasonEntry, nflWeek);
  return (weeks || []).filter((w) => Number(w.week) <= through);
}

module.exports = { finishedThrough, finishedWeeksOf };
