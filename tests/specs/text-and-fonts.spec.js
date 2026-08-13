// addText/addBadge (each superseded several dead wraps during cleanup - Phase 0, 22/N) and
// the Font Matchmaker's applyGeneratedFontPair (Phase 0, 30/N): both still auto-unlock legacy
// locked text on re-render, and font pairing still applies through the normal text controls.
const { test, expect } = require('../support/fixtures');

test.use({ hasTouch: true });

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

test('double-tapping text opens the floating editor, hides resize handles, and Done cleans up fully', async ({ page }) => {
  // Three real bugs here, all from CSS/JS added in later patches without accounting for what
  // pp-text-v176-js ("GOLDEN CAGE TEXT SURGERY") already relied on:
  // 1. pp-text-free-the-box-css's .stage .layer.text.selected > .handle (and .resizeHint/
  //    .rotateHandle) rules have 5 classes of specificity, beating v176's own 4-class
  //    .ppTextEditing176 .handle{display:none} rule regardless of which is later in the
  //    document - so the resize handles stayed visible on top of the floating textarea while
  //    editing. Fixed by adding .selected to the hide-rule's own selector.
  // 2. The Done button registered two capture-phase click/touchend/pointerup listeners on
  //    itself: a generic "stop everything" one (registered first) and the actual cleanup one
  //    (registered second). stopImmediatePropagation() in the first silently killed the
  //    second, so Done never removed the floating textarea/button - tapping it just left the
  //    editor sitting there, overlapping the now-"selected" canvas layer underneath.
  // 3. pp-text-free-the-box-js's bindTextNode() installed its own duplicate pointerdown/
  //    pointermove/pointerup drag+select handler directly on every text/label node (on top of
  //    the universal makeDraggable(), which the base renderLayer already attaches to every
  //    layer and which doesn't care about l.locked). On pointerup its temporary WINDOW-level
  //    capture-phase listener fired before the event ever reached document, and called
  //    stopPropagation() - silently swallowing the touchend/pointerup half of every real
  //    double-tap gesture before pp-text-v176-js's document-level double-tap detector ever saw
  //    it, so the floating editor could never open for a real touchscreen tap. This didn't show
  //    up in a touch-only synthetic test (below) because real touch devices fire BOTH pointer
  //    events and touch events for the same physical gesture - the tap() helper now fires both,
  //    matching real hardware, specifically so this class of bug gets caught again if it
  //    reappears. Fixed by removing bindTextNode's duplicate handler.
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__nextPointerId = 500;
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
    window.__fireTouch = (type, touches, changed, target) => {
      target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
    };
  });

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Real touchscreens fire a PointerEvent alongside each TouchEvent for the same physical tap
  // (pointerdown/pointerup, pointerType:'touch') - dispatch both, in real device order, so this
  // test exercises the same event interference a real device produces.
  async function tap(x, y) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const id = window.__nextPointerId++;
      const t = window.__mkTouch(id, x, y, el);
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      window.__fireTouch('touchstart', [t], [t], el);
      setTimeout(() => {
        const el2 = document.elementFromPoint(x, y);
        el2.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
        window.__fireTouch('touchend', [], [t], el2);
      }, 20);
    }, { x, y });
    await page.waitForTimeout(60);
  }

  // Two quick taps = the app's own double-tap detector (separate from native dblclick).
  await tap(cx, cy);
  await page.waitForTimeout(100);
  await tap(cx, cy);
  await page.waitForTimeout(300);

  const duringEdit = await page.evaluate((id) => {
    const node = document.querySelector(`.layer[data-id="${id}"]`);
    return {
      isEditing: node.classList.contains('ppTextEditing176'),
      hasTextarea: !!document.querySelector('.ppTextArea176'),
      handleDisplay: getComputedStyle(node.querySelector('.handle')).display,
      resizeHintDisplay: getComputedStyle(node.querySelector('.resizeHint')).display,
    };
  }, layerId);
  expect(duringEdit.isEditing).toBe(true);
  expect(duringEdit.hasTextarea).toBe(true);
  expect(duringEdit.handleDisplay).toBe('none');
  expect(duringEdit.resizeHintDisplay).toBe('none');

  await page.locator('.ppTextArea176').fill('typed via test');
  await page.locator('.ppTextDone176').click();
  await page.waitForTimeout(300);

  const afterDone = await page.evaluate((id) => ({
    layerText: state.pages[0].layers.find((l) => l.id === id).text,
    nodeSelected: document.querySelector(`.layer[data-id="${id}"]`).classList.contains('selected'),
    stillEditing: document.querySelector(`.layer[data-id="${id}"]`).classList.contains('ppTextEditing176'),
    hasTextarea: !!document.querySelector('.ppTextArea176'),
    hasDoneBtn: !!document.querySelector('.ppTextDone176'),
  }), layerId);
  expect(afterDone.layerText).toBe('typed via test');
  expect(afterDone.nodeSelected).toBe(true);
  expect(afterDone.stillEditing).toBe(false);
  expect(afterDone.hasTextarea).toBe(false);
  expect(afterDone.hasDoneBtn).toBe(false);
});

