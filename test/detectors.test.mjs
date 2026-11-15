import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRedditPost, extractBonusCodes } from '../src/detectors.mjs';
import { cleanText, escapeHtml } from '../src/utils.mjs';

test('gerçek bonus kod postunu yakalar ve kodu çıkarır', () => {
  const result = classifyRedditPost({
    title: 'New bonus code: 12YEARSTOGETHER claim now!',
    selftext: 'Enter on wargaming.net/shop/redeem before it expires.',
    flair: 'News'
  });

  assert.ok(result);
  assert.equal(result.type, 'BONUS_CODE');
  assert.deepEqual(result.codes, ['12YEARSTOGETHER']);
});

test('kod dilenme sorusunu filtreleyip null döndürür', () => {
  const result = classifyRedditPost({
    title: 'Are there any active bonus codes right now?',
    selftext: 'I am a returning player looking for free stuff.',
    flair: 'Question'
  });

  assert.equal(result, null);
});

test('mağaza ücretsiz paket postunu FREE_GIFT olarak sınıflandırır', () => {
  const result = classifyRedditPost({
    title: 'Free bundle in the shop right now!',
    selftext: 'Go claim your free container before reset.',
    flair: ''
  });

  assert.ok(result);
  assert.equal(result.type, 'FREE_GIFT');
  assert.deepEqual(result.codes, []);
});

test('sıradan oyun ve tank sorusu postlarında null döndürür', () => {
  const result = classifyRedditPost({
    title: 'Which tier 10 heavy should I grind next?',
    selftext: 'Thinking about E 100 or IS-7 for WORLD TANKS BLITZ ranked.',
    flair: 'Needs Help'
  });

  const freeXpQuestion = classifyRedditPost({
    title: 'Relic D3',
    selftext: 'Do I have enough free xp for the tier XI tanks?',
    flair: 'Guide'
  });

  assert.equal(result, null);
  assert.equal(freeXpQuestion, null);
  assert.deepEqual(extractBonusCodes('Which tier 10 heavy in WORLD TANKS BLITZ?'), []);
});

test('cleanText ve escapeHtml BBCode/HTML temizler ve özel karakterleri kaçırır', () => {
  const raw = '<![CDATA[[img]{STEAM_CLAN_IMAGE}abc.png[/img] <p>[b]Hello[/b] &amp; &lt;World&gt; "Blitz"!</p>]]>';
  const cleaned = cleanText(raw, 120);
  assert.equal(cleaned, 'Hello & <World> "Blitz"!');
  assert.equal(escapeHtml(cleaned), 'Hello &amp; &lt;World&gt; &quot;Blitz&quot;!');
});
