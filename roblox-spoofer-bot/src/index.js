import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, AttachmentBuilder, ChannelType } from 'discord.js';
import {
  detectKind, downloadWithFallback, uploadAsset, getAssetName, introspectApiKey, keyOwnerFromJwt,
} from './roblox.js';
import { setUserKey, getUserKey, deleteUserKey } from './store.js';

const PREFIX = process.env.PREFIX || '.';
const MAX_IDS = Number(process.env.MAX_IDS_PER_COMMAND) || 25;
const BOT_KEY = process.env.BOT_ROBLOX_API_KEY || '';
const MAX_FILE_MB = 20;
// Kosong = semua channel. Isi ID channel (pisah koma) supaya bot cuma jawab di situ (+ DM).
const ALLOWED_CHANNELS = (process.env.ALLOWED_CHANNEL_IDS || '').split(/[\s,]+/).filter(Boolean);
// Urutan download tanpa key user: key bot (kalau diisi) → publik tanpa key
// Bentuk API key Roblox Open Cloud: string base64 panjang (ratusan karakter)
const API_KEY_RE = /^[A-Za-z0-9+/=_-]{200,}$/;
const BOT_DOWNLOAD_KEYS = [
  { key: BOT_KEY, label: 'key bot' },
  { public: true, label: 'publik' },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // wajib supaya bisa terima DM
});

// ---------------------------------------------------------------- helper

/** Ambil semua ID dari teks: angka polos, rbxassetid://123, link roblox.com/library/123, dll */
function parseIds(text) {
  const ids = [...String(text).matchAll(/\d{5,}/g)].map((m) => m[0]);
  return [...new Set(ids)];
}

function parseType(args) {
  const a = args.map((x) => x.toLowerCase());
  if (a.some((x) => ['anim', 'animasi', 'animation'].includes(x))) return 'animation';
  if (a.some((x) => ['audio', 'lagu', 'sound', 'music'].includes(x))) return 'audio';
  return 'auto';
}

/** Jalankan tugas dengan batas paralel */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function mappingLua(results) {
  const ok = results.filter((r) => r.newId);
  return [
    '-- Hasil spoof: [ID lama] = ID baru',
    'return {',
    ...ok.map((r) => `\t[${r.oldId}] = ${r.newId}, -- ${r.kind}${r.name ? ' | ' + r.name.replace(/[\r\n]/g, ' ') : ''}`),
    '}',
    '',
  ].join('\n');
}

/** Script command bar Studio: ganti semua AnimationId / SoundId lama ke yang baru */
function replaceScript(results) {
  const ok = results.filter((r) => r.newId);
  return [
    '-- Paste di Command Bar Roblox Studio (View > Command Bar), lalu Enter',
    'local map = {',
    ...ok.map((r) => `\t["${r.oldId}"] = "${r.newId}",`),
    '}',
    'local n = 0',
    'local function fix(v)',
    '\tlocal id = v and v:match("%d+")',
    '\treturn id and map[id] and ("rbxassetid://" .. map[id]) or nil',
    'end',
    'for _, inst in ipairs(game:GetDescendants()) do',
    '\tpcall(function()',
    '\t\tif inst:IsA("Animation") then',
    '\t\t\tlocal new = fix(inst.AnimationId); if new then inst.AnimationId = new; n += 1 end',
    '\t\telseif inst:IsA("Sound") then',
    '\t\t\tlocal new = fix(inst.SoundId); if new then inst.SoundId = new; n += 1 end',
    '\t\tend',
    '\tend)',
    'end',
    'print("[Spoofer] Diganti:", n)',
    '',
  ].join('\n');
}

