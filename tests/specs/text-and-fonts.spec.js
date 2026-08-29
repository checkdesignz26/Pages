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

// Real report: "it always duplicates the text layer" - applying a font pair with only one text
// box on the page silently adds a second "subtitle text" layer (ensurePair(), by design, so the
// pairing has somewhere to put the second font) with zero indication that anything beyond a font
// change had happened. The extra layer is intentional, but the silence made it read as a bug.
test('applying a font pair to a lone text layer explains the new subtitle it adds, instead of silently duplicating', async ({ page }) => {
  const result = await page.evaluate(() => {
    save();
    addText('text');
    const l = current().layers[current().layers.length - 1];
    state.selected = l.id;
    render();
    const before = current().layers.length;
    applyGeneratedFontPair('Playfair Display', 'Avenir Next');
    return {
      before,
      after: current().layers.length,
      hint: document.getElementById('selectedHint').textContent,
    };
  });

  expect(result.after).toBe(result.before + 1);
  expect(result.hint.toLowerCase()).toContain('subtitle');
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

// Real report, with a screen recording: after loading a template, double-tapping ANY text (even
// a brand new layer, nothing to do with the template) silently did nothing at all - until a full
// page refresh fixed it. handleTap's very first line is `if(active)return;`, and nothing outside
// the text-editor script could ever reset `active` back to null - leaving a text editor open
// (Done never tapped) right as a template/project load wholesale replaces state.pages left
// `active` stuck forever, pointing at a now-detached layer, silently blocking every future
// double-tap for the rest of the session.
test('loading a template while the floating text editor is still open does not permanently break double-tap-to-edit', async ({ page }) => {
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

  await page.evaluate(() => { addText('first'); });
  await page.evaluate(() => {
    window.__nextPointerId = 700;
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
    window.__fireTouch = (type, touches, changed, target) => {
      target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
    };
  });
  const firstId = await page.evaluate(() => state.pages[0].layers[0].id);
  const firstBox = await page.locator(`.layer[data-id="${firstId}"]`).boundingBox();
  await tap(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.waitForTimeout(100);
  await tap(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => !!document.querySelector('.ppTextArea176'))).toBe(true); // editor genuinely open

  // Load a template WITHOUT ever tapping Done first - the real scenario from the report.
  await page.evaluate(() => {
    window.__origAlert = window.alert;
    window.alert = () => {};
    const templateData = { app: 'Pattern Pages', kind: 'ptemplate', pages: [{ type: 'listing', w: 3000, h: 2250, layers: [
      { id: 'img1', type: 'image', name: 'placeholder', patternSlot: true, src: null, x: 10, y: 10, w: 30, h: 30, z: 1, opacity: 1, scale: 1 },
    ] }], selectedPage: 0 };
    const file = new File([JSON.stringify(templateData)], 'test.ptemplate', { type: 'application/json' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.createElement('input');
    input.type = 'file';
    input.files = dt.files;
    return new Promise((resolve) => {
      window.loadPatternPagesTemplate({ target: input });
      setTimeout(() => { window.alert = window.__origAlert; resolve(); }, 300);
    });
  });
  await page.waitForTimeout(200);

  // Add a brand new text layer - nothing to do with the template - and try to double-tap it.
  await page.evaluate(() => { addText('second'); });
  await page.waitForTimeout(200);
  const secondId = await page.evaluate(() => state.selected);
  const secondBox = await page.locator(`.layer[data-id="${secondId}"]`).boundingBox();
  await tap(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.waitForTimeout(100);
  await tap(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => !!document.querySelector('.ppTextArea176'))).toBe(true);
});

test('tapping an unselected text layer once (then again quickly, out of habit) only selects it - it takes a deliberate double-tap on an already-selected layer to edit', async ({ page }) => {
  // Real report: "it still wants to edit the text with one click/tap". The tap that FIRST
  // selects a layer (transitioning it from unselected to selected) used to be eligible to arm
  // or close handleTap's own double-tap-to-edit pair just like any other tap - so a user tapping
  // once to select, then quickly tapping again (a natural "did that register?" reflex, or aiming
  // for a nearby control) landed well inside the 430ms window and popped the floating editor
  // open, which read as "one tap opens it" even though it was technically two. Only a tap on a
  // layer that was ALREADY selected before its own gesture began should be able to arm/close
  // that pair now. Start from a genuinely unselected layer (not the auto-selected state
  // addText() leaves behind) to match the real scenario.
  await page.evaluate(() => { addText('text'); state.selected = null; render(); });
  await page.waitForTimeout(200);

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Real CDP-level touch dispatch (not hand-built DOM events) - it goes through the actual
  // browser input pipeline, so pointerdown carries a genuinely active pointer (isPrimary,
  // setPointerCapture-eligible) exactly like a real device tap, unlike a manually constructed
  // PointerEvent/TouchEvent pair.
  async function tap(x, y) {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(60);
  }

  const wasUnselected = await page.evaluate(() => state.selected == null);
  expect(wasUnselected).toBe(true);

  // Tap 1: selects the previously-unselected layer.
  await tap(cx, cy);
  await page.waitForTimeout(100);
  // Tap 2, still well inside the double-tap window: the exact "quick re-tap right after
  // selecting" the report describes. Must NOT open the editor on its own.
  await tap(cx, cy);
  await page.waitForTimeout(300);

  const afterTwoTaps = await page.evaluate((id) => ({
    selected: state.selected === id,
    hasTextarea: !!document.querySelector('.ppTextArea176'),
  }), layerId);
  expect(afterTwoTaps.selected).toBe(true);
  expect(afterTwoTaps.hasTextarea).toBe(false);

  // Tap 3, inside the window of tap 2: the layer has now been selected since before THIS tap's
  // own gesture began, so this is a genuine deliberate double-tap on an already-selected layer -
  // must open the editor, matching the existing "double-tapping text opens the floating editor"
  // behavior.
  await tap(cx, cy);
  await page.waitForTimeout(300);

  const afterThirdTap = await page.evaluate(() => !!document.querySelector('.ppTextArea176'));
  expect(afterThirdTap).toBe(true);
});

test('tapping delete on a text layer right after selecting it deletes it - the editor does not jump up instead', async ({ page }) => {
  // Real bug from a user recording: tap once to select a text layer (arms handleTap's
  // double-tap window), then tap the delete "x" on its boundary box to remove it. The "x"
  // button is a child of .layer.text, so textNodeFromEvent's closest('.stage .layer.text,
  // .stage .layer.label') matched it too - the tap on delete satisfied the double-tap window
  // and opened the floating editor instead of deleting. The delete button's own listener then
  // still fired afterward (preventDefault() doesn't stop propagation), deleting the layer out
  // from under the editor that had just opened for it. Fixed by excluding taps on
  // .deleteMini/.handle/.rotateHandle/.resizeHint from counting as a tap on the text layer.
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
  });

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);

  // A bare touchend is all handleTap (arming/consuming the double-tap window) and a control's
  // own touchend listener need - real device order without pointerdown/setPointerCapture noise
  // that has nothing to do with the bug under test.
  async function tapTouchend(el) {
    await el.evaluate((node) => {
      const t = new Touch({ identifier: Date.now() + Math.random(), target: node, clientX: 0, clientY: 0 });
      node.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
    });
  }

  // Tap 1: select the layer (arms handleTap's double-tap window for this layer's id).
  await page.evaluate((id) => { window.selectLayer(id); }, layerId);
  await tapTouchend(page.locator(`.layer[data-id="${layerId}"]`));
  await page.waitForTimeout(80);

  // Tap 2: tap the delete "x" - within the double-tap window, on an element nested inside
  // .layer.text.
  await tapTouchend(page.locator(`.layer[data-id="${layerId}"] .deleteMini`));
  await page.waitForTimeout(200);

  const after = await page.evaluate((id) => ({
    hasTextarea: !!document.querySelector('.ppTextArea176'),
    stillExists: state.pages[0].layers.some((l) => l.id === id),
    nodeStillInDom: !!document.querySelector(`.layer[data-id="${id}"]`),
  }), layerId);
  expect(after.hasTextarea).toBe(false);
  expect(after.stillExists).toBe(false);
  expect(after.nodeStillInDom).toBe(false);
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

// Real request: add Lora (elegant serif) and Liberation Sans (clean sans) to the font list and
// the font matchmaker. Different provenance from the batch above - Lora is a Google Font under
// the SIL Open Font License like the others, but Liberation Sans comes from Red Hat's Liberation
// Fonts project instead (also SIL OFL, free to embed/redistribute; it's the metric-compatible
// Arial replacement bundled with most Linux distros). Embedded the same way: data: URI @font-face
// rules, zero external requests.
test('Lora and Liberation Sans are embedded, actually load, and are wired into the font matchmaker', async ({ page }) => {
  const fonts = ['Lora', 'Liberation Sans'];
  for (const font of fonts) {
    const result = await page.evaluate(async (f) => {
      await document.fonts.load(`16px "${f}"`);
      return {
        loaded: document.fonts.check(`16px "${f}"`),
        hasFontDropdownOption: [...document.getElementById('fontFamily').options].some((o) => o.value === f),
        hasMatchmakerOption: [...document.getElementById('matchBaseFont').options].some((o) => o.value === f),
      };
    }, font);
    expect(result.loaded, `${font} loaded`).toBe(true);
    expect(result.hasFontDropdownOption, `${font} listed in the font dropdown`).toBe(true);
    expect(result.hasMatchmakerOption, `${font} listed as a matchmaker base font`).toBe(true);
  }

  // Picking either one as the matchmaker's base font should generate real suggestions that
  // reference it, not silently fall back to Georgia's default matches.
  for (const font of fonts) {
    const matches = await page.evaluate((f) => {
      const sel = document.getElementById('matchBaseFont');
      sel.value = f;
      generateFontMatches();
      return [...document.querySelectorAll('#fontMatchResults .fontPairBtn .pairFonts strong')].map((el) => el.textContent);
    }, font);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((heading) => heading === font), `all suggested headings are ${font}`).toBe(true);
  }
});

// Real report: "add inter font family like extra bold and bold it isn't distinctive enough".
// The embedded Inter file turned out to be a static, single-weight (400/Regular) font - toggling
// "bold" on Inter text asked for font-weight:900 (see toggleBold()/l.bold throughout this file),
// but with no real bold outlines available the browser could only fake it with synthetic/faux
// bold, which looks weak and barely different from the regular weight. Swapped in Google's actual
// variable Inter file (weight axis 100-900) under the same 'Inter' family, so font-weight:900
// now resolves to Inter's own real Black weight instead of a synthetic fatten - and added a new
// always-heavy 'Inter Extra Bold' family (pinned to the variable font's 900/Black instance, the
// same trick League Spartan already uses to always render bold-looking) as its own selectable
// option for a heavy look without needing the bold toggle at all. Pinned at 900 rather than the
// in-between 800 (ExtraBold) after a follow-up report: toggling "bold" on plain Inter reaches
// 900 too, and an 800 Extra Bold face was actually LESS bold than that - the opposite of what its
// name promised. 900 is the variable font's own ceiling, so this is as heavy as either can go.
test('Inter has a real (not synthetic) bold weight, and Inter Extra Bold is its own selectable, always-heavy font', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await document.fonts.load('500 16px "Inter"');
    await document.fonts.load('900 16px "Inter"');
    await document.fonts.load('16px "Inter Extra Bold"');

    function inkCount(family, weight) {
      const c = document.createElement('canvas'); c.width = 300; c.height = 60;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 300, 60);
      ctx.fillStyle = '#000';
      ctx.font = `${weight} 40px "${family}"`;
      ctx.fillText('Bold Weight', 10, 40);
      const data = ctx.getImageData(0, 0, 300, 60).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] < 200) count++;
      return count;
    }

    return {
      hasOption: [...document.getElementById('fontFamily').options].some((o) => o.value === 'Inter Extra Bold'),
      normalLoaded: document.fonts.check('500 16px "Inter"'),
      boldLoaded: document.fonts.check('900 16px "Inter"'),
      extraBoldLoaded: document.fonts.check('16px "Inter Extra Bold"'),
      // Same weight (500) requested from Inter vs Inter Extra Bold must look different - Extra
      // Bold ignores the requested weight and always renders its own pinned heavy instance.
      inkNormal: inkCount('Inter', '500'),
      inkBold: inkCount('Inter', '900'),
      inkExtraBold: inkCount('Inter Extra Bold', '500'),
    };
  });

  expect(result.hasOption, 'Inter Extra Bold listed in the font dropdown').toBe(true);
  expect(result.normalLoaded).toBe(true);
  expect(result.boldLoaded).toBe(true);
  expect(result.extraBoldLoaded).toBe(true);
  // A real bold weight has noticeably more ink than regular - a synthetic/faux bold (what a
  // single-weight static font falls back to) is only marginally thicker than this, so a
  // generous margin also catches a regression back to the old static file.
  expect(result.inkBold).toBeGreaterThan(result.inkNormal * 1.2);
  expect(result.inkExtraBold).toBeGreaterThan(result.inkNormal * 1.2);
  // Real follow-up report: "Inter actually looks bolder than Inter Extra Bold" - Extra Bold must
  // never render lighter than Inter's own bold toggle, or its name is a lie.
  expect(result.inkExtraBold).toBeGreaterThanOrEqual(result.inkBold);
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

