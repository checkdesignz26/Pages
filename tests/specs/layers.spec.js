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

// Real report, with a screen recording: two groups sat right next to each other in the layers
// panel, both literally named "group" with the same generic icon and no content preview - there
// was no way to tell them apart, so with more than one group on a page the seller couldn't find
// "their" group at a glance.
test('a second group on the same page gets a name distinct from the first, not another identical "group"', async ({ page }) => {
  await expandAllBoxes(page);
  const secondPairIds = await page.evaluate(() => {
    addText('one'); addBadge('oval'); addText('two'); addBadge('rect');
    return current().layers.slice(-2).map((l) => l.id);
  });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  let checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(4);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  // The first group's two members are still individually checkable rows (nested under it), so
  // pick this pair's checkboxes by the layer ids created above rather than by position.
  await clickResilient(page, page.locator('#multiSelectBtn'));
  for (const id of secondPairIds) {
    await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${id}"] .layerCheck`));
  }
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const groupNames = await page.evaluate(() => current().layers.filter((l) => l.type === 'group').map((l) => l.name));
  expect(groupNames).toHaveLength(2);
  expect(groupNames[0]).not.toBe(groupNames[1]);
});

// Real report, with a screen recording: every group's row showed the exact same bare "▣" glyph
// with no preview of its actual contents - two groups on one page were visually indistinguishable.
// The group thumbnail now reuses its topmost member's own real thumbnail (a text layer's preview
// shows its own text, matching thumbFor's existing per-type rendering) instead of the plain glyph.
test('a group\'s thumbnail previews its topmost member, not a bare generic icon', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('distinctive caption'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const groupId = await page.evaluate(() => state.selected);
  const thumb = page.locator(`#layerList .layerItem[data-id="${groupId}"] .ppCleanLayerThumb`);
  await expect(thumb).toHaveClass(/groupThumb/); // still marked as a group...
  await expect(thumb).not.toHaveText('▣'); // ...but no longer just the bare glyph
});

// Real report, with a screenshot: a group whose topmost member is a badge/circle showed no group
// marker at all. The corner badge sat close enough to the edge that a circular thumb's own
// border-radius (which clips its whole box to a circle) cut most of the glyph away - confirmed
// directly with a zoomed screenshot showing it sliced in half by the curve.
test('the group corner badge is not clipped away on a circular (badge) thumbnail', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => { addText('label'); addBadge('oval'); });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  const checks = page.locator('#layerList .layerCheck');
  await expect(checks).toHaveCount(2);
  await clickResilient(page, checks.nth(0));
  await clickResilient(page, checks.nth(1));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const groupId = await page.evaluate(() => state.selected);
  const thumb = page.locator(`#layerList .layerItem[data-id="${groupId}"] .ppCleanLayerThumb`);
  await expect(thumb).toHaveClass(/badgeThumb/); // the badge was added last, so its round thumb style is what's on trial here
  const inside = await thumb.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, radius = r.width / 2;
    const cs = getComputedStyle(el, '::after');
    const badgeRight = r.right - parseFloat(cs.right);
    const badgeBottom = r.bottom - parseFloat(cs.bottom);
    // The farthest corner of the badge glyph's own box must land inside the circle, not past its curve.
    const fontSize = parseFloat(cs.fontSize);
    const cornerX = badgeRight, cornerY = badgeBottom;
    return Math.hypot(cornerX - cx, cornerY - cy) <= radius - 1;
  });
  expect(inside).toBe(true);
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

// Real report: grouped two layers, tapped "duplicate", and got a copy of an unrelated layer
// instead of the group. The collapse/expand arrow is a group row's biggest, leftmost target - a
// natural first tap when trying to open/select "my group" - but an explicit capture-phase
// exclusion (so the toggle itself isn't hijacked into a plain row-select, see v169 layer panel
// selection sync surgery) meant tapping only the arrow never actually selected the group, leaving
// whatever was selected before untouched - so "duplicate" silently duplicated something else.
test('tapping a group\'s collapse/expand arrow also selects the group, not just something tapped earlier', async ({ page }) => {
  await expandAllBoxes(page);
  const ids = await page.evaluate(() => {
    addText('unrelated'); addText('member one'); addBadge('oval');
    return current().layers.map((l) => l.id);
  });
  const [otherId, memberOneId, memberTwoId] = ids;
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${memberOneId}"] .layerCheck`));
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${memberTwoId}"] .layerCheck`));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  // Grouping leaves the new group selected - deliberately re-select the unrelated layer to
  // simulate the real tap sequence: select something else, then only tap the group's arrow.
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${otherId}"] .ppLayerSelectZone`));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => state.selected)).toBe(otherId);

  const grip = page.locator('#layerList .layerItem.groupRow .dragGrip').first();
  await clickResilient(page, grip);
  await page.waitForTimeout(200);

  const groupId = await page.evaluate(() => current().layers.find((l) => l.type === 'group').id);
  expect(await page.evaluate(() => state.selected)).toBe(groupId);
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
      newZs: layers.filter((l) => l.groupId === newGroupId || l.id === newGroupId).map((l) => l.z),
      oldMembersStillPresent: layers.filter((l) => l.groupId === oldGroupId).length,
    };
  }, beforeDup.groupId);

  // One new group layer + two new member layers.
  expect(afterDup.total).toBe(beforeDup.total + 3);
  expect(afterDup.changedSelection).toBe(true);
  expect(afterDup.newGroupIsGroupType).toBe('group');
  expect(afterDup.oldMembersStillPresent).toBe(2);
  expect(afterDup.newMembers).toHaveLength(2);
  // Real report, with a screenshot: the duplicate's own row order looked wrong in the panel -
  // every one of its layers (both members plus the group wrapper) landed on the exact same z,
  // an easy tie to introduce since nextZ() has to be called once per new layer.
  expect(new Set(afterDup.newZs).size).toBe(afterDup.newZs.length);
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

// Real report, with a screenshot: a duplicated group's row order looked wrong in the panel.
// insertGroupBundle called nextZSafe(p) once per member, all before any of those members were
// actually pushed onto the page - every call re-derives "current highest z + 1" from the page's
// live layers, so with none of the new ones added yet, every member (and the group wrapper
// itself) read the exact same stale snapshot and landed on the identical z value. The panel lists
// layers sorted by z descending, and JS array sort is stable, so a tied z is otherwise harmless -
// but it's still wrong: a genuine duplicate should stack immediately above its source, each of
// its own layers at its own distinct z, the same way a freshly-grouped selection's members do.
test('duplicating a group gives each new member (and the group itself) its own distinct z, not one shared value', async ({ page }) => {
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
  await clickResilient(page, page.locator('#ppLayerReuseBar button:has-text("duplicate")'));
  await page.waitForTimeout(300);

  const newGroupId = await page.evaluate(() => state.selected);
  const zs = await page.evaluate((id) => {
    const layers = current().layers.filter((l) => l.groupId === id || l.id === id);
    return layers.map((l) => l.z);
  }, newGroupId);
  expect(new Set(zs).size).toBe(zs.length); // every z in the new group + its members is unique
});

