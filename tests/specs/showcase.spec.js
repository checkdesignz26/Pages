// Pattern Showcase generation: all layout shapes produce the right slotShape/direction, the
// showcase-group highlight in the layer panel stays in sync via a MutationObserver (not a
// renderLayers wrap, which gets silently discarded - Phase 0, 25/N), and generating/
// regenerating a showcase never renders it above pre-existing decoration layers regardless of
// add order (the banner-behind-showcase bug reported and fixed after the Phase 0 cleanup).
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

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

test('a banner added before generateSelectedShowcaseLayout (the real generate-layout button path) stays on top', async ({ page }) => {
  // The other "stays on top" tests above all go through setCards/generatePatternShowcaseLayout,
  // which do call ppNormalizeShowcaseZ - but window.generateSelectedShowcaseLayout (what the
  // panel's actual "generate/update layout" button is wired to, via
  // ppages-v180c-showcase-fix-js's rebuild()) never called it, so the banner-behind-decorations
  // bug those other tests guard against was still live through this specific, primary path.
  const result = await page.evaluate(() => {
    save();
    addImageLayer('banner');
    render();
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    window.generateSelectedShowcaseLayout();
    const p = current();
    const banner = p.layers.find((l) => l.type === 'label');
    const showcase = p.layers.filter((l) => l.generatedPatternLayout);
    return { bannerZ: banner.z, maxShowcaseZ: Math.max(...showcase.map((l) => l.z || 0)), showcaseCount: showcase.length };
  });

  expect(result.showcaseCount).toBeGreaterThan(0);
  expect(result.bannerZ).toBeGreaterThan(result.maxShowcaseZ);
});

// Real request: label each generated circle/square/rectangle for an Etsy listing image, e.g.
// naming each swatch. Captions are plain text layers positioned directly under their own tile,
// generated by the same rebuild() the "generate layout" button actually calls (see the test
// above) - deliberately NOT tagged generatedPatternLayout/patternSlot like the tiles themselves,
// since those two flags are read by several unrelated existing patches (magic-fill's "is this an
// empty pattern slot" check, the fill-preserving reuse() inside rebuild(), the layer-panel's
// collapsed-showcase-row grouping) that all assume a match is an image-fillable tile - tagging
// captions the same way would have pulled them into every one of those, e.g. magic fill trying to
// stuff a pattern image into a caption's text box.
test('checking "add a caption below each shape" gives every generated circle its own caption directly beneath it', async ({ page }) => {
  const result = await page.evaluate(() => {
    document.getElementById('showcaseAddCaptions').checked = true;
    window.showcaseLayoutType = 'circles';
    document.getElementById('cardCount').value = 6;
    window.generateSelectedShowcaseLayout();
    const p = current();
    const tiles = p.layers.filter((l) => l.generatedPatternLayout && l.slotShape === 'circle');
    const caps = p.layers.filter((l) => l.showcaseCaption);
    return {
      tileCount: tiles.length,
      capCount: caps.length,
      capsAreImageFillable: caps.some((l) => l.patternSlot || l.generatedPatternLayout),
      pairs: tiles.map((t) => {
        const c = caps.find((l) => Math.abs(l.x - t.x) < 0.01 && Math.abs(l.w - t.w) < 0.01 && l.y > t.y);
        return c ? { gap: +(c.y - (t.y + t.h)).toFixed(2), sameWidth: Math.abs(c.w - t.w) < 0.01 } : null;
      }),
    };
  });

  expect(result.tileCount).toBe(6);
  expect(result.capCount).toBe(6);
  expect(result.capsAreImageFillable).toBe(false);
  for (const pair of result.pairs) {
    expect(pair).not.toBeNull();
    expect(pair.gap).toBeGreaterThan(0);
    expect(pair.gap).toBeLessThan(3);
    expect(pair.sameWidth).toBe(true);
  }
});

test('captions are cleared on regenerate once unchecked, on switching to strips, and on remove showcase - never left orphaned', async ({ page }) => {
  const steps = await page.evaluate(() => {
    function counts() {
      const p = current();
      return { tiles: p.layers.filter((l) => l.generatedPatternLayout).length, caps: p.layers.filter((l) => l.showcaseCaption).length };
    }
    document.getElementById('showcaseAddCaptions').checked = true;
    window.showcaseLayoutType = 'rectangles';
    document.getElementById('cardCount').value = 4;
    window.generateSelectedShowcaseLayout();
    const withCaptions = counts();

    document.getElementById('showcaseAddCaptions').checked = false;
    window.generateSelectedShowcaseLayout();
    const uncheckedThenRegenerated = counts();

    document.getElementById('showcaseAddCaptions').checked = true;
    window.generateSelectedShowcaseLayout();
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    window.generateSelectedShowcaseLayout();
    const switchedToStrips = counts();

    window.showcaseLayoutType = 'squares';
    document.getElementById('showcaseAddCaptions').checked = true;
    window.generateSelectedShowcaseLayout();
    window.removePatternShowcase();
    const afterRemove = counts();

    return { withCaptions, uncheckedThenRegenerated, switchedToStrips, afterRemove };
  });

  expect(steps.withCaptions).toEqual({ tiles: 4, caps: 4 });
  expect(steps.uncheckedThenRegenerated).toEqual({ tiles: 4, caps: 0 });
  expect(steps.switchedToStrips.caps).toBe(0);
  expect(steps.afterRemove).toEqual({ tiles: 0, caps: 0 });
});

