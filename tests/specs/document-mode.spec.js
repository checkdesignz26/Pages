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

  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("heading 1")'));
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
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("body")'));
  await page.waitForTimeout(150);
  await expect(page.locator('.documentEditor')).not.toContainText('undefined');

  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');
  const selectionText = await page.evaluate(() => window.getSelection().toString());
  expect(selectionText).toContain('Alpha Bravo Charlie Delta Echo Foxtrot Golf');

  // Click heading 1 WITHOUT clicking back into the editor first - the real-world flow.
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("heading 1")'));
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
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("heading 2")'));
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

test('a longer manual (~20 pages) builds a PDF without crashing on the byte-stream conversion', async ({ page }) => {
  // Real device report: makePdfBlobFromPages() threw "RangeError: Maximum call stack size
  // exceeded" building a 19-page manual. Root cause - it converted each page's JPEG bytes to
  // a binary string via String.fromCharCode(...imgBytes), spreading the ENTIRE byte array as
  // individual function arguments; anything beyond a small image blows past the JS engine's
  // max-arguments limit. Fixed by chunking that conversion (bytesToBinaryString). This shares
  // the exact function the pre-existing "multi-page PDF" pattern-page export also uses, so the
  // same crash could in principle have hit that path too for large enough pages.
  await openDocumentPage(page);
  await page.evaluate(() => {
    for (let i = 0; i < 18; i++) {
      window.addDocumentLitePage();
      current().docHtml = `<h1>Chapter ${i + 1} - A Longer Chapter Title Here</h1><p>${'This is realistic body text meant to produce a reasonably sized JPEG once rasterized, long enough to matter. '.repeat(8)}</p>`;
    }
    window.ppUpdateDocumentTOC();
  });

  const resultPromise = page.evaluate(() => new Promise((resolve) => {
    const orig = window.downloadBlob;
    window.downloadBlob = async (blob) => {
      window.downloadBlob = orig;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const text = new TextDecoder('latin1').decode(bytes);
      resolve({ isPdf: text.startsWith('%PDF-'), pdfPageCount: (text.match(/\/Type \/Page\b/g) || []).length });
    };
  }));

  let pageError = null;
  page.once('pageerror', (e) => { pageError = e.message; });
  await page.evaluate(() => window.ppPrintDocument());
  await page.waitForSelector('#ppPdfReadyDownload', { timeout: 15000 });
  await page.click('#ppPdfReadyDownload');
  const result = await resultPromise;

  const docPageCount = await page.evaluate(() => state.pages.filter((p) => p.documentLite || p.type === 'Document' || p.type === 'Document TOC').length);
  expect(pageError).toBeNull();
  expect(docPageCount).toBe(20); // openDocumentPage's page + 18 chapters + TOC
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

test('the on-screen keyboard opening scrolls the focused document page back into view', async ({ page }) => {
  // Real request: the keyboard covers the text being typed and the user has to scroll up
  // manually to see it. 'focus' fires before the keyboard's open animation finishes, so it
  // can't be used to compute where to scroll to - visualViewport's own height only shrinks
  // once that animation actually completes, giving an accurate signal to act on instead.
  //
  // This used to assert the correction called scrollIntoView({block:'center'}) on the whole
  // editor element - that was the bug reported as "it jumps when I place the cursor" (centering
  // a full page, not the caret, inside a viewport shrunk by the keyboard). The fix (see the more
  // detailed 'keyboard-open scroll correction' test below) scrolls the nearest scroll container
  // by the minimal amount needed to bring the caret into view instead. This test just confirms
  // the shrink-resize signal still triggers *some* scroll correction on the workspace scroller.
  await openDocumentPage(page);
  // Let this app's known startup-settling renders (several independent setTimeout(...) calls
  // scattered up to ~1.6s after load, per fixtures.js) finish first - otherwise one of them can
  // replace the .documentEditor DOM node after this test has already grabbed and monkey-patched
  // it, out from under the still-running test.
  await page.waitForTimeout(1800);
  // Add a real paragraph of text and place the caret in it via the Range API, rather than a
  // plain .click(). Chromium's click-to-caret placement is unreliable for this purpose - even
  // clicking directly on a text-bearing element can resolve the caret to an element-container
  // boundary rather than a text-node one, which gives an all-zero getBoundingClientRect() (not a
  // real-world caret position, and, correctly, no longer enough on its own to trigger the scroll
  // correction below). Setting the boundary directly on the text node sidesteps that.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const p = document.createElement('p');
    p.textContent = 'Some real body text to click on.';
    ed.appendChild(p);
    state.pages[state.selectedPage].docHtml = ed.innerHTML;
    ed.focus();
    const r = document.createRange();
    r.setStart(p.firstChild, 4);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.waitForTimeout(200);

  const scrolledBy = await page.evaluate(() => new Promise((resolve) => {
    const scroller = document.getElementById('workspace');
    const orig = scroller.scrollBy;
    scroller.scrollBy = function (opts) {
      scroller.scrollBy = orig;
      resolve(opts);
    };
    const vv = window.visualViewport;
    const realHeight = vv.height;
    Object.defineProperty(vv, 'height', { get: () => Math.round(realHeight * 0.3), configurable: true });
    vv.dispatchEvent(new Event('resize'));
    setTimeout(() => resolve(null), 500);
  }));

  expect(scrolledBy).not.toBeNull();
  expect(scrolledBy.behavior).toBe('smooth');
});

test('PDF export renders the actual font applied to each run, not always Georgia', async ({ page }) => {
  // Real request: the downloaded PDF always came out in the default font, ignoring whatever
  // font was applied to the text in the editor. Root cause - ppDrawDocBlock() hardcoded
  // "Georgia, serif" into every ctx.font string it built, and ppFlattenInlineRuns() never even
  // read a span's font-family in the first place. Fixed by tracking font-family per inline run
  // (from the span's own inline style, since this off-screen rasterization holder never gets
  // the app's real CSS classes) and using it when drawing. Verified here by rendering the same
  // text in two different fonts and confirming the rasterized pixels actually differ - if the
  // font were still hardcoded, both renders would be pixel-identical.
  const htmlFor = (font) => `<p><span style="font-family: '${font}';">The quick brown fox jumps.</span></p>`;
  const [georgiaPng, courierPng] = await page.evaluate(async ([hGeorgia, hCourier]) => {
    const c1 = await window.ppRasterizeDocPage(hGeorgia, 1240, 1754, 1);
    const c2 = await window.ppRasterizeDocPage(hCourier, 1240, 1754, 1);
    return [c1.toDataURL('image/png'), c2.toDataURL('image/png')];
  }, [htmlFor('Georgia'), htmlFor('Courier New')]);

  expect(georgiaPng).not.toBe(courierPng);
});

test('document image: select, resize via handle, rotate via handle, align, delete', async ({ page }) => {
  // Real request: wire real resize/rotate/move controls into document mode images, matching
  // canvas layers. A document image lives inline in flowing text rather than free-floating like
  // a layer, so free x/y positioning was ruled out (user's choice) in favor of drag-to-resize,
  // drag-to-rotate (both via the same .handle/.rotateHandle overlay elements used for layers,
  // tracked to the image's live rect every frame since it isn't absolutely positioned like a
  // layer is), and left/centre/right alignment standing in for "move". The shared
  // "edit & adjust" panel's x move/y move/width/height/fit* controls don't apply to an inline
  // image at all, so they're hidden while one is selected rather than left visibly broken, and
  // restored on deselect.
  await openDocumentPage(page);
  await page.waitForTimeout(1800);

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#ppDocImageInput', { name: 'test.png', mimeType: 'image/png', buffer: png1x1 });
  await page.waitForSelector('.documentEditor img');

  await page.click('.documentEditor img');
  await page.waitForTimeout(150);
  const afterSelect = await page.evaluate(() => ({
    hasOverlay: !!document.getElementById('ppDocImgOverlay'),
    hint: document.getElementById('selectedHint').textContent,
    boxHasClass: Array.from(document.querySelectorAll('.box')).some((b) => {
      const h = b.querySelector('h2');
      return h && h.textContent.trim().toLowerCase() === 'edit & adjust' && b.classList.contains('ppDocImageActive');
    }),
    scaleRowHidden: getComputedStyle(document.querySelector('.rangeRow:has(#scale)')).display === 'none',
  }));
  expect(afterSelect.hasOverlay).toBe(true);
  expect(afterSelect.hint).toBe('Document image selected');
  expect(afterSelect.boxHasClass).toBe(true);
  expect(afterSelect.scaleRowHidden).toBe(true);

  const handleBox = await page.locator('#ppDocImgOverlay .handle').boundingBox();
  const widthBefore = await page.evaluate(() => document.querySelector('.documentEditor img').getBoundingClientRect().width);
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 100, handleBox.y + handleBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const widthAfter = await page.evaluate(() => document.querySelector('.documentEditor img').getBoundingClientRect().width);
  expect(widthAfter).toBeGreaterThan(widthBefore);

  const rotHandleBox = await page.locator('#ppDocImgOverlay .rotateHandle').boundingBox();
  await page.mouse.move(rotHandleBox.x + rotHandleBox.width / 2, rotHandleBox.y + rotHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rotHandleBox.x + rotHandleBox.width / 2 + 80, rotHandleBox.y + rotHandleBox.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const transform = await page.evaluate(() => document.querySelector('.documentEditor img').style.transform);
  expect(transform).toMatch(/rotate\(/);

  await page.click('#ppDocImgAlignRight');
  const margins = await page.evaluate(() => {
    const img = document.querySelector('.documentEditor img');
    return { left: img.style.marginLeft, right: img.style.marginRight };
  });
  expect(margins.left).toBe('auto');
  expect(parseFloat(margins.right)).toBe(0);

  await page.click('.documentEditor p, .documentEditor');
  await page.waitForTimeout(150);
  const afterDeselect = await page.evaluate(() => ({
    overlayGone: !document.getElementById('ppDocImgOverlay'),
    scaleRowVisible: getComputedStyle(document.querySelector('.rangeRow:has(#scale)')).display !== 'none',
  }));
  expect(afterDeselect.overlayGone).toBe(true);
  expect(afterDeselect.scaleRowVisible).toBe(true);

  await page.click('.documentEditor img');
  await page.waitForTimeout(100);
  await page.click('#ppDocImgDeleteBtn');
  await page.waitForTimeout(100);
  const stillThere = await page.evaluate(() => !!document.querySelector('.documentEditor img'));
  expect(stillThere).toBe(false);
});

test('the shared opacity control still drives a normal layer after being used on a document image', async ({ page }) => {
  // selectImage() replaces the shared #opacity slider's oninput with a document-image-specific
  // handler (since it isn't wired through the normal layer-based applyControls() at all); this
  // confirms deselecting restores the original handler rather than leaving ordinary layers
  // permanently unable to change opacity through that control.
  await openDocumentPage(page);
  await page.waitForTimeout(1800);
  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#ppDocImageInput', { name: 'test.png', mimeType: 'image/png', buffer: png1x1 });
  await page.waitForSelector('.documentEditor img');
  await page.click('.documentEditor img');
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    document.getElementById('opacity').value = 40;
    document.getElementById('opacity').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.deselect());

  await page.evaluate(() => {
    addText('text');
    state.selected = current().layers[current().layers.length - 1].id;
    render();
  });
  await page.waitForTimeout(200);

  const layerOpacityAfter = await page.evaluate(() => {
    document.getElementById('opacity').disabled = false;
    document.getElementById('opacity').value = 55;
    document.getElementById('opacity').dispatchEvent(new Event('input', { bubbles: true }));
    return current().layers[current().layers.length - 1].opacity;
  });
  expect(layerOpacityAfter).toBeCloseTo(0.55, 2);
});

test('switching to a different page without deselecting a document image first restores the shared panel', async ({ page }) => {
  // Real report: after selecting an image in document mode, switching to a different (normal
  // canvas) page left the "edit & adjust" panel permanently stuck showing only the document-
  // image controls (opacity/align/delete) - the fit canvas/rotate/etc controls a real image
  // layer on that other page needs never came back. Root cause - trackOverlay()'s rAF loop
  // noticed the selected image's DOM node was gone (pages re-render fresh DOM on switch) and
  // tore down the floating handle overlay, but only that: it never called the fuller
  // clearSelection() that actually removes the ppDocImageActive class, so the panel stayed
  // stuck in document-image mode indefinitely, even for whatever got selected on the new page.
  await openDocumentPage(page);
  await page.waitForTimeout(1800);

  const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#ppDocImageInput', { name: 'test.png', mimeType: 'image/png', buffer: png1x1 });
  await page.waitForSelector('.documentEditor img');
  await page.click('.documentEditor img');
  await page.waitForTimeout(150);

  const activeBefore = await page.evaluate(() => Array.from(document.querySelectorAll('.box')).some((b) => {
    const h = b.querySelector('h2');
    return h && h.textContent.trim().toLowerCase() === 'edit & adjust' && b.classList.contains('ppDocImageActive');
  }));
  expect(activeBefore).toBe(true);

  // Switch to a different, non-document page WITHOUT explicitly deselecting or clicking away
  // from the image first - e.g. tapping a page thumbnail.
  await page.evaluate(() => {
    state.pages.push({ type: 'listing', w: 3000, h: 2250, layers: [] });
    state.selectedPage = state.pages.length - 1;
    state.selected = null;
    render();
  });
  await page.waitForTimeout(300); // give the rAF-based overlay tracker a chance to notice

  const afterSwitch = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll('.box')).find((b) => {
      const h = b.querySelector('h2');
      return h && h.textContent.trim().toLowerCase() === 'edit & adjust';
    });
    return {
      stillActive: box.classList.contains('ppDocImageActive'),
      overlayGone: !document.getElementById('ppDocImgOverlay'),
      alignRowGone: !document.getElementById('ppDocImgAlignRow'),
      deleteBtnGone: !document.getElementById('ppDocImgDeleteBtn'),
    };
  });
  expect(afterSwitch.stillActive).toBe(false);
  expect(afterSwitch.overlayGone).toBe(true);
  expect(afterSwitch.alignRowGone).toBe(true);
  expect(afterSwitch.deleteBtnGone).toBe(true);

  // Selecting a normal image layer on the new page must get the FULL panel (fit canvas,
  // rotate, etc), not stay stuck showing only opacity/align.
  await page.evaluate(() => {
    const l = layer('rectangle', { name: 'r', x: 5, y: 5, w: 20, h: 20, fill: '#f00', z: nextZ() });
    current().layers.push(l);
    state.selected = l.id;
    render();
  });
  await page.waitForTimeout(200);

  const layerPanel = await page.evaluate(() => ({
    rotateVisible: getComputedStyle(document.querySelector('.rangeRow:has(#rotate)')).display !== 'none',
    fitCanvasVisible: getComputedStyle(document.querySelector('.grid2:has([onclick*="fitSelected"])')).display !== 'none',
  }));
  expect(layerPanel.rotateVisible).toBe(true);
  expect(layerPanel.fitCanvasVisible).toBe(true);
});

