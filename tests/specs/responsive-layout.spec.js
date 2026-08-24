// Real report, with a screenshot: on a narrower iPad the right panel (and header toolbar) ran
// off the edge of the screen with no way to scroll back and see the rest. Reproduced at that
// iPad's actual logical viewport (1080x810 landscape, matching a standard 10.2" iPad).
//
// Root cause: several grid containers (.app, header/.studioHeader) used a bare "1fr" track for
// their flexible column instead of "minmax(0,1fr)". A bare 1fr track, without an explicit 0
// minimum, falls back to the max-content (preferred) size of whatever's inside it once nothing
// else forces the container to a definite size - so instead of the flexible column shrinking to
// fit whatever space was left after the fixed-width side panels, the whole layout grew to fit
// its content's natural width, overflowing the actual viewport with nothing to bring the
// clipped-off content (like the right panel) back into view.
const { test, expect, expandAllBoxes } = require('../support/fixtures');

test.use({ viewport: { width: 1080, height: 810 } });

test('the app layout fits within a narrow iPad viewport without horizontal overflow', async ({ page }) => {
  const overflow = await page.evaluate(() => ({
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth);
});

test('the right panel is not clipped off-screen at a narrow iPad viewport', async ({ page }) => {
  const rightPanel = page.locator('.side.right');
  const box = await rightPanel.boundingBox();
  expect(box).not.toBeNull();
  // The whole panel - including its right edge - must sit within the viewport, not run off it.
  expect(box.x + box.width).toBeLessThanOrEqual(1080 + 1);
});

test('the header toolbar is not clipped off-screen at a narrow iPad viewport', async ({ page }) => {
  const header = page.locator('header.studioHeader, header').first();
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x + box.width).toBeLessThanOrEqual(1080 + 1);
});

// Real report, with screenshots: multi-line text on the canvas overlapped/crushed together after
// toggling a side panel. Root cause - every text/label layer's font-size, letter-spacing and
// border-width are absolute pixel values (positions/sizes use %, but text metrics never scale
// with the on-screen canvas box), while several older "focus boost" patches made .stage grow or
// shrink its own on-screen CSS width by up to ~50% depending on which side panels were open -
// harmless for percentage-based geometry, but silent death for fixed-px text once the canvas
// changed size that way. Verifies the canvas keeps the exact same on-screen width no matter which
// combination of side panels is open or collapsed.
test('the canvas keeps the same on-screen size regardless of which side panels are open, so text never rescales out of proportion', async ({ page }) => {
  const stageWidth = () => page.evaluate(() => document.querySelector('.stage').getBoundingClientRect().width);

  const initial = await stageWidth();
  expect(initial).toBeGreaterThan(50);

  await page.evaluate(() => toggleSidePanel('right'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('right'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('left'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => toggleSidePanel('left'));
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);

  await page.evaluate(() => { toggleSidePanel('left'); toggleSidePanel('right'); });
  await page.waitForTimeout(300);
  expect(await stageWidth()).toBeCloseTo(initial, 0);
});

// Real report, with a screenshot: on a real iPad the fixed feedback/help buttons in the
// bottom-right corner sat on top of the last control in a scrolled-down right-panel section
// (shape colours' border slider) instead of the panel making room for them - the buttons
// intercepted taps meant for whatever control was underneath. .side is overflow-y:auto with
// height:100%, and feedback/help are position:fixed (so they float over panel content rather
// than push it), which is exactly the combination that lets a fixed corner button permanently
// cover the bottom of a scrollable region. Fixed by reserving real bottom padding on the side
// panels so every control can scroll clear of the buttons.
test('a control scrolled to the bottom of the right panel is not covered by the fixed feedback/help buttons', async ({ page }) => {
  await page.evaluate(() => { addText('t'); });
  const input = page.locator('#borderWidth');

  // expandAllBoxes is a one-shot classList tweak that can race a re-render collapsing boxes
  // back (see fixtures.js) - keep re-expanding and re-scrolling to the bottom until the box
  // this test needs actually stays open long enough to get a real bounding box.
  let box = null;
  await expect
    .poll(async () => {
      await expandAllBoxes(page);
      await page.evaluate(() => {
        const side = document.querySelector('.side.right');
        side.scrollTop = side.scrollHeight;
      });
      box = await input.boundingBox();
      return box;
    }, { timeout: 5000 })
    .not.toBeNull();

  const hitId = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.id : null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

  expect(hitId).toBe('borderWidth');
});

// Real report, with a screenshot: with more patterns uploaded than fit in one row, the ones
// further down were unreachable - the screenshot showed later thumbnails' number badges
// cascading in a stack instead of a clean grid. Root cause: .thumbGrid capped itself to a fixed
// max-height (shrunk over several older patches down to 102px - barely a single row) with its
// own overflow:auto scroll, nested inside the left panel which is already its own scroll
// container. That inner scroll region was tiny and easy to miss entirely on a touch device, so
// rows beyond the first were effectively unreachable, not just visually cramped. The tray now
// grows to fit every pattern and relies on the panel's own single scroll instead of a nested one.
test('every uploaded pattern in the tray is fully visible and individually selectable, not clipped behind a tiny nested scroll window', async ({ page }) => {
  await expandAllBoxes(page);
  const count = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 10; c.height = 10;
    const ctx = c.getContext('2d');
    const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#1a535c', '#f7fff7', '#ff9f1c', '#2ec4b6', '#e71d36', '#011627', '#5c4d7d'];
    colors.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 10, 10);
      state.trays.pattern.push({ src: c.toDataURL('image/png'), name: 'p' + i });
    });
    renderTrays();
    return state.trays.pattern.length;
  });
  await page.waitForTimeout(1800); // let the app's own boot()/re-render timers settle first

  const thumbs = page.locator('#patternTray .thumb');
  await expect(thumbs).toHaveCount(count);

  // Every thumbnail must be reachable by a tap at its own centre - not covered by a sibling
  // stacked on top of it in an overlapping or clipped layout. Scrolled via a single evaluate()
  // rather than locator.scrollIntoViewIfNeeded(), whose actionability wait can throw if one of
  // those re-renders detaches/replaces the element mid-check.
  for (let i = 0; i < count; i++) {
    await page.evaluate((idx) => {
      const t = document.querySelectorAll('#patternTray .thumb')[idx];
      if (t) t.scrollIntoView({ block: 'center' });
    }, i);
    const box = await thumbs.nth(i).boundingBox();
    expect(box).not.toBeNull();
    const hitIndex = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const hitThumb = el && el.closest ? el.closest('#patternTray .thumb') : null;
      return hitThumb ? Array.from(hitThumb.parentNode.children).indexOf(hitThumb) : -1;
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hitIndex).toBe(i);
  }
});

