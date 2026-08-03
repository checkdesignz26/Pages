// Custom font persistence: uploading a font used to only create a blob: URL @font-face rule and
// a dropdown option, both purely in-memory - the font file itself was never part of any saved
// project data. blob: URLs die with the tab that created them, so even within the same session a
// reload lost the font entirely; saving to .ppages, a .ptemplate, or autosave and reloading always
// silently fell back to the default font. registerCustomFont() (a data: URL, not blob:) plus
// customFonts entries on every save/restore snapshot fixes all four paths.
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

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

test('uploading a new font while editing a document applies it to the selected document text', async ({ page }) => {
  // Real bug report: a seller selected the title inside a document page and uploaded a custom
  // font for it. Live in the editor the dropdown updated correctly, but the font was never
  // actually applied to the document's own HTML - importFont() always called
  // applyTextControls(), which only ever acts on a selected LAYER (getLayer()). Editing a
  // document leaves state.selected null, so that call silently did nothing; the document's font
  // application instead goes through a separate execCommand('fontName', ...) path keyed off
  // whichever editor is currently focused. Since nothing was ever written into the document's
  // docHtml, saving and reloading correctly reproduced... the untouched default font, because
  // there was never anything else to restore. Fixed by dispatching a real 'change' event on the
  // font dropdown after registering the font, routing through whichever context (document editor
  // or selected layer) is actually active - exactly like manually picking a font already does.
  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForSelector('.documentEditor');

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const h1 = ed.querySelector('h1');
    const r = document.createRange();
    r.selectNodeContents(h1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  await page.setInputFiles('#fontFile', { name: 'TitleFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);

  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  const docHtml = await page.evaluate(() => state.pages[state.selectedPage].docHtml);
  expect(docHtml).toContain(fontName);
  expect(docHtml).not.toBe('<h1>Title</h1><p>Start writing here…</p>');
});

test('the font dropdown refreshes to match each new document selection (not stuck on the last pick)', async ({ page }) => {
  // Real bug report: after applying a custom font to one piece of text, selecting a DIFFERENT
  // piece of text (with a different actual font) and picking that same custom font again did
  // nothing - the workaround was picking some other font first, then picking the custom one
  // again. Root cause: syncPanel() (which runs on every tap/keystroke in a document editor)
  // refreshed fontSize/letterSpacing/lineHeight but never fontFamily, so the dropdown just kept
  // showing whatever was last picked anywhere, never reflecting the new selection's real font.
  // Re-picking that already-displayed value fires no 'change' event (the <select>'s value never
  // actually changes), so nothing applied.
  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForSelector('.documentEditor');

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const h1 = ed.querySelector('h1');
    const r = document.createRange();
    r.selectNodeContents(h1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.setInputFiles('#fontFile', { name: 'TitleFont.ttf', mimeType: 'font/ttf', buffer: TINY_FONT });
  await expect.poll(() => page.evaluate(() => Object.keys(window.ppCustomFonts || {}).length)).toBeGreaterThan(0);
  const fontName = await page.evaluate(() => Object.keys(window.ppCustomFonts)[0]);
  expect(await page.evaluate(() => document.getElementById('fontFamily').value)).toBe(fontName);

  // The body paragraph starts genuinely empty now (just a CSS placeholder, not real text) -
  // give it some real text directly (this test isn't about typing, just about having some
  // differently-styled real text available to select), then move the selection there via a
  // real interaction, the same way a tap/click does in the real app.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const p = ed.querySelector('p');
    p.textContent = 'Body text';
  });
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const p = ed.querySelector('p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    ed.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(50);

  const ffAfterMove = await page.evaluate(() => document.getElementById('fontFamily').value);
  expect(ffAfterMove).not.toBe(fontName);

  // Now pick the custom font for this new selection - a real 'change' fires because the dropdown
  // correctly reset first, so this must actually apply this time.
  await page.evaluate((name) => {
    const sel = document.getElementById('fontFamily');
    sel.value = name;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, fontName);

  const docHtml = await page.evaluate(() => state.pages[state.selectedPage].docHtml);
  const paragraphHtml = docHtml.match(/<p[^>]*>[\s\S]*?<\/p>/)[0];
  expect(paragraphHtml).toContain(fontName);
});

test('switching fonts clears a stale nested font-family instead of leaving it winning', async ({ page }) => {
  // Couldn't reproduce the reported "can switch to custom but not to standard/handwritten fonts"
  // failure directly in Chromium (both directions applied cleanly in the two tests above) - this
  // points to a WebKit/iOS Safari-specific execCommand('fontName') quirk: some engines can nest a
  // NEW font-family span around text that's already wrapped in an OLDER one from a previous
  // choice, instead of replacing it - the older, more deeply nested declaration then keeps
  // winning via ordinary CSS inheritance even though a different font was just "applied". This
  // constructs that exact stale-nesting scenario directly (since Chromium won't produce it on its
  // own) to verify exec()'s cleanup pass actually resolves the conflict regardless of engine
  // behavior: it strips any font-family left inside the selection that isn't the one just picked.
  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForSelector('.documentEditor');

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const h1 = ed.querySelector('h1');
    h1.innerHTML = '<span style="font-family: Georgia;"><span style="font-family: \'Custom OldFont\';">Title</span></span>';
    const r = document.createRange();
    r.selectNodeContents(h1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  await page.selectOption('#fontFamily', 'Impact');
  await page.waitForTimeout(100);

  const html = await page.evaluate(() => document.querySelector('.documentEditor h1').innerHTML);
  expect(html).not.toContain('Custom OldFont');
  const computed = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.documentEditor h1 span') || document.querySelector('.documentEditor h1')).fontFamily
  );
  expect(computed).toContain('Impact');
});

test('switching fonts back and forth repeatedly never gets permanently stuck', async ({ page }) => {
  // Real device report: font switching in document mode worked a couple of times, then got
  // permanently stuck showing whatever font was first applied, no matter what the dropdown
  // said afterward. Root cause, found via a real debug-report capture plus a controlled local
  // repro: restoreRange() calls activeEditor.focus() to bring focus back from a toolbar control
  // (e.g. the font <select>) - if focus had genuinely moved away, that focus() call fires a
  // real, synchronous 'focus' event -> activate() -> rememberRange(), which overwrote the very
  // savedRange this function was about to restore with whatever the browser's own default
  // selection was at that instant (typically collapsed), before the restore ever ran. Every
  // later pick then just restored and reused that same broken collapsed position forever.
  // Separately, the <select> also fired both 'input' and 'change' for a single pick, applying
  // the font twice and nesting a fresh span around the previous one each time.
  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForSelector('.documentEditor');
  await page.evaluate(() => {
    document.getElementById('textStudioPanel').classList.remove('collapsed');
    document.body.classList.remove('rightCollapsed');
  });
  // Let this app's known startup-settling renders (several independent setTimeout(...) calls
  // scattered up to ~1.6s after load, per fixtures.js) finish before interacting - the same
  // real-world delay expandAllBoxes()'s own retry logic exists to tolerate.
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const h1 = document.querySelector('.documentEditor h1');
    const r = document.createRange();
    r.selectNodeContents(h1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    h1.closest('.documentEditor').focus();
  });

  for (let i = 0; i < 6; i++) {
    await page.selectOption('#fontFamily', 'Arial');
    await page.waitForTimeout(80);
    const arial = await page.evaluate(() => document.querySelector('.documentEditor h1').innerHTML);
    expect(arial, `cycle ${i} Arial`).toContain('Arial');
    expect(arial, `cycle ${i} Arial has no runaway nesting`).not.toMatch(/(<span[^>]*>){3,}/);

    await page.selectOption('#fontFamily', 'Georgia');
    await page.waitForTimeout(80);
    const georgia = await page.evaluate(() => document.querySelector('.documentEditor h1').innerHTML);
    expect(georgia, `cycle ${i} Georgia`).toContain('Georgia');
    expect(georgia, `cycle ${i} Georgia has no runaway nesting`).not.toMatch(/(<span[^>]*>){3,}/);
  }

  const finalText = await page.evaluate(() => document.querySelector('.documentEditor h1').textContent);
  expect(finalText).toBe('Title');
});
