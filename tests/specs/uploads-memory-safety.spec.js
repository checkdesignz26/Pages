// Memory-safe upload capping: the real bug was that window.loadTray/addUploadedImageLayer/
// createMockupPage each got superseded by a later generation that dropped the resolution cap,
// silently storing every upload at full original size (a likely real contributor to the
// "save file too large" symptom). pp-memory-safe-upload-cap-js wraps the live generations to
// restore capping without touching their internals - this exercises the upload path exactly
// as the real UI would (via the actual <input> elements), not by calling internals directly.
const { test, expect } = require('../support/fixtures');

test('an uploaded asset image gets its transparent bounds trimmed before use as an image layer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    function makeTransparentPngDataUrl() {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 60;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 60, 60);
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(15, 15, 30, 30);
      return c.toDataURL('image/png');
    }
    save();
    state.trays.asset = [{ src: makeTransparentPngDataUrl(), name: 'asset0' }];
    state.selectedTray = { asset: 0 };
    addImageLayer('image');
    await new Promise((r) => setTimeout(r, 400));
    const p = current();
    const l = p.layers.find((x) => x.type === 'image');
    return { layerFound: !!l, hasSrc: !!(l && l.src), tightBounds: l ? !!l.tightBounds : null };
  });

  expect(result.layerFound).toBe(true);
  expect(result.hasSrc).toBe(true);
  expect(result.tightBounds).toBe(true);
});

test('a large image uploaded through the real image-layer file input is capped to 1250px', async ({ page }) => {
  await page.evaluate(() => {
    function bigDataUrl(size) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, '#22c1c3');
      grad.addColorStop(1, '#fdbb2d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      window.__bigDataUrl = c.toDataURL('image/png');
    }
    bigDataUrl(2500);
  });

  await page.evaluate(async () => {
    const blob = await (await fetch(window.__bigDataUrl)).blob();
    const file = new File([blob], 'big-photo.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('imageLayerInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect
    .poll(() => page.evaluate(() => current().layers.some((l) => l.type === 'image')), { timeout: 5000 })
    .toBe(true);

  const dims = await page.evaluate(async () => {
    const l = current().layers.find((x) => x.type === 'image');
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = l.src;
    });
  });

  expect(Math.max(dims.w, dims.h)).toBeLessThanOrEqual(1250);
});

test('an uploaded image layer starts as a tight fit around the picture, and stays tight after a corner resize', async ({ page }) => {
  // Real report, from a page that isn't square (a 3000x2250 listing page): a tall/narrow
  // photo placed on the canvas got a visibly loose selection box, worse after resizing it -
  // gaps between the pink outline and the actual picture. fittedLayerSizeForImage() computes h
  // from the image's real aspect ratio adjusted for the page's own w/h ratio, but then clamped
  // h to [minH,maxH] without ever re-deriving w to match - so a clamp silently left the box's
  // shape not matching the image's shape at all, and every later resize (which just preserves
  // whatever ratio the box already has) carried that mismatch forward under fit:contain's
  // letterboxing instead of fixing it. Use a very tall image (2:1 landscape page, portrait
  // photo) so the unclamped height would badly overshoot maxH and force the old clamp bug.
  await page.evaluate(() => {
    const p = current();
    p.w = 3000; p.h = 1500; // wide page, so a portrait photo's natural fit needs a tall box
  });

  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 1200; // 1:3 portrait photo
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3355ff';
    ctx.fillRect(0, 0, 400, 1200);
    const dataUrl = c.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], 'portrait.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('imageLayerInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect
    .poll(() => page.evaluate(() => current().layers.some((l) => l.type === 'image')), { timeout: 5000 })
    .toBe(true);

  function boxAspectVsImageAspect() {
    return page.evaluate(() => {
      const p = current();
      const l = p.layers.find((x) => x.type === 'image');
      const pageAspect = p.w / p.h;
      const boxVisualAspect = (l.w * pageAspect) / l.h; // convert %/% into a real on-page ratio
      return { boxVisualAspect, naturalAspect: l.aspect, hasAspect: typeof l.aspect === 'number' };
    });
  }

  const initial = await boxAspectVsImageAspect();
  expect(initial.hasAspect).toBe(true);
  expect(initial.boxVisualAspect).toBeCloseTo(initial.naturalAspect, 1);

  // Drag a corner handle to resize - the real interaction from the report.
  const layerId = await page.evaluate(() => current().layers.find((l) => l.type === 'image').id);
  const handle = page.locator(`.layer[data-id="${layerId}"] .ppResizeHandle.se`);
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 140, hb.y + 90, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterResize = await boxAspectVsImageAspect();
  expect(afterResize.boxVisualAspect).toBeCloseTo(afterResize.naturalAspect, 1);
});