// Real report: on a maximized Windows Chrome window (1920x1080), the panel-collapse arrow was
// "always in the way" and kept collapsing the right panel by accident. Confirmed the cause:
// #toggleRightPanel/#toggleLeftPanel are pinned to the exact vertical centre of the viewport
// (top:50%) at the panel's own edge - harmless on a physically short iPad screen, but on a tall
// desktop window that sits directly on top of the panel's own scrollbar and the area a mouse
// naturally passes through while scrolling or reading down the panel. Moved it near the top
// instead, but only for pointer:fine/hover:hover environments (a real mouse), so the iPad
// experience - already tuned around the centred position - is untouched.
test.describe('desktop mouse layout', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the panel-collapse arrow sits near the top on a wide desktop window, not pinned to the vertical centre where it blocks scrolling', async ({ page }) => {
    const box = await page.locator('#toggleRightPanel').boundingBox();
    expect(box).not.toBeNull();
    // The old, buggy position centred it at viewport height/2 (~540 here) - assert it's now
    // clearly up near the header instead, nowhere close to viewport centre.
    expect(box.y).toBeLessThan(200);
  });

  // Real beta-tester report: an earlier fix moved the arrow to a fixed top:96px, which actually
  // landed it half inside the header itself ("close to the title where it is lost") rather than
  // next to the canvas it controls. The arrow's top is now measured live off the header's own
  // rendered height, so it always lands just below it, clearly inside the workspace.
  test('the panel-collapse arrow sits below the header, inside the canvas area, not overlapping the title', async ({ page }) => {
    await page.waitForTimeout(300); // let the header-height measure() settle
    const headerBottom = await page.evaluate(() => document.querySelector('header.studioHeader, header').getBoundingClientRect().bottom);
    const box = await page.locator('#toggleRightPanel').boundingBox();
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(headerBottom - 1);
  });

  // Real report: recording with a screen-capture tool (Tango) whose sidebar docks alongside the
  // browser tab squished multi-line canvas text into an overlapping mess. Confirmed directly:
  // the "stable stage width" CSS variable re-measures on every window resize and, until now,
  // always accepted a narrower reading once anything ate into the browser's own viewport width
  // (not just the app's own side panels, which is all it was ever meant to react to) - and layer
  // font sizes are fixed px, so a shrinking stage with the same fixed text broke exactly like
  // this. Confirmed the failure directly: narrowing from 1920 down through ~1100px dropped the
  // stable width from 760px to 499px before this fix.
  test('the canvas does not shrink (and squash fixed-px text) just because the browser window narrows, e.g. a docked recording-tool sidebar', async ({ page }) => {
    await page.waitForTimeout(300); // let the initial measure() settle at the wide viewport
    const wide = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pp-stable-stage-width'));

    await page.setViewportSize({ width: 1100, height: 1080 }); // roughly what's left after a ~450px docked sidebar
    await page.waitForTimeout(500);
    const narrowed = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pp-stable-stage-width'));

    expect(narrowed).toBe(wide);
  });
});

