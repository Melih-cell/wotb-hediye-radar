# Blitz Radar TR (`wotb-hediye-radar`) — Proje Hafızası (GEMINI.md)

## Proje Özeti
- **Adı:** Blitz Radar TR (`wotb-hediye-radar`)
- **Amacı:** World of Tanks Blitz için sıfır (%0) ban riskli, GitHub Actions bulutunda her 15 dakikada bir 7/24 çalışan bonus kod, ücretsiz paket ve Türkçe haber radarı.
- **Teknoloji:** Node.js ESM (`.mjs`, sıfır harici npm bağımlılığı), GitHub Actions (`radar.yml`).
- **GitHub Deposu:** `https://github.com/Melih-cell/wotb-hediye-radar`
- **Telegram Topluluk Kanalı:** `@blitzradartr` (`https://t.me/blitzradartr`)
- **Telegram Botu:** `@blitzradartr_bot` (`https://t.me/blitzradartr_bot`)

## Önemli Dosyalar
- `src/index.mjs`: Ana orkestratör, ilk kurulum / normal tarama / `--dry-run` / `--test-telegram` akışları.
- `src/detectors.mjs`: Bonus kod ayıklama (`extractBonusCodes`) ve Reddit ödül/kod/dilenme filtresi (`classifyRedditPost`).
- `src/sources/official.mjs`: Wargaming EU RSS, Steam News API (`appid=444200`) ve resmi YouTube RSS çekici (kapak görselli).
- `src/sources/reddit.mjs`: `r/WorldOfTanksBlitz` RSS + ArcticShift çift yedekli tarayıcı.
- `src/telegram.mjs`: Görselli (`sendPhoto` + metin fallback) ve hata toleranslı yayın kartları.
- `src/subscribers.mjs`: Çoklu abone komut işleyicisi ve `AES-256-GCM` şifreli `state/subscribers.enc` yönetimi.
- `src/configure-brand.mjs`: Bot profili, komut menüsü, kanal açıklaması ve `assets/avatar.png` yükleme aracı.
- `.github/workflows/radar.yml`: 15 dakikalık cron iş akışı ve `workflow_dispatch` canlı test parametresi.
- `state/seen.json` & `state/subscribers.enc`: Görülen kayıtlar ve şifreli abone listesi.

## Temel Komutlar
- Birim testleri: `npm test`
- Yerel kuru önizleme (dosya değiştirmez): `npm run dry-run`
- Bulutta manuel tetikleme: `gh workflow run radar.yml -R Melih-cell/wotb-hediye-radar`
- Buluttan 3 canlı test kartı gönderme: `gh workflow run radar.yml -R Melih-cell/wotb-hediye-radar -f send_test_cards=true`

## Çalışma Kuralları
- **Güvenlik & Gizlilik:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ve `TELEGRAM_CHANNEL_ID` değerlerini yalnızca GitHub Secrets veya ortam değişkeni olarak tut; kod veya repoya açık yazma. Abone ID'leri daima `state/subscribers.enc` içinde `AES-256-GCM` şifreli saklanır.
- Yanıtları ve açıklamaları Türkçe ver.
