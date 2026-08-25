// Real beta-tester request: "insert the batch listing set like you did in creative pages" -
// a sibling app (Creative Pages) has a one-tap feature that builds a coordinated 5-page Etsy
// listing set (main shot, detail, lifestyle/mock-up, info card, collection grid), all as
// placeholders ready to fill from the Pattern Tray.
//
// Follow-up beta-tester feedback drove a second pass: the main shot and collection grid pages
// are now built by actually calling window.generateSelectedShowcaseLayout() (the exact function
// the "pattern showcase" panel's own Generate button calls), tagged generatedPatternLayout, so
// the designer can immediately reshape/re-slot them from that panel afterward - not just visually
// similar placeholders. The other 3 pages (detail, lifestyle, info card) still use the simpler
// lkmPlaceholder image-slot primitive the "templates" panel already uses. Also: if the page the
// seller was on when they tapped the button was still completely empty, it's replaced rather
// than left behind as an unwanted 6th page - Etsy asks for 5 photos, so the set reads as 5.
const { test, expect, clickResilient } = require('../support/fixtures');

test('the "create listing set" button in the panel is reachable and works via a real click', async ({ page }) => {
  const btn = page.locator('button', { hasText: 'create listing set' });
  await expect(btn).toHaveAttribute('title', /./);

  await clickResilient(page, btn);
  await page.waitForTimeout(300);
  // Starting from the app's own fresh, still-empty page - that page gets replaced, so the set
  // reads as exactly 5, not 6.
  const after = await page.evaluate(() => state.pages.length);
  expect(after).toBe(5);
});

test('creating a listing set on a fresh (still-empty) page replaces it, ending at exactly 5 pages', async ({ page }) => {
  const before = await page.evaluate(() => state.pages.length);
  expect(before).toBe(1); // the app's own untouched starting page

  await page.evaluate(() => window.createEtsyListingSet());
  const after = await page.evaluate(() => state.pages.length);
  expect(after).toBe(5);
});

test('creating a listing set while on a page with real content appends the 5 new pages instead of replacing it', async ({ page }) => {
  await page.evaluate(() => { addText('existing content'); });
  const before = await page.evaluate(() => state.pages.length);

  await page.evaluate(() => window.createEtsyListingSet());
  const after = await page.evaluate(() => state.pages.length);
  expect(after).toBe(before + 5);
});

test('creating a listing set produces the expected placeholder/text layout across all 5 pages', async ({ page }) => {
  await page.evaluate(() => window.createEtsyListingSet());

  const info = await page.evaluate(() => {
    const pages = state.pages.slice(-5);
    return pages.map((p) => ({
      type: p.type,
      w: p.w,
      h: p.h,
      showcaseSlots: p.layers.filter((l) => l.generatedPatternLayout).map((l) => l.slotShape),
      lkmSlotCount: p.layers.filter((l) => l.lkmPlaceholder).length,
      textCount: p.layers.filter((l) => l.type === 'text').length,
    }));
  });

  // main shot: a real 1-slot "strip" showcase layout, plus a banner placeholder over the middle.
  expect(info[0].showcaseSlots).toEqual(['strip']);
  expect(info[0].lkmSlotCount).toBe(1); // the banner
  // detail: one lkm placeholder + a caption
  expect(info[1]).toMatchObject({ lkmSlotCount: 1, textCount: 1 });
  // lifestyle/mock-up: one lkm placeholder + a caption
  expect(info[2]).toMatchObject({ lkmSlotCount: 1, textCount: 1 });
  // info card: title + 3 detail lines + one accent swatch lkm placeholder
  expect(info[3]).toMatchObject({ lkmSlotCount: 1, textCount: 4 });
  // collection grid: a real 6-slot "rectangle" showcase layout, plus a placeholder title.
  expect(info[4].showcaseSlots).toEqual(Array(6).fill('rectangle'));
  expect(info[4].textCount).toBe(1);

  // All 5 pages share the same Etsy listing page size, so the set reads as one coordinated batch.
  info.forEach((p) => expect(p).toMatchObject({ w: 3000, h: 2250 }));
});