test('double-tap-to-edit keeps working after a plain tap, even when pointerup races ahead of that tap\'s own touchend', async ({ page }) => {
  // Real report + screen recording: double-tap-to-edit worked the first time, then failed
  // intermittently afterwards - "sometimes it comes up, sometimes it doesn't". Root cause:
  // makeDraggable()'s pointerup handler called the full, destructive renderPages() (which does
  // wrap.innerHTML='' and rebuilds every page's layer DOM from scratch) unconditionally on
  // EVERY tap, not just real drags - despite already computing an unused `wasDrag` flag meant
  // for exactly this. On a real touchscreen, pointerup for a tap can fire before that same
  // tap's own touchend. When it does, the rebuild replaces the layer node out from under the
  // gesture before touchend arrives, so pp-text-v176-js's touchend-based double-tap detector
  // finds its tap target already detached from the document (closest() on a detached node
  // can't find anything) and silently drops that tap - some taps get lost depending on
  // per-device event timing. Fixed by only doing the destructive rebuild when a real
  // drag/resize/rotate happened (wasDrag), and clearing other layers' stale selection classes
  // by hand otherwise.
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
  });

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // Fires touchstart + pointerdown, then pointerup BEFORE touchend - the exact real-device
  // ordering that exposed the bug - for a single plain tap (no movement).
  async function tapWithPointerupFirst(x, y) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const id = Math.floor(Math.random() * 1e6);
      const t = window.__mkTouch(id, x, y, el);
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      const t2 = window.__mkTouch(id, x, y, el);
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t2], bubbles: true, cancelable: true }));
    }, { x, y });
    await page.waitForTimeout(60);
  }

  // A single plain tap first (the kind that used to trigger the destructive rebuild) - spaced
  // well past handleTap's own 430ms double-tap window so it can't accidentally pair up with the
  // real double-tap below.
  await tapWithPointerupFirst(cx, cy);
  await page.waitForTimeout(600);
  // ... then the real double-tap, using the same pointerup-before-touchend ordering for each tap.
  await tapWithPointerupFirst(cx, cy);
  await page.waitForTimeout(100);
  await tapWithPointerupFirst(cx, cy);
  await page.waitForTimeout(300);

  const hasEditor = await page.evaluate(() => !!document.querySelector('.ppTextArea176'));
  expect(hasEditor).toBe(true);
});

