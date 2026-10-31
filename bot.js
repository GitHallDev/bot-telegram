require('dotenv').config();

const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const path = require('path');
const { downloadVideo } = require('./app.js');

// ───────────── Config ─────────────
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ Variable BOT_TOKEN manquante. Lance : BOT_TOKEN=xxx node bot.js');
  process.exit(1);
}

const PORT = process.env.PORT || 3000; // 👈 Port pour le serveur web / Mini App
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
// Le domaine change souvent : on le rend configurable
const BASE_URL = (process.env.BASE_URL || 'https://anime-sama.to').replace(/\/$/, '');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Referer': BASE_URL + '/',
};
const PAGE_SIZE = 20;
const SESSION_TTL = 30 * 60 * 1000;

const bot = new Telegraf(BOT_TOKEN);
const app = express(); // 👈 Initialisation d'Express

// ───────────── Configuration Express (Mini App) ─────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
app.use(express.json());

// Lancer le serveur Express
app.listen(PORT, () => {
  console.log(`🌐 Serveur web et Mini App lancés sur le port ${PORT}`);
});

// ───────────── Sessions (par chat) ─────────────
const sessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.ts > SESSION_TTL) sessions.delete(id);
}, 5 * 60 * 1000).unref();

function getSession(ctx) {
  const s = sessions.get(ctx.chat.id);
  if (!s) {
    ctx.answerCbQuery('⚠️ Session expirée, relance une recherche.', { show_alert: true }).catch(() => {});
    return null;
  }
  s.ts = Date.now();
  return s;
}

// ───────────── Utilitaires ─────────────
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeEntities = (s) =>
  s.replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function fetchText(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

async function safeEdit(ctx, text, extra = {}) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
  } catch (e) {
    const msg = String(e.description || e.message);
    if (!msg.includes('message is not modified')) throw e;
  }
}