test('a small pattern upload through the pattern tray passes through uncapped', async ({ page }) => {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 40, 40);
    const dataUrl = c.toDataURL('image/png');
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], 'small-swatch.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('patternInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.__smallOriginal = dataUrl;
  });

  await expect
    .poll(() => page.evaluate(() => (state.trays.pattern || []).length), { timeout: 3000 })
    .toBeGreaterThan(0);

  const matches = await page.evaluate(() => {
    const item = state.trays.pattern[state.trays.pattern.length - 1];
    return item.src === window.__smallOriginal;
  });
  expect(matches).toBe(true);
});

// Real request: scrolling away from a page and back always showed a blank "tap to edit"
// placeholder, since the PP95 virtualization above only keeps real layer DOM for the page
// +/-1 from state.selectedPage (everything else is "parked" to bound memory). pp-parked-page-
// preview replaces that blank placeholder with a small flattened raster snapshot instead, so
// scrolling shows real content immediately, while keeping parked pages as a single non-
// interactive <img> (not real layers) so nothing gets nudged/edited by a stray touch while
// scrolling past it.
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('a page that just left the hot zone gets an immediate image preview instead of a blank placeholder', async ({ page }) => {
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src, x: 10, y: 10, w: 40, h: 40, z: 1, opacity: 1, r: 0 }] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, PNG_1PX);

  // Page 0 is hot right now - it should be a real, interactive layer, not a preview.
  await expect(page.locator('.stage[data-page="0"] .layer.image img')).toHaveCount(1);
  await expect(page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg')).toHaveCount(0);

  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  // Page 0 is now 2 pages away from selectedPage (2), outside the +/-1 hot radius - it should
  // be parked, but with a real snapshot captured from its live DOM on the way out, not left blank.
  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('.stage[data-page="0"] .layer.image')).toHaveCount(0);

  const src = await previewImg.getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);

  // It must not intercept pointer events, so tapping the parked page still switches to it
  // (via the stage's own onclick) instead of the flattened snapshot swallowing the tap.
  const pointerEvents = await previewImg.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).toBe('none');
});

test('a page that has never been rendered still gets a preview via background warm-up, without leaving its temporary DOM behind', async ({ page }) => {
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src, x: 10, y: 10, w: 40, h: 40, z: 1, opacity: 1, r: 0 }] },
    ];
    // selectedPage stays at 0, so page 2 has never been in the hot zone and has no
    // "leaving hot zone" snapshot to fall back on - it can only come from the warm-up queue.
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, PNG_1PX);

  const previewImg = page.locator('.stage[data-page="2"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const src = await previewImg.getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);

  // The off-screen holder used to build that warm preview must not linger in memory afterward.
  const leftoverHolders = await page.evaluate(
    () => document.querySelectorAll('body > div[style*="-99999px"]').length,
  );
  expect(leftoverHolders).toBe(0);
});

