# Setting up the trial + access-key system

This replaces the single shared "82667" key with a system that supports many
keys (so new Etsy buyers get their own code instead of everyone sharing one)
plus a 7-day free trial for first-time visitors. It only touches the
`ppages` Worker — nothing about how you deploy `index.html` itself changes.

**Note:** this folder does not contain your real `index.html` -
`test-placeholder-index.html` was only used for local testing while
building this. When you deploy for real, upload your actual `index.html`
(the one from the main app) together with the new `_worker.js` below,
exactly like you did originally.

## One-time setup (in the Cloudflare dashboard)

1. **Create the KV namespace.** Cloudflare dashboard → Workers & Pages →
   KV (in the left sidebar) → **Create a namespace**. Name it anything, e.g.
   `pp-licenses`. Click Create.

2. **Bind it to the `ppages` Worker.** Go to your `ppages` Worker → Settings
   → Bindings → **Add binding** → choose **KV namespace**. Set:
   - Variable name: `PP_LICENSES` (must be exactly this - the code looks
     for this name)
   - KV namespace: the one you just created
   Save.

3. **Deploy the updated code.** On the `ppages` Worker's deployment page
   (wherever you originally uploaded `index.html` + `_worker.js`), upload
   your real `index.html` together with the new `_worker.js` from this
   folder - same process as before. Deploy.

4. **Load the access codes into KV.** You need `wrangler` (Cloudflare's
   CLI) for this part - if you don't have it, run `npx wrangler login`
   once from a terminal in this `worker/` folder first (it opens a browser
   to sign into your Cloudflare account).

   Load the already-issued key so existing customers keep working:
   ```
   npx wrangler kv bulk put seed-existing-key-82667.json --binding=PP_LICENSES --remote
   ```
   Load the new batch of 300 codes for the new Etsy PDF:
   ```
   npx wrangler kv bulk put etsy-codes-kv-bulk.json --binding=PP_LICENSES --remote
   ```
   (If either command asks which Worker/environment, pick `ppages`.)

5. **Swap the Etsy digital download.** Replace the current file attached
   to your Etsy listing with `patternpages-access-key.pdf` from this folder
   - it lists all 300 new codes instead of the single old one. Buyers pick
   any code from the list.

6. **(Optional cleanup) Remove the old secret.** Once you've confirmed the
   new system works, you can delete the old `ACCESS_KEY` secret from the
   Worker's Settings → Variables and Secrets - it's no longer read by the
   code (82667 now lives in KV instead, permanently, from step 4).

## How it behaves after this

- A brand-new visitor is let straight in and a 7-day trial starts silently
  in the background - no signup, no key needed yet.
- Returning within those 7 days, they keep getting in automatically.
- After 7 days, they see the gate page again with a "your trial has ended"
  message, a box to enter an access key, and a link to buy on Etsy.
- Anyone who enters a valid key (82667, or one of the new 300) gets in and
  stays remembered via a cookie for 180 days, same as before.
- Repeated wrong-key attempts from the same visitor get temporarily
  blocked (20/hour) so the short numeric keys can't be brute-force guessed.

## If you ever need to add more codes later

Re-run the generator for a fresh batch (this OVERWRITES the previous
`etsy-codes-*.json`/PDF files in this folder, so rename or copy them first
if you want to keep the old batch around for reference):
```
node generate-etsy-codes.js
python3 generate-etsy-pdf.py
```
Then repeat steps 4-5 above with the newly generated files.
