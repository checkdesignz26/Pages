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

  // Save a real .ptemplate via the actual save function (which now shows the Save As modal
  // instead of downloading immediately - confirm it with the default name), capturing the Blob
  // instead of letting the browser download it.
  const templateJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPatternPagesTemplate();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
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

  // restoreCustomMockupPlaceholderShapes() regenerates the plain mask-shaped cutout right after
  // load (strippedLayer can't decode images synchronously to do this at save time), so the mock-up
  // shows its real silhouette again instead of staying blank.
  const reloadedMockupSrc = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return l && l.src;
  });
  expect(reloadedMockupSrc).toMatch(/^data:image\/png/);

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
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
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

  // Real bug found via the seller's own (non-rectangular) mask file: strippedLayer() used to also
  // tag every placeholder patternSlot:true, including mock-ups, for the dashed "empty slot" look.
  // But .layer.patternSlot.filledSlot carries a hard-coded background:#fff!important +
  // object-fit:cover!important meant for plain rectangular pattern swatches - applied to a
  // mock-up, it painted opaque white behind the shaped cutout's transparent corners and force-
  // stretched it, turning a real silhouette (e.g. a mug body) into a flat white rectangle, both
  // while empty AND after being filled with a real pattern (nothing ever cleared the class).
  // restoreCustomMockupPlaceholderShapes() now regenerates the plain mask-shaped cutout right
  // after load (strippedLayer can't decode images synchronously to do this at save time) without
  // patternSlot, so it renders as a plain <img> that respects its own alpha shape.
  await page.evaluate(() => render());
  const reloadedMockupVisual = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    const el = document.querySelector(`.layer[data-id="${l.id}"]`);
    const img = el && el.querySelector('img');
    return {
      src: l.src,
      patternSlotFlag: l.patternSlot,
      hasPatternSlotClass: el ? el.classList.contains('patternSlot') : null,
      objectFit: img ? getComputedStyle(img).objectFit : null,
    };
  });
  expect(reloadedMockupVisual.src).toMatch(/^data:image\/png/);
  expect(reloadedMockupVisual.patternSlotFlag).toBeFalsy();
  expect(reloadedMockupVisual.hasPatternSlotClass).toBe(false);
  expect(reloadedMockupVisual.objectFit).toBe('contain');

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

  // Real bug: a reloaded template's mock-up keeps isPlaceholder/templatePlaceholder true (set by
  // loadPatternPagesTemplate from templateHadArtwork), and nothing ever cleared them once the
  // mock-up got filled with a real pattern - so the dashed "still needs a pattern" template
  // indicator (.templatePlaceholder) stuck around forever, even after deselecting, because it's
  // driven by these flags, not by selection state at all. Filling should clear it.
  await page.evaluate(() => { state.selected = null; render(); });
  await page.waitForTimeout(50);
  const afterFillFlags = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    const el = document.querySelector(`.layer[data-id="${l.id}"]`);
    return {
      isPlaceholder: l.isPlaceholder,
      templatePlaceholder: l.templatePlaceholder,
      hasTemplatePlaceholderClass: el ? el.classList.contains('templatePlaceholder') : null,
    };
  });
  expect(afterFillFlags.isPlaceholder).toBeFalsy();
  expect(afterFillFlags.templatePlaceholder).toBeFalsy();
  expect(afterFillFlags.hasTemplatePlaceholderClass).toBe(false);

  // Let the fill-all confirmation alert (setTimeout(...,40)) fire and get dismissed before
  // the test ends, so it doesn't try to accept a dialog on an already-closed page.
  await page.waitForTimeout(150);
});

