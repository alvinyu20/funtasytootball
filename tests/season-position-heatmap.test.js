/*
  Points By Starting Slot (mockup page 8, without the league-average row and the notes under the table):
  each cell is a team's average points per week from that slot with the gap to the league's average for
  the slot; the best in a column is solid yellow and the worst solid blue; rows go by total.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "history-data.js", "season-data.js", "season.js"]);
}

function table() {
  return {
    columns: [
      { key: "QB", label: "QB" },
      { key: "K", label: "K" },
    ],
    rows: [
      { teamName: "hmart92", cells: { QB: 12.0, K: 9.0 } },
      { teamName: "yulovesyou", cells: { QB: 25.5, K: 6.0 } },
      { teamName: "paty23", cells: { QB: 18.0, K: null } },
    ],
  };
}

test("renderPositionTable: value and gap to the league average in each cell, rows sorted by total", () => {
  const html = setup().renderPositionTable(table());
  // QB average 18.5: 25.5 is +7.0, 12.0 is -6.5; K average 7.5
  assert.ok(html.includes("<b>25.5</b><small class=\"sn-tone-good\">+7.0</small>"));
  assert.ok(html.includes("<b>12.0</b><small class=\"sn-tone-bad\">-6.5</small>"));
  assert.ok(html.includes("<b>18.0</b><small class=\"sn-tone-flat\">-0.5</small>") === false, "-0.5 is a real gap, shown in the bad color");
  const order = ["yulovesyou", "hmart92", "paty23"].map((n) => html.indexOf(`>${n}</span>`));
  assert.ok(order[0] < order[1] && order[1] < order[2], "31.5, then 21.0, then 18.0");
  assert.ok(html.includes("sn-slot-none"), "a slot a team never used is a dash, not a zero");
});

test("renderPositionTable: the best in a column is solid yellow and the worst solid blue", () => {
  const html = setup().renderPositionTable(table());
  assert.ok(/sn-slot sn-slot-best"><b>25\.5</.test(html));
  assert.ok(/sn-slot sn-slot-worst"><b>12\.0</.test(html));
  assert.ok(/sn-slot sn-slot-best"><b>9\.0</.test(html) && /sn-slot sn-slot-worst"><b>6\.0</.test(html));
});

test("renderPositionTable: no league-average row and no notes under the table; Strongest / Weakest name each team's biggest gaps", () => {
  const html = setup().renderPositionTable(table());
  assert.ok(!/League average/i.test(html));
  assert.ok(!html.includes("<p"), "nothing written under the table");
  assert.ok(html.includes(">QB +7.0<") && html.includes(">K -1.5<"), "yulovesyou: strongest QB, weakest K");
});

test("renderPositionTable: an empty table still shows the informative empty state", () => {
  const html = setup().renderPositionTable({ columns: [], rows: [] });
  assert.ok(html.includes("No lineup data available"));
});
