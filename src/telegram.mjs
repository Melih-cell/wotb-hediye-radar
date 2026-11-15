import { cleanText, escapeHtml } from './utils.mjs';

const REDEEM_URL = 'https://eu.wargaming.net/shop/redeem/';
const WEB_NEWS_URL = 'https://eu.wotblitz.com/en/news/';
const WG_SHOP_OFFERS_URL = 'https://eu.wargaming.net/shop/wotb/offers/';

const DEFAULT_CHANNEL = process.env.CHANNEL_USERNAME || 'blitzradartr';
const DEFAULT_BOT = process.env.BOT_USERNAME || 'blitzradartr_bot';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseChatIds(rawChatIds) {
  return String(rawChatIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function buildCommunityRow(channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT) {
  return [
    { text: '📢 Topluluk Kanalı', url: `https://t.me/${channelUsername}` },
    { text: '➕ Gruba/Klana Ekle', url: `https://t.me/${botUsername}?startgroup=true` }
  ];
}

function buildShareButton(shareText, url) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url || `https://t.me/${DEFAULT_CHANNEL}`)}&text=${encodeURIComponent(shareText)}`;
  return { text: '📤 Arkadaşına Gönder', url: shareUrl };
}

/**
 * Tek bir sohbete (mümkünse kapak görselli `sendPhoto`, olmazsa `sendMessage` fallback ile) mesaj gönderir.
 * Kalıcı abone hatası (403 blocked / chat not found) durumunda `{ ok: false, permanent: true }` döndürür.
 */
export async function sendSingleTarget({
  token,
  chatId,
  html,
  imageUrl = '',
  buttons = [],
  disablePreview = false
}) {
  const replyMarkup = buttons.length > 0 ? { inline_keyboard: buttons } : undefined;

  if (imageUrl && html.length <= 980) {
    try {
      const photoRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: imageUrl,
          caption: html,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        }),
        signal: AbortSignal.timeout(12000)
      });
      const photoData = await photoRes.json().catch(() => ({}));
      if (photoRes.ok && photoData?.ok) {
        return { ok: true, messageId: photoData.result?.message_id };
      }
      const desc = String(photoData?.description || '');
      if (photoRes.status === 403 || /chat not found|bot was blocked|user is deactivated|kicked/i.test(desc)) {
        return { ok: false, permanent: true, error: desc || String(photoRes.status) };
      }
    } catch {
      // Görselli gönderim başarısızsa düz metin HTML mesajına düş
    }
  }

  const body = {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: disablePreview
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });

  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.ok) {
    return { ok: true, messageId: data.result?.message_id };
  }

  const desc = String(data?.description || res.status);
  const permanent = res.status === 403 || /chat not found|bot was blocked|user is deactivated|kicked/i.test(desc);
  return { ok: false, permanent, error: desc };
}

/**
 * Tek veya çoklu hedefe mesaj gönderir (tekilleştirilmiş yayın).
 */
export async function sendTelegramMessage({ token, chatIds, html, imageUrl = '', buttons = [], disablePreview = false }) {
  const targets = [...new Set(Array.isArray(chatIds) ? chatIds : parseChatIds(chatIds))].filter(Boolean);
  if (!token || targets.length === 0) {
    throw new Error('TELEGRAM_BOT_TOKEN veya hedef chat ID eksik.');
  }

  for (const chatId of targets) {
    const result = await sendSingleTarget({ token, chatId, html, imageUrl, buttons, disablePreview });
    if (!result.ok) {
      throw new Error(`Telegram API hatası (chat ${chatId}): ${result.error}`);
    }
  }
}

/**
 * Kanal + tüm abonelere hata toleranslı yayın yapar; botu engelleyen/kapanan sohbetleri döndürür.
 */
export async function broadcastTelegramPayload({ token, targets, payload }) {
  const uniqueTargets = [...new Set(targets.map((t) => String(t).trim()).filter(Boolean))];
  const deadChatIds = [];
  let sentCount = 0;

  for (const chatId of uniqueTargets) {
    const res = await sendSingleTarget({
      token,
      chatId,
      html: payload.html,
      imageUrl: payload.imageUrl || '',
      buttons: payload.buttons || [],
      disablePreview: Boolean(payload.disablePreview)
    });

    if (res.ok) {
      sentCount += 1;
    } else if (res.permanent && !chatId.startsWith('@')) {
      deadChatIds.push(chatId);
      console.warn(`🧹 Pasif abone temizlenecek (${chatId}): ${res.error}`);
    } else {
      console.warn(`⚠️ Gönderim atlandı (${chatId}): ${res.error}`);
    }

    await sleep(80);
  }

  return { sentCount, deadChatIds };
}

export function buildWelcomeMessage(recentOfficialItems = [], { channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const lines = [
    '🛡️ <b>Blitz Radar TR ⚡ WoT Blitz Hediye &amp; Haber Radarı</b>',
    '',
    'Sıfır (%0) ban riskli <b>7/24 bulut radarına</b> hoş geldin! Buradan otomatik takip edilenler:',
    '• 🚨 <b>Anlık Bonus / Promosyon Kodları</b> (tek dokunuşla kopyala + direkt aç)',
    '• 🎁 <b>Mağaza Ücretsiz Paketleri, Twitch Drops &amp; Yayın Ödülleri</b>',
    '• 📰 <b>Resmi Wargaming EU, Steam ve YouTube Haberleri</b> (görselli + Türkçe özet)',
    '• ⏰ <b>Günlük Sandık (19:00 TR) &amp; Haftalık Cuma Web Mağaza Hatırlatıcıları</b>',
    '',
    '<i>💡 Klan veya arkadaş grubunuza eklemek için aşağıdaki "➕ Gruba/Klana Ekle" butonunu kullanabilirsiniz.</i>'
  ];

  if (recentOfficialItems.length > 0) {
    lines.push('', '<b>📌 Son Resmi Duyurular:</b>');
    for (const item of recentOfficialItems.slice(0, 3)) {
      const title = escapeHtml(item.trTitle || item.title);
      lines.push(`• <a href="${escapeHtml(item.url)}">${title}</a>`);
    }
  }

  return {
    html: lines.join('\n'),
    buttons: [
      [
        { text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL },
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL }
      ],
      buildCommunityRow(channelUsername, botUsername)
    ]
  };
}

export function buildPinnedGuideMessage({ channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const html = [
    '📌 <b>BLITZ RADAR TR — SABİTLENMİŞ BAŞLANGIÇ REHBERİ</b>',
    '',
    '🛡️ <b>Sıfır (%0) Ban Riski:</b> Oyun istemcisine veya belleğine dokunmaz; yalnızca resmi kaynakları ve topluluk duyurularını 15 dakikada bir 7/24 tarar.',
    '',
    '<b>Burada Neler Paylaşılır?</b>',
    '• 🚨 <b>YENİ BONUS KOD:</b> Yayın veya etkinlik kodları çıktığı an tek dokunuşla kopyalanabilir kutu + direkt EU kod sayfası.',
    '• 🎁 <b>ÜCRETSİZ PAKET &amp; DROPS:</b> Mağaza veya Web Mağazadaki süreli ücretsiz konteynerler ve yayın ödülleri.',
    '• 📰 <b>RESMİ TÜRKÇE ÖZET:</b> Wargaming EU, Steam ve YouTube duyuruları görselli Türkçe özetle.',
    '• ⏰ <b>ZAMANLAYICILAR:</b> Her akşam 19:00 TR günlük sandık/altın reklamı kontrolü ve her Cuma 18:00 TR Web Mağaza ücretsiz paket hatırlatması.',
    '',
    `🤖 <b>Özel Bildirim &amp; Klan Grubu:</b> <a href="https://t.me/${escapeHtml(botUsername)}">@${escapeHtml(botUsername)}</a> botunu başlatabilir veya klan grubunuza ekleyebilirsiniz.`
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🎁 Kod Gir (EU)', url: REDEEM_URL },
        { text: '🛒 Web Mağaza (Offers)', url: WG_SHOP_OFFERS_URL }
      ],
      [
        { text: '🤖 Bota Git', url: `https://t.me/${botUsername}` },
        { text: '➕ Klana / Gruba Ekle', url: `https://t.me/${botUsername}?startgroup=true` }
      ],
      [{ text: '📰 WoT Blitz Resmi Haberler', url: WEB_NEWS_URL }]
    ]
  };
}