// Real report: after loading a .ptemplate and filling its mock-up from the tray, the repeat/
// offset/texture sliders in the "custom mock-up" panel did nothing - the pattern couldn't be
// resized or repositioned inside the mock-up at all. Root cause: a mock-up preview layer is
// intentionally "locked" against ordinary selection (clicking one resets state.selected back to
// null, elsewhere in the app, so it can't be dragged/resized like a normal layer) - the sliders
// can only ever reach it via a separate cage.lastLayerId reference, which only ever got set
// inside the "create a new mock-up" flow. A mock-up that came from a loaded template and was
// filled via fillLinkedPlaceholdersFromTray() never passed through that flow, so lastLayerId
// stayed unset (or pointed at an unrelated mock-up) and the sliders were wired to nothing.
test('a template mock-up filled from the tray can still be resized/repositioned via the mock-up sliders', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await expandAllBoxes(page);

  const bgInput = page.locator('#customMockupBgInput');
  const maskInput = page.locator('#customMockupMaskInput');
  const btn = page.locator('#createCustomMockupBtnV163');
  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');

  await bgInput.setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: TINY_PNG });
  await maskInput.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: TINY_PNG });
  await patternInput.setInputFiles({ name: 'pat-a.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.locator('#patternTray .thumb').last().click();

  await clickResilient(page, btn);
  await expect
    .poll(
      () => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))),
      { timeout: 5000 }
    )
    .toBe(true);

  const templateJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPatternPagesTemplate();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = orig;
    return await captured.text();
  });

  await page.evaluate((json) => {
    const file = new File([json], 'test.ptemplate', { type: 'application/json' });
    window.loadPatternPagesTemplate({ target: { files: [file], value: '' } });
  }, templateJson);

  // Real-world condition this bug needs: cage.lastLayerId unrelated to the template's own
  // mock-up. Building the mock-up above (to get a real, valid recipe into the template) already
  // set it to that original layer's id, and the template reload keeps the same layer id - so
  // without this reset, this one test session would coincidentally still work even with the bug
  // present, unlike a real seller opening a template without having just created a mock-up.
  await page.evaluate(() => {
    if (window.PP_MOCKUP_PAPARAZZI_CAGE_V163) window.PP_MOCKUP_PAPARAZZI_CAGE_V163.lastLayerId = null;
  });

  await expect
    .poll(() => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))), {
      timeout: 5000,
    })
    .toBe(true);

  await page.locator('#patternTray .thumb').last().click();
  await page.evaluate(() => window.fillLinkedPlaceholdersFromTray());
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
          // Not just !!l.src - restorePlaceholderShape() already puts a plain placeholder src on
          // a freshly-loaded template's mock-up before it's ever filled, so that alone wouldn't
          // prove the actual pattern fill (fillLayerWithSelectedPattern, which sets customMockup
          // back to true and records the pattern in customMockupRecipe) really ran.
          return !!(l && l.customMockup && l.customMockupRecipe && l.customMockupRecipe.pattern);
        }),
      { timeout: 5000 }
    )
    .toBe(true);
  await page.waitForTimeout(150); // let the fill-all confirmation alert settle

  // Tap the now-filled mock-up on the canvas, exactly like a seller would to try adjusting it.
  const mockupId = await page.evaluate(
    () => state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped).id
  );
  await page.locator(`.layer[data-id="${mockupId}"]`).click();
  await page.waitForTimeout(100);

  const wired = await page.evaluate(
    (id) => window.PP_MOCKUP_PAPARAZZI_CAGE_V163 && window.PP_MOCKUP_PAPARAZZI_CAGE_V163.lastLayerId === id
  , mockupId);
  expect(wired).toBe(true);

  // Real follow-up report, with a screenshot: once tapping a mock-up correctly wired the
  // sliders (above), there was no visible sign on the canvas that anything had happened -
  // clearing state.selected (so the mock-up stays "locked" against normal drag/resize) also
  // meant the ordinary .selected outline never applied. A separate, narrower
  // .customMockupEditing class exists just to show a box for whichever mock-up the sliders are
  // currently wired to, without reviving the handles/drag behavior the "locked" design
  // intentionally disables.
  const hasBoundingBox = await page.evaluate(
    (id) => document.querySelector(`.layer[data-id="${id}"]`).classList.contains('customMockupEditing'),
    mockupId
  );
  expect(hasBoundingBox).toBe(true);
  const outline = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`.layer[data-id="${id}"]`)).outlineStyle,
    mockupId
  );
  expect(outline).toBe('solid');

  // Drag the "move left/right" slider - the same gesture a seller would use to reposition the
  // pattern inside the mock-up. Before the fix, updateClean() (the only code path that ever
  // writes customMockupRecipe back onto a layer) couldn't find this layer at all - it only
  // matched via cage.lastLayerId, which stayed unset for a template-loaded mock-up - so this
  // recipe update, and the re-render it triggers, never happened.
  await page.locator('#customMockupOffsetX').fill('40');
  await page.locator('#customMockupOffsetX').dispatchEvent('input');
  await expect
    .poll(
      () =>
        page.evaluate(
          (id) => state.pages.flatMap((p) => p.layers || []).find((x) => x.id === id).customMockupRecipe.offsetX,
          mockupId
        ),
      { timeout: 2000 }
    )
    .toBe(40);
});