// Real request: define what Heading 1/Heading 2/body text look like once and have every
// occurrence throughout the document use it - like a Word/Google Docs paragraph style -
// instead of having to reformat each heading individually. Implemented as a single dynamic
// <style> rule scoped to .documentEditor h1/h2/p (ppApplyDocStylesCSS), so it applies to every
// heading automatically, including ones that don't exist yet.
test('setting a heading style from one heading applies it everywhere, updates live, and does not clobber direct formatting', async ({ page }) => {
  await openDocumentPage(page);
  await page.evaluate(() => {
    document.getElementById('textStudioPanel').classList.remove('collapsed');
    document.body.classList.remove('rightCollapsed');
  });

  // Format the existing default heading ("Title") with a distinct font and promote it to the
  // document-wide Heading 1 style.
  await page.click('.documentEditor h1');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.selectOption('#fontFamily', 'Impact');
  await page.waitForTimeout(200);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("set heading 1 style")'));
  await page.waitForTimeout(150);

  // Create a brand-new heading elsewhere in the document, with no manual font formatting at all.
  await page.click('.documentEditor p');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second Heading');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("heading 1")'));
  await page.waitForTimeout(200);

  let fonts = await page.evaluate(() => Array.from(document.querySelectorAll('.documentEditor h1'))
    .map((h) => getComputedStyle(h).fontFamily));
  expect(fonts.length).toBeGreaterThanOrEqual(2);
  fonts.forEach((f) => expect(f).toContain('Impact'));

  // Change the style again from a THIRD, freshly-created (unformatted) heading, using a
  // different font this time.
  await page.click('.documentEditor h1:has-text("Second Heading")');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third Heading');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:text-is("heading 1")'));
  await page.waitForTimeout(200);
  await page.click('.documentEditor h1:has-text("Third Heading")');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.selectOption('#fontFamily', 'Georgia');
  await page.waitForTimeout(200);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("set heading 1 style")'));
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    // Read the "Title" heading's inline-formatted span, not the <h1> tag itself - the tag has
    // no text of its own (it's all inside that span), so the tag's OWN computed font-family
    // just reflects whatever the shared style rule currently says, telling us nothing about
    // whether the direct formatting survived.
    const titleSpan = document.querySelector('.documentEditor h1 span');
    const secondH1 = [...document.querySelectorAll('.documentEditor h1')].find((h) => h.textContent.includes('Second Heading'));
    return {
      title: getComputedStyle(titleSpan).fontFamily,
      second: getComputedStyle(secondH1).fontFamily,
    };
  });
  // The original "Title" heading has its own direct Impact formatting (a nested span) - a
  // later style change must not clobber it.
  expect(after.title).toContain('Impact');
  // "Second Heading" was never directly formatted, so it tracks the live style definition and
  // must have picked up the newer Georgia style, not stayed stuck on the older Impact one.
  expect(after.second).toContain('Georgia');
});

