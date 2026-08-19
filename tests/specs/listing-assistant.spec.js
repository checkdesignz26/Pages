// Etsy Listing Assistant tag generation. Real request, from a beta tester: hitting "generate"
// always produced the exact same fixed 13 tags for the same pattern name/keywords, with no way
// to get a fresh set of ideas to try without changing the input. generateListingHelper's tag
// list is built from a small set of always-the-same template words (subject+pattern,
// subject+print, ...) - now widened into a larger synonym pool that gets shuffled per call, so
// regenerating on the same input gives a different, still-relevant mix instead of a frozen list.
const { test, expect } = require('../support/fixtures');

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