// Real report, with a screenshot: after tapping a mock-up correctly showed the pink
// .customMockupEditing bounding box, the box kept showing forever afterward - even once the
// seller had moved on to a totally different tool (the screenshot showed it still there while
// using "recolor png" on an unrelated image). Root cause: nothing ever cleared
// cage.lastLayerId (the id customMockupEditing is keyed off) once set - a mock-up always leaves
// state.selected null as part of locking it against normal drag/resize, so there was no signal
// left behind that the user had genuinely moved on to something else.
test('the mock-up bounding box clears once something else is selected or deselect is used', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await expandAllBoxes(page);

  const bgInput = page.locator('#customMockupBgInput');
  const maskInput = page.locator('#customMockupMaskInput');
  const btn = page.locator('#createCustomMockupBtnV163');
  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');

  await bgInput.setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: TINY_PNG });
  await maskInput.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: TINY_PNG });
  await patternInput.setInputFiles({ name: 'pat.png', mimeType: 'image/png', buffer: TINY_PNG });
  await clickResilient(page, btn);
  await expect
    .poll(() => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockup))), {
      timeout: 5000,
    })
    .toBe(true);

  const mockupId = await page.evaluate(
    () => state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockup).id
  );
  const boxVisible = () =>
    page.evaluate(
      (id) => document.querySelector(`.layer[data-id="${id}"]`).classList.contains('customMockupEditing'),
      mockupId
    );
  await expect.poll(boxVisible).toBe(true); // the mock-up is freshly created, so already "wired"

  // Selecting something else entirely (a plain text layer, like moving on to a different part of
  // the page) should clear it.
  await page.evaluate(() => window.addText());
  await page.waitForTimeout(100);
  expect(await boxVisible()).toBe(false);

  // Re-wire it, then confirm the explicit "deselect" control also clears it.
  await page.locator(`.layer[data-id="${mockupId}"]`).click();
  await page.waitForTimeout(100);
  await expect.poll(boxVisible).toBe(true);
  await page.evaluate(() => window.deselect());
  await page.waitForTimeout(100);
  expect(await boxVisible()).toBe(false);
});

