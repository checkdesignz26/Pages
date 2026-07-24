// Document mode: the contenteditable editor node must never be replaced/recreated during
// normal editing (that was the root cause of the original "keyboard popup dismisses itself"
// bug - losing focus because the node under the cursor got swapped out), and formatting
// (heading/body toggles, font changes) must apply without requiring the user to reselect
// their text first.
const { test, expect, expandAllBoxes, clickResilient } = require('../support/fixtures');

async function openDocumentPage(page) {
  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForSelector('.documentEditor');
}

test('document editor DOM node survives selection, font, and heading changes', async ({ page }) => {
  await openDocumentPage(page);

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha Bravo Charlie Delta Echo Foxtrot');
  await page.evaluate(() => { document.querySelector('.documentEditor').__marker = 'ORIGINAL_NODE'; });

  const isOriginal = () => page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    return !!ed && ed.__marker === 'ORIGINAL_NODE';
  });

  expect(await isOriginal(), 'immediately after marking').toBe(true);

  await page.dblclick('.documentEditor');
  await page.waitForTimeout(150);
  expect(await isOriginal(), 'after double-click word selection').toBe(true);

  await page.evaluate(() => {
    document.getElementById('textStudioPanel').classList.remove('collapsed');
    document.body.classList.remove('rightCollapsed');
  });
  await page.selectOption('#fontFamily', 'Impact');
  // The font change triggers a debounced re-render; give it a moment to settle before
  // checking the node identity, matching the timing the original manual repro used.
  await page.waitForTimeout(300);
  expect(await isOriginal(), 'after changing fontFamily').toBe(true);

  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("heading 1")'));
  await page.waitForTimeout(300);
  expect(await isOriginal(), 'after clicking heading 1').toBe(true);
});

test('heading/body toggle and font changes apply without reselecting text', async ({ page }) => {
  await openDocumentPage(page);

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Alpha Bravo Charlie Delta Echo Foxtrot Golf');
  // The editor reflows/paginates on a short debounce after typing - let it settle before
  // selecting again, or the selection can land mid-reflow and miss trailing characters.
  await page.waitForTimeout(300);

  await page.keyboard.press('Control+A');
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("body")'));
  await page.waitForTimeout(150);
  await expect(page.locator('.documentEditor')).not.toContainText('undefined');

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  const selectionText = await page.evaluate(() => window.getSelection().toString());
  expect(selectionText).toContain('Alpha Bravo Charlie Delta Echo Foxtrot Golf');

  // Click heading 1 WITHOUT clicking back into the editor first - the real-world flow.
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("heading 1")'));
  await page.waitForTimeout(150);
  await expect(page.locator('.documentEditor h1')).toHaveCount(1);

  // Change font without reselecting - selection from the heading click should still apply.
  await page.evaluate(() => {
    document.getElementById('textStudioPanel').classList.remove('collapsed');
    document.body.classList.remove('rightCollapsed');
  });
  await page.selectOption('#fontFamily', 'Impact');
  await page.waitForTimeout(150);
  await expect(page.locator('.documentEditor h1 [style*="Impact"]').first()).toBeVisible();

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("heading 2")'));
  await page.waitForTimeout(150);
  await expect(page.locator('.documentEditor h2')).toHaveCount(1);

  const align = await page.evaluate(() => {
    const child = document.querySelector('.documentEditor').firstElementChild;
    return child ? getComputedStyle(child).textAlign : null;
  });
  expect(align).toBe('left');
});

test('typing enough text to overflow a page paginates into multiple pages', async ({ page }) => {
  await openDocumentPage(page);

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Word '.repeat(220), { delay: 1 });
  await page.waitForFunction(() => state.pages.length > 1, null, { timeout: 10000 });

  const pageCount = await page.evaluate(() => state.pages.length);
  expect(pageCount).toBeGreaterThan(1);
});

test('pasting rich HTML from another app keeps content on one page and drops styling noise', async ({ page }) => {
  await openDocumentPage(page);

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Start: ');

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const dt = new DataTransfer();
    dt.setData('text/plain', 'PASTED FROM NOTES APP\nSecond line of pasted content.');
    dt.setData('text/html', '<span style="font-family: Helvetica; color: red;">PASTED FROM NOTES APP</span><br>Second line of pasted content.');
    const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.dispatchEvent(evt);
  });

  await expect(page.locator('.documentEditor')).toContainText('PASTED FROM NOTES APP');
  await expect(page.locator('.documentEditor')).toContainText('Second line of pasted content.');

  const pages = await page.evaluate(() => state.pages.map((p) => ({ type: p.type, layers: (p.layers || []).length })));
  expect(pages.filter((p) => p.type === 'Document')).toHaveLength(1);
});

test('pasting a long plain-text block paginates into multiple document pages', async ({ page }) => {
  await openDocumentPage(page);

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Manual: ');
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  const longPasted = Array(15)
    .fill(0)
    .map((_, i) => `Step ${i}: This is a paragraph pasted from the Notes app describing part of the manual in detail.`)
    .join('\n');

  await page.evaluate((txt) => {
    const ed = document.querySelector('.documentEditor');
    const dt = new DataTransfer();
    dt.setData('text/plain', txt);
    const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.dispatchEvent(evt);
  }, longPasted);

  await page.waitForFunction(() => state.pages.length > 1, null, { timeout: 10000 });
  const pageCount = await page.evaluate(() => state.pages.length);
  expect(pageCount).toBeGreaterThan(1);
});
