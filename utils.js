const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

class MessageAPI {
  constructor(threadId, api, client) {
    this.threadId = threadId;
    this.api = api || null;
    this.client = client || global.ST?.client || null;
  }

  async _sendText(threadId, text) {
    if (!threadId) throw new Error('No thread ID available');
    if (text == null) throw new Error('No text provided');

    const directCommands = this.api?.directCommands;
    if (directCommands && typeof directCommands.sendTextViaRealtime === 'function') {
      return await directCommands.sendTextViaRealtime(threadId, String(text));
    }

    if (this.client?.direct && typeof this.client.direct.sendText === 'function') {
      return await this.client.direct.sendText(threadId, String(text));
    }

    throw new Error('No Instagram text-message transport is available');
  }

  async edit(messageId, newText) {
    try {
      if (!messageId) {
        throw new Error('No message ID provided for edit');
      }
      if (!newText) {
        throw new Error('No text provided for edit');
      }
      const result = await this.api.directCommands.editMessage(this.threadId, messageId, newText);
      return { success: true, messageId, newText, ...result };
    } catch (err) {
      console.error('Edit error:', err.message);
      throw err;
    }
  }

  async reply(content) {
    try {
      if (!this.threadId) {
        throw new Error('No thread ID available');
      }

      if (typeof content === 'string') {
        const result = await this._sendText(this.threadId, content);
        return {
          messageID: result?.item_id || result?.message_id || Date.now().toString(),
          threadID: this.threadId,
          ...result
        };
      }

      if (typeof content === 'object') {
        const { body, attachment, mimeType: providedMimeType } = content;

        if (attachment) {
          const attachments = Array.isArray(attachment) ? attachment : [attachment];
          let lastResult = null;

          if (body) {
            await this.api.directCommands.sendTextViaRealtime(this.threadId, body);
          }

          for (const att of attachments) {
            let buffer = null;
            let mimeType = providedMimeType || null;

            const resolved = await this._resolveAttachment(att);
            buffer = resolved.buffer;
            if (!mimeType) {
              mimeType = resolved.mimeType;
            }

            if (!mimeType && Buffer.isBuffer(buffer)) {
              mimeType = this._detectMimeFromBuffer(buffer);
            }

            if (Buffer.isBuffer(buffer)) {
              const isImage = mimeType && mimeType.startsWith('image/');
              const isVideo = mimeType && mimeType.startsWith('video/');
              const isAudio = mimeType && mimeType.startsWith('audio/');

              if (isVideo || isAudio) {
                lastResult = await this.sendFile(buffer, { mimeType });
              } else if (isImage) {
                try {
                  lastResult = await this.sendPhoto(buffer, {});
                } catch (photoErr) {
                  console.error('SendPhoto failed, trying sendFile:', photoErr.message);
                  lastResult = await this.sendFile(buffer, { mimeType: mimeType || 'application/octet-stream' });
                }
              } else {
                lastResult = await this.sendFile(buffer, { mimeType: mimeType || 'application/octet-stream' });
              }
            }
          }

          return {
            messageID: lastResult?.item_id || lastResult?.message_id || Date.now().toString(),
            threadID: this.threadId,
            ...lastResult
          };
        }

        if (body) {
          const result = await this.api.directCommands.sendTextViaRealtime(this.threadId, body);
          return {
            messageID: result?.item_id || result?.message_id || Date.now().toString(),
            threadID: this.threadId,
            ...result
          };
        }
      }

      throw new Error('Invalid content format');
    } catch (err) {
      console.error('Reply error:', err.message);
      throw err;
    }
  }

  async send(text, threadId = this.threadId) {
    try {
      const result = await this.api.directCommands.sendTextViaRealtime(threadId, text);
      return {
        messageID: result?.item_id || result?.message_id || Date.now().toString(),
        threadID: threadId,
        ...result
      };
    } catch (err) {
      console.error('Send error:', err.message);
      throw err;
    }
  }

  async react(emoji, messageId) {
    try {
      if (!messageId) {
        throw new Error('No message ID provided for reaction');
      }
      const result = await this.api.directCommands.sendReaction({
        threadId: this.threadId,
        itemId: messageId,
        emoji: emoji,
        reactionType: 'like',
        reactionStatus: 'created'
      });
      return { success: true, emoji, ...result };
    } catch (err) {
      console.error('React error:', err.message);
      throw err;
    }
  }