test('the floating text editor stays open - an unrelated pointerup listener does not close it 40ms after it opens', async ({ page }) => {
  // Real report + screen recording, second bug found while chasing the one above: even after
  // fixing makeDraggable(), double-tap-to-edit would open the editor and then it would vanish
  // again moments later on its own. Root cause: a completely separate listener (originally added
  // to fix z-ordering for horizontal pattern "stash" strips after a drag) runs on EVERY pointerup
  // anywhere in the app and, 40ms later, unconditionally calls the same destructive renderPages()
  // rebuild - wiping the 'ppTextEditing176' class pp-text-v176-js had just added, since that's
  // runtime-only editor state that a fresh render never reconstructs. The second tap of every
  // double-tap fires its own pointerup right as the editor opens, so this fired almost every
  // time, closing the editor ~40ms after it appeared. Fixed by exposing
  // window.__ppCanvasTextEditorActive() and skipping the rebuild while it's open.
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    window.__mkTouch = (id, x, y, target) => new Touch({ identifier: id, target, clientX: x, clientY: y, pageX: x, pageY: y });
    window.__fireTouch = (type, touches, changed, target) => {
      target.dispatchEvent(new TouchEvent(type, { touches, targetTouches: touches, changedTouches: changed, bubbles: true, cancelable: true }));
    };
  });

  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  const box = await page.locator(`.layer[data-id="${layerId}"]`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  async function tap(x, y) {
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const id = Math.floor(Math.random() * 1e6);
      const t = window.__mkTouch(id, x, y, el);
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      window.__fireTouch('touchstart', [t], [t], el);
      const el2 = document.elementFromPoint(x, y);
      el2.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, clientX: x, clientY: y }));
      window.__fireTouch('touchend', [], [t], el2);
    }, { x, y });
    await page.waitForTimeout(60);
  }

  await tap(cx, cy);
  await page.waitForTimeout(100);
  await tap(cx, cy);
  await page.waitForTimeout(120); // spans the 40ms delayed z-order-fix/renderPages call

  const state = await page.evaluate((id) => {
    // The floating textarea itself lives on document.body, entirely separate from the canvas -
    // rebuilding the canvas wouldn't remove it. The real symptom is the canvas layer losing its
    // editing class (and the app's internal editor reference going stale/detached) once a fresh
    // render replaces the node - check the layer looked up fresh by id, not the textarea.
    const node = document.querySelector(`.layer[data-id="${id}"]`);
    return {
      hasTextarea: !!document.querySelector('.ppTextArea176'),
      layerIsEditing: node ? node.classList.contains('ppTextEditing176') : null,
    };
  }, layerId);
  expect(state.hasTextarea).toBe(true);
  expect(state.layerIsEditing).toBe(true);
});

