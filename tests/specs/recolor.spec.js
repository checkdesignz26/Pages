// Recolor PNG panel: swap a source colour for a target colour on a selected image, live on the
// canvas layer as the user picks colours, then add the result to Design Assets or download it.
// pp-recolor-png-restored-js defines the initial ppRecolor* generation; pp-recolor-live-canvas-fix-js
// unconditionally overwrites ppRecolorRender/ppRecolorUseSelected/ppRecolorAutoDetect with a live,
// debounced version that DOM-patches the selected layer's <img> directly instead of calling
// render() - this test exercises that live generation through the same globals the panel's
// buttons call (ppRecolorUseSelected/ppRecolorSwapColours/ppRecolorAddToAssets/ppRecolorDownload),
// not internals, so it stays correct regardless of which generation is "the" implementation.
const { test, expect } = require('../support/fixtures');

function redSquareDataUrl(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png');
  });
}

test('selecting an image layer and using it loads it into the recolor panel', async ({ page }) => {
  const src = await redSquareDataUrl(page);
  const result = await page.evaluate(async (src) => {
    save();
    state.trays.asset = [{ src, name: 'logo.png' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 100));
    const p = current();
    const l = p.layers.find((x) => x.type === 'image');
    state.selected = l.id;
    render();

    window.ppRecolorUseSelected();
    await new Promise((r) => setTimeout(r, 250));

    return {
      liveLayerId: window.PPRecolorPNG.liveLayerId,
      layerId: l.id,
      pillText: document.getElementById('recolorSourcePill').textContent,
      pillEmpty: document.getElementById('recolorSourcePill').classList.contains('empty'),
    };
  }, src);

  expect(result.liveLayerId).toBe(result.layerId);
  expect(result.pillEmpty).toBe(false);
  expect(result.pillText).toContain('.png');
});

test('changing colours live-recolors the selected canvas layer, and swap exchanges the two pickers', async ({ page }) => {
  const src = await redSquareDataUrl(page);
  const result = await page.evaluate(async (src) => {
    save();
    state.trays.asset = [{ src, name: 'logo.png' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 100));
    const p = current();
    const l = p.layers.find((x) => x.type === 'image');
    state.selected = l.id;
    render();

    window.ppRecolorUseSelected();
    await new Promise((r) => setTimeout(r, 250));
    const originalSrc = l.src;

    document.getElementById('recolorFromColor').value = '#ff0000';
    document.getElementById('recolorToColor').value = '#0000ff';
    window.ppRecolorRender(true);
    await new Promise((r) => setTimeout(r, 250));

    const recoloredSrc = current().layers.find((x) => x.id === l.id).src;

    window.ppRecolorSwapColours();
    await new Promise((r) => setTimeout(r, 250));

    return {
      originalSrc,
      recoloredSrc,
      changed: recoloredSrc !== originalSrc,
      fromAfterSwap: document.getElementById('recolorFromColor').value,
      toAfterSwap: document.getElementById('recolorToColor').value,
    };
  }, src);

  expect(result.changed).toBe(true);
  expect(result.recoloredSrc.startsWith('data:image/png')).toBe(true);
  expect(result.fromAfterSwap).toBe('#0000ff');
  expect(result.toAfterSwap).toBe('#ff0000');
});

test('add to assets pushes the recoloured PNG into the Design Assets tray', async ({ page }) => {
  const src = await redSquareDataUrl(page);
  const result = await page.evaluate(async (src) => {
    save();
    state.trays.asset = [{ src, name: 'logo.png' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 100));
    const l = current().layers.find((x) => x.type === 'image');
    state.selected = l.id;
    render();

    window.ppRecolorUseSelected();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('recolorFromColor').value = '#ff0000';
    document.getElementById('recolorToColor').value = '#00ff00';
    window.ppRecolorRender(true);
    await new Promise((r) => setTimeout(r, 250));

    const before = state.trays.asset.length;
    window.ppRecolorAddToAssets();

    return {
      before,
      after: state.trays.asset.length,
      selectedAssetIndex: state.selectedTray.asset,
      lastAssetHasSrc: !!state.trays.asset[state.trays.asset.length - 1].src,
    };
  }, src);

  expect(result.after).toBe(result.before + 1);
  expect(result.selectedAssetIndex).toBe(result.after - 1);
  expect(result.lastAssetHasSrc).toBe(true);
});

test('download recoloured png creates and clicks a download link without throwing', async ({ page }) => {
  const src = await redSquareDataUrl(page);
  const result = await page.evaluate(async (src) => {
    save();
    state.trays.asset = [{ src, name: 'logo.png' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 100));
    const l = current().layers.find((x) => x.type === 'image');
    state.selected = l.id;
    render();

    window.ppRecolorUseSelected();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('recolorFromColor').value = '#ff0000';
    document.getElementById('recolorToColor').value = '#00ff00';
    window.ppRecolorRender(true);
    await new Promise((r) => setTimeout(r, 250));

    let clicked = false;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked = true; };
    try {
      window.ppRecolorDownload();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }

    return {
      clicked,
      statusText: document.getElementById('recolorPngStatus').textContent,
    };
  }, src);

  expect(result.clicked).toBe(true);
  expect(result.statusText).toContain('Downloaded');
});