const HELP = [
  '**🎬 Roblox Spoofer Bot**',
  '',
  `\`${PREFIX}spoff <id id id...> [anim|audio]\` — spoof animasi/lagu dari ID → upload ulang ke akun/grup kamu. **Wajib API key kamu.**`,
  `\`${PREFIX}spoff\` + lampirkan file \`.rbxm/.rbxmx/.ogg/.mp3\` — upload file langsung ke akun kamu.`,
  `\`${PREFIX}rbxm <id id id...>\` — download jadi file \`.rbxm\` (animasi) / \`.ogg/.mp3\` (lagu). **Tanpa API key.**`,
  `\`${PREFIX}setkey <apikey>\` — simpan API key (**kirim lewat DM ke bot**). ID Roblox dibaca otomatis dari key. Bisa juga cukup *paste key-nya aja* di DM.`,
  `\`${PREFIX}setkey <apikey> group <groupId>\` — kalau hasil upload mau masuk ke grup.`,
  `\`${PREFIX}delkey\` — hapus API key kamu.`,
  '',
  '**Permission API key** (create.roblox.com → Open Cloud → API Keys):',
  '• `Assets` → Read + Write',
  '• `Legacy Assets` → `legacy-asset:manage`',
  '• Accepted IP: isi IP VPS bot (atau `0.0.0.0/0`)',
  '',
  `Maks ${MAX_IDS} ID per command. Animasi hasil upload pakai \`.rbxm\` → import ke Studio, klik kanan → *Save to Roblox* kalau mau manual.`,
].join('\n');

// ---------------------------------------------------------------- command: setkey / delkey

async function cmdSetKey(msg, args) {
  const isDM = msg.channel.type === ChannelType.DM;
  if (!isDM) {
    // Jangan biarkan API key nongol di channel publik
    await msg.delete().catch(() => {});
    return msg.channel.send(`⚠️ ${msg.author}, **jangan kirim API key di server!** Pesan kamu sudah dihapus. Kirim \`${PREFIX}setkey\` lewat **DM** ke bot. Sebaiknya *regenerate* API key itu di Creator Dashboard.`);
  }

  // Urutan bebas: key = argumen panjang, "user"/"group" = tipe, angka = ID
  const apiKey = args.find((a) => API_KEY_RE.test(a));
  const typeArg = args.map((a) => a.toLowerCase()).find((a) => a === 'user' || a === 'group');
  const idArg = args.find((a) => /^\d+$/.test(a));
  if (!apiKey) {
    return msg.reply([
      '🔑 **Cara simpan API key:** paste key-nya aja di sini (DM), atau ketik:',
      `\`${PREFIX}setkey <apikey>\``,
      'ID Roblox kamu dibaca otomatis dari key-nya.',
      `Mau masuk ke grup? \`${PREFIX}setkey <apikey> group <groupId>\``,
    ].join('\n'));
  }

  const cek = await introspectApiKey(apiKey);
  if (!cek.ok && cek.status >= 400 && cek.status < 500) {
    return msg.reply(`❌ API key ditolak Roblox (HTTP ${cek.status}): ${String(cek.message).slice(0, 200)}\nPastikan key-nya ke-copy **utuh** (tidak kepotong) lalu kirim ulang.`);
  }
  if (cek.ok && (!cek.enabled || cek.expired)) {
    return msg.reply('❌ API key ini sudah **nonaktif / kedaluwarsa**. Aktifkan lagi atau buat key baru di Creator Dashboard.');
  }

  const creatorType = typeArg || 'user';
  const creatorId = idArg || (creatorType === 'user' ? (cek.userId || keyOwnerFromJwt(apiKey)) : null);
  if (!creatorId) {
    return msg.reply(creatorType === 'group'
      ? `Untuk grup, tulis ID grupnya: \`${PREFIX}setkey <apikey> group <groupId>\``
      : `Tidak bisa baca ID Roblox dari key ini. Tulis manual: \`${PREFIX}setkey <apikey> user <userId>\``);
  }

  setUserKey(msg.author.id, { apiKey, creatorType, creatorId });

  const lines = [`✅ API key tersimpan (terenkripsi). Asset hasil spoof akan masuk ke **${creatorType} ${creatorId}**.`];
  if (cek.ok) {
    const kurang = ['asset:read', 'asset:write', 'legacy-asset:manage'].filter((s) => !cek.scopes.includes(s));
    lines.push(kurang.length
      ? `⚠️ Permission kurang: ${kurang.map((s) => `\`${s}\``).join(', ')} — tambahkan di Creator Dashboard biar spoof lancar.`
      : '🟢 Permission lengkap (Assets read/write + Legacy Assets manage).');
  } else {
    lines.push('⚠️ Key belum bisa dicek ke Roblox sekarang (jaringan), tapi sudah disimpan.');
  }
  lines.push(`Sekarang coba \`${PREFIX}spoff <id>\` di channel spoofer.`);
  return msg.reply(lines.join('\n'));
}