// ───────────── Scraping ─────────────
async function searchAnime(query) {
  const html = await fetchText(`${BASE_URL}/template-php/defaut/fetch.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `query=${encodeURIComponent(query)}`,
  });
  const results = [];
  const regex = /<a href="([^"]+)" class="asn-search-result">[\s\S]*?title">([^<]+)<\/h3>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    results.push({ url: new URL(m[1], BASE_URL).href, title: decodeEntities(m[2]) });
  }
  return results;
}

async function getSeasons(animeUrl) {
  let html = await fetchText(animeUrl);
  // Retire les commentaires JS pour ignorer les saisons désactivées
  html = html
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  const seasons = [];
  const seen = new Set();
  const regex = /panneauAnime\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const [, name, url] = m;
    if (name === 'nom' || url === 'url' || seen.has(url)) continue;
    seen.add(url);
    seasons.push({ name: decodeEntities(name), url });
  }
  return seasons;
}

function buildSeasonBase(animeUrl, season, lang) {
  const base = animeUrl.endsWith('/') ? animeUrl : animeUrl + '/';
  let u = new URL(season.url, base).href;
  if (!u.endsWith('/')) u += '/';
  u = u.replace(/\/(vostfr|vf)\/$/i, '/'); // retire la langue d'origine
  return u + lang + '/';
}

async function getEpisodes(animeUrl, season, lang) {
  const code = await fetchText(buildSeasonBase(animeUrl, season, lang) + 'episodes.js');
  const providers = [];
  const arrayRegex = /var\s+eps(\d+)\s*=\s*\[([\s\S]*?)\]\s*;/g;
  let m;
  while ((m = arrayRegex.exec(code)) !== null) {
    const links = [...m[2].matchAll(/["'](https?:\/\/[^"']+)["']/g)].map((x) => x[1]);
    if (links.length) providers.push({ id: m[1], links });
  }
  const count = providers.reduce((max, p) => Math.max(max, p.links.length), 0);
  return { providers, count };
}

const STATUS_FR = {
  FINISHED: 'Terminé',
  RELEASING: 'En cours de diffusion',
  NOT_YET_RELEASED: 'Pas encore sorti',
  CANCELLED: 'Annulé',
  HIATUS: 'En pause',
};

async function getAnimeDetails(title) {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        title { romaji english }
        format status episodes duration seasonYear averageScore genres
        studios(isMain: true) { nodes { name } }
        coverImage { large }
        description(asHtml: false)
        siteUrl
        nextAiringEpisode { episode airingAt }
      }
    }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { search: title } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  return json.data?.Media || null;
}

function formatDetails(m) {
  const name = m.title.english || m.title.romaji;
  const studio = m.studios?.nodes?.[0]?.name;
  const synopsis = (m.description || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const lines = [`<b>${esc(name)}</b>`];
  if (m.title.romaji && m.title.romaji !== name) lines.push(`<i>${esc(m.title.romaji)}</i>`);
  lines.push('');
  if (m.averageScore) lines.push(`⭐ Note : ${m.averageScore}/100`);
  if (m.status) lines.push(`📡 Statut : ${STATUS_FR[m.status] || m.status}`);
  if (m.episodes) lines.push(`🎞 Épisodes : ${m.episodes}${m.duration ? ` (~${m.duration} min)` : ''}`);
  if (m.seasonYear) lines.push(`📅 Année : ${m.seasonYear}`);
  if (studio) lines.push(`🏢 Studio : ${esc(studio)}`);
  if (m.genres?.length) lines.push(`🏷 Genres : ${esc(m.genres.join(', '))}`);
  if (m.nextAiringEpisode) {
    const d = new Date(m.nextAiringEpisode.airingAt * 1000).toLocaleDateString('fr-FR');
    lines.push(`⏭ Épisode ${m.nextAiringEpisode.episode} prévu le ${d}`);
  }
  if (synopsis) {
    const short = synopsis.length > 350 ? synopsis.slice(0, 350).trimEnd() + '…' : synopsis;
    lines.push('', esc(short));
  }
  if (m.siteUrl) lines.push('', `<a href="${esc(m.siteUrl)}">Fiche AniList</a>`);
  return lines.join('\n');
}

// ───────────── Rendu des écrans ─────────────
function seasonsKeyboard(seasons) {
  const buttons = seasons.map((s, i) => Markup.button.callback(s.name, `s:${i}`));
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback('ℹ️ Détails', 'd')]);
  return Markup.inlineKeyboard(rows);
}

function episodesKeyboard(s) {
  const total = s.episodes.count;
  const pages = Math.ceil(total / PAGE_SIZE);
  const start = s.page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);

  const nums = [];
  for (let n = start; n <= end; n++) nums.push(Markup.button.callback(String(n), `e:${n}`));
  const rows = chunk(nums, 5);

  const nav = [];
  if (s.page > 0) nav.push(Markup.button.callback('⬅️', `p:${s.page - 1}`));
  if (s.page < pages - 1) nav.push(Markup.button.callback('➡️', `p:${s.page + 1}`));
  if (nav.length) rows.push(nav);

  const other = s.lang === 'vostfr' ? 'vf' : 'vostfr';
  rows.push([
    Markup.button.callback(`🌐 Passer en ${other.toUpperCase()}`, `l:${other}`),
    Markup.button.callback('📂 Saisons', 'back'),
    Markup.button.callback('ℹ Détails', 'd')
  ]);
  return Markup.inlineKeyboard(rows);
}

async function showEpisodes(ctx, s) {
  await safeEdit(ctx, `⏳ Chargement de <b>${esc(s.season.name)}</b> (${s.lang.toUpperCase()})...`);
  try {
    s.episodes = await getEpisodes(s.anime.url, s.season, s.lang);
  } catch (e) {
    console.error(e.message);
    s.episodes = null;
    const other = s.lang === 'vostfr' ? 'vf' : 'vostfr';
    return safeEdit(
      ctx,
      `❌ Impossible de charger les épisodes en ${s.lang.toUpperCase()}.\nCette version n'existe peut-être pas.`,
      Markup.inlineKeyboard([[
        Markup.button.callback(`🌐 Essayer ${other.toUpperCase()}`, `l:${other}`),
        Markup.button.callback('📂 Saisons', 'back'),
      ]])
    );
  }

  if (s.episodes.count === 0) {
    return safeEdit(ctx, '❌ Aucun épisode disponible pour cette saison.', Markup.inlineKeyboard([
      [Markup.button.callback('📂 Saisons', 'back')],
    ]));
  }

  const pages = Math.ceil(s.episodes.count / PAGE_SIZE);
  await safeEdit(
    ctx,
    `📺 <b>${esc(s.anime.title)}</b>\n${esc(s.season.name)} · ${s.lang.toUpperCase()} · ${s.episodes.count} épisode(s)` +
      (pages > 1 ? ` · page ${s.page + 1}/${pages}` : '') +
      `\n\nChoisis un épisode :`,
    episodesKeyboard(s)
  );
}

// ───────────── Commandes ─────────────
bot.start((ctx) =>
  ctx.reply('👋 Envoie-moi le nom d\'un anime (ou utilise <code>/search naruto</code>).', { parse_mode: 'HTML' })
);