test('a heading style survives a save/load round trip', async ({ page }) => {
  await openDocumentPage(page);
  await page.evaluate(() => {
    document.getElementById('textStudioPanel').classList.remove('collapsed');
    document.body.classList.remove('rightCollapsed');
  });
  await page.click('.documentEditor h1');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.selectOption('#fontFamily', 'Impact');
  await page.waitForTimeout(200);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("set heading 1 style")'));
  await page.waitForTimeout(150);

  await page.evaluate(() => window.quickSaveProject());
  await page.waitForTimeout(300);

  const wiped = await page.evaluate(() => {
    window.ppDocStyles = {};
    window.ppApplyDocStylesCSS();
    return document.getElementById('pp-doc-custom-styles').textContent;
  });
  expect(wiped).toBe('');

  await page.evaluate(() => window.quickLoadProject());
  await page.waitForTimeout(300);

  const restored = await page.evaluate(() => ({
    docStyles: window.ppDocStyles,
    css: document.getElementById('pp-doc-custom-styles').textContent,
  }));
  expect(restored.docStyles.h1 && restored.docStyles.h1.fontFamily).toContain('Impact');
  expect(restored.css).toContain('Impact');
});

// Real report: "it doesn't want to delete empty pages" - turned out the user was trying to
// delete them with the keyboard (Backspace), not the page-list "x" button. Each document page
// is its own separate contentEditable, so Backspace has no natural way to reach across into a
// different page/DOM node the way it would within one continuous document - pressing it at the
// start of an empty page just did nothing. Fixed by detecting that exact case (caret at the very
// start of a genuinely empty page) and merging the page away, moving the caret to the end of
// the previous one - matching Word/Docs behavior for an empty paragraph/page.
test('pressing Backspace at the start of an empty document page deletes it and moves the caret to the previous page', async ({ page }) => {
  await openDocumentPage(page);
  // Add a second page and empty it out completely, to reproduce a genuinely blank page (the
  // default "add document page" content is never actually empty - it starts with "Title" and
  // placeholder body text).
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForTimeout(300);
  const countBefore = await page.evaluate(() => state.pages.length);

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor[data-page-index="1"]');
    ed.innerHTML = '<p><br></p>';
    state.pages[1].docHtml = ed.innerHTML;
  });

  await page.click('.documentEditor[data-page-index="1"]');
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor[data-page-index="1"]');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  const countAfter = await page.evaluate(() => state.pages.length);
  expect(countAfter).toBe(countBefore - 1);

  const focusedOnPrevious = await page.evaluate(() => {
    const prev = document.querySelector('.documentEditor[data-page-index="0"]');
    return document.activeElement === prev;
  });
  expect(focusedOnPrevious).toBe(true);
});