async function cmdDelKey(msg) {
  const had = deleteUserKey(msg.author.id);
  return msg.reply(had ? '🗑️ API key kamu sudah dihapus.' : 'Kamu belum menyimpan API key.');
}

// ---------------------------------------------------------------- command: rbxm (tanpa API key user)

async function cmdRbxm(msg, args) {
  const ids = parseIds(args.join(' ')).slice(0, MAX_IDS);
  if (!ids.length) return msg.reply(`Format: \`${PREFIX}rbxm <id id id...>\``);

  const status = await msg.reply(`⏳ Download ${ids.length} asset...`);
  const results = await pool(ids, 3, async (id) => {
    try {
      const { buf } = await downloadWithFallback(id, BOT_DOWNLOAD_KEYS);
      const k = detectKind(buf);
      const name = (await getAssetName(id)) || id;
      const safe = name.replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || id;
      return { id, ok: true, kind: k.kind, file: new AttachmentBuilder(buf, { name: `${safe}_${id}.${k.ext}` }), size: buf.length };
    } catch (e) {
      return { id, ok: false, err: e.message };
    }
  });

  const files = results.filter((r) => r.ok && r.size <= 25 * 1024 * 1024).map((r) => r.file);
  const lines = results.map((r) =>
    r.ok ? `✅ \`${r.id}\` → ${r.kind === 'animation' ? 'animasi (.rbxm)' : r.kind}` : `❌ \`${r.id}\` — ${r.err.slice(0, 150)}`);

  // Discord maks 10 file per pesan
  await status.edit({ content: lines.join('\n').slice(0, 1900) + '\n\n📥 Import `.rbxm` di Studio: klik kanan Workspace → *Insert from File*.', files: files.slice(0, 10) });
  for (let i = 10; i < files.length; i += 10) await msg.channel.send({ files: files.slice(i, i + 10) });
}

// ---------------------------------------------------------------- command: spoff (pakai API key user)

