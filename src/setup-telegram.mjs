import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const args = argv.slice(2);
  let token = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';
  let repo = '';

  for (let i = 0; i < args.length; i++) {
    const cur = args[i];
    if (cur === '--token' && args[i + 1]) {
      token = args[++i];
    } else if (cur === '--chat-id' && args[i + 1]) {
      chatId = args[++i];
    } else if (cur === '--repo' && args[i + 1]) {
      repo = args[++i];
    } else if (!cur.startsWith('--') && !token) {
      token = cur;
    } else if (!cur.startsWith('--') && !chatId) {
      chatId = cur;
    }
  }

  return { token: token.trim(), chatId: chatId.trim(), repo: repo.trim() };
}

async function tgApi(token, method) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    signal: AbortSignal.timeout(12000)
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(`Telegram ${method} başarısız: ${data?.description || res.status}`);
  }
  return data.result;
}

function extractChats(updates) {
  const map = new Map();
  for (const upd of updates) {
    const chat =
      upd?.message?.chat ||
      upd?.channel_post?.chat ||
      upd?.my_chat_member?.chat ||
      upd?.edited_message?.chat;
    if (chat?.id !== undefined) {
      const id = String(chat.id);
      const label = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || id;
      map.set(id, { id, type: chat.type, label });
    }
  }
  return [...map.values()];
}

function runGh(args, input) {
  return execFileSync('gh', args, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

async function main() {
  const { token, chatId: explicitChatId, repo } = parseArgs(process.argv);
  if (!token) {
    console.error('Kullanım: node src/setup-telegram.mjs <BOT_TOKEN> [CHAT_ID] [--repo Melih-cell/wotb-hediye-radar]');
    process.exit(1);
  }

  const me = await tgApi(token, 'getMe');
  console.log(`🤖 Bot doğrulandı: @${me.username} (${me.first_name})`);

  let selectedChatId = explicitChatId;
  if (!selectedChatId) {
    const updates = await tgApi(token, 'getUpdates?limit=30');
    const chats = extractChats(updates);
    if (chats.length === 0) {
      console.error('⚠️ Henüz bota gelen bir mesaj/sohbet bulunamadı.');
      console.error(`Lütfen Telegram'da @${me.username} botunu açıp /start yazın (veya kardeşinle açtığın gruba ekleyip "merhaba" yazın), ardından bu komutu tekrar çalıştırın.`);
      process.exit(1);
    }

    console.log('💬 Bulunan sohbetler:');
    for (const c of chats) {
      console.log(`  - ${c.id} (${c.type}): ${c.label}`);
    }
    const groupChat = chats.find((c) => c.type === 'group' || c.type === 'supergroup' || c.type === 'channel');
    selectedChatId = (groupChat || chats[chats.length - 1]).id;
    console.log(`✅ Seçilen sohbet ID: ${selectedChatId}`);
  }

  const targetRepo = repo || 'Melih-cell/wotb-hediye-radar';
  runGh(['secret', 'set', 'TELEGRAM_BOT_TOKEN', '-R', targetRepo], token);
  runGh(['secret', 'set', 'TELEGRAM_CHAT_ID', '-R', targetRepo], selectedChatId);
  console.log(`🔐 GitHub Secrets güncellendi (${targetRepo}).`);

  runGh(['workflow', 'run', 'radar.yml', '-R', targetRepo]);
  console.log('🚀 radar.yml iş akışı tetiklendi! Birkaç saniye içinde ilk Hoş Geldin mesajı Telegram\'a düşecek.');
}

main().catch((err) => {
  console.error('❌ Kurulum hatası:', err.message);
  process.exit(1);
});
