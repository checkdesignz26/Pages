# Setting up the trial + access-key system

This replaces the single shared "82667" key with a system that supports many
keys, plus:
- A 7-day free trial for first-time visitors.
- **Automatic per-buyer codes**: a Zapier automation calls the Worker the
  moment someone buys on Etsy, which mints a fresh unique code and emails
  it straight to them - no more picking a code out of a shared list.
- **A "lost my key?" recovery page** (`/recover`) a customer can use to have
  their code emailed to them again.

It only touches the `ppages` Worker — nothing about how you deploy
`index.html` itself changes.

**Note:** this folder does not contain your real `index.html` -
`test-placeholder-index.html` was only used for local testing while
building this. When you deploy for real, upload your actual `index.html`
(the one from the main app) together with the new `_worker.js` below,
exactly like you did originally.

## Part 1 — Cloudflare (KV + the Worker itself)

1. **Create the KV namespace.** Cloudflare dashboard → Workers & Pages →
   KV (in the left sidebar) → **Create a namespace**. Name it anything, e.g.
   `pp-licenses`. Click Create.

2. **Bind it to the `ppages` Worker.** Go to your `ppages` Worker → Settings
   → Bindings → **Add binding** → choose **KV namespace**. Set:
   - Variable name: `PP_LICENSES` (must be exactly this - the code looks
     for this name)
   - KV namespace: the one you just created
   Save.

3. **Add two secrets**, same Settings → Variables and Secrets page → **Add
   variable** → toggle **Encrypt** (makes it a secret, not a plain var):
   - `ISSUE_SECRET` — make up any long random string (e.g. mash the
     keyboard for 30+ characters). This is what proves a code-issuing
     request really came from your own Zapier automation and not a
     stranger trying to mint free codes. You'll paste this exact value
     into Zapier in Part 3.
   - `RESEND_API_KEY` — from Resend, see Part 2 below (come back to this
     step once you have it).

4. **Deploy the updated code.** On the `ppages` Worker's deployment page
   (wherever you originally uploaded `index.html` + `_worker.js`), upload
   your real `index.html` together with the new `_worker.js` from this
   folder - same process as before. Deploy.

5. **Load the already-issued key so existing customers keep working.**
   You need `wrangler` (Cloudflare's CLI) for this - if you don't have it,
   run `npx wrangler login` once from a terminal in this `worker/` folder
   first (it opens a browser to sign into your Cloudflare account).
   ```
   npx wrangler kv bulk put seed-existing-key-82667.json --binding=PP_LICENSES --remote
   ```

6. **(Optional cleanup)** Once you've confirmed everything works, you can
   delete the old `ACCESS_KEY` secret from the Worker's Settings →
   Variables and Secrets - it's no longer read by the code (82667 now
   lives in KV instead, permanently, from step 5).

## Part 2 — Resend (the email service)

1. Sign up at [resend.com](https://resend.com) - free tier covers 3,000
   emails/month, plenty for an Etsy shop.
2. **Add and verify a sending domain**: Resend → Domains → Add Domain →
   enter a domain or subdomain you own (e.g. `checkdesignz.com`, or a
   subdomain like `mail.checkdesignz.com` if you'd rather keep it separate
   from your main site). Resend gives you a few DNS records (TXT/MX/CNAME)
   to add - since your domain's DNS is already on Cloudflare, this is just
   pasting them into Cloudflare's DNS tab. Verification usually goes green
   within a few minutes.
3. **Create an API key**: Resend → API Keys → Create API Key. Copy it.
4. Go back to Cloudflare and paste it in as the `RESEND_API_KEY` secret
   (Part 1, step 3).
5. **Add the `FROM_EMAIL` variable** (a plain variable is fine, doesn't
   need to be a secret): something like `Pattern Pages <hello@checkdesignz.com>`,
   using your newly-verified domain. If you skip this, emails fall back to
   Resend's own test address, which is fine for trying things out but you
   should set a real one before going live.

## Part 3 — Zapier (triggers the automatic email on purchase)

1. Sign up at [zapier.com](https://zapier.com) if you don't already have
   an account (free tier: a couple of active Zaps, up to 100 tasks/month -
   fine to start; upgrade later if your order volume grows).
2. **Create a new Zap**:
   - **Trigger**: search for "Etsy", choose **New Order**. Connect your
     Etsy shop account when prompted.
   - **Action**: search for "Webhooks by Zapier", choose **POST**.
     - URL: `https://ppages.checkdesignz.com/api/issue-code`
     - Payload type: `json`
     - Data: two fields -
       - `email` → map this to the buyer's email field from the Etsy
         trigger (Zapier shows you the available fields from a real test
         order when you set this up)
       - `orderId` → map this to the Etsy order/receipt ID field
     - Headers: add one - `X-Issue-Secret` → paste the exact same value
       you set as the `ISSUE_SECRET` secret in Part 1, step 3.
3. **Test the step** (Zapier has a "Test" button) - it should come back
   with a 200 response containing a freshly minted code. Check your own
   email if you used your own address for the test order.
4. **Turn the Zap on.**

That's it - the Worker sends the email itself, so there's no separate
"send email" step to add in Zapier.

## What to do with the existing Etsy digital-download PDF

Once the Zap above is live, buyers get their code by email automatically -
they don't need to open the digital download to get a code at all. You can:
- **Keep `patternpages-access-key.pdf`** (the batch of 300 codes) attached
  as a backup, in case the automation ever hiccups for someone - a line in
  it already explains to check email first. This is the safer option.
- **Or swap it for something simpler**, like a short PDF that just says
  "check your email for your access key" and links to `/recover` in case
  they can't find it - up to you, not required for the system to work.

## How it behaves after all of this

- A brand-new visitor is let straight in and a 7-day trial starts silently
  in the background - no signup, no key needed yet.
- Returning within those 7 days, they keep getting in automatically.
- After 7 days, they see the gate page again with a "your trial has ended"
  message, a box to enter an access key, a link to buy on Etsy, and a
  "Lost your access key?" link to the recovery page.
- The moment someone buys on Etsy, they automatically get an email with
  their own unique code within moments (via the Zap above).
- If they lose that email, `https://ppages.checkdesignz.com/recover` lets
  them re-request it by typing the email they bought with - they always
  see the same "if we found it, it's on its way" message either way, so
  the page can't be used to check whether a given email address has
  bought before.
- Anyone who enters a valid key gets in and stays remembered via a cookie
  for 180 days, same as before.
- Repeated wrong-key or recovery attempts from the same visitor get
  temporarily blocked, so short numeric keys can't be brute-forced and the
  recovery page can't be used to spam someone's inbox.

## If you ever need a fresh batch of the shared-list codes

Only needed if you want to keep the shared-PDF backup topped up - the
automatic per-buyer emails from Part 3 don't need this at all.
```
node generate-etsy-codes.js
python3 generate-etsy-pdf.py
```
This overwrites the previous `etsy-codes-*.json`/PDF files in this folder,
so rename or copy them first if you want to keep the old batch for
reference. Then load the new batch into KV:
```
npx wrangler kv bulk put etsy-codes-kv-bulk.json --binding=PP_LICENSES --remote
```
