// Background texture selection: applyTextureChoice/clearTextureChoice each went through
// several dead generations before the current one (Phase 0, 29/N) - this exercises the live
// path through the real #textureSelect dropdown.
const { test, expect } = require('../support/fixtures');

test('applying and clearing a background texture updates the page and the dropdown', async ({ page }) => {
  await page.evaluate(() => save());

  const target = await page.evaluate(() => {
    const sel = document.getElementById('textureSelect');
    const opts = Array.from(sel.options).map((o) => o.value);
    const t = opts.find((v) => v !== 'none') || opts[0];
    sel.value = t;
    return t;
  });

  await page.evaluate(() => applyTextureChoice());
  const bgAfterApply = await page.evaluate(() => current().backgroundTexture);
  expect(bgAfterApply).toBe(target);

  await page.evaluate(() => clearTextureChoice());
  const bgAfterClear = await page.evaluate(() => current().backgroundTexture);
  const selectValueAfterClear = await page.evaluate(() => document.getElementById('textureSelect').value);
  expect(bgAfterClear).toBe('none');
  expect(selectValueAfterClear).toBe('none');
});

// Real report, from a live customer: a non-white background texture (e.g. Watercolour Paper),
// set via this exact panel and shown correctly live, never showed up in exported PNGs - the page
// just came out plain white where the texture should be. Root cause: renderPageToCanvas has gone
// through several "generations" in this file (see the NOTE near its final reassignment) - an
// earlier one correctly painted the background via drawTextureBackground before drawing layers,
// but a later generation replaced the whole function outright and always filled plain white
// instead, silently dropping that call along with everything else the older generation did.
test('a non-white background texture actually appears in the exported PNG, not just live on screen', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    save();
    const p = current();
    p.w = 200; p.h = 200;
    p.backgroundTexture = 'watercolour-paper';
    render();
    const canvas = await window.renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    // Corner, not centre - the texture's own subtle noise overlay (see drawPaperNoise) can land
    // a dot near the centre and shift that one pixel's exact colour, which isn't the point here.
    const d = ctx.getImageData(2, 2, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  });
  // Watercolour Paper's own base colour (#f7f2e8) - not plain white, and not fully transparent.
  expect(pixel).toEqual([247, 242, 232, 255]);
});
