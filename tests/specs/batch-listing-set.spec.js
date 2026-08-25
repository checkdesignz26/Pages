// Real beta-tester request: "insert the batch listing set like you did in creative pages" -
// a sibling app (Creative Pages) has a one-tap feature that builds a coordinated 5-page Etsy
// listing set (main shot, detail, lifestyle/mock-up, info card, collection grid), all as
// placeholders ready to fill from the Pattern Tray. Built the equivalent here on top of the
// existing lkmPlaceholder image-slot primitive (the same one "templates" already uses), so the
// normal fill flows (fill selected slot, fill all with selected pattern, magic fill) all work
// on the new pages without any separate fill mechanism.
const { test, expect, clickResilient } = require('../support/fixtures');

test('the "create listing set" button in the panel is reachable and works via a real click', async ({ page }) => {
  const btn = page.locator('button', { hasText: 'create listing set' });
  await expect(btn).toHaveAttribute('title', /./);

  const before = await page.evaluate(() => state.pages.length);
  await clickResilient(page, btn);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => state.pages.length);
  expect(after).toBe(before + 5);
});

test('creating a listing set adds 5 new pages with the expected placeholder/text layout', async ({ page }) => {
  const before = await page.evaluate(() => state.pages.length);
  await page.evaluate(() => window.createEtsyListingSet());
  const after = await page.evaluate(() => state.pages.length);
  expect(after).toBe(before + 5);

  const info = await page.evaluate(() => {
    const pages = state.pages.slice(-5);
    return pages.map((p) => ({
      type: p.type,
      w: p.w,
      h: p.h,
      slotCount: p.layers.filter((l) => l.lkmPlaceholder).length,
      textCount: p.layers.filter((l) => l.type === 'text').length,
    }));
  });

  // main shot: one big placeholder, no text
  expect(info[0]).toMatchObject({ slotCount: 1, textCount: 0 });
  // detail: one placeholder + a caption
  expect(info[1]).toMatchObject({ slotCount: 1, textCount: 1 });
  // lifestyle/mock-up: one placeholder + a caption
  expect(info[2]).toMatchObject({ slotCount: 1, textCount: 1 });
  // info card: title + 3 detail lines + one accent swatch placeholder
  expect(info[3]).toMatchObject({ slotCount: 1, textCount: 4 });
  // collection grid: 6 placeholder swatches, no text
  expect(info[4]).toMatchObject({ slotCount: 6, textCount: 0 });

  // All 5 pages share the same Etsy listing page size, so the set reads as one coordinated batch.
  info.forEach((p) => expect(p).toMatchObject({ w: 3000, h: 2250 }));
});

test('the new pages become selected and the status hint updates after creating a set', async ({ page }) => {
  const before = await page.evaluate(() => state.pages.length);
  await page.evaluate(() => window.createEtsyListingSet());
  const selectedPage = await page.evaluate(() => state.selectedPage);
  expect(selectedPage).toBe(before); // first of the 5 new pages
  await expect(page.locator('#etsyBatchSetHint')).toContainText('Created a 5-page listing set');
});

test('the existing "fill all with selected pattern" flow fills every placeholder across all 5 new pages at once', async ({ page }) => {
  await page.evaluate(() => window.createEtsyListingSet());

  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4ecdc4';
    ctx.fillRect(0, 0, 10, 10);
    state.trays.pattern.push({ src: c.toDataURL('image/png'), name: 'test-pattern' });
    state.selectedTray = state.selectedTray || {};
    state.selectedTray.pattern = state.trays.pattern.length - 1;
  });

  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => window.fillLinkedPlaceholdersFromTray());
  await page.waitForTimeout(200);

  const allFilled = await page.evaluate(() => {
    const pages = state.pages.slice(-5);
    return pages.every((p) => p.layers.filter((l) => l.lkmPlaceholder).every((l) => !!l.src));
  });
  expect(allFilled).toBe(true);
});

test('creating a listing set does not throw and leaves the app in a clean, undoable state', async ({ page }) => {
  const before = await page.evaluate(() => state.pages.length);
  await page.evaluate(() => window.createEtsyListingSet());
  await page.evaluate(() => undo());
  const afterUndo = await page.evaluate(() => state.pages.length);
  expect(afterUndo).toBe(before);
});
