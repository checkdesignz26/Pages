// Layer panel and canvas selection: the layer list renders, clicking a row or a canvas layer
// selects it, duplicate/copy tools work, and renaming a layer sticks. selectLayer in
// particular went through many superseded generations during cleanup (Phase 0, 24/N) - this
// exercises the currently-live path end to end rather than calling internals directly.
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

test('adding a text layer renders it in the layer list and canvas selects on click', async ({ page }) => {
  await page.evaluate(() => window.addText('text'));
  await expandAllBoxes(page);

  await expect(page.locator('#layerList > *')).toHaveCount(1);

  await page.click('.stage .layer.text');
  const selected = await page.evaluate(() => state.selected);
  const layerId = await page.evaluate(() => current().layers[0].id);
  expect(selected).toBe(layerId);
});

test('duplicate from the canvas reuse bar adds a copy of the selected layer', async ({ page }) => {
  await page.evaluate(() => window.addText('text'));
  await expandAllBoxes(page);

  await expect(page.locator('#ppLayerReuseBar')).toHaveCount(1);
  const buttons = await page.locator('#ppLayerReuseBar button').allTextContents();
  expect(buttons.join(' ')).toContain('duplicate');

  await page.click('.stage .layer.text');
  const before = await page.evaluate(() => current().layers.length);
  await clickResilient(page, page.locator('#ppLayerReuseBar button:has-text("duplicate")'));
  await expect
    .poll(() => page.evaluate(() => current().layers.length))
    .toBe(before + 1);
});

test('selectLayer selects by id, deselects the previous layer, and row clicks work too', async ({ page }) => {
  await page.evaluate(() => {
    save();
    addText('text');
    addText('text');
  });

  const [id1, id2] = await page.evaluate(() => current().layers.map((l) => l.id));

  await page.evaluate((id) => selectLayer(id), id1);
  await expect(page.locator(`.stage .layer[data-id="${id1}"]`)).toHaveClass(/selected/);

  await page.evaluate((id) => selectLayer(id), id2);
  await expect(page.locator(`.stage .layer[data-id="${id2}"]`)).toHaveClass(/selected/);
  await expect(page.locator(`.stage .layer[data-id="${id1}"]`)).not.toHaveClass(/selected/);

  await page.evaluate(() => renderLayers());
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${id1}"]`));
  expect(await page.evaluate(() => state.selected)).toBe(id1);
});

test('renaming a layer through the prompt-based rename sticks and marks it manually named', async ({ page }) => {
  page.once('dialog', (d) => d.accept('My Custom Layer Name'));

  await page.evaluate(() => {
    save();
    addText('text');
  });
  const id = await page.evaluate(() => current().layers[0].id);
  await page.evaluate((layerId) => renameLayerById(layerId), id);

  const layer = await page.evaluate((layerId) => current().layers.find((l) => l.id === layerId), id);
  expect(layer.name).toBe('My Custom Layer Name');
  expect(layer._manualName).toBe(true);
});