async function handleSearch(ctx, query) {
  if (!query) return ctx.reply('⚠️ Indique un titre. Exemple : /search One Piece');

  const wait = await ctx.reply(`🔍 Recherche de "${query}"...`);
  let results;
  try {
    results = await searchAnime(query);
  } catch (e) {
    console.error(e.message);
    return ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, '❌ Le site ne répond pas (ou le domaine a changé).');
  }
  if (!results.length) {
    return ctx.telegram.editMessageText(ctx.chat.id, wait.message_id, undefined, '❌ Aucun anime trouvé.');
  }

  sessions.set(ctx.chat.id, { ts: Date.now(), results, lang: 'vostfr', page: 0 });

  const buttons = results.slice(0, 8).map((a, i) => [Markup.button.callback(a.title, `a:${i}`)]);
  await ctx.telegram.editMessageText(
    ctx.chat.id, wait.message_id, undefined,
    '🎬 <b>Sélectionne un anime :</b>',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
  );
}

bot.command('search', (ctx) => handleSearch(ctx, ctx.message.text.replace(/^\/search(@\w+)?/i, '').trim()));

// Tout texte libre (hors commande) = recherche
bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  return handleSearch(ctx, ctx.message.text.trim());
});

// ───────────── Actions (boutons) ─────────────
bot.action(/^a:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s) return;
  const anime = s.results[Number(ctx.match[1])];
  if (!anime) return;

  await safeEdit(ctx, `📂 Chargement des saisons de <b>${esc(anime.title)}</b>...`);
  try {
    s.seasons = await getSeasons(anime.url);
  } catch (e) {
    console.error(e.message);
    return safeEdit(ctx, '❌ Erreur lors du chargement de la page de l\'anime.');
  }
  if (!s.seasons.length) return safeEdit(ctx, '❌ Aucune saison trouvée pour cet anime.');

  s.anime = anime;
  await safeEdit(ctx, `📺 <b>${esc(anime.title)}</b>\nChoisis une saison :`, seasonsKeyboard(s.seasons));
});

bot.action(/^s:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.seasons) return;
  s.season = s.seasons[Number(ctx.match[1])];
  if (!s.season) return;
  s.page = 0;
  await showEpisodes(ctx, s);
});

bot.action(/^l:(vostfr|vf)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.season) return;
  s.lang = ctx.match[1];
  s.page = 0;
  await showEpisodes(ctx, s);
});

bot.action(/^p:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.episodes) return;
  s.page = Number(ctx.match[1]);
  await showEpisodes(ctx, s);
});

bot.action('back', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.seasons) return;
  await safeEdit(ctx, `📺 <b>${esc(s.anime.title)}</b>\nChoisis une saison :`, seasonsKeyboard(s.seasons));
});

bot.action(/^e:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.episodes) return;

  const n = Number(ctx.match[1]);
  
  // On s'assure qu'il y a bien des liens pour cet épisode
  const hasLinks = s.episodes.providers.some(p => p.links[n - 1]);
  if (!hasLinks) return ctx.reply(`❌ Aucun lecteur disponible pour l'épisode ${n}.`);

  // URL de la Mini App avec les paramètres nécessaires pour retrouver les vrais liens de cet épisode
  const webAppUrl = `${SERVER_URL}/index.html?animeUrl=${encodeURIComponent(s.anime.url)}&seasonUrl=${encodeURIComponent(s.season.url)}&season=${encodeURIComponent(s.season.name)}&ep=${n}&lang=${s.lang}&animeTitle=${encodeURIComponent(s.anime.title)}`;

  await ctx.reply(
    `🎬 <b>${esc(s.anime.title)}</b>\n${esc(s.season.name)} · Épisode ${n} · ${s.lang.toUpperCase()}\n\nClique ci-dessous pour regarder ou télécharger l'épisode :`,
    { 
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('📺 Ouvrir le lecteur / Mini App', webAppUrl)],
        [Markup.button.callback('📂 Retour aux épisodes', `s:${s.seasons.indexOf(s.season)}`)]
      ])
    }
  );
});

