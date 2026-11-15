/**
 * HTML özel karakterlerini Telegram HTML parse_mode için kaçırır.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Yaygın XML/HTML entity kodlarını normal metne dönüştürür.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

/**
 * CDATA, Steam görsel yer tutucuları, BBCode ve HTML etiketlerini temizler.
 * @param {string} raw
 * @param {number} [maxLen=360]
 * @returns {string}
 */
export function cleanText(raw, maxLen = 360) {
  let text = String(raw ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/\{STEAM_CLAN_IMAGE\}[^\s]*/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  text = decodeEntities(text)
    .replace(/\[\/?[a-z0-9=*#"'\s:/._-]+\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!maxLen || text.length <= maxLen) {
    return text;
  }

  const sliced = text.slice(0, maxLen).trim();
  const lastSentenceEnd = Math.max(
    sliced.lastIndexOf('. '),
    sliced.lastIndexOf('! '),
    sliced.lastIndexOf('? ')
  );
  if (lastSentenceEnd >= Math.floor(maxLen * 0.55)) {
    return sliced.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = sliced.lastIndexOf(' ');
  const cutoff = lastSpace >= Math.floor(maxLen * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${cutoff.replace(/[,:;.\s]+$/, '')}...`;
}

/**
 * Başlıkları kaynaklar arası tekilleştirme için normalize eder.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitleKey(title) {
  return decodeEntities(String(title ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 45);
}

/**
 * Verilen tarih için Europe/Istanbul saat diliminde tarih, saat, gün ve ISO hafta anahtarı döndürür.
 * @param {Date} [date=new Date()]
 * @returns {{ dateStr: string, hour: number, weekday: string, isoWeekKey: string }}
 */
export function getIstanbulTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const year = Number(map.year);
  const month = Number(map.month);
  const day = Number(map.day);
  const hour = Number(map.hour);
  const dateStr = `${map.year}-${map.month}-${map.day}`;

  // ISO week calculation on Istanbul local calendar date
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  const isoWeekKey = `${isoYear}-W${String(weekNo).padStart(2, '0')}`;

  return {
    dateStr,
    hour,
    weekday: map.weekday,
    isoWeekKey
  };
}

/**
 * XML/Atom içinden belirtilen etiketin içeriğini alır.
 * @param {string} block
 * @param {string} tag
 * @returns {string}
 */
export function extractXmlTag(block, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1].trim() : '';
}
