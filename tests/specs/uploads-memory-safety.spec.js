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
