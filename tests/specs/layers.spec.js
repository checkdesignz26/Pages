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

test('toggling wide panel mode never re-caps the layer list height', async ({ page }) => {
  // pp-expandable-layers-panel-v101-css's wide-mode rule used to target `.layerList` (2 classes:
  // body.ppLayersWide .layerList), which always lost to a bare `#layerList{max-height:390px}`
  // id selector elsewhere in the file (an id beats any number of classes, regardless of source
  // order) - toggling "wide panel" silently never changed the list's height. That whole cap was
  // later removed outright (see pp-layer-list-full-display-css, and the "with many layers, the
  // list grows to fit them all" test above) - with enough layers, a fixed-height nested scroll
  // container was unreachable on a touch device, the same class of bug already fixed once for
  // the pattern/asset trays. Confirms wide mode doesn't reintroduce a cap of its own.
  const before = await page.evaluate(() => getComputedStyle(document.getElementById('layerList')).maxHeight);
  await page.evaluate(() => window.ppToggleLayersPanelWide());
  const after = await page.evaluate(() => getComputedStyle(document.getElementById('layerList')).maxHeight);

  expect(before).toBe('none');
  expect(after).toBe('none');
});

// Real report: the wide-panel toggle button's own visible text used to name the OTHER mode -
// the mode clicking it switches TO - while the hint text right next to it names the CURRENT
// mode ("Normal mode: compact layer list." sitting next to a button reading "wide panel").
// Read together, "wide panel" looked like it was describing what's on screen right now, when
// the panel was actually narrow. The button now names whichever mode is actually active,
// matching the hint's own convention.
//
// Follow-up beta-tester feedback: "normal" was renamed to "default" throughout (button text,
// title, hint), since that's clearer for the panel's un-widened starting state.
test('the wide/default panel button names the mode that is actually active, not the other one', async ({ page }) => {
  const initial = await page.evaluate(() => ({
    isWide: document.body.classList.contains('ppLayersWide'),
    btnText: document.getElementById('ppLayerPanelWideToggle')?.textContent,
  }));
  expect(initial.isWide).toBe(false);
  expect(initial.btnText).toBe('default panel');

  await page.evaluate(() => window.ppToggleLayersPanelWide());
  const afterToggle = await page.evaluate(() => ({
    isWide: document.body.classList.contains('ppLayersWide'),
    btnText: document.getElementById('ppLayerPanelWideToggle')?.textContent,
  }));
  expect(afterToggle.isWide).toBe(true);
  expect(afterToggle.btnText).toBe('wide panel');
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

// Real report: "you can't close the group layer". Two independent, unrelated bugs stacked to
// silently swallow every tap on a group row's collapse/expand arrow (a <span class="dragGrip">,
// not a <button>):
// 1. The touch-friendly layer-panel reorder patch (pp-layer-panel-touch-drag-patch) treated any
//    tap that landed exactly on a .dragGrip as the start of a drag-to-reorder gesture and called
//    preventDefault()/stopPropagation() on the pointerdown - which suppresses the browser's
//    follow-up synthetic click entirely - without checking whether the row was even draggable
//    (group rows aren't; their grip is the collapse toggle, not a reorder handle).
// 2. Even with that fixed, a much older document-level CAPTURE-phase click listener ("v169 layer
//    panel selection sync surgery") ran before the grip's own click listener ever got a chance -
//    its own exclusion list only checked for real <button> elements, missed the grip <span>
//    entirely, and called stopPropagation() + selectLayer() instead, re-rendering the row (and
//    replacing the grip DOM node) out from under the gesture before the real toggle could run.
test('collapsing and expanding a group via its row arrow actually works', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('text'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  await expect(page.locator('#layerList .childLayerRow')).toHaveCount(2);

  const grip = page.locator('#layerList .layerItem.groupRow .dragGrip').first();
  await expect(grip).toHaveText('▼');
  await clickResilient(page, grip);
  await page.waitForTimeout(200);

  await expect(page.locator('#layerList .childLayerRow')).toHaveCount(0);
  await expect(page.locator('#layerList .layerItem.groupRow .dragGrip').first()).toHaveText('▶');

  await clickResilient(page, page.locator('#layerList .layerItem.groupRow .dragGrip').first());
  await page.waitForTimeout(200);

  await expect(page.locator('#layerList .childLayerRow')).toHaveCount(2);
  await expect(page.locator('#layerList .layerItem.groupRow .dragGrip').first()).toHaveText('▼');
});

// Real report: grouped two layers, tapped "duplicate", and the copy was invisible - nothing
// changed on the page the group was copied from. A group is a synthetic, invisible
// (display:none) organizational layer; its actual visible content lives in separate member
// layers tagged with a matching groupId. duplicateSelected() only deep-cloned whatever single
// layer was selected - for a group, that's just the invisible wrapper, so the "copy" had zero
// members and nothing to draw, while the real content (the member layers) never got duplicated
// at all.
test('duplicating a selected group copies its member layers too, not just the invisible group wrapper', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('text'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));

  const beforeDup = await page.evaluate(() => ({
    total: current().layers.length,
    groupId: state.selected,
    members: current().layers.filter((l) => l.groupId === state.selected).map((l) => ({ type: l.type, x: l.x, y: l.y })),
  }));
  expect(beforeDup.members).toHaveLength(2);

  await page.evaluate(() => { window.duplicateSelected(); });
  await page.waitForTimeout(200);

  const afterDup = await page.evaluate((oldGroupId) => {
    const layers = current().layers;
    const newGroupId = state.selected;
    return {
      total: layers.length,
      newGroupId,
      changedSelection: newGroupId !== oldGroupId,
      newGroupIsGroupType: layers.find((l) => l.id === newGroupId)?.type,
      newMembers: layers.filter((l) => l.groupId === newGroupId).map((l) => ({ type: l.type, x: l.x, y: l.y })),
      oldMembersStillPresent: layers.filter((l) => l.groupId === oldGroupId).length,
    };
  }, beforeDup.groupId);

  // One new group layer + two new member layers.
  expect(afterDup.total).toBe(beforeDup.total + 3);
  expect(afterDup.changedSelection).toBe(true);
  expect(afterDup.newGroupIsGroupType).toBe('group');
  expect(afterDup.oldMembersStillPresent).toBe(2);
  expect(afterDup.newMembers).toHaveLength(2);
  const newTypes = afterDup.newMembers.map((m) => m.type).sort();
  const oldTypes = beforeDup.members.map((m) => m.type).sort();
  expect(newTypes).toEqual(oldTypes);
  // Copies land offset from the originals, matching the existing single-layer duplicate offset.
  for (const nm of afterDup.newMembers) {
    const original = beforeDup.members.find((m) => m.type === nm.type);
    expect(nm.x).toBeCloseTo(original.x + 3, 1);
    expect(nm.y).toBeCloseTo(original.y + 3, 1);
  }
});

