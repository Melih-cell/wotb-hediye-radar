/**
 * İngilizce metni ücretsiz Google Translate GTX uç noktası üzerinden Türkçeye çevirir.
 * Hata veya zaman aşımı durumunda çökmez, orijinal metni döndürür.
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function translateToTurkish(text) {
  const input = String(text ?? '').trim();
  if (!input) return '';

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=${encodeURIComponent(input)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; wotb-hediye-radar/1.0)'
      },
      signal: AbortSignal.timeout(6000)
    });

    if (!res.ok) {
      return input;
    }

    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return input;
    }

    const translated = data[0]
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('')
      .trim();

    return translated || input;
  } catch {
    return input;
  }
}