  async unreact(messageId) {
    try {
      if (!messageId) {
        throw new Error('No message ID provided for unreact');
      }
      const result = await this.api.directCommands.sendReaction({
        threadId: this.threadId,
        itemId: messageId,
        emoji: '',
        reactionStatus: 'deleted'
      });
      return { success: true, ...result };
    } catch (err) {
      console.error('Unreact error:', err.message);
      throw err;
    }
  }

  async unsend(messageId) {
    try {
      if (!messageId) {
        throw new Error('No message ID provided for unsend');
      }
      const result = await this.api.directCommands.deleteMessage(this.threadId, messageId);
      return { success: true, messageId, ...result };
    } catch (err) {
      console.error('Unsend error:', err.message);
      throw err;
    }
  }

  async indicator(isActive = true) {
    try {
      const result = await this.api.directCommands.indicateActivity({
        threadId: this.threadId,
        isActive: isActive
      });
      return { success: true, isActive, ...result };
    } catch (err) {
      console.error('Indicator error:', err.message);
      throw err;
    }
  }

  async markAsSeen(messageId) {
    try {
      if (!messageId) {
        throw new Error('No message ID provided for markAsSeen');
      }
      const result = await this.api.directCommands.markAsSeen({
        threadId: this.threadId,
        itemId: messageId
      });
      return { success: true, messageId, ...result };
    } catch (err) {
      console.error('MarkAsSeen error:', err.message);
      throw err;
    }
  }

  async sendPhoto(photoBuffer, options = {}) {
    try {
      if (!photoBuffer) {
        throw new Error('photoBuffer is undefined or null');
      }
      if (!Buffer.isBuffer(photoBuffer)) {
        if (typeof photoBuffer === 'string') {
          photoBuffer = Buffer.from(photoBuffer);
        } else if (photoBuffer.data) {
          photoBuffer = Buffer.from(photoBuffer.data);
        } else {
          throw new Error('photoBuffer must be a Buffer');
        }
      }
      if (photoBuffer.length === 0) {
        throw new Error('photoBuffer is empty');
      }

      const session = global.ST.client;
      if (!session) {
        throw new Error('No valid session available');
      }

      const sendPhotoFn = require('instagram-bot-api/dist/sendmedia/sendPhoto.js');
      const threadId = options.threadId || this.threadId;

      const result = await sendPhotoFn(session, {
        photoBuffer: photoBuffer,
        threadId: threadId,
        caption: options.caption || ''
      });

      return {
        messageID: result?.payload?.item_id || result?.body?.payload?.item_id || Date.now().toString(),
        threadID: threadId,
        body: result
      };
    } catch (err) {
      console.error('SendPhoto error:', err.message);
      throw err;
    }
  }

  async sendFile(fileBuffer, options = {}) {
    try {
      if (!fileBuffer) {
        throw new Error('fileBuffer is undefined or null');
      }
      if (!Buffer.isBuffer(fileBuffer)) {
        if (typeof fileBuffer === 'string') {
          fileBuffer = Buffer.from(fileBuffer);
        } else if (fileBuffer.data) {
          fileBuffer = Buffer.from(fileBuffer.data);
        } else {
          throw new Error('fileBuffer must be a Buffer');
        }
      }
      if (fileBuffer.length === 0) {
        throw new Error('fileBuffer is empty');
      }

      const session = global.ST.client;
      if (!session) {
        throw new Error('No valid session available');
      }

      const mimeType = options.mimeType || 'application/octet-stream';
      const isVideo = mimeType.startsWith('video/');
      const threadId = options.threadId || this.threadId;

      if (isVideo) {
        const sendFileFn = require('instagram-bot-api/dist/sendmedia/sendFile.js');
        const result = await sendFileFn(session, {
          fileBuffer: fileBuffer,
          mimeType: mimeType,
          threadId: threadId
        });

        return {
          messageID: result?.payload?.item_id || result?.body?.payload?.item_id || Date.now().toString(),
          threadID: threadId,
          body: result
        };
      } else {
        return await this.sendPhoto(fileBuffer, options);
      }
    } catch (err) {
      console.error('SendFile error:', err.message);
      throw err;
    }
  }

  async sendVideo(videoBuffer, options = {}) {
    return this.sendFile(videoBuffer, { ...options, mimeType: 'video/mp4' });
  }