// Real report, with a screenshot: a duplicated group's own members looked swapped compared to
// the original. groupMembers() returns a group's layers in raw array/insertion order, not the z
// order they actually display in - stepping the new members' z up in that raw order meant a
// member that visually sat above another inside the source group could end up BELOW its
// counterpart in the duplicate, if it simply happened to have been added to the page earlier.
test('duplicating a group keeps its members in the same relative order as the original, not insertion order', async ({ page }) => {
  await expandAllBoxes(page);
  const ids = await page.evaluate(() => {
    addText('member-a'); addText('member-b');
    const [a, b] = current().layers;
    a.name = 'member-a'; a._manualName = true; a.z = 5; // inserted first, but z now above b
    b.name = 'member-b'; b._manualName = true; b.z = 2; // inserted second, but z now below a
    return { a: a.id, b: b.id };
  });
  await page.waitForTimeout(1800);

  await clickResilient(page, page.locator('#multiSelectBtn'));
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${ids.a}"] .layerCheck`));
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${ids.b}"] .layerCheck`));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  await clickResilient(page, page.locator('#ppLayerReuseBar button:has-text("duplicate")'));
  await page.waitForTimeout(300);

  const newGroupId = await page.evaluate(() => state.selected);
  const newZs = await page.evaluate((id) => {
    const members = current().layers.filter((l) => l.groupId === id);
    return {
      a: members.find((l) => l.name === 'member-a').z,
      b: members.find((l) => l.name === 'member-b').z,
    };
  }, newGroupId);
  // member-a sat above member-b in the original (z 5 > 2) - the duplicate must preserve that.
  expect(newZs.a).toBeGreaterThan(newZs.b);
});

// Real request, following the report above: duplicating anything should drop the copy right next
// to its source in the list, not always jump it to the very front of the whole stack (every
// duplicate path used nextZ()/nextZSafe() - "current highest z + 1" - unconditionally before).
test('duplicating a plain layer that is not the topmost thing on the page lands the copy next to it, not at the front', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => {
    ['bottom', 'middle', 'top'].forEach((name) => {
      addText(name);
      const l = current().layers[current().layers.length - 1];
      l.name = name; l._manualName = true;
    });
  });
  await page.waitForTimeout(1800);

  const middleId = await page.evaluate(() => current().layers[1].id);
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${middleId}"] .ppLayerSelectZone`));
  await page.waitForTimeout(200);
  await clickResilient(page, page.locator('#ppLayerReuseBar button:has-text("duplicate")'));
  await page.waitForTimeout(300);

  const zs = await page.evaluate((id) => {
    const layers = current().layers;
    const middle = layers.find((l) => l.id === id);
    const top = layers.find((l) => l.name === 'top');
    const copy = layers.find((l) => l.id === state.selected);
    return { middleZ: middle.z, topZ: top.z, copyZ: copy.z };
  }, middleId);
  // The copy must sit between the middle layer it came from and whatever was already above it -
  // never past the true top of the stack.
  expect(zs.copyZ).toBeGreaterThan(zs.middleZ);
  expect(zs.copyZ).toBeLessThan(zs.topZ);
});

// Same requirement, for the top-toolbar's duplicateSelected() - a separate implementation from
// the layer panel's own ppDuplicateSelectedLayer(), fixed above.
test('duplicateSelected() also lands the copy next to its source, not at the front, for both a plain layer and a group', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => {
    ['bottom', 'middle', 'top'].forEach((name) => {
      addText(name);
      const l = current().layers[current().layers.length - 1];
      l.name = name; l._manualName = true;
    });
  });
  await page.waitForTimeout(1800);

  const middleId = await page.evaluate(() => current().layers[1].id);
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${middleId}"] .ppLayerSelectZone`));
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.duplicateSelected(); });
  await page.waitForTimeout(200);

  const singleZs = await page.evaluate((id) => {
    const layers = current().layers;
    return { middleZ: layers.find((l) => l.id === id).z, topZ: layers.find((l) => l.name === 'top').z, copyZ: layers.find((l) => l.id === state.selected).z };
  }, middleId);
  expect(singleZs.copyZ).toBeGreaterThan(singleZs.middleZ);
  expect(singleZs.copyZ).toBeLessThan(singleZs.topZ);

  // Now group the bottom two original layers (leaving "top" ungrouped and above them) and
  // duplicate the group - its copy (wrapper + members) must land above the group but still below
  // "top", not jump past it to the very front.
  await clickResilient(page, page.locator('#multiSelectBtn'));
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${middleId}"] .layerCheck`));
  const bottomId = await page.evaluate(() => current().layers[0].id);
  await clickResilient(page, page.locator(`#layerList .layerItem[data-id="${bottomId}"] .layerCheck`));
  await clickResilient(page, page.locator('#groupSelectedBtn'));
  await page.waitForTimeout(300);

  const groupId = await page.evaluate(() => state.selected);
  await page.evaluate(() => { window.duplicateSelected(); });
  await page.waitForTimeout(200);

  const groupZs = await page.evaluate((ids) => {
    const layers = current().layers;
    const newGroupId = state.selected;
    return {
      groupZ: layers.find((l) => l.id === ids.groupId).z,
      topZ: layers.find((l) => l.name === 'top').z,
      newLayerZs: layers.filter((l) => l.groupId === newGroupId || l.id === newGroupId).map((l) => l.z),
    };
  }, { groupId });
  for (const z of groupZs.newLayerZs) {
    expect(z).toBeGreaterThan(groupZs.groupZ);
    expect(z).toBeLessThan(groupZs.topZ);
  }
});

