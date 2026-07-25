// Custom mock-up composition: uploading a background + mask produces a mock-up page/layer
// when the mask is a genuine alpha mask, and fails gracefully (no crash, a helpful alert)
// when the "mask" is just a uniform white image with nothing to mask. Also covers the
// memory-safe upload cap applying to mock-up backgrounds specifically (1400px max edge).
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('uploading a background + real alpha mask creates a custom mock-up layer', async ({ page }) => {
  await expandAllBoxes(page);

  const bgInput = page.locator('#customMockupBgInput');
  const maskInput = page.locator('#customMockupMaskInput');
  const btn = page.locator('#createCustomMockupBtnV163');
  await expect(bgInput).toHaveCount(1);
  await expect(maskInput).toHaveCount(1);
  await expect(btn).toHaveCount(1);

  await bgInput.setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: TINY_PNG });
  await maskInput.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: TINY_PNG });

  // Composing a mock-up also needs a pattern selected in the tray to fill the masked area.
  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');
  await patternInput.setInputFiles({ name: 'pat.png', mimeType: 'image/png', buffer: TINY_PNG });

  await clickResilient(page, btn);
  await expect
    .poll(
      () => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockup))),
      { timeout: 5000 }
    )
    .toBe(true);
});

test('a mask with no usable alpha shape fails with an alert instead of crashing', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (d) => {
    dialogs.push(d.message());
    await d.accept();
  });

  await expandAllBoxes(page);

  const whitePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAQAAAAmzuvsAAAAEUlEQVR42mNk+M9QDwODcAABBACOswdHHQAAAABJRU5ErkJggg==',
    'base64'
  );

  await page.locator('#customMockupBgInput').setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: whitePng });
  await page.locator('#customMockupMaskInput').setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: whitePng });

  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');
  if (await patternInput.count()) {
    await patternInput.setInputFiles({ name: 'pat.png', mimeType: 'image/png', buffer: whitePng });
  }

  const btn = page.locator('#createCustomMockupBtnV163');
  await clickResilient(page, btn);
  await expect.poll(() => dialogs.length, { timeout: 3000 }).toBeGreaterThan(0);

  const hasCustomMockupLayer = await page.evaluate(() =>
    state.pages.some((p) => (p.layers || []).some((l) => l.customMockup))
  );
  expect(hasCustomMockupLayer).toBe(false);
});

test('a large mock-up background upload is capped to the memory-safe max edge', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function bigDataUrl(size) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      let s = 12345;
      for (let i = 0; i < img.data.length; i += 4) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        img.data[i] = s % 256;
        img.data[i + 1] = (s >> 8) % 256;
        img.data[i + 2] = (s >> 16) % 256;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    }
    async function makeFile(dataUrl, name) {
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], name, { type: blob.type });
    }
    save();
    const pagesBefore = state.pages.length;
    const bigFile = await makeFile(bigDataUrl(2800), 'big-mockup.png');
    const dt = new DataTransfer();
    dt.items.add(bigFile);
    const input = document.getElementById('mockupInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const deadline = Date.now() + 8000;
    while (state.pages.length === pagesBefore && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    const newPage = state.pages[state.pages.length - 1];
    return { pagesGrew: state.pages.length > pagesBefore, dims: { w: newPage.w, h: newPage.h } };
  });

  expect(result.pagesGrew).toBe(true);
  expect(Math.max(result.dims.w, result.dims.h)).toBeLessThanOrEqual(1400);
});

test('fill all with selected pattern (listing placeholders) also re-fills every custom mock-up', async ({ page }) => {
  // The listing-placeholders template feature is built for sellers with hundreds of patterns to
  // list: load a template mixing plain pattern slots and custom mock-ups, hit one button, get a
  // fresh listing set for a new pattern. fillLinkedPlaceholdersFromTray() used to only touch
  // l.lkmPlaceholder layers - custom mock-ups (which store their own bg/mask/settings on
  // l.customMockupRecipe) were left on whatever pattern they were created with. It now also
  // sweeps every customMockupCropped layer and re-renders it against the newly selected pattern.
  page.on('dialog', (d) => d.accept());
  await expandAllBoxes(page);

  const bgInput = page.locator('#customMockupBgInput');
  const maskInput = page.locator('#customMockupMaskInput');
  const btn = page.locator('#createCustomMockupBtnV163');
  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');

  await bgInput.setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: TINY_PNG });
  await maskInput.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: TINY_PNG });
  await patternInput.setInputFiles({ name: 'pat-a.png', mimeType: 'image/png', buffer: TINY_PNG });

  await clickResilient(page, btn);
  await expect
    .poll(
      () => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))),
      { timeout: 5000 }
    )
    .toBe(true);

  const mockupLayerId = await page.evaluate(() => {
    for (const p of state.pages) {
      const l = (p.layers || []).find((x) => x.customMockupCropped);
      if (l) return l.id;
    }
    return null;
  });
  expect(mockupLayerId).toBeTruthy();

  await page.evaluate(() => window.addLkmPlaceholder('main pattern'));

  const secondPattern = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
    'base64'
  );
  await patternInput.setInputFiles({ name: 'pat-b.png', mimeType: 'image/png', buffer: secondPattern });

  // Uploading a file into the tray doesn't itself select it - a real user clicks the new thumb.
  await page.locator('#patternTray .thumb').last().click();

  const newPatternSrc = await page.evaluate(() => {
    const idx = state.selectedTray && state.selectedTray.pattern;
    return state.trays.pattern[idx].src;
  });

  await page.evaluate(() => window.fillLinkedPlaceholdersFromTray());

  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.id === id);
          return l && l.customMockupRecipe && l.customMockupRecipe.pattern;
        }, mockupLayerId),
      { timeout: 5000 }
    )
    .toBe(newPatternSrc);

  const placeholderSrc = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.lkmPlaceholder);
    return l && l.src;
  });
  expect(placeholderSrc).toBe(newPatternSrc);
});
