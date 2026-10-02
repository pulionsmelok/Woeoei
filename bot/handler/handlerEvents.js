const { MessageAPI, formatTime } = require('../../utils.js');
const { colors } = require('../../func/colors.js');
const log = require('../../logger/log.js');

const cooldowns = new Map();

if (!global.ST.attachmentCache) {
  global.ST.attachmentCache = new Map();
}

function cleanupOldAttachments() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000;

  for (const [key, data] of global.ST.attachmentCache.entries()) {
    if (data.timestamp && (now - data.timestamp) > maxAge) {
      global.ST.attachmentCache.delete(key);
    }
  }
}

setInterval(cleanupOldAttachments, 10 * 60 * 1000);

function cleanupOldReplies() {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000;

  for (const [msgId, data] of global.ST.onReply.entries()) {
    if (data.timestamp && (now - data.timestamp) > maxAge) {
      global.ST.onReply.delete(msgId);
    }
  }
}

setInterval(cleanupOldReplies, 5 * 60 * 1000);

function extractAttachments(data) {
  const attachments = [];

  if (data.attachments && Array.isArray(data.attachments)) {
    for (const att of data.attachments) {
      attachments.push({ ...att });
    }
  }

  if (data.visual_media) {
    const media = data.visual_media.media || data.visual_media;
    if (media) {
      const imageVersions = media.image_versions2?.candidates || [];
      const videoVersions = media.video_versions || [];

      if (videoVersions.length > 0) {
        attachments.push({
          type: 'video',
          url: videoVersions[0].url,
          preview_url: imageVersions[0]?.url,
          width: videoVersions[0].width,
          height: videoVersions[0].height
        });
      } else if (imageVersions.length > 0) {
        attachments.push({
          type: 'image',
          url: imageVersions[0].url,
          width: imageVersions[0].width,
          height: imageVersions[0].height
        });
      }
    }
  }

  if (data.media) {
    const media = data.media;
    const imageVersions = media.image_versions2?.candidates || [];
    const videoVersions = media.video_versions || [];

    if (videoVersions.length > 0) {
      attachments.push({
        type: 'video',
        url: videoVersions[0].url,
        preview_url: imageVersions[0]?.url
      });
    } else if (imageVersions.length > 0) {
      attachments.push({
        type: 'image',
        url: imageVersions[0].url
      });
    }
  }

  if (data.audio) {
    attachments.push({
      type: 'audio',
      url: data.audio.audio_src || data.audio.url,
      duration: data.audio.duration
    });
  }

  if (data.voice_media) {
    const voice = data.voice_media.media || data.voice_media;
    attachments.push({
      type: 'audio',
      url: voice.audio?.audio_src || voice.url,
      duration: voice.audio?.duration
    });
  }

  if (data.reel_share) {
    const reel = data.reel_share.media || data.reel_share;
    const imageVersions = reel.image_versions2?.candidates || [];
    const videoVersions = reel.video_versions || [];

    if (videoVersions.length > 0) {
      attachments.push({
        type: 'reel',
        url: videoVersions[0].url,
        preview_url: imageVersions[0]?.url
      });
    }
  }

  if (data.story_share) {
    const story = data.story_share.media || data.story_share;
    const imageVersions = story.image_versions2?.candidates || [];
    const videoVersions = story.video_versions || [];

    if (videoVersions.length > 0) {
      attachments.push({
        type: 'story',
        url: videoVersions[0].url,
        preview_url: imageVersions[0]?.url
      });
    } else if (imageVersions.length > 0) {
      attachments.push({
        type: 'story',
        url: imageVersions[0].url
      });
    }
  }

  return attachments;
}

function normalizeMessageReply(data) {
  const replyData = data.replied_to_message || data.reply_to || data.messageReply;

  if (!replyData) return null;

  let messageID = replyData.item_id || replyData.id || replyData.message_id || replyData.messageID;

  if (!messageID && typeof replyData === 'object') {
    for (const key of Object.keys(replyData)) {
      if (key.toLowerCase().includes('id') && typeof replyData[key] === 'string') {
        const val = replyData[key];
        if (val && val.length > 10 && /^\d+$/.test(val)) {
          messageID = val;
          break;
        }
      }
    }
  }

  const senderID = replyData.user_id || replyData.userId || replyData.from_user_id || replyData.senderID || replyData.sender_id;
  const body = replyData.text || replyData.body || '';
  const username = replyData.username || replyData.from_username || '';

  const attachments = extractAttachments(replyData);

  return {
    messageID,
    senderID,
    body,
    username,
    attachments,
    timestamp: replyData.timestamp || Date.now(),
    rawData: replyData
  };
}

