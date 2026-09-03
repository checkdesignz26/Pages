/**
 * Pattern Pages — access-key gate + 7-day free trial
 *
 * This is the code layer in front of the static `index.html` deployment
 * (Cloudflare runs this script's fetch handler first, per `run_worker_first`
 * in wrangler.toml, before ever falling back to env.ASSETS.fetch — an
 * unauthorized visitor never receives the real file at all).
 *
 * Originally this only checked one shared secret (env.ACCESS_KEY). It now
 * checks a KV namespace of many keys instead, each with its own type:
 *   - "lifetime": never expires (e.g. "82667", already handed out to real
 *     Etsy customers via the digital-download PDF - it's seeded into KV as
 *     a permanent entry rather than living in env.ACCESS_KEY any more).
 *   - "trial": expires 7 days after it's first minted.
 *
 * A brand-new visitor (no cookies at all) is let straight in and silently
 * starts a 7-day trial - no signup step, matching how Etsy buyers already
 * expect to just click a link and be working. A returning visitor mid-trial
 * is let in via a `pp_trial` cookie (an opaque id, never shown to the user
 * or typed in - only real access keys are). Once the trial's KV record
 * expires, they see the gate page again, now with trial-expired copy and a
 * link back to the Etsy listing, instead of the original "wrong/missing
 * key" copy.
 *
 * SETUP (one-time, in the Cloudflare dashboard for the "ppages" Worker):
 * 1. Workers & Pages -> KV -> create a namespace (any name, e.g.
 *    "pp-licenses"). Copy its ID.
 * 2. On the "ppages" Worker -> Settings -> Bindings -> add a KV namespace
 *    binding: variable name PP_LICENSES, pointing at the namespace from
 *    step 1. (This replaces the old ACCESS_KEY secret - that can be
 *    deleted once 82667 is confirmed working via KV instead, see the
 *    generate-etsy-codes.js script for how 82667 gets seeded in.)
 * 3. Deploy this file (same drag-and-drop/upload flow as before - upload
 *    index.html and this _worker.js together).
 *
 * After that, a link like:
 *   https://ppages.checkdesignz.com/?key=YOUR-KEY-HERE
 * unlocks the site and remembers the visitor via a cookie for COOKIE_DAYS
 * days. Anyone who hits the bare domain with no valid key/cookie/trial sees
 * the gate page, with a box to type a key in by hand.
 */

