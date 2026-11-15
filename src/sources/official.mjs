import { cleanText, extractXmlTag, normalizeTitleKey } from '../utils.mjs';
import { extractBonusCodes } from '../detectors.mjs';

const WG_RSS_URL = 'https://eu.wotblitz.com/en/rss/news/';
const STEAM_NEWS_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=444200&count=6&maxlength=900&format=json';
const YT_RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCerDX35jbArUz3yCZhiHJ6w';

const YT_REWARD_FILTER_RE = /\b(free|gift|bundle|drops|stream|giveaway|reward|rewards|event|update|code|promo)\b/i;

/**
 * Wargaming EU Portal RSS akışından resmi haberleri çeker.
 */
async function fetchWargamingRss() {
  try {
    const res = await fetch(WG_RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wotb-hediye-radar/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xml = await res.text();
    const items = [];

    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const block = match[1];
      const title = cleanText(extractXmlTag(block, 'title'), 180);
      const description = cleanText(extractXmlTag(block, 'description'), 360);
      const link = cleanText(extractXmlTag(block, 'link'), 400);
      const guid = cleanText(extractXmlTag(block, 'guid'), 400) || link;
      const category = cleanText(extractXmlTag(block, 'category'), 80);
      const pubDateRaw = cleanText(extractXmlTag(block, 'pubDate'), 80);
      const publishedAt = pubDateRaw ? Date.parse(pubDateRaw) || 0 : 0;

      if (!guid || !title) continue;
      items.push({
        id: `wg:${guid}`,
        source: 'Wargaming EU',
        title,
        summary: description,
        url: link || guid,
        category,
        publishedAt,
        codes: extractBonusCodes(`${title}\n${description}`)
      });
    }

    return items;
  } catch (err) {
    console.warn(`⚠️ Wargaming EU RSS alınamadı: ${err.message}`);
    return [];
  }
}

/**
 * Steam News API üzerinden AppID 444200 haberlerini çeker.
 */
async function fetchSteamNews() {
  try {
    const res = await fetch(STEAM_NEWS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wotb-hediye-radar/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const list = json?.appnews?.newsitems;
    if (!Array.isArray(list)) return [];

    return list
      .filter((item) => item?.gid && item?.title)
      .map((item) => {
        const title = cleanText(item.title, 180);
        const rawContents = String(item.contents ?? '');
        const summary = cleanText(rawContents, 360);
        return {
          id: `steam:${item.gid}`,
          source: 'Steam Haberleri',
          title,
          summary,
          url: String(item.url || 'https://steamcommunity.com/app/444200/allnews/'),
          category: String(item.feedlabel || 'Steam'),
          publishedAt: Number(item.date || 0) * 1000,
          codes: extractBonusCodes(`${title}\n${cleanText(rawContents, 0)}`)
        };
      });
  } catch (err) {
    console.warn(`⚠️ Steam News API alınamadı: ${err.message}`);
    return [];
  }
}

/**
 * WoT Blitz resmi YouTube RSS akışından son videoları çeker.
 */
async function fetchYouTubeRss() {
  try {
    const res = await fetch(YT_RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wotb-hediye-radar/1.0)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xml = await res.text();
    const videos = [];

    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const block = match[1];
      const videoId = cleanText(extractXmlTag(block, 'yt:videoId'), 64);
      const title = cleanText(extractXmlTag(block, 'title'), 180);
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      const url = linkMatch ? linkMatch[1] : `https://www.youtube.com/watch?v=${videoId}`;
      const rawDesc = extractXmlTag(block, 'media:description');
      const summary = cleanText(rawDesc, 340);
      const publishedRaw = cleanText(extractXmlTag(block, 'published'), 80);
      const publishedAt = publishedRaw ? Date.parse(publishedRaw) || 0 : 0;

      if (!videoId || !title) continue;

      const combined = `${title}\n${cleanText(rawDesc, 0)}`;
      const codes = extractBonusCodes(combined);
      const isRewardOrUpdate = codes.length > 0 || YT_REWARD_FILTER_RE.test(combined);

      videos.push({
        id: `yt:${videoId}`,
        source: 'Resmi YouTube',
        title,
        summary,
        url,
        publishedAt,
        codes,
        isRewardOrUpdate
      });
    }

    return videos;
  } catch (err) {
    console.warn(`⚠️ YouTube RSS alınamadı: ${err.message}`);
    return [];
  }
}

/**
 * Tüm resmi WoT Blitz kaynaklarını paralel çeker ve başlık bazlı tekilleştirme uygular.
 * @returns {Promise<{ officialItems: Array, youtubeVideos: Array }>}
 */
export async function fetchOfficialSources() {
  const [wgItems, steamItems, youtubeVideos] = await Promise.all([
    fetchWargamingRss(),
    fetchSteamNews(),
    fetchYouTubeRss()
  ]);

  const seenTitleKeys = new Set();
  const officialItems = [];

  for (const item of [...wgItems, ...steamItems]) {
    const key = normalizeTitleKey(item.title);
    if (key && seenTitleKeys.has(key)) {
      continue;
    }
    if (key) seenTitleKeys.add(key);
    officialItems.push(item);
  }

  officialItems.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  youtubeVideos.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  return { officialItems, youtubeVideos };
}