test('double-tapping text calls preventDefault on both taps, blocking iOS Safari\'s native double-tap-zoom', async ({ page }) => {
  // A real bug: stop() in pp-text-v176-js only called stopPropagation()/stopImmediatePropagation(),
  // which stops the app's OWN listeners from seeing the event but has zero effect on the browser's
  // built-in double-tap-to-zoom gesture (a separate, lower-level mechanism keyed off whether
  // preventDefault() was called on the touch events themselves). Two rapid taps on text could
  // trigger Safari's native "zoom to fit this element" at the same moment the app opened its own
  // editor, leaving the whole page - canvas AND side panels - stuck zoomed in with no way back to
  // 100% short of a manual pinch. Fixed by calling preventDefault() in handleTap() for every tap
  // on a text/label layer, not just the second one that opens the editor.
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
  });

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  async function tapAndCheckPrevented(x, y) {
    return page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const t = window.__mkTouch(1, x, y, el);
      const touchend = new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      el.dispatchEvent(touchend);
      return touchend.defaultPrevented;
    }, { x, y });
  }

  const firstTapPrevented = await tapAndCheckPrevented(cx, cy);
  await page.waitForTimeout(100);
  const secondTapPrevented = await tapAndCheckPrevented(cx, cy);

  expect(firstTapPrevented).toBe(true);
  expect(secondTapPrevented).toBe(true);
});

test('Montserrat, Roboto, Lato, Bebas Neue, Anton, League Spartan, and Inter are embedded and actually load (not just listed)', async ({ page }) => {
  // Real request: add fonts similar to Montserrat (Roboto, Lato) plus something bold for
  // sale/promo graphics (Bebas Neue, then Anton and League Spartan after the user found them
  // in their own research and asked whether they were actually free to use - verified each
  // against Google Fonts directly before adding: these three plus Inter are real Google Fonts
  // under the SIL Open Font License (free to embed/redistribute); several others the same
  // search turned up (Wild & Youth, Glitten, Tan Horizon/Tan Mon Chéri, Glacial Indifference)
  // are not on Google Fonts at all - paid marketplace fonts that were left out since embedding
  // them here without a purchased license wouldn't be legal. Since this app has to keep working
  // with zero external requests, all seven are embedded directly as data: URI @font-face rules
  // rather than linked from Google's CDN. This checks they don't just appear as dropdown
  // options but actually resolve to a loadable font face, not a silent fallback to the default.
  const fonts = ['Montserrat', 'Roboto', 'Lato', 'Bebas Neue', 'Anton', 'League Spartan', 'Inter'];
  const results = {};
  for (const font of fonts) {
    results[font] = await page.evaluate(async (f) => {
      await document.fonts.load(`16px "${f}"`);
      return {
        loaded: document.fonts.check(`16px "${f}"`),
        hasOption: [...document.getElementById('fontFamily').options].some((o) => o.value === f),
      };
    }, font);
  }
  for (const font of fonts) {
    expect(results[font].loaded, `${font} loaded`).toBe(true);
    expect(results[font].hasOption, `${font} listed in dropdown`).toBe(true);
  }
});

test('a native page zoom (double-tap slipping past prevention, or an unblockable iOS pinch) gets snapped back to 1x automatically', async ({ page }) => {
  // Real report + screen recording: double-tapping a text layer to edit it sometimes left the
  // whole app - header, canvas AND both side panels - stuck visibly zoomed in, with the text
  // editor never opening and no way back except manually pinching back out. pp-text-v176-js's
  // own double-tap handler already calls preventDefault(), and the viewport meta tag already
  // sets maximum-scale=1.0/user-scalable=no, but iOS has ignored user-scalable=no for actual
  // two-finger pinch since iOS 10 (an unblockable accessibility feature), and any single missed
  // tap/timing edge case can let a native double-tap-zoom through too - no combination of
  // preventDefault/meta tags can promise 100% prevention. Instead of only trying to prevent it,
  // pp-global-anti-zoom watches visualViewport for a scale creeping above 1x and snaps it back
  // down - simulated here since Chromium's own visualViewport.scale isn't driven by real pinch
  // gestures in a headless test.
  const originalContentBefore = await page.evaluate(() => document.querySelector('meta[name="viewport"]').getAttribute('content'));

  // Record every content value the meta tag passes through, not just the final one - the fix
  // briefly appends ", maximum-scale=1.0" then restores the original string 60ms later, and
  // without the fix nothing touches the tag at all, which would otherwise (wrongly) look
  // identical to "already back to normal" if only the end state were checked.
  await page.evaluate(() => {
    window.__ppMetaValues = [];
    const meta = document.querySelector('meta[name="viewport"]');
    window.__ppMetaObserver = new MutationObserver(() => window.__ppMetaValues.push(meta.getAttribute('content')));
    window.__ppMetaObserver.observe(meta, { attributes: true });
    Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => 1.6 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  // The reset briefly appends ", maximum-scale=1.0" to the meta content, then restores the
  // original string 60ms later - wait past that round trip before checking the end state.
  await page.waitForTimeout(200);

  const { values, contentAfter } = await page.evaluate(() => ({
    values: window.__ppMetaValues,
    contentAfter: document.querySelector('meta[name="viewport"]').getAttribute('content'),
  }));
  expect(values.some((v) => v && v.includes('maximum-scale=1.0') && v !== originalContentBefore)).toBe(true);
  expect(contentAfter).toBe(originalContentBefore);

  // A scale that's already at/under 1x (nothing to fix) must not trigger any meta tag churn.
  let mutated = false;
  await page.evaluate(() => {
    window.__ppMetaObserver = new MutationObserver(() => { window.__ppMetaMutated = true; });
    window.__ppMetaObserver.observe(document.querySelector('meta[name="viewport"]'), { attributes: true });
    Object.defineProperty(window.visualViewport, 'scale', { configurable: true, get: () => 1.0 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(150);
  mutated = await page.evaluate(() => !!window.__ppMetaMutated);
  expect(mutated).toBe(false);
});
