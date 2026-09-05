import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const deployedApp = readFileSync(new URL("../app.graph-lock-20260905-v1.js", import.meta.url), "utf8");
const deployedCss = readFileSync(new URL("../styles.graph-lock-20260905-v1.css", import.meta.url), "utf8");

test("a selected celebration always reaches a visible active state", () => {
  assert.match(app, /const celebrationEnabled = dom\.celebrationEnabled\?\.checked \?\? true/);
  assert.match(app, /dom\.solutionCelebration\.dataset\.state = "active"/);
  assert.doesNotMatch(app, /!dom\.celebrationEnabled\.checked \|\| prefersReducedMotion/);
});

test("reduced motion uses a static celebration rather than hiding it", () => {
  assert.match(app, /applyStaticSolutionCelebration\(\)/);
  assert.match(css, /data-motion="reduced"/);
  assert.doesNotMatch(css, /prefers-reduced-motion:[^}]+display:\s*none/is);
});

test("deployment uses path-level cache-busted assets", () => {
  assert.match(html, /app\.graph-lock-20260905-v1\.js/);
  assert.match(html, /styles\.graph-lock-20260905-v1\.css/);
  assert.match(html, /aria-pressed="false"[\s\S]*?aria-controls="plot"[\s\S]*?>\s*Lock graph view\s*<\/button>/);
  assert.equal(deployedApp, app);
  assert.equal(deployedCss, css);
});

test("the celebration avoids an excessive DOM storm", () => {
  assert.match(app, /CONFETTI_PIECES_PER_SIDE = 90/);
  assert.match(app, /CONFETTI_PIECES_PER_SIDE_MOBILE = 45/);
  assert.doesNotMatch(app, /CONFETTI_PIECES_PER_SIDE = 420/);
});
