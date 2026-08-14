// Shared test fixture for Pattern Pages.
//
// Every test gets a `page` that has already navigated to index.html and waited for the
// app's core globals to exist. Any uncaught page error automatically fails the test at
// teardown - this mirrors the "zero pageerrors" bar every change in this codebase has been
// held to throughout its cleanup/bugfix history.
const base = require('@playwright/test');
const { expect } = base;

const test = base.test.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e));

    // The Quick Start Guide auto-shows once, ~900ms after load, for any browser that's never
    // seen it (tracked via localStorage) - exactly like a real first-time visitor. Every test
    // gets a fresh browser context with no localStorage, so without this every single test
    // would hit that first-time case and get a full-screen modal blocking everything moments
    // into the test. Mark it "seen" right away, like a returning visitor's browser, which is
    // what nearly every test here already implicitly assumes. Uses addInitScript (runs before
    // any of the page's own scripts, on every navigation) rather than a post-load
    // page.evaluate() - a plain evaluate() after waitForFunction below can itself land after
    // the guide's own 900ms timer if the app's boot happens to be slow, which does not reliably
    // win the race. Tests that specifically want the genuine first-time-visitor path (the
    // Quick Start Guide's own spec file) open their own separate context instead of fighting
    // this.
    await page.addInitScript(() => { try { localStorage.setItem('ppQuickStartSeen', '1'); } catch (e) {} });

    await page.goto('/index.html');
    // `state` is declared with `let` at the top level of the app's inline scripts, so it
    // never becomes a `window.state` property (unlike `function`/`var` declarations, which
    // do) - reference it bare here, not as window.state.
    await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');

    await use(page);

    expect(errors.map((e) => e.message), 'no uncaught page errors during the test').toEqual([]);
  },
});

// The app's UI panels are built from collapsible ".box" accordions, and several independent
// boot()/setTimeout cycles scattered across the codebase re-render or re-initialize parts of
// that DOM a few hundred ms to ~1.6s after load (this was a recurring theme found while
// tracing "dead" code this session: patch scripts installing themselves on a timer). That
// makes a single one-shot "expand the box" call racy - the box can get rebuilt or re-collapsed
// out from under a test. expandAllBoxes() is cheap and idempotent, so call it again right
// before the interaction that needs the box open, not just once at the top of a test.
async function expandAllBoxes(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.box.collapsed').forEach((b) => b.classList.remove('collapsed'));
  });
}

// Retries expand -> scroll -> click a few times, self-healing against the transient
// re-renders described above instead of failing on the first bad-timing hit.
async function clickResilient(page, locator, { retries = 5, delayMs = 200 } = {}) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    await expandAllBoxes(page);
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
      await locator.click({ timeout: 2000 });
      return;
    } catch (e) {
      lastError = e;
      await page.waitForTimeout(delayMs);
    }
  }
  throw lastError;
}

module.exports = { test, expect, expandAllBoxes, clickResilient };
