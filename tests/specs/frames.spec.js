// Frame shapes: all 6 built-in shapes render as real SVG-masked frames (not the old square
// card placeholder), selecting a frame highlights the matching shape button via the live
// render() wrap, and both addPatternFrame and fillSelectedFrame - each of which went through
// several dead generations before the final one (Phase 0, 23/N and 26/N) - work end to end.
const { test, expect } = require('../support/fixtures');

const SHAPES = ['heart', 'star', 'circle', 'arch', 'label', 'flower'];

test('all built-in frame shapes render as true SVG-masked frames', async ({ page }) => {
  await page.evaluate((shapes) => {
    save();
    shapes.forEach((shape) => {
      const l = layer('frame', { name: 'frame-' + shape, frameShape: shape, x: 5, y: 5, w: 30, h: 30, z: nextZ() });
      current().layers.push(l);
    });
    render();
  }, SHAPES);

  const nodes = page.locator('.stage .layer.frame svg.frameSvg');
  await expect(nodes).toHaveCount(SHAPES.length);
  for (let i = 0; i < SHAPES.length; i++) {
    await expect(nodes.nth(i)).toHaveClass(/realFrameSvg/);
    await expect(nodes.nth(i)).toHaveClass(/trueShapeFrame/);
  }
});

test('selecting a frame layer highlights the matching shape button', async ({ page }) => {
  await page.evaluate(() => {
    save();
    const l = layer('frame', { name: 'frame-heart', frameShape: 'heart', x: 5, y: 5, w: 30, h: 30, z: nextZ() });
    current().layers.push(l);
    render();
  });
  await page.evaluate(() => document.querySelectorAll('.box.collapsed').forEach((b) => b.classList.remove('collapsed')));

  await page.evaluate(() => {
    const l = current().layers.find((x) => x.type === 'frame');
    state.selected = l.id;
    render();
  });

  const highlighted = page.locator('.frameShapeGrid button.activeFrameShape');
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toContainText('heart');
});

test('addPatternFrame creates a frame layer with a working SVG mask', async ({ page }) => {
  await page.evaluate(() => addPatternFrame('star'));

  const layerShape = await page.evaluate(() => current().layers.find((x) => x.type === 'frame').frameShape);
  expect(layerShape).toBe('star');

  const svg = page.locator('.stage .layer.frame svg.frameSvg');
  await expect(svg).toHaveCount(1);
  await expect(svg).toHaveClass(/realFrameSvg/);
});

test('fillSelectedFrame fills both a heart frame and a built-in shape frame with the tray pattern', async ({ page }) => {
  const result = await page.evaluate(() => {
    function makePatternDataUrl() {
      const c = document.createElement('canvas');
      c.width = 40;
      c.height = 40;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 40, 40);
      return c.toDataURL('image/png');
    }
    save();
    state.trays.pattern = [{ src: makePatternDataUrl(), name: 'p0' }];

    addPatternFrame('heart');
    const heart = current().layers.find((l) => l.type === 'frame' && l.frameShape === 'heart');
    state.selected = heart.id;
    render();
    fillSelectedFrame();
    render();

    addPatternFrame('star');
    const star = current().layers.slice(-1)[0];
    state.selected = star.id;
    render();
    fillSelectedFrame();
    render();

    return { heartFilled: !!heart.src, starFilled: !!star.src, layerCount: current().layers.length };
  });

  expect(result.heartFilled).toBe(true);
  expect(result.starFilled).toBe(true);
  expect(result.layerCount).toBe(2);
});
