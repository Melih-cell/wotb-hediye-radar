import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRedditPost } from './detectors.mjs';
import { fetchOfficialSources } from './sources/official.mjs';
import { fetchRedditPosts } from './sources/reddit.mjs';
import { translateToTurkish } from './translate.mjs';
import { cleanText, getIstanbulTimeParts } from './utils.mjs';
import {
  buildDailyReminderMessage,
  buildOfficialNewsMessage,
  buildRewardAlertMessage,
  buildWeeklyWebOfferMessage,
  buildWelcomeMessage,
  parseChatIds,
  sendTelegramMessage
} from './telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT_DIR, 'state', 'seen.json');
const MAX_SEEN = 400;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const DEFAULT_STATE = {
  initialized: false,
  seenOfficial: [],
  seenReddit: [],
  seenYoutube: [],
  seenCodes: [],
  lastDailyReminderDate: '',
  lastWeeklyWebOfferWeek: ''
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      initialized: Boolean(parsed.initialized),
      seenOfficial: Array.isArray(parsed.seenOfficial) ? parsed.seenOfficial : [],
      seenReddit: Array.isArray(parsed.seenReddit) ? parsed.seenReddit : [],
      seenYoutube: Array.isArray(parsed.seenYoutube) ? parsed.seenYoutube : [],
      seenCodes: Array.isArray(parsed.seenCodes) ? parsed.seenCodes : [],
      lastDailyReminderDate: String(parsed.lastDailyReminderDate || ''),
      lastWeeklyWebOfferWeek: String(parsed.lastWeeklyWebOfferWeek || '')
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function trimList(arr) {
  return [...new Set(arr)].slice(-MAX_SEEN);
}

async function saveState(state) {
  const next = {
    initialized: Boolean(state.initialized),
    seenOfficial: trimList(state.seenOfficial),
    seenReddit: trimList(state.seenReddit),
    seenYoutube: trimList(state.seenYoutube),
    seenCodes: trimList(state.seenCodes),
    lastDailyReminderDate: state.lastDailyReminderDate,
    lastWeeklyWebOfferWeek: state.lastWeeklyWebOfferWeek
  };
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function deliverOrPreview({ dryRun, token, chatIds, payload, label }) {
  if (dryRun) {
    console.log(`\n=== [DRY-RUN ÖNİZLEME: ${label}] ===`);
    console.log(payload.html);
    if (payload.buttons?.length) {
      console.log('Butonlar:', JSON.stringify(payload.buttons));
    }
    return;
  }
  await sendTelegramMessage({
    token,
    chatIds,
    html: payload.html,
    buttons: payload.buttons
  });
  await sleep(800);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatIds = parseChatIds(process.env.TELEGRAM_CHAT_ID || '');

  if (!dryRun && (!token || chatIds.length === 0)) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID henüz ayarlanmadı. Kurulum tamamlanınca ilk bildirim gönderilecek.');
    process.exit(0);
  }

  const state = await loadState();
  const originalSnapshot = JSON.stringify(state);
  const now = Date.now();
  const trTime = getIstanbulTimeParts(new Date(now));

  console.log(`🔎 Kaynaklar taranıyor (TR Zamanı: ${trTime.dateStr} ${String(trTime.hour).padStart(2, '0')}:xx, ${trTime.weekday}, ${trTime.isoWeekKey})...`);

  const [officialResult, redditResult] = await Promise.allSettled([
    fetchOfficialSources(),
    fetchRedditPosts()
  ]);

  const officialItems = officialResult.status === 'fulfilled' ? officialResult.value.officialItems : [];
  const youtubeVideos = officialResult.status === 'fulfilled' ? officialResult.value.youtubeVideos : [];
  const redditPosts = redditResult.status === 'fulfilled' ? redditResult.value : [];

  console.log(`📊 Bulunan kayıtlar -> Resmi Haber: ${officialItems.length}, YouTube: ${youtubeVideos.length}, Reddit: ${redditPosts.length}`);

  const seenOfficialSet = new Set(state.seenOfficial);
  const seenYoutubeSet = new Set(state.seenYoutube);
  const seenRedditSet = new Set(state.seenReddit);
  const seenCodesSet = new Set(state.seenCodes);

  if (!state.initialized) {
    console.log('🚀 İlk kurulum tespit edildi: Hoş Geldin kartı hazırlanıyor ve geçmiş kayıtlar işaretleniyor...');

    const top2 = officialItems.slice(0, 2);
    const translatedTop2 = await Promise.all(
      top2.map(async (item) => ({
        ...item,
        trTitle: await translateToTurkish(item.title)
      }))
    );

    await deliverOrPreview({
      dryRun,
      token,
      chatIds,
      payload: buildWelcomeMessage(translatedTop2),
      label: 'HOŞ GELDİN KARTI'
    });

    // Son 48 saat içinde aktif kod / ücretsiz paket varsa ilk kurulumda da kaçırmadan bildir
    for (const post of redditPosts) {
      const classification = classifyRedditPost(post);
      const isRecent = !post.createdAt || now - post.createdAt <= FORTY_EIGHT_HOURS_MS;
      if (
        classification &&
        (classification.type === 'BONUS_CODE' || classification.type === 'FREE_GIFT') &&
        isRecent
      ) {
        const freshCodes = classification.codes.filter((c) => !seenCodesSet.has(c));
        if (classification.type === 'FREE_GIFT' || freshCodes.length > 0) {
          const [trTitle, trSummary] = await Promise.all([
            translateToTurkish(post.title),
            translateToTurkish(cleanText(post.selftext, 340))
          ]);
          await deliverOrPreview({
            dryRun,
            token,
            chatIds,
            payload: buildRewardAlertMessage({
              type: classification.type,
              codes: freshCodes,
              trTitle,
              trSummary,
              url: post.url,
              sourceLabel: 'r/WorldOfTanksBlitz (Son 48 Saat)'
            }),
            label: `AKTİF ÖDÜL (${post.id})`
          });
          for (const c of freshCodes) seenCodesSet.add(c);
        }
      }
      seenRedditSet.add(post.id);
    }

    for (const item of officialItems) {
      seenOfficialSet.add(item.id);
      for (const c of item.codes) seenCodesSet.add(c);
    }
    for (const video of youtubeVideos) {
      seenYoutubeSet.add(video.id);
      for (const c of video.codes) seenCodesSet.add(c);
    }

    state.initialized = true;
    state.lastDailyReminderDate = trTime.dateStr;
  } else {
    // 1. Yeni Reddit bonus kod & ücretsiz paket taraması (en eskiden yeniye)
    const newReddit = redditPosts.filter((p) => !seenRedditSet.has(p.id)).reverse();
    for (const post of newReddit) {
      const classification = classifyRedditPost(post);
      if (classification) {
        const freshCodes = classification.codes.filter((c) => !seenCodesSet.has(c));
        if (classification.type !== 'BONUS_CODE' || freshCodes.length > 0) {
          const [trTitle, trSummary] = await Promise.all([
            translateToTurkish(post.title),
            translateToTurkish(cleanText(post.selftext, 340))
          ]);
          await deliverOrPreview({
            dryRun,
            token,
            chatIds,
            payload: buildRewardAlertMessage({
              type: classification.type,
              codes: freshCodes,
              trTitle,
              trSummary,
              url: post.url,
              sourceLabel: 'r/WorldOfTanksBlitz'
            }),
            label: `REDDIT ${classification.type} (${post.id})`
          });
          for (const c of freshCodes) seenCodesSet.add(c);
        }
      }
      seenRedditSet.add(post.id);
    }

    // 2. Yeni resmi Wargaming / Steam haberleri
    const newOfficial = officialItems.filter((item) => !seenOfficialSet.has(item.id)).reverse();
    for (const item of newOfficial) {
      const freshCodes = item.codes.filter((c) => !seenCodesSet.has(c));
      const [trTitle, trSummary] = await Promise.all([
        translateToTurkish(item.title),
        translateToTurkish(item.summary)
      ]);
      await deliverOrPreview({
        dryRun,
        token,
        chatIds,
        payload: buildOfficialNewsMessage({
          source: item.source,
          trTitle,
          trSummary,
          url: item.url,
          codes: freshCodes
        }),
        label: `RESMİ HABER (${item.id})`
      });
      for (const c of freshCodes) seenCodesSet.add(c);
      seenOfficialSet.add(item.id);
    }

    // 3. Yeni YouTube ödül/etkinlik videoları
    const newVideos = youtubeVideos.filter((v) => !seenYoutubeSet.has(v.id)).reverse();
    for (const video of newVideos) {
      const freshCodes = video.codes.filter((c) => !seenCodesSet.has(c));
      if (video.isRewardOrUpdate || freshCodes.length > 0) {
        const [trTitle, trSummary] = await Promise.all([
          translateToTurkish(video.title),
          translateToTurkish(video.summary)
        ]);
        await deliverOrPreview({
          dryRun,
          token,
          chatIds,
          payload: buildOfficialNewsMessage({
            source: video.source,
            trTitle,
            trSummary,
            url: video.url,
            codes: freshCodes
          }),
          label: `YOUTUBE (${video.id})`
        });
        for (const c of freshCodes) seenCodesSet.add(c);
      }
      seenYoutubeSet.add(video.id);
    }

    // 4. Günlük sandık & reklam hatırlatıcısı (19:00 - 22:59 TR saati arası günde 1 kez)
    if (trTime.hour >= 19 && trTime.hour <= 22 && state.lastDailyReminderDate !== trTime.dateStr) {
      await deliverOrPreview({
        dryRun,
        token,
        chatIds,
        payload: buildDailyReminderMessage(),
        label: 'GÜNLÜK HATIRLATMA'
      });
      state.lastDailyReminderDate = trTime.dateStr;
    }

    // 5. Haftalık Wargaming Web Mağaza hatırlatıcısı (Cuma 18:00+ TR saati)
    if (trTime.weekday === 'Fri' && trTime.hour >= 18 && state.lastWeeklyWebOfferWeek !== trTime.isoWeekKey) {
      await deliverOrPreview({
        dryRun,
        token,
        chatIds,
        payload: buildWeeklyWebOfferMessage(),
        label: 'HAFTALIK WEB MAĞAZA'
      });
      state.lastWeeklyWebOfferWeek = trTime.isoWeekKey;
    }
  }

  state.seenOfficial = trimList([...seenOfficialSet]);
  state.seenYoutube = trimList([...seenYoutubeSet]);
  state.seenReddit = trimList([...seenRedditSet]);
  state.seenCodes = trimList([...seenCodesSet]);

  if (dryRun) {
    console.log('\n✅ Dry-run tamamlandı (state/seen.json değiştirilmedi).');
    return;
  }

  if (JSON.stringify(state) !== originalSnapshot) {
    await saveState(state);
    console.log('💾 state/seen.json güncellendi.');
  } else {
    console.log('ℹ️ Yeni değişiklik yok.');
  }
}

main().catch((err) => {
  console.error('❌ Radar çalışırken beklenmeyen hata:', err);
  process.exit(1);
});