// Real report, with a screen recording and the user's actual project file: a custom mock-up's
// parked preview came out visibly warped - the photo's proportions stretched, the pattern band
// squeezed into the wrong place - even though the live page looked correct. warmOne()'s
// off-screen preview holder builds a real .stage-classed element sized to 1400px via inline
// style, so it can reuse renderLayer()'s normal .stage-scoped CSS - but that also pulls in the
// narrow/portrait responsive layout's ".stage{width:min(92vw,680px)!important}" (this project's
// own default viewport, like a real iPad's, is taller than wide, so that media query is active).
// A stylesheet !important rule beats a plain inline style regardless of what width the code
// intended, silently squashing the synthetic stage's width while its inline height stayed at
// 1400px - badly distorting the aspect ratio of whatever got captured from it. Verify with a
// perfectly square page (matching the real 512x512 mock-up page): the cached preview image
// should itself come out square, not stretched.
test('the warm-up preview for a square page comes out square, not stretched by the app\'s own responsive .stage width rule', async ({ page }) => {
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'mockup', w: 1000, h: 1000, layers: [{ id: 'l1', type: 'image', src, x: 0, y: 0, w: 100, h: 100, z: 1, opacity: 1, r: 0, fit: 'cover' }] },
    ];
    // selectedPage stays at 0 - page 2 is outside VISIBLE_RADIUS (1) from the start, so its
    // only preview comes from the background warm-up path (warmOne), never a live hot stage.
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, PNG_1PX);

  const previewImg = page.locator('.stage[data-page="2"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });

  const dims = await previewImg.evaluate((img) => new Promise((resolve) => {
    const check = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    if (img.complete && img.naturalWidth) check();
    else img.addEventListener('load', check, { once: true });
  }));

  expect(dims.w).toBeGreaterThan(0);
  expect(dims.h).toBeGreaterThan(0);
  const ratio = dims.w / dims.h;
  expect(ratio).toBeGreaterThan(0.9);
  expect(ratio).toBeLessThan(1.1);
});

test('the parked-page preview crops images with object-fit like the real layer, instead of stretching the whole source image into the box', async ({ page }) => {
  // Real bug: a plain ctx.drawImage(img,x,y,w,h) ignores the CSS object-fit:cover the live
  // layer actually renders with, so a wide/tall source image got squashed to fit the box
  // instead of being center-cropped - this is why a banner "wasn't looking like in real life"
  // in the preview. Build a 5:1 wide image that's red near its left edge, blue near its right
  // edge, and green everywhere else, then place it in a near-square (~1:1) layer box. Under
  // correct object-fit:cover cropping, the visible source slice never reaches the red/blue
  // edges (only the green middle is visible) - under the old stretch behavior it would.
  const wideImageSrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 60;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 300, 60);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 20, 60);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(280, 0, 20, 60);
    return c.toDataURL('image/png');
  });

  const layer = { id: 'l1', type: 'image', src: wideImageSrc, x: 10, y: 10, w: 30, h: 40, z: 1, opacity: 1, r: 0 };
  await page.evaluate(({ src, l }) => {
    save();
    // w:30 * pageW:3000 = 900, h:40 * pageH:2250 = 900 -> a square (~1:1) on-screen box, very
    // different from the 5:1 source image, so object-fit:cover must crop noticeably.
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [l] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, { src: wideImageSrc, l: layer });

  await expect(page.locator('.stage[data-page="0"] .layer.image img')).toHaveCount(1);
  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const previewSrc = await previewImg.getAttribute('src');

  const samples = await page.evaluate(({ previewSrc, l }) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      function sampleAt(fracX, fracY) {
        const x = Math.round(fracX * c.width);
        const y = Math.round(fracY * c.height);
        return Array.from(ctx.getImageData(x, y, 1, 1).data);
      }
      const yMid = (l.y + l.h / 2) / 100;
      resolve({
        nearLeftEdge: sampleAt((l.x + l.w * 0.02) / 100, yMid),
        nearRightEdge: sampleAt((l.x + l.w * 0.98) / 100, yMid),
      });
    };
    img.onerror = reject;
    img.src = previewSrc;
  }), { previewSrc, l: layer });

  function isCloseTo(channel, target) { return Math.abs(channel - target) < 40; }
  // Near the left edge of the box: should be green (cropped source ~x120-180), not red
  // (which only exists at the true source's left edge, x0-20, and would only show up under
  // the old stretch-the-whole-image bug).
  expect(isCloseTo(samples.nearLeftEdge[0], 0)).toBe(true);
  expect(isCloseTo(samples.nearLeftEdge[1], 255)).toBe(true);
  // Near the right edge of the box: should also be green, not blue.
  expect(isCloseTo(samples.nearRightEdge[2], 0)).toBe(true);
  expect(isCloseTo(samples.nearRightEdge[1], 255)).toBe(true);
});