test('the main shot and collection grid showcase layouts are real, tagged pattern-showcase slots the designer can reshape from that panel', async ({ page }) => {
  await page.evaluate(() => window.createEtsyListingSet());
  const flags = await page.evaluate(() => {
    const [mainShot, , , , grid] = state.pages.slice(-5);
    return {
      mainShotStrip: mainShot.layers.find((l) => l.slotShape === 'strip'),
      gridSlot: grid.layers.find((l) => l.slotShape === 'rectangle'),
    };
  });
  // patternSlot + generatedPatternLayout + stackIndex is exactly what rebuild() (the real
  // showcase generator) tags every slot with - confirms these came from the real generator,
  // not a hand-placed lookalike.
  expect(flags.mainShotStrip).toMatchObject({ patternSlot: true, generatedPatternLayout: true });
  expect(flags.mainShotStrip.stackIndex).toBeDefined();
  expect(flags.gridSlot).toMatchObject({ patternSlot: true, generatedPatternLayout: true });
  expect(flags.gridSlot.stackIndex).toBeDefined();
});

test('the new pages become selected (starting from the main shot) and the status hint updates', async ({ page }) => {
  await page.evaluate(() => window.createEtsyListingSet());
  const selectedPage = await page.evaluate(() => state.selectedPage);
  expect(selectedPage).toBe(0); // main shot, first of the 5
  await expect(page.locator('#etsyBatchSetHint')).toContainText('Created a 5-page listing set');
});

test('"fill all with selected pattern" fills the 3 lkm-placeholder pages (detail, lifestyle, info card)', async ({ page }) => {
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

  const filled = await page.evaluate(() => {
    const [, detail, lifestyle, infoCard] = state.pages.slice(-5);
    return [detail, lifestyle, infoCard].every((p) => p.layers.filter((l) => l.lkmPlaceholder).every((l) => !!l.src));
  });
  expect(filled).toBe(true);
});

test('"magic fill" (the pattern tray\'s own per-page fill) fills the main shot and collection grid showcase slots', async ({ page }) => {
  await page.evaluate(() => window.createEtsyListingSet());

  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffe66d';
    ctx.fillRect(0, 0, 10, 10);
    state.trays.pattern.push({ src: c.toDataURL('image/png'), name: 'test-pattern' });
    state.selectedTray = state.selectedTray || {};
    state.selectedTray.pattern = state.trays.pattern.length - 1;
  });

  await page.evaluate(() => { state.selectedPage = 0; render(); }); // main shot
  await page.waitForTimeout(150);
  await page.evaluate(() => window.magicFillEmptySlots());
  await page.waitForTimeout(150);

  await page.evaluate(() => { state.selectedPage = 4; render(); }); // collection grid
  await page.waitForTimeout(150);
  await page.evaluate(() => window.magicFillEmptySlots());
  await page.waitForTimeout(150);

  const filled = await page.evaluate(() => {
    const [mainShot, , , , grid] = state.pages.slice(-5);
    return {
      mainShot: mainShot.layers.filter((l) => l.generatedPatternLayout).every((l) => !!l.src),
      grid: grid.layers.filter((l) => l.generatedPatternLayout).every((l) => !!l.src),
    };
  });
  expect(filled.mainShot).toBe(true);
  expect(filled.grid).toBe(true);
});

test('creating a listing set does not throw and is fully undoable', async ({ page }) => {
  const before = await page.evaluate(() => state.pages.length);
  await page.evaluate(() => window.createEtsyListingSet());
  expect(await page.evaluate(() => state.pages.length)).toBe(5);

  // The batch is 3 compound steps under the hood (the initial page setup, plus one save() from
  // each of the two real showcase-generator calls it reuses) - undo() 3 times to fully revert,
  // same as any other multi-step action in this app.
  await page.evaluate(() => { undo(); undo(); undo(); });
  await page.waitForTimeout(100);
  const afterUndo = await page.evaluate(() => state.pages.length);
  expect(afterUndo).toBe(before);
});
