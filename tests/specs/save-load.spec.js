// Save/undo/redo, the .ppages Save As flow, asset deduplication, backward-compatible loading
// of old-format files, and the live loadPstudioFile path (which superseded two earlier dead
// generations during cleanup - Phase 0, 28/N).
const { test, expect } = require('../support/fixtures');

test('undo restores the layer list to its pre-add state', async ({ page }) => {
  await page.evaluate(() => window.addText('text'));
  const before = await page.evaluate(() => current().layers.length);

  await page.evaluate(() => window.addText('text'));
  await page.evaluate(() => window.addText('text'));
  const afterAdds = await page.evaluate(() => current().layers.length);
  expect(afterAdds).toBe(before + 2);

  const historyLen = await page.evaluate(() => state.history.length);
  expect(historyLen).toBeGreaterThan(0);

  await page.evaluate(() => undo());
  const afterUndo = await page.evaluate(() => current().layers.length);
  expect(afterUndo).toBe(afterAdds - 1);
});

test('the Save As modal downloads a .ppages file with the chosen name, no native prompt', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await page.evaluate(() => {
    save();
    const l = layer('rectangle', { name: 'r', x: 5, y: 5, w: 20, h: 20, fill: '#f00', z: nextZ() });
    current().layers.push(l);
    render();
  });

  await page.click('header button:has-text("save .ppages")');
  await expect(page.locator('#ppSaveAsOverlay')).toHaveCount(1);
  await expect(page.locator('#ppSaveAsInput')).not.toHaveValue('');

  await page.fill('#ppSaveAsInput', 'my shop patterns v2');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#ppSaveAsConfirm'),
  ]);

  expect(download.suggestedFilename()).toBe('my shop patterns v2.ppages');
  expect(dialogFired).toBe(false);
});

test('save template also uses the Save As modal with a short default name, not a long auto-generated one', async ({ page }) => {
  // Real request: "save template" always downloaded with a long auto-generated name
  // (<page-title>-template.ptemplate) and no way to rename it. It now reuses the same
  // ppShowSaveAsDialog() modal "save .ppages" already uses (a custom in-page dialog, not the
  // native prompt() - prompt() can invalidate the "trusted user gesture" a tap established on
  // iOS Safari, silently dropping the download that follows).
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await page.click('header button:has-text("save template")');
  await expect(page.locator('#ppSaveAsOverlay')).toHaveCount(1);
  const defaultValue = await page.locator('#ppSaveAsInput').inputValue();
  expect(defaultValue).toBe('my-template');

  await page.fill('#ppSaveAsInput', 'mug listing template');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#ppSaveAsConfirm'),
  ]);

  expect(download.suggestedFilename()).toBe('mug listing template.ptemplate');
  expect(dialogFired).toBe(false);

  // Saving again should default to the name just used, not fall back to the generic one.
  await page.click('header button:has-text("save template")');
  await expect(page.locator('#ppSaveAsInput')).toHaveValue('mug listing template');
  await page.click('#ppSaveAsCancel');
});

// Real request: "download page" and "download ZIP" always saved with a fixed name
// ("pattern-pages-N.png" / "pattern-pages-export.zip") with no way to rename either one. Both
// now reuse the same ppShowSaveAsDialog() modal the .ppages/.ptemplate saves already use (a
// custom in-page dialog, not the native prompt() - a blocking native dialog mid-click can
// invalidate the trusted user gesture the original tap established, silently dropping the
// download that follows on iOS Safari).
test('download page uses the Save As modal to name the PNG, no native prompt', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await page.click('header button:has-text("download page")');
  await expect(page.locator('#ppSaveAsOverlay')).toHaveCount(1);
  const defaultValue = await page.locator('#ppSaveAsInput').inputValue();
  expect(defaultValue).toBe('pattern-pages-1');

  await page.fill('#ppSaveAsInput', 'autumn mug listing');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#ppSaveAsConfirm'),
  ]);

  expect(download.suggestedFilename()).toBe('autumn mug listing.png');
  expect(dialogFired).toBe(false);
});

