// Memory-safe upload capping: the real bug was that window.loadTray/addUploadedImageLayer/
// createMockupPage each got superseded by a later generation that dropped the resolution cap,
// silently storing every upload at full original size (a likely real contributor to the
// "save file too large" symptom). pp-memory-safe-upload-cap-js wraps the live generations to
// restore capping without touching their internals - this exercises the upload path exactly
// as the real UI would (via the actual <input> elements), not by calling internals directly.
const { test, expect } = require('../support/fixtures');

test('an uploaded asset image gets its transparent bounds trimmed before use as an image layer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeTransparentPngDataUrl() {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 60, 60);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(15, 15, 30, 30);
      return c.toDataURL('image/png');
    }
    save();
    state.trays.asset = [{ src: makeTransparentPngDataUrl(), name: 'asset0' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 400));
    const p = current();
    const l = p.layers.find((x) => x.type === 'image');
    return { layerFound: !!l, hasSrc: !!(l && l.src), tightBounds: l ? !!l.tightBounds : null };
  });

  expect(result.layerFound).toBe(true);
  expect(result.hasSrc).toBe(true);
  expect(result.tightBounds).toBe(true);
});

test('a large image uploaded through the real image-layer file input is capped to 1250px', async ({ page }) => {
  await page.evaluate(() => {
    function bigDataUrl(size) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#22c1c3');
      grad.addColorStop(1, '#fdbb2d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      window.__bigDataUrl = c.toDataURL('image/png');
    }
    bigDataUrl(2500);
  });

  await page.evaluate(async () => {
    const blob = await (await fetch(window.__bigDataUrl)).blob();
    const file = new File([blob], 'big-photo.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('imageLayerInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect
    .poll(() => page.evaluate(() => current().layers.some((l) => l.type === 'image')), { timeout: 5000 })
    .toBe(true);

  const dims = await page.evaluate(async () => {
    const l = current().layers.find((x) => x.type === 'image');
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = l.src;
    });
  });

  expect(Math.max(dims.w, dims.h)).toBeLessThanOrEqual(1250);
});

test('a small pattern upload through the pattern tray passes through uncapped', async ({ page }) => {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 40, 40);
    const dataUrl = c.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], 'small-swatch.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('patternInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.__smallOriginal = dataUrl;
  });

  await expect
    .poll(() => page.evaluate(() => (state.trays.pattern || []).length), { timeout: 3000 })
    .toBeGreaterThan(0);

  const matches = await page.evaluate(() => {
    const item = state.trays.pattern[state.trays.pattern.length - 1];
    return item.src === window.__smallOriginal;
  });
  expect(matches).toBe(true);
});

// Real request: scrolling away from a page and back always showed a blank "tap to edit"
// placeholder, since the PP95 virtualization above only keeps real layer DOM for the page
// +/-1 from state.selectedPage (everything else is "parked" to bound memory). pp-parked-page-
// preview replaces that blank placeholder with a small flattened raster snapshot instead, so
// scrolling shows real content immediately, while keeping parked pages as a single non-
// interactive <img> (not real layers) so nothing gets nudged/edited by a stray touch while
// scrolling past it.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('a page that just left the hot zone gets an immediate image preview instead of a blank placeholder', async ({ page }) => {
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src, x: 10, y: 10, w: 40, h: 40, z: 1, opacity: 1, r: 0 }] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, PNG_1PX);

  // Page 0 is hot right now - it should be a real, interactive layer, not a preview.
  await expect(page.locator('.stage[data-page="0"] .layer.image img')).toHaveCount(1);
  await expect(page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg')).toHaveCount(0);

  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  // Page 0 is now 2 pages away from selectedPage (2), outside the +/-1 hot radius - it should
  // be parked, but with a real snapshot captured from its live DOM on the way out, not left blank.
  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.stage[data-page="0"] .layer.image')).toHaveCount(0);

  const src = await previewImg.getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);

  // It must not intercept pointer events, so tapping the parked page still switches to it
  // (via the stage's own onclick) instead of the flattened snapshot swallowing the tap.
  const pointerEvents = await previewImg.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');
});

test('a page that has never been rendered still gets a preview via background warm-up, without leaving its temporary DOM behind', async ({ page }) => {
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src, x: 10, y: 10, w: 40, h: 40, z: 1, opacity: 1, r: 0 }] },
    ];
    // selectedPage stays at 0, so page 2 has never been in the hot zone and has no
    // "leaving hot zone" snapshot to fall back on - it can only come from the warm-up queue.
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, PNG_1PX);

  const previewImg = page.locator('.stage[data-page="2"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const src = await previewImg.getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);

  // The off-screen holder used to build that warm preview must not linger in memory afterward.
  const leftoverHolders = await page.evaluate(
    () => document.querySelectorAll('body > div[style*="-99999px"]').length,
  );
  expect(leftoverHolders).toBe(0);
});
