# 🛡️ WoT Blitz Hediye, Kod ve Haber Radarı

World of Tanks Blitz için **sıfır (%0) ban riskli**, oyun istemcisine veya belleğine dokunmayan, **GitHub Actions üzerinde 7/24 ücretsiz çalışan** ve **Telegram'a butonlu Türkçe bildirim gönderen** takip sistemi.

## Neleri Takip Eder?
1. **🚨 Anlık Bonus / Promosyon Kodları:** `r/WorldOfTanksBlitz` (RSS + ArcticShift yedekli), resmi Wargaming EU duyuruları, Steam haberleri ve resmi YouTube açıklamalarından yakalanan kodları tek dokunuşla kopyalanabilir (`<code>KOD</code>`) formatta atar; altındaki **`🎁 Kodu Aktif Et (EU)`** butonu doğrudan resmi aktivasyon sayfasını açar.
2. **🎁 Mağaza Ücretsiz Paketleri (Free Bundles) & Yayın Ödülleri:** Süreli ücretsiz sandıklar, Twitch Drops / Portal Stream ödülleri için anında alarm gönderir.
3. **📰 Resmi Türkçe Haber Özeti:** Wargaming EU Portal, Steam News (`AppID 444200`) ve resmi YouTube kanalından yeni etkinlik ve güncellemeleri Türkçeye çevirip özetler.
4. **⏰ Günlük & Haftalık Hatırlatıcılar:**
   - **Her akşam (19:00–22:59 TR):** Oyun içi günlük sandık ve mobil altın reklamları hatırlatması.
   - **Her Cuma (18:00+ TR):** Çoğu oyuncunun unuttuğu [Wargaming Web Mağazası (Offers)](https://eu.wargaming.net/shop/wotb/offers/) haftalık ücretsiz paket hatırlatması.

## Hızlı Telegram Kurulumu (30 Saniye)
1. Telegram'da **`@BotFather`** açın -> `/newbot` yazın -> botunuza bir isim ve `_bot` ile biten bir kullanıcı adı verin -> çıkan **Bot Token**'ı kopyalayın.
2. Kardeşinizle ortak bir Telegram grubu açıp bu botu gruba ekleyin (veya botun sohbetine girip `/start` yazın).
   - *İpucu:* Grupta iki kişi de bildirim alsın istiyorsanız grup açıp botu eklemek en pratiğidir; grupta `"merhaba"` yazmanız yeterlidir.
3. Token'ı bağlamak için:
   ```bash
   node src/setup-telegram.mjs "<BOT_TOKEN>"
   ```
   *(Alternatif olarak GitHub Repo -> **Settings -> Secrets and variables -> Actions** altından `TELEGRAM_BOT_TOKEN` ve `TELEGRAM_CHAT_ID` ekleyip Actions sekmesinden **WoT Blitz Hediye Radarı -> Run workflow** düğmesine basabilirsiniz.)*
