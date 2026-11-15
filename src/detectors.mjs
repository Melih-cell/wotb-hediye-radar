const STOPWORD_CODES = new Set([
  'WORLD', 'TANKS', 'BLITZ', 'WOTBLITZ', 'WARGAMING', 'WGNET', 'HTTPS', 'REDDIT',
  'YOUTUBE', 'STEAM', 'UPDATE', 'EVENT', 'FREEBIE', 'BUNDLE', 'CONTAINER', 'CONTAINERS',
  'SERVER', 'EUROPE', 'ASIA', 'NORTH', 'AMERICA', 'TIER10', 'TIER11', 'PREMIUM',
  'BOOSTER', 'BOOSTERS', 'CREDITS', 'DISCORD', 'TWITCH', 'ANDROID', 'IPHONE',
  'WINDOWS', 'NINTENDO', 'SWITCH', 'TASCHENRATTE', 'REDEEM', 'BONUS', 'PROMO',
  'CLAIM', 'ACTIVATE', 'GIFT', 'GIFTS', 'REWARD', 'REWARDS', 'DROPS', 'STREAM',
  'STREAMS', 'PORTAL', 'OFFERS', 'OFFER', 'MISSION', 'MISSIONS', 'AVATAR', 'CAMO',
  'CAMOUFLAGE', 'GARAGE', 'ACCOUNT', 'ACCOUNTS', 'GLOBAL', 'MOBILE', 'CLIENT',
  'STORE', 'GOOGLE', 'APPLE', 'THANK', 'THANKS', 'PLEASE', 'ANYONE', 'ACTIVE',
  'WORKING', 'EXPIRED', 'TODAY', 'TONIGHT', 'WEEKLY', 'DAILY', 'SPECIAL', 'FESTIVE',
  'MYSTERY', 'COLLECT', 'CHEST', 'CHESTS', 'CERTIFICATE', 'CERTIFICATES', 'PARTS',
  'GOLD', 'FREEXP', 'BATTLE', 'PASS', 'SEASON', 'TOURNAMENT', 'BLITZTWISTER',
  'OFFICIAL', 'COMMUNITY', 'ANNOUNCEMENT', 'NEWS', 'VIDEO', 'CHANNEL', 'SUBSCRIBE'
]);

const CODE_CONTEXT_RE = /\b(code|codes|redeem|bonus|promo|claim|activate|gift|kod|kodu)\b/i;
const REDEEM_URL_RE = /wargaming\.net\/shop\/redeem/i;
const BEGGING_QUESTION_RE = /\b(any\s+(new\s+|active\s+)?codes?|are\s+there\s+any\s+codes?|anyone\s+have\s+.*code|looking\s+for\s+codes?|code\s+not\s+working|where\s+to\s+enter\s+code)\b/i;
const FREE_GIFT_RE = /\b(free\s+(bundle|gift|container|containers|chest|gold|pack|tank|item|subscription|stuff|camo)|in[-\s]game\s+shop\s+for\s+free|claim\s+(your\s+)?free|twitch\s+drops?|stream\s+rewards?|portal\s+stream|freebie|mystery\s+box\s+for\s+free)\b/i;
const OFFICIAL_NEWS_EVENT_RE = /\b(update|event|gift|free|bundle|container|drop|drops|stream|reward|giveaway|anniversary|code|promo|discount|auction)\b/i;

/**
 * Verilen konumun çevresinde kod bağlamı (tırnak, backtick, "code:" veya redeem linki) olup olmadığını kontrol eder.
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @returns {boolean}
 */
function hasNearCodeMarker(text, index, length) {
  const before = text.slice(Math.max(0, index - 32), index);
  const after = text.slice(index + length, Math.min(text.length, index + length + 8));
  const quotedOrTicked = /[`"'(]$/.test(before) && /^[`"'.,!?\s)]/.test(after);
  const labeled = /(?:code|codes|kod|kodu|promo|bonus|redeem)\s*[:=\-–>]+\s*$/i.test(before);
  const explicitEnter = /\b(?:enter|use|try|type|redeem|activate)\s+(?:code\s+)?$/i.test(before);
  return quotedOrTicked || labeled || explicitEnter;
}

/**
 * Verilen aday token'ın bir URL yolu veya sorgu parçası olup olmadığını kontrol eder.
 * @param {string} text
 * @param {number} index
 * @param {number} length
 * @returns {boolean}
 */
function isInsideUrl(text, index, length) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEndRaw = text.indexOf('\n', index);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);
  const relIdx = index - lineStart;

  const leftSpace = line.lastIndexOf(' ', relIdx);
  const rightSpaceRaw = line.indexOf(' ', relIdx + length);
  const tokenRun = line.slice(leftSpace + 1, rightSpaceRaw === -1 ? line.length : rightSpaceRaw);
  return /https?:\/\/|www\.|\/[A-Za-z0-9_-]{3,}/i.test(tokenRun);
}

/**
 * Metinden olası Wargaming bonus/promosyon kodlarını güvenli şekilde çıkarır.
 * @param {string} text
 * @returns {string[]}
 */
export function extractBonusCodes(text) {
  const source = String(text ?? '');
  if (!source.trim()) return [];

  const hasContext = CODE_CONTEXT_RE.test(source);
  const hasRedeemUrl = REDEEM_URL_RE.test(source);
  if (!hasContext && !hasRedeemUrl) return [];

  const found = new Set();
  const tokenRe = /\b([A-Z0-9]{6,22})\b/g;

  for (const match of source.matchAll(tokenRe)) {
    const token = match[1];
    const index = match.index ?? 0;

    if (STOPWORD_CODES.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    const letters = (token.match(/[A-Z]/g) || []).length;
    if (letters < 3) continue;
    if (isInsideUrl(source, index, token.length)) continue;

    const hasDigits = /\d/.test(token);
    const nearMarker = hasNearCodeMarker(source, index, token.length);

    if ((hasContext && (hasDigits || nearMarker)) || (hasRedeemUrl && (hasDigits || nearMarker))) {
      found.add(token);
    }
  }

  return [...found];
}

/**
 * Reddit gönderisini bonus kod, ücretsiz paket veya topluluk haberi olarak sınıflandırır.
 * Sıradan gönderiler ve kod dilenme soruları için null döndürür.
 * @param {{ title?: string, selftext?: string, flair?: string }} post
 * @returns {{ type: 'BONUS_CODE' | 'FREE_GIFT' | 'COMMUNITY_NEWS', codes: string[] } | null}
 */
export function classifyRedditPost({ title = '', selftext = '', flair = '' } = {}) {
  const cleanTitle = String(title ?? '').trim();
  const cleanBody = String(selftext ?? '').trim();
  const cleanFlair = String(flair ?? '').trim();
  const combined = `${cleanTitle}\n${cleanBody}`;

  const codes = extractBonusCodes(combined);
  const looksLikeQuestion = cleanTitle.endsWith('?') || BEGGING_QUESTION_RE.test(cleanTitle);

  if (looksLikeQuestion && codes.length === 0) {
    return null;
  }

  if (codes.length > 0) {
    return { type: 'BONUS_CODE', codes };
  }

  if (FREE_GIFT_RE.test(combined)) {
    return { type: 'FREE_GIFT', codes: [] };
  }

  if (/^(official news|psa|news|giveaway|bonus code)$/i.test(cleanFlair) && OFFICIAL_NEWS_EVENT_RE.test(combined)) {
    return { type: 'COMMUNITY_NEWS', codes: [] };
  }

  return null;
}