export function buildRewardAlertMessage({
  type,
  codes = [],
  trTitle,
  trSummary,
  url,
  sourceLabel = 'r/WorldOfTanksBlitz',
  channelUsername = DEFAULT_CHANNEL,
  botUsername = DEFAULT_BOT
}) {
  const lines = [];

  if (codes.length > 0 || type === 'BONUS_CODE') {
    lines.push('🚨 <b>YENİ BONUS KOD YAKALANDI!</b>');
    lines.push('');
    for (const code of codes) {
      lines.push(`👉 <code>${escapeHtml(code)}</code>  <i>(dokunarak kopyala)</i>`);
    }
  } else if (type === 'FREE_GIFT') {
    lines.push('🎁 <b>ÜCRETSİZ MAĞAZA PAKETİ / ÖDÜL!</b>');
  } else {
    lines.push('📢 <b>TOPLULUK ÖNEMLİ DUYURU</b>');
  }

  lines.push('');
  lines.push(`<b>${escapeHtml(trTitle)}</b>`);

  const summary = cleanText(trSummary, 340);
  if (summary && summary.toLowerCase() !== trTitle.toLowerCase()) {
    lines.push('', escapeHtml(summary));
  }

  lines.push('', `<i>Kaynak: ${escapeHtml(sourceLabel)} · @${escapeHtml(channelUsername)}</i>`);

  const shareText = codes.length > 0
    ? `WoT Blitz Yeni Bonus Kod: ${codes.join(', ')} — ${trTitle}`
    : `WoT Blitz Ücretsiz Ödül: ${trTitle}`;

  const buttons = [
    [
      { text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL },
      { text: '🛒 Web Mağaza', url: WG_SHOP_OFFERS_URL }
    ]
  ];
  const row2 = [];
  if (url) row2.push({ text: '🔗 Kaynağı Gör', url });
  row2.push(buildShareButton(shareText, url || `https://t.me/${channelUsername}`));
  buttons.push(row2);
  buttons.push(buildCommunityRow(channelUsername, botUsername));

  return {
    html: lines.join('\n'),
    buttons
  };
}