  async sendImage(url, options = {}) {
    try {
      const isInstagramCDN = url.includes('cdninstagram.com') || 
                              url.includes('fbcdn.net') || 
                              url.includes('instagram.com');

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };

      if (isInstagramCDN) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
        headers['Referer'] = 'https://www.instagram.com/';
      }

      const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers 
      });
      const buffer = Buffer.from(response.data);
      return await this.sendPhoto(buffer, options);
    } catch (err) {
      console.error('SendImage error:', err.message);
      throw err;
    }
  }

  async _resolveAttachment(att) {
    let buffer = null;
    let mimeType = null;

    const fetchUrl = async (url) => {
      const isInstagramCDN = url.includes('cdninstagram.com') || 
                              url.includes('fbcdn.net') || 
                              url.includes('instagram.com');

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };

      if (isInstagramCDN) {
        headers['Accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
        headers['Referer'] = 'https://www.instagram.com/';
      }

      const response = await axios.get(url, { 
        responseType: 'arraybuffer', 
        timeout: 30000,
        headers 
      });

      return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type']?.split(';')[0]
      };
    };

    if (Buffer.isBuffer(att)) {
      buffer = att;
    } else if (typeof att === 'string') {
      if (att.startsWith('http://') || att.startsWith('https://')) {
        const result = await fetchUrl(att);
        buffer = result.buffer;
        mimeType = result.contentType || this._detectMimeFromPath(att);
      } else if (fs.existsSync(att)) {
        buffer = fs.readFileSync(att);
        mimeType = this._detectMimeFromPath(att);
      } else {
        throw new Error(`Attachment path not found: ${att}`);
      }
    } else if (att && typeof att.pipe === 'function') {
      const chunks = [];
      for await (const chunk of att) {
        chunks.push(chunk);
      }
      buffer = Buffer.concat(chunks);

      if (att.path) {
        mimeType = this._detectMimeFromPath(att.path);
      }
    } else if (att && typeof att === 'object') {
      mimeType = att.mimeType || att.mimetype || att.contentType || att.type || null;

      if (att.buffer && Buffer.isBuffer(att.buffer)) {
        buffer = att.buffer;
      } else if (att.data && Buffer.isBuffer(att.data)) {
        buffer = att.data;
      } else if (att.file) {
        if (Buffer.isBuffer(att.file)) {
          buffer = att.file;
        } else if (typeof att.file === 'string') {
          if (att.file.startsWith('http://') || att.file.startsWith('https://')) {
            const result = await fetchUrl(att.file);
            buffer = result.buffer;
            if (!mimeType) mimeType = result.contentType;
          } else if (fs.existsSync(att.file)) {
            buffer = fs.readFileSync(att.file);
            if (!mimeType) mimeType = this._detectMimeFromPath(att.file);
          }
        } else if (att.file && typeof att.file.pipe === 'function') {
          const chunks = [];
          for await (const chunk of att.file) {
            chunks.push(chunk);
          }
          buffer = Buffer.concat(chunks);
          if (!mimeType && att.file.path) {
            mimeType = this._detectMimeFromPath(att.file.path);
          }
        }
      } else if (att.stream && typeof att.stream.pipe === 'function') {
        const chunks = [];
        for await (const chunk of att.stream) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      } else if (att.path && typeof att.path === 'string') {
        if (att.path.startsWith('http://') || att.path.startsWith('https://')) {
          const result = await fetchUrl(att.path);
          buffer = result.buffer;
          if (!mimeType) mimeType = result.contentType;
        } else if (fs.existsSync(att.path)) {
          buffer = fs.readFileSync(att.path);
          if (!mimeType) mimeType = this._detectMimeFromPath(att.path);
        }
      } else if (att.url && typeof att.url === 'string') {
        const result = await fetchUrl(att.url);
        buffer = result.buffer;
        if (!mimeType) mimeType = result.contentType;
      } else if (att.preview_url && typeof att.preview_url === 'string') {
        const result = await fetchUrl(att.preview_url);
        buffer = result.buffer;
        if (!mimeType) mimeType = result.contentType;
      } else if (att.image_url && typeof att.image_url === 'string') {
        const result = await fetchUrl(att.image_url);
        buffer = result.buffer;
        if (!mimeType) mimeType = result.contentType;
      }

      if (!mimeType && att.filename) {
        mimeType = this._detectMimeFromPath(att.filename);
      }
    }

    if (!buffer) {
      throw new Error('Could not resolve attachment to buffer');
    }

    return { buffer, mimeType };
  }

  _detectMimeFromPath(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeMap = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
      'mp3': 'audio/mpeg',
      'm4a': 'audio/mp4',
      'wav': 'audio/wav',
      'ogg': 'audio/ogg',
      'aac': 'audio/aac'
    };
    return mimeMap[ext] || null;
  }

  _detectMimeFromBuffer(buffer) {
    if (!buffer || buffer.length < 12) return null;

    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
      return 'image/gif';
    }
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return 'image/webp';
    }

    if (buffer.length >= 8) {
      const ftypCheck = buffer.slice(4, 8).toString('ascii');
      if (ftypCheck === 'ftyp') {
        const subtype = buffer.slice(8, 12).toString('ascii');
        if (subtype.includes('M4A') || subtype.includes('m4a')) {
          return 'audio/mp4';
        }
        return 'video/mp4';
      }
    }

    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return 'audio/mpeg';
    }
    if (buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xFA || buffer[1] === 0xF3 || buffer[1] === 0xF2)) {
      return 'audio/mpeg';
    }

    return null;
  }
}