test('creating a mock-up with no pattern selected places a plain white mask-shaped cutout, photo visible', async ({ page }) => {
  // Real request: the mock-up used to require a pattern to be selected at creation time
  // (createClean threw an alert otherwise), forcing the seller to pick one of their 450+
  // patterns before they could even lay out the mock-up in a template. The white-mask crop
  // bounds only depend on the background + mask (fillPattern just paints pixels inside that
  // area later) - a pattern was never actually needed to know where and how big the slot is.
  //
  // Several attempts landed here: a stand-in texture (rejected, read as an actual pattern), then
  // placing the raw mask file full-canvas with no processing (rejected - a mask that's mostly
  // opaque/black hid the whole photo). Confirmed direction: the product photo should stay fully
  // visible, with just a plain white cutout of the mask's own shape marking where the pattern
  // will land - no fill, no blend. customMockup stays false (no multiply, not locked, a plain
  // selectable image) until fillLayerWithSelectedPattern()/updateClean() run the real pipeline
  // once a pattern is chosen.
  //
  // Real bug found by testing with an actual (non-rectangular) mask: the layer was also tagged
  // patternSlot:true for the dashed "empty slot" look, but .layer.patternSlot.filledSlot carries
  // a hard-coded background:#fff!important + object-fit:cover!important meant for plain
  // rectangular pattern swatches - it painted opaque white behind the PNG's transparent corners
  // and stretched the image to cover the box, turning a correctly-shaped cutout (e.g. a mug body
  // silhouette) into a flat white rectangle. Fixed by not tagging this layer patternSlot at all -
  // it doesn't need that class for anything functional, only a plain <img> that respects its own
  // alpha.
  page.on('dialog', (d) => d.accept());
  await expandAllBoxes(page);

  const bgInput = page.locator('#customMockupBgInput');
  const maskInput = page.locator('#customMockupMaskInput');
  const btn = page.locator('#createCustomMockupBtnV163');

  // No pattern uploaded to the tray at all - not even a fallback thumb exists.
  await bgInput.setInputFiles({ name: 'bg.png', mimeType: 'image/png', buffer: TINY_PNG });
  await maskInput.setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: TINY_PNG });

  await clickResilient(page, btn);
  await expect
    .poll(
      () => page.evaluate(() => state.pages.some((p) => (p.layers || []).some((l) => l.customMockupCropped))),
      { timeout: 5000 }
    )
    .toBe(true);

  const created = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return {
      src: l.src,
      patternSlot: l.patternSlot,
      customMockup: l.customMockup,
      hasRecipe: !!l.customMockupRecipe,
      recipeBg: l.customMockupRecipe && l.customMockupRecipe.bg,
      recipeMask: l.customMockupRecipe && l.customMockupRecipe.mask,
      recipePattern: l.customMockupRecipe && l.customMockupRecipe.pattern,
    };
  });
  // Rendered as a cropped cutout of the mask's own shape - real pixel content, not the raw file.
  expect(created.src).toMatch(/^data:image\/png/);
  expect(created.src).not.toBe(created.recipeMask);
  // Not treated as a "live" locked mock-up yet, so no multiply blend and normally selectable.
  expect(created.customMockup).toBe(false);
  // No patternSlot class - that's what carries the background:#fff!important/object-fit:cover
  // rules that flattened a real shaped mask into a solid rectangle.
  expect(created.patternSlot).toBeFalsy();
  expect(created.hasRecipe).toBe(true);
  expect(created.recipeBg).toBeTruthy();
  expect(created.recipeMask).toBeTruthy();
  // No real pattern applied yet - still waiting to be filled.
  expect(created.recipePattern).toBeFalsy();

  const domInfo = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    const el = document.querySelector(`.layer[data-id="${l.id}"]`);
    const img = el && el.querySelector('img');
    return {
      hasBlendClass: el ? el.classList.contains('customMockupLayer') : null,
      hasPatternSlotClass: el ? el.classList.contains('patternSlot') : null,
      objectFit: img ? getComputedStyle(img).objectFit : null,
    };
  });
  expect(domInfo.hasBlendClass).toBe(false);
  expect(domInfo.hasPatternSlotClass).toBe(false);
  // contain (not the patternSlot.filledSlot rule's forced cover) - respects the PNG's own shape.
  expect(domInfo.objectFit).toBe('contain');

  // Now pick a pattern and fill it in via the normal listing-placeholders "fill all" flow.
  const patternInput = page.locator('input[onchange*="loadTray"][onchange*="pattern"]');
  await patternInput.setInputFiles({ name: 'pat-a.png', mimeType: 'image/png', buffer: TINY_PNG });
  await page.locator('#patternTray .thumb').last().click();

  const patternSrc = await page.evaluate(() => {
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

  const filled = await page.evaluate(() => {
    const l = state.pages.flatMap((p) => p.layers || []).find((x) => x.customMockupCropped);
    return { pattern: l.customMockupRecipe && l.customMockupRecipe.pattern, customMockup: l.customMockup };
  });
  expect(filled.pattern).toBe(patternSrc);
  expect(filled.customMockup).toBe(true);

  await page.waitForTimeout(150);
});