export function buildOfficialNewsMessage({
  source,
  trTitle,
  trSummary,
  url,
  imageUrl = '',
  codes = [],
  channelUsername = DEFAULT_CHANNEL,
  botUsername = DEFAULT_BOT
}) {
  const lines = [`📰 <b>${escapeHtml(source)} — RESMİ DUYURU</b>`, ''];

  if (codes.length > 0) {
    lines.push(`🎁 <b>Haber İçinde Kod:</b> ${codes.map((c) => `<code>${escapeHtml(c)}</code>`).join('  ')}`);
    lines.push('');
  }

  lines.push(`<b>${escapeHtml(trTitle)}</b>`);

  const summary = cleanText(trSummary, 360);
  if (summary && summary.toLowerCase() !== trTitle.toLowerCase()) {
    lines.push('', escapeHtml(summary));
  }

  lines.push('', `<i>⚡ Blitz Radar TR · @${escapeHtml(channelUsername)}</i>`);

  const row1 = [{ text: '📰 Haberi Aç', url }];
  if (codes.length > 0 || /\b(free|gift|bundle|drops|code|reward|ücretsiz|hediye|paket|ödül|kod)\b/i.test(`${trTitle} ${summary}`)) {
    row1.push({ text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL });
  } else {
    row1.push(buildShareButton(`WoT Blitz Resmi Haber: ${trTitle}`, url));
  }

  return {
    html: lines.join('\n'),
    imageUrl,
    buttons: [row1, buildCommunityRow(channelUsername, botUsername)]
  };
}