test('Backspace at the start of a non-empty document page does nothing special (no accidental page deletion)', async ({ page }) => {
  await openDocumentPage(page);
  await clickResilient(page, page.locator('#ppDocumentLitePanel button:has-text("add document page")'));
  await page.waitForTimeout(300);
  const countBefore = await page.evaluate(() => state.pages.length);

  // The default new-page content ("Title" / placeholder body text) is not empty - Backspace at
  // its very start must not delete the page out from under real content.
  await page.click('.documentEditor[data-page-index="1"] h1');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  const countAfter = await page.evaluate(() => state.pages.length);
  expect(countAfter).toBe(countBefore);
});

// Real request: "Start writing here…" was literal text baked into every new document page's
// HTML, so the user had to manually select and delete it before typing their own content. It's
// now a genuine CSS placeholder (like a native <input placeholder>) on the actual empty body
// paragraph, so it should disappear on its own the moment they start typing - never require a
// manual delete, and never survive into the saved docHtml as real text.
test('"Start writing here…" is a real placeholder that disappears the moment you type, not literal text to delete', async ({ page }) => {
  await openDocumentPage(page);
  // Known pre-existing artifact (see custom-fonts.spec.js): several independent setTimeout()
  // calls scattered across the file can replace the .documentEditor DOM node up to ~1.6s after
  // load - interacting before that settles can land a caret/selection on a node that's about to
  // be swapped out from under it.
  await page.waitForTimeout(1800);

  const initial = await page.evaluate(() => {
    const p = document.querySelector('.documentEditor p');
    return { docHtml: state.pages[state.selectedPage].docHtml, placeholderContent: getComputedStyle(p, '::before').content };
  });
  // The placeholder text must not be real, literal content in the saved HTML...
  expect(initial.docHtml).not.toContain('Start writing here');
  // ...but it must still be visibly showing via CSS on the empty paragraph.
  expect(initial.placeholderContent).toContain('Start writing here');

  // A raw click doesn't reliably land a caret inside an element that's visually just a <br> -
  // place it via the selection API directly instead, the same fix already needed elsewhere in
  // this file for the same reason.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const p = ed.querySelector('p');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.type('H');

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.documentEditor p'), '::before').content))
    .not.toContain('Start writing here');
});

