import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyRedditPost } from './detectors.mjs';
import { fetchOfficialSources } from './sources/official.mjs';
import { fetchRedditPosts } from './sources/reddit.mjs';
import {
  loadEncryptedSubscribers,
  processBotUpdates,
  saveEncryptedSubscribers
} from './subscribers.mjs';
import {
  broadcastTelegramPayload,
  buildDailyReminderMessage,
  buildOfficialNewsMessage,
  buildRewardAlertMessage,
  buildWeeklyWebOfferMessage,
  buildWelcomeMessage,
  parseChatIds
} from './telegram.mjs';
import { translateToTurkish } from './translate.mjs';
import { cleanText, getIstanbulTimeParts, normalizeTitleKey } from './utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const STATE_PATH = path.join(ROOT_DIR, 'state', 'seen.json');
const SUBSCRIBERS_PATH = path.join(ROOT_DIR, 'state', 'subscribers.enc');
const MAX_SEEN = 400;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const DEFAULT_STATE = {
  initialized: false,
  lastUpdateId: 0,
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
      lastUpdateId: Number(parsed.lastUpdateId || 0),
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
    lastUpdateId: Number(state.lastUpdateId || 0),
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

async function deliverOrPreview({ dryRun, token, targets, subscribersSet, payload, label }) {
  if (dryRun) {
    console.log(`\n=== [DRY-RUN ÖNİZLEME: ${label}] ===`);
    if (payload.imageUrl) console.log(`Görsel: ${payload.imageUrl}`);
    console.log(payload.html);
    if (payload.buttons?.length) {
      console.log('Butonlar:', JSON.stringify(payload.buttons));
    }
    return false;
  }

  const { deadChatIds } = await broadcastTelegramPayload({ token, targets, payload });
  let removed = false;
  for (const deadId of deadChatIds) {
    if (subscribersSet.delete(deadId)) {
      removed = true;
    }
  }
  await sleep(600);
  return removed;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const testTelegram = process.argv.includes('--test-telegram') || process.env.SEND_TEST_CARDS === 'true';
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const envChatIds = parseChatIds(process.env.TELEGRAM_CHAT_ID || '');
  const channelId = String(process.env.TELEGRAM_CHANNEL_ID || '').trim();
  const channelUsername = String(process.env.CHANNEL_USERNAME || 'blitzradartr').trim();
  const botUsername = String(process.env.BOT_USERNAME || 'blitzradartr_bot').trim();

  if (!dryRun && !token) {
    console.log('ℹ️ TELEGRAM_BOT_TOKEN henüz ayarlanmadı. Kurulum tamamlanınca ilk bildirim gönderilecek.');
    process.exit(0);
  }

  const state = await loadState();
  const originalSnapshot = JSON.stringify(state);
  const loadedSubscribers = token ? await loadEncryptedSubscribers(SUBSCRIBERS_PATH, token) : [];
  const subscribersSet = new Set([...envChatIds, ...loadedSubscribers]);
  let subscribersDirty = false;

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

  if (!dryRun && token) {
    const updateSummary = await processBotUpdates({
      token,
      state,
      subscribersSet,
      recentNews: officialItems,
      channelUsername,
      botUsername
    });
    if (updateSummary.subscribersChanged) {
      subscribersDirty = true;
    }
    if (updateSummary.processedCount > 0) {
      console.log(`🤖 ${updateSummary.processedCount} yeni bot komutu/etkileşimi işlendi. Aktif abone: ${subscribersSet.size}`);
    }
  }

  const targets = [...new Set([channelId, ...subscribersSet].filter(Boolean))];
  if (!dryRun && targets.length === 0) {
    console.log('ℹ️ Henüz bildirim hedefi yok (kanal veya /start yapan abone bekleniyor).');
    if (JSON.stringify(state) !== originalSnapshot) {
      await saveState(state);
    }
    process.exit(0);
  }

  if (testTelegram) {
    console.log(`🧪 Canlı test modu aktif (${targets.length} hedef): 3 test kartı gönderiliyor...`);

    const sampleOfficial = officialItems[0] || {
      source: 'Wargaming EU',
      title: 'World of Tanks Blitz Official News Check',
      summary: 'Live feed connection verified from GitHub Actions.',
      url: 'https://eu.wotblitz.com/en/news/',
      imageUrl: '',
      codes: []
    };
    const [trNewsTitle, trNewsSummary] = await Promise.all([
      translateToTurkish(sampleOfficial.title),
      translateToTurkish(sampleOfficial.summary)
    ]);
    const newsCard = buildOfficialNewsMessage({
      source: sampleOfficial.source,
      trTitle: trNewsTitle,
      trSummary: trNewsSummary,
      url: sampleOfficial.url,
      imageUrl: sampleOfficial.imageUrl || '',
      codes: sampleOfficial.codes || [],
      channelUsername,
      botUsername
    });
    await deliverOrPreview({
      dryRun,
      token,
      targets,
      subscribersSet,
      payload: {
        ...newsCard,
        html: `🧪 <i>[CANLI SİSTEM TESTİ 1/3 — Görselli Resmi Haber &amp; Türkçe Çeviri]</i>\n\n${newsCard.html}`
      },
      label: 'CANLI TEST 1/3'
    });

    const simPost = {
      title: 'Stream bonus code: BLITZTEST2026 — claim free container!',
      selftext: 'Tap the code above to test one-click copy and check the EU redeem button below.',
      flair: 'News'
    };
    const simResult = classifyRedditPost(simPost);
    const [trSimTitle, trSimSummary] = await Promise.all([
      translateToTurkish(simPost.title),
      translateToTurkish(cleanText(simPost.selftext, 340))
    ]);
    const rewardCard = buildRewardAlertMessage({
      type: simResult?.type || 'BONUS_CODE',
      codes: simResult?.codes || ['BLITZTEST2026'],
      trTitle: trSimTitle,
      trSummary: trSimSummary,
      url: 'https://eu.wargaming.net/shop/redeem/',
      sourceLabel: 'Sistem Testi Simülasyonu',
      channelUsername,
      botUsername
    });
    await deliverOrPreview({
      dryRun,
      token,
      targets,
      subscribersSet,
      payload: {
        ...rewardCard,
        html: `🧪 <i>[CANLI SİSTEM TESTİ 2/3 — Örnek Kod Simülasyonu (test kodudur)]</i>\n\n${rewardCard.html}`
      },
      label: 'CANLI TEST 2/3'
    });

    const dailyCard = buildDailyReminderMessage({ channelUsername, botUsername });
    await deliverOrPreview({
      dryRun,
      token,
      targets,
      subscribersSet,
      payload: {
        ...dailyCard,
        html: `🧪 <i>[CANLI SİSTEM TESTİ 3/3 — Akşam 19:00 Günlük Hatırlatıcı Önizlemesi]</i>\n\n${dailyCard.html}`
      },
      label: 'CANLI TEST 3/3'
    });

    if (subscribersDirty && !dryRun && token) {
      await saveEncryptedSubscribers(SUBSCRIBERS_PATH, [...subscribersSet], token);
    }
    if (!dryRun && JSON.stringify(state) !== originalSnapshot) {
      await saveState(state);
    }
    console.log('✅ Canlı test kartları tamamlandı (seen.json geçmişi değiştirilmedi).');
    return;
  }

  const seenOfficialSet = new Set(state.seenOfficial);
  const seenYoutubeSet = new Set(state.seenYoutube);
  const seenRedditSet = new Set(state.seenReddit);
  const seenCodesSet = new Set(state.seenCodes);

  const trackAndDeliver = async (payload, label) => {
    const removed = await deliverOrPreview({ dryRun, token, targets, subscribersSet, payload, label });
    if (removed) subscribersDirty = true;
  };

  if (!state.initialized) {
    console.log('🚀 İlk kurulum tespit edildi: Hoş Geldin kartı hazırlanıyor ve geçmiş kayıtlar işaretleniyor...');

    const top3 = officialItems.slice(0, 3);
    const translatedTop3 = await Promise.all(
      top3.map(async (item) => ({
        ...item,
        trTitle: await translateToTurkish(item.title)
      }))
    );

    await trackAndDeliver(
      buildWelcomeMessage(translatedTop3, { channelUsername, botUsername }),
      'HOŞ GELDİN KARTI'
    );

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
          await trackAndDeliver(
            buildRewardAlertMessage({
              type: classification.type,
              codes: freshCodes,
              trTitle,
              trSummary,
              url: post.url,
              sourceLabel: 'r/WorldOfTanksBlitz (Son 48 Saat)',
              channelUsername,
              botUsername
            }),
            `AKTİF ÖDÜL (${post.id})`
          );
          for (const c of freshCodes) seenCodesSet.add(c);
        }
      }
      seenRedditSet.add(post.id);
    }

    for (const item of officialItems) {
      seenOfficialSet.add(item.id);
      const tk = normalizeTitleKey(item.title);
      if (tk) seenOfficialSet.add(`title:${tk}`);
      for (const c of item.codes) seenCodesSet.add(c);
    }
    for (const video of youtubeVideos) {
      seenYoutubeSet.add(video.id);
      for (const c of video.codes) seenCodesSet.add(c);
    }

    state.initialized = true;
    state.lastDailyReminderDate = trTime.dateStr;
  } else {
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
          await trackAndDeliver(
            buildRewardAlertMessage({
              type: classification.type,
              codes: freshCodes,
              trTitle,
              trSummary,
              url: post.url,
              sourceLabel: 'r/WorldOfTanksBlitz',
              channelUsername,
              botUsername
            }),
            `REDDIT ${classification.type} (${post.id})`
          );
          for (const c of freshCodes) seenCodesSet.add(c);
        }
      }
      seenRedditSet.add(post.id);
    }

    const newOfficial = officialItems
      .filter((item) => {
        if (seenOfficialSet.has(item.id)) return false;
        const tk = normalizeTitleKey(item.title);
        if (tk && seenOfficialSet.has(`title:${tk}`)) {
          seenOfficialSet.add(item.id);
          return false;
        }
        return true;
      })
      .reverse();

    for (const item of newOfficial) {
      const freshCodes = item.codes.filter((c) => !seenCodesSet.has(c));
      const [trTitle, trSummary] = await Promise.all([
        translateToTurkish(item.title),
        translateToTurkish(item.summary)
      ]);
      await trackAndDeliver(
        buildOfficialNewsMessage({
          source: item.source,
          trTitle,
          trSummary,
          url: item.url,
          imageUrl: item.imageUrl || '',
          codes: freshCodes,
          channelUsername,
          botUsername
        }),
        `RESMİ HABER (${item.id})`
      );
      for (const c of freshCodes) seenCodesSet.add(c);
      seenOfficialSet.add(item.id);
      const tk = normalizeTitleKey(item.title);
      if (tk) seenOfficialSet.add(`title:${tk}`);
    }

    const newVideos = youtubeVideos.filter((v) => !seenYoutubeSet.has(v.id)).reverse();
    for (const video of newVideos) {
      const freshCodes = video.codes.filter((c) => !seenCodesSet.has(c));
      if (video.isRewardOrUpdate || freshCodes.length > 0) {
        const [trTitle, trSummary] = await Promise.all([
          translateToTurkish(video.title),
          translateToTurkish(video.summary)
        ]);
        await trackAndDeliver(
          buildOfficialNewsMessage({
            source: video.source,
            trTitle,
            trSummary,
            url: video.url,
            imageUrl: video.imageUrl || '',
            codes: freshCodes,
            channelUsername,
            botUsername
          }),
          `YOUTUBE (${video.id})`
        );
        for (const c of freshCodes) seenCodesSet.add(c);
      }
      seenYoutubeSet.add(video.id);
    }

    if (trTime.hour >= 19 && trTime.hour <= 22 && state.lastDailyReminderDate !== trTime.dateStr) {
      await trackAndDeliver(
        buildDailyReminderMessage({ channelUsername, botUsername }),
        'GÜNLÜK HATIRLATMA'
      );
      state.lastDailyReminderDate = trTime.dateStr;
    }

    if (trTime.weekday === 'Fri' && trTime.hour >= 18 && state.lastWeeklyWebOfferWeek !== trTime.isoWeekKey) {
      await trackAndDeliver(
        buildWeeklyWebOfferMessage({ channelUsername, botUsername }),
        'HAFTALIK WEB MAĞAZA'
      );
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

  if (subscribersDirty || loadedSubscribers.length === 0) {
    await saveEncryptedSubscribers(SUBSCRIBERS_PATH, [...subscribersSet], token);
    console.log(`🔐 Şifreli abone listesi güncellendi (toplam abone: ${subscribersSet.size}).`);
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