test('the parked-page preview applies mix-blend-mode:multiply for custom mock-ups, instead of drawing the pattern as a flat opaque rectangle', async ({ page }) => {
  // Real bug (screenshot): a custom mock-up's pattern overlay looked like a flat sticker
  // slapped on the mug in the parked preview, instead of following the mug's curve like the
  // real page. The app renders custom mock-ups as two stacked image layers - a background
  // mock-up photo, plus a masked/warped pattern image on top with CSS
  // mix-blend-mode:multiply (.layer.customMockupLayer > img, index.html ~line 11314) - which
  // is what actually blends the pattern into the photo's shape/shading. The old snapshot code
  // only understood plain source-over compositing, so the overlay came out as an opaque block.
  // Canvas supports the same blend modes natively via globalCompositeOperation, so use a solid
  // mid-gray "photo" background and a solid red "pattern" overlay: multiplying red (255,0,0)
  // with mid-gray (128,128,128) gives a darkened (~128,0,0) result, distinct from both a flat
  // opaque red rectangle (the bug) and the plain gray backdrop.
  const graySrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png');
  });
  const redSrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png');
  });

  await page.evaluate(({ graySrc, redSrc }) => {
    save();
    const bg = { id: 'bg1', type: 'image', src: graySrc, x: 20, y: 20, w: 40, h: 40, z: 1, opacity: 1, r: 0, fit: 'cover' };
    const overlay = {
      id: 'mock1', type: 'image', src: redSrc, x: 20, y: 20, w: 40, h: 40, z: 2, opacity: 1, r: 0, fit: 'contain',
      customMockup: true, customMockupPatternSrc: redSrc, aspect: 1,
    };
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [bg, overlay] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, { graySrc, redSrc });

  await expect(page.locator('.stage[data-page="0"] .layer.customMockupLayer img')).toHaveCount(1);
  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const previewSrc = await previewImg.getAttribute('src');

  const pixel = await page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const x = Math.round(0.4 * c.width);
      const y = Math.round(0.4 * c.height);
      resolve(Array.from(ctx.getImageData(x, y, 1, 1).data));
    };
    img.onerror = reject;
    img.src = src;
  }), previewSrc);

  function isCloseTo(channel, target) { return Math.abs(channel - target) < 40; }
  // Multiply result (~128,0,0): red channel darkened, green/blue stay near zero.
  expect(isCloseTo(pixel[0], 128)).toBe(true);
  expect(isCloseTo(pixel[1], 0)).toBe(true);
  expect(isCloseTo(pixel[2], 0)).toBe(true);
  // Must not be a flat opaque red rectangle (the bug: plain source-over would give ~255,0,0).
  expect(pixel[0]).toBeLessThan(200);
});

test('the parked-page preview draws a text layer\'s actual caption, not the caption glued to the hidden delete/resize-hint chrome text', async ({ page }) => {
  // Real report (screenshot): a page full of text layers came back from the parked-page
  // preview looking garbled, with oversized/overlapping-looking text. The preview's text
  // branch read node.textContent straight off the whole .layer wrapper - but the delete "x"
  // button and the "drag corner to resize · <type>" hint are always present in that wrapper's
  // DOM (just CSS display:none until selected), as siblings of the actual caption, which lives
  // in a dedicated .shapeText child. textContent doesn't care about CSS visibility, so every
  // cached preview was silently drawing "<real text>×drag corner to resize · text" as one
  // fillText call instead of just the real caption. Patch fillText to record exactly what text
  // the preview asked to draw, rather than trying to OCR pixels back out of a JPEG.
  await page.evaluate(() => {
    window.__ppFillTextCalls = [];
    const proto = CanvasRenderingContext2D.prototype;
    if (!proto.__ppOrigFillText) {
      proto.__ppOrigFillText = proto.fillText;
      proto.fillText = function (text, ...rest) {
        window.__ppFillTextCalls.push(text);
        return proto.__ppOrigFillText.call(this, text, ...rest);
      };
    }
  });

  await page.evaluate(() => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [
        { id: 'l1', type: 'text', name: 'headline', text: 'Etsy Listing', x: 10, y: 10, w: 60, h: 14, z: 1, opacity: 1, r: 0, fontSize: 42, color: '#111111', textAlign: 'center' },
      ] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  });

  await expect(page.locator('.stage[data-page="0"] .layer.text')).toHaveCount(1);
  await page.evaluate(() => { window.__ppFillTextCalls.length = 0; state.selectedPage = 2; state.selected = null; render(); });

  await expect(page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg')).toHaveCount(1, { timeout: 5000 });

  const calls = await page.evaluate(() => window.__ppFillTextCalls);
  expect(calls.length).toBeGreaterThan(0);
  for (const text of calls) {
    expect(text).not.toMatch(/×/);
    expect(text).not.toMatch(/drag corner to resize/i);
  }
  expect(calls.some((t) => t.includes('Etsy Listing'))).toBe(true);
});