// Real request: collapsing the right panel for a wider canvas got silently undone every time a
// document editor regained focus - which routinely happens just from scrolling/tapping between
// pages while writing, not just from deliberately opening the panel. Fixed by never forcing
// body.rightCollapsed off from either the editor-focus path (activate()) or the document-image
// selection path (selectImage()) - only their own already-visible accordion section still
// auto-expands.
test('collapsing the right panel in document mode stays collapsed when scrolling/re-focusing a page', async ({ page }) => {
  await openDocumentPage(page);
  await page.evaluate(() => { toggleSidePanel('right'); });
  expect(await page.evaluate(() => document.body.classList.contains('rightCollapsed'))).toBe(true);

  // Simulate what happens while scrolling/tapping between pages: the document editor regains
  // focus (real click, not a synthetic focus() call, matching what a tap actually does).
  await page.click('.documentEditor h1');
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => document.body.classList.contains('rightCollapsed'))).toBe(true);
});

test('collapsing the right panel stays collapsed when selecting an image inside a document page', async ({ page }) => {
  const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await openDocumentPage(page);
  await page.evaluate((src) => {
    const ed = document.querySelector('.documentEditor');
    const img = document.createElement('img');
    img.src = src;
    ed.appendChild(img);
  }, png1x1);

  await page.evaluate(() => { toggleSidePanel('right'); });
  expect(await page.evaluate(() => document.body.classList.contains('rightCollapsed'))).toBe(true);

  await page.click('.documentEditor img');
  await page.waitForTimeout(150);

  expect(await page.evaluate(() => document.body.classList.contains('rightCollapsed'))).toBe(true);
});

// Real report: the last line of text on a document page rendered half-clipped. Likely cause:
// custom/embedded fonts (docStyles, uploaded fonts) aren't necessarily finished loading at the
// fixed 20ms mark decorate() originally used to check pagination - text measured against a
// fallback font's metrics can fit, then reflow slightly larger once the real @font-face
// actually loads, with nothing left to re-check pagination afterward. Fixed by re-verifying
// once document.fonts.ready resolves. Simulates the exact race by controlling when
// document.fonts.ready resolves directly, then mutating the editor's content (standing in for
// "the reflow that happens once the real font loads") before it resolves.
test('a page that overflows only after fonts finish loading still gets its overflow corrected', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fontsReadyPromise = new Promise((resolve) => { window.__resolveFontsReady = resolve; });
    Object.defineProperty(document.fonts, 'ready', { get: () => window.__fontsReadyPromise, configurable: true });
  });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');

  await openDocumentPage(page);
  const countBefore = await page.evaluate(() => state.pages.length);

  // At this point the fixed-delay pagination check has already run (content fit fine then).
  // Now simulate "the real font loaded and the text got bigger" by directly stuffing enough
  // extra content into the live editor to overflow it - without ever telling the app via a
  // real 'input' event, the same way a pure font-swap reflow would never fire one either.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    for (let i = 0; i < 40; i++) {
      const p = document.createElement('p');
      p.textContent = 'Extra reflowed line of text that did not fit before the font finished loading.';
      ed.appendChild(p);
    }
  });
  await page.waitForTimeout(100);
  // Without the fix, nothing would ever move this overflow to a new page.
  expect(await page.evaluate(() => state.pages.length)).toBe(countBefore);

  await page.evaluate(() => { window.__resolveFontsReady(); });
  await page.waitForFunction((before) => state.pages.length > before, countBefore, { timeout: 5000 });

  expect(await page.evaluate(() => state.pages.length)).toBeGreaterThan(countBefore);
});

// Real report, confirmed from a screen recording: editing text made the caret/page jump around
// erratically, with the on-screen keyboard repeatedly dismissing and reappearing. Root cause:
// moveOverflow() always followed the caret onto the newly-created page whenever ANY trailing
// content overflowed, even when the edit that triggered it happened somewhere else entirely in
// the page (e.g. fixing a word near the top while a paragraph near the bottom happened to be
// sitting right at the page boundary) - yanking focus away mid-edit to a page the user was
// never actually looking at.
test('editing text in the middle of a page does not steal the caret away to a new page when unrelated trailing content overflows', async ({ page }) => {
  await openDocumentPage(page);
  await page.click('.documentEditor');
  await page.keyboard.press('Control+A');

  // Build up content paragraph by paragraph until it's right at the overflow boundary (one more
  // paragraph would push over), without ever crossing it yet.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.innerHTML = '<h1>Title</h1>';
    let i = 0;
    while (ed.scrollHeight <= ed.clientHeight + 2 && i < 200) {
      const p = document.createElement('p');
      p.textContent = `Paragraph number ${i} with enough words in it to take up a full line of the page.`;
      ed.appendChild(p);
      i++;
    }
    // Back off by one paragraph so we're just under the boundary, not already over it.
    ed.lastElementChild.remove();
    state.pages[state.selectedPage].docHtml = ed.innerHTML;
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => state.pages.length)).toBe(1);

  // Place the caret in the FIRST paragraph (nowhere near the bottom of the page) and type there -
  // this alone pushes the trailing content just over the boundary.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const firstP = ed.querySelector('p');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(firstP);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.keyboard.type('EDITED-HERE ');

  await page.waitForFunction(() => state.pages.length > 1, null, { timeout: 5000 });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => ({
    focusedPageIndex: document.activeElement.classList.contains('documentEditor') ? +document.activeElement.dataset.pageIndex : null,
    firstParagraphText: document.querySelector('.documentEditor[data-page-index="0"] p').textContent,
  }));
  // Focus must stay on the page being edited (page 0), not jump to the new page 1 that
  // received the unrelated overflowed content.
  expect(after.focusedPageIndex).toBe(0);
  expect(after.firstParagraphText).toContain('EDITED-HERE');
});