test('download ZIP uses the Save As modal to name the ZIP, no native prompt', async ({ page }) => {
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    await d.dismiss();
  });

  await page.click('header button:has-text("download ZIP")');
  await expect(page.locator('#ppSaveAsOverlay')).toHaveCount(1);
  const defaultValue = await page.locator('#ppSaveAsInput').inputValue();
  expect(defaultValue).toBe('pattern-pages-export');

  await page.fill('#ppSaveAsInput', 'autumn mug listing set');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#ppSaveAsConfirm'),
  ]);

  expect(download.suggestedFilename()).toBe('autumn mug listing set.zip');
  expect(dialogFired).toBe(false);
});

test('identical images used multiple times are deduplicated when saving, and restore correctly', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makePatternDataUrl(seed) {
      const c = document.createElement('canvas');
      c.width = 300;
      c.height = 300;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(300, 300);
      let s = seed;
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
    const patternSrcs = [makePatternDataUrl(1), makePatternDataUrl(2)];
    state.trays.pattern = patternSrcs.map((src, i) => ({ src, name: 'pattern' + i }));
    save();
    const p = current();
    patternSrcs.forEach((src, i) => {
      p.layers.push(layer('rectangle', { name: 'rect' + i, x: 5 + i * 10, y: 5, w: 25, h: 25, z: nextZ(), src, fit: 'cover', patternSlot: true }));
    });
    // Reuse pattern 0 a second time to exercise multi-use dedup.
    p.layers.push(layer('rectangle', { name: 'rect0b', x: 5, y: 40, w: 25, h: 25, z: nextZ(), src: patternSrcs[0], fit: 'cover', patternSlot: true }));
    render();

    let capturedBlob = null;
    const origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      capturedBlob = blob;
      return origCreateObjectURL.call(URL, blob);
    };
    window.downloadPstudio();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsInput').value = 'dedup-test';
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = origCreateObjectURL;

    const dedupedJson = await capturedBlob.text();
    const parsed = JSON.parse(dedupedJson);
    const poolSize = Object.keys(parsed.assetPool || {}).length;

    state.pages = [];
    state.trays = { pattern: [], asset: [] };
    const file = new File([dedupedJson], 'test.ppages', { type: 'application/x-ppages' });
    await new Promise((resolve) => {
      window.loadPstudioFile({ target: { files: [file], value: '' } });
      setTimeout(resolve, 800);
    });

    const p2 = current();
    return {
      poolSize,
      restoredLayerCount: p2 ? p2.layers.length : 0,
      restoredLensMatchOriginal:
        p2 && p2.layers.every((l, i) => l.src.length === (i === 2 ? patternSrcs[0] : patternSrcs[i]).length),
    };
  });

  // 3 image uses (2 distinct patterns + 1 reuse) dedup to at most 2 pooled assets.
  expect(result.poolSize).toBeLessThanOrEqual(2);
  expect(result.restoredLayerCount).toBe(3);
  expect(result.restoredLensMatchOriginal).toBe(true);
});

test('loading an old-format .ppages file (no assetPool) restores plain embedded images', async ({ page }) => {
  page.on('dialog', (d) => d.accept());

  const result = await page.evaluate(async () => {
    const oldFormat = {
      app: 'Pattern Pages',
      version: 'v183-real-ppages-save',
      pages: [{ type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 50, h: 50, z: 1 }] }],
      selectedPage: 0,
      trays: { pattern: [], asset: [] },
      zoom: 1,
      leftHanded: false,
      leftCollapsed: false,
      rightCollapsed: false,
    };
    const file = new File([JSON.stringify(oldFormat)], 'old.ppages', { type: 'application/x-ppages' });
    state.pages = [];
    await new Promise((resolve) => {
      window.loadPstudioFile({ target: { files: [file], value: '' } });
      setTimeout(resolve, 400);
    });
    const p = current();
    return { pagesCount: state.pages.length, layerSrc: p && p.layers[0] ? p.layers[0].src : null };
  });

  expect(result.pagesCount).toBe(1);
  expect(result.layerSrc).toBe('data:image/png;base64,AAAA');
});