async function cmdSpoff(msg, args) {
  const user = getUserKey(msg.author.id);
  if (!user) {
    return msg.reply(`❌ Kamu belum set API key. DM bot: \`${PREFIX}setkey <apikey> <user|group> <id>\`\nKetik \`${PREFIX}help\` untuk detail permission.\nMau tanpa API key? Pakai \`${PREFIX}rbxm <id>\`.`);
  }
  const forcedType = parseType(args);
  const ids = parseIds(args.join(' ')).slice(0, MAX_IDS);
  const attachments = [...msg.attachments.values()].filter((a) => /\.(rbxmx?|ogg|mp3|wav|flac)$/i.test(a.name));
  if (!ids.length && !attachments.length) {
    return msg.reply(`Format: \`${PREFIX}spoff <id id id...> [anim|audio]\` atau lampirkan file .rbxm/.ogg/.mp3`);
  }

  const creator = user.creatorType === 'group' ? { groupId: user.creatorId } : { userId: user.creatorId };
  const jobs = [
    ...ids.map((id) => ({ src: 'id', id })),
    ...attachments.map((a) => ({ src: 'file', att: a })),
  ];

  const status = await msg.reply(`⏳ Spoofing ${jobs.length} asset ke **${user.creatorType} ${user.creatorId}**...`);
  let done = 0;
  const tick = () => status.edit(`⏳ Spoofing... ${done}/${jobs.length}`).catch(() => {});

  const results = await pool(jobs, 2, async (job) => {
    const label = job.src === 'id' ? job.id : job.att.name;
    try {
      let buf, name;
      if (job.src === 'id') {
        // Coba key user dulu, kalau gagal fallback ke key bot (biar "no gagal")
        ({ buf } = await downloadWithFallback(job.id, [
          { key: user.apiKey, label: 'key kamu' },
          ...BOT_DOWNLOAD_KEYS,
        ]));
        name = (await getAssetName(job.id)) || `Spoof ${job.id}`;
      } else {
        if (job.att.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`File > ${MAX_FILE_MB} MB`);
        const r = await fetch(job.att.url);
        buf = Buffer.from(await r.arrayBuffer());
        name = job.att.name.replace(/\.[^.]+$/, '');
      }

      const k = detectKind(buf);
      let kind = k.kind;
      if (forcedType !== 'auto') {
        if (kind !== 'unknown' && kind !== forcedType) throw new Error(`Ini ${kind}, bukan ${forcedType}`);
        kind = forcedType;
      }
      if (kind === 'unknown') throw new Error('Format file tidak dikenali (bukan animasi/audio)');

      const newId = await uploadAsset({
        apiKey: user.apiKey, creator, kind, buf, mime: k.mime, ext: k.ext, name,
        description: job.src === 'id' ? `Spoofed from ${job.id}` : 'Uploaded via spoofer bot',
      });
      return { oldId: job.src === 'id' ? job.id : job.att.name, newId, kind, name };
    } catch (e) {
      return { oldId: label, err: e.message };
    } finally {
      done++;
      if (jobs.length > 1) tick();
    }
  });

  const ok = results.filter((r) => r.newId);
  const lines = results.map((r) =>
    r.newId
      ? `✅ \`${r.oldId}\` → \`${r.newId}\` (${r.kind === 'animation' ? '🎬' : '🎵'} ${r.name})`
      : `❌ \`${r.oldId}\` — ${r.err.slice(0, 200)}`);

  const files = [];
  if (ok.length) {
    files.push(new AttachmentBuilder(Buffer.from(mappingLua(results)), { name: 'mapping.lua' }));
    files.push(new AttachmentBuilder(Buffer.from(replaceScript(results)), { name: 'replace_ids_commandbar.lua' }));
  }
  const header = `**Selesai: ${ok.length}/${results.length} berhasil**`;
  const body = lines.join('\n');
  await status.edit({
    content: (header + '\n' + body).slice(0, 1990),
    files,
  });
  if ((header + body).length > 1990) {
    await msg.channel.send({ files: [new AttachmentBuilder(Buffer.from(lines.join('\n')), { name: 'hasil.txt' })] });
  }
}

// ---------------------------------------------------------------- router

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // Di DM: kalau isinya cuma API key (tanpa .setkey), langsung simpan
  if (!msg.content.startsWith(PREFIX)) {
    const isi = msg.content.trim();
    if (msg.channel.type === ChannelType.DM && API_KEY_RE.test(isi.split(/\s+/)[0] || '')) {
      try { return await cmdSetKey(msg, isi.split(/\s+/)); } catch (e) {
        console.error('[setkey-auto]', e);
        return msg.reply(`❌ Error: ${String(e.message).slice(0, 300)}`).catch(() => {});
      }
    }
    return;
  }
  const [cmdRaw, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();

  // Batasi channel (DM selalu boleh). .setkey tetap diproses di mana pun supaya API key-nya dihapus.
  if (ALLOWED_CHANNELS.length && cmd !== 'setkey' && msg.channel.type !== ChannelType.DM
      && !ALLOWED_CHANNELS.includes(msg.channelId) && !ALLOWED_CHANNELS.includes(msg.channel.parentId)) return;

  try {
    switch (cmd) {
      case 'spoff':
      case 'spoof':
        return await cmdSpoff(msg, args);
      case 'rbxm':
        return await cmdRbxm(msg, args);
      case 'setkey':
        return await cmdSetKey(msg, args);
      case 'delkey':
        return await cmdDelKey(msg);
      case 'help':
      case 'bantuan':
        return await msg.reply(HELP);
      default:
        return;
    }
  } catch (e) {
    console.error(`[${cmd}]`, e);
    msg.reply(`❌ Error: ${String(e.message).slice(0, 300)}`).catch(() => {});
  }
});

client.once('ready', (c) => console.log(`✅ Login sebagai ${c.user.tag} | prefix "${PREFIX}"`));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

client.login(process.env.DISCORD_TOKEN);
