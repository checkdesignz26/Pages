// Standalone local test harness for _worker.js - no wrangler/network needed.
// Simulates env.PP_LICENSES (Cloudflare KV) with an in-memory Map, and
// env.ASSETS with a fake fetch() returning a fixed body, then exercises the
// worker's fetch handler directly via real Request/Response objects (Node
// 18+ has these as globals, matching the Workers runtime's own API shape).
import worker from './_worker.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('FAIL: ' + msg);
  }
}

function makeEnv(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    PP_LICENSES: {
      async get(key) {
        return store.has(key) ? store.get(key) : null;
      },
      async put(key, value) {
        store.set(key, value);
      },
      _store: store,
    },
    ASSETS: {
      async fetch(request) {
        return new Response('REAL_APP_CONTENT', { status: 200, headers: { 'content-type': 'text/html' } });
      },
    },
  };
}

function req(url, opts = {}) {
  return new Request(url, opts);
}

async function bodyText(response) {
  return await response.clone().text();
}

function getSetCookie(response) {
  // Node's fetch Headers only exposes one Set-Cookie via get(); use raw
  // getSetCookie() when available (undici supports it).
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieValue(setCookieHeaders, name) {
  for (const line of setCookieHeaders) {
    const m = line.match(new RegExp('^' + name + '=([^;]+)'));
    if (m) return m[1];
  }
  return null;
}

async function run() {
  // 1. Grandfathered lifetime key via ?key= (GET) - should serve content directly + set cookie.
  {
    const env = makeEnv({ '82667': { type: 'lifetime', createdAt: Date.now(), revoked: false } });
    const res = await worker.fetch(req('https://ppages.example.com/?key=82667'), env, {});
    assert(res.status === 200, '82667 via ?key= should return 200, got ' + res.status);
    assert((await bodyText(res)) === 'REAL_APP_CONTENT', '82667 via ?key= should serve real content');
    const cookies = getSetCookie(res);
    assert(cookieValue(cookies, 'pp_access') === '82667', '82667 via ?key= should set pp_access cookie, got ' + JSON.stringify(cookies));
  }

  // 2. Valid cookie from a prior visit - should serve content, no new cookie needed.
  {
    const env = makeEnv({ '82667': { type: 'lifetime', createdAt: Date.now(), revoked: false } });
    const res = await worker.fetch(req('https://ppages.example.com/', { headers: { Cookie: 'pp_access=82667' } }), env, {});
    assert(res.status === 200, 'valid pp_access cookie should return 200, got ' + res.status);
    assert((await bodyText(res)) === 'REAL_APP_CONTENT', 'valid pp_access cookie should serve real content');
  }

  // 3. Wrong key via POST form - should show gate page with error, 401, no cookie.
  {
    const env = makeEnv({ '82667': { type: 'lifetime', createdAt: Date.now(), revoked: false } });
    const form = new URLSearchParams();
    form.set('key', 'wrongkey');
    const res = await worker.fetch(
      req('https://ppages.example.com/', { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      env,
      {}
    );
    assert(res.status === 401, 'wrong POST key should return 401, got ' + res.status);
    const html = await bodyText(res);
    assert(html.includes("wasn't right"), 'wrong POST key should show "wasn\'t right" error');
    assert(getSetCookie(res).length === 0, 'wrong POST key should not set any cookie');
  }

  // 4. Brand-new visitor (no cookies at all) - should be let in AND start a trial silently.
  {
    const env = makeEnv();
    const res = await worker.fetch(req('https://ppages.example.com/'), env, {});
    assert(res.status === 200, 'brand-new visitor should return 200 (silent trial start), got ' + res.status);
    assert((await bodyText(res)) === 'REAL_APP_CONTENT', 'brand-new visitor should see real content immediately');
    const cookies = getSetCookie(res);
    const trialId = cookieValue(cookies, 'pp_trial');
    assert(!!trialId && trialId.startsWith('trial_'), 'brand-new visitor should get a pp_trial cookie, got ' + JSON.stringify(cookies));
    assert(env.PP_LICENSES._store.has(trialId), 'trial id should have a KV record');
    const record = JSON.parse(env.PP_LICENSES._store.get(trialId));
    assert(record.type === 'trial', 'minted record should be type trial');
    const daysLeft = (record.expiresAt - Date.now()) / 86400000;
    assert(daysLeft > 6.9 && daysLeft <= 7, 'fresh trial should expire ~7 days out, got ' + daysLeft.toFixed(2) + ' days');
  }

  // 5. Returning visitor mid-trial (pp_trial cookie, not yet expired) - silent passthrough.
  {
    const env = makeEnv({ trial_abc: { type: 'trial', createdAt: Date.now() - 1000, expiresAt: Date.now() + 3 * 86400000, revoked: false } });
    const res = await worker.fetch(req('https://ppages.example.com/', { headers: { Cookie: 'pp_trial=trial_abc' } }), env, {});
    assert(res.status === 200, 'mid-trial visitor should return 200, got ' + res.status);
    assert((await bodyText(res)) === 'REAL_APP_CONTENT', 'mid-trial visitor should see real content');
  }

  // 6. Returning visitor with an EXPIRED trial - should see trial-expired gate page, 401.
  {
    const env = makeEnv({ trial_old: { type: 'trial', createdAt: Date.now() - 8 * 86400000, expiresAt: Date.now() - 86400000, revoked: false } });
    const res = await worker.fetch(req('https://ppages.example.com/', { headers: { Cookie: 'pp_trial=trial_old' } }), env, {});
    assert(res.status === 401, 'expired trial should return 401, got ' + res.status);
    const html = await bodyText(res);
    assert(html.includes('trial has ended') || html.includes('Your trial has ended'), 'expired trial should show trial-expired heading');
    assert(html.includes('checkdesignz.etsy.com'), 'expired trial gate page should link to the Etsy listing');
  }

  // 7. Stale/foreign pp_trial cookie with no matching KV record - should be treated as a
  //    brand-new visitor (start a fresh trial), not stuck on the generic gate page.
  {
    const env = makeEnv();
    const res = await worker.fetch(req('https://ppages.example.com/', { headers: { Cookie: 'pp_trial=nonexistent_id' } }), env, {});
    assert(res.status === 200, 'unrecognized pp_trial cookie should fall back to starting a fresh trial, got status ' + res.status);
    const cookies = getSetCookie(res);
    assert(!!cookieValue(cookies, 'pp_trial'), 'unrecognized pp_trial cookie should be replaced with a fresh one');
  }

  // 8. A revoked lifetime key must never be exchanged for a persistent
  //    pp_access cookie (it falls through to the same "start a fresh
  //    trial" path as any other wrong/unrecognized key, same as a
  //    brand-new visitor with no key at all - that's an accepted existing
  //    trade-off, not a new hole this introduces). The property that
  //    actually matters: a revoked key can never grant standing access.
  {
    const env = makeEnv({ REVOKED1: { type: 'lifetime', createdAt: Date.now(), revoked: true } });
    const res = await worker.fetch(req('https://ppages.example.com/?key=REVOKED1'), env, {});
    const cookies = getSetCookie(res);
    assert(cookieValue(cookies, 'pp_access') !== 'REVOKED1', 'a revoked key must never be set as the pp_access cookie value');
    // Confirm that cookie is genuinely useless afterwards even if somehow set.
    const record = JSON.parse(env.PP_LICENSES._store.get('REVOKED1'));
    assert(record.revoked === true, 'sanity: the seeded record is actually marked revoked');
    // A revoked pp_access cookie alone (no other credentials) falls through
    // to the same "treat as an ordinary new visitor" path as no credentials
    // at all - by design, the same as any other invalid key (see the
    // comment on the "wrong key falls through" branch in _worker.js). What
    // must NOT happen is the revoked key being treated as validated: the
    // response should carry a fresh pp_trial cookie (ordinary-visitor
    // treatment), not a re-affirmed pp_access cookie for REVOKED1.
    const replay = await worker.fetch(req('https://ppages.example.com/', { headers: { Cookie: 'pp_access=REVOKED1' } }), env, {});
    const replayCookies = getSetCookie(replay);
    assert(cookieValue(replayCookies, 'pp_access') !== 'REVOKED1', 'a revoked pp_access cookie must never be re-affirmed as valid');
    assert(!!cookieValue(replayCookies, 'pp_trial'), 'a revoked pp_access cookie with no other credentials should fall back to ordinary trial treatment');
  }

  // 9. Rate limiting: hammer POST with wrong keys past the limit, expect a 429 eventually.
  {
    const env = makeEnv({ '82667': { type: 'lifetime', createdAt: Date.now(), revoked: false } });
    let sawRateLimited = false;
    for (let i = 0; i < 25; i++) {
      const form = new URLSearchParams();
      form.set('key', 'guess' + i);
      const res = await worker.fetch(
        req('https://ppages.example.com/', {
          method: 'POST',
          body: form,
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '1.2.3.4' },
        }),
        env,
        {}
      );
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    assert(sawRateLimited, 'repeated wrong-key POSTs from the same IP should eventually hit the rate limiter (429)');
  }

  // 10. Rate limiting is per-IP - a different IP should not be blocked by another IP's attempts.
  {
    const env = makeEnv({ '82667': { type: 'lifetime', createdAt: Date.now(), revoked: false } });
    for (let i = 0; i < 25; i++) {
      const form = new URLSearchParams();
      form.set('key', 'guess' + i);
      await worker.fetch(
        req('https://ppages.example.com/', {
          method: 'POST',
          body: form,
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '9.9.9.9' },
        }),
        env,
        {}
      );
    }
    const form = new URLSearchParams();
    form.set('key', '82667');
    const res = await worker.fetch(
      req('https://ppages.example.com/', {
        method: 'POST',
        body: form,
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '8.8.8.8' },
      }),
      env,
      {}
    );
    assert(res.status === 303, 'a fresh IP with the right key should still succeed even after another IP got rate-limited, got ' + res.status);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
