import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildCommandGuideMessage,
  buildNewsDigestMessage,
  buildStatusMessage,
  buildWelcomeMessage,
  sendTelegramMessage
} from './telegram.mjs';
import { translateToTurkish } from './translate.mjs';

const KEY_SALT = 'blitz-radar-tr-v2';

function deriveKey(secret) {
  return crypto.scryptSync(String(secret), KEY_SALT, 32);
}

/**
 * Abone sohbet ID listesini AES-256-GCM ile şifreler.
 * @param {string[]} chatIdsArray
 * @param {string} secret
 * @returns {{ iv: string, tag: string, data: string }}
 */
export function encryptSubscribers(chatIdsArray, secret) {
  if (!secret) {
    throw new Error('Şifreleme anahtarı (secret) boş olamaz.');
  }
  const uniqueIds = [...new Set(chatIdsArray.map((id) => String(id).trim()).filter(Boolean))];
  const iv = crypto.randomBytes(12);
  const key = deriveKey(secret);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(uniqueIds), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

/**
 * Şifrelenmiş abone nesnesini çözerek sohbet ID dizisi döndürür.
 * @param {{ iv?: string, tag?: string, data?: string } | null} encObj
 * @param {string} secret
 * @returns {string[]}
 */
export function decryptSubscribers(encObj, secret) {
  if (!encObj || !encObj.iv || !encObj.tag || !encObj.data || !secret) {
    return [];
  }
  try {
    const key = deriveKey(secret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encObj.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encObj.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encObj.data, 'base64')),
      decipher.final()
    ]);
    const parsed = JSON.parse(decrypted.toString('utf8'));
    return Array.isArray(parsed) ? [...new Set(parsed.map((id) => String(id).trim()).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

export async function loadEncryptedSubscribers(filePath, secret) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return decryptSubscribers(JSON.parse(raw), secret);
  } catch {
    return [];
  }
}

export async function saveEncryptedSubscribers(filePath, chatIdsArray, secret) {
  const payload = encryptSubscribers(chatIdsArray, secret);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function normalizeCommand(rawText) {
  const firstToken = String(rawText ?? '').trim().split(/\s+/)[0] || '';
  if (!firstToken.startsWith('/')) return '';
  return firstToken.split('@')[0].toLowerCase();
}

/**
 * Bot API üzerinden yeni komutları ve grup katılımlarını işler.
 */
export async function processBotUpdates({
  token,
  state,
  subscribersSet,
  recentNews = [],
  channelUsername = 'blitzradartr',
  botUsername = 'blitzradartr_bot'
}) {
  const offset = (Number(state.lastUpdateId) || 0) + 1;
  const allowed = encodeURIComponent(JSON.stringify(['message', 'my_chat_member']));
  const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&limit=100&allowed_updates=${allowed}`;

  let updates = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const json = await res.json();
    if (!res.ok || !json?.ok || !Array.isArray(json.result)) {
      return { processedCount: 0, subscribersChanged: false };
    }
    updates = json.result;
  } catch (err) {
    console.warn(`⚠️ Bot güncellemeleri alınamadı: ${err.message}`);
    return { processedCount: 0, subscribersChanged: false };
  }

  let subscribersChanged = false;
  let translatedTopNews = null;

  const getTranslatedNews = async () => {
    if (translatedTopNews) return translatedTopNews;
    const top3 = recentNews.slice(0, 3);
    translatedTopNews = await Promise.all(
      top3.map(async (item) => ({
        ...item,
        trTitle: await translateToTurkish(item.title)
      }))
    );
    return translatedTopNews;
  };

  for (const upd of updates) {
    if (typeof upd.update_id === 'number') {
      state.lastUpdateId = Math.max(Number(state.lastUpdateId) || 0, upd.update_id);
    }

    const memberUpdate = upd.my_chat_member;
    if (memberUpdate?.chat?.id !== undefined && memberUpdate.chat.type !== 'channel') {
      const chatId = String(memberUpdate.chat.id);
      const status = memberUpdate.new_chat_member?.status;
      if (status === 'member' || status === 'administrator') {
        if (!subscribersSet.has(chatId)) {
          subscribersSet.add(chatId);
          subscribersChanged = true;
          const news = await getTranslatedNews();
          await sendTelegramMessage({
            token,
            chatIds: [chatId],
            ...buildWelcomeMessage(news, { channelUsername, botUsername })
          }).catch(() => {});
        }
      } else if (status === 'left' || status === 'kicked') {
        if (subscribersSet.delete(chatId)) {
          subscribersChanged = true;
        }
      }
      continue;
    }

    const msg = upd.message;
    if (!msg?.chat?.id || msg.chat.type === 'channel') continue;
    const chatId = String(msg.chat.id);
    const cmd = normalizeCommand(msg.text || '');

    if (cmd === '/start' || cmd === '/abone') {
      if (!subscribersSet.has(chatId)) {
        subscribersSet.add(chatId);
        subscribersChanged = true;
      }
      const news = await getTranslatedNews();
      await sendTelegramMessage({
        token,
        chatIds: [chatId],
        ...buildWelcomeMessage(news, { channelUsername, botUsername })
      }).catch(() => {});
    } else if (cmd === '/durdur' || cmd === '/stop') {
      if (subscribersSet.delete(chatId)) {
        subscribersChanged = true;
      }
      await sendTelegramMessage({
        token,
        chatIds: [chatId],
        html: '🔕 <b>Bildirimler durduruldu.</b>\nTekrar başlatmak için istediğin zaman /start yazabilir veya topluluk kanalımızdan takip edebilirsin.',
        buttons: [[{ text: '📢 Topluluk Kanalı', url: `https://t.me/${channelUsername}` }]]
      }).catch(() => {});
    } else if (cmd === '/sonhaberler' || cmd === '/haber') {
      const news = await getTranslatedNews();
      await sendTelegramMessage({
        token,
        chatIds: [chatId],
        ...buildNewsDigestMessage(news, { channelUsername, botUsername })
      }).catch(() => {});
    } else if (cmd === '/magaza' || cmd === '/hediye' || cmd === '/kod') {
      await sendTelegramMessage({
        token,
        chatIds: [chatId],
        ...buildCommandGuideMessage({ channelUsername, botUsername })
      }).catch(() => {});
    } else if (cmd === '/durum') {
      await sendTelegramMessage({
        token,
        chatIds: [chatId],
        ...buildStatusMessage({
          subscriberCount: subscribersSet.size,
          channelUsername,
          botUsername
        })
      }).catch(() => {});
    }
  }

  return {
    processedCount: updates.length,
    subscribersChanged
  };
}