// Real request: the top-toolbar "duplicate" button only ever duplicated the selected layer -
// with nothing selected it silently did nothing, and the only way to duplicate a whole page was
// the small ⧉ icon on that page's own row in the page list, easy to miss. duplicateSelected() now
// falls back to duplicating the current page (the same thing that icon does) when no layer is
// selected, so the general "duplicate" button is never a no-op.
test('duplicateSelected() duplicates the current page when nothing is selected', async ({ page }) => {
  await page.evaluate(() => { addText('only layer on this page'); deselect(); });
  await page.waitForTimeout(200);

  const before = await page.evaluate(() => ({
    numPages: state.pages.length,
    selected: state.selected,
    selectedPage: state.selectedPage,
  }));
  expect(before.selected).toBeFalsy();

  await page.evaluate(() => { window.duplicateSelected(); });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => ({
    numPages: state.pages.length,
    selectedPage: state.selectedPage,
    firstPageLayers: state.pages[0].layers.map((l) => l.name),
    secondPageLayers: state.pages[1] ? state.pages[1].layers.map((l) => l.name) : null,
  }));
  expect(after.numPages).toBe(before.numPages + 1);
  expect(after.selectedPage).toBe(before.selectedPage + 1);
  expect(after.secondPageLayers).toEqual(after.firstPageLayers.map((n) => n + ' copy'));
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

// Real report, with screenshots: grouped a custom mock-up's photo with its pattern overlay (a
// tight crop positioned/sized to line up exactly with the mug in that photo) to resize them
// together and make room for some text - after dragging the group's resize handle, the pattern
// no longer covered the mug. applyGroupResize scales every member by the same per-axis factor,
// which does keep their positions correctly aligned relative to each other - but the pattern
// overlay draws with object-fit:contain using its own image's original aspect ratio, and a free
// (independent width/height) resize changes the box's aspect ratio out from under it, letterboxing
// the pattern inside a box it no longer fully fills. A plain, ungrouped mock-up never hits this,
// since it always goes through its own dedicated recrop-on-adjust path (updateClean()) instead of
// this generic drag-resize.
test('resizing a group non-uniformly keeps every member\'s own box aspect ratio, so a fit:contain image never gets letterboxed', async ({ page }) => {
  const groupId = await page.evaluate(() => {
    save();
    const photo = Object.assign(layer('image', { name: 'Image', fit: 'cover' }), { x: 0, y: 0, w: 100, h: 100, z: 1 });
    const pattern = Object.assign(layer('image', { name: 'custom mock-up pattern area', fit: 'contain', customMockup: true }),
      { x: 31.79, y: 36.29, w: 43.95, h: 49.80, z: 2 });
    current().layers.push(photo, pattern);
    state.layerMultiSelect = true;
    state.selectedLayerIds = [photo.id, pattern.id];
    state.selected = photo.id;
    window.groupSelectedLayers();
    const g = current().layers.find((l) => l.type === 'group');
    window.__ppTestPatternId = pattern.id;
    return g.id;
  });
  await page.waitForTimeout(200);

  const before = await page.evaluate((id) => {
    const l = current().layers.find((x) => x.id === window.__ppTestPatternId);
    return l.w / l.h;
  }, groupId);

  // A non-uniform resize: shrink width a lot, height only a little.
  await page.evaluate((gid) => {
    const snap = makeGroupSnapshot(gid);
    applyGroupResize(gid, snap, -30, -10);
  }, groupId);

  const after = await page.evaluate(() => {
    const l = current().layers.find((x) => x.id === window.__ppTestPatternId);
    return l.w / l.h;
  });

  expect(after).toBeCloseTo(before, 5);
});

// Real report: "can we have an align within the group feature, I am trying to align my icons in
// the badge circle but it doesn't really work" - a screenshot showed a badge (a circle shape +
// icon image, grouped) with the icon sitting off-centre inside the circle. alignSelected always
// aligned against the whole 0-100 page, since a group member's x/y are page-relative percentages
// exactly like any other layer's - centring a small icon "worked" in the sense that it moved, just
// to the middle of the entire page instead of the middle of its own small badge, which reads as
// the align buttons doing nothing useful for anything grouped. Fixed to align against the group's
// own bounding box (groupBounds - the union of its members' positions) whenever the selected
// layer is a group member.
test('aligning a group member centres it within its own group, not the whole page', async ({ page }) => {
  const ids = await page.evaluate(() => {
    save();
    const circle = Object.assign(layer('label', { name: 'circle', badgeShape: 'circle' }), { x: 10, y: 65, w: 20, h: 15, z: 1 });
    const icon = Object.assign(layer('image', { name: 'icon', fit: 'contain' }), { x: 11, y: 66, w: 5, h: 5, z: 2 });
    current().layers.push(circle, icon);
    state.layerMultiSelect = true;
    state.selectedLayerIds = [circle.id, icon.id];
    state.selected = circle.id;
    window.groupSelectedLayers();
    return { circleId: circle.id, iconId: icon.id };
  });

  const result = await page.evaluate(({ circleId, iconId }) => {
    const circle = current().layers.find((l) => l.id === circleId);
    // Select the icon specifically, as if its own row was tapped in the layer list.
    state.selected = iconId;
    window.alignSelected('centerBoth');
    const icon = current().layers.find((l) => l.id === iconId);
    return {
      iconX: icon.x, iconY: icon.y,
      expectedX: circle.x + (circle.w - icon.w) / 2,
      expectedY: circle.y + (circle.h - icon.h) / 2,
    };
  }, ids);

  expect(result.iconX).toBeCloseTo(result.expectedX, 5);
  expect(result.iconY).toBeCloseTo(result.expectedY, 5);
  // Not a coincidental match with page-centre (50-ish) - the badge sits far from the page centre.
  expect(result.iconX).toBeLessThan(30);
  expect(result.iconY).toBeGreaterThan(60);
});

// Real report: "not sure where to go for the alignment of the group, is that in the text panel?"
// - the panel holding the buttons the test above exercises turned out to be permanently
// display:none, left over from an old "FLASH MOP UX SIMPLIFICATION... hide the heavy alignment
// toolbox/panel for launch" pass, predating group-relative alignment being worth surfacing at
// all. Restored the same way the text panel was after being caught by that same broad hide rule
// (a later, more specific #alignPanel{display:block!important} rule) - functionally correct
// alignment logic is useless if nobody can ever find the buttons that trigger it.
test('the alignment panel is visible, not left permanently hidden by an old simplification pass', async ({ page }) => {
  const display = await page.evaluate(() => {
    const el = document.getElementById('alignPanel');
    return el && getComputedStyle(el).display;
  });
  expect(display).not.toBe('none');
});

// Real report, with a screenshot and a saved .ppages file: deleted a custom mock-up's background
// photo (a group member alongside its pattern overlay) and the pattern - still fully intact in the
// layer data - became permanently stuck on the canvas with no way to select or delete it. Its
// groupId pointed at a group layer that no longer existed anywhere on the page (confirmed directly
// in the saved file). renderLayers()'s own row-building loop unconditionally skips any layer with
// a groupId set, trusting its parent group's row to display it instead - an orphaned reference
// like this one just vanishes from the panel forever while still rendering normally on the canvas,
// since nothing in the canvas-rendering path checks groupId at all.
test('a layer whose group no longer exists heals back into an ordinary, deletable layer', async ({ page }) => {
  const patternId = await page.evaluate(() => {
    save();
    // Exactly the shape found in the real broken file: a customMockup layer with a groupId
    // pointing at a group that was never actually added to this page's layers.
    const pattern = Object.assign(
      layer('image', { name: 'custom mock-up pattern area', fit: 'contain', customMockup: true, customMockupLive: true }),
      { x: 30, y: 35, w: 40, h: 45, z: 1, groupId: 'l_does_not_exist' }
    );
    current().layers.push(pattern);
    render();
    return pattern.id;
  });
  await page.waitForTimeout(200);

  await expect(page.locator(`.layerItem[data-id="${patternId}"]`)).toHaveCount(1);
  expect(await page.evaluate((id) => !current().layers.find((l) => l.id === id).groupId, patternId)).toBe(true);

  page.on('dialog', (d) => d.accept());
  await page.evaluate((id) => {
    document.querySelector(`.layerItem[data-id="${id}"] .deleteLayerBtn`).click();
  }, patternId);
  await page.waitForTimeout(200);

  expect(await page.evaluate(() => current().layers.length)).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll('.stage .layer').length)).toBe(0);
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
  // Historical note: rows used to also carry draggable="true" for a second, older native HTML5
  // drag-and-drop implementation (dragstart/dragover/drop, wired in rowForLayerV170), left over
  // from before pp-layer-panel-touch-drag-patch was written - a plain page.mouse drag on an
  // unpatched row got hijacked by that native path instead of exercising this one at all (see the
  // "not hijacked by the browser's own native drag-and-drop" test further down, which covers that
  // directly with a real mouse pointer now that draggable is unconditionally false). Kept using
  // real touch + pointer dispatch here regardless: an actual touchscreen fires touch and pointer
  // events together in a specific order a mouse never produces, and this describe block's tests
  // are specifically about that ordering and the arm-threshold/auto-scroll logic built for it.
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

  // Real report, with a screen recording: dragging a layer row by grabbing its body (not the tiny
  // grip icon) started fine - the ghost appeared - then froze in place for several seconds before
  // the drag silently gave up with the row back where it started, no reorder applied. Root cause:
  // every row was also marked draggable="true" and wired up with a second, older, native HTML5
  // drag-and-drop implementation (dragstart/dragover/drop), left over from before this pointer-
  // based drag script was written specifically because native drag-and-drop is unreliable on
  // touch. With both live at once, any pointer the browser is willing to treat as a native drag
  // trigger (a mouse or trackpad pointer, e.g. an iPad used with a Magic Keyboard, in addition to
  // whatever touch cases the browser itself decides to support) fires 'dragstart' - and cancels
  // the in-flight pointer sequence via 'pointercancel' right out from under this code - handing
  // the gesture to native drag-and-drop instead, which then never completes a same-page drop, so
  // it just sits frozen until the browser gives up and reverts it. Confirmed directly: a real
  // (CDP-dispatched) mouse-pointer drag on an unpatched row fired 'dragstart' immediately on
  // crossing the arm threshold. draggable is unconditionally false now, so only this script's own
  // pointer-based reordering can ever run.
  test('dragging a layer row by its body is not hijacked by the browser\'s own native drag-and-drop', async ({ page }) => {
    const ids = await page.evaluate(() => {
      addText('one'); addText('two'); addText('three');
      return current().layers.filter((l) => l.type === 'text').map((l) => l.id);
    });
    // Well past this app's ~150ms-1.6s window of self-installing patch-script boot timers (see
    // playwright.config.js) - starting the drag while one of those is still due to fire is its
    // own separate source of flakiness, unrelated to the native-drag-and-drop bug under test here.
    await page.waitForTimeout(1800);
    await expandAllBoxes(page);

    await expect(page.locator('#layerList .layerItem[data-id]')).toHaveCount(3);
    // The rows themselves must never be native-draggable - that's the whole bug: this attribute
    // being "true" is what let the browser treat the gesture below as a native drag instead. Not
    // asserting the exact value: rowForLayerV170 no longer sets it at all, and markRows() (which
    // does stamp it "false") stops being reachable once installRenderLayers's own from-scratch
    // window.renderLayers - a later, unrelated patch that replaces the whole chain rather than
    // extending it - takes over a few hundred ms after load. Either way the attribute never
    // becomes the literal string "true" again, and a plain <div> left with no draggable attribute
    // at all defaults to the same non-draggable behaviour, so the real invariant is just that.
    for (const id of ids) {
      expect(await page.locator(`#layerList .layerItem[data-id="${id}"]`).getAttribute('draggable')).not.toBe('true');
    }

    const sawNativeDrag = await page.evaluate(() => {
      window.__sawDragstart = false;
      document.addEventListener('dragstart', () => { window.__sawDragstart = true; }, { once: true });
      return true;
    });
    expect(sawNativeDrag).toBe(true);

    // ids[0] ("one") sorts to the bottom (lowest z) and ids[2] ("three") to the top (highest z) -
    // grab the bottom row by its body (not the grip) and drag it above the top row, exactly the
    // upward reorder-by-body gesture from the report, driven by a real mouse pointer so native
    // drag-and-drop gets a genuine chance to engage, the same way the mid-drag re-render test
    // below does.
    const bottomRow = page.locator(`#layerList .layerItem[data-id="${ids[0]}"]`);
    const topRow = page.locator(`#layerList .layerItem[data-id="${ids[2]}"]`);
    const bottomBox = await bottomRow.boundingBox();
    const topBox = await topRow.boundingBox();
    const startX = bottomBox.x + bottomBox.width / 2, startY = bottomBox.y + bottomBox.height / 2;
    const endX = topBox.x + topBox.width / 2, endY = topBox.y + topBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 15, { steps: 3 }); // cross the arm threshold
    await page.waitForTimeout(50);
    // The drag must survive to this point as OUR pointer-based drag, not get silently handed off.
    await expect(page.locator('.ppLayerDragGhost')).toHaveCount(1);
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__sawDragstart)).toBe(false);
    await expect(page.locator('.ppLayerDragGhost')).toHaveCount(0);
    const order = await page.evaluate(() => current().layers.slice().sort((a, b) => (b.z || 0) - (a.z || 0)).map((l) => l.id));
    expect(order.indexOf(ids[0])).toBeLessThan(order.indexOf(ids[2]));
  });

  // Real report, with a screenshot: a translucent "ghost" copy of a dragged row stayed stuck on
  // top of the layers panel indefinitely. The ghost is a clone appended to document.body while
  // dragging, only ever removed once the drag's pointerup/pointercancel reaches its window
  // listeners - but a re-render (renderLayers() rebuilds every row via innerHTML) can replace the
  // dragged row out from under an in-progress drag. A detached element can no longer bubble its
  // terminating pointer event up to window, so that cleanup never ran and the clone was orphaned
  // for good. Reproduced here by starting a drag and forcing exactly that re-render mid-drag,
  // without ever sending a pointerup/pointercancel - the fix relies on 'lostpointercapture',
  // which the browser dispatches at document (confirmed directly - the removed element itself is
  // no longer reachable in the event path) the moment it implicitly releases capture on removal.
  //
  // Uses a real (CDP-dispatched) mouse pointer rather than a JS-constructed PointerEvent, exactly
  // as the pinch-vs-drag test above this describe block does - beginDrag calls
  // row.setPointerCapture(e.pointerId), which the browser silently no-ops for a synthetic
  // pointerId it never saw as an active pointer, meaning capture (and so lostpointercapture)
  // would never really engage with a fake event.
  test('a re-render mid-drag does not leave a stuck ghost row behind', async ({ page }) => {
    await expandAllBoxes(page);
    const firstId = await page.evaluate(() => {
      addText('one');
      addText('two');
      return current().layers.filter((l) => l.type === 'text')[0].id;
    });
    await page.waitForTimeout(300);

    const grip = page.locator(`#layerList .layerItem[data-id="${firstId}"] .dragGrip`);
    let gripBox = null;
    await expect.poll(async () => {
      await expandAllBoxes(page);
      await page.evaluate((id) => {
        const r = document.querySelector(`#layerList .layerItem[data-id="${id}"]`);
        if (r) r.scrollIntoView({ block: 'center' });
      }, firstId);
      gripBox = await grip.boundingBox();
      return gripBox;
    }, { timeout: 5000 }).not.toBeNull();
    const gx = gripBox.x + gripBox.width / 2, gy = gripBox.y + gripBox.height / 2;

    // Start the drag (grip drags begin immediately on pointerdown, no arm threshold) and confirm
    // the ghost actually appeared, so the re-render below is genuinely interrupting a live drag.
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.waitForTimeout(30);
    expect(await page.evaluate(() => document.querySelectorAll('.ppLayerDragGhost').length)).toBe(1);

    // The interrupting re-render - rebuilds every row, detaching the one just grabbed, without
    // any pointerup/pointercancel ever being sent for this gesture.
    await page.evaluate(() => window.renderLayers());
    await page.waitForTimeout(100);

    expect(await page.evaluate(() => document.querySelectorAll('.ppLayerDragGhost').length)).toBe(0);

    await page.mouse.up();
  });

  // Real report: "I still can't drag a layer out of a group to another position." The drag itself
  // (ghost, drop-target highlight, even the z-order change) always worked fine - reorderLayerByDrop
  // just never touched groupId, so a dragged member kept belonging to its original group no matter
  // where its new z-order put it. renderLayers() only ever draws a member nested under its own
  // group, regardless of z, so on the very next render it silently snapped right back to looking
  // exactly like before the drag - reading as "the drag didn't do anything."
  test('dragging a group member onto an ungrouped layer actually removes it from the group', async ({ page }) => {
    const ids = await page.evaluate(() => {
      addText('member one');
      addText('member two');
      addText('outside layer');
      const [m1, m2, outside] = current().layers.filter((l) => l.type === 'text');
      state.selectedLayerIds = [m1.id, m2.id];
      state.layerMultiSelect = true;
      groupSelectedLayers();
      state.layerMultiSelect = false;
      render();
      const group = current().layers.find((l) => l.type === 'group');
      return { m1: m1.id, m2: m2.id, outside: outside.id, group: group.id };
    });
    await page.waitForTimeout(1800); // let the layer-panel boot()/re-render timers settle first
    await expandAllBoxes(page);

    const memberZone = page.locator(`#layerList .layerItem[data-id="${ids.m1}"] .ppLayerSelectZone`);
    const outsideRow = page.locator(`#layerList .layerItem[data-id="${ids.outside}"]`);
    const memberBox = await memberZone.boundingBox();
    const outsideBox = await outsideRow.boundingBox();
    const startX = memberBox.x + memberBox.width / 2, startY = memberBox.y + memberBox.height / 2;
    const endX = outsideBox.x + outsideBox.width / 2, endY = outsideBox.y + outsideBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 15, { steps: 3 }); // cross the arm threshold
    await page.waitForTimeout(50);
    await expect(page.locator('.ppLayerDragGhost')).toHaveCount(1);
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.waitForTimeout(50);
    // The report's own complaint: this highlight ("a line") should appear over a valid drop target.
    await expect(outsideRow).toHaveClass(/ppDropTarget/);
    await page.mouse.up();
    await page.waitForTimeout(200);

    const after = await page.evaluate((ids) => {
      const p = current();
      const m1 = p.layers.find((l) => l.id === ids.m1);
      const m2 = p.layers.find((l) => l.id === ids.m2);
      return { m1groupId: m1.groupId, m2groupId: m2.groupId, groupStillExists: p.layers.some((l) => l.id === ids.group) };
    }, ids);
    expect(after.m1groupId).toBeUndefined();
    // The other member is untouched - only the dragged layer left the group.
    expect(after.m2groupId).toBe(ids.group);
    expect(after.groupStillExists).toBe(true);
  });

  test('dragging the last member out of a group removes the now-empty group too', async ({ page }) => {
    const ids = await page.evaluate(() => {
      addText('member one');
      addText('member two');
      addText('outside layer');
      const [m1, m2, outside] = current().layers.filter((l) => l.type === 'text');
      state.selectedLayerIds = [m1.id, m2.id];
      state.layerMultiSelect = true;
      groupSelectedLayers();
      state.layerMultiSelect = false;
      render();
      const group = current().layers.find((l) => l.type === 'group');
      return { m1: m1.id, m2: m2.id, outside: outside.id, group: group.id };
    });

    // First member out - the group survives with its one remaining member (already covered end to
    // end via a real drag in the test above; driven directly here to focus on the second removal).
    await page.evaluate((ids) => { reorderLayerByDrop(ids.m1, ids.outside, 'all'); }, ids);
    expect(await page.evaluate((ids) => current().layers.some((l) => l.id === ids.group), ids)).toBe(true);

    // Second (and now last) member out - nothing left to justify the group existing.
    await page.evaluate((ids) => { reorderLayerByDrop(ids.m2, ids.outside, 'all'); }, ids);

    const after = await page.evaluate((ids) => {
      const p = current();
      return {
        m1groupId: p.layers.find((l) => l.id === ids.m1).groupId,
        m2groupId: p.layers.find((l) => l.id === ids.m2).groupId,
        groupStillExists: p.layers.some((l) => l.id === ids.group),
      };
    }, ids);
    expect(after.m1groupId).toBeUndefined();
    expect(after.m2groupId).toBeUndefined();
    expect(after.groupStillExists).toBe(false);
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

// Real report: a circular pattern slot exported as a plain square photo instead of a circle.
// Live on screen this is just CSS (border-radius:50% + overflow:hidden on the layer wrapper -
// see .circleSlot), but renderPageToCanvas draws straight from layer data onto a blank canvas and
// always clipped an image layer to a plain rectangle, regardless of slotShape.
test('exporting a circular pattern slot clips the image to a circle, not a plain square', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    // A solid red 4x4 PNG, filling the whole slot so any uncropped corner reads back as red.
    const redSrc = await new Promise((resolve) => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      const cx = c.getContext('2d'); cx.fillStyle = '#ff0000'; cx.fillRect(0, 0, 4, 4);
      resolve(c.toDataURL());
    });
    save();
    state.pages = [{
      type: 'listing', w: 1000, h: 1000, layers: [{
        id: 'slot1', type: 'rectangle', patternSlot: true, slotShape: 'circle', fit: 'cover',
        src: redSrc, x: 25, y: 25, w: 50, h: 50, r: 0, opacity: 1, scale: 1, z: 1,
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

  // Corner stays the white page background - a rectangular clip would have painted it red.
  expect(pixel.corner[0]).toBeGreaterThan(240);
  expect(pixel.corner[1]).toBeGreaterThan(240);
  expect(pixel.corner[2]).toBeGreaterThan(240);
  // Centre is inside the circle either way - painted red.
  expect(pixel.center[0]).toBeGreaterThan(200);
  expect(pixel.center[1]).toBeLessThan(60);
  expect(pixel.center[2]).toBeLessThan(60);
});

// Real report, with a .ppages file: an "icon badge" (a dark circle with an icon image grouped on
// top of it - the app's own convention for these, confirmed directly in the file) exported with
// a stray "Your label" caption sitting right over it. A group is a synthetic, invisible
// organizational layer with no content of its own - but every layer, including a group, carries
// a leftover default text:'Your label' from creation that real content overwrites but a group
// never does. renderPageToCanvas's type check had an `||l.text` fallback (meant to still draw a
// plain text layer someone forgot to type 'text'/'label' onto) that matched every group too,
// painting its own default near-white fill as a solid rectangle - with its own leftover default
// text - directly over its real members, which the exporter had already correctly drawn beneath.
test('exporting a group (an icon badge: circle + icon image) does not paint the group\'s own leftover default text over its members', async ({ page }) => {
  const pixel = await page.evaluate(async () => {
    save();
    state.pages = [{
      type: 'listing', w: 1000, h: 1000, layers: [
        { id: 'circle1', type: 'label', badgeShape: 'circle', text: '', fill: '#121b30', border: '#000000', borderW: 0, x: 25, y: 25, w: 50, h: 50, r: 0, opacity: 1, scale: 1, z: 1, groupId: 'grp1' },
        { id: 'icon1', type: 'image', src: null, x: 40, y: 40, w: 20, h: 20, r: 0, opacity: 1, scale: 1, z: 2, fit: 'contain', groupId: 'grp1' },
        // The group wrapper: real data always leaves its default text:'Your label' + near-white
        // fill untouched, and always sits at a HIGHER z than its own members (see
        // groupSelectedLayers's z=...+0.5 convention) - both reproduced here.
        { id: 'grp1', type: 'group', text: 'Your label', fill: 'rgba(255,255,255,.92)', x: 25, y: 25, w: 50, h: 50, r: 0, opacity: 1, scale: 1, z: 3, fontSize: 36, color: '#555555', font: 'system-ui', textAlign: 'center' },
      ],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();

    const p = state.pages[0];
    const canvas = await window.renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    // The circle spans a 500x500 box centred at (500,500) - (500,260) sits inside its ellipse
    // (240px from centre, under its 250px radius) but outside the icon image (400-600 box) - the
    // spot the group's own stray rectangle would paint over if this bug were still present.
    return Array.from(ctx.getImageData(500, 260, 1, 1).data);
  });

  // Still the circle's own dark navy fill - a group-drawn near-white rectangle over it would
  // have pushed every channel far higher.
  expect(pixel[0]).toBeLessThan(60);
  expect(pixel[1]).toBeLessThan(60);
  expect(pixel[2]).toBeLessThan(80);
});

// Real report, with a .ppages file and screenshots: an exported page's text came out much bigger
// than it looked on the canvas - a title overlapping its own subtitle, short bullet items each
// wrapping onto two lines and spilling into a photo layer beside them. Root cause: layer font
// sizes are fixed CSS px, authored against the on-screen .stage element's width, so
// renderPageToCanvas scales them up to full export resolution by pageWidthPx/onScreenWidthPx -
// but it measured that on-screen width by reading stage.clientWidth LIVE at export time, which is
// fragile in two different ways (see referenceStageWidth's own comment for the full history):
// a plain live read can land on the wrong moment or even the wrong .stage element (an off-screen
// parked-page warm-up clone also carries the .stage class), and a first attempted fix (a fixed
// per-type constant) then disagreed with a real device where pp-stage-stable-width-js had
// legitimately pinned every .stage to a narrower shared reference than that constant assumed -
// a second real report, with screenshots, caught exactly that disagreement. The fix that actually
// holds: read the same --pp-stable-stage-width custom property every .stage on screen is already
// pinned to, so the export can never disagree with whatever the live canvas currently shows.
test('exporting a page matches the live canvas\'s current text wrapping, not a fixed assumption', async ({ page }) => {
  await page.evaluate(() => {
    state.pages = [{
      type: 'listing', w: 3000, h: 2250, layers: [{
        id: 'bullet1', type: 'text', name: 'bullet',
        text: 'Social Media Posts',
        x: 5, y: 40, w: 40, h: 30, z: 1, opacity: 1, r: 0,
        fontSize: 15, color: '#111111', textAlign: 'left', font: 'Georgia', lineHeight: 1.05,
      }],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();
  });
  await page.waitForTimeout(300);

  // Rather than fight the real (timing-sensitive) measurement heuristics in a headless browser,
  // set the exact same variable pp-stage-stable-width-js itself would cache, directly - this is
  // the one value every .stage on screen actually renders against, real device or not.
  // referenceStageWidth now forces a fresh remeasurement before every export (see the
  // stale-cache-recovery test below), which would otherwise overwrite this manually-injected
  // value with whatever the headless page's real (roomy) layout happens to measure - stub that
  // remeasurement out here so the injected value is what the export actually reads, same as before.
  async function paintedTextHeight(refWidth) {
    return page.evaluate(async (refWidth) => {
      window.__ppMeasureStableStageWidth = function(){};
      document.documentElement.style.setProperty('--pp-stable-stage-width', refWidth + 'px');
      const p = current();
      const canvas = await renderPageToCanvas(p);
      const ctx = canvas.getContext('2d');
      const boxX0 = Math.round(0.05 * p.w) + 5, boxX1 = Math.round(0.45 * p.w) - 5;
      const boxY0 = Math.round(0.40 * p.h), boxY1 = Math.round(0.70 * p.h);
      const w = boxX1 - boxX0, h = boxY1 - boxY0;
      const imgData = ctx.getImageData(boxX0, boxY0, w, h);
      let top = null, bottom = null;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          if (imgData.data[idx] < 200 || imgData.data[idx + 1] < 200 || imgData.data[idx + 2] < 200) {
            if (top === null) top = y;
            bottom = y;
            break;
          }
        }
      }
      return top === null ? 0 : bottom - top;
    }, refWidth);
  }

  // At a normal, roomy reference width the phrase fits on one line - a short painted height.
  const wideHeight = await paintedTextHeight(620);
  // At a much narrower reference (a real device with panels open, say) the SAME phrase no longer
  // fits and wraps onto two lines - several times taller. The export must track this change, not
  // stay pinned to whatever a fixed assumption would have produced.
  const narrowHeight = await paintedTextHeight(300);

  expect(wideHeight).toBeGreaterThan(20);
  expect(wideHeight).toBeLessThan(120); // one line only
  expect(narrowHeight).toBeGreaterThan(wideHeight * 2); // wrapped onto (at least) a second line
});

// Real report, with the actual downloaded file: a title that sat comfortably on one line on the
// live canvas exported wrapped onto two lines and clipped off the top of the page. The live stage
// on screen was genuinely wide - nothing was actually wrong with the canvas the user was looking
// at - but --pp-stable-stage-width (see pp-stage-stable-width-js) is a cached value only ever
// refreshed on an actual window resize event, so it can go stale on a real device for reasons this
// file can't fully audit (a missed rotation, a dismissed system banner, etc.) without the live
// canvas ever visibly breaking to show it. referenceStageWidth now forces one fresh, synchronous
// remeasurement (the same one pp-stage-stable-width-js already runs safely on resize) before every
// export, so a stale cached number can never make it into an export that disagrees with reality.
test('exporting a page recovers from a stale cached stage width instead of trusting it blindly', async ({ page }) => {
  await page.evaluate(() => {
    state.pages = [{
      type: 'listing', w: 3000, h: 2250, layers: [{
        id: 'title1', type: 'text', name: 'title',
        text: 'Pattern pages - Etsy Listing builder',
        x: 10, y: 3, w: 80, h: 16, z: 1, opacity: 1, r: 0,
        fontSize: 14, bold: true, color: '#111111', textAlign: 'center', font: 'Georgia', lineHeight: 1.05,
      }],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();
  });
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    // Simulate the cached value having gone stale - much narrower than the real, currently
    // rendered .stage on screen - without the live canvas itself being touched at all.
    document.documentElement.style.setProperty('--pp-stable-stage-width', '300px');
    const p = current();
    const canvas = await renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    const boxX0 = Math.round(0.10 * p.w), boxX1 = Math.round(0.90 * p.w);
    const boxY0 = 0, boxY1 = Math.round(0.19 * p.h);
    const w = boxX1 - boxX0, h = boxY1 - boxY0;
    const imgData = ctx.getImageData(boxX0, boxY0, w, h);
    let top = null, bottom = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (imgData.data[idx] < 200 || imgData.data[idx + 1] < 200 || imgData.data[idx + 2] < 200) {
          if (top === null) top = y;
          bottom = y;
          break;
        }
      }
    }
    return {
      paintedHeight: top === null ? 0 : bottom - top,
      clippedAtTop: top === 0,
      correctedWidth: getComputedStyle(document.documentElement).getPropertyValue('--pp-stable-stage-width'),
    };
  });

  expect(result.correctedWidth).not.toBe('300px');
  expect(result.clippedAtTop).toBe(false);
  expect(result.paintedHeight).toBeGreaterThan(10);
  expect(result.paintedHeight).toBeLessThan(90); // one line only, not wrapped onto a second
});

// Real report, with a screenshot: selecting a layer packed in among others (a bullet list sitting
// right under a title) put the floating delete "x" - pp-doggy-98-real-box-tighter-trim-css moves it
// to top:-39px;right:-34px, clear of the box's own corner resize handle - squarely on top of a
// different, unrelated layer above it. That fixed offset only accounts for the selected layer's own
// corner, never whatever already sits in the space just outside it. It should fall back to the
// original inset corner position (plain old top:6px;right:6px, fully inside the selected box) any
// time the floating spot would land on another layer.
test('the delete "x" falls back to sitting inside its own box when the floating spot would cover a different layer', async ({ page }) => {
  await page.evaluate(() => {
    state.pages = [{
      type: 'listing', w: 3000, h: 2250, layers: [
        { id: 'title', type: 'text', name: 'title', text: 'Title', x: 5, y: 0, w: 90, h: 10, z: 1, opacity: 1, r: 0, fontSize: 30, color: '#111', textAlign: 'center', font: 'Georgia' },
        { id: 'bullets', type: 'text', name: 'bullets', text: 'bullets', x: 5, y: 12, w: 40, h: 40, z: 2, opacity: 1, r: 0, fontSize: 15, color: '#111', textAlign: 'left', font: 'Georgia' },
      ],
    }];
    state.selectedPage = 0;
    state.selected = 'bullets';
    render();
  });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const layerEl = document.querySelector('.layer[data-id="bullets"]');
    const titleEl = document.querySelector('.layer[data-id="title"]');
    const del = layerEl.querySelector('.deleteMini');
    const dr = del.getBoundingClientRect();
    const tr = titleEl.getBoundingClientRect();
    const overlapsTitle = dr.right > tr.left && dr.left < tr.right && dr.bottom > tr.top && dr.top < tr.bottom;
    const lr = layerEl.getBoundingClientRect();
    const insideOwnBox = dr.left >= lr.left - 1 && dr.top >= lr.top - 1;
    return { hasInsetClass: del.classList.contains('ppDeleteMiniInset'), overlapsTitle, insideOwnBox };
  });

  expect(result.hasInsetClass).toBe(true);
  expect(result.overlapsTitle).toBe(false);
  expect(result.insideOwnBox).toBe(true);
});

// Real report: "I accidentally fill my text field with a border colour, now I can't reverse it
// anymore" - <input type="color"> can only ever hand back a real colour, never "transparent"/
// "none", so once picked there was no way back short of undo, even though fill:'transparent' (and
// an invisible border via border:'transparent'+borderW:0) already render correctly everywhere.
test('clearFillColor and clearBorderColor reset a shape layer back to no colour', async ({ page }) => {
  const result = await page.evaluate(() => {
    save();
    const l = layer('rectangle', { name: 'rect', x: 10, y: 10, w: 30, h: 30, z: nextZ(), fill: '#ff0000', border: '#00ff00', borderW: 5 });
    current().layers.push(l);
    state.selected = l.id;
    render();
    window.clearFillColor();
    const afterFill = { fill: l.fill, border: l.border, borderW: l.borderW };
    window.clearBorderColor();
    const afterBorder = { fill: l.fill, border: l.border, borderW: l.borderW };
    return { afterFill, afterBorder, borderWidthInputValue: document.getElementById('borderWidth').value };
  });

  expect(result.afterFill).toEqual({ fill: 'transparent', border: '#00ff00', borderW: 5 });
  expect(result.afterBorder).toEqual({ fill: 'transparent', border: 'transparent', borderW: 0 });
  expect(result.borderWidthInputValue).toBe('0');
});

// Real report, with a screenshot: the new "no colour" swatch rendered as a plain dark square with
// no visible icon at all. This file's own generic "button, select, input[type=color]" styling
// carries several layered !important passes (the last always winning by source order regardless
// of a more specific but non-!important selector) - a plain, non-!important background/border on
// .ppNoColorBtn was simply painted over by it. Every property needs its own !important to stick.
test('the "no colour" swatch buttons keep their own light background and diagonal-line icon, not the generic dark button style', async ({ page }) => {
  await page.evaluate(() => {
    const l = layer('rectangle', { name: 'rect', x: 10, y: 10, w: 30, h: 30, z: nextZ() });
    current().layers.push(l);
    state.selected = l.id;
    render();
  });
  await page.evaluate(() => document.querySelectorAll('.box.collapsed').forEach((b) => b.classList.remove('collapsed')));
  await page.waitForTimeout(200);

  const style = await page.evaluate(() => {
    const el = document.getElementById('fillColorNone');
    const cs = getComputedStyle(el);
    return { backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage, borderRadius: cs.borderRadius };
  });

  // The generic button style's dark, near-black gradient - if this ever won again the swatch
  // would go back to looking like a plain, iconless button.
  expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.backgroundImage).toContain('255, 59, 82'); // the red diagonal line colour
  expect(style.borderRadius).toBe('50%'); // a circle, not the generic button's rounded rectangle
});

// Real report, with the actual downloaded file: a bordered text box that looked fine live exported
// with its text spilling clean through the border line. Two real, separate bugs stacked here:
// 1) the exporter reserved textPadding*fontScale of horizontal room for wrapping, instead of live's
//    own (textPadding/55)em-of-the-layer's-own-fontSize formula - a much bigger, wrong number that
//    ate into the wrap width and could force extra line-wraps a live box never has.
// 2) live's .shapeText box has overflow:hidden, so a caption too long for a short box is simply,
//    invisibly cropped there - this canvas draw had no equivalent clip, so the exact same overflow
//    that's invisible live painted straight past the box's own border in the export.
test('exported text wraps at the same width as the live box, and overflow is clipped to the box instead of spilling past its border', async ({ page }) => {
  const result = await page.evaluate(async () => {
    save();
    const l = layer('text', {
      name: 'short bordered box',
      text: 'Create your own templates ,save them just replace your pattern -Save time , design more -',
      x: 20, y: 40, w: 30, h: 6, z: nextZ(),
      fill: 'transparent', border: '#111111', borderW: 3,
      font: 'Georgia', fontSize: 20, color: '#555555', lineHeight: 1.05, textAlign: 'center', textPadding: 10,
    });
    current().layers.push(l);
    const p = current();
    const canvas = await renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    const boxX0 = Math.round((l.x / 100) * p.w), boxX1 = Math.round(((l.x + l.w) / 100) * p.w);
    const boxY0 = Math.round((l.y / 100) * p.h), boxY1 = Math.round(((l.y + l.h) / 100) * p.h);

    function hasDarkPixel(x0, x1, y0, y1) {
      const w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return false;
      const data = ctx.getImageData(x0, y0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 200 && data[i + 3] > 50) return true; // a dark, visible pixel
      }
      return false;
    }
    // A band well above the box, and well below it - text overflowing the box vertically would
    // land here. The border itself sits right at boxY0/boxY1, so these bands start a few px
    // further out to avoid catching the border stroke itself, only real spilled text.
    const above = hasDarkPixel(boxX0, boxX1, Math.max(0, boxY0 - 60), boxY0 - 8);
    const below = hasDarkPixel(boxX0, boxX1, boxY1 + 8, Math.min(p.h, boxY1 + 60));
    const insideHasText = hasDarkPixel(boxX0 + 10, boxX1 - 10, boxY0 + 6, boxY1 - 6);
    return { above, below, insideHasText };
  });

  expect(result.above).toBe(false);
  expect(result.below).toBe(false);
  expect(result.insideHasText).toBe(true); // sanity check: text still actually renders
});

