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

const pollingSeen = new Set();
let pollingStarted = false;
let pollingBusy = false;

function getInboxThreads(inboxData) {
  if (!inboxData || typeof inboxData !== 'object') return [];
  const candidates = [
    inboxData?.inbox?.threads,
    inboxData?.threads,
    inboxData?.inbox?.items
  ];
  return candidates.find(Array.isArray) || [];
}

function getLatestThreadItem(thread) {
  if (!thread || typeof thread !== 'object') return null;

  const items = [thread.items, thread.messages].find(Array.isArray);
  if (items?.length) return items[0];

  return thread.last_permanent_item ||
    thread.last_message ||
    thread.last_item ||
    null;
}

function normalizeInboxItem(thread, item) {
  if (!item || typeof item !== 'object') return null;

  const threadID = String(
    item.thread_id || item.threadId || thread.thread_id || thread.threadId || ''
  );
  const messageID = String(
    item.item_id || item.message_id || item.messageID || item.id || ''
  );

  if (!threadID || !messageID) return null;

  return {
    ...item,
    id: item.id || item.item_id || item.message_id,
    item_id: item.item_id || item.id || item.message_id,
    userId: item.user_id || item.from_user_id || item.userId,
    user_id: item.user_id || item.from_user_id || item.userId,
    username: item.username || item.from_username,
    text: item.text || item.body || '',
    body: item.body || item.text || '',
    itemType: item.item_type || item.itemType || 'text',
    thread_id: threadID,
    threadId: threadID,
    timestamp: item.timestamp || item.created_at || Date.now()
  };
}

async function pollInbox() {
  if (pollingBusy || !global.ST.client?.direct?.getInbox) return;
  pollingBusy = true;

  try {
    const inboxData = await global.ST.client.direct.getInbox();
    const threads = getInboxThreads(inboxData);

    for (const thread of threads) {
      const item = getLatestThreadItem(thread);
      const data = normalizeInboxItem(thread, item);
      if (!data) continue;

      const messageID = String(data.item_id || data.id);
      if (pollingSeen.has(messageID)) continue;

      pollingSeen.add(messageID);
      if (pollingSeen.size > 5000) {
        const first = pollingSeen.values().next().value;
        pollingSeen.delete(first);
      }

      // On the first poll, only establish the baseline. Realtime (when available)
      // remains responsible for live delivery, so old inbox messages are ignored.
      if (!pollingStarted) continue;

      try {
        await global.ST.handleMessage(data);
      } catch (error) {
        log.error('POLL', error.message);
      }
    }

    pollingStarted = true;
  } catch (error) {
    log.error('POLL', error.message);
  } finally {
    pollingBusy = false;
  }
}

function startInboxPolling() {
  // Polling is a fallback for hosts where Instagram MQTT cannot establish a
  // connection. It also prevents the bot from becoming completely idle when
  // the realtime transport reports a malformed/empty CONNACK packet.
  const interval = Math.max(3000, Number(global.ST.config.options?.pollInterval || 5000));

  const loop = async () => {
    await pollInbox();
    setTimeout(loop, interval);
  };

  loop();
}

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
    global.ST.handleMessage = handleMessage;

    if (realtime) {
      realtime.on('message_live', async (data) => {
        try {
          const realtimeMessageId = data?.item_id || data?.id || data?.message_id;
          if (realtimeMessageId) pollingSeen.add(String(realtimeMessageId));
          await handleMessage(data);
        } catch (err) {
          log.error('MESSAGE', err.message);
        }
      });

      realtime.on('error', (err) => {
        log.error('REALTIME', err.message);
      });

      realtime.on('disconnect', () => {
        log.warn('REALTIME', 'Disconnected from Instagram');
        if (config.options.autoReconnect) {
          setTimeout(async () => {
            log.info('REALTIME', 'Attempting to reconnect...');
            try {
              if (typeof realtime.startRealTimeListener === 'function') {
                await realtime.startRealTimeListener();
              } else {
                await realtime.connect();
              }
              log.success('REALTIME', 'Reconnected successfully');
            } catch (e) {
              log.error('REALTIME', 'Reconnect failed: ' + e.message);
            }
          }, config.options.reconnectDelay || 5000);
        }
      });
    }

    startInboxPolling();
    
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
