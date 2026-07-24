// Pattern Showcase generation: all layout shapes produce the right slotShape/direction, the
// showcase-group highlight in the layer panel stays in sync via a MutationObserver (not a
// renderLayers wrap, which gets silently discarded - Phase 0, 25/N), and generating/
// regenerating a showcase never renders it above pre-existing decoration layers regardless of
// add order (the banner-behind-showcase bug reported and fixed after the Phase 0 cleanup).
const { test, expect } = require('../support/fixtures');

test('setCards produces the right slotShape and direction for every layout type', async ({ page }) => {
  const results = await page.evaluate(() => {
    function shapesFor(n, style) {
      window.setCards(n, style);
      const p = state.pages[state.selectedPage];
      return p.layers.filter((l) => l.generatedPatternLayout).map((l) => l.slotShape);
    }
    const out = {};
    out.rectangles = shapesFor(5, 'rectangles');
    out.squares = shapesFor(4, 'squares');
    out.circles = shapesFor(3, 'circles');
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    out.stripsVertical = shapesFor(4, 'strips');
    out.stripsVerticalDirections = state.pages[state.selectedPage].layers.filter((l) => l.generatedPatternLayout).map((l) => l.stripDirection);
    window.stripDirection = 'horizontal';
    out.stripsHorizontal = shapesFor(3, 'strips');
    out.stripsHorizontalDirections = state.pages[state.selectedPage].layers.filter((l) => l.generatedPatternLayout).map((l) => l.stripDirection);
    return out;
  });

  expect(results.rectangles).toEqual(Array(5).fill('rectangle'));
  expect(results.squares).toEqual(Array(4).fill('square'));
  expect(results.circles).toEqual(Array(3).fill('circle'));
  expect(results.stripsVertical).toEqual(Array(4).fill('strip'));
  expect(results.stripsVerticalDirections).toEqual(Array(4).fill('vertical'));
  expect(results.stripsHorizontal).toEqual(Array(3).fill('strip'));
  expect(results.stripsHorizontalDirections).toEqual(Array(3).fill('horizontal'));
});

test('the showcase-group row highlights on select/deselect via the layer-list observer', async ({ page }) => {
  await page.waitForTimeout(2000); // past the installRenderLayers boot timers that discard the old wrap

  await page.evaluate(() => {
    save();
    const p = current();
    p.layers.push({ id: 'showcaseTestSlot', type: 'rectangle', name: 'slot', x: 5, y: 5, w: 20, h: 20, z: nextZ(), generatedPatternLayout: true });
    state.selected = 'showcaseTestSlot';
    renderLayers();
  });

  const row = page.locator('#layerList .ppShowcaseGroupRow');
  await expect(row).toHaveClass(/active/);

  await page.evaluate(() => {
    state.selected = null;
    renderLayers();
  });
  await expect(row).not.toHaveClass(/active/);
});

for (const setup of [
  { label: 'vertical strips', kind: 'generatePatternShowcaseLayout' },
  { label: 'squares', kind: 'squares' },
  { label: 'circles', kind: 'circles' },
  { label: 'rectangles', kind: 'rectangles' },
  { label: 'horizontal strips', kind: 'horizontal-strips' },
]) {
  test(`a banner added before generating a ${setup.label} showcase stays on top`, async ({ page }) => {
    const result = await page.evaluate((kind) => {
      function makePatternDataUrl(color) {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 200;
        const ctx = c.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 200, 200);
        return c.toDataURL('image/png');
      }
      save();
      state.trays.pattern = [{ src: makePatternDataUrl('#ff8ed6'), name: 'p1' }, { src: makePatternDataUrl('#8ed6ff'), name: 'p2' }];
      state.selectedTray = { pattern: 0 };

      // Banner added first, like the real reported workflow.
      addImageLayer('banner');
      render();

      if (kind === 'generatePatternShowcaseLayout') {
        window.showcaseLayoutType = 'strips';
        window.stripDirection = 'vertical';
        generatePatternShowcaseLayout();
      } else if (kind === 'horizontal-strips') {
        window.stripDirection = 'horizontal';
        setCards(3, 'strips');
      } else {
        setCards(4, kind);
      }

      const p = current();
      const banner = p.layers.find((l) => l.type === 'label');
      const showcase = p.layers.filter((l) => l.generatedPatternLayout);
      return { bannerZ: banner.z, maxShowcaseZ: Math.max(...showcase.map((l) => l.z || 0)), showcaseCount: showcase.length };
    }, setup.kind);

    expect(result.showcaseCount).toBeGreaterThan(0);
    expect(result.bannerZ).toBeGreaterThan(result.maxShowcaseZ);
  });
}

test('normalizing showcase z-order preserves the strips own relative stacking order', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makePatternDataUrl(color) {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 200, 200);
      return c.toDataURL('image/png');
    }
    save();
    state.trays.pattern = [{ src: makePatternDataUrl('#ff8ed6'), name: 'p1' }];
    state.selectedTray = { pattern: 0 };
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    setCards(4, 'strips');

    const before = current().layers.filter((l) => l.generatedPatternLayout).sort((a, b) => a.stackIndex - b.stackIndex).map((l) => l.stackIndex);

    addImageLayer('banner');
    render();

    const after = current().layers.filter((l) => l.generatedPatternLayout).sort((a, b) => a.stackIndex - b.stackIndex);
    const zsAscendWithStackIndex = after.every((l, i) => i === 0 || l.z > after[i - 1].z);
    return { before, afterStackIndexes: after.map((l) => l.stackIndex), zsAscendWithStackIndex };
  });

  expect(result.afterStackIndexes).toEqual(result.before);
  expect(result.zsAscendWithStackIndex).toBe(true);
});

test('a generated strip can be dragged to reposition it', async ({ page }) => {
  // Three separate "DOGGY DIRECTOR" renderLayer wraps each set node.onpointerdown to force a
  // full render() on every touch-down for generated strips (to select them), which rebuilt the
  // exact DOM node makeDraggable() had just started tracking mid-gesture and silently discarded
  // the pointer capture - strips could be selected but never actually dragged. Fixed by dropping
  // those onpointerdown overrides; makeDraggable() already selects on pointerdown for every
  // layer type without a disruptive re-render.
  await page.evaluate(() => {
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    window.generateSelectedShowcaseLayout();
  });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const l = state.pages[state.selectedPage].layers.find((x) => x.generatedPatternLayout);
    return { id: l.id, x: l.x, y: l.y };
  });

  const box = await page.locator(`.layer[data-id="${before.id}"]`).boundingBox();
  const sx = box.x + box.width / 2, sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(sx + i * 15, sy + i * 8, { steps: 3 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    const l = state.pages[state.selectedPage].layers.find((x) => x.generatedPatternLayout);
    return { x: l.x, y: l.y };
  });
  expect(Math.abs(after.x - before.x) > 0.5 || Math.abs(after.y - before.y) > 0.5).toBe(true);
});
