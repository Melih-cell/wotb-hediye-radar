import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchOfficialSources } from './sources/official.mjs';
import { buildOfficialNewsMessage, buildPinnedGuideMessage, sendSingleTarget } from './telegram.mjs';
import { translateToTurkish } from './translate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const AVATAR_PATH = path.join(ROOT_DIR, 'assets', 'avatar.png');

async function callBotJson(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(`${method} hatası: ${data?.description || res.status}`);
  }
  return data.result;
}

async function setChannelPhoto(token, chatId, imagePath) {
  const bytes = await fs.readFile(imagePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([bytes], { type: 'image/png' }), 'avatar.png');

  const res = await fetch(`https://api.telegram.org/bot${token}/setChatPhoto`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(`setChatPhoto hatası: ${data?.description || res.status}`);
  }
  return data.result;
}

async function main() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const channelId = String(process.env.TELEGRAM_CHANNEL_ID || '@blitzradartr').trim();
  const botUsername = String(process.env.BOT_USERNAME || 'blitzradartr_bot').trim();
  const channelUsername = String(process.env.CHANNEL_USERNAME || channelId.replace(/^@/, '')).trim();

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN gerekli.');
  }

  console.log('🎨 Bot marka bilgileri ve komut menüsü güncelleniyor...');
  await callBotJson(token, 'setMyName', { name: 'Blitz Radar TR ⚡ Hediye & Kod' });
  await callBotJson(token, 'setMyShortDescription', {
    short_description: 'WoT Blitz Türkiye 7/24 Otomatik Bonus Kod, Ücretsiz Paket ve Türkçe Haber Radarı (0 Ban Riski).'
  });
  await callBotJson(token, 'setMyDescription', {
    description:
      'World of Tanks Blitz için sıfır (%0) ban riskli 7/24 bulut radarı!\n\n' +
      '• Anlık bonus/promosyon kodları (tek dokunuşla kopyala)\n' +
      '• Mağaza ve Web Mağaza ücretsiz paket alarmları\n' +
      '• Resmi Wargaming EU, Steam ve YouTube Türkçe haber özetleri\n' +
      '• Günlük sandık ve Cuma web mağaza hatırlatıcıları\n\n' +
      'Başlamak için /start yazın veya botu klan grubunuza ekleyin!'
  });
  await callBotJson(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Bildirimleri başlat ve hoş geldin kartını aç' },
      { command: 'sonhaberler', description: 'Son 3 resmi WoT Blitz haberini Türkçe gör' },
      { command: 'magaza', description: 'EU Kod Girme ve Web Mağaza ücretsiz teklif linkleri' },
      { command: 'durum', description: '7/24 bulut radarı durumunu ve abone sayısını gör' },
      { command: 'durdur', description: 'Kişisel/grup bildirimlerini durdur' }
    ]
  });
  console.log('✅ Bot profili ve /komut menüsü ayarlandı.');

  console.log(`📢 Kanal ayarlanıyor (${channelId})...`);
  await callBotJson(token, 'setChatTitle', {
    chat_id: channelId,
    title: 'Blitz Radar TR ⚡ WoT Blitz Hediye & Kod'
  });
  await callBotJson(token, 'setChatDescription', {
    chat_id: channelId,
    description:
      'World of Tanks Blitz Türkiye 7/24 Otomatik Bonus Kod, Ücretsiz Mağaza Paketi ve Türkçe Haber Radarı.\n\n' +
      `🤖 Kişisel Bot & Klan Grubu: @${botUsername}\n` +
      '🛡️ Oyun istemcisine dokunmaz (%0 ban riski).'
  });
  await setChannelPhoto(token, channelId, AVATAR_PATH);
  console.log('✅ Kanal başlığı, açıklaması ve özel HD avatarı yüklendi.');

  const guide = buildPinnedGuideMessage({ channelUsername, botUsername });
  const guideRes = await sendSingleTarget({
    token,
    chatId: channelId,
    html: guide.html,
    buttons: guide.buttons
  });
  if (!guideRes.ok || !guideRes.messageId) {
    throw new Error(`Sabitlenecek rehber mesajı gönderilemedi: ${guideRes.error}`);
  }
  await callBotJson(token, 'pinChatMessage', {
    chat_id: channelId,
    message_id: guideRes.messageId,
    disable_notification: true
  });
  console.log(`📌 Başlangıç rehberi gönderildi ve kanala sabitlendi (msg ${guideRes.messageId}).`);

  const { officialItems } = await fetchOfficialSources();
  if (officialItems.length > 0) {
    const latest = officialItems[0];
    const [trTitle, trSummary] = await Promise.all([
      translateToTurkish(latest.title),
      translateToTurkish(latest.summary)
    ]);
    const newsPayload = buildOfficialNewsMessage({
      source: latest.source,
      trTitle,
      trSummary,
      url: latest.url,
      imageUrl: latest.imageUrl || '',
      codes: latest.codes || [],
      channelUsername,
      botUsername
    });
    const newsRes = await sendSingleTarget({
      token,
      chatId: channelId,
      html: newsPayload.html,
      imageUrl: newsPayload.imageUrl,
      buttons: newsPayload.buttons
    });
    if (!newsRes.ok) {
      throw new Error(`İlk görselli haber kartı gönderilemedi: ${newsRes.error}`);
    }
    console.log(`📰 İlk görselli resmi haber kanala paylaşıldı (msg ${newsRes.messageId}).`);
  }
}

main().catch((err) => {
  console.error('❌ Marka kurulumu hatası:', err.message);
  process.exit(1);
});
