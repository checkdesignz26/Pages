// Touch gestures on the canvas: three-finger tap = undo, three-finger double-tap = redo
// (Apple's system editing gesture), hold the selected layer with one finger then tap with a
// second to duplicate it (Affinity Designer style), and pinch-to-zoom keeps working when the
// pinch starts on the page itself.
//
// These are dispatched as real `TouchEvent`s built with the `Touch` constructor rather than via
// CDP's `Input.dispatchTouchEvent` - CDP silently drops a touchend when a previous touchend in
// the same sequence already partially released a multi-touch gesture, which made these flaky
// for reasons that had nothing to do with the app. Touch identifiers are minted from a single
// incrementing counter per test (never reused), matching how real touch hardware assigns them -
// reusing small ids (0, 1, ...) across unrelated gestures can trip the app's own staleness
// recovery, which specifically checks "is this id still an active touch," not "is this a fresh
// gesture."
const { test, expect } = require('../support/fixtures');

test.use({ hasTouch: true });

async function installTouchHelpers(page) {
  await page.evaluate(() => {
    window.__nextTouchId = 1;
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
    window.__fireTouch = (type, touches, changed, target) => {
      target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
    };
  });
}

async function nFingerTap(page, x, y, n) {
  await page.evaluate(({ x, y, n }) => {
    const el = document.elementFromPoint(x, y);
    const touches = [];
    for (let i = 0; i < n; i++) touches.push(window.__mkTouch(window.__nextTouchId++, x + i * 5, y + i * 5, el));
    window.__lastTapTouches = touches;
    window.__fireTouch('touchstart', touches, touches, el);
  }, { x, y, n });
  await page.waitForTimeout(60);
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    window.__fireTouch('touchend', [], window.__lastTapTouches, el);
  }, { x, y });
}

async function holdThenTap(page, x, y, tapX, tapY, holdMs) {
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    window.__holdEl = el;
    window.__holdT0 = window.__mkTouch(window.__nextTouchId++, x, y, el);
    window.__fireTouch('touchstart', [window.__holdT0], [window.__holdT0], el);
  }, { x, y });
  await page.waitForTimeout(holdMs);
  await page.evaluate(({ tapX, tapY }) => {
    const elB = document.elementFromPoint(tapX, tapY);
    window.__tapEl = elB;
    window.__tapT1 = window.__mkTouch(window.__nextTouchId++, tapX, tapY, elB);
    window.__fireTouch('touchstart', [window.__holdT0, window.__tapT1], [window.__tapT1], elB);
  }, { tapX, tapY });
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__fireTouch('touchend', [window.__holdT0], [window.__tapT1], window.__tapEl));
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__fireTouch('touchend', [], [window.__holdT0], window.__holdEl));
}

async function pinch(page, x, y, startOffset, endOffset) {
  await page.evaluate(({ x, y, startOffset }) => {
    const elA = document.elementFromPoint(x - startOffset, y);
    const elB = document.elementFromPoint(x + startOffset, y);
    window.__pinchA = window.__mkTouch(window.__nextTouchId++, x - startOffset, y, elA);
    window.__pinchB = window.__mkTouch(window.__nextTouchId++, x + startOffset, y, elB);
    window.__pinchElA = elA;
    window.__fireTouch('touchstart', [window.__pinchA, window.__pinchB], [window.__pinchA, window.__pinchB], elA);
  }, { x, y, startOffset });
  await page.waitForTimeout(30);
  await page.evaluate(({ x, y, endOffset }) => {
    const elA = document.elementFromPoint(x - endOffset, y);
    const elB = document.elementFromPoint(x + endOffset, y);
    const a = window.__mkTouch(window.__pinchA.identifier, x - endOffset, y, elA);
    const b = window.__mkTouch(window.__pinchB.identifier, x + endOffset, y, elB);
    window.__fireTouch('touchmove', [a, b], [a, b], elA);
  }, { x, y, endOffset });
  await page.waitForTimeout(30);
  await page.evaluate(() => window.__fireTouch('touchend', [], [window.__pinchA, window.__pinchB], window.__pinchElA));
}