test('the parked-page preview clips a circular pattern slot to a circle, instead of drawing its square bounding box', async ({ page }) => {
  // Real bug (screenshot): a "pattern tile square" page has a big round pattern-fill slot in
  // the middle (a type:'card' patternSlot layer with slotShape:'circle', styled entirely via
  // CSS - .layer.patternSlot{background:#fff!important} + .layer.patternSlot.circleSlot
  // {border-radius:50%!important}, both !important straight on the .layer wrapper, not an
  // inline style). The old snapshot code read the wrapper's background color but never looked
  // at its border-radius, so an unfilled/empty round slot came out as a flat white square
  // instead of a circle sitting on the page. Put a solid red background under a big white
  // circle slot: the box's own corner should show red (outside the inscribed circle) once
  // clipping is respected, but was white before (the bug: the whole square painted over).
  const redSrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, 20, 20);
    return c.toDataURL('image/png');
  });

  await page.evaluate((redSrc) => {
    save();
    const bg = { id: 'bg1', type: 'image', src: redSrc, x: 0, y: 0, w: 100, h: 100, z: 1, opacity: 1, r: 0, fit: 'cover' };
    const slot = {
      id: 'slot1', type: 'card', name: 'Circle Tile', src: null, fit: 'cover', patternSlot: true, slotShape: 'circle',
      x: 10, y: 10, w: 80, h: 80, z: 2, opacity: 1, r: 0,
    };
    state.pages = [
      { type: 'listing', w: 3000, h: 3000, layers: [bg, slot] },
      { type: 'listing', w: 3000, h: 3000, layers: [] },
      { type: 'listing', w: 3000, h: 3000, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, redSrc);

  await expect(page.locator('.stage[data-page="0"] .layer.patternSlot.circleSlot')).toHaveCount(1);
  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const previewSrc = await previewImg.getAttribute('src');

  const pixels = await page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      function sampleAt(fracX, fracY) {
        return Array.from(ctx.getImageData(Math.round(fracX * c.width), Math.round(fracY * c.height), 1, 1).data);
      }
      resolve({
        center: sampleAt(0.5, 0.5),
        boxCorner: sampleAt(0.12, 0.12),
      });
    };
    img.onerror = reject;
    img.src = src;
  }), previewSrc);

  function isCloseTo(channel, target) { return Math.abs(channel - target) < 40; }
  // Center of the slot: inside the circle either way - should be white.
  expect(isCloseTo(pixels.center[0], 255)).toBe(true);
  expect(isCloseTo(pixels.center[1], 255)).toBe(true);
  // Near the slot box's own corner: outside the inscribed circle, so the red background should
  // show through once the shape is actually clipped to a circle (the bug: this came out white,
  // because the old code just filled the whole square bounding box).
  expect(isCloseTo(pixels.boxCorner[0], 255)).toBe(true);
  expect(isCloseTo(pixels.boxCorner[1], 0)).toBe(true);
  expect(isCloseTo(pixels.boxCorner[2], 0)).toBe(true);
});

