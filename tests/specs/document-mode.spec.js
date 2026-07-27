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

test('the TOC title can be renamed and survives a later "update TOC" regeneration', async ({ page }) => {
  // Real request: the "Contents" heading was hardcoded and rewritten from scratch on every
  // "create / update TOC" click, with no way to rename it (e.g. to the manual's own title),
  // and the TOC block itself isn't editable text.
  await openDocumentPage(page);
  await page.evaluate(() => {
    document.querySelector('.documentEditor').innerHTML = '<h1>Chapter 1</h1><p>Body</p>';
    document.querySelector('.documentEditor').dispatchEvent(new Event('input', { bubbles: true }));
  });

  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("create / update TOC")'));
  await page.waitForSelector('.documentTOC');
  await expect(page.locator('.documentTOC h1')).toHaveText('Contents');

  let promptedWith = null;
  await page.evaluate(() => {
    window.prompt = (msg, def) => {
      window.__lastPromptDefault = def;
      return 'The Complete Mug Guide';
    };
  });
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("rename contents title")'));
  promptedWith = await page.evaluate(() => window.__lastPromptDefault);
  expect(promptedWith).toBe('Contents');

  await expect(page.locator('.documentTOC h1')).toHaveText('The Complete Mug Guide');

  // Regenerating the TOC (e.g. after adding another heading) must keep the renamed title,
  // not reset it back to "Contents".
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("create / update TOC")'));
  await expect(page.locator('.documentTOC h1')).toHaveText('The Complete Mug Guide');
});

test('print / save PDF builds a real multi-page PDF with one page per document/TOC page', async ({ page }) => {
  // Real request: printing a manual only showed the first page in the preview, not the other
  // 19. window.print()'s CSS pagination turned out to be unreliable for this dynamically-built
  // content on iOS Safari across more than one CSS-only fix attempt, so "print / save PDF" now
  // rasterizes each document/TOC page with plain canvas drawing (no window.print() involved at
  // all) and builds a real downloadable multi-page PDF file directly - this asserts the PDF
  // byte stream itself contains one page object per document/TOC page.
  await openDocumentPage(page);
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      window.addDocumentLitePage();
      current().docHtml = `<h1>Chapter ${i + 1}</h1><p>Body text ${i + 1}</p>`;
    }
    window.ppUpdateDocumentTOC();
  });

  const resultPromise = page.evaluate(() => new Promise((resolve) => {
    const orig = window.downloadBlob;
    window.downloadBlob = async (blob) => {
      window.downloadBlob = orig;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const text = new TextDecoder('latin1').decode(bytes);
      resolve({
        isPdf: text.startsWith('%PDF-'),
        pdfPageCount: (text.match(/\/Type \/Page\b/g) || []).length,
      });
    };
  }));

  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("print / save pdf")'));
  // The PDF is built (rasterized page by page) before the ready dialog appears, so the actual
  // download only fires from that dialog's own button - a fresh tap, not a stale one carried
  // over from the original click through however long rasterization took.
  await page.waitForSelector('#ppPdfReadyDownload', { timeout: 10000 });
  await page.click('#ppPdfReadyDownload');
  const result = await resultPromise;

  const docPageCount = await page.evaluate(() => state.pages.filter((p) => p.documentLite || p.type === 'Document' || p.type === 'Document TOC').length);
  expect(docPageCount).toBe(6); // openDocumentPage's page + 4 chapters + TOC
  expect(result.isPdf).toBe(true);
  expect(result.pdfPageCount).toBe(docPageCount);
});

test('pressing Enter after a heading drops back to body text instead of leaving another heading', async ({ page }) => {
  // Real request: the TOC filled up with several "Untitled heading" rows that the user never
  // knowingly created. Root cause - WebKit's default contentEditable behavior continues a
  // heading's tag onto the next line when you press Enter, so pressing it even just to add
  // space after a heading leaves an invisible, empty <h1>/<h2> behind.
  await openDocumentPage(page);
  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  await page.evaluate(() => document.execCommand('formatBlock', false, 'h1'));
  await page.keyboard.type('Welcome');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body line after two Enters');

  const tags = await page.evaluate(() => [...document.querySelector('.documentEditor').children].map((n) => n.tagName));
  expect(tags[0]).toBe('H1');
  expect(tags.slice(1)).not.toContain('H1');
  expect(tags.slice(1)).not.toContain('H2');

  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("create / update toc")'));
  await page.waitForSelector('.documentTOC');
  await expect(page.locator('.documentTOC')).not.toContainText('Untitled heading');
  await expect(page.locator('.documentTOCRow')).toHaveCount(1);
});

test('creating the TOC for the first time does not clobber it with the page content that was focused', async ({ page }) => {
  // Real request: bolding a line of body text on a document page, then generating the TOC,
  // left that same body text sitting on the "Contents" page instead of the generated listing.
  // Root cause - creating the TOC for the first time inserts it at index 0, shifting every
  // other page's array index by one. The page that was focused still had a *.documentEditor*
  // DOM node wired up with its OLD index baked into a WeakMap/dataset lookup; the DOM rebuild
  // that follows fires a synchronous blur on that focused, about-to-be-replaced editor, which
  // saved its content onto whatever page now sits at that stale old index - the brand new TOC.
  await openDocumentPage(page);
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.innerHTML = '<p>Welcome to Pattern Pages! 🎉</p><p>Second paragraph.</p>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.documentEditor p');
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const p = ed.querySelector('p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    ed.focus();
  });
  await page.evaluate(() => window.toggleBold());

  await expandAllBoxes(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("create / update toc")'));
  await page.waitForSelector('.documentTOC');
  await page.waitForTimeout(300);

  const pages = await page.evaluate(() => state.pages.map((p) => ({ docTOC: !!p.docTOC, docHtml: p.docHtml })));
  expect(pages[0].docTOC).toBe(true);
  expect(pages[0].docHtml).not.toContain('Welcome to Pattern Pages');
  expect(pages[1].docHtml).toContain('Welcome to Pattern Pages');
});
