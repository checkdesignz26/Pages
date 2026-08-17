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

test('toggling wide panel mode actually grows the layer list', async ({ page }) => {
  // pp-expandable-layers-panel-v101-css's wide-mode rule used to target `.layerList` (2 classes:
  // body.ppLayersWide .layerList), which always lost to a bare `#layerList{max-height:390px}`
  // id selector elsewhere in the file (an id beats any number of classes, regardless of source
  // order) - toggling "wide panel" silently never changed the list's height. Retargeted to
  // `#layerList` so it can win.
  const before = await page.evaluate(() => getComputedStyle(document.getElementById('layerList')).maxHeight);
  await page.evaluate(() => window.ppToggleLayersPanelWide());
  const after = await page.evaluate(() => getComputedStyle(document.getElementById('layerList')).maxHeight);

  expect(before).toBe('390px');
  expect(after).toBe('440px');
});

// Real request: group/select multiple layers so a badge and its label can be moved together
// instead of separately. Multi-select/group/ungroup (toggleLayerMultiSelect, groupSelectedLayers,
// ungroupSelected) already existed at the data level but had been held back post-launch (hidden
// via CSS + a repeating JS hider), and turned out to be genuinely broken once actually exercised:
// a group layer rendered as a bare Comment node, which crashed the first render() a later script
// (applyStack, added after grouping and never tested against it) tried to run against it -
// changed to an inert-but-real element instead. Separately, the row generator that's actually
// live today (rowForLayerV170, added after grouping and also never updated for it) had no
// checkbox UI at all, and the document-level tap handler unconditionally single-selected +
// cleared multi-select mode on every row tap, defeating it entirely even with the toolbar
// visible. Fixed both. This exercises the whole flow through the real UI, not by calling the
// underlying functions directly, since that's exactly the level every one of those gaps lived at.
test('grouping two layers via the layer panel lets them be dragged together, then splits apart again on ungroup', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('text'); addBadge('oval'); });
  await page.waitForTimeout(1800); // let the layer-panel boot()/re-render timers settle first

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));

  await expect(page.locator('#groupSelectedBtn')).toBeEnabled();
  await clickResilient(page, page.locator('#groupSelectedBtn'));

  const afterGroup = await page.evaluate(() => current().layers.map((l) => ({ type: l.type, groupId: l.groupId })));
  expect(afterGroup.filter((l) => l.type === 'group')).toHaveLength(1);
  expect(afterGroup.filter((l) => l.groupId)).toHaveLength(2);

  await page.waitForTimeout(300); // let drawManualGroups()'s 60ms-delayed overlay draw settle
  const overlay = page.locator('.manualGroupOverlay');
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();

  const before = await page.evaluate(() => current().layers.filter((l) => l.groupId).map((l) => ({ id: l.id, x: l.x, y: l.y })));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => current().layers.filter((l) => l.groupId).map((l) => ({ id: l.id, x: l.x, y: l.y })));

  // Both members should have moved by roughly the same delta - dragged together, not separately.
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    expect(a.x - b.x).toBeGreaterThan(4);
    expect(a.y - b.y).toBeGreaterThan(2);
  }
  const dxs = before.map((b) => after.find((a) => a.id === b.id).x - b.x);
  expect(Math.abs(dxs[0] - dxs[1])).toBeLessThan(0.5);

  await expect(page.locator('#ungroupBtn')).toBeEnabled();
  await clickResilient(page, page.locator('#ungroupBtn'));
  const afterUngroup = await page.evaluate(() => current().layers.map((l) => ({ type: l.type, groupId: l.groupId })));
  expect(afterUngroup.some((l) => l.type === 'group')).toBe(false);
  expect(afterUngroup.every((l) => !l.groupId)).toBe(true);
});

// Real request: a lock so a layer can't be accidentally moved while working around it on the
// canvas, separate from grouping. Deliberately its own new flag (l.positionLocked) rather than
// the existing l.locked/l.lockText - those get force-cleared to false on every render() for any
// text/label layer (a legacy migration for old files that got stuck permanently locked), which
// would silently undo a lock on a text layer or badge the moment anything else on the page
// re-rendered.
test('locking a layer blocks dragging and deleting it, until unlocked', async ({ page }) => {
  await expandAllBoxes(page);
  const id = await page.evaluate(() => { addText('text'); return current().layers[0].id; });
  await page.waitForTimeout(1800);

  const lockBtn = page.locator('#layerList .lockBtn').first();
  await clickResilient(page, lockBtn);
  const afterLock = await page.evaluate((layerId) => ({
    dataLocked: current().layers.find((l) => l.id === layerId).positionLocked,
    canvasClass: document.querySelector(`.layer[data-id="${layerId}"]`).classList.contains('positionLocked'),
  }), id);
  expect(afterLock.dataLocked).toBe(true);
  expect(afterLock.canvasClass).toBe(true);

  const before = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y };
  }, id);
  const box = await page.locator(`.layer[data-id="${id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterDragAttempt = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y, selected: state.selected };
  }, id);
  expect(afterDragAttempt.x).toBe(before.x);
  expect(afterDragAttempt.y).toBe(before.y);
  expect(afterDragAttempt.selected).not.toBe(id);

  page.once('dialog', (dialog) => dialog.accept());
  await clickResilient(page, page.locator('#layerList .deleteLayerBtn').first());
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => current().layers.length)).toBe(1);

  await clickResilient(page, lockBtn);
  expect(await page.evaluate((layerId) => current().layers.find((l) => l.id === layerId).positionLocked, id)).toBe(false);
  await page.waitForTimeout(150);

  const box2 = await page.locator(`.layer[data-id="${id}"]`).boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2 + 80, box2.y + box2.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterUnlockDrag = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y };
  }, id);
  expect(afterUnlockDrag.x).not.toBe(before.x);
});
