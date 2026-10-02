const fs = require('fs');
const path = require('path');
const readline = require('readline-sync');
const { IgApiClient, RealtimeClient } = require('instagram-bot-api/dist/index');
const { colors } = require('../../func/colors.js');
const log = require('../../logger/log.js');
const { loadBrowserCookies, validateCookies, applyCookiesToClient, getCookieValue, validateCookieSession } = require('../../utils/cookieConverter.js');

const LOGO = `
${colors.cyan('╔══════════════════════════════════════════════════════════════╗')}
${colors.cyan('║')}                                                                ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('██╗███╗   ██╗███████╗████████╗ █████╗')}      ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('██║████╗  ██║██╔════╝╚══██╔══╝██╔══██╗')}     ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('██║██╔██╗ ██║███████╗   ██║   ███████║')}     ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('██║██║╚██╗██║╚════██║   ██║   ██╔══██║')}     ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('██║██║ ╚████║███████║   ██║   ██║  ██║')}     ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.cyanBright.bold('╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝')}     ${colors.cyan('║')}
${colors.cyan('║')}                                                                ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('██████╗  ██████╗ ████████╗')}                    ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('██╔══██╗██╔═══██╗╚══██╔══╝')}                    ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('██████╔╝██║   ██║   ██║')}                       ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('██╔══██╗██║   ██║   ██║')}                       ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('██████╔╝╚██████╔╝   ██║')}                       ${colors.cyan('║')}
${colors.cyan('║')}     ${colors.magenta.bold('╚═════╝  ╚═════╝    ╚═╝')}                       ${colors.cyan('║')}
${colors.cyan('║')}                                                                ${colors.cyan('║')}
${colors.cyan('║')}              ${colors.yellow('Instagram Automation Bot')}                      ${colors.cyan('║')}
${colors.cyan('║')}                   ${colors.gray('v1.0.0 | ST Edition')}                         ${colors.cyan('║')}
${colors.cyan('╚══════════════════════════════════════════════════════════════╝')}
`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadingAnimation(text, duration = 2000) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const endTime = Date.now() + duration;
  let i = 0;

  while (Date.now() < endTime) {
    process.stdout.write(`\r${colors.cyan(frames[i % frames.length])} ${text}`);
    await sleep(80);
    i++;
  }
  process.stdout.write(`\r${colors.green('✓')} ${text}\n`);
}

async function progressBar(text, steps = 10, duration = 1500) {
  const filled = '█';
  const empty = '░';

  for (let i = 0; i <= steps; i++) {
    const bar = filled.repeat(i) + empty.repeat(steps - i);
    const percent = Math.round((i / steps) * 100);
    process.stdout.write(`\r${colors.cyan(text)} [${colors.green(bar)}] ${colors.yellow(percent + '%')}`);
    await sleep(duration / steps);
  }
  console.log();
}

async function loginWithCookies(ig, cookiePath, sessionPath) {
  console.log(`${colors.cyan('●')} ${colors.cyanBright('Cookie-based authentication enabled')}`);
  await loadingAnimation('Loading browser cookies...', 1000);

  try {
    const browserCookies = loadBrowserCookies(cookiePath);
    validateCookies(browserCookies);
    console.log(`${colors.green('✓')} ${colors.greenBright('Cookies loaded successfully!')}`);
    console.log(`  ${colors.gray('Found')} ${colors.white(browserCookies.length)} ${colors.gray('cookies')}`);

    await loadingAnimation('Applying cookies to session...', 1500);
    const { dsUserId } = await applyCookiesToClient(ig, browserCookies);

    await loadingAnimation('Validating session with Instagram...', 2000);
    const validation = await validateCookieSession(ig);

    if (!validation.valid) {
      console.log(`${colors.red('✗')} ${colors.redBright('Session validation failed: ' + validation.error)}`);
      console.log(`  ${colors.yellow('Cookies may be expired. Please export fresh cookies from browser.')}`);
      return false;
    }

    console.log(`${colors.green('✓')} ${colors.greenBright('Cookie authentication successful!')}`);
    console.log(`  ${colors.gray('Username:')} ${colors.white('@' + validation.username)}`);
    console.log(`  ${colors.gray('User ID:')} ${colors.white(validation.userId)}`);

    const sessionDir = path.dirname(sessionPath);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    try {
      const session = await ig.saveSession();
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      console.log(`${colors.green('✓')} ${colors.gray('Session saved for future use')}`);
    } catch (e) {
    }

    return true;
  } catch (e) {
    console.log(`${colors.red('✗')} ${colors.redBright('Cookie authentication failed: ' + e.message)}`);
    return false;
  }
}