async function handleMessage(data) {
  const config = global.ST.config;
  const prefix = config.prefix || '/';

  const senderID = data.userId || data.user_id || data.from_user_id;
  const threadID = data.thread_id || data.threadId;
  const messageID = data.id || data.item_id || data.message_id;
  const body = data.text || data.body || (data.message_data && data.message_data.body) || '';
  const username = data.username || data.from_username || `user_${senderID}`;
  const itemType = data.itemType || data.item_type || 'text';

  if (!senderID || !threadID) return;

  const botUserId = global.ST.client?.state?.cookieUserId;
  if (senderID === botUserId) return;

  // Detect if this is a group thread (best-effort)
  // Instagram group thread IDs are typically very long (19+ digits)
  // Also check various data fields
  let isGroup =
    data.isGroup ||
    data.is_group ||
    data.group || 
    data.isGroupThread ||
    data.thread_type === 'group' ||
    (data.thread && (data.thread.is_group || data.thread.thread_type === 'group')) ||
    false;

  // Fallback: Very long thread IDs (19+ digits) are usually groups
  if (!isGroup && threadID && String(threadID).length >= 19) {
    isGroup = true;
  }

  // Additional fallback: Check if thread has participants count > 2 (group)
  if (!isGroup && data.participants && Array.isArray(data.participants) && data.participants.length > 2) {
    isGroup = true;
  }

  // Global approval mode: bot only works in approved threads when enabled
  if (config.approvalMode && isGroup) {
    const approved = Array.isArray(config.approvedThreads) ? config.approvedThreads : [];
    if (!approved.includes(String(threadID))) {
      return;
    }
  }

  const messageReply = normalizeMessageReply(data);

  const attachments = extractAttachments(data);

  if (attachments.length > 0) {
    global.ST.attachmentCache.set(messageID, {
      attachments,
      senderID,
      threadID,
      timestamp: Date.now()
    });

    const userKey = `${threadID}_${senderID}_latest`;
    global.ST.attachmentCache.set(userKey, {
      attachments,
      messageID,
      senderID,
      threadID,
      timestamp: Date.now()
    });
  }

  const event = {
    senderID,
    threadID,
    messageID,
    body,
    username,
    itemType,
    timestamp: data.timestamp || Date.now(),
    isGroup,
    mentions: data.mentions || [],
    attachments,
    messageReply,
    reaction: data.reaction || null
  };

  // MessageAPI needs the realtime command surface when MQTT is available,
  // but it can fall back to the normal Instagram direct API when MQTT is down.
  const message = new MessageAPI(threadID, global.ST.realtime || global.ST.api, global.ST.client);

  const api = global.ST.api;

  if (itemType === 'action_log' || event.itemType === 'action_log') {
    event.type = 'action_log';
  }

  for (const [name, eventHandler] of global.ST.events) {
    if (eventHandler.onEvent) {
      try {
        await eventHandler.onEvent({ message, event, api });
      } catch (e) {
        log.error('EVENT', `Error in ${name}: ${e.message}`);
      }
    }
  }

  let replyMessageID = event.messageReply?.messageID;
  let foundReply = null;

  if (replyMessageID && global.ST.onReply.has(replyMessageID)) {
    foundReply = global.ST.onReply.get(replyMessageID);
    console.log('[onReply] Found exact match for messageID:', replyMessageID);
  }

  if (!foundReply && event.messageReply) {
    for (const [msgId, replyData] of global.ST.onReply.entries()) {
      if (replyData.author === senderID && replyData.threadID === threadID) {
        const timeDiff = Date.now() - (replyData.timestamp || 0);
        if (timeDiff < 120000) {
          foundReply = replyData;
          replyMessageID = msgId;
          console.log('[onReply] Found by author+thread match within 2min, msgId:', msgId);
          break;
        }
      }
    }
  }

  const isCommand = body.startsWith(prefix);

  if (!foundReply && !isCommand) {
    let mostRecentReply = null;
    let mostRecentTime = 0;

    for (const [msgId, replyData] of global.ST.onReply.entries()) {
      if (replyData.author === senderID && replyData.threadID === threadID) {
        const timeDiff = Date.now() - (replyData.timestamp || 0);
        if (timeDiff < 300000 && (replyData.timestamp || 0) > mostRecentTime) {
          mostRecentReply = replyData;
          mostRecentTime = replyData.timestamp || 0;
          replyMessageID = msgId;
        }
      }
    }

    if (mostRecentReply) {
      foundReply = mostRecentReply;
      console.log('[onReply] Found most recent pending reply for user:', replyMessageID);
    }
  }

  if (foundReply) {
    const cmd = global.ST.commands.get(foundReply.commandName);

    if (cmd && cmd.onReply) {
      if (foundReply.author && foundReply.author !== senderID) {
        return;
      }

      try {
        await cmd.onReply({ message, event, Reply: foundReply, api });
        logCommand(username, foundReply.commandName, 'reply', true);

        if (!foundReply.persistent) {
          global.ST.onReply.delete(replyMessageID);
        }
      } catch (e) {
        log.error('REPLY', e.message);
        logCommand(username, foundReply.commandName, 'reply', false, e.message);
      }
    }
    return;
  }

  if (event.reaction && global.ST.onReaction.has(event.messageID)) {
    const Reaction = global.ST.onReaction.get(event.messageID);
    const cmd = global.ST.commands.get(Reaction.commandName);

    if (cmd && cmd.onReaction) {
      try {
        await cmd.onReaction({ message, event, Reaction, api });
        logCommand(username, Reaction.commandName, 'reaction', true);
      } catch (e) {
        log.error('REACTION', e.message);
        logCommand(username, Reaction.commandName, 'reaction', false, e.message);
      }
    }
    return;
  }

  for (const [name, cmd] of global.ST.commands) {
    if (cmd.onChat) {
      try {
        await cmd.onChat({ message, event, api });
      } catch (e) {
        log.error('ONCHAT', `Error in ${name}: ${e.message}`);
      }
    }
  }

  if (!body.startsWith(prefix)) return;

  const args = body.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  if (!commandName) return;

  const cmd = global.ST.commands.get(commandName);

  if (!cmd) {
    return;
  }

  const cmdConfig = cmd.config || {};
  const role = cmdConfig.role || 0;

  if (config.adminOnly && !isAdmin(senderID)) {
    await message.reply('This bot is in admin-only mode.');
    return;
  }

  if (role > 0 && !isAdmin(senderID)) {
    await message.reply('You do not have permission to use this command.');
    logCommand(username, commandName, 'cmd', false, 'Permission denied');
    return;
  }

  const cooldownKey = `${senderID}_${commandName}`;
  const cooldownTime = (cmdConfig.countDown || 0) * 1000;

  if (cooldowns.has(cooldownKey)) {
    const expirationTime = cooldowns.get(cooldownKey);
    if (Date.now() < expirationTime) {
      const remaining = ((expirationTime - Date.now()) / 1000).toFixed(1);
      await message.reply(`Please wait ${remaining}s before using this command again.`);
      return;
    }
  }

  if (cooldownTime > 0) {
    cooldowns.set(cooldownKey, Date.now() + cooldownTime);
    setTimeout(() => cooldowns.delete(cooldownKey), cooldownTime);
  }

  try {
    const cmdParams = { 
      message, 
      event, 
      args, 
      api,
      commandName,
      prefix,
      usersData: global.ST.userData,
      threadsData: global.ST.threadData
    };

    if (cmd.ST) {
      await cmd.ST(cmdParams);
      logCommand(username, commandName, 'cmd', true);
    } else if (cmd.onStart) {
      await cmd.onStart(cmdParams);
      logCommand(username, commandName, 'cmd', true);
    }
  } catch (e) {
    log.error('CMD', `Error in ${commandName}: ${e.message}`);
    logCommand(username, commandName, 'cmd', false, e.message);
    await message.reply(`Error: ${e.message}`);
  }
}