async function getStreamFromURL(url, options = {}) {
  try {
    const isInstagramCDN = url.includes('cdninstagram.com') || 
                            url.includes('fbcdn.net') || 
                            url.includes('instagram.com');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...options.headers
    };

    if (isInstagramCDN) {
      headers['Accept'] = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
      headers['Referer'] = 'https://www.instagram.com/';
    }

    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      timeout: options.timeout || 30000,
      headers 
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type']?.split(';')[0];

    if (options.returnInfo) {
      return {
        buffer,
        mimeType: contentType,
        size: buffer.length
      };
    }

    return buffer;
  } catch (err) {
    throw new Error('Failed to get stream: ' + err.message);
  }
}

async function downloadStream(url, options = {}) {
  return getStreamFromURL(url, { ...options, returnInfo: true });
}

function detectMimeType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp';
  }

  if (buffer.length >= 8) {
    const ftypCheck = buffer.slice(4, 8).toString('ascii');
    if (ftypCheck === 'ftyp') {
      const subtype = buffer.slice(8, 12).toString('ascii');
      if (subtype.includes('M4A') || subtype.includes('m4a')) {
        return 'audio/mp4';
      }
      return 'video/mp4';
    }
  }

  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return 'audio/mpeg';
  }
  if (buffer[0] === 0xFF && (buffer[1] === 0xFB || buffer[1] === 0xFA || buffer[1] === 0xF3 || buffer[1] === 0xF2)) {
    return 'audio/mpeg';
  }

  return null;
}

async function downloadFile(url, filePath) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    return filePath;
  } catch (err) {
    throw new Error('Failed to download: ' + err.message);
  }
}

function shortenNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchUser(api, username) {
  try {
    if (!username || typeof username !== 'string') {
      return null;
    }

    const cleanUsername = username.replace('@', '').trim();
    if (!cleanUsername) {
      return null;
    }

    try {
      const userInfo = await api.user.infoByUsername(cleanUsername);
      if (userInfo && userInfo.pk) {
        return userInfo;
      }
    } catch (e) {
    }

    try {
      const users = await api.user.search(cleanUsername);
      if (users && Array.isArray(users) && users.length > 0) {
        const exactMatch = users.find(u => 
          u.username && u.username.toLowerCase() === cleanUsername.toLowerCase()
        );
        const validUser = exactMatch || users[0];
        if (validUser && validUser.pk) {
          return validUser;
        }
      }
    } catch (e) {
    }

    return null;
  } catch (err) {
    console.error('searchUser error:', err.message);
    return null;
  }
}

async function getUserByMention(api, mention) {
  try {
    const userId = mention.user_id || mention.pk || mention.id;
    const username = mention.username;

    if (userId) {
      try {
        return await api.user.info(userId);
      } catch (e) {
      }
    }

    if (username) {
      return await searchUser(api, username);
    }

    return null;
  } catch (err) {
    console.error('getUserByMention error:', err.message);
    return null;
  }
}

module.exports = {
  MessageAPI,
  getStreamFromURL,
  downloadStream,
  downloadFile,
  detectMimeType,
  shortenNumber,
  formatTime,
  delay,
  searchUser,
  getUserByMention
};
