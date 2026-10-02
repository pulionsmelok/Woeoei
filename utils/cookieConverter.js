const fs = require('fs');
const { Cookie } = require('tough-cookie');

function loadBrowserCookies(cookiePath) {
  if (!fs.existsSync(cookiePath)) {
    throw new Error(`Cookie file not found: ${cookiePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  const cookies = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.cookies)
      ? raw.cookies
      : Object.entries(raw).map(([name, value]) => ({ name, value }));

  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('No cookies found in cookie file');
  }

  return cookies.filter(c => c && (c.name || c.key) && c.value != null);
}

function validateCookies(cookies) {
  const names = new Set(cookies.map(c => c.name || c.key));
  const missing = ['sessionid', 'ds_user_id'].filter(name => !names.has(name));

  if (missing.length) {
    throw new Error(`Required Instagram cookies missing: ${missing.join(', ')}`);
  }

  return true;
}

function getCookieValue(cookies, name) {
  const cookie = cookies.find(c => (c.name || c.key) === name);
  return cookie ? String(cookie.value) : null;
}

function cookieUrl(cookie) {
  const domain = String(cookie.domain || 'www.instagram.com').replace(/^\./, '');
  return `https://${domain}/`;
}

function applyCookiesToClient(ig, cookies) {
  if (!ig || !ig.state || !ig.state.cookieJar) {
    throw new Error('Instagram client cookie jar is unavailable');
  }

  const seed = getCookieValue(cookies, 'ds_user_id') || getCookieValue(cookies, 'sessionid');
  if (typeof ig.state.generateDevice === 'function') {
    ig.state.generateDevice(seed || 'instagram-bot');
  }

  let applied = 0;

  for (const source of cookies) {
    const name = source.name || source.key;
    if (!name || source.value == null) continue;

    const cookie = new Cookie({
      key: name,
      value: String(source.value),
      domain: source.domain || '.instagram.com',
      path: source.path || '/',
      secure: source.secure !== false,
      httpOnly: Boolean(source.httpOnly),
      expires: source.expirationDate
        ? new Date(Number(source.expirationDate) * 1000)
        : 'Infinity'
    });

    const url = cookieUrl(source);
    ig.state.cookieJar.setCookieSync(cookie, url);

    // Browser exports can contain host-specific cookies. Mirror the important
    // Instagram auth cookies to the mobile API host as well.
    if (['sessionid', 'ds_user_id', 'csrftoken', 'mid', 'ig_did', 'rur'].includes(name)) {
      try {
        ig.state.cookieJar.setCookieSync(cookie, 'https://i.instagram.com/');
      } catch (_) {
        // The original cookie is already installed; a host mismatch here is harmless.
      }
    }

    applied++;
  }

  if (!applied) {
    throw new Error('No valid cookies were applied');
  }

  return {
    dsUserId: getCookieValue(cookies, 'ds_user_id') || ig.state.cookieUserId,
    sessionId: getCookieValue(cookies, 'sessionid')
  };
}

async function validateCookieSession(ig) {
  try {
    const userId = String(ig.state.cookieUserId || '');
    if (!userId) {
      return { valid: false, error: 'ds_user_id cookie is unavailable' };
    }

    let userInfo = null;
    try {
      userInfo = await ig.account.currentUser();
    } catch (_) {
      userInfo = null;
    }

    const username = userInfo?.username || ig.state.cookieUsername || null;
    const resolvedUserId = String(userInfo?.pk || userId);

    if (!username) {
      return {
        valid: false,
        error: 'Instagram accepted the cookies but current user information could not be resolved',
        userId: resolvedUserId
      };
    }

    return {
      valid: true,
      username,
      userId: resolvedUserId,
      fullName: userInfo?.full_name || null
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports = {
  loadBrowserCookies,
  validateCookies,
  applyCookiesToClient,
  getCookieValue,
  validateCookieSession
};