bot.action('d', async (ctx) => {
  await ctx.answerCbQuery('🔎 Recherche des infos...').catch(() => {});
  const s = getSession(ctx);
  if (!s || !s.anime) return;

  let media;
  try {
    media = await getAnimeDetails(s.anime.title);
  } catch (e) {
    console.error(e.message);
    return ctx.reply('❌ Impossible de contacter AniList pour le moment.');
  }
  if (!media) return ctx.reply('❌ Aucune fiche trouvée pour cet anime.');

  const caption = formatDetails(media);
  const cover = media.coverImage?.large;

  // Une légende de photo est limitée à 1024 caractères
  if (cover && caption.length <= 1024) {
    return ctx.replyWithPhoto(cover, { caption, parse_mode: 'HTML' });
  }
  if (cover) await ctx.replyWithPhoto(cover).catch(() => {});
  await ctx.reply(caption, { parse_mode: 'HTML', disable_web_page_preview: true });
});

// ───────────── Routes ─────────────

// API endpoint pour que la Mini App récupère les liens en temps réel
app.get('/api/episodes', async (req, res) => {
  const { animeUrl, seasonUrl, seasonName, ep, lang, animeTitle } = req.query;
  const episodeNum = Number(ep);

  if (!animeUrl || !seasonUrl) {
    return res.status(400).json({
      success: false,
      error: 'Paramètres manquants: animeUrl et seasonUrl requis.'
    });
  }

  try {
    const season = { name: String(seasonName || 'Saison'), url: String(seasonUrl) };
    const data = await getEpisodes(String(animeUrl), season, String(lang || 'vostfr'));

    const links = (data.providers || [])
      .map((provider) => {
        const url = provider.links?.[episodeNum - 1];
        if (!url) return null;
        return {
          host: `Lecteur ${provider.id || 'N/A'}`,
          url,
        };
      })
      .filter(Boolean);

    return res.json({
      success: true,
      animeTitle: animeTitle || 'Anime',
      seasonName: season.name,
      episode: episodeNum,
      lang: String(lang || 'vostfr'),
      links,
    });
  } catch (error) {
    console.error('Erreur /api/episodes:', error.message);
    return res.status(500).json({ success: false, error: 'Erreur lors de la récupération des liens.' });
  }
});


app.post('/api/download', async (req, res) => {
  const { url, filename, quality, format } = req.body || {};

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL manquante.' });
  }

  const safeFilename = String(filename || 'anime-download.mp4')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();

  const outputPath = path.join(__dirname, 'downloads', safeFilename || 'anime-download.mp4');

  try {
    await downloadVideo(String(url), outputPath, String(quality || 'best'), String(format || 'mp4'));
    return res.json({
      success: true,
      filename: safeFilename,
      downloadUrl: `/downloads/${encodeURIComponent(safeFilename)}`,
    });
  } catch (error) {
    console.error('Erreur /api/download:', error.message);
    return res.status(500).json({ success: false, error: 'Impossible de télécharger la vidéo.' });
  }
});

// Route pour estimer la taille de la vidéo en fonction de la qualité et du format
app.get('/api/video-size', async (req, res) => {
  const { url, quality, format } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'URL manquante' });

    // On pointe explicitement vers le binaire yt-dlp téléchargé à la racine du projet
    const ytDlpPath = path.join(__dirname, 'yt-dlp');
  
  // Construction du format selon les critères choisis
  let formatArg = '';
  if (quality === '360') {
    formatArg = `-f "bestvideo[height<=360][ext=${format}]+bestaudio/best[height<=360] / best[height<=360]"`;
  } else if (quality === '720') {
    formatArg = `-f "bestvideo[height<=720][ext=${format}]+bestaudio/best[height<=720] / best[height<=720]"`;
  } else if (quality === '1080') {
    formatArg = `-f "bestvideo[height<=1080][ext=${format}]+bestaudio/best[height<=1080] / best[height<=1080]"`;
  } else {
    formatArg = `-f "bv*[ext=${format}]+ba/b[ext=${format}] / b"`;
  }

  // Commande yt-dlp pour simuler et afficher la taille du fichier (--print filesize)
  const command = `"${ytDlpPath}" ${formatArg} --print filesize "${url}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      return res.json({ success: true, size: 'Inconnue' });
    }

    const bytes = parseInt(stdout.trim(), 10);
    if (isNaN(bytes) || bytes <= 0) {
      return res.json({ success: true, size: 'Estimation indisponible' });
    }

    // Convertir les octets en Mo ou Go de manière propre
    const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
    const formattedSize = sizeMb > 1024 ? (sizeMb / 1024).toFixed(2) + ' Go' : sizeMb + ' Mo';

    res.json({ success: true, size: formattedSize });
  });
});

// ───────────── Lancement ─────────────
bot.catch((err, ctx) => console.error(`Erreur [${ctx.updateType}] :`, err));

bot.launch();
console.log('🤖 Bot Telegram démarré !');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));