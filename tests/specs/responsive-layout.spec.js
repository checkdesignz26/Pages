// Real report, with a screenshot: on a narrower iPad the right panel (and header toolbar) ran
// off the edge of the screen with no way to scroll back and see the rest. Reproduced at that
// iPad's actual logical viewport (1080x810 landscape, matching a standard 10.2" iPad).
//
// Root cause: several grid containers (.app, header/.studioHeader) used a bare "1fr" track for
// their flexible column instead of "minmax(0,1fr)". A bare 1fr track, without an explicit 0
// minimum, falls back to the max-content (preferred) size of whatever's inside it once nothing
// else forces the container to a definite size - so instead of the flexible column shrinking to
// fit whatever space was left after the fixed-width side panels, the whole layout grew to fit
// its content's natural width, overflowing the actual viewport with nothing to bring the
// clipped-off content (like the right panel) back into view.
const { test, expect } = require('../support/fixtures');

test.use({ viewport: { width: 1080, height: 810 } });

test('the app layout fits within a narrow iPad viewport without horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth);
});

test('the right panel is not clipped off-screen at a narrow iPad viewport', async ({ page }) => {
  const rightPanel = page.locator('.side.right');
  const box = await rightPanel.boundingBox();
  expect(box).not.toBeNull();
  // The whole panel - including its right edge - must sit within the viewport, not run off it.
  expect(box.x + box.width).toBeLessThanOrEqual(1080 + 1);
});

test('the header toolbar is not clipped off-screen at a narrow iPad viewport', async ({ page }) => {
  const header = page.locator('header.studioHeader, header').first();
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x + box.width).toBeLessThanOrEqual(1080 + 1);
});

// Real report, with screenshots: multi-line text on the canvas overlapped/crushed together after
// toggling a side panel. Root cause - every text/label layer's font-size, letter-spacing and
// border-width are absolute pixel values (positions/sizes use %, but text metrics never scale
// with the on-screen canvas box), while several older "focus boost" patches made .stage grow or
// shrink its own on-screen CSS width by up to ~50% depending on which side panels were open -
// harmless for percentage-based geometry, but silent death for fixed-px text once the canvas
// changed size that way. Verifies the canvas keeps the exact same on-screen width no matter which
// combination of side panels is open or collapsed.
test('the canvas keeps the same on-screen size regardless of which side panels are open, so text never rescales out of proportion', async ({ page }) => {
  const stageWidth = () => page.evaluate(() => document.querySelector('.stage').getBoundingClientRect().width);

  const initial = await stageWidth();
  expect(initial).toBeGreaterThan(50);

  await page.evaluate(() => toggleSidePanel('right'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('right'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('left'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('left'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => { toggleSidePanel('left'); toggleSidePanel('right'); });
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);
});