export function buildDailyReminderMessage({ channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const html = [
    '⏰ <b>GÜNLÜK KONTROL — ÜCRETSİZ SANDIK &amp; ALTIN VAKTİ!</b>',
    '',
    'Bugünkü süreli ücretsizleri almayı unutma:',
    '• 📦 <b>Oyun İçi Mağaza:</b> Günlük / 3 günlük ücretsiz sandıklarını aç',
    '• 📺 <b>Mobil / Tablet Kontrolü:</b> Günde 5x10 Altın (50 Altın) ve video sandığı reklamlarını kontrol et',
    '• 🎯 <b>Günlük Görevler:</b> Süre dolmadan sandık anahtarlarını topla',
    '',
    `<i>⚡ Blitz Radar TR · @${escapeHtml(channelUsername)}</i>`
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL },
        { text: '🎁 Kod Girme Sayfası', url: REDEEM_URL }
      ],
      buildCommunityRow(channelUsername, botUsername)
    ]
  };
}

export function buildWeeklyWebOfferMessage({ channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const html = [
    '🛒 <b>HAFTALIK WEB MAĞAZA ÜCRETSİZ PAKET HATIRLATMASI</b>',
    '',
    'Wargaming Web Mağazası (Offers) sayfasında bu haftanın ücretsiz konteyner veya görev paketi açılmış olabilir!',
    '',
    '<i>Not: Bu paketler oyun içi mağazada görünmeyebilir, sadece web mağazadan giriş yapıp tek tıkla alınır.</i>',
    '',
    `<i>⚡ Blitz Radar TR · @${escapeHtml(channelUsername)}</i>`
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL },
        { text: '🎁 Kod Girme Sayfası', url: REDEEM_URL }
      ],
      buildCommunityRow(channelUsername, botUsername)
    ]
  };
}

export function buildNewsDigestMessage(recentNews = [], { channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const lines = ['📰 <b>Son Resmi WoT Blitz Haberleri</b>', ''];
  if (recentNews.length === 0) {
    lines.push('Şu anda listelenecek haber bulunamadı.');
  } else {
    for (const item of recentNews.slice(0, 3)) {
      const title = escapeHtml(item.trTitle || item.title);
      lines.push(`• <a href="${escapeHtml(item.url)}">${title}</a> <i>(${escapeHtml(item.source)})</i>`);
    }
  }
  return {
    html: lines.join('\n'),
    buttons: [
      [{ text: '📰 Tüm Haberler', url: WEB_NEWS_URL }],
      buildCommunityRow(channelUsername, botUsername)
    ]
  };
}

export function buildCommandGuideMessage({ channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const html = [
    '🎁 <b>Ücretsiz Paket &amp; Bonus Kod Hızlı Erişim</b>',
    '',
    '1. <b>Wargaming Kod Aktivasyon (EU):</b> Yayın/etkinlik kodlarını doğrudan hesabınıza tanımlayın.',
    '2. <b>Web Mağaza Teklifleri (Offers):</b> Oyun içinde görünmeyen haftalık ücretsiz kutular ve görev paketlerini kontrol edin.',
    '3. <b>Günlük Oyun İçi:</b> Günlük sandıklar + mobilde günde 5x10 Altın reklamı.'
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL },
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL }
      ],
      buildCommunityRow(channelUsername, botUsername)
    ]
  };
}

export function buildStatusMessage({ subscriberCount = 0, channelUsername = DEFAULT_CHANNEL, botUsername = DEFAULT_BOT } = {}) {
  const html = [
    '📊 <b>Blitz Radar TR — Sistem Durumu</b>',
    '',
    '• 🟢 <b>Durum:</b> 7/24 Aktif (GitHub Actions Bulut)',
    '• ⏱️ <b>Tarama Sıklığı:</b> Her 15 dakikada bir',
    '• 📡 <b>Kaynaklar:</b> Wargaming EU RSS, Steam News, Resmi YouTube, r/WorldOfTanksBlitz (çift yedekli)',
    `• 👥 <b>Aktif Bot/Grup Abonesi:</b> ${subscriberCount}`,
    `• 📢 <b>Topluluk Kanalı:</b> @${escapeHtml(channelUsername)}`
  ].join('\n');

  return {
    html,
    buttons: [buildCommunityRow(channelUsername, botUsername)]
  };
}
