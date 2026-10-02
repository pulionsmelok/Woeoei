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
      realtime.on('message_live', async (data) => {
        try {
          await handleMessage(data);
        } catch (err) {
          log.error('MESSAGE', err.message);
        }
      });

      // Some library versions expose the raw public event as `message` only.
      // The current package's internal handler converts it to `message_live`,
      // so do not bind `message` here and process the same message twice.
      
      realtime.on('error', (err) => {
        log.error('REALTIME', err.message);
      });
      
      realtime.on('disconnect', () => {
        log.warn('REALTIME', 'Disconnected from Instagram');
        if (config.options.autoReconnect) {
          setTimeout(async () => {
            log.info('REALTIME', 'Attempting to reconnect...');
            try {
              await realtime.connect();
              log.success('REALTIME', 'Reconnected successfully');
            } catch (e) {
              log.error('REALTIME', 'Reconnect failed: ' + e.message);
            }
          }, config.options.reconnectDelay || 5000);
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