test('the warm-up queue finishes quickly for a normal-sized project instead of taking several seconds', async ({ page }) => {
  // Real report: "the preview scrolling seems to work sometimes and sometimes not." Scrolling
  // itself never changes state.selectedPage (only tapping a page does), so a page that has
  // never been hot relies entirely on the background warm-up queue for its very first preview -
  // if the user scrolls to a page before its turn in the queue comes up, they'd see the old
  // blank placeholder and could easily read that as "broken." The queue used to space job
  // starts 260ms apart with up to a 1200ms wait each; for a handful of parked pages that could
  // take several seconds to fully settle. Build an 8-page project, jump to the middle, and check
  // every parked page gets a real preview well within what the old pacing would have allowed.
  await page.evaluate(() => {
    save();
    function solid(hex) {
      const c = document.createElement('canvas');
      c.width = 10; c.height = 10;
      const ctx = c.getContext('2d');
      ctx.fillStyle = hex;
      ctx.fillRect(0, 0, 10, 10);
      return c.toDataURL('image/png');
    }
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000'];
    state.pages = colors.map((hex) => ({
      type: 'listing', w: 3000, h: 2250,
      layers: [{ id: 'l' + hex, type: 'image', src: solid(hex), x: 0, y: 0, w: 100, h: 100, z: 1, opacity: 1, r: 0, fit: 'cover' }],
    }));
    state.selectedPage = 4; // pages 3,4,5 are hot; 0,1,2,6,7 all need warming from scratch
    state.selected = null;
    render();
  });

  const start = Date.now();
  async function previewReadyCount() {
    return page.evaluate(() => Array.from(document.querySelectorAll('.stage.pp95ParkedPage'))
      .filter((st) => st.querySelector('.pp95ParkedPreviewImg')).length);
  }

  await expect
    .poll(previewReadyCount, { timeout: 3000 })
    .toBe(5); // pages 0,1,2,6,7 - everything outside the hot radius around page 4

  const elapsed = Date.now() - start;
  // The old pacing (260ms strictly between job starts, 1200ms max wait each) could take
  // several seconds for just 5 pages; this should comfortably finish in well under 2s.
  expect(elapsed).toBeLessThan(2000);
});

test('a page that parks before its image finishes decoding does not get a permanently blank cached preview', async ({ page }) => {
  // Real bug, found from a user debug report showing zero logged errors: a page parked with a
  // plain blank "tap to edit" box even though it has real image content. The likely cause -
  // unreproducible in a quick controlled test but consistent with the report - is a page
  // becoming hot then parking again before its (possibly large) photo finishes decoding on a
  // slower device: img.naturalWidth is still 0 at the exact moment the live-DOM snapshot runs,
  // so nothing gets drawn, and because the (near-blank) result used to get cached anyway,
  // nothing would ever repaint it - the page looked permanently empty. Simulate that exact
  // instant by forcing naturalWidth to 0 on the real hot img right when the page parks, and
  // confirm: (1) that moment does NOT cache a blank preview, and (2) it self-heals shortly
  // after via the background warm-up path, which builds its own independent image and decodes
  // normally.
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await page.evaluate((src) => {
    save();
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [{ id: 'l1', type: 'image', src, x: 10, y: 10, w: 40, h: 40, z: 1, opacity: 1, r: 0 }] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, png1x1);
  await expect(page.locator('.stage[data-page="0"] .layer.image img')).toHaveCount(1);

  const immediatelyMissing = await page.evaluate(() => {
    const img = document.querySelector('.stage[data-page="0"] .layer.image img');
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
    state.selectedPage = 2;
    state.selected = null;
    render();
    const st = document.querySelector('.stage[data-page="0"]');
    return !st.querySelector('.pp95ParkedPreviewImg');
  });
  expect(immediatelyMissing, 'must not cache a blank preview while the image is still mid-decode').toBe(true);

  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 3000 });
  const src = await previewImg.getAttribute('src');
  expect(src).toMatch(/^data:image\/jpeg;base64,/);
});

