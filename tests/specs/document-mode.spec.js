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
  await openDocumentPage(page);
  // Let this app's known startup-settling renders (several independent setTimeout(...) calls
  // scattered up to ~1.6s after load, per fixtures.js) finish first - otherwise one of them can
  // replace the .documentEditor DOM node after this test has already grabbed and monkey-patched
  // it, out from under the still-running test.
  await page.waitForTimeout(1800);
  await page.click('.documentEditor');
  await page.waitForTimeout(200);

  const scrolledInto = await page.evaluate(() => new Promise((resolve) => {
    const ed = document.querySelector('.documentEditor');
    const orig = ed.scrollIntoView;
    ed.scrollIntoView = function (opts) {
      ed.scrollIntoView = orig;
      resolve(opts);
    };
    window.visualViewport.dispatchEvent(new Event('resize'));
    setTimeout(() => resolve(null), 500);
  }));

  expect(scrolledInto).not.toBeNull();
  expect(scrolledInto.block).toBe('center');
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

  const initial = await page.evaluate(() => {
    const p = document.querySelector('.documentEditor p');
    return { docHtml: state.pages[state.selectedPage].docHtml, placeholderContent: getComputedStyle(p, '::before').content };
  });
  // The placeholder text must not be real, literal content in the saved HTML...
  expect(initial.docHtml).not.toContain('Start writing here');
  // ...but it must still be visibly showing via CSS on the empty paragraph.
  expect(initial.placeholderContent).toContain('Start writing here');

  await page.click('.documentEditor p');
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