async function stageCentre(page) {
  const box = await page.locator('.stage').first().boundingBox();
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

test('pinch-to-zoom still works when the pinch starts on the page itself', async ({ page }) => {
  await installTouchHelpers(page);
  const { cx, cy } = await stageCentre(page);
  const zoomBefore = await page.evaluate(() => state.zoom);
  await pinch(page, cx, cy, 40, 110);
  await page.waitForTimeout(150);
  const zoomAfter = await page.evaluate(() => state.zoom);
  expect(zoomAfter).toBeGreaterThan(zoomBefore);
});

// Real report, with screenshots: pinch-zooming the canvas also nudged whichever image happened
// to be under one of the two fingers. touchstart/pointerdown fire per-finger, not atomically for
// both fingers at once - on a real device, the first finger lands and starts an ordinary
// single-finger drag (see makeDraggable's own pointerdown listener) a beat before the second
// finger lands and installCanvasGestures() recognizes the pinch. That first finger's own
// continuing pointermove events (fingers naturally spread apart during a pinch) then kept right
// on dragging the layer underneath, on top of the zoom happening at the same time.
test('pinch-to-zoom does not also drag the layer under one of the fingers', async ({ page }) => {
  await installTouchHelpers(page);
  await page.evaluate(() => addText('text'));
  await page.waitForTimeout(150);
  const layerId = await page.evaluate(() => state.selected);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const before = await page.evaluate(
    (id) => {
      const l = current().layers.find((x) => x.id === id);
      return { x: l.x, y: l.y, w: l.w, h: l.h };
    },
    layerId
  );

  const fx = box.x + box.width / 2;
  const fy = box.y + box.height / 2; // first finger: right on the layer
  const sx = fx + 250;
  const sy = fy; // second finger: far away on empty page

  // The first finger lands on the layer and starts a normal drag, exactly as a real touch would
  // (pointerdown fires immediately, well before the second finger even lands). Simulated with a
  // real (CDP-dispatched) pointer via page.mouse rather than a JS-constructed PointerEvent -
  // makeDraggable's pointerdown calls setPointerCapture, which throws on a synthetic pointerId
  // the browser never actually saw as active. makeDraggable itself doesn't distinguish mouse
  // from touch for an isPrimary pointer, so this exercises the exact same drag code path.
  await page.mouse.move(fx, fy);
  await page.mouse.down();

  // The second finger lands - the app's own pinch detector now sees two touches. This alone
  // doesn't touch the DOM yet (no zoom change until the fingers actually move), so the layer
  // element the drag above is bound to is still the live, attached one.
  await page.evaluate(({ fx, fy, sx, sy }) => {
    const elA = document.elementFromPoint(fx, fy);
    const elB = document.elementFromPoint(sx, sy);
    window.__tA = window.__mkTouch(window.__nextTouchId++, fx, fy, elA);
    window.__tB = window.__mkTouch(window.__nextTouchId++, sx, sy, elB);
    window.__fireTouch('touchstart', [window.__tA, window.__tB], [window.__tA, window.__tB], elA);
  }, { fx, fy, sx, sy });

  // The finger that landed on the layer keeps moving, exactly as it would during a pinch (both
  // fingers spread apart) - checked here, before any zoom-driven re-render can detach the
  // element the mouse-down above is bound to and release its pointer capture, so this genuinely
  // exercises whether makeDraggable's own pointermove handler still applies the movement.
  const fx2 = fx - 60;
  await page.mouse.move(fx2, fy);
  await page.waitForTimeout(50);

  // The pinch itself still completes normally (both touches actually spreading, past the zoom
  // threshold) - confirms the fix didn't come at the cost of breaking pinch-to-zoom.
  const sx2 = sx + 60;
  await page.evaluate(({ fx2, fy, sx2, sy }) => {
    const elA = document.elementFromPoint(fx2, fy);
    const elB = document.elementFromPoint(sx2, sy);
    const a = window.__mkTouch(window.__tA.identifier, fx2, fy, elA);
    const b = window.__mkTouch(window.__tB.identifier, sx2, sy, elB);
    window.__fireTouch('touchmove', [a, b], [a, b], elA);
  }, { fx2, fy, sx2, sy });
  await page.waitForTimeout(100);
  await page.mouse.up();

  const after = await page.evaluate(
    (id) => {
      const l = current().layers.find((x) => x.id === id);
      return { x: l.x, y: l.y, w: l.w, h: l.h };
    },
    layerId
  );
  expect(after).toEqual(before);

  await page.evaluate(() => window.__fireTouch('touchend', [], [window.__tA, window.__tB], document.body));
});

test('three-finger tap undoes, three-finger double-tap redoes', async ({ page }) => {
  await installTouchHelpers(page);
  const { cx, cy } = await stageCentre(page);
  await page.evaluate(() => addText('text'));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => state.pages[0].layers.length);

  await nFingerTap(page, cx, cy, 3);
  await page.waitForTimeout(600); // past the double-tap disambiguation window
  expect(await page.evaluate(() => state.pages[0].layers.length)).toBe(before - 1);

  await nFingerTap(page, cx, cy, 3);
  await page.waitForTimeout(120);
  await nFingerTap(page, cx, cy, 3);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => state.pages[0].layers.length)).toBe(before);
});

test('holding the selected layer then tapping with a second finger duplicates it', async ({ page }) => {
  await installTouchHelpers(page);
  const { cx, cy } = await stageCentre(page);
  await page.evaluate(() => { addText('text'); state.selected = state.pages[0].layers[0].id; render(); });
  const before = await page.evaluate(() => state.pages[0].layers.length);

  await holdThenTap(page, cx, cy, cx + 120, cy + 120, 450);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => state.pages[0].layers.length)).toBe(before + 1);
});

test('a plain two-finger tap and a short (sub-hold) tap-tap do not duplicate or undo', async ({ page }) => {
  await installTouchHelpers(page);
  const { cx, cy } = await stageCentre(page);
  await page.evaluate(() => { addText('text'); state.selected = state.pages[0].layers[0].id; render(); });
  const before = await page.evaluate(() => state.pages[0].layers.length);

  await nFingerTap(page, cx, cy, 2);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => state.pages[0].layers.length)).toBe(before);

  await holdThenTap(page, cx, cy, cx + 120, cy + 120, 50); // well under the hold threshold
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => state.pages[0].layers.length)).toBe(before);
});