// Real report, with screenshots: a downloaded page's custom mock-up pattern came out flat and
// unrealistic, unlike how it looks live on the page. A "live" custom mock-up layer
// (customMockupLive, built by buildPage() in the custom-mock-up feature) is only the masked/
// cropped pattern fill - its on-screen realism comes entirely from CSS mix-blend-mode:multiply
// compositing it against the mock-up background photo layer drawn underneath it. The PNG/ZIP
// export (renderPageToCanvas) draws straight from the page's layer data, never touches the DOM/
// CSS, and previously always used the canvas default composite (plain paint-over) for every
// image layer - so the exported pattern never picked up the multiply blend at all.
test('exporting a page with a live custom mock-up multiplies the pattern over the mock-up photo, matching how it looks live', async ({ page }) => {
  await expandAllBoxes(page);

  const bgColor = [200, 120, 40];
  const patternColor = [80, 180, 60];

  const setup = await page.evaluate(async ({ bgColor, patternColor }) => {
    function solidPng(w, h, rgb) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(0, 0, w, h);
      return c.toDataURL('image/png');
    }
    async function makeFile(dataUrl, name) {
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], name, { type: blob.type });
    }
    function setFile(inputId, file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById(inputId);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const bgFile = await makeFile(solidPng(60, 60, bgColor), 'bg.png');
    const maskFile = await makeFile(solidPng(60, 60, [255, 255, 255]), 'mask.png');
    const patFile = await makeFile(solidPng(60, 60, patternColor), 'pat.png');

    setFile('customMockupBgInput', bgFile);
    setFile('customMockupMaskInput', maskFile);
    setFile('patternInput', patFile);

    // Rule out the separate "texture" shading step (a mild baked-in gradient meant to keep
    // fabric/print from looking like a flat sticker) as a confound - it would otherwise nudge
    // the exported pixel away from a clean multiply of the two flat colours above.
    const textureEl = document.getElementById('customMockupTexture');
    if (textureEl) textureEl.value = 0;

    return true;
  }, { bgColor, patternColor });
  expect(setup).toBe(true);

  await clickResilient(page, page.locator('#createCustomMockupBtnV163'));
  await expect
    .poll(() => page.evaluate(() => state.pages.flatMap((p) => p.layers || []).some((l) => l.customMockupLive && l.src)), { timeout: 5000 })
    .toBe(true);

  const pixel = await page.evaluate(async () => {
    const p = state.pages.find((pg) => (pg.layers || []).some((l) => l.customMockupLive));
    const canvas = await window.renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    const layer = p.layers.find((l) => l.customMockupLive);
    // Sample the centre of the mock-up layer's own bounds - the mask covered the whole 60x60
    // source image, so its cropped bounds should comfortably cover the middle of the page.
    const cx = Math.round(((layer.x + layer.w / 2) / 100) * p.w);
    const cy = Math.round(((layer.y + layer.h / 2) / 100) * p.h);
    return Array.from(ctx.getImageData(cx, cy, 1, 1).data);
  });

  const expectedMultiply = [
    Math.round((bgColor[0] * patternColor[0]) / 255),
    Math.round((bgColor[1] * patternColor[1]) / 255),
    Math.round((bgColor[2] * patternColor[2]) / 255),
  ];
  // A plain (unblended) paint-over would land here instead - the exact symptom reported.
  const flatPatternOnly = patternColor;

  for (let i = 0; i < 3; i++) {
    expect(Math.abs(pixel[i] - expectedMultiply[i])).toBeLessThan(6);
  }
  const distanceFromFlat = Math.hypot(pixel[0] - flatPatternOnly[0], pixel[1] - flatPatternOnly[1], pixel[2] - flatPatternOnly[2]);
  expect(distanceFromFlat).toBeGreaterThan(20);
});