// Real report, with a screen recording: a custom mock-up looked flat/blurry after the project
// had been open a while (not the initial export-blend bug fixed separately - this is the
// periodic memory-trim silently over-compressing it). ppMemoryTrimState's walk() meant to give
// mock-up images a slightly larger edge cap (MOCKUP_EDGE=1400 vs the ordinary LIVE_EDGE=1250),
// but checked obj.type==='customMockupLayer' - that string is only ever a CSS class name added
// to a rendered DOM node's className, never a value actually stored in a layer's own .type (a
// custom mock-up's background/pattern layers are both plain type:'image', flagged via
// l.customMockup/l.lockedMockupBackground instead) - so the check could never match, and every
// custom mock-up image silently fell through to the smaller cap on every trim.
test('the periodic memory trim gives a custom mock-up image its larger edge cap, not the smaller ordinary-image one', async ({ page }) => {
  const size = 1380; // between LIVE_EDGE (1250, would shrink it) and MOCKUP_EDGE (1400, should not)
  const dataUrl = await page.evaluate((size) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#224466'); g.addColorStop(1, '#eebb33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    let s = 999;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = (img.data[i] + (s % 40) - 20) & 255;
      img.data[i + 1] = (img.data[i + 1] + ((s >> 8) % 40) - 20) & 255;
      img.data[i + 2] = (img.data[i + 2] + ((s >> 16) % 40) - 20) & 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }, size);
  expect(dataUrl.length).toBeGreaterThan(900000); // must clear LARGE_DATAURL to even be considered

  await page.evaluate((src) => {
    save();
    state.pages = [{
      type: 'mockup', w: 1600, h: 1600,
      layers: [
        { id: 'bg', type: 'image', name: 'mock-up background', src, x: 0, y: 0, w: 100, h: 100, z: 1, opacity: 1, r: 0, fit: 'cover', lockedMockupBackground: true },
      ],
    }];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, dataUrl);

  await page.evaluate(() => window.ppMemoryTrimState(true));
  await page.waitForTimeout(1500); // ppMemoryTrimState has no external "done" signal to await

  const resultWidth = await page.evaluate(() => new Promise((resolve) => {
    const src = state.pages[0].layers[0].src;
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth);
    img.src = src;
  }));

  // MOCKUP_EDGE (1400) comfortably covers the original 1380px image - it should come out
  // untouched (or at worst rounded to ~1380), not shrunk down toward LIVE_EDGE's 1250.
  expect(resultWidth).toBeGreaterThan(1340);
});

// Real report: undo/redo stopped working entirely on a real, several-page Etsy listing project
// with a few mock-ups - normal use of this app, not an edge case. Once loaded live, a saved
// project's deduped ppasset: references get expanded back into full, repeated data URLs on every
// layer that uses them, so a project that's a modest size on disk can easily land past this
// trim's 7,000,000-char "large project" threshold once live - confirmed directly against the
// reporter's real project file (its live state.pages alone came out over 8,000,000 chars). This
// trim reruns 1.5s after every change/pointerup, and used to unconditionally wipe BOTH
// state.history and state.redoStack to [] every time it found the project still over that size -
// so for a project that's simply always this size, every edit's own undo snapshot got wiped
// again about a second later, before the user ever got a chance to press undo.
test('undo survives the periodic memory trim on a large project, instead of being wiped every time', async ({ page }) => {
  const dataUrl = await page.evaluate(() => {
    const size = 480;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, '#224466'); g.addColorStop(1, '#eebb33');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    let s = 777;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = (img.data[i] + (s % 40) - 20) & 255;
      img.data[i + 1] = (img.data[i + 1] + ((s >> 8) % 40) - 20) & 255;
      img.data[i + 2] = (img.data[i + 2] + ((s >> 16) % 40) - 20) & 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  });
  // Stay under LARGE_DATAURL (900000) so ppMemoryTrimState's slim() leaves these untouched -
  // this test is about the undo-history behavior, not the image-capping behavior covered above.
  expect(dataUrl.length).toBeLessThan(900000);

  const setup = await page.evaluate((src) => {
    const copies = Math.ceil(7500000 / src.length) + 1;
    const layers = [];
    for (let i = 0; i < copies; i++) {
      layers.push({ id: 'img' + i, type: 'image', name: 'img' + i, src, x: 0, y: 0, w: 10, h: 10, z: i + 1, opacity: 1, r: 0, fit: 'cover' });
    }
    state.pages = [{ type: 'listing', w: 3000, h: 2250, layers, marker: 'before' }];
    state.selectedPage = 0;
    state.selected = null;
    state.history = [];
    state.redoStack = [];
    render();

    const roughBefore = JSON.stringify({ pages: state.pages, trays: state.trays }).length;
    save(); // snapshots "before" onto history
    state.pages[0].marker = 'after';
    render();

    return { roughBefore, historyBeforeTrim: state.history.length };
  }, dataUrl);

  expect(setup.roughBefore).toBeGreaterThan(7000000);
  expect(setup.historyBeforeTrim).toBe(1);

  await page.evaluate(() => window.ppMemoryTrimState(true));
  await page.waitForTimeout(1500); // ppMemoryTrimState has no external "done" signal to await

  const after = await page.evaluate(() => {
    const historyLenAfterTrim = state.history.length;
    undo();
    return { historyLenAfterTrim, markerAfterUndo: state.pages[0].marker };
  });

  expect(after.historyLenAfterTrim).toBeGreaterThan(0);
  expect(after.markerAfterUndo).toBe('before');
});

