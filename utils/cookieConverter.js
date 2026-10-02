'use strict';

const fs = require('fs');

function loadBrowserCookies(cookiePath) {
  if (!fs.existsSync(cookiePath)) {
    throw new Error(`Cookie file not found: ${cookiePath}`);
  }

  let cookies;
  try {
    cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid cookie JSON: ${err.message}`);
  }

  // Browser exports are normally an array. Also accept a single cookie object
  // or a { cookies: [...] } wrapper without changing the cookie values.
  if (Array.isArray(cookies)) return cookies;
  if (cookies && Array.isArray(cookies.cookies)) return cookies.cookies;
  if (cookies && typeof cookies === 'object' && cookies.name) return [cookies];

  throw new TypeError('Cookie file must contain a JSON cookie array');
}

function validateCookies(cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error('No cookies found');
  }

  const names = new Set();
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== 'object') {
      throw new TypeError('Each cookie must be an object');
    }
    if (typeof cookie.name !== 'string' || !cookie.name.trim()) {
      throw new TypeError('Cookie name is missing');
    }
    if (typeof cookie.value !== 'string') {
      throw new TypeError(`Cookie value is invalid for ${cookie.name}`);
    }
    names.add(cookie.name);
  }

  if (!names.has('sessionid')) {
    throw new Error('Required Instagram cookie "sessionid" is missing');
  }
  if (!names.has('ds_user_id')) {
    throw new Error('Required Instagram cookie "ds_user_id" is missing');
  }

  return true;
}

function cookieToString(cookie) {
  // IMPORTANT: instagram-bot-api has its own nested tough-cookie dependency.
  // Passing a Cookie instance created by the project's top-level tough-cookie
  // package can fail instanceof checks. setCookie accepts a string, so keep
  // the value as a standard Set-Cookie string instead.
  const name = String(cookie.name).trim();
  const value = String(cookie.value);
  const domain = cookie.domain || '.instagram.com';
  const cookiePath = cookie.path || '/';

  let result = `${name}=${value}; Domain=${domain}; Path=${cookiePath}`;
  if (cookie.secure) result += '; Secure';
  if (cookie.httpOnly) result += '; HttpOnly';

  return result;
}

async function applyCookiesToClient(ig, cookies) {
  if (!ig || !ig.state || !ig.state.cookieJar) {
    throw new Error('Instagram client cookie jar is unavailable');
  }

  const jar = ig.state.cookieJar;
  const url = 'https://www.instagram.com/';

  if (typeof jar.setCookie !== 'function') {
    throw new Error('Instagram client cookie jar does not support setCookie');
  }

  for (const item of cookies) {
    const cookieString = cookieToString(item);
    try {
      // Pass a STRING, not a Cookie object. This works with the nested
      // tough-cookie version used internally by instagram-bot-api.
      if (jar.setCookie.length >= 3) {
        await new Promise((resolve, reject) => {
          jar.setCookie(cookieString, url, (err) => err ? reject(err) : resolve());
        });
      } else {
        await jar.setCookie(cookieString, url);
      }
    } catch (err) {
      throw new Error(`Unable to apply cookie "${item.name}": ${err.message}`);
    }
  }

  const dsUserId = getCookieValue(ig, 'ds_user_id');
  if (!dsUserId) {
    throw new Error('ds_user_id cookie was not stored in the Instagram session');
  }

  return { dsUserId };
}

function getCookieValue(ig, name) {
  if (!ig || !ig.state || !ig.state.cookieJar) return null;

  const urls = [
    'https://www.instagram.com/',
    'https://i.instagram.com/'
  ];

  for (const url of urls) {
    try {
      if (typeof ig.state.cookieJar.getCookiesSync === 'function') {
        const cookies = ig.state.cookieJar.getCookiesSync(url);
        const found = cookies.find(cookie => (cookie.key || cookie.name) === name);
        if (found) return found.value;
      }
    } catch (_) {}
  }

  return null;
}

async function validateCookieSession(ig) {
  try {
    const user = await ig.account.currentUser();
    const data = user && user.user ? user.user : user;

    const userId = String(
      data?.pk ??
      data?.id ??
      getCookieValue(ig, 'ds_user_id') ??
      ''
    );

    const username = data?.username || getCookieValue(ig, 'ds_user') || '';

    if (!userId) {
      return {
        valid: false,
        error: 'Instagram did not return an authenticated user ID'
      };
    }

    return {
      valid: true,
      username,
      userId,
      user: data
    };
  } catch (err) {
    return {
      valid: false,
      error: err?.message || String(err)
    };
  }
}

module.exports = {
  loadBrowserCookies,
  validateCookies,
  applyCookiesToClient,
  getCookieValue,
  validateCookieSession
};
