const path = require('path');
const fs = require('fs');

global.ST = {
  commands: new Map(),
  events: new Map(),
  onReply: new Map(),
  onReaction: new Map(),
  config: {},
  client: null,
  realtime: null,
  api: null,
  startTime: Date.now(),
  
  utils: null,
  colors: null,
  log: null,
  
  userData: null,
  threadData: null,
  
  adminUIDs: [],
  botName: 'InstagramBot',
  prefix: '/'
};

const { colors } = require('./func/colors.js');
const log = require('./logger/log.js');
const config = require('./config.json');

global.ST.colors = colors;
global.ST.log = log;
global.ST.config = config;
global.ST.adminUIDs = config.adminUIDs || [];
global.ST.botName = config.botName || 'InstagramBot';
global.ST.prefix = config.prefix || '/';

const login = require('./bot/login/login.js');
const loadData = require('./bot/loadData.js');
const utils = require('./utils.js');

global.ST.utils = utils;
global.utils = utils;

async function main() {
  try {
    console.clear();
    
    const { client, realtime, api } = await login();
    
    global.ST.client = client;
    global.ST.realtime = realtime;
    global.ST.api = api;
    
    await loadData();
    
    const { handleMessage } = require('./bot/handler/handlerEvents.js');
    
    if (realtime) {
      const seenMessages = new Map();
      const rememberMessage = (data) => {
        const msg = data?.message || data?.parsed || data;
        const id = msg?.id || msg?.item_id || msg?.message_id || msg?.message?.item_id;
        const thread = msg?.thread_id || msg?.threadId || msg?.thread?.thread_id || '';
        const sender = msg?.userId || msg?.user_id || msg?.from_user_id || msg?.message?.user_id || '';
        const key = id ? String(id) : `${thread}:${sender}:${msg?.text || msg?.body || ''}`;
        const now = Date.now();
        const previous = seenMessages.get(key);
        if (previous && now - previous < 15000) return false;
        seenMessages.set(key, now);
        if (seenMessages.size > 1000) {
          for (const [k, t] of seenMessages) {
            if (now - t > 30000) seenMessages.delete(k);
          }
        }
        return true;
      };

      const dispatchMessage = async (data) => {
        if (!rememberMessage(data)) return;
        try {
          await handleMessage(data);
        } catch (err) {
          log.error('MESSAGE', err?.stack || err?.message || String(err));
        }
      };

      // The library exposes both the raw `message` event and the normalized
      // `message_live` event. Accept both so changes in the library do not
      // silently stop command processing. The dedupe above prevents doubles.
      realtime.on('message_live', dispatchMessage);
      realtime.on('message', dispatchMessage);
      realtime.on('iris', dispatchMessage);

      realtime.on('error', (err) => {
        log.error('REALTIME', err?.stack || err?.message || String(err));
      });

      const reconnect = async () => {
        try {
          await realtime.connect({
            graphQlSubs: ['ig_sub_direct', 'ig_sub_direct_v2_message_create'],
            skywalkerSubs: ['presence_subscribe', 'typing_subscribe']
          });
          log.success('REALTIME', 'Reconnected successfully');
        } catch (e) {
          log.error('REALTIME', 'Reconnect failed: ' + e.message);
          if (config.options.autoReconnect) {
            setTimeout(reconnect, config.options.reconnectDelay || 5000);
          }
        }
      };

      realtime.on('disconnect', () => {
        log.warn('REALTIME', 'Disconnected from Instagram');
        if (config.options.autoReconnect) {
          setTimeout(reconnect, config.options.reconnectDelay || 5000);
        }
      });
    }
    
    log.success('BOT', `${global.ST.botName} is now running!`);
    log.info('BOT', `Prefix: ${global.ST.prefix}`);
    log.info('BOT', `Commands: ${global.ST.commands.size} | Events: ${global.ST.events.size}`);
    
  } catch (error) {
    log.error('STARTUP', error.message);
    process.exit(1);
  }
}

main();

process.on('unhandledRejection', (reason, promise) => {
  log.error('UNHANDLED', reason?.message || reason);
});

process.on('uncaughtException', (error) => {
  log.error('UNCAUGHT', error.message);
});