// Real report: placing the cursor felt like it "jumped". Root cause: the on-screen-keyboard
// scroll correction used scrollIntoView({block:'center'}) on the whole editor ELEMENT (a full
// page, usually taller than the visible area once the keyboard is up) instead of the caret's
// own position - tapping anywhere on a tall page would re-center the whole page around its
// middle, landing far from where the caret (and the user's finger) actually was.
test('the keyboard-open scroll correction brings the caret into view without overshooting to re-center the whole page', async ({ page }) => {
  await openDocumentPage(page);

  // Build a page taller than any reasonable viewport, and place the caret near its bottom -
  // this is exactly the case where "center the whole element" and "bring the caret into view"
  // produce very different amounts of scrolling.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.innerHTML = '<h1>Title</h1>';
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('p');
      p.textContent = `Line ${i} of a long page.`;
      ed.appendChild(p);
    }
    state.pages[state.selectedPage].docHtml = ed.innerHTML;
  });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    const lastP = ed.querySelector('p:last-of-type');
    lastP.scrollIntoView({ block: 'center' });
    ed.focus();
    const r = document.createRange();
    // A range collapsed via an ELEMENT container + child-index boundary (e.g.
    // selectNodeContents(lastP) + collapse()) gives an all-zero getBoundingClientRect() in
    // Chromium - there's no adjacent glyph for the browser to anchor a rect to at that
    // representation. Setting the boundary directly on the actual text node + character offset
    // resolves to a real, non-zero caret position instead.
    r.setStart(lastP.firstChild, lastP.firstChild.length);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  const before = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { caretTop: r.top, caretBottom: r.bottom };
  });
  expect(before.caretTop).toBeGreaterThan(0);

  // Simulate the on-screen keyboard opening: visualViewport shrinks and fires 'resize'.
  const realHeight = await page.evaluate(() => window.visualViewport.height);
  // Deliberately much smaller than a real keyboard would take - centering the caret's Y
  // position in the full-height viewport (~50%) would clearly land outside a 30% cutoff,
  // making this discriminate reliably between "bring the caret to the edge" and "re-center
  // the whole element regardless of where the constrained area actually ends".
  const shrunkHeight = Math.round(realHeight * 0.3);
  // Check the #workspace.scrollBy() call itself rather than the resulting scrollTop/caret
  // position: in a headless run the whole (short) test document can already fit within the
  // real, unshrunk viewport with nothing left to actually scroll, at whatever zoom level the
  // app happens to pick - making a post-hoc "did the caret end up on-screen" check dependent on
  // incidental layout rather than the fix itself. The old buggy code called
  // editor.scrollIntoView(...) directly and never touched #workspace.scrollBy at all, so this
  // still discriminates cleanly: no call (or an unbounded one) means the bug is back.
  const scrollByCall = await page.evaluate((h) => new Promise((resolve) => {
    const scroller = document.getElementById('workspace');
    const orig = scroller.scrollBy;
    let called = null;
    scroller.scrollBy = function (opts) { called = opts; return orig.apply(this, arguments); };
    Object.defineProperty(window.visualViewport, 'height', { get: () => h, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
    setTimeout(() => resolve(called), 400);
  }), shrunkHeight);

  expect(scrollByCall).not.toBeNull();
  expect(scrollByCall.behavior).toBe('smooth');

  // A correct "nearest edge" scroll moves the caret to just above the new keyboard-constrained
  // bottom edge (a 24px margin) - a small, bounded, and exactly-predictable distance - not an
  // arbitrary whole-page-height jump from trying to center the entire (much taller) element.
  const expectedDelta = before.caretBottom - (shrunkHeight - 24);
  expect(scrollByCall.top).toBeGreaterThan(0);
  expect(Math.abs(scrollByCall.top - expectedDelta)).toBeLessThan(5);
});

// Real report, confirmed from a screen recording: tapping into a page to start editing it
// scrolled the view a full page further, landing on the NEXT page entirely - only on the first
// tap, never on a second one right after. Root cause: the keyboard-open correction above used to
// fall back to activeEditor.getBoundingClientRect() (the WHOLE page, top to bottom) whenever a
// precise caret rect wasn't available at the moment it ran - a real gap, since caret placement
// after a tap happens in its own async step (see pp-single-tap-keyboard-186-js) that can still be
// in flight when the keyboard's resize event fires. A tall page's bottom edge sits far below the
// keyboard-constrained viewport, so that fallback could compute a scroll delta large enough to
// land on the following page. A second tap has no such gap (the editor's already focused, the
// caret's already there), which is exactly why it never repeated.
test('the keyboard-open scroll correction does nothing if the caret is not yet available, instead of guessing with the whole page', async ({ page }) => {
  await openDocumentPage(page);

  // A page tall enough that its own bottom edge sits well below a keyboard-shrunk viewport -
  // exactly the shape that made the old whole-editor fallback overshoot by roughly a page.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.innerHTML = '<h1>Title</h1>';
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('p');
      p.textContent = `Line ${i} of a long page.`;
      ed.appendChild(p);
    }
    state.pages[state.selectedPage].docHtml = ed.innerHTML;
  });
  await page.waitForTimeout(300);

  // Focus the editor (as a real tap would, synchronously setting activeEditor) but deliberately
  // leave the selection collapsed OUTSIDE it - simulating the real gap where the async caret
  // placement after a tap hasn't landed yet by the time the keyboard's resize event fires.
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.focus();
    const s = window.getSelection();
    s.removeAllRanges();
  });

  const realHeight = await page.evaluate(() => window.visualViewport.height);
  const shrunkHeight = Math.round(realHeight * 0.3);
  const scrollByCall = await page.evaluate((h) => new Promise((resolve) => {
    const scroller = document.getElementById('workspace');
    const orig = scroller.scrollBy;
    let called = null;
    scroller.scrollBy = function (opts) { called = opts; return orig.apply(this, arguments); };
    Object.defineProperty(window.visualViewport, 'height', { get: () => h, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
    setTimeout(() => resolve(called), 400);
  }), shrunkHeight);

  // No caret to go on - the correct move is to do nothing, not scroll based on the whole page.
  expect(scrollByCall).toBeNull();
});

