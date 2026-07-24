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
