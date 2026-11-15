import { cleanText, escapeHtml } from './utils.mjs';

const REDEEM_URL = 'https://eu.wargaming.net/shop/redeem/';
const WEB_OFFERS_URL = 'https://eu.wotblitz.com/en/news/';
const WG_SHOP_OFFERS_URL = 'https://eu.wargaming.net/shop/wotb/offers/';

/**
 * Virgülle ayrılmış Chat ID dizisini temizler.
 * @param {string} rawChatIds
 * @returns {string[]}
 */
export function parseChatIds(rawChatIds) {
  return String(rawChatIds ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Telegram Bot API üzerinden bir veya birden fazla sohbete HTML mesaj gönderir.
 */
export async function sendTelegramMessage({ token, chatIds, html, buttons = [], disablePreview = false }) {
  const targets = Array.isArray(chatIds) ? chatIds : parseChatIds(chatIds);
  if (!token || targets.length === 0) {
    throw new Error('TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID eksik.');
  }

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;
  for (const chatId of targets) {
    const body = {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: disablePreview
    };

    if (buttons.length > 0) {
      body.reply_markup = { inline_keyboard: buttons };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      throw new Error(`Telegram API hatası (chat ${chatId}): ${data?.description || res.status}`);
    }
  }
}

export function buildWelcomeMessage(recentOfficialItems = []) {
  const lines = [
    '🛡️ <b>WoT Blitz Hediye &amp; Haber Radarı Aktif!</b>',
    '',
    'Sıfır (%0) ban riskli 7/24 bulut radarı başarıyla bağlandı. Buradan otomatik takip edilecekler:',
    '• 🚨 <b>Anlık Bonus / Promosyon Kodları</b> (tek dokunuşla kopyala + direkt aç)',
    '• 🎁 <b>Mağaza Ücretsiz Paketleri &amp; Yayın Ödülleri</b>',
    '• 📰 <b>Resmi Wargaming EU, Steam ve YouTube Haberleri</b> (Türkçe özetli)',
    '• ⏰ <b>Günlük Sandık &amp; Haftalık Cuma Web Mağaza Hatırlatıcıları</b>'
  ];

  if (recentOfficialItems.length > 0) {
    lines.push('', '<b>📌 Son Resmi Duyurular:</b>');
    for (const item of recentOfficialItems.slice(0, 2)) {
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
      [{ text: '📰 WoT Blitz Resmi Haberler', url: WEB_OFFERS_URL }]
    ]
  };
}

export function buildRewardAlertMessage({ type, codes = [], trTitle, trSummary, url, sourceLabel = 'r/WorldOfTanksBlitz' }) {
  const lines = [];

  if (codes.length > 0 || type === 'BONUS_CODE') {
    lines.push('🚨 <b>YENİ BONUS KOD YAKALANDI!</b>');
    lines.push('');
    for (const code of codes) {
      lines.push(`👉 <code>${escapeHtml(code)}</code>  <i>(dokunarak kopyala)</i>`);
    }
  } else if (type === 'FREE_GIFT') {
    lines.push('🎁 <b>ÜCRETSİZ PAKET / ÖDÜL DUYURUSU!</b>');
  } else {
    lines.push('📢 <b>TOPLULUK ÖNEMLİ DUYURU</b>');
  }

  lines.push('');
  lines.push(`<b>${escapeHtml(trTitle)}</b>`);

  const summary = cleanText(trSummary, 360);
  if (summary && summary.toLowerCase() !== trTitle.toLowerCase()) {
    lines.push('', escapeHtml(summary));
  }

  lines.push('', `<i>Kaynak: ${escapeHtml(sourceLabel)}</i>`);

  const buttons = [
    [
      { text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL },
      { text: '🛒 Web Mağaza', url: WG_SHOP_OFFERS_URL }
    ]
  ];
  if (url) {
    buttons.push([{ text: '🔗 Kaynağı Gör', url }]);
  }

  return {
    html: lines.join('\n'),
    buttons
  };
}

export function buildOfficialNewsMessage({ source, trTitle, trSummary, url, codes = [] }) {
  const lines = [`📰 <b>${escapeHtml(source)} — Resmi Duyuru</b>`, ''];

  if (codes.length > 0) {
    lines.push(`🎁 <b>Haber İçinde Kod:</b> ${codes.map((c) => `<code>${escapeHtml(c)}</code>`).join('  ')}`);
    lines.push('');
  }

  lines.push(`<b>${escapeHtml(trTitle)}</b>`);

  const summary = cleanText(trSummary, 380);
  if (summary && summary.toLowerCase() !== trTitle.toLowerCase()) {
    lines.push('', escapeHtml(summary));
  }

  const row1 = [{ text: '📰 Haberi Aç', url }];
  if (codes.length > 0 || /\b(free|gift|bundle|drops|code|reward|ücretsiz|hediye|paket|ödül|kod)\b/i.test(`${trTitle} ${summary}`)) {
    row1.push({ text: '🎁 Kodu Aktif Et (EU)', url: REDEEM_URL });
  }

  return {
    html: lines.join('\n'),
    buttons: [row1]
  };
}

export function buildDailyReminderMessage() {
  const html = [
    '⏰ <b>Günlük WoT Blitz Ücretsiz Kontrol Vakti!</b>',
    '',
    'Bugünkü süreli ücretsizleri almayı unutma:',
    '• 📦 <b>Oyun İçi Mağaza:</b> Günlük / 3 günlük ücretsiz sandıklarını aç',
    '• 📺 <b>Mobil / Tablet Kontrolü:</b> Günde 5x10 Altın (50 Altın) ve video sandığı reklamlarını kontrol et',
    '• 🎯 <b>Günlük Görevler:</b> Süre dolmadan sandık anahtarlarını topla'
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL },
        { text: '🎁 Kod Girme Sayfası', url: REDEEM_URL }
      ]
    ]
  };
}

export function buildWeeklyWebOfferMessage() {
  const html = [
    '🛒 <b>Haftalık Wargaming Web Mağaza Hatırlatması</b>',
    '',
    'Wargaming Web Mağazası (Offers) sayfasında bu haftanın ücretsiz konteyner veya görev paketi açılmış olabilir!',
    '',
    '<i>Not: Bu paketler oyun içi mağazada görünmeyebilir, sadece web mağazadan giriş yapıp tek tıkla alınır.</i>'
  ].join('\n');

  return {
    html,
    buttons: [
      [
        { text: '🛒 Web Mağaza Teklifleri', url: WG_SHOP_OFFERS_URL },
        { text: '🎁 Kod Girme Sayfası', url: REDEEM_URL }
      ]
    ]
  };
}