async function login() {
  console.clear();
  console.log(LOGO);
  console.log();

  await loadingAnimation('Initializing InstagramBot...', 1500);

  const config = global.ST.config;
  const sessionPath = path.join(process.cwd(), config.session?.sessionPath || './session', 'session.json');
  const cookiePath = path.join(process.cwd(), config.cookieAuth?.cookiePath || './cookie.json');
  const useCookieAuth = config.cookieAuth?.enabled === true;

  const ig = new IgApiClient();
  let email = process.env.IG_EMAIL || config.credentials?.email || '';
  let password = process.env.IG_PASSWORD || config.credentials?.password || '';

  let sessionLoaded = false;

  if (useCookieAuth && fs.existsSync(cookiePath)) {
    sessionLoaded = await loginWithCookies(ig, cookiePath, sessionPath);
  }

  if (!sessionLoaded && fs.existsSync(sessionPath)) {
    await loadingAnimation('Found existing session...', 1000);
    try {
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      await ig.loadSession(session);

      await loadingAnimation('Validating session...', 1500);
      const isValid = await ig.isSessionValid();

      if (isValid) {
        console.log(`${colors.green('✓')} ${colors.greenBright('Session is valid!')}`);
        sessionLoaded = true;
      } else {
        console.log(`${colors.yellow('!')} ${colors.yellowBright('Session expired, need to login again')}`);
      }
    } catch (e) {
      console.log(`${colors.red('✗')} ${colors.redBright('Failed to load session: ' + e.message)}`);
    }
  }

  if (!sessionLoaded) {
    if (!process.stdin.isTTY) {
      throw new Error('Cookie authentication failed and interactive login is unavailable in this environment. Provide a valid cookie.json or IG_EMAIL/IG_PASSWORD secrets.');
    }

    console.log();
    console.log(colors.cyan('━'.repeat(60)));
    console.log(colors.cyanBright.bold('  Login Required'));
    console.log(colors.cyan('━'.repeat(60)));
    console.log();

    if (!email) {
      email = readline.question(colors.yellow('  Enter Email/Username: '));
    } else {
      console.log(colors.green('  Email: ') + colors.gray(email));
    }

    if (!password) {
      password = readline.question(colors.yellow('  Enter Password: '), { hideEchoBack: true });
    } else {
      console.log(colors.green('  Password: ') + colors.gray('*'.repeat(password.length)));
    }

    console.log();

    let loginSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;

    while (!loginSuccess && attempts < maxAttempts) {
      attempts++;

      try {
        await progressBar('Connecting to Instagram', 20, 3000);

        await ig.login({ 
          username: email.includes('@') ? email.split('@')[0] : email,
          password,
          email 
        });

        loginSuccess = true;
        console.log(`${colors.green('✓')} ${colors.greenBright('Login successful!')}`);

        const sessionDir = path.dirname(sessionPath);
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }

        if (config.session?.autoSave !== false) {
          const session = await ig.saveSession();
          fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
          console.log(`${colors.green('✓')} ${colors.gray('Session saved')}`);
        }

      } catch (e) {
        console.log();
        console.log(`${colors.red('✗')} ${colors.redBright('Login failed: ' + e.message)}`);

        if (attempts < maxAttempts) {
          console.log(colors.yellow(`  Attempt ${attempts}/${maxAttempts}. Try again...`));
          console.log();
          email = readline.question(colors.yellow('  Enter Email/Username: '));
          password = readline.question(colors.yellow('  Enter Password: '), { hideEchoBack: true });
          console.log();
        } else {
          throw new Error('Max login attempts reached');
        }
      }
    }
  }

  console.log();
  console.log(colors.cyan('━'.repeat(60)));
  console.log(colors.cyanBright.bold('  Bot Information'));
  console.log(colors.cyan('━'.repeat(60)));

  let userInfo = {};
  try {
    userInfo = await ig.account.currentUser();
    console.log(`  ${colors.green('Username:')} ${colors.white('@' + userInfo.username)}`);
    console.log(`  ${colors.green('User ID:')} ${colors.gray(userInfo.pk)}`);
    console.log(`  ${colors.green('Full Name:')} ${colors.white(userInfo.full_name || 'N/A')}`);
  } catch (e) {
    console.log(`  ${colors.yellow('Could not fetch user info')}`);
  }

  console.log();
  console.log(colors.cyan('━'.repeat(60)));
  console.log(colors.cyanBright.bold('  Admin Information'));
  console.log(colors.cyan('━'.repeat(60)));

  const adminNames = config.adminNames || ['Admin'];
  const adminUIDs = config.adminUIDs || [];

  console.log(`  ${colors.green('Admin Names:')} ${colors.white(adminNames.join(', '))}`);
  console.log(`  ${colors.green('Admin UIDs:')} ${colors.gray(adminUIDs.length > 0 ? adminUIDs.join(', ') : 'None set')}`);
  console.log(`  ${colors.green('DM Work:')} ${colors.white(config.dmWork ? 'Enabled' : 'Disabled')}`);
  console.log(`  ${colors.green('Admin Only:')} ${colors.white(config.adminOnly ? 'Yes' : 'No')}`);

  console.log();

  await loadingAnimation('Starting realtime listener...', 2000);

  let realtime = null;
  try {
    realtime = new RealtimeClient(ig);
    await realtime.connect({
      graphQlSubs: ['ig_sub_direct', 'ig_sub_direct_v2_message_create'],
      skywalkerSubs: ['presence_subscribe', 'typing_subscribe']
    });
    console.log(`${colors.green('✓')} ${colors.greenBright('Realtime connected!')}`);
  } catch (e) {
    console.log(`${colors.yellow('!')} ${colors.yellowBright('Realtime connection warning: ' + e.message)}`);
  }

  console.log();

  const api = {
    direct: ig.direct,
    user: ig.user,
    account: ig.account,
    media: ig.media,
    dm: ig.dm,
    sendText: async (threadId, text) => {
      return await ig.direct.sendText(threadId, text);
    },
    getUserInfo: async (userId) => {
      return await ig.user.info(userId);
    },
    getThreadInfo: async (threadId) => {
      return await ig.directThread.getThread(threadId);
    }
  };

  return { client: ig, realtime, api };
}

module.exports = login;