// Real report, with a screenshot: grouped two layers, tapped "duplicate" on the canvas reuse
// bar (a SEPARATE implementation from the layer panel's own duplicateSelected(), fixed above),
// and the copy was empty again - the reuse bar's ppDuplicateSelectedLayer() had the identical
// bug, cloning only the invisible group wrapper via a completely separate insertLayer() helper
// that had never been made group-aware either.
test('duplicating a group from the canvas reuse bar also copies its member layers, not just the wrapper', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('text'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const beforeDup = await page.evaluate(() => ({
    groupId: state.selected,
    memberCount: current().layers.filter((l) => l.groupId === state.selected).length,
  }));
  expect(beforeDup.memberCount).toBe(2);

  await expect(page.locator('#ppLayerReuseBar')).toHaveCount(1);
  await clickResilient(page, page.locator('#ppLayerReuseBar button:has-text("duplicate")'));
  await page.waitForTimeout(300);

  const afterDup = await page.evaluate((oldGroupId) => {
    const newGroupId = state.selected;
    return {
      changedSelection: newGroupId !== oldGroupId,
      newMemberCount: current().layers.filter((l) => l.groupId === newGroupId).length,
      oldMemberCount: current().layers.filter((l) => l.groupId === oldGroupId).length,
    };
  }, beforeDup.groupId);

  expect(afterDup.changedSelection).toBe(true);
  expect(afterDup.newMemberCount).toBe(2);
  expect(afterDup.oldMemberCount).toBe(2);

  // The new group's members must actually render as nested rows in the panel, not just exist
  // in the data model.
  await expect(page.locator('#layerList .childLayerRow')).toHaveCount(4);
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

  // addText() selects the new layer immediately (its real, intended behavior - the drag-attempt
  // assertion below tests that a locked layer can't be newly selected via a canvas tap, which
  // needs a genuinely unselected starting point, not the one addText already left behind).
  await page.evaluate(() => { state.selected = null; render(); });
  await page.waitForTimeout(100);

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

// Real request: lock a whole group at once instead of having to lock every member one at a
// time. Locking now applies positionLocked to every member (so a member's own canvas drag is
// blocked the same way a normal locked layer's is) and to the group's own synthetic layer (so
// the group-drag overlay - a separate interaction path with its own pointerdown handler - also
// refuses to move it).
test('locking a group from its row locks every member, blocks the group-drag overlay, and unlocks them all together', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('text'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const groupId = await page.evaluate(() => state.selected);
  const groupLockBtn = page.locator('#layerList .layerItem.groupRow .lockBtn').first();
  await expect(groupLockBtn).toHaveText('🔓');

  await clickResilient(page, groupLockBtn);
  await page.waitForTimeout(200);

  const afterLock = await page.evaluate((gid) => ({
    memberLocks: current().layers.filter((l) => l.groupId === gid).map((l) => l.positionLocked),
    groupLocked: current().layers.find((l) => l.id === gid).positionLocked,
  }), groupId);
  expect(afterLock.memberLocks).toEqual([true, true]);
  expect(afterLock.groupLocked).toBe(true);
  await expect(groupLockBtn).toHaveText('🔒');

  // The group-drag overlay is a separate interaction path from a single member's own drag -
  // it must independently refuse to move a locked group.
  await page.evaluate((gid) => { state.selected = gid; render(); }, groupId);
  await page.waitForTimeout(300);
  const before = await page.evaluate((gid) => current().layers.filter((l) => l.groupId === gid).map((l) => ({ x: l.x, y: l.y })), groupId);
  const overlay = page.locator('.manualGroupOverlay');
  await expect(overlay).toBeVisible();
  const box = await overlay.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterDragAttempt = await page.evaluate((gid) => current().layers.filter((l) => l.groupId === gid).map((l) => ({ x: l.x, y: l.y })), groupId);
  expect(afterDragAttempt).toEqual(before);

  await clickResilient(page, groupLockBtn);
  await page.waitForTimeout(200);
  const afterUnlock = await page.evaluate((gid) => ({
    memberLocks: current().layers.filter((l) => l.groupId === gid).map((l) => l.positionLocked),
    groupLocked: current().layers.find((l) => l.id === gid).positionLocked,
  }), groupId);
  expect(afterUnlock.memberLocks).toEqual([false, false]);
  expect(afterUnlock.groupLocked).toBe(false);
});

// Real report, with a screen recording: duplicated a group and then couldn't move it at all.
// The duplicate's members happened to be small and close together, so the group-drag overlay's
// bounding box was tiny - but .manualGroupHandle is a fixed 36px square hanging off the
// bottom-right corner (renderManualGroupOverlay's own CSS), so for a small enough group it
// covers the whole overlay and then some. Every pointerdown then lands on
// e.target.closest('.manualGroupHandle') and gets treated as a resize (applyGroupResize)
// instead of a move (applyGroupMove) - there was no area left to grab for a plain drag.
test('a tiny group still has a safe area to drag-move, not just its resize handle', async ({ page }) => {
  const groupId = await page.evaluate(() => {
    const stageRect = document.querySelector('.stage').getBoundingClientRect();
    // Comfortably under the 44px-wide safe-drag threshold, in real rendered pixels.
    const w = (20 / stageRect.width) * 100;
    const h = (20 / stageRect.height) * 100;
    const a = Object.assign(layer('rectangle', { name: 'tiny a', fill: '#ff69b4' }), { x: 40, y: 40, w, h, z: 1 });
    const b = Object.assign(layer('rectangle', { name: 'tiny b', fill: '#69b4ff' }), { x: 40 + w / 2, y: 40 + h / 2, w, h, z: 2 });
    current().layers.push(a, b);
    const gid = uid();
    a.groupId = gid; b.groupId = gid;
    const g = layer('group', { id: gid, name: 'group', x: 0, y: 0, w: 10, h: 10, z: 3, src: null, fit: 'cover' });
    current().layers.push(g);
    updateGroupLayerBounds(g);
    state.selected = gid;
    render();
    return gid;
  });
  await page.waitForTimeout(300);

  const overlay = page.locator('.manualGroupOverlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveClass(/ppTinyGroupOverlay/);
  const box = await overlay.boundingBox();

  const centreHit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.className : null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(centreHit).not.toMatch(/manualGroupHandle/);

  const before = await page.evaluate((gid) => current().layers.filter((l) => l.groupId === gid).map((l) => ({ x: l.x, y: l.y })), groupId);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate((gid) => current().layers.filter((l) => l.groupId === gid).map((l) => ({ x: l.x, y: l.y })), groupId);

  for (let i = 0; i < before.length; i++) {
    expect(after[i].x).toBeGreaterThan(before[i].x);
    expect(after[i].y).toBeGreaterThan(before[i].y);
  }
});

// Real report: a small badge became nearly impossible to just drag and move - almost any tap
// landed on a resize handle instead, moving/resizing it unintentionally. Confirmed directly by
// sampling elementFromPoint() across a shrunk badge's whole box: even its dead center resolved to
// a handle, not the layer itself. Four corner resize handles (added later - see
// pp-doggy-94-selection-rescue-css - superseding an older single bottom-right handle that never
// got cleaned up and, for text/label layers specifically, had an even larger touch-target
// expansion of its own), each with a further +15px invisible touch-target expansion reaching
// inward from every corner, was simply more hit-area than a small layer had room for.
test('a small selected badge still has a safe centre area to drag-move, not just its resize handles', async ({ page }) => {
  const id = await page.evaluate(() => {
    addBadge('circle');
    const l = current().layers[0];
    l.w = 6; l.h = 6; // shrink it down to a genuinely tiny badge
    state.selected = l.id;
    render();
    return l.id;
  });
  await page.waitForTimeout(300);

  const centreHit = await page.evaluate((layerId) => {
    const el = document.querySelector(`.layer[data-id="${layerId}"]`);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit ? hit.className : null;
  }, id);
  expect(centreHit).not.toMatch(/ppResizeHandle|(^|\s)handle(\s|$)/);

  // A drag starting from the centre should move it, not resize it.
  const before = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }, id);
  const box = await page.locator(`.layer[data-id="${id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }, id);

  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);
  expect(after.w).toBe(before.w);
  expect(after.h).toBe(before.h);
});

// Real follow-up report: the fixed -5px handle hit-area above still isn't enough for a
// genuinely tiny layer (a small circular image swatch, ~17px on screen at a normal zoom level) -
// four corners each still reaching 5px inward is enough combined hit-area to cover a box that
// small entirely. A fixed pixel expansion can never work for every layer size, so this checks a
// layer small enough to defeat the earlier fix specifically.
test('an even smaller image layer also keeps a safe centre to drag-move, not just its resize handles', async ({ page }) => {
  const pngSrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff69b4';
    ctx.beginPath(); ctx.arc(20, 20, 18, 0, Math.PI * 2); ctx.fill();
    return c.toDataURL('image/png');
  });

  const id = await page.evaluate((src) => {
    const l = { id: uid(), type: 'image', name: 'tiny swatch', x: 40, y: 40, w: 2, h: 2, z: 1, opacity: 1, r: 0, src, fit: 'contain', aspect: 1 };
    current().layers.push(l);
    state.selected = l.id;
    render();
    return l.id;
  }, pngSrc);
  await page.waitForTimeout(300);

  const centreHit = await page.evaluate((layerId) => {
    const el = document.querySelector(`.layer[data-id="${layerId}"]`);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit ? hit.className : null;
  }, id);
  expect(centreHit).not.toMatch(/ppResizeHandle|(^|\s)handle(\s|$)/);

  const before = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }, id);
  const box = await page.locator(`.layer[data-id="${id}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { x: l.x, y: l.y, w: l.w, h: l.h };
  }, id);

  expect(after.x).not.toBe(before.x);
  expect(after.y).not.toBe(before.y);
  expect(after.w).toBe(before.w);
  expect(after.h).toBe(before.h);

  // The handle itself must still be independently grabbable for an intentional resize.
  const seHandleCentre = await page.evaluate((layerId) => {
    const node = document.querySelector(`.layer[data-id="${layerId}"]`);
    const se = node.querySelector('.ppResizeHandle.se');
    const r = se.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  const beforeResize = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { w: l.w, h: l.h };
  }, id);
  await page.mouse.move(seHandleCentre.x, seHandleCentre.y);
  await page.mouse.down();
  await page.mouse.move(seHandleCentre.x + 30, seHandleCentre.y + 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterResize = await page.evaluate((layerId) => {
    const l = current().layers.find((x) => x.id === layerId);
    return { w: l.w, h: l.h };
  }, id);
  expect(afterResize.w).toBeGreaterThan(beforeResize.w);
  expect(afterResize.h).toBeGreaterThan(beforeResize.h);
});

// Real report, with a screenshot: the "drag corner to resize · <type>" hint pill sat directly on
// top of a small selected showcase image, wrapping across several lines inside a box too small
// to hold it, hiding the actual content. Several earlier patches fought over exactly where/
// whether this hint shows for particular layer types - rather than add yet another type-specific
// carve-out, it's removed everywhere now: a redundant tooltip once you know the corner handles
// resize, not something the resize gesture itself depends on.
test('the "drag corner to resize" hint no longer covers small selected layers of any type', async ({ page }) => {
  const ids = await page.evaluate(() => {
    addText('text');
    addBadge('circle');
    addShape('rectangle');
    return current().layers.map((l) => l.id);
  });

  for (const id of ids) {
    const display = await page.evaluate((layerId) => {
      state.selected = layerId;
      render();
      const node = document.querySelector(`.layer[data-id="${layerId}"]`);
      const hint = node.querySelector('.resizeHint');
      return hint ? getComputedStyle(hint).display : 'no-hint-element';
    }, id);
    expect(display).toBe('none');
  }
});

// Real report: "I can't really drag them where I want them to be" about reordering the layer
// list. Confirmed directly with real touch dispatch: a drag started anywhere on a row's body
// (the name - the natural place to grab a list row, and the only place most people actually try)
// did precisely nothing, because pp-layer-panel-touch-drag-patch's findGripNear() only recognised
// a touch within ~14px of the tiny "⋮⋮" grip icon - and every row already carries
// touch-action:none, so the gesture wasn't even falling back to a native scroll; it was just
// swallowed with no effect. Only a pixel-perfect touch on the small grip ever worked. Fixed by
// also arming a drag from anywhere on the row body (outside its buttons and the grip, which
// already worked), deferred behind a small movement threshold so a plain tap there still just
// selects the layer as before, instead of ever being mistaken for a drag.
test.describe(() => {
  // A plain page.mouse drag doesn't distinguish the fix from the bug here: rows also carry
  // draggable="true" for native HTML5 drag-and-drop (dragstart/dragover/drop, wired further down
  // in rowForLayerV170), and a mouse drag from anywhere on the row already invokes that native
  // path regardless of this patch. Native drag-and-drop doesn't reliably arm from a real
  // touchscreen swipe the way it does from a mouse, though - which is exactly why
  // pp-layer-panel-touch-drag-patch exists, and exactly why its own grip-only hit-testing was the
  // actual bug for the iPad user who reported this. So this needs real touch + pointer dispatch,
  // not a mouse drag, to actually exercise (and tell apart) the code path in question.
  test.use({ hasTouch: true });

  async function installTouchDragHelpers(page) {
    await page.evaluate(() => {
      window.__nextPointerId = 1;
      window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
      window.__fireTouch = (type, touches, changed, target) => {
        target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
      };
    });
  }

  // Dispatches a PointerEvent alongside each TouchEvent, in real device order, matching how an
  // actual touchscreen fires both for the same physical gesture - see text-and-fonts.spec.js.
  async function touchDrag(page, points) {
    const id = await page.evaluate(() => window.__nextPointerId++);
    await page.evaluate(({ x, y, id }) => {
      const el = document.elementFromPoint(x, y);
      const t = window.__mkTouch(id, x, y, el);
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      window.__fireTouch('touchstart', [t], [t], el);
    }, { x: points[0].x, y: points[0].y, id });
    await page.waitForTimeout(30);

    for (let i = 1; i < points.length; i++) {
      await page.evaluate(({ x, y, id }) => {
        const el = document.elementFromPoint(x, y);
        const t = window.__mkTouch(id, x, y, el);
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
        window.__fireTouch('touchmove', [t], [t], el);
      }, { x: points[i].x, y: points[i].y, id });
      await page.waitForTimeout(30);
    }

    const last = points[points.length - 1];
    await page.evaluate(({ x, y, id }) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      window.__fireTouch('touchend', [], [window.__mkTouch(id, x, y, el)], el);
    }, { x: last.x, y: last.y, id });
    await page.waitForTimeout(30);
  }

  test('dragging a layer row by its name, not just the tiny grip icon, reorders it', async ({ page }) => {
    await expandAllBoxes(page);
    await installTouchDragHelpers(page);
    const ids = await page.evaluate(() => {
      ['one', 'two', 'three'].forEach((name) => {
        addText(name);
        const l = current().layers[current().layers.length - 1];
        l.name = name; l._manualName = true;
      });
      return current().layers.filter((l) => l.type === 'text').map((l) => l.id);
    });
    await page.waitForTimeout(300);

    const orderNow = () => page.evaluate(() => current().layers.filter((l) => l.type === 'text').sort((a, b) => (b.z || 0) - (a.z || 0)).map((l) => l.name));
    expect(await orderNow()).toEqual(['three', 'two', 'one']);

    // "one" is the bottom row - drag it up by its name zone (not the grip) to the top.
    const bottomRow = page.locator(`#layerList .layerItem[data-id="${ids[0]}"]`);
    // Re-expand/re-scroll and retry the bounding-box read until it survives a boot()/re-render
    // timer race (matching the established pattern in responsive-layout.spec.js for the same
    // class of flakiness in this app's scattered self-installing patch scripts), rather than a
    // plain locator.scrollIntoViewIfNeeded(), whose own "wait for stable" can throw "not attached
    // to the DOM" if one of those timers replaces the row out from under it.
    let zoneBox = null;
    await expect.poll(async () => {
      await expandAllBoxes(page);
      await page.evaluate((id) => {
        const r = document.querySelector(`#layerList .layerItem[data-id="${id}"]`);
        if (r) r.scrollIntoView({ block: 'center' });
      }, ids[0]);
      zoneBox = await bottomRow.locator('.ppLayerSelectZone').boundingBox();
      return zoneBox;
    }, { timeout: 5000 }).not.toBeNull();
    const topRowBox = await page.locator('#layerList .layerItem[data-id]').first().boundingBox();
    const sx = zoneBox.x + zoneBox.width / 2, sy = zoneBox.y + zoneBox.height / 2;
    const ty = topRowBox.y + topRowBox.height / 2;

    await touchDrag(page, [
      { x: sx, y: sy },
      { x: sx, y: sy - 20 }, // cross the drag-arm threshold first
      { x: sx, y: sy - 60 },
      { x: sx, y: (sy + ty) / 2 },
      { x: sx, y: ty },
    ]);
    await page.waitForTimeout(200);

    expect(await orderNow()).toEqual(['one', 'three', 'two']);
  });

  test('a plain touch tap on a layer row\'s name still just selects it, without the new drag-by-name behaviour mistaking it for a drag', async ({ page }) => {
    await expandAllBoxes(page);
    await installTouchDragHelpers(page);
    const ids = await page.evaluate(() => {
      ['one', 'two'].forEach((name) => {
        addText(name);
        const l = current().layers[current().layers.length - 1];
        l.name = name; l._manualName = true;
      });
      state.selected = null;
      return current().layers.filter((l) => l.type === 'text').map((l) => l.id);
    });
    await page.waitForTimeout(300);

    const targetId = ids[0];
    const row = page.locator(`#layerList .layerItem[data-id="${targetId}"]`);
    // Re-expand/re-scroll and retry the bounding-box read until it survives a boot()/re-render
    // timer race, matching the established pattern in responsive-layout.spec.js for the same
    // class of flakiness in this app's scattered self-installing patch scripts.
    let zoneBox = null;
    await expect.poll(async () => {
      await expandAllBoxes(page);
      await page.evaluate((id) => {
        const r = document.querySelector(`#layerList .layerItem[data-id="${id}"]`);
        if (r) r.scrollIntoView({ block: 'center' });
      }, targetId);
      zoneBox = await row.locator('.ppLayerSelectZone').boundingBox();
      return zoneBox;
    }, { timeout: 5000 }).not.toBeNull();
    const x = zoneBox.x + zoneBox.width / 2, y = zoneBox.y + zoneBox.height / 2;

    await touchDrag(page, [{ x, y }]); // no movement at all - a plain tap
    await page.waitForTimeout(150);

    const result = await page.evaluate(() => ({
      selected: state.selected,
      order: current().layers.filter((l) => l.type === 'text').sort((a, b) => (b.z || 0) - (a.z || 0)).map((l) => l.name),
    }));
    expect(result.selected).toBe(targetId);
    expect(result.order).toEqual(['two', 'one']);
  });

  // Real report, with a screen recording: dragging a layer stopped giving any drop-position
  // feedback (the pink outline) and couldn't reach the top or bottom of a long list at all.
  // #layerList used to be its own small scroll container - once that cap was removed (see
  // pp-layer-list-full-display-css) so the list grows to fit every layer and scrolls as part of
  // the right panel instead, the drag's own auto-scroll-near-the-edge logic kept scrolling
  // list.scrollTop, which does nothing now that the list itself no longer scrolls.
  test('dragging near the bottom edge of a long layer list auto-scrolls the panel, not the list', async ({ page }) => {
    await expandAllBoxes(page);
    await installTouchDragHelpers(page);
    await page.evaluate(() => {
      for (let i = 0; i < 25; i++) {
        addText('row ' + i);
        const l = current().layers[current().layers.length - 1];
        l.name = 'row ' + i;
        l._manualName = true;
      }
    });
    await page.waitForTimeout(300);
    await expandAllBoxes(page);
    await page.evaluate(() => {
      document.getElementById('layerList').closest('.side.right').scrollTop = 0;
    });

    const panelInfo = await page.evaluate(() => {
      const panel = document.getElementById('layerList').closest('.side.right');
      return { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight };
    });
    expect(panelInfo.scrollHeight).toBeGreaterThan(panelInfo.clientHeight); // needs scrolling to reach every row

    // Grab the first (topmost, already-visible) row by its grip and drag down to the bottom edge
    // of the visible panel, then hold there - the same gesture a seller would use to drag a
    // layer down past whatever's currently on screen. Re-expand/re-scroll and retry the
    // bounding-box read until it survives a boot()/re-render timer race, matching the
    // established pattern above (and in responsive-layout.spec.js) for the same class of
    // flakiness in this app's scattered self-installing patch scripts.
    const firstId = await page.evaluate(() => current().layers.filter((l) => l.type === 'text')[0].id);
    const grip = page.locator(`#layerList .layerItem[data-id="${firstId}"] .dragGrip`);
    let gripBox = null;
    await expect.poll(async () => {
      await expandAllBoxes(page);
      await page.evaluate((id) => {
        const r = document.querySelector(`#layerList .layerItem[data-id="${id}"]`);
        if (r) r.scrollIntoView({ block: 'start' });
      }, firstId);
      gripBox = await grip.boundingBox();
      return gripBox;
    }, { timeout: 5000 }).not.toBeNull();
    const panelBox = await page.locator('.side.right').boundingBox();
    const gx = gripBox.x + gripBox.width / 2;
    const edgeY = panelBox.y + panelBox.height - 25; // inside the auto-scroll zone near the bottom edge of the visible panel

    // Compare the delta caused by the drag itself, not an absolute scrollTop - the poll loop
    // above may itself have nudged the panel's scroll position while re-locating the grip.
    const scrollTopBefore = await page.evaluate(
      () => document.getElementById('layerList').closest('.side.right').scrollTop
    );
    const holdPoints = [{ x: gx, y: gripBox.y + gripBox.height / 2 }];
    for (let i = 0; i < 20; i++) holdPoints.push({ x: gx, y: edgeY });
    await touchDrag(page, holdPoints);

    const scrollTopAfter = await page.evaluate(
      () => document.getElementById('layerList').closest('.side.right').scrollTop
    );
    expect(scrollTopAfter).toBeGreaterThan(scrollTopBefore);
  });
});

// Real report, with a screenshot: with enough layers on a page, the layer list's own top/bottom
// rows couldn't be reached at all - scrolling inside the list just didn't work. #layerList is a
// fixed-max-height scroll container nested INSIDE the right side panel, which is already its own
// scroll container - the same class of bug already fixed once for the pattern/asset trays (a
// second, smaller scroll gesture nested inside a bigger one is easy to miss, or simply doesn't
// win the touch, on a real device). Fixed by letting the list grow to fit every layer instead of
// capping its own height, so it scrolls as part of the panel's own scroll.
test('with many layers, the list grows to fit them all instead of capping its own height', async ({ page }) => {
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.addText('text');
  });
  await expandAllBoxes(page);
  await expect(page.locator('#layerList > *')).toHaveCount(20);
  // A transient re-render can re-collapse the panel after the addText() loop above (the same
  // "self-healing" reason clickResilient re-expands right before its own interaction, not just
  // once up front) - expand again right before reading geometry off it.
  await page.waitForTimeout(150);
  await expandAllBoxes(page);

  const info = await page.evaluate(() => {
    const list = document.getElementById('layerList');
    const cs = getComputedStyle(list);
    return {
      maxHeight: cs.maxHeight,
      overflowY: cs.overflowY,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
    };
  });
  expect(info.maxHeight).toBe('none');
  expect(info.overflowY).toBe('visible');
  // Nothing clipped inside the list itself - all 20 rows' worth of height is fully laid out.
  expect(info.scrollHeight).toBeLessThanOrEqual(info.clientHeight + 1);

  // The very last row is reachable by scrolling the panel itself (not a nested scroll): the
  // right panel has plenty of OTHER boxes below "layers" too, so scrolling it to its absolute
  // max would scroll straight past the layer rows - scrollIntoView the actual row instead, the
  // same way a user would land on it, and confirm it's then genuinely on screen (not still
  // clipped out by a max-height/overflow of its own).
  const reach = await page.evaluate(() => {
    const panel = document.getElementById('layerList').closest('.side.right') || document.querySelector('.side.right');
    const rows = document.querySelectorAll('#layerList > *');
    const lastRow = rows[rows.length - 1];
    lastRow.scrollIntoView({ block: 'end' });
    const panelRect = panel.getBoundingClientRect();
    const rowRect = lastRow.getBoundingClientRect();
    return rowRect.bottom > panelRect.top && rowRect.top < panelRect.bottom;
  });
  expect(reach).toBe(true);
});

