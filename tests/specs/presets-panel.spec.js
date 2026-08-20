// "page size & presets" panel cleanup. Real report: a user found the panel confusing, calling
// out "double buttons for a4, square" - most of the preset buttons showed only a short label
// with no dimensions (e.g. "square post", "square", "landscape"), so genuinely different presets
// that happened to share a word looked interchangeable at a glance. Worse, Facebook's own
// "square" button (1080x1080) was a pixel-for-pixel exact duplicate of Instagram's "square post"
// (also 1080x1080) - two buttons, one real output. Every preset button now shows its actual
// pixel dimensions inline, and the true duplicate was removed outright rather than relabeled.
const { test, expect, expandAllBoxes } = require('../support/fixtures');

test('every quick-size preset button shows its own dimensions, not just a short reused label', async ({ page }) => {
  await expandAllBoxes(page);
  const labels = await page.locator('.sizePresetSections button').allTextContents();
  expect(labels.length).toBeGreaterThan(5);
  labels.forEach((label) => {
    if (/custom/i.test(label)) return; // "custom" has no fixed size to show
    // Most show the full "W×H"; a square-shaped preset like "3600 square" only needs the one
    // number, since a square's two dimensions are always equal - either form disambiguates it
    // from every other button, which is the actual goal here.
    expect(label).toMatch(/\d{3,4}/);
  });
});

test('the Facebook "square" preset (an exact duplicate of Instagram\'s square post, both 1080x1080) is gone, not just relabeled', async ({ page }) => {
  await expandAllBoxes(page);
  const facebookGroup = page.locator('.presetMiniGroup', { has: page.locator('span', { hasText: 'facebook' }) });
  const facebookButtons = await facebookGroup.locator('button').allTextContents();
  expect(facebookButtons.some((t) => /1080.{1,3}1080/.test(t))).toBe(false);

  // Instagram's square post - the one surviving 1080x1080 preset - still works normally.
  await page.evaluate(() => window.chooseQuickSize('Instagram square post', 1080, 1080));
  const size = await page.evaluate(() => [document.getElementById('customW').value, document.getElementById('customH').value]);
  expect(size).toEqual(['1080', '1080']);
});

// Real report, with a screenshot: the chosenSizePill sat directly above the #sizePreset <select>,
// showing the same "current preset · WxH" text a second time right underneath it - looked like
// two stacked Etsy listing presets even though nothing was actually duplicated data-wise. The
// select already shows the same info and is the interactive one, so the pill was removed
// outright rather than relabeled.
test('the size panel does not show the current preset twice (no redundant pill above the select)', async ({ page }) => {
  await expect(page.locator('#chosenSizePill')).toHaveCount(0);
  const select = page.locator('#sizePreset');
  // Boxes here get rebuilt/re-collapsed by scattered boot()/setTimeout cycles a while after
  // load (see fixtures.js's expandAllBoxes note) - re-expand right before checking visibility,
  // not just once up front, and retry until it survives that race.
  await expect.poll(async () => {
    await expandAllBoxes(page);
    return select.isVisible();
  }, { timeout: 5000 }).toBe(true);
  await expect(select).toHaveValue('3000,2250'); // still reflects the real current choice
});

// Real report: "clear current page" (formerly "blank page") lived at the bottom of "extra design
// elements", an unrelated add-things panel, making a page-management action hard to find. Moved
// next to its comparably destructive sibling "delete current page" in the "pages" panel instead.
test('clear current page lives in the pages panel next to delete current page, not in extra design elements', async ({ page }) => {
  await expandAllBoxes(page);
  const pagesBox = page.locator('.box').filter({ has: page.locator('h2', { hasText: 'pages' }) }).first();
  await expect(pagesBox.locator('button:has-text("clear current page")')).toHaveCount(1);
  await expect(pagesBox.locator('button:has-text("delete current page")')).toHaveCount(1);

  const extraBox = page.locator('.box').filter({ has: page.locator('h2', { hasText: 'extra design elements' }) }).first();
  await expect(extraBox.locator('button:has-text("clear current page")')).toHaveCount(0);
});