// Same real report - the padding-formula half of it in isolation: a box just wide enough for a
// phrase to fit on one line live should still fit on one line in the export, not wrap onto a
// second line just because the exporter was reserving the wrong (much bigger) amount of padding.
test('exported text padding matches the live box\'s own formula, not a much larger stand-in that forces extra wrapping', async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--pp-stable-stage-width', '600px');
    window.__ppMeasureStableStageWidth = function(){}; // freeze it so the forced value sticks
    save();
    const l = layer('text', {
      name: 'padding check',
      text: 'just replace your pattern and save your time',
      x: 5, y: 25, w: 37.27, h: 40, z: nextZ(),
      fill: 'transparent', font: 'Georgia', fontSize: 12, color: '#555555', textAlign: 'center', textPadding: 10,
    });
    current().layers.push(l);
  });

  const paintedHeight = await page.evaluate(async () => {
    const p = current();
    const canvas = await renderPageToCanvas(p);
    const ctx = canvas.getContext('2d');
    const boxX0 = Math.round((0.05) * p.w), boxX1 = Math.round((0.05 + 0.3727) * p.w);
    const boxY0 = Math.round(0.25 * p.h), boxY1 = Math.round(0.65 * p.h);
    const w = boxX1 - boxX0, h = boxY1 - boxY0;
    const imgData = ctx.getImageData(boxX0, boxY0, w, h);
    let top = null, bottom = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (imgData.data[idx] < 200) { if (top === null) top = y; bottom = y; break; }
      }
    }
    return top === null ? 0 : bottom - top;
  });

  // At this fontScale the wrong (old) padding formula was roughly 5x bigger than the correct one -
  // enough to force this short phrase onto two lines. With the fix it stays on one, a short
  // painted height, matching what the live box (whose own padding is genuinely this small) shows.
  expect(paintedHeight).toBeGreaterThan(5);
  expect(paintedHeight).toBeLessThan(60);
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

test('the Frame Shadow slider lives inside the frames panel body, not as a detached card next to it', async ({ page }) => {
  // ensureFrameShadowInFrames() used to append the slider directly onto the frames .box
  // itself rather than its .panelBody, so it rendered outside the panel's collapsible
  // content area - a floating card between "frames" and the next panel that stayed visible
  // even while "frames" was collapsed (reported via a screen recording showing exactly
  // that misplacement in both the dark and light themes).
  const slider = page.locator('#frameOnlyShadowSlider');

  // A few independent boot()/setTimeout cycles re-collapse or rebuild panels shortly after
  // load (see expandAllBoxes' own comment above), so keep re-expanding until the slider is
  // actually visible rather than expanding once and hoping it sticks.
  await expect(async () => {
    await expandAllBoxes(page);
    await expect(slider).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000 });

  const parentIsPanelBody = await slider.evaluate((el) => el.closest('.frameShadowBox').parentElement.classList.contains('panelBody'));
  expect(parentIsPanelBody).toBe(true);

  await page.evaluate(() => {
    const h2 = Array.from(document.querySelectorAll('.box>h2,.box h2')).find((h) => h.textContent.trim() === 'frames');
    if (h2) h2.click();
  });
  await expect(slider).toBeHidden();
});