// Real report, with a screenshot: a heading the user had written once showed up twice in a row
// on the same page after re-opening a saved .ppages file, and got worse (three copies) the more
// times the file had been saved/reopened. Root cause: the fonts-ready recheck (added to fix the
// "last line half clipped" bug) sweeps every .documentEditor node in one pass, low index to high.
// pullBack() on an earlier page can pull the FIRST element off a later page straight out of that
// later page's `docHtml` in the pages() array - without ever touching that later page's own,
// still-live DOM node. When the sweep then reaches that later page's own (now-stale) DOM node,
// moveOverflow() unconditionally writes `editor.innerHTML` back over `pages()[index].docHtml` -
// resurrecting the exact content pullBack just removed, so it ends up living on both pages.
test('a heading pulled back into a shorter page does not also survive on the page it was pulled from', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fontsReadyPromise = new Promise((resolve) => { window.__resolveFontsReady = resolve; });
    Object.defineProperty(document.fonts, 'ready', { get: () => window.__fontsReadyPromise, configurable: true });
  });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');

  await openDocumentPage(page);
  // Let layout settle before taking pixel-precise measurements - other tests in this file that
  // measure geometry right after load hit occasional jitter without this (matches the pattern
  // used elsewhere, e.g. the keyboard-scroll test above).
  await page.waitForTimeout(300);

  // Fill page 0 with paragraphs until it's one paragraph away from overflowing, then confirm
  // (via a throwaway probe element) exactly how many trailing paragraphs need to come back off
  // to leave a gap that fits a heading alone, but not a heading plus another paragraph - the
  // exact shape of the real bug (the heading moves, the paragraph after it does not).
  const setup = await page.evaluate(() => {
    const ed0 = document.querySelector('.documentEditor');
    ed0.innerHTML = '<h1>Title</h1>';
    let i = 0;
    while (ed0.scrollHeight <= ed0.clientHeight + 2 && i < 400) {
      const p = document.createElement('p');
      p.textContent = `Paragraph number ${i} with enough words in it to take up a full line.`;
      ed0.appendChild(p);
      i++;
    }
    ed0.lastElementChild.remove(); // back under the boundary

    function overflowsWithHeadingProbe() {
      const probe = document.createElement('h2');
      probe.textContent = 'Chapter 1 – Getting Started';
      ed0.appendChild(probe);
      const overflows = ed0.scrollHeight > ed0.clientHeight + 2;
      probe.remove();
      return overflows;
    }
    // Keep backing off one paragraph at a time until the heading alone would fit.
    let guard = 0;
    while (overflowsWithHeadingProbe() && ed0.children.length > 1 && guard++ < 50) {
      ed0.lastElementChild.remove();
    }
    const headingAloneFits = !overflowsWithHeadingProbe();

    function overflowsWithHeadingAndParagraphProbe() {
      const probeH = document.createElement('h2');
      probeH.textContent = 'Chapter 1 – Getting Started';
      const probeP = document.createElement('p');
      probeP.textContent = 'Pattern Pages runs directly in your web browser, so there is nothing to install.';
      ed0.appendChild(probeH);
      ed0.appendChild(probeP);
      const overflows = ed0.scrollHeight > ed0.clientHeight + 2;
      probeH.remove();
      probeP.remove();
      return overflows;
    }
    const headingAndParagraphOverflow = overflowsWithHeadingAndParagraphProbe();

    state.pages[state.selectedPage].docHtml = ed0.innerHTML;
    return { headingAloneFits, headingAndParagraphOverflow };
  });
  expect(setup.headingAloneFits).toBe(true);
  expect(setup.headingAndParagraphOverflow).toBe(true);

  await page.evaluate(() => {
    addDocumentLitePage(0);
    const ed1 = document.querySelector('.documentEditor[data-page-index="1"]');
    ed1.innerHTML = '<h2>Chapter 1 – Getting Started</h2><p>Pattern Pages runs directly in your web browser, so there is nothing to install.</p>';
    state.pages[1].docHtml = ed1.innerHTML;
  });
  await page.waitForTimeout(300); // let the normal fixed-delay pagination settle first

  await page.evaluate(() => { window.__resolveFontsReady(); });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    page0: state.pages[0].docHtml,
    page1: state.pages[1].docHtml,
  }));

  const headingCount = (html) => (html.match(/Chapter 1/g) || []).length;
  const totalHeadingCopies = headingCount(result.page0) + headingCount(result.page1);

  expect(totalHeadingCopies).toBe(1);
  expect(result.page0).toContain('Chapter 1');
  expect(result.page1).not.toContain('Chapter 1');
  expect(result.page1).toContain('Pattern Pages runs directly');
});

