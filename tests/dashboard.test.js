const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "dashboard.js"]);
}

test("pickHeroStory: returns null with no week (preseason, nothing to say yet)", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({ streaks: [], prRows: [], topScore: null, week: null, playoffTeams: 6 });
  assert.strictEqual(story, null);
});

test("pickHeroStory: a clinched team is the top-priority story, even with a hot streak also in play", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({
    streaks: [{ teamName: "hottest", result: "W", length: 8 }],
    prRows: [
      { teamName: "yulovesyou", playoffPct: 100 },
      { teamName: "someone-else", playoffPct: 40 },
    ],
    topScore: { name: "someone-else", pts: 150 },
    week: 12,
    playoffTeams: 6,
  });
  assert.ok(story);
  assert.match(story.headline, /yulovesyou clinches a playoff spot/);
  assert.match(story.eyebrow, /Week 12/);
});

test("pickHeroStory: an eliminated team is the story when nobody has clinched yet", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({
    streaks: [],
    prRows: [
      { teamName: "jerbear3", playoffPct: 0 },
      { teamName: "someone-else", playoffPct: 40 },
    ],
    topScore: null,
    week: 9,
    playoffTeams: 6,
  });
  assert.ok(story);
  assert.match(story.headline, /jerbear3 has been eliminated/);
});

test("pickHeroStory: a 4+ game win streak is the story when no clinch/elimination has happened", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({
    streaks: [
      { teamName: "coldteam", result: "L", length: 2 },
      { teamName: "hotteam", result: "W", length: 5 },
    ],
    prRows: [{ teamName: "someone", playoffPct: 55 }],
    topScore: { name: "someone", pts: 130 },
    week: 6,
    playoffTeams: 6,
  });
  assert.ok(story);
  assert.match(story.headline, /hotteam is riding a 5-game win streak/);
});

test("pickHeroStory: a 4+ game losing streak is the story when there's no qualifying win streak", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({
    streaks: [{ teamName: "coldteam", result: "L", length: 4 }],
    prRows: [],
    topScore: { name: "someone", pts: 100 },
    week: 6,
    playoffTeams: 6,
  });
  assert.ok(story);
  assert.match(story.headline, /coldteam has dropped 4 straight/);
});

test("pickHeroStory: a streak below the 4-game threshold doesn't qualify — falls through to the top-score fallback", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({
    streaks: [{ teamName: "mildteam", result: "W", length: 3 }],
    prRows: [],
    topScore: { name: "scorer", pts: 142.6 },
    week: 4,
    playoffTeams: 6,
  });
  assert.ok(story);
  assert.match(story.headline, /scorer posted the week's high score/);
  assert.match(story.sub, /142\.6 points/);
});

test("pickHeroStory: returns null when nothing at all qualifies, rather than forcing a weak story", () => {
  const ctx = setup();
  const story = ctx.pickHeroStory({ streaks: [], prRows: [], topScore: null, week: 1, playoffTeams: 6 });
  assert.strictEqual(story, null);
});

test("renderHeroThesis: clearing with a null story empties the container instead of leaving stale content", () => {
  const ctx = setup();
  ctx.renderHeroThesis({ eyebrow: "Week 3", headline: "Test headline", sub: "Test sub" });
  assert.ok(ctx.document.getElementById("hero-thesis").innerHTML.includes("Test headline"));
  ctx.renderHeroThesis(null);
  assert.strictEqual(ctx.document.getElementById("hero-thesis").innerHTML, "");
});

test("renderHeroThesis: escapes team names so a name with HTML-special characters can't break the markup", () => {
  const ctx = setup();
  ctx.renderHeroThesis({ eyebrow: "Week 3", headline: "<script>bad</script> clinches", sub: null });
  const html = ctx.document.getElementById("hero-thesis").innerHTML;
  assert.ok(!html.includes("<script>bad</script>"), "raw script tag should not appear unescaped");
  assert.ok(html.includes("&lt;script&gt;"), "should be HTML-escaped");
});
