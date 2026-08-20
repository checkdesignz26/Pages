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
