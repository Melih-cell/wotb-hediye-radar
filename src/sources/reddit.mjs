import { cleanText, decodeEntities, extractXmlTag } from '../utils.mjs';

const REDDIT_RSS_URL = 'https://www.reddit.com/r/WorldOfTanksBlitz/new/.rss?limit=25';
const ARCTIC_SHIFT_URL = 'https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=WorldOfTanksBlitz&limit=25&sort=desc';
const REDDIT_UA = 'nodejs:wotb-hediye-radar:v1.0.0 (by /u/Melih_cell)';

function normalizeRedditId(rawId) {
  const s = String(rawId ?? '').trim();
  if (!s) return '';
  if (s.startsWith('t3_')) return s.slice(3);
  const urlMatch = s.match(/\/comments\/([a-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];
  return s;
}

async function fetchRedditAtom() {
  try {
    const res = await fetch(REDDIT_RSS_URL, {
      headers: { 'User-Agent': REDDIT_UA },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xml = await res.text();
    const posts = [];

    for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
      const block = match[1];
      const rawId = cleanText(extractXmlTag(block, 'id'), 120);
      const id = normalizeRedditId(rawId);
      const title = cleanText(extractXmlTag(block, 'title'), 220);
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      const url = linkMatch ? decodeEntities(linkMatch[1]) : `https://www.reddit.com/r/WorldOfTanksBlitz/comments/${id}/`;
      const rawContent = extractXmlTag(block, 'content');
      const selftext = cleanText(rawContent, 0);
      const updatedRaw = cleanText(extractXmlTag(block, 'updated'), 80);
      const createdAt = updatedRaw ? Date.parse(updatedRaw) || 0 : 0;

      if (!id || !title) continue;
      posts.push({
        id,
        title,
        selftext,
        flair: '',
        url,
        createdAt
      });
    }

    return posts;
  } catch (err) {
    console.warn(`⚠️ Reddit Atom RSS alınamadı (yedek kaynak devrede): ${err.message}`);
    return [];
  }
}

async function fetchArcticShift() {
  try {
    const res = await fetch(ARCTIC_SHIFT_URL, {
      headers: { 'User-Agent': REDDIT_UA },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const data = json?.data;
    if (!Array.isArray(data)) return [];

    return data
      .filter((p) => p?.id && p?.title)
      .map((p) => ({
        id: normalizeRedditId(p.id),
        title: cleanText(p.title, 220),
        selftext: cleanText(p.selftext || '', 0),
        flair: cleanText(p.link_flair_text || '', 60),
        url: p.permalink
          ? `https://www.reddit.com${p.permalink}`
          : `https://www.reddit.com/r/WorldOfTanksBlitz/comments/${normalizeRedditId(p.id)}/`,
        createdAt: Number(p.created_utc || 0) * 1000
      }));
  } catch (err) {
    console.warn(`⚠️ ArcticShift Reddit yedeği alınamadı: ${err.message}`);
    return [];
  }
}

/**
 * r/WorldOfTanksBlitz gönderilerini birincil RSS ve ArcticShift yedeğinden birleştirerek çeker.
 * @returns {Promise<Array<{ id: string, title: string, selftext: string, flair: string, url: string, createdAt: number }>>}
 */
export async function fetchRedditPosts() {
  const [rssPosts, arcticPosts] = await Promise.all([
    fetchRedditAtom(),
    fetchArcticShift()
  ]);

  const byId = new Map();

  for (const post of rssPosts) {
    byId.set(post.id, post);
  }

  // ArcticShift flair ve ham selftext bilgisini zenginleştirir / RSS bloklandığında yedek sağlar
  for (const post of arcticPosts) {
    const existing = byId.get(post.id);
    if (!existing) {
      byId.set(post.id, post);
    } else {
      byId.set(post.id, {
        ...existing,
        flair: post.flair || existing.flair,
        selftext: existing.selftext.length >= post.selftext.length ? existing.selftext : post.selftext,
        createdAt: existing.createdAt || post.createdAt
      });
    }
  }

  return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
