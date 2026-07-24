// addText/addBadge (each superseded several dead wraps during cleanup - Phase 0, 22/N) and
// the Font Matchmaker's applyGeneratedFontPair (Phase 0, 30/N): both still auto-unlock legacy
// locked text on re-render, and font pairing still applies through the normal text controls.
const { test, expect } = require('../support/fixtures');

test('addText and addBadge create layers, and legacy locked text auto-unlocks on render', async ({ page }) => {
  const result = await page.evaluate(() => {
    save();
    addText('text');
    const p = current();
    const textLayer = p.layers.find((l) => l.type === 'text');

    addBadge('oval');
    const badgeLayer = p.layers.find((l) => l.type === 'label');
    render();

    // Simulate an imported/legacy locked text layer, then confirm the live render/renderPages
    // wrap chain auto-unlocks it.
    textLayer.locked = true;
    textLayer.lockText = true;
    textLayer.name = 'locked text';
    render();
    renderPages();

    return {
      textLayerFound: !!textLayer,
      textNodeFound: !!document.querySelector('.stage .layer.text'),
      badgeLayerFound: !!badgeLayer,
      badgeNodeFound: !!document.querySelector('.stage .layer.label'),
      lockedAfterRerender: textLayer.locked,
      lockTextAfterRerender: textLayer.lockText,
      nameAfterRerender: textLayer.name,
    };
  });

  expect(result.textLayerFound).toBe(true);
  expect(result.textNodeFound).toBe(true);
  expect(result.badgeLayerFound).toBe(true);
  expect(result.badgeNodeFound).toBe(true);
  expect(result.lockedAfterRerender).toBe(false);
  expect(result.lockTextAfterRerender).toBe(false);
  expect(result.nameAfterRerender).toBe('text');
});

test('applyGeneratedFontPair applies the heading font through the normal text controls', async ({ page }) => {
  const result = await page.evaluate(() => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    state.selected = l.id;
    render();
    const ok = applyGeneratedFontPair('Playfair Display', 'Avenir Next');
    return { ok, font: l.font, bold: l.bold };
  });

  expect(result.ok).toBe(true);
  expect(result.font).toBe('Playfair Display');
  expect(result.bold).toBe(true);
});