function isAdmin(userId) {
  const adminUIDs = global.ST.config.adminUIDs || [];
  return adminUIDs.includes(String(userId));
}

function logCommand(username, cmdName, type, success, error = null) {
  const timestamp = new Date().toLocaleTimeString();
  const statusIcon = success ? colors.green('✓') : colors.red('✗');
  const typeColor = type === 'cmd' ? colors.cyan : type === 'reply' ? colors.magenta : colors.yellow;

  let logMsg = `${colors.gray(timestamp)} ${statusIcon} ${colors.white('@' + username)} ` +
               `${typeColor(`[${type.toUpperCase()}]`)} ${colors.cyanBright(cmdName)}`;

  if (error) {
    logMsg += ` ${colors.red('→')} ${colors.redBright(error)}`;
  }

  console.log(logMsg);
}

async function handleThreadEvent(data) {
  const eventType = data.type || data.event;
  const eventBody = data.text || data.body || '';

  const isAddEvent = eventType === 'member_add' || 
                     eventType === 'participant_join' ||
                     (eventType === 'action_log' && eventBody.includes(' added '));

  const isRemoveEvent = eventType === 'member_remove' || 
                        eventType === 'participant_left' ||
                        (eventType === 'action_log' && eventBody.includes(' removed '));

  if (isAddEvent) {
    const welcomeEvent = global.ST.events.get('welcome');
    if (welcomeEvent && welcomeEvent.onEvent) {
      try {
        const message = new MessageAPI(data.thread_id, global.ST.realtime || global.ST.api, global.ST.client);
        data.type = data.type || 'action_log';
        await welcomeEvent.onEvent({ message, event: data, api: global.ST.api });
      } catch (e) {
        log.error('EVENT', `Welcome error: ${e.message}`);
      }
    }
  }

  if (isRemoveEvent) {
    const leaveEvent = global.ST.events.get('leave');
    if (leaveEvent && leaveEvent.onEvent) {
      try {
        const message = new MessageAPI(data.thread_id, global.ST.realtime || global.ST.api, global.ST.client);
        data.type = data.type || 'action_log';
        await leaveEvent.onEvent({ message, event: data, api: global.ST.api });
      } catch (e) {
        log.error('EVENT', `Leave error: ${e.message}`);
      }
    }
  }
}

module.exports = {
  handleMessage,
  handleThreadEvent,
  isAdmin,
  logCommand
};