// Real report, with a project file: a badge used without any caption text exported as a plain
// rectangle instead of its actual shape (a circle, in the reported project) - most visible with
// no text to distract from it, but true of every badgeShape. The PNG/ZIP export
// (renderPageToCanvas) draws straight from layer data and never mirrored the badgeShape->CSS
// border-radius/clip-path mapping the live editor uses (see the l.type==='label' block in
// renderLayer) - it just filled a plain rectangle for every label layer regardless of shape.
test('exporting a circular badge fills a circle, not a plain rectangle, even with no caption text', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    save();
    state.pages = [{
      type: 'listing', w: 1000, h: 1000, layers: [{
        id: 'badge1', type: 'label', badgeShape: 'circle', text: '',
        x: 25, y: 25, w: 50, h: 50, r: 0, opacity: 1, scale: 1, z: 1,
        fill: '#ff0000', border: '#000000', borderW: 0,
      }],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();

    const p = state.pages[0];
    const canvas = await window.renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    // The badge spans px (250,250)-(750,750). A true circle inscribed in that square never
    // reaches its corners - (260,260) sits outside the circle but inside the old buggy
    // rectangle fill. The centre (500,500) is inside both, so it can't tell them apart.
    return {
      corner: Array.from(ctx.getImageData(260, 260, 1, 1).data),
      center: Array.from(ctx.getImageData(500, 500, 1, 1).data),
    };
  });

  // Corner stays the white page background - a rectangle fill would have painted it red.
  expect(pixel.corner[0]).toBeGreaterThan(240);
  expect(pixel.corner[1]).toBeGreaterThan(240);
  expect(pixel.corner[2]).toBeGreaterThan(240);
  // Centre is inside the circle either way - painted red.
  expect(pixel.center[0]).toBeGreaterThan(200);
  expect(pixel.center[1]).toBeLessThan(60);
  expect(pixel.center[2]).toBeLessThan(60);
});