test.describe('iPad (touch) layout stays exactly as before', () => {
  test.use({ viewport: { width: 1200, height: 1400 }, hasTouch: true });

  test('the panel-collapse arrow stays vertically centred on a touch device, unaffected by the desktop repositioning fix', async ({ page }) => {
    const box = await page.locator('#toggleRightPanel').boundingBox();
    expect(box).not.toBeNull();
    const viewportCentre = 1400 / 2;
    expect(Math.abs((box.y + box.height / 2) - viewportCentre)).toBeLessThan(5);
  });

  // The "never shrink" protection above is deliberately scoped to pointer:fine/hover:hover (a
  // real mouse) only - a real iPad rotating from landscape to portrait is a genuine orientation
  // change the canvas should still be free to resize for, not an external panel stealing space.
  test('rotating a touch device (landscape to portrait) still freely re-measures the stage width, unaffected by the desktop never-shrink fix', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 }); // landscape
    await page.waitForTimeout(500);
    const landscape = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pp-stable-stage-width'));

    await page.setViewportSize({ width: 820, height: 1180 }); // rotated to portrait
    await page.waitForTimeout(500);
    const portrait = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pp-stable-stage-width'));

    expect(portrait).not.toBe(landscape);
  });

  // Real report, with a screenshot: on a real iPad the panel-collapse arrows were nearly
  // invisible against the dark theme - an earlier patch (goldenV162, "calmer panel toggles")
  // had dropped their opacity to .72 specifically to cut down on accidental taps, which also
  // made them very hard to notice at all. Raised visibility (opacity, a light accent border, a
  // glow) without touching size or position, so the accidental-tap mitigation - a small,
  // deliberately unchanged touch target - stays intact; it's just easier to see.
  test('the panel-collapse arrow is clearly visible against the dark theme on iPad, not nearly-invisible low-opacity', async ({ page }) => {
    const style = await page.locator('#toggleRightPanel').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { opacity: parseFloat(cs.opacity), border: cs.borderTopWidth };
    });
    expect(style.opacity).toBeGreaterThan(0.85);
    expect(style.border).not.toBe('0px');
  });
});

// Real beta-tester feedback: the button's default label was the generic "left mode", but every
// place the app actually sets this text dynamically already uses "left-handed layout" /
// "right-handed layout" - the static HTML default just never matched. Renamed so the default
// state reads the same as the toggled states, and so it's clear what the button switches.
test('the handedness toggle button reads "left-handed layout" by default, matching what toggling it sets', async ({ page }) => {
  await expect(page.locator('#handModeBtn')).toHaveText('left-handed layout');
});

// Real beta-tester feedback: several icon-only controls (a bare +/-, a bare arrow) had no way for
// a desktop user to tell what they do without clicking them - a hover tooltip (the native title=
// attribute) was requested so the button's purpose is clear on hover, on the ones that don't
// already say so via their own visible label.
test('icon-only controls (zoom, panel-collapse arrows, frame count stepper) have a hover tooltip explaining what they do', async ({ page }) => {
  await expect(page.locator('button[onclick="zoomPage(-0.05)"]')).toHaveAttribute('title', /./);
  await expect(page.locator('button[onclick="zoomPage(0.05)"]')).toHaveAttribute('title', /./);
  await expect(page.locator('#toggleLeftPanel')).toHaveAttribute('title', /./);
  await expect(page.locator('#toggleRightPanel')).toHaveAttribute('title', /./);
  await expect(page.locator('button[onclick="changeFrameCount(-1)"]')).toHaveAttribute('title', /./);
  await expect(page.locator('button[onclick="changeFrameCount(1)"]')).toHaveAttribute('title', /./);
});

// Real report, with a screenshot: on a genuinely wide monitor (2K+), the side panels (270/288px)
// and canvas (capped at 760px) left a huge dead strip of empty workspace either side of a
// comparatively tiny page. Widened both above 1600px - a moderate bump, not edge-to-edge, since
// layer text/labels are fixed-px and don't scale with the canvas box. Below that (typical
// 1366-1440px laptops) nothing changes.
test.describe('very wide monitor layout', () => {
  test('the canvas and side panels are noticeably bigger on a 2K+ monitor than on a standard desktop width', async ({ page, browser }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(400);
    const wide = await page.evaluate(() => ({
      stage: document.querySelector('.stage').getBoundingClientRect().width,
      left: document.querySelector('.side.left').getBoundingClientRect().width,
      right: document.querySelector('.side.right').getBoundingClientRect().width,
    }));

    const context2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page2 = await context2.newPage();
    await page2.goto('/index.html');
    await page2.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');
    await page2.waitForTimeout(400);
    const standard = await page2.evaluate(() => ({
      stage: document.querySelector('.stage').getBoundingClientRect().width,
    }));
    await context2.close();

    expect(wide.stage).toBeGreaterThan(900);
    expect(wide.left).toBeGreaterThan(340);
    expect(wide.right).toBeGreaterThan(380);
    // Even a plain 1920-wide desktop monitor is above the 1600px threshold and should also get
    // the bump, same as the 2K case - both clearly bigger than the pre-fix 760px baseline.
    expect(standard.stage).toBeGreaterThan(900);
  });

  test('a laptop-width screen (below the 1600px threshold) keeps the original, unwidened layout', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => ({
      stage: document.querySelector('.stage').getBoundingClientRect().width,
      left: document.querySelector('.side.left').getBoundingClientRect().width,
    }));
    expect(info.stage).toBeLessThan(800);
    expect(info.left).toBeLessThan(300);
  });
});