// The "showcase control room" layout-size slider scales every generated tile as one group around
// a shared centre (applyShowcaseControlRoom in ppages-v180-showcase-control-room-js) - captions
// need to be part of that same group, or resizing the layout to "make room for text" (the
// slider's own hint) would leave captions behind at their old size/position instead of tracking
// their tile.
test('the layout-size slider scales captions together with their tiles, not just the tiles', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('showcaseAddCaptions').checked = true;
    window.showcaseLayoutType = 'squares';
    document.getElementById('cardCount').value = 4;
    window.generateSelectedShowcaseLayout();
  });
  await page.waitForTimeout(200); // afterGenerate()'s setTimeout(...,0) captures the scaling base

  // Driven via evaluate rather than a real slider drag - the "pattern showcase" panel box can be
  // collapsed at this viewport, and this only needs to exercise the same input/change listeners
  // a real drag would fire, not the drag gesture itself.
  await page.evaluate(() => {
    const slider = document.getElementById('showcaseLayoutSize');
    slider.value = '70';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(200);

  const gaps = await page.evaluate(() => {
    const p = current();
    const tiles = p.layers.filter((l) => l.generatedPatternLayout && l.slotShape === 'square');
    const caps = p.layers.filter((l) => l.showcaseCaption);
    return tiles.map((t) => {
      const c = caps.find((l) => Math.abs(l.x - t.x) < 0.05 && l.y > t.y);
      return c ? +(c.y - (t.y + t.h)).toFixed(2) : null;
    });
  });

  expect(gaps).toHaveLength(4);
  for (const g of gaps) {
    expect(g).not.toBeNull();
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(3);
  }
});

// Real report: once a banner (or any other layer) sits on top of a generated strip on canvas,
// tapping the strip there just hits the banner instead - and the collapsed "Pattern Showcase"
// row in the layers panel only ever selected the whole showcase as one resizable unit (see
// selectGroup() in ppages-v182m-layer-fixes-js), with no way to reach one specific strip. The
// showcase row can now be expanded (like a real layer group already can) to list each strip as
// its own selectable row, so it stays reachable regardless of what covers it on canvas.
test('an individual pattern-showcase strip stays selectable from the layers panel even when another layer covers it on canvas', async ({ page }) => {
  await expandAllBoxes(page);

  const setup = await page.evaluate(() => {
    save();
    addImageLayer('banner');
    render();
    window.showcaseLayoutType = 'strips';
    window.stripDirection = 'vertical';
    window.generateSelectedShowcaseLayout();
    const p = current();
    const banner = p.layers.find((l) => l.type === 'label');
    const showcase = p.layers.filter((l) => l.generatedPatternLayout);
    state.selected = banner.id;
    render();
    return { bannerId: banner.id, stripIds: showcase.map((s) => s.id) };
  });
  expect(setup.stripIds.length).toBeGreaterThan(0);

  // Collapsed by default - no per-strip row yet (the DOM builds regardless of whether the
  // surrounding panel box is currently expanded, so this doesn't need any retry of its own).
  await expect(page.locator(`#layerList .layerItem.childLayerRow[data-id="${setup.stripIds[0]}"]`)).toHaveCount(0);

  // Several independent boot()/setTimeout cycles re-render/re-collapse parts of this panel a
  // moment after load, same as everywhere else in this codebase that interacts with it -
  // clickResilient() self-heals against that instead of a one-shot expand+click.
  const groupRow = page.locator('#layerList .ppShowcaseGroupRow');
  await clickResilient(page, groupRow.locator('.dragGrip'));

  const stripRow = page.locator(`#layerList .layerItem.childLayerRow[data-id="${setup.stripIds[0]}"]`);
  await expect(stripRow).toBeVisible();

  await clickResilient(page, stripRow.locator('.ppLayerSelectZone'));
  await expect.poll(() => page.evaluate(() => state.selected)).toBe(setup.stripIds[0]);
});