// Real bug, confirmed from a saved user file: a heading that had its font size nudged a few
// times ended up 12 levels deep in nested <span style="font-size:..."> wrappers - applyCss()
// (used for font size, letter spacing, and line height) wrapped the selection in a brand new
// span on every single change instead of updating the one it had just created. applyFontFamily
// already avoided this for the font dropdown; applyCss needed the same fix.
test('repeatedly changing font size on the same selection updates one span in place instead of nesting a new one each time', async ({ page }) => {
  await openDocumentPage(page);
  await expandAllBoxes(page);
  await page.evaluate(() => {
    const ed = document.querySelector('.documentEditor');
    ed.innerHTML = '<h1>Title</h1><p>Some heading text</p>';
    ed.focus();
    const p = ed.querySelector('p');
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  // Simulate dragging the font-size slider through several values (continuous 'input' events),
  // then releasing it (one final 'change') - exactly how a real drag interaction fires events.
  for (const v of [22, 24, 26, 28]) {
    await page.evaluate((val) => {
      const el = document.getElementById('fontSize');
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  }
  await page.evaluate(() => {
    document.getElementById('fontSize').dispatchEvent(new Event('change', { bubbles: true }));
  });

  const result = await page.evaluate(() => {
    const p = document.querySelector('.documentEditor p');
    let depth = 0, el = p.querySelector('span');
    while (el) { depth++; el = el.querySelector('span'); }
    return { depth, html: p.innerHTML, text: p.textContent };
  });

  expect(result.depth).toBeLessThanOrEqual(1);
  expect(result.text).toBe('Some heading text'); // content itself must survive intact
});

// Real report, the day after the duplication fix above shipped: selecting text landed one
// character short on the first attempt, correct on a second try. The duplication fix's resync
// (moveOverflow rebuilding an editor's innerHTML from the array when a sibling page's pullBack
// bumped its version behind its back) didn't check whether the editor being resynced was the
// one the user currently has focused/mid-selection in - wiping it out from under a live touch
// selection is exactly the kind of thing that would drop a character on the first try.
test('a background cross-page reflow does not wipe out an active selection in the page currently being edited', async ({ page }) => {
  await page.addInitScript(() => {
    window.__fontsReadyPromise = new Promise((resolve) => { window.__resolveFontsReady = resolve; });
    Object.defineProperty(document.fonts, 'ready', { get: () => window.__fontsReadyPromise, configurable: true });
  });
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state && typeof window.render === 'function');

  await openDocumentPage(page);

  // Same "page 0 has room for exactly a heading, not a heading + paragraph" setup as the
  // duplication repro above - this is what makes the fonts-ready sweep's pullBack() actually
  // move page 1's heading into page 0, bumping page 1's flow version.
  const setup = await page.evaluate(() => {
    const ed0 = document.querySelector('.documentEditor');
    ed0.innerHTML = '<h1>Title</h1>';
    let i = 0;
    while (ed0.scrollHeight <= ed0.clientHeight + 2 && i < 400) {
      const p = document.createElement('p');
      p.textContent = `Paragraph number ${i} with enough words in it to take up a full line.`;
      ed0.appendChild(p);
      i++;
    }
    ed0.lastElementChild.remove();
    function overflowsWithHeadingProbe() {
      const probe = document.createElement('h2');
      probe.textContent = 'Chapter 1 – Getting Started';
      ed0.appendChild(probe);
      const overflows = ed0.scrollHeight > ed0.clientHeight + 2;
      probe.remove();
      return overflows;
    }
    let guard = 0;
    while (overflowsWithHeadingProbe() && ed0.children.length > 1 && guard++ < 50) {
      ed0.lastElementChild.remove();
    }
    const headingAloneFits = !overflowsWithHeadingProbe();
    state.pages[state.selectedPage].docHtml = ed0.innerHTML;
    return { headingAloneFits };
  });
  expect(setup.headingAloneFits).toBe(true);

  await page.evaluate(() => {
    addDocumentLitePage(0);
    const ed1 = document.querySelector('.documentEditor[data-page-index="1"]');
    ed1.innerHTML = '<h2>Chapter 1 – Getting Started</h2><p>Pattern Pages runs directly in your web browser, so there is nothing to install.</p>';
    state.pages[1].docHtml = ed1.innerHTML;
  });
  await page.waitForTimeout(300);

  // Focus page 1 and select the paragraph text (not the heading that's about to be pulled away)
  // - simulating the user mid-selection on body text while an unrelated background sync runs.
  await page.evaluate(() => {
    const ed1 = document.querySelector('.documentEditor[data-page-index="1"]');
    const p = ed1.querySelector('p');
    ed1.focus();
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });

  await page.evaluate(() => { window.__resolveFontsReady(); });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const ed1 = document.querySelector('.documentEditor[data-page-index="1"]');
    const s = window.getSelection();
    return {
      stillFocused: document.activeElement === ed1,
      selectionText: s && s.rangeCount ? s.toString() : '',
    };
  });

  expect(after.stillFocused).toBe(true);
  expect(after.selectionText).toContain('Pattern Pages runs directly');
});

// Real report: dragging a text selection backward (right-to-left, extending the selection's
// START handle past the first character) dropped that character on the first attempt, correct
// on a retry. .documentPaper used to carry the page's visual inset as its own padding, with
// .documentEditor sized to only paper's already-padded content box - so a backward drag that
// overshot past the first character's edge left the editable element's DOM bounding box
// entirely, landing in paper's padding where there's no editable content to hit-test against.
// The fix moves that same visual inset onto the editor itself (as its own padding, kept visually
// identical via box-sizing:border-box) so the editor's hit-testable bounds now cover the whole
// page - this can't simulate an actual iOS drag gesture, but it can verify the underlying
// geometry the bug depended on no longer exists. (An earlier version of this fix also switched
// the editor to position:absolute, which turned out to make an unrelated pagination test
// noticeably flakier under repeated runs - dropped in favor of this narrower change, which only
// moves the padding and keeps the editor's existing position/sizing model otherwise untouched.)
test('the document editor\'s hit-testable bounds cover the whole page, not just its padded text area', async ({ page }) => {
  await openDocumentPage(page);
  await page.waitForTimeout(300);

  const rects = await page.evaluate(() => {
    const paper = document.querySelector('.documentPaper');
    const editor = document.querySelector('.documentEditor');
    const pr = paper.getBoundingClientRect();
    const er = editor.getBoundingClientRect();
    return {
      paper: { top: pr.top, left: pr.left, width: pr.width, height: pr.height },
      editor: { top: er.top, left: er.left, width: er.width, height: er.height },
    };
  });

  expect(Math.abs(rects.editor.left - rects.paper.left)).toBeLessThan(1);
  expect(Math.abs(rects.editor.top - rects.paper.top)).toBeLessThan(1);
  expect(Math.abs(rects.editor.width - rects.paper.width)).toBeLessThan(1);
  expect(Math.abs(rects.editor.height - rects.paper.height)).toBeLessThan(1);
});
