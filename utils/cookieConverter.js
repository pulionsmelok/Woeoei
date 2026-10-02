'use strict';

const fs = require('fs');
const { Cookie } = require('tough-cookie');

function loadBrowserCookies(cookiePath) {
  if (!fs.existsSync(cookiePath)) {
    throw new Error(`Cookie file not found: ${cookiePath}`);
  }

  const raw = fs.readFileSync(cookiePath, 'utf8');
  let cookies;

  try {
    cookies = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid cookie JSON: ${err.message}`);
  }

  if (!Array.isArray(cookies)) {
    throw new TypeError('Cookie file must contain a JSON array');
  }

  return cookies;
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
  let value = `${cookie.name}=${cookie.value}`;

  if (cookie.path) value += `; Path=${cookie.path}`;
  if (cookie.domain) value += `; Domain=${cookie.domain}`;
  if (cookie.secure) value += '; Secure';
  if (cookie.httpOnly) value += '; HttpOnly';

  return value;
}

async function applyCookiesToClient(ig, cookies) {
  if (!ig || !ig.state || !ig.state.cookieJar) {
    throw new Error('Instagram client cookie jar is unavailable');
  }

  const jar = ig.state.cookieJar;
  const url = 'https://www.instagram.com/';

  for (const item of cookies) {
    const cookieString = cookieToString(item);
    const parsed = Cookie.parse(cookieString);

    if (!parsed) {
      throw new Error(`Unable to parse cookie: ${item.name}`);
    }

    // tough-cookie requires a Cookie instance or a cookie string here.
    // Passing the browser-exported plain object directly causes:
    // "First argument to setCookie must be a Cookie object or string".
    await jar.setCookie(parsed, url);
  }

  const dsUserId = getCookieValue(ig, 'ds_user_id');
  return { dsUserId };
}

function getCookieValue(ig, name) {
  if (!ig || !ig.state || !ig.state.cookieJar) return null;

  try {
    const cookies = ig.state.cookieJar.getCookiesSync('https://www.instagram.com/');
    const found = cookies.find(cookie => cookie.key === name);
    return found ? found.value : null;
  } catch (_) {
    return null;
  }
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
      return { valid: false, error: 'Instagram did not return an authenticated user ID' };
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