const ACCESS_COOKIE = 'pp_access';
const TRIAL_COOKIE = 'pp_trial';
const COOKIE_DAYS = 180;
const TRIAL_DAYS = 7;
const RATE_LIMIT_MAX_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cookies = parseCookies(request.headers.get('Cookie') || '');

    let attemptedKey = null;
    if (request.method === 'POST') {
      attemptedKey = await getFormKey(request);
    } else {
      attemptedKey = url.searchParams.get('key');
    }

    // Any request that's actively trying a key (right or wrong) counts
    // against the rate limit, checked before touching KV for the key
    // itself - this is what actually blunts brute-forcing a short numeric
    // keyspace now that there's more than one valid value to guess.
    if (attemptedKey !== null) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const allowed = await checkAndBumpRateLimit(env, ip);
      if (!allowed) {
        return new Response(gatePage('rateLimited'), {
          status: 429,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      const record = await lookupCode(env, attemptedKey);
      if (record) {
        if (request.method === 'POST') {
          // The gate page's form submits here as a POST. Cloudflare's
          // static-asset binding only ever serves GET/HEAD - redirect to a
          // clean GET instead of trying to serve the file directly in
          // response to the form submit (matches the original behaviour).
          return new Response(null, {
            status: 303,
            headers: { Location: url.origin + url.pathname, 'Set-Cookie': buildCookie(ACCESS_COOKIE, attemptedKey) },
          });
        }
        // GET ?key= - serve the real file directly in this same response
        // and set the cookie alongside it, exactly like the original
        // single-secret version did (no extra redirect round-trip for a
        // link like ppages.checkdesignz.com/?key=XXXXX).
        const response = await env.ASSETS.fetch(request);
        const out = new Response(response.body, response);
        out.headers.append('Set-Cookie', buildCookie(ACCESS_COOKIE, attemptedKey));
        return out;
      }

      // Wrong key. GET requests with a bad ?key= just fall through to the
      // normal cookie/trial checks below (so a stale bookmarked link with
      // an old key doesn't lock out someone who separately already has a
      // valid cookie) - only a POST form submit gets the immediate
      // "that key wasn't right" response, matching the original behaviour.
      if (request.method === 'POST') {
        return new Response(gatePage('wrongKey'), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    }

    // A valid access key (lifetime or trial-as-a-typed-key, though trials
    // are never typed in practice) already exchanged for a cookie.
    const accessCookieValue = cookies[ACCESS_COOKIE];
    if (accessCookieValue) {
      const record = await lookupCode(env, accessCookieValue);
      if (record) {
        return env.ASSETS.fetch(request);
      }
    }

    // Mid-trial return visit, or a brand-new visitor about to start one.
    // Uses getRawRecord (not lookupCode) because lookupCode filters out
    // expired trials entirely - here we need to tell "expired" (show
    // trial-expired copy) apart from "no such record at all" (treat as a
    // brand-new visitor and start a trial), not just get a yes/no.
    const trialCookieValue = cookies[TRIAL_COOKIE];
    if (trialCookieValue) {
      const trial = await getRawRecord(env, trialCookieValue);
      if (trial && trial.type === 'trial' && !trial.revoked) {
        if (Date.now() < trial.expiresAt) {
          return env.ASSETS.fetch(request);
        }
        return new Response(gatePage('trialExpired'), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // Cookie present but no matching (or revoked) KV record - e.g. a
      // very old/foreign cookie - fall through and treat as a brand-new
      // visitor below.
    }

    const trialId = await mintTrial(env);
    const response = await env.ASSETS.fetch(request);
    const out = new Response(response.body, response);
    out.headers.append('Set-Cookie', buildCookie(TRIAL_COOKIE, trialId));
    return out;
  },
};

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = value;
  });
  return out;
}

async function getFormKey(request) {
  try {
    const form = await request.clone().formData();
    return form.get('key');
  } catch (e) {
    return null;
  }
}

// Looks up a code in KV and returns its record only if it's currently
// usable (not revoked, and - for trials - not expired). Callers that need
// to distinguish "expired trial" from "no such code" (to choose gate page
// copy) read env.PP_LICENSES directly instead - this helper is for the
// "is this good enough to let them in right now" checks.
async function lookupCode(env, code) {
  if (!code) return null;
  let raw;
  try {
    raw = await env.PP_LICENSES.get(code);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (record.revoked) return null;
  if (record.type === 'trial' && (!record.expiresAt || Date.now() >= record.expiresAt)) return null;
  return record;
}

// Unlike lookupCode, returns whatever is in KV as-is with no revoked/expiry
// filtering, so callers can tell "expired" apart from "never existed" (and
// check revoked themselves) rather than just getting a plain yes/no.
async function getRawRecord(env, code) {
  if (!code) return null;
  let raw;
  try {
    raw = await env.PP_LICENSES.get(code);
  } catch (e) {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

async function mintTrial(env) {
  const id = 'trial_' + crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  const record = { type: 'trial', createdAt: now, expiresAt: now + TRIAL_DAYS * 24 * 60 * 60 * 1000, revoked: false };
  await env.PP_LICENSES.put(id, JSON.stringify(record));
  return id;
}

async function checkAndBumpRateLimit(env, ip) {
  const key = `ratelimit:${ip}`;
  let current = 0;
  try {
    const raw = await env.PP_LICENSES.get(key);
    current = raw ? parseInt(raw, 10) || 0 : 0;
  } catch (e) {
    // If KV is having trouble, fail open on rate limiting rather than
    // locking everyone out - the key lookup itself is still the real gate.
    return true;
  }
  if (current >= RATE_LIMIT_MAX_ATTEMPTS) return false;
  try {
    await env.PP_LICENSES.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  } catch (e) {}
  return true;
}

function buildCookie(name, value, days = COOKIE_DAYS) {
  const maxAge = days * 24 * 60 * 60;
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

const ETSY_LISTING_URL = 'https://checkdesignz.etsy.com/listing/4562855179';

function gatePage(variant) {
  let heading = 'Pattern Pages';
  let message = 'Enter your access key to continue.';
  let errorLine = '';
  let showBuyLink = false;

  if (variant === 'wrongKey') {
    errorLine = '<div class="err">That key wasn\'t right - try again.</div>';
  } else if (variant === 'trialExpired') {
    heading = 'Your trial has ended';
    message = 'Your 7-day free trial of Pattern Pages is over. Enter your access key to keep going, or buy on Etsy to get one.';
    showBuyLink = true;
  } else if (variant === 'rateLimited') {
    heading = 'Too many attempts';
    message = 'Too many key attempts from this connection - please wait a bit and try again.';
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pattern Pages</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#141225;color:#fff8fb;font:16px/1.5 system-ui,-apple-system,sans-serif;}
  .card{max-width:360px;width:90%;padding:32px 28px;border-radius:18px;
    background:rgba(255,255,255,.06);border:1px solid rgba(255,232,248,.14);text-align:center;}
  h1{font-size:20px;margin:0 0 6px;}
  p{color:#c9c1d6;font-size:14px;margin:0 0 20px;}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;
    border:1px solid rgba(255,232,248,.24);background:rgba(255,255,255,.07);
    color:#fff8fb;font-size:15px;margin-bottom:12px;}
  button{width:100%;padding:12px;border:0;border-radius:12px;font-weight:800;
    font-size:15px;cursor:pointer;color:#fff;
    background:linear-gradient(90deg,#7c5cff,#ff5ea8);}
  .err{color:#ff8ea3;font-size:13px;margin:-8px 0 14px;}
  .buyLink{display:block;margin-top:14px;color:#ffb8e7;font-size:13.5px;font-weight:700;text-decoration:none;}
  .buyLink:hover{text-decoration:underline;}
</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${message}</p>
    ${errorLine}
    <form method="POST">
      <input type="text" name="key" placeholder="Access key" autofocus autocomplete="off">
      <button type="submit">Unlock</button>
    </form>
    ${showBuyLink ? `<a class="buyLink" href="${ETSY_LISTING_URL}" target="_blank" rel="noopener">Buy Pattern Pages on Etsy &rarr;</a>` : ''}
  </div>
</body>
</html>`;
}