test('loading a fresh .ppages project file restores its pages and layers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    save();
    addText('text');
    const projectJson = JSON.stringify({
      app: 'Pattern Pages',
      pages: [{ type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'text', text: 'Loaded Layer', name: 'loaded text', x: 10, y: 10, w: 40, h: 20, z: 1 }] }],
      selectedPage: 0,
      trays: { pattern: [], asset: [] },
    });
    const file = new File([projectJson], 'test-load.ppages', { type: 'application/octet-stream' });
    await new Promise((resolve) => {
      window.loadPstudioFile({ target: { files: [file], value: '' } });
      setTimeout(resolve, 500);
    });
    const p = current();
    return { pagesCount: state.pages.length, layerCount: p ? p.layers.length : 0, firstLayerName: p && p.layers[0] ? p.layers[0].name : null };
  });

  expect(result.pagesCount).toBe(1);
  expect(result.layerCount).toBe(1);
  expect(result.firstLayerName).toBe('loaded text');
});

test('quick save overwrites the same in-browser slot instead of creating new downloads', async ({ page }) => {
  // A web page can never overwrite an arbitrary file on disk (a real browser security boundary),
  // so every "save .ppages" is necessarily a new download - the request behind quick save was
  // exactly to avoid that pile-up. It keeps the project entirely inside this browser's own
  // IndexedDB storage (the same store autosave already uses, under its own key), so hitting it
  // repeatedly always overwrites the same slot.
  await page.evaluate(() => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    l.text = 'first version';
    render();
  });

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      window.quickSaveProject();
      setTimeout(resolve, 300);
    });
  });

  await page.evaluate(() => {
    save();
    current().layers[current().layers.length - 1].text = 'second version';
    render();
  });

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      window.quickSaveProject();
      setTimeout(resolve, 300);
    });
  });

  // Clear live state, then quick load - should come back with the SECOND (overwritten) version,
  // not the first, and not both (proving it's one slot, not an accumulating list).
  await page.evaluate(() => {
    state.pages = [{ type: 'listing', w: 3000, h: 2250, layers: [] }];
    state.selectedPage = 0;
    render();
  });

  await page.evaluate(() => window.quickLoadProject());
  await expect
    .poll(() => page.evaluate(() => current().layers.some((l) => l.text === 'second version')))
    .toBe(true);

  const hasFirst = await page.evaluate(() => current().layers.some((l) => l.text === 'first version'));
  expect(hasFirst).toBe(false);
});

test('quick load without a prior quick save shows a clear message, no crash', async ({ page }) => {
  let alertMsg = null;
  page.on('dialog', async (d) => {
    alertMsg = d.message();
    await d.accept();
  });
  // A fresh test page has no quick save yet (each test gets a clean IndexedDB).
  await page.evaluate(() => window.quickLoadProject());
  await expect.poll(() => alertMsg).toBe('No quick save found yet.');
});

test('downloadBlob opens its link in a new tab, never navigating the app away', async ({ page }) => {
  // Real report: downloading a PDF opened it in the SAME tab (Safari previewing a PDF blob
  // instead of honoring the download attribute), replacing the app entirely with no way back.
  // target=_blank is a no-op when the browser actually downloads the file (no navigation
  // happens either way), but keeps the app tab alive on the rarer path where a browser
  // insists on opening/previewing the content instead.
  const target = await page.evaluate(() => {
    let captured = null;
    const origAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
      if (node && node.tagName === 'A' && node.download) captured = node.target;
      return origAppend.call(this, node);
    };
    window.downloadBlob(new Blob(['hello'], { type: 'text/plain' }), 'test.txt');
    Node.prototype.appendChild = origAppend;
    return captured;
  });
  expect(target).toBe('_blank');
});