// Real report, with a screenshot and the reporter's own project file: a page full of plain
// text/callout boxes (fill:'transparent' - meant to float directly over the page with no visible
// box, confirmed live via getComputedStyle) came back from the parked-page preview sitting on a
// light grey box that never actually exists on the real page. snapshotStageToDataURL used to fall
// back to painting a faint rgba(0,0,0,.05) wash whenever a layer's real background was
// transparent, instead of just leaving it unpainted - this preview exists to look like the real
// page, not add a visual affordance the live page never shows.
test('the parked-page preview leaves a transparent-fill text box unpainted, instead of a fake grey box the live page never shows', async ({ page }) => {
  const redSrc = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(255,0,0)';
    ctx.fillRect(0, 0, 20, 20);
    return c.toDataURL('image/png');
  });

  await page.evaluate((redSrc) => {
    save();
    const bg = { id: 'bg1', type: 'image', src: redSrc, x: 0, y: 0, w: 100, h: 100, z: 1, opacity: 1, r: 0, fit: 'cover' };
    const label = {
      id: 'l1', type: 'text', name: 'callout', text: 'Add name of your pattern', fill: 'transparent',
      x: 10, y: 10, w: 60, h: 20, z: 2, opacity: 1, r: 0, fontSize: 20, color: '#111111', textAlign: 'center',
    };
    state.pages = [
      { type: 'listing', w: 3000, h: 2250, layers: [bg, label] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
      { type: 'listing', w: 3000, h: 2250, layers: [] },
    ];
    state.selectedPage = 0;
    state.selected = null;
    render();
  }, redSrc);

  await expect(page.locator('.stage[data-page="0"] .layer.text')).toHaveCount(1);
  await page.evaluate(() => { state.selectedPage = 2; state.selected = null; render(); });

  const previewImg = page.locator('.stage[data-page="0"] .pp95ParkedPreviewImg');
  await expect(previewImg).toHaveCount(1, { timeout: 5000 });
  const previewSrc = await previewImg.getAttribute('src');

  const pixel = await page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // A corner of the text box's own bounding area, away from any glyph strokes.
      resolve(Array.from(ctx.getImageData(Math.round(0.12 * c.width), Math.round(0.11 * c.height), 1, 1).data));
    };
    img.onerror = reject;
    img.src = src;
  }), previewSrc);

  // The red background should show straight through - a fake grey wash would measurably darken
  // the red channel (rgba(0,0,0,.05) over red lands around 242, not 255).
  expect(pixel[0]).toBeGreaterThan(250);
  expect(pixel[1]).toBeLessThan(15);
  expect(pixel[2]).toBeLessThan(15);
});
