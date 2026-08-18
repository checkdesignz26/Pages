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

// Real report: the wide-panel toggle button's own visible text used to name the OTHER mode -
// the mode clicking it switches TO - while the hint text right next to it names the CURRENT
// mode ("Normal mode: compact layer list." sitting next to a button reading "wide panel").
// Read together, "wide panel" looked like it was describing what's on screen right now, when
// the panel was actually narrow. The button now names whichever mode is actually active,
// matching the hint's own convention.
test('the wide/normal panel button names the mode that is actually active, not the other one', async ({ page }) => {
  const initial = await page.evaluate(() => ({
    isWide: document.body.classList.contains('ppLayersWide'),
    btnText: document.getElementById('ppLayerPanelWideToggle')?.textContent,
  }));
  expect(initial.isWide).toBe(false);
  expect(initial.btnText).toBe('normal panel');

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
