// Custom font persistence: uploading a font used to only create a blob: URL @font-face rule and
// a dropdown option, both purely in-memory - the font file itself was never part of any saved
// project data. blob: URLs die with the tab that created them, so even within the same session a
// reload lost the font entirely; saving to .ppages, a .ptemplate, or autosave and reloading always
// silently fell back to the default font. registerCustomFont() (a data: URL, not blob:) plus
// customFonts entries on every save/restore snapshot fixes all four paths.
const { test, expect } = require('../support/fixtures');

const TINY_FONT = Buffer.from('AAECAwQFBgcICQ==', 'base64');
// Large enough that its base64 data: URL clears ppDedupeAssetsForSave's 800-char pooling
// threshold, exercising the same asset-pool path a real font file would.
const BIG_FONT = Buffer.alloc(700, 7);

test('uploading a font creates a data: URL @font-face and dropdown option (not blob:)', async ({ page }) => {
  await page.setInputFiles('#fontFile', { name: 'MyBrandFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);

  const info = await page.evaluate(() => {
    const name = Object.keys(window.ppCustomFonts)[0];
    const style = document.querySelector(`style[data-custom-font="${name}"]`);
    const opt = [...document.getElementById('fontFamily').options].find((o) => o.value === name);
    return {
      name,
      dataUrl: window.ppCustomFonts[name],
      styleText: style ? style.textContent : null,
      hasOption: !!opt,
      selectedValue: document.getElementById('fontFamily').value,
    };
  });

  expect(info.name).toContain('MyBrandFont');
  expect(info.dataUrl).toMatch(/^data:/);
  expect(info.styleText).toContain('@font-face');
  expect(info.styleText).toContain(info.dataUrl);
  expect(info.hasOption).toBe(true);
  expect(info.selectedValue).toBe(info.name);
});

test('a custom font survives save .ppages -> load .ppages', async ({ page }) => {
  await page.setInputFiles('#fontFile', { name: 'ShopFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);

  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  await page.evaluate((name) => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    l.font = name;
    render();
  }, fontName);

  // Save via the real function (capturing the Blob instead of letting the browser download it).
  const projectJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPstudio();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = orig;
    return await captured.text();
  });

  const saved = JSON.parse(projectJson);
  // ppDedupeAssetsForSave only pools data: strings over 800 chars, so this test's tiny font
  // stays inline - either way, customFonts must survive the save (real fonts are much larger and
  // would go through the assetPool -> ppasset: reference path, which ppExpandAssetsFromLoad
  // already reverses generically for any string field, fonts included).
  expect(saved.customFonts && saved.customFonts[fontName]).toBeTruthy();

  // Simulate a truly fresh session: forget the in-memory registry and remove the @font-face/
  // dropdown option entirely, then load the saved file back through the real load function.
  await page.evaluate(() => {
    window.ppCustomFonts = {};
    document.querySelectorAll('style[data-custom-font]').forEach((s) => s.remove());
    const sel = document.getElementById('fontFamily');
    [...sel.options].forEach((o) => {
      if (o.value.startsWith('Custom ')) o.remove();
    });
  });

  await page.evaluate(async (json) => {
    const file = new File([json], 'test.ppages', { type: 'application/octet-stream' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('pstudioLoader');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
  }, projectJson);

  await expect.poll(() => page.evaluate((name) => !!window.ppCustomFonts[name], fontName)).toBe(true);

  const restored = await page.evaluate((name) => {
    const style = document.querySelector(`style[data-custom-font="${name}"]`);
    const opt = [...document.getElementById('fontFamily').options].find((o) => o.value === name);
    const layer = state.pages.flatMap((p) => p.layers || []).find((l) => l.font === name);
    return { hasStyle: !!style, hasOption: !!opt, layerFound: !!layer };
  }, fontName);

  expect(restored.hasStyle).toBe(true);
  expect(restored.hasOption).toBe(true);
  expect(restored.layerFound).toBe(true);
});

test('a realistically-sized custom font goes through the asset-pool dedup path and back', async ({ page }) => {
  await page.setInputFiles('#fontFile', { name: 'RealFont.ttf', mimeType: 'font/ttf', buffer: BIG_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);
  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  const originalDataUrl = await page.evaluate((name) => window.ppCustomFonts[name], fontName);
  expect(originalDataUrl.length).toBeGreaterThan(800);

  const projectJson = await page.evaluate(async () => {
    const orig = URL.createObjectURL;
    let captured = null;
    URL.createObjectURL = function (blob) {
      captured = blob;
      return orig.call(URL, blob);
    };
    window.downloadPstudio();
    await new Promise((r) => setTimeout(r, 50));
    document.getElementById('ppSaveAsConfirm').click();
    await new Promise((r) => setTimeout(r, 50));
    URL.createObjectURL = orig;
    return await captured.text();
  });

  const saved = JSON.parse(projectJson);
  // Actually pooled this time: the customFonts entry is a short ppasset: reference, not the
  // literal (800+ char) data URL, and the real bytes live in assetPool instead.
  expect(saved.customFonts[fontName]).toMatch(/^ppasset:/);
  expect(Object.values(saved.assetPool || {})).toContain(originalDataUrl);

  await page.evaluate(() => {
    window.ppCustomFonts = {};
    document.querySelectorAll('style[data-custom-font]').forEach((s) => s.remove());
  });

  await page.evaluate(async (json) => {
    const file = new File([json], 'test.ppages', { type: 'application/octet-stream' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('pstudioLoader');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
  }, projectJson);

  await expect.poll(() => page.evaluate((name) => window.ppCustomFonts && window.ppCustomFonts[name], fontName)).toBe(
    originalDataUrl
  );
});

test('a custom font survives save template -> load template', async ({ page }) => {
  await page.setInputFiles('#fontFile', { name: 'TemplateFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);

  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  await page.evaluate((name) => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    l.font = name;
    l.isPlaceholder = true;
    l.templatePlaceholder = true;
    render();
  }, fontName);

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

  const saved = JSON.parse(templateJson);
  expect(saved.customFonts && saved.customFonts[fontName]).toMatch(/^data:/);

  await page.evaluate(() => {
    window.ppCustomFonts = {};
    document.querySelectorAll('style[data-custom-font]').forEach((s) => s.remove());
  });

  await page.evaluate((json) => {
    const file = new File([json], 'test.ptemplate', { type: 'application/json' });
    window.loadPatternPagesTemplate({ target: { files: [file], value: '' } });
  }, templateJson);

  await expect.poll(() => page.evaluate((name) => !!window.ppCustomFonts[name], fontName)).toBe(true);
  const hasStyle = await page.evaluate(
    (name) => !!document.querySelector(`style[data-custom-font="${name}"]`),
    fontName
  );
  expect(hasStyle).toBe(true);
});

test('a custom font survives auto-save -> restore autosave', async ({ page }) => {
  await page.setInputFiles('#fontFile', { name: 'AutoSaveFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);

  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  await page.evaluate((name) => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    l.font = name;
    render();
  }, fontName);

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const ok = window.saveAutoSaveNow(true);
      if (!ok) return resolve();
      setTimeout(resolve, 300);
    });
  });

  await page.evaluate(() => {
    window.ppCustomFonts = {};
    document.querySelectorAll('style[data-custom-font]').forEach((s) => s.remove());
  });

  await page.evaluate(() => window.restoreAutoSave());
  await expect.poll(() => page.evaluate((name) => !!window.ppCustomFonts[name], fontName)).toBe(true);
  const hasStyle = await page.evaluate(
    (name) => !!document.querySelector(`style[data-custom-font="${name}"]`),
    fontName
  );
  expect(hasStyle).toBe(true);
});