// Real request, from a user: "extra design elements" had + rectangle and + square, but no plain
// circle - so getting a plain circle meant adding a circle badge and deleting its text every
// time. l.type==='circle' was already a fully supported shape (renderLayer already draws it with
// border-radius:50%, the layer panel already names it "Circle"), just never reachable from any
// button. Added addShape('circle') as a third button; addShape() itself needed to also treat
// 'circle' like 'square' (equal width/height) instead of the rectangle's 40x18 default, or a
// fresh circle would start out squashed into an oval.
test('the + circle button in extra design elements adds a true circle, sized like a square not a rectangle', async ({ page }) => {
  await page.evaluate(() => window.addShape('circle'));
  const layer = await page.evaluate(() => current().layers.at(-1));
  expect(layer.type).toBe('circle');
  expect(layer.w).toBe(layer.h);
});

// Same rectangle-instead-of-real-shape gap as the badge fix above, but for the plain circle
// shape type instead of a badgeShape - renderPageToCanvas didn't know about l.type==='circle'
// at all, so a freshly-added circle would have exported as a square.
test('exporting a plain circle shape fills a circle, not a square', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    save();
    state.pages = [{
      type: 'listing', w: 1000, h: 1000, layers: [{
        id: 'circle1', type: 'circle', text: '',
        x: 25, y: 25, w: 50, h: 50, r: 0, opacity: 1, scale: 1, z: 1,
        fill: '#ff0000', border: '#000000', borderW: 0,
      }],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();

    const p = state.pages[0];
    const canvas = await window.renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    return {
      corner: Array.from(ctx.getImageData(260, 260, 1, 1).data),
      center: Array.from(ctx.getImageData(500, 500, 1, 1).data),
    };
  });

  // Corner stays the white page background - a square fill would have painted it red.
  expect(pixel.corner[0]).toBeGreaterThan(240);
  expect(pixel.corner[1]).toBeGreaterThan(240);
  expect(pixel.corner[2]).toBeGreaterThan(240);
  expect(pixel.center[0]).toBeGreaterThan(200);
  expect(pixel.center[1]).toBeLessThan(60);
  expect(pixel.center[2]).toBeLessThan(60);
});

// Real report: "blank page", sitting in "extra design elements" right next to buttons that ADD
// things, read as adding a new blank page - it actually wipes every layer off the CURRENT page,
// and did so with no confirmation at all, unlike the comparably destructive deletePage()'s
// "Delete this page?" prompt. Renamed to clearCurrentPage()/"clear current page" and it now asks
// first, matching that existing convention.
test('clear current page asks for confirmation, and only clears layers if confirmed', async ({ page }) => {
  await page.evaluate(() => { window.addText('one'); window.addShape('square'); });
  await expect.poll(() => page.evaluate(() => current().layers.length)).toBe(2);

  let promptSeen = '';
  page.once('dialog', (d) => { promptSeen = d.message(); d.dismiss(); });
  await page.evaluate(() => window.clearCurrentPage());
  expect(promptSeen).toContain('Clear');
  expect(await page.evaluate(() => current().layers.length)).toBe(2);

  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => window.clearCurrentPage());
  expect(await page.evaluate(() => current().layers.length)).toBe(0);
});
