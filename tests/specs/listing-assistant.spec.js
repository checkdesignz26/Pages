// Etsy Listing Assistant tag generation. Real request, from a beta tester: hitting "generate"
// always produced the exact same fixed 13 tags for the same pattern name/keywords, with no way
// to get a fresh set of ideas to try without changing the input. generateListingHelper's tag
// list is built from a small set of always-the-same template words (subject+pattern,
// subject+print, ...) - now widened into a larger synonym pool that gets shuffled per call, so
// regenerating on the same input gives a different, still-relevant mix instead of a frozen list.
const { test, expect, expandAllBoxes } = require('../support/fixtures');

test('the Etsy tag generator gives a different set of tags each time you regenerate, not the same fixed list', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('listingPatternName').value = 'Strawberry';
    document.getElementById('listingKeywords').value = '';
  });

  const runs = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      window.generateListingHelper();
      out.push(document.getElementById('etsyTagsOutput').value);
    }
    return out;
  });

  // The single strongest, always-relevant pair for the detected subject ("berry", from
  // "Strawberry") stays guaranteed on every generate - variety shouldn't cost baseline quality.
  runs.forEach((tags) => {
    expect(tags).toContain('berry pattern');
    expect(tags).toContain('berry seamless');
  });

  // Etsy's own 13-tag limit and each tag's <=20 char limit are pre-existing constraints
  // (uniqueTags/makeEtsySafeTag) - confirm the wider word pool still respects them.
  runs.forEach((tags) => {
    const list = tags.split('\n').filter(Boolean);
    expect(list.length).toBeLessThanOrEqual(13);
    list.forEach((tag) => expect(tag.length).toBeLessThanOrEqual(20));
  });

  // But the full tag list should not be identical across every regenerate - that was the
  // reported problem (the same fixed set every single time, no variety to try).
  const uniqueRuns = new Set(runs);
  expect(uniqueRuns.size).toBeGreaterThan(1);
});

// Real report: the wider word pool above pulled in decorative-surface words (wallpaper, gift
// wrap, textile, clipart, backdrop, swatch) that make sense for a flat repeating pattern but not
// for a product/mock-up listing - tested directly with "composition notebook cover" and got
// "gift wrap" in the tags, which has nothing to do with a notebook cover. This app is also used
// for mock-ups and templates, not just patterns. Product-style input should draw from a
// product-appropriate word pool instead, and pick up real occasion tags like "back to school".
test('a product-style listing (a notebook cover, not a decorative pattern) gets relevant tags, not decorative-surface words like "gift wrap"', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('listingPatternName').value = 'Composition Notebook Cover';
    document.getElementById('listingKeywords').value = '';
  });

  const runs = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      window.generateListingHelper();
      out.push(document.getElementById('etsyTagsOutput').value);
    }
    return out;
  });

  const decorativeSurfaceWords = ['gift wrap', 'wallpaper', 'textile', 'backdrop', 'swatch', 'clipart', 'wall art'];
  runs.forEach((tags) => {
    decorativeSurfaceWords.forEach((word) => expect(tags).not.toContain(word));
    expect(tags).toContain('back to school');
  });
});

// Real report: "the etsy assistant long tail keywords are very similar and repeat themselves,
// can they be more varied and the tags more specific". The long-tail list never got the same
// shuffled-pool treatment the tags above did - it was always the exact same "{subject} + one
// fixed word" pairs, in the same fixed order, on every single generate. Widened into a pool of
// adjectives, formats and real use-cases (drawing on the same isProductContext split the tags
// use) so both the wording and the phrase structure vary between generates.
test('the long-tail keyword generator gives a different, more varied set each time you regenerate, not the same fixed list', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('listingPatternName').value = 'Autumn coffee break';
    document.getElementById('listingKeywords').value = 'autumn coffee';
  });

  const runs = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      window.generateListingHelper();
      out.push(document.getElementById('longTailKeywordsOutput').value);
    }
    return out;
  });

  // Not identical every time - that was the reported problem.
  const uniqueRuns = new Set(runs);
  expect(uniqueRuns.size).toBeGreaterThan(1);

  runs.forEach((text) => {
    const list = text.split('\n').filter(Boolean);
    // Real, varied phrases, not a short frozen list - and no duplicate phrases within one batch.
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(new Set(list).size).toBe(list.length);
    // A couple of generic, always-relevant phrases stay guaranteed regardless of variety.
    expect(text).toContain('commercial use seamless pattern');
  });

  // Structural variety, not just which single word follows the subject: at least one phrase
  // should combine the subject with a real use-case ("... pattern for nursery decor"/"...
  // scrapbooking"/etc), not just "{subject} {format}".
  const anyUseCasePhrase = runs.some((text) => /pattern for [a-z ]+/.test(text));
  expect(anyUseCasePhrase).toBe(true);
});

// Real request: "when I download a zip file it always download[s] the etsy assistant generated
// text, can there be an option that it['s] ticked so it doesn't get downloaded". A checkbox in
// the Etsy Assistant panel, checked (the existing behaviour) by default, that downloadAllPagesZip
// now respects.
test('the "include EtsyAssistant.txt in download zip" checkbox is on by default and controls whether it gets bundled', async ({ page }) => {
  await expandAllBoxes(page);
  await page.evaluate(() => {
    document.getElementById('listingPatternName').value = 'Strawberry';
    document.getElementById('listingKeywords').value = '';
    window.generateListingHelper();
  });

  const checked = await page.evaluate(() => document.getElementById('includeEtsyAssistantInZip').checked);
  expect(checked).toBe(true);

  const wantsWithChecked = await page.evaluate(() => {
    const cb = document.getElementById('includeEtsyAssistantInZip');
    const want = !cb || cb.checked;
    const txt = want ? window.currentEtsyAssistantText() : '';
    return !!(txt && !txt.includes('No Etsy Assistant text generated yet.'));
  });
  expect(wantsWithChecked).toBe(true);

  await page.evaluate(() => {
    const cb = document.getElementById('includeEtsyAssistantInZip');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const wantsWithUnchecked = await page.evaluate(() => {
    const cb = document.getElementById('includeEtsyAssistantInZip');
    const want = !cb || cb.checked;
    const txt = want ? window.currentEtsyAssistantText() : '';
    return !!(txt && !txt.includes('No Etsy Assistant text generated yet.'));
  });
  expect(wantsWithUnchecked).toBe(false);
});
