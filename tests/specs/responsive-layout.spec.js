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
