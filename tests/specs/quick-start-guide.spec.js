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

test('the help button sits stacked above the feedback button, not overlapping it', async ({ page }) => {
  const helpBox = await page.locator('.helpBtn').boundingBox();
  const feedbackBox = await page.locator('.feedbackBtn').boundingBox();
  expect(helpBox).not.toBeNull();
  expect(feedbackBox).not.toBeNull();
  // help sits above feedback (smaller y), and their boxes don't vertically overlap.
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(feedbackBox.y + 1);
});
