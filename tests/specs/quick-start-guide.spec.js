// Real report: the "? help" button and its Quick Start Guide modal (built in an earlier
// session two days before this one) disappeared entirely from the live app. Root cause turned
// out to be a version-control gap, not a code bug: that earlier work was never committed to this
// branch, so when this branch's later fixes were pushed and redeployed to the same live URL,
// the deploy simply didn't include the guide - it was never part of this branch's history to
// begin with. Recovered from a copy of the file the user had saved locally and merged back in.
//
// The shared test fixture marks the guide "seen" via addInitScript before every test (see
// fixtures.js) so its auto-show-once-for-first-time-visitors behavior doesn't pop a full-screen
// modal in front of the other ~110 unrelated tests in this suite. The "auto-shows" test below
// deliberately opens its own separate browser context instead of using that shared fixture, so
// it gets a genuinely fresh, guide-not-yet-seen browser to test against.
const { test, expect } = require('../support/fixtures');

test('the ? help button opens the Quick Start Guide with all 5 steps', async ({ page }) => {
  const helpBtn = page.locator('.helpBtn');
  await expect(helpBtn).toBeVisible();
  await helpBtn.click();

  const overlay = page.locator('#ppQuickStartOverlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('.qsHeader h2')).toHaveText('Quick Start Guide');
  await expect(page.locator('.qsStep')).toHaveCount(5);
  await expect(page.locator('.qsStepTitle').nth(4)).toHaveText('5. Export');

  await page.locator('.qsClose').click();
  await expect(overlay).toHaveCount(0);
});

test('the Quick Start Guide auto-shows once for a first-time visitor, then stays dismissed', async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/index.html`);
  await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');

  await page.waitForSelector('#ppQuickStartOverlay', { timeout: 2000 });
  await page.locator('.qsClose').click();
  await expect(page.locator('#ppQuickStartOverlay')).toHaveCount(0);

  const seenFlag = await page.evaluate(() => localStorage.getItem('ppQuickStartSeen'));
  expect(seenFlag).toBe('1');

  // A returning visitor (flag already set) should NOT get the auto-popup again.
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');
  await page.waitForTimeout(1200);
  await expect(page.locator('#ppQuickStartOverlay')).toHaveCount(0);

  await context.close();
});

// On iPad (touch, no fine pointer) feedback/help stay exactly as before: fixed pills stacked in
// a screen corner, tuned around a thumb's resting position.
test.describe('iPad (touch): feedback/help stay as fixed corner pills', () => {
  test.use({ hasTouch: true });

  test('the help button sits stacked above the feedback button, not overlapping it', async ({ page }) => {
    const helpBox = await page.locator('.helpBtn').boundingBox();
    const feedbackBox = await page.locator('.feedbackBtn').boundingBox();
    expect(helpBox).not.toBeNull();
    expect(feedbackBox).not.toBeNull();
    // help sits above feedback (smaller y), and their boxes don't vertically overlap.
    expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(feedbackBox.y + 1);
  });
});

// Real report from a beta tester: on a desktop window the fixed feedback/help pills in the
// bottom-right corner interfered with the right-panel's collapse arrow. Moved them into the
// header's toolbar for real mouse users, next to the left-handed-layout control, instead of
// floating over the canvas/panel edge. Only for pointer:fine/hover:hover (a real mouse) - this
// project's default config (Desktop Chrome, no touch emulation) already matches that.
test.describe('desktop mouse: feedback/help move into the top toolbar', () => {
  test('the feedback and help buttons sit in the same toolbar row as the left-handed-layout control, not floating in a screen corner', async ({ page }) => {
    const group = page.locator('.compactTools');
    const handMode = page.locator('#handModeBtn');
    const feedback = page.locator('#feedbackBtn');
    const help = page.locator('#helpBtn');

    await expect(feedback).toBeVisible();
    await expect(help).toBeVisible();

    // Both now live inside the same toolbar group as the left-handed-layout toggle.
    expect(await group.locator('#feedbackBtn').count()).toBe(1);
    expect(await group.locator('#helpBtn').count()).toBe(1);

    const handBox = await handMode.boundingBox();
    const feedbackBox = await feedback.boundingBox();
    const helpBox = await help.boundingBox();
    // Roughly the same row - vertical centres within a few px of each other, not a stacked
    // corner pill sitting far down the page.
    expect(Math.abs((feedbackBox.y + feedbackBox.height / 2) - (handBox.y + handBox.height / 2))).toBeLessThan(20);
    expect(Math.abs((helpBox.y + helpBox.height / 2) - (handBox.y + handBox.height / 2))).toBeLessThan(20);
  });
});

// Real request: a link to the separately-published "Swatch Book" (a searchable reference for
// every button, meant to sit alongside the app - e.g. iPad Split View) so it's reachable from
// inside the app itself, not just something the user has to remember the URL for.
test('a "swatch book" link in the toolbar opens the button reference in a new tab', async ({ page }) => {
  const btn = page.locator('button', { hasText: 'swatch book' });
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('title', /./);
  const onclick = await btn.getAttribute('onclick');
  expect(onclick).toContain("window.open('https://claude.ai/code/artifact/");
  expect(onclick).toContain("'_blank'");
});
