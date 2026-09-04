// "page size & presets" panel cleanup. Real report: a user found the panel confusing, calling
// out "double buttons for a4, square" - most of the preset buttons showed only a short label
// with no dimensions (e.g. "square post", "square", "landscape"), so genuinely different presets
// that happened to share a word looked interchangeable at a glance. Worse, Facebook's own
// "square" button (1080x1080) was a pixel-for-pixel exact duplicate of Instagram's "square post"
// (also 1080x1080) - two buttons, one real output. Every preset button now shows its actual
// pixel dimensions inline, and the true duplicate was removed outright rather than relabeled.
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

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

// Real report: opening "page size & presets", picking a preset, then tapping "add new page"
// stopped working entirely - "you can't select anything." Root cause: two separate "start calm,
// collapse every panel" scripts (flashmop-collapsed-start-final, flashmop-pattern-tray-open-
// default) each re-sweep every .box on their own staggered setTimeout schedule (up to 560ms after
// load), to catch panels that don't exist yet at page-load - but neither one could tell "the user
// already opened this on purpose" from "this one just hasn't been swept yet", so a panel opened
// within that first half-second (a real possibility on a slower load, or just a fast/impatient
// tap) could get yanked shut again moments later, mid-interaction, leaving whatever the user
// tapped next landing on a hidden button. Fixed by marking a panel the instant a real person
// toggles it (see the ppUserToggled dataset flag in ppages-v182q-all-panels-tap-only-js's
// toggle(), the actual live accordion toggle - an older duplicate in setupCollapsiblePanels is
// now dead code, superseded by that same v182q script's own capture-phase interception), so both
// sweep scripts leave an already-user-touched panel alone.
test('toggling a panel marks it as user-touched, so the "start calm" sweeps can tell it apart from one they just haven\'t reached yet', async ({ page }) => {
  // Racing real setTimeout-based sweep scripts from inside a test is inherently timing-dependent
  // (the test harness's own overhead can easily land a click after every sweep has already fired
  // once, which proves nothing either way) - assert the actual, deterministic mechanism the fix
  // relies on instead: a real toggle marks the box immediately, every time.
  const box = page.locator('.box').filter({ has: page.locator('h2', { hasText: 'page size & presets' }) }).first();
  const h2 = box.locator('h2');

  await h2.click();
  await expect.poll(() => box.evaluate((el) => el.dataset.ppUserToggled)).toBe('1');

  // Toggling again keeps the marker - it should never get cleared once set.
  const wasCollapsed = await box.evaluate((el) => el.classList.contains('collapsed'));
  await h2.click();
  const nowCollapsed = await box.evaluate((el) => el.classList.contains('collapsed'));
  expect(nowCollapsed).toBe(!wasCollapsed);
  expect(await box.evaluate((el) => el.dataset.ppUserToggled)).toBe('1');
});

// Real report: opening "page size & presets", picking a preset, then tapping "add new page"
// stopped working entirely - "you can't select anything." The end-to-end flow itself (independent
// of the race above) should always work regardless of timing.
test('picking a preset and adding a new page works end to end', async ({ page }) => {
  const presetBtn = page.locator('button:text-is("pin 1000×1500")');
  const addBtn = page.locator('button:has-text("add new page")').first();
  await clickResilient(page, presetBtn);
  const pagesBefore = await page.evaluate(() => state.pages.length);
  await clickResilient(page, addBtn);

  const pagesAfter = await page.evaluate(() => state.pages.length);
  const newPage = await page.evaluate(() => {
    const p = state.pages[state.pages.length - 1];
    return { w: p.w, h: p.h };
  });
  expect(pagesAfter).toBe(pagesBefore + 1);
  expect(newPage).toEqual({ w: 1000, h: 1500 });
});
