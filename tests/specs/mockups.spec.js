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

test('a custom mock-up marked as a placeholder survives save-template/load-template and can be refilled', async ({ page }) => {
  // The real "template creator" the seller uses is the separate templates.ptemplate save/load
  // panel (templateExtensionScript: "save template"/"load template"/"mark placeholder"), not just
  // the in-session fill-all button covered above. A seller builds a page with a mock-up, selects
  // it, clicks "mark placeholder", saves a .ptemplate, and later re-loads that file for a brand
  // new pattern. strippedLayer() (the function that scrubs a layer for the saved template) blanks
  // l.src for anything marked as a placeholder but must NOT also drop l.customMockupRecipe/
  // customMockupCropped - those are what let fillLinkedPlaceholdersFromTray() find and re-render
  // the mock-up after the round trip. This exercises the real save/load functions end to end,
  // not a re-implementation of their logic.
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

  // Select the mock-up layer and mark it as a placeholder, the documented templates-panel flow.
  await page.evaluate((id) => {
    state.selected = id;
    window.markSelectedAsPlaceholder();
  }, mockupLayerId);

  await page.evaluate(() => window.addLkmPlaceholder('main pattern'));

  // Save a real .ptemplate via the actual save function, capturing the Blob instead of letting
  // the browser download it.
  const templateJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPatternPagesTemplate();
    URL.createObjectURL = orig;
    return await captured.text();
  });

  const savedMockupLayer = JSON.parse(templateJson).pages.flatMap((p) => p.layers || []).find((l) => l.customMockupCropped);
  expect(savedMockupLayer).toBeTruthy();
  expect(savedMockupLayer.isPlaceholder).toBe(true);
  expect(savedMockupLayer.src).toBeFalsy();
  expect(savedMockupLayer.customMockupRecipe && savedMockupLayer.customMockupRecipe.bg).toBeTruthy();
  expect(savedMockupLayer.customMockupRecipe && savedMockupLayer.customMockupRecipe.mask).toBeTruthy();

  // Load that saved template back through the real load function (a fresh "open this template
  // for a new pattern" session), then confirm the mock-up comes back blank, ready to be filled.
  await page.evaluate((json) => {
    const file = new File([json], 'test.ptemplate', { type: 'application/json' });
    window.loadPatternPagesTemplate({ target: { files: [file], value: '' } });
  }, templateJson);

  await expect
    .poll(() => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))), {
      timeout: 5000,
    })
    .toBe(true);

  const reloadedMockupSrc = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return l && l.src;
  });
  expect(reloadedMockupSrc).toBeFalsy();

  // Now pick a brand new pattern and hit the one-button fill-all, the actual seller workflow.
  const secondPattern = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
    'base64'
  );
  await patternInput.setInputFiles({ name: 'pat-b.png', mimeType: 'image/png', buffer: secondPattern });
  await page.locator('#patternTray .thumb').last().click();

  const newPatternSrc = await page.evaluate(() => {
    const idx = state.selectedTray && state.selectedTray.pattern;
    return state.trays.pattern[idx].src;
  });

  await page.evaluate(() => window.fillLinkedPlaceholdersFromTray());

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
          return l && l.src;
        }),
      { timeout: 5000 }
    )
    .not.toBeFalsy();

  const filledMockupPattern = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return l && l.customMockupRecipe && l.customMockupRecipe.pattern;
  });
  expect(filledMockupPattern).toBe(newPatternSrc);

  const reloadedPlaceholderSrc = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.lkmPlaceholder);
    return l && l.src;
  });
  expect(reloadedPlaceholderSrc).toBe(newPatternSrc);
});

test('a custom mock-up survives save-template/load-template WITHOUT manually marking it as a placeholder', async ({ page }) => {
  // Real bug report: a seller built a mock-up, never touched "mark placeholder" (a step that
  // isn't obvious - the mock-up UI never tells you it's needed), hit "save template", and the
  // baked-in pattern was saved as permanent artwork instead of being cleared for reuse - loading
  // the template later showed the OLD pattern still on the mock-up. strippedLayer() only treated
  // a layer as a placeholder if it was explicitly marked (isPlaceholder/templatePlaceholder/
  // patternSlot) or had "placeholder" in its name; a freshly created customMockupCropped layer
  // has none of those. Since every mock-up is meant to be auto-refilled by "fill all" with no
  // opt-in (per the listing-placeholders feature this was built for), strippedLayer() now also
  // treats customMockupCropped as an automatic placeholder, with no manual marking step needed.
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

  // Deliberately do NOT select the mock-up or call markSelectedAsPlaceholder() - this is the
  // exact real-world flow that produced the bug.
  const templateJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPatternPagesTemplate();
    URL.createObjectURL = orig;
    return await captured.text();
  });

  const savedMockupLayer = JSON.parse(templateJson).pages.flatMap((p) => p.layers || []).find((l) => l.customMockupCropped);
  expect(savedMockupLayer).toBeTruthy();
  expect(savedMockupLayer.src).toBeFalsy();
  expect(savedMockupLayer.customMockupRecipe && savedMockupLayer.customMockupRecipe.bg).toBeTruthy();
  expect(savedMockupLayer.customMockupRecipe && savedMockupLayer.customMockupRecipe.mask).toBeTruthy();

  await page.evaluate((json) => {
    const file = new File([json], 'test.ptemplate', { type: 'application/json' });
    window.loadPatternPagesTemplate({ target: { files: [file], value: '' } });
  }, templateJson);

  await expect
    .poll(() => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))), {
      timeout: 5000,
    })
    .toBe(true);

  const reloadedMockupSrc = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return l && l.src;
  });
  expect(reloadedMockupSrc).toBeFalsy();

  const secondPattern = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
    'base64'
  );
  await patternInput.setInputFiles({ name: 'pat-b.png', mimeType: 'image/png', buffer: secondPattern });
  await page.locator('#patternTray .thumb').last().click();

  const newPatternSrc = await page.evaluate(() => {
    const idx = state.selectedTray && state.selectedTray.pattern;
    return state.trays.pattern[idx].src;
  });

  await page.evaluate(() => window.fillLinkedPlaceholdersFromTray());

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
          return l && l.customMockupRecipe && l.customMockupRecipe.pattern;
        }),
      { timeout: 5000 }
    )
    .toBe(newPatternSrc);

  // Let the fill-all confirmation alert (setTimeout(...,40)) fire and get dismissed before
  // the test ends, so it doesn't try to accept a dialog on an already-closed page.
  await page.waitForTimeout(150);
});