// Real report, with a screenshot: on Windows Chrome, opening the font dropdown showed almost
// every option blank/invisible - only the one row under the mouse/keyboard highlight (native
// blue background) was readable. <option> has no colour of its own, so it inherited the
// near-white color:var(--text) meant for the <select>'s own dark, app-themed CLOSED box - but
// the OPEN dropdown list is the browser's native, plain-white popup, which this app can't
// restyle. Near-white text on that native white background is invisible everywhere except the
// one row Chrome fills with its own blue highlight. macOS/iOS mostly ignore page CSS for the
// open list (system colouring instead), which is why this never surfaced there. Playwright can't
// screenshot the native popup itself (it paints outside the page), so this checks the actual
// mechanism: <option>'s own computed colour, which is what the popup renders it with.
test('the font dropdown\'s options have their own readable dark-on-light colour, not inherited near-white text', async ({ page }) => {
  const colors = await page.evaluate(() => {
    const opt = document.querySelector('#fontFamily option');
    const cs = getComputedStyle(opt);
    function toRgb(str) {
      const m = str.match(/\d+/g).map(Number);
      return m;
    }
    return { color: toRgb(cs.color), background: toRgb(cs.backgroundColor) };
  });
  // Dark text (low channel values) on a light background (high channel values) - the opposite of
  // the inherited near-white-on-transparent that made every row but one unreadable.
  expect(colors.color[0]).toBeLessThan(100);
  expect(colors.background[0]).toBeGreaterThan(200);
});

// Real beta-tester feedback: bare-icon buttons (like a text layer's "x" delete button) should
// explain themselves on hover.
test('a text layer\'s delete "x" button has a hover tooltip', async ({ page }) => {
  await page.evaluate(() => { addText('text'); });
  await page.waitForTimeout(200);
  const layerId = await page.evaluate(() => state.pages[0].layers[0].id);
  await expect(page.locator(`.layer[data-id="${layerId}"] .deleteMini`)).toHaveAttribute('title', /./);
});
