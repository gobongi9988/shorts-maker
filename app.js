/* ============================================================
   쇼츠 메이커 — 9:16 세로 영상 편집기
   이미지 · 자막 · 목소리 · BGM을 브라우저 안에서 합쳐
   MP4/WEBM 영상으로 내려받는 단일 페이지 앱.
   ============================================================ */
(() => {
'use strict';

/* ------------------------------------------------------------
   0. 유틸
   ------------------------------------------------------------ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = (p = 'm') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = n => String(n).padStart(2, '0');

function formatTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  return `${m}:${pad2(Math.floor(s % 60))}`;
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;

let toastTimer = null;
function toast(msg, kind = '') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ------------------------------------------------------------
   1. 상수 · 샘플 프로젝트
   ------------------------------------------------------------ */
const DESIGN_W = 1080;
const DESIGN_H = 1920;
const PREVIEW_W = 720;
const PREVIEW_H = 1280;
const MINI_W = 144;
const MINI_H = 256;
const FONT_STACK = "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', system-ui, sans-serif";
const LS_KEY = 'shorts-maker:project:v1';
const DB_NAME = 'shorts-maker-media';
const DEFAULT_STYLE = { fontSize: 56, position: 'bottom', bg: 'dark', weight: 800 };
const DEFAULT_OPTIONS = { kenBurns: true, resolution: '1080x1920', bgmVolume: 0.18, voiceVolume: 1 };
const STYLE_WEIGHTS = [400, 600, 700, 800, 900];
const WEIGHT_LABEL = { 400: '보통', 600: '굵게', 700: '더 굵게', 800: '아주 굵게', 900: '최대' };

const SAMPLE_CUTS = [
  {
    text: '10억짜리 다이아를\n현장에서 통째로 삼킨 도둑,\n과연 들켰을까요?',
    duration: 4
  },
  {
    text: '미국 플로리다의 한 남자,\n유명 프로 선수 에이전트로 속이고\n명품 주얼리 매장에서\n10억 상당 다이아 귀걸이를\n훔쳐 도망갑니다.',
    duration: 11
  },
  {
    text: '고속도로에서 경찰에 포위되자,\n증거를 없애려고 귀걸이 4개를\n그대로 꿀꺽 삼켜버리는데요.',
    duration: 10
  },
  {
    text: '완벽한 범죄인 줄 알았지만\n병원 X-ray에 그대로 찍혀버렸고,\n경찰은 귀걸이가 나올 때까지\n무려 2주를 기다려 전부 회수했습니다.',
    duration: 10
  },
  {
    text: '결국 귀걸이는 깨끗이 세척돼\n매장으로 돌아갔고,\n도둑은 유죄 판결을 받았습니다.\n여러분은 저 세척된 귀걸이,\n살 수 있나요?',
    duration: 5
  }
];

function newCut(partial = {}) {
  return {
    id: uid('cut'),
    text: '',
    duration: 3,
    autoFit: true,
    image: null,
    audio: null,
    style: null,
    ...partial
  };
}

function isMobileView() {
  return window.matchMedia('(max-width: 980px)').matches;
}

function sampleProject() {
  return {
    name: '쇼츠 1편 · 10억 다이아를 삼킨 도둑',
    style: { ...DEFAULT_STYLE },
    options: { ...DEFAULT_OPTIONS, resolution: isMobileView() ? '720x1280' : '1080x1920' },
    tts: { voiceURI: '', rate: 1, pitch: 1 },
    bgm: null,
    cuts: SAMPLE_CUTS.map((c, i) => newCut({
      text: c.text,
      duration: c.duration,
      image: { src: `assets/sample-01/cut${i + 1}.png`, name: `cut${i + 1}.png` }
    }))
  };
}

function blankProject() {
  return {
    name: '내 쇼츠',
    style: { ...DEFAULT_STYLE },
    options: { ...DEFAULT_OPTIONS, resolution: isMobileView() ? '720x1280' : '1080x1920' },
    tts: { voiceURI: '', rate: 1, pitch: 1 },
    bgm: null,
    cuts: [newCut({ duration: 3 })]
  };
}

/* ------------------------------------------------------------
   2. 상태
   ------------------------------------------------------------ */
let project = null;
let currentTime = 0;
let playing = false;
let playingWallStart = 0;   // performance.now() 기준
let playingFrom = 0;        // 재생 시작 시점의 타임라인 위치
let playRaf = 0;
let miniVisible = false;
let miniDismissed = false;

let saveTimer = null;
let gcTimer = null;
let toastMissingShown = false;

/* ------------------------------------------------------------
   3. IndexedDB 미디어 저장소
   ------------------------------------------------------------ */
let dbPromise = null;
const blobCache = new Map();   // key -> Blob
const urlCache = new Map();    // key -> objectURL
const imgCache = new Map();    // url -> {img, ok, promise}

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function db() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}
async function idbPut(key, blob) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('media', 'readwrite');
    tx.objectStore('media').put(blob, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('media', 'readonly');
    const rq = tx.objectStore('media').get(key);
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbDel(key) {
  try {
    const d = await db();
    await new Promise((resolve, reject) => {
      const tx = d.transaction('media', 'readwrite');
      tx.objectStore('media').delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* 저장소가 없으면 무시 */ }
}
async function idbKeys() {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction('media', 'readonly');
      const rq = tx.objectStore('media').getAllKeys();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    });
  } catch (e) { return []; }
}

function mediaUrl(key) {
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = blobCache.get(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}
function releaseMedia(key) {
  if (!key) return;
  const url = urlCache.get(key);
  if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
  urlCache.delete(key);
  blobCache.delete(key);
  audioBuffers.delete(key);
  idbDel(key);
}
function clearMediaCache() {
  for (const url of urlCache.values()) { try { URL.revokeObjectURL(url); } catch (e) {} }
  urlCache.clear();
  blobCache.clear();
  audioBuffers.clear();
  imgCache.clear();
}

function referencedKeys() {
  const keys = new Set();
  if (!project) return keys;
  for (const cut of project.cuts) {
    if (cut.image && cut.image.key) keys.add(cut.image.key);
    if (cut.audio && cut.audio.key) keys.add(cut.audio.key);
  }
  if (project.bgm && project.bgm.key) keys.add(project.bgm.key);
  return keys;
}

async function hydrateMedia() {
  const keys = referencedKeys();
  let missing = 0;
  for (const key of keys) {
    if (blobCache.has(key)) continue;
    try {
      const blob = await idbGet(key);
      if (blob) blobCache.set(key, blob);
      else missing++;
    } catch (e) { missing++; }
  }
  if (missing > 0 && !toastMissingShown) {
    toastMissingShown = true;
    toast(`이전 작업의 미디어 ${missing}개를 찾지 못했어요. 다시 넣어 주세요.`, 'error');
  }
}

/* ------------------------------------------------------------
   4. 이미지
   ------------------------------------------------------------ */
function imageUrl(cut) {
  if (!cut || !cut.image) return null;
  if (cut.image.src) return cut.image.src;
  if (cut.image.key) return mediaUrl(cut.image.key);
  return null;
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return imgCache.get(url).promise;
  const img = new Image();
  img.decoding = 'async';
  const rec = { img, ok: false, promise: null };
  rec.promise = new Promise(resolve => {
    img.onload = () => {
      rec.ok = img.naturalWidth > 0;
      resolve(rec.ok ? img : null);
    };
    img.onerror = () => { rec.ok = false; resolve(null); };
  });
  img.src = url;
  imgCache.set(url, rec);
  return rec.promise;
}

async function downscaleImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image-decode'));
      im.src = url;
    });
    const maxW = DESIGN_W, maxH = DESIGN_H;
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.92));
    if (!blob) blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) blob = await new Promise(res => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('image-encode');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleImageFile(cut, file) {
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    toast('이미지 파일이 아니에요. JPG · PNG · HEIC 파일을 선택해 주세요.', 'error');
    return;
  }
  toast('이미지를 넣는 중…');
  try {
    const blob = await downscaleImage(file);
    const key = uid('img_');
    await idbPut(key, blob);
    blobCache.set(key, blob);
    urlCache.delete(key);
    if (cut.image && cut.image.key) releaseMedia(cut.image.key);
    cut.image = { key, name: file.name || 'image', mime: blob.type };
    scheduleSave();
    renderCutList();
    toast('이미지를 넣었어요.');
  } catch (e) {
    console.warn('image load failed', e);
    if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      toast('브라우저 저장 공간이 부족해 이미지를 넣지 못했어요. 프로젝트를 정리해 주세요.', 'error');
    } else {
      toast('이 형식은 브라우저에서 열 수 없어요. JPG나 PNG로 바꿔 주세요.', 'error');
    }
  }
}

/* ------------------------------------------------------------
   5. 그림 그리기 (미리보기 · 내보내기 공통)
   ------------------------------------------------------------ */
const canvas = $('#previewCanvas');
const pctx = canvas.getContext('2d');
const miniCanvas = $('#miniCanvas');
const mctx = miniCanvas.getContext('2d');

function styleFor(cut) {
  const base = project.style || DEFAULT_STYLE;
  if (cut && cut.style) return { ...base, ...cut.style };
  return base;
}

function totalDuration() {
  return project.cuts.reduce((sum, c) => sum + Math.max(0.5, Number(c.duration) || 0.5), 0);
}

function locate(t) {
  const cuts = project.cuts;
  if (!cuts.length) return { index: 0, cut: null, local: 0, elapsed: 0 };
  const total = totalDuration();
  const tt = clamp(t, 0, Math.max(0, total - 0.0001));
  let acc = 0;
  for (let i = 0; i < cuts.length; i++) {
    const d = Math.max(0.5, Number(cuts[i].duration) || 0.5);
    if (tt < acc + d || i === cuts.length - 1) {
      return { index: i, cut: cuts[i], local: clamp(tt - acc, 0, d), elapsed: acc };
    }
    acc += d;
  }
  return { index: 0, cut: cuts[0], local: 0, elapsed: 0 };
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawCover(ctx, img, W, H, zoom) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const ir = iw / ih;
  const cr = W / H;
  let dw, dh;
  if (ir > cr) { dh = H; dw = H * ir; }
  else { dw = W; dh = W / ir; }
  dw *= zoom; dh *= zoom;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function drawImagePlaceholder(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#171a21');
  g.addColorStop(1, '#0e1015');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.setLineDash([14 * (W / DESIGN_W), 12 * (W / DESIGN_W)]);
  ctx.lineWidth = Math.max(1, 2 * (W / DESIGN_W));
  roundRect(ctx, W * 0.14, H * 0.3, W * 0.72, H * 0.4, 18 * (W / DESIGN_W));
  ctx.stroke();
  ctx.restore();
  if (W >= 300) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.font = `${Math.round(24 * (W / DESIGN_W))}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('이미지를 넣어 주세요', W / 2, H * 0.5);
    ctx.restore();
  }
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  const paragraphs = String(text || '').split('\n');
  for (const para of paragraphs) {
    if (para.trim() === '') { lines.push(''); continue; }
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) { lines.push(line); line = ''; }
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawSubtitle(ctx, cut, W, H) {
  const text = (cut && cut.text ? cut.text : '').trim();
  if (!text) return;
  const st = styleFor(cut);
  const scale = W / DESIGN_W;
  const fontSize = Math.max(8, st.fontSize * scale);
  const weight = STYLE_WEIGHTS.includes(Number(st.weight)) ? Number(st.weight) : 800;
  const maxWidth = W * 0.88;

  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapText(ctx, text, maxWidth);
  const lh = fontSize * 1.34;
  const blockH = lines.length * lh;
  let top;
  if (st.position === 'top') top = H * 0.085;
  else if (st.position === 'center') top = (H - blockH) / 2;
  else top = H - H * 0.135 - blockH;
  top = clamp(top, H * 0.035, Math.max(H * 0.035, H - blockH - H * 0.035));

  const padX = fontSize * 0.46;
  const padY = fontSize * 0.2;

  // 배경 박스는 줄마다 따로 그리지 않고 한 덩어리로 그려 깔끔하게 유지한다.
  if (st.bg === 'dark' || st.bg === 'light') {
    let maxLineW = 0;
    for (const line of lines) maxLineW = Math.max(maxLineW, ctx.measureText(line || ' ').width);
    const boxW = Math.min(maxLineW + padX * 2, maxWidth + padX * 2);
    const boxH = blockH + padY * 2;
    ctx.fillStyle = st.bg === 'dark' ? 'rgba(8,9,12,0.68)' : 'rgba(255,255,255,0.93)';
    roundRect(ctx, W / 2 - boxW / 2, top - padY, boxW, boxH, fontSize * 0.22);
    ctx.fill();
    ctx.fillStyle = st.bg === 'dark' ? '#ffffff' : '#111318';
  } else {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(0,0,0,.86)';
    ctx.lineWidth = Math.max(2, fontSize * 0.16);
    ctx.fillStyle = '#ffffff';
  }

  lines.forEach((line, i) => {
    const y = top + i * lh + lh / 2;
    if (!line) return;
    if (st.bg === 'dark' || st.bg === 'light') {
      ctx.fillText(line, W / 2, y, maxWidth);
    } else {
      ctx.strokeText(line, W / 2, y, maxWidth);
      ctx.fillText(line, W / 2, y, maxWidth);
    }
  });
  ctx.restore();
}

function drawFrame(t, ctx, W, H) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const cuts = project ? project.cuts : [];
  if (!cuts.length) {
    drawImagePlaceholder(ctx, W, H);
    ctx.restore();
    return;
  }

  const pos = locate(t);
  const cut = pos.cut;
  const url = imageUrl(cut);

  if (url) {
    const rec = imgCache.get(url);
    if (rec && rec.ok) {
      const dur = Math.max(0.5, Number(cut.duration) || 0.5);
      const p = clamp(pos.local / dur, 0, 1);
      let zoom = 1;
      if (project.options.kenBurns) {
        zoom = pos.index % 2 === 0 ? 1.02 + 0.06 * p : 1.08 - 0.06 * p;
      }
      drawCover(ctx, rec.img, W, H, zoom);
    } else {
      drawImagePlaceholder(ctx, W, H);
      // 이미지가 늦게 로드되면 한 번 다시 그린다.
      loadImage(url).then(img => {
        if (img && !playing) drawAll(currentTime);
      });
    }
  } else {
    drawImagePlaceholder(ctx, W, H);
  }

  drawSubtitle(ctx, cut, W, H);
  ctx.restore();
}

function drawAll(t) {
  if (!project) return;
  drawFrame(t, pctx, PREVIEW_W, PREVIEW_H);
  if (miniVisible) drawFrame(t, mctx, MINI_W, MINI_H);
  updateStageBadge(t);
}

function updateStageBadge(t) {
  const badge = $('#stageBadge');
  const n = project.cuts.length;
  if (!n) { badge.textContent = '0 / 0 컷'; return; }
  const pos = locate(t);
  badge.textContent = `${pos.index + 1} / ${n} 컷`;
}

/* ------------------------------------------------------------
   6. 타임라인 · 재생
   ------------------------------------------------------------ */
const btnPlay = $('#btnPlay');
const seekEl = $('#seek');
const curTimeEl = $('#curTime');
const totalTimeEl = $('#totalTime');

function updateTimeUI() {
  curTimeEl.textContent = formatTime(currentTime);
  if (document.activeElement !== seekEl) seekEl.value = String(currentTime);
  updateStageBadge(currentTime);
}
function updatePlayButton() {
  btnPlay.textContent = playing ? '❚❚' : '▶';
  btnPlay.classList.toggle('playing', playing);
  btnPlay.setAttribute('aria-label', playing ? '일시정지' : '재생');
}

function recalcTimeline() {
  const total = totalDuration();
  totalTimeEl.textContent = formatTime(total);
  seekEl.max = String(Math.max(0.1, total));
  currentTime = clamp(currentTime, 0, Math.max(0, total - 0.001));
  $('#cutSummary').textContent = `${project.cuts.length}컷 · ${formatTime(total)}`;
  $('#stageEmpty').classList.toggle('is-hidden', project.cuts.length > 0);
  const mime = detectVideoMime();
  const fmt = mime.includes('mp4') ? 'MP4' : (mime ? 'WEBM' : '지원 안 됨');
  $('#exportNote').textContent =
    `${project.cuts.length}컷 · ${formatTime(total)} · ${fmt} 저장 · 실제 재생 시간만큼 걸려요`;
  if (!playing) drawAll(currentTime);
  updateTimeUI();
}

async function play() {
  if (playing || exporting || !project.cuts.length) return;
  stopTts();
  const total = totalDuration();
  if (currentTime >= total - 0.02) currentTime = 0;

  // 오디오를 미리 디코딩 (없으면 무음으로 재생)
  const ctx = getAudioCtx();
  if (ctx) {
    try {
      await ctx.resume();
      await preloadAudio();
    } catch (e) { /* 오디오 없이 진행 */ }
  }

  playingFrom = currentTime;
  playingWallStart = performance.now();
  playing = true;
  updatePlayButton();
  if (ctx && ctx.state === 'running') scheduleAudio(ctx, ctx.destination, currentTime);
  cancelAnimationFrame(playRaf);
  playRaf = requestAnimationFrame(playTick);
}

function playTick() {
  if (!playing) return;
  const total = totalDuration();
  const t = playingFrom + (performance.now() - playingWallStart) / 1000;
  if (t >= total) {
    finishPlayback();
    return;
  }
  currentTime = t;
  drawAll(currentTime);
  updateTimeUI();
  playRaf = requestAnimationFrame(playTick);
}

function finishPlayback() {
  playing = false;
  cancelAnimationFrame(playRaf);
  stopAudioSources();
  currentTime = Math.max(0, totalDuration() - 0.001);
  updatePlayButton();
  drawAll(currentTime);
  updateTimeUI();
}

function pause() {
  if (!playing) return;
  playing = false;
  cancelAnimationFrame(playRaf);
  stopAudioSources();
  updatePlayButton();
  drawAll(currentTime);
  updateTimeUI();
}

function stopPlayback() {
  pause();
  currentTime = 0;
  drawAll(currentTime);
  updateTimeUI();
}

function seekTo(t, redraw = true) {
  const total = totalDuration();
  currentTime = clamp(Number(t) || 0, 0, Math.max(0, total - 0.001));
  if (redraw) drawAll(currentTime);
  updateTimeUI();
}

btnPlay.addEventListener('click', () => {
  if (playing) pause();
  else play();
});

let resumeAfterSeek = false;
seekEl.addEventListener('input', () => {
  if (playing) {
    pause();
    resumeAfterSeek = true;
  }
  seekTo(parseFloat(seekEl.value), true);
});
seekEl.addEventListener('change', () => {
  if (resumeAfterSeek) {
    resumeAfterSeek = false;
    play();
  }
});

/* ------------------------------------------------------------
   7. 오디오 디코딩 · 믹싱
   ------------------------------------------------------------ */
let previewCtx = null;
const audioBuffers = new Map();   // key -> AudioBuffer (미리보기 컨텍스트)
let activeSources = [];
let previewBgmGain = null;

function getAudioCtx() {
  if (previewCtx) return previewCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { previewCtx = new AC(); } catch (e) { previewCtx = null; }
  return previewCtx;
}

async function decodeKey(ctx, key, cache) {
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const blob = blobCache.get(key);
  if (!blob) return null;
  try {
    const ab = await blob.arrayBuffer();
    const buf = await new Promise((resolve, reject) => {
      // Safari 구형: 콜백 기반
      const p = ctx.decodeAudioData(ab, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
    cache.set(key, buf);
    return buf;
  } catch (e) {
    console.warn('오디오 디코딩 실패', key, e);
    return null;
  }
}

async function preloadAudio(cache = audioBuffers) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const keys = [...referencedKeys()].filter(k => k.startsWith('aud_') || k.startsWith('bgm_'));
  for (const key of keys) {
    if (!cache.has(key)) await decodeKey(ctx, key, cache);
  }
}

async function decodeAllInto(ctx, cache) {
  const keys = [...referencedKeys()].filter(k => k.startsWith('aud_') || k.startsWith('bgm_'));
  for (const key of keys) {
    if (!cache.has(key)) await decodeKey(ctx, key, cache);
  }
}

function stopAudioSources() {
  for (const src of activeSources) {
    try { src.stop(); } catch (e) {}
  }
  activeSources = [];
  previewBgmGain = null;
}

function scheduleAudio(ctx, destination, fromTime, buffers = audioBuffers, nodes = activeSources) {
  const cuts = project.cuts;
  const lead = 0.06;
  const now = ctx.currentTime + lead;
  let acc = 0;

  for (const cut of cuts) {
    const dur = Math.max(0.5, Number(cut.duration) || 0.5);
    if (cut.audio && cut.audio.key) {
      const buf = buffers.get(cut.audio.key);
      if (buf && acc + dur > fromTime) {
        const offset = Math.max(0, fromTime - acc);
        if (offset < buf.duration) {
          try {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            gain.gain.value = clamp(project.options.voiceVolume ?? 1, 0, 1);
            src.connect(gain).connect(destination);
            // 컷 길이를 넘어 다음 컷으로 소리가 새지 않도록 잘라서 재생한다.
            const remainingInCut = dur - offset;
            const playDur = Math.max(0.02, Math.min(buf.duration - offset, remainingInCut));
            src.start(now + Math.max(0, acc - fromTime), offset, playDur);
            nodes.push(src);
          } catch (e) { console.warn('음성 재생 실패', e); }
        }
      }
    }
    acc += dur;
  }

  if (project.bgm && project.bgm.key) {
    const bgmBuf = buffers.get(project.bgm.key);
    if (bgmBuf) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = bgmBuf;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = clamp(project.options.bgmVolume ?? 0.2, 0, 1);
        src.connect(gain).connect(destination);
        const offset = bgmBuf.duration ? (fromTime % bgmBuf.duration) : 0;
        src.start(now, offset);
        nodes.push(src);
        if (nodes === activeSources) previewBgmGain = gain;
      } catch (e) { console.warn('BGM 재생 실패', e); }
    }
  }
}

async function audioDuration(blob, url) {
  // 1) audio 엘리먼트 메타데이터 (MediaRecorder webm은 Infinity인 경우가 있음)
  const d = await new Promise(resolve => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    let done = false;
    const finish = v => { if (done) return; done = true; a.src = ''; resolve(v); };
    a.onloadedmetadata = () => finish(isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
    a.onerror = () => finish(0);
    a.src = url;
    setTimeout(() => finish(0), 4000);
  });
  if (d > 0) return d;
  // 2) 디코딩으로 실제 길이 측정
  try {
    const ab = await blob.arrayBuffer();
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return 0;
    const octx = new AC(1, 1, 44100);
    const buf = await new Promise((resolve, reject) => {
      let p;
      try { p = octx.decodeAudioData(ab, resolve, reject); }
      catch (e) { reject(e); return; }
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
    return (buf && buf.duration) || 0;
  } catch (e) {
    console.warn('오디오 길이를 읽지 못했어요', e);
    return 0;
  }
}

/* ------------------------------------------------------------
   8. TTS 미리듣기
   ------------------------------------------------------------ */
let voices = [];
let ttsUtterance = null;

function refreshVoices() {
  const sel = $('#ttsVoice');
  if (!('speechSynthesis' in window)) {
    sel.innerHTML = '<option value="">지원하지 않는 브라우저</option>';
    sel.disabled = true;
    return;
  }
  const all = speechSynthesis.getVoices();
  if (!all.length) return;
  voices = all;
  const ko = all.filter(v => /^ko([-_]|$)/i.test(v.lang || ''));
  const list = ko.length ? ko : all;
  const prev = (project && project.tts && project.tts.voiceURI) || '';
  sel.innerHTML = (ko.length ? '' : '<option value="">다른 언어 목소리</option>') +
    list.map(v => `<option value="${escapeAttr(v.voiceURI)}">${escapeHtml(v.name)} (${escapeHtml(v.lang || '')})${v.default ? ' · 기본' : ''}</option>`).join('');
  if (prev && list.some(v => v.voiceURI === prev)) {
    sel.value = prev;
  } else if (list.length) {
    sel.value = list[0].voiceURI;
    if (project) project.tts.voiceURI = list[0].voiceURI;
  }
}

function speakCut(cut) {
  if (!('speechSynthesis' in window)) {
    toast('이 브라우저는 음성 합성(TTS)을 지원하지 않아요.', 'error');
    return;
  }
  const text = String(cut.text || '').replace(/\s*\n\s*/g, ' ').trim();
  if (!text) {
    toast('이 컷에 자막이 없어요. 자막을 먼저 입력해 주세요.');
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  u.rate = clamp(Number(project.tts.rate) || 1, 0.5, 2);
  u.pitch = clamp(Number(project.tts.pitch) || 1, 0, 2);
  const v = voices.find(v => v.voiceURI === project.tts.voiceURI);
  if (v) u.voice = v;
  u.onend = () => { if (ttsUtterance === u) ttsUtterance = null; };
  u.onerror = () => { if (ttsUtterance === u) ttsUtterance = null; };
  ttsUtterance = u;
  speechSynthesis.speak(u);
  toast('🔈 TTS 미리듣기 재생 중');
}

function stopTts() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  ttsUtterance = null;
}

/* ------------------------------------------------------------
   9. 컷별 마이크 녹음
   ------------------------------------------------------------ */
let recorder = null;   // {cutId, mr, chunks, stream, startedAt, timer}

function pickAudioMime() {
  if (!('MediaRecorder' in window)) return '';
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg'];
  return cands.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
}

function recordButtonFor(cutId) {
  const card = $(`.cut-card[data-id="${cutId}"]`);
  return card ? $('[data-act="record"]', card) : null;
}

async function toggleRecord(cutId) {
  if (exporting) return;
  if (recorder) {
    if (recorder.cutId === cutId) {
      stopRecording();
    } else {
      toast('다른 컷 녹음을 먼저 멈춰 주세요.');
    }
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('이 브라우저에서는 마이크 녹음이 지원되지 않아요. 음성 파일을 올려 주세요.', 'error');
    return;
  }
  if (!('MediaRecorder' in window)) {
    toast('이 브라우저에서는 녹음이 지원되지 않아요. 음성 파일을 올려 주세요.', 'error');
    return;
  }
  pause();
  stopTts();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast(e && e.name === 'NotAllowedError'
      ? '마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.'
      : '마이크를 열 수 없어요: ' + (e.message || e.name), 'error');
    return;
  }
  const mime = pickAudioMime();
  let mr;
  try {
    mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    toast('녹음기를 시작할 수 없어요. 음성 파일을 올려 주세요.', 'error');
    return;
  }
  const chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => finalizeRecording(cutId, chunks, mr.mimeType || mime, stream);
  recorder = { cutId, mr, chunks, stream, startedAt: Date.now(), timer: null };
  try { mr.start(150); } catch (e) {
    stream.getTracks().forEach(t => t.stop());
    recorder = null;
    toast('녹음을 시작하지 못했어요.', 'error');
    return;
  }
  recorder.timer = setInterval(updateRecordingUI, 250);
  renderCutList();
  toast('🎙 녹음 중… 다 되면 ‘중지’를 눌러 주세요.');
}

function stopRecording() {
  if (!recorder) return;
  clearInterval(recorder.timer);
  try {
    if (recorder.mr.state !== 'inactive') recorder.mr.stop();
  } catch (e) {}
}

function updateRecordingUI() {
  if (!recorder) return;
  const btn = recordButtonFor(recorder.cutId);
  if (btn) {
    const s = (Date.now() - recorder.startedAt) / 1000;
    btn.innerHTML = `<span class="dot"></span>중지 ${formatTime(s)}`;
    btn.classList.add('recording');
  }
}

function extForMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

async function finalizeRecording(cutId, chunks, mime, stream) {
  try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  const cut = project.cuts.find(c => c.id === cutId);
  if (recorder && recorder.cutId === cutId) {
    clearInterval(recorder.timer);
    recorder = null;
  }
  const blob = new Blob(chunks, { type: mime || 'audio/webm' });
  if (!blob.size) {
    renderCutList();
    toast('녹음된 소리가 없어요. 다시 시도해 주세요.', 'error');
    return;
  }
  const saved = await setCutAudio(cut, blob, `녹음-${cut ? project.cuts.indexOf(cut) + 1 : 1}.${extForMime(mime)}`);
  renderCutList();
  if (saved) toast('녹음을 넣었어요. 들어보고 마음에 안 들면 다시 녹음하세요.');
}

async function setCutAudio(cut, blob, name) {
  if (!cut) return false;
  const key = uid('aud_');
  try {
    await idbPut(key, blob);
  } catch (e) {
    console.warn('audio save failed', e);
    toast('브라우저 저장 공간이 부족해 음성을 넣지 못했어요. 프로젝트를 정리해 주세요.', 'error');
    return false;
  }
  blobCache.set(key, blob);
  urlCache.delete(key);
  if (cut.audio && cut.audio.key) releaseMedia(cut.audio.key);
  cut.audio = { key, name: name || '음성', mime: blob.type || '', duration: 0 };
  audioBuffers.delete(key);
  const url = mediaUrl(key);
  const dur = await audioDuration(blob, url);
  cut.audio.duration = dur;
  if (cut.autoFit && dur > 0) {
    cut.duration = clamp(Math.round((dur + 0.25) * 10) / 10, 0.5, 120);
  }
  scheduleSave();
  recalcTimeline();
  return true;
}

function looksLikeAudio(file) {
  if (!file) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  return /\.(mp3|wav|m4a|aac|ogg|oga|opus|webm|mp4)$/i.test(file.name || '');
}

async function handleAudioFile(cut, file) {
  if (!file) return;
  if (!looksLikeAudio(file)) {
    toast('음성 파일이 아니에요. MP3 · WAV · M4A 파일을 선택해 주세요.', 'error');
    return;
  }
  toast('음성을 넣는 중…');
  const name = file.name || `음성.${extForMime(file.type)}`;
  const saved = await setCutAudio(cut, file, name);
  if (!saved) return;
  renderCutList();
  toast('음성을 넣었어요.');
}

function removeCutAudio(cut) {
  if (!cut.audio) return;
  const key = cut.audio.key;
  cut.audio = null;
  releaseMedia(key);
  scheduleSave();
  renderCutList();
  toast('이 컷의 음성을 지웠어요.');
}

/* ------------------------------------------------------------
   10. 컷 리스트 UI
   ------------------------------------------------------------ */
const cutListEl = $('#cutList');

function findCut(id) {
  return project.cuts.find(c => c.id === id) || null;
}

function cutCardHtml(cut, index, total) {
  const url = imageUrl(cut);
  const st = styleFor(cut);
  const hasAudio = !!(cut.audio && cut.audio.key);
  const recording = !!(recorder && recorder.cutId === cut.id);
  const audioUrl = hasAudio ? mediaUrl(cut.audio.key) : null;
  const num = index + 1;

  const seg = (field, opts, current) => `
    <div class="segmented" data-style-seg="${field}">
      ${opts.map(([v, label]) => `<button type="button" data-value="${v}" class="${current === v ? 'on' : ''}">${label}</button>`).join('')}
    </div>`;

  return `
    <div class="cut-head">
      <span class="cut-num">${num}</span>
      <span class="cut-dur" data-el="durLabel">${Number(cut.duration).toFixed(1)}초</span>
      <div class="cut-tools">
        <button type="button" class="icon-btn" data-act="up" title="위로 이동" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn" data-act="down" title="아래로 이동" ${index === total - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn danger" data-act="delete" title="컷 삭제">✕</button>
      </div>
    </div>
    <div class="cut-body">
      <div class="cut-thumb ${url ? 'has-img' : ''}" data-act="pickImage" title="눌러서 이미지 교체" role="button" tabindex="0" aria-label="컷 ${num} 이미지 교체">
        ${url ? `<img src="${escapeAttr(url)}" alt="컷 ${num} 이미지">` : ''}
        <span class="thumb-edit">이미지 교체</span>
      </div>
      <div class="cut-main">
        <textarea class="cut-textarea" data-field="text" rows="3" placeholder="자막을 입력하세요 (줄바꿈 가능)">${escapeHtml(cut.text)}</textarea>
        <div class="dur-row">
          <span class="dur-label">재생 시간</span>
          <input class="dur-range" type="range" data-field="duration" min="0.5" max="120" step="0.1" value="${Number(cut.duration)}">
          <input class="dur-num" type="number" data-field="durationNum" min="0.5" max="120" step="0.1" inputmode="decimal" value="${Number(cut.duration).toFixed(1)}">
          <span class="unit">초</span>
        </div>
        <div class="audio-box">
          <div class="audio-actions">
            <button type="button" class="chip ${recording ? 'recording' : ''}" data-act="record">${recording ? '<span class="dot"></span>' : '🎙 '}${recording ? '중지' : '녹음'}</button>
            <button type="button" class="chip" data-act="uploadAudio">📁 음성 파일</button>
            <button type="button" class="chip" data-act="tts">🔈 TTS</button>
            ${hasAudio ? '<button type="button" class="chip danger" data-act="removeAudio">음성 삭제</button>' : ''}
          </div>
          ${hasAudio ? `<audio class="cut-audio" controls preload="metadata" src="${escapeAttr(audioUrl || '')}"></audio>
            <div class="audio-state"><b>${escapeHtml(cut.audio.name || '음성')}</b>${cut.audio.duration ? ` · ${cut.audio.duration.toFixed(1)}초` : ''}</div>` : ''}
          <label class="toggle small"><input type="checkbox" data-field="autoFit" ${cut.autoFit ? 'checked' : ''}><span>음성 길이에 맞추기</span></label>
          <input type="file" data-field="imageFile" accept="image/*" hidden>
          <input type="file" data-field="audioFile" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" hidden>
        </div>
        <details class="cut-style" ${cut.style ? 'open' : ''}>
          <summary>이 컷만 스타일${cut.style ? ' <span class="tag">사용 중</span>' : ''}</summary>
          <div class="style-body">
            <label class="toggle small"><input type="checkbox" data-style-enable ${cut.style ? 'checked' : ''}><span>이 컷만 다르게 적용</span></label>
            <div class="style-grid" ${cut.style ? '' : 'hidden'}>
              <label class="field">글자 크기 <output data-style-out>${st.fontSize}</output>
                <input type="range" data-style="fontSize" min="32" max="110" step="1" value="${st.fontSize}">
              </label>
              <label class="field">굵기
                <select data-style="weight">
                  ${STYLE_WEIGHTS.map(w => `<option value="${w}" ${Number(st.weight) === w ? 'selected' : ''}>${WEIGHT_LABEL[w]}</option>`).join('')}
                </select>
              </label>
              <div class="field"><span class="field-label">위치</span>
                ${seg('position', [['top', '상단'], ['center', '중앙'], ['bottom', '하단']], st.position)}
              </div>
              <div class="field"><span class="field-label">배경</span>
                ${seg('bg', [['dark', '검정'], ['light', '흰색'], ['none', '없음']], st.bg)}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>`;
}

function autoGrowTextarea(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  const h = Math.min(340, Math.max(76, ta.scrollHeight + 2));
  ta.style.height = h + 'px';
}

function renderCutList() {
  if (!project) return;
  const frag = document.createDocumentFragment();
  project.cuts.forEach((cut, i) => {
    const card = document.createElement('article');
    card.className = 'cut-card' + (recorder && recorder.cutId === cut.id ? ' recording' : '');
    card.dataset.id = cut.id;
    card.innerHTML = cutCardHtml(cut, i, project.cuts.length);
    frag.appendChild(card);
  });
  cutListEl.replaceChildren(frag);
  $$('.cut-textarea', cutListEl).forEach(autoGrowTextarea);
  $('#emptyCuts').classList.toggle('is-hidden', project.cuts.length > 0);
  recalcTimeline();
}

function updateDurLabel(card, v) {
  const label = $('[data-el="durLabel"]', card);
  if (label) label.textContent = `${Number(v).toFixed(1)}초`;
}

function moveCut(cut, dir) {
  const idx = project.cuts.indexOf(cut);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= project.cuts.length) return;
  project.cuts.splice(idx, 1);
  project.cuts.splice(to, 0, cut);
  scheduleSave();
  renderCutList();
}

function deleteCut(cut) {
  const idx = project.cuts.indexOf(cut);
  if (idx < 0) return;
  const hasStuff = !!cut.image || !!cut.audio || (cut.text || '').trim().length > 0;
  if (hasStuff && !confirm(`컷 ${idx + 1}을(를) 삭제할까요?`)) return;
  if (recorder && recorder.cutId === cut.id) stopRecording();
  if (cut.image && cut.image.key) releaseMedia(cut.image.key);
  if (cut.audio && cut.audio.key) releaseMedia(cut.audio.key);
  project.cuts.splice(idx, 1);
  scheduleSave();
  renderCutList();
  toast('컷을 삭제했어요.');
}

/* --- 컷 리스트 이벤트 (위임) --- */
cutListEl.addEventListener('input', e => {
  const card = e.target.closest('.cut-card');
  if (!card) return;
  const cut = findCut(card.dataset.id);
  if (!cut) return;
  const el = e.target;
  const field = el.dataset.field;

  if (field === 'text') {
    cut.text = el.value;
    autoGrowTextarea(el);
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }
  if (field === 'duration') {
    const v = clamp(parseFloat(el.value) || 0.5, 0.5, 120);
    cut.duration = v;
    if (cut.autoFit) {
      cut.autoFit = false;
      const cb = $('[data-field="autoFit"]', card);
      if (cb) cb.checked = false;
    }
    const num = $('[data-field="durationNum"]', card);
    if (num && document.activeElement !== num) num.value = v.toFixed(1);
    updateDurLabel(card, v);
    recalcTimeline();
    scheduleSave();
    return;
  }
  if (field === 'durationNum') {
    const raw = parseFloat(el.value);
    if (!isFinite(raw) || raw <= 0) return;
    const v = clamp(raw, 0.5, 120);
    cut.duration = v;
    if (cut.autoFit) {
      cut.autoFit = false;
      const cb = $('[data-field="autoFit"]', card);
      if (cb) cb.checked = false;
    }
    const range = $('[data-field="duration"]', card);
    if (range) range.value = String(Math.min(120, v));
    updateDurLabel(card, v);
    recalcTimeline();
    scheduleSave();
    return;
  }
  if (el.dataset.style) {
    if (!cut.style) return;
    const key = el.dataset.style;
    const val = key === 'fontSize' ? clamp(parseInt(el.value) || 56, 32, 110) : Number(el.value) || 700;
    cut.style[key] = val;
    const out = $('[data-style-out]', card);
    if (out && key === 'fontSize') out.textContent = val;
    scheduleSave();
    if (!playing) drawAll(currentTime);
  }
});

cutListEl.addEventListener('change', e => {
  const card = e.target.closest('.cut-card');
  if (!card) return;
  const cut = findCut(card.dataset.id);
  if (!cut) return;
  const el = e.target;

  if (el.dataset.field === 'autoFit') {
    cut.autoFit = !!el.checked;
    if (cut.autoFit && cut.audio && cut.audio.duration > 0) {
      cut.duration = clamp(Math.round((cut.audio.duration + 0.25) * 10) / 10, 0.5, 120);
      renderCutList();
    }
    scheduleSave();
    return;
  }
  if (el.dataset.field === 'imageFile') {
    const file = el.files && el.files[0];
    el.value = '';
    if (file) handleImageFile(cut, file);
    return;
  }
  if (el.dataset.field === 'audioFile') {
    const file = el.files && el.files[0];
    el.value = '';
    if (file) handleAudioFile(cut, file);
    return;
  }
  if (el.dataset.style === 'weight') {
    if (!cut.style) return;
    cut.style.weight = Number(el.value) || 700;
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }
  if (el.hasAttribute('data-style-enable')) {
    if (el.checked) {
      cut.style = {
        fontSize: project.style.fontSize,
        position: project.style.position,
        bg: project.style.bg,
        weight: project.style.weight
      };
    } else {
      cut.style = null;
    }
    scheduleSave();
    renderCutList();
    if (!playing) drawAll(currentTime);
  }
});

cutListEl.addEventListener('click', e => {
  const card = e.target.closest('.cut-card');
  if (!card) return;
  const cut = findCut(card.dataset.id);
  if (!cut) return;

  // 컷별 스타일 세그먼트
  const segBtn = e.target.closest('[data-style-seg] button');
  if (segBtn) {
    if (!cut.style) return;
    const field = segBtn.closest('[data-style-seg]').dataset.styleSeg;
    cut.style[field] = segBtn.dataset.value;
    $$('[data-style-seg] button', card).forEach(b => {
      if (b.closest('[data-style-seg]').dataset.styleSeg === field) {
        b.classList.toggle('on', b === segBtn);
      }
    });
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }

  const actEl = e.target.closest('[data-act]');
  if (!actEl) {
    // 썸네일 안의 이미지를 눌러도 이미지 교체
    if (e.target.closest('.cut-thumb')) {
      const fi = $('[data-field="imageFile"]', card);
      if (fi) fi.click();
    }
    return;
  }
  switch (actEl.dataset.act) {
    case 'up': moveCut(cut, -1); break;
    case 'down': moveCut(cut, 1); break;
    case 'delete': deleteCut(cut); break;
    case 'pickImage': {
      const fi = $('[data-field="imageFile"]', card);
      if (fi) fi.click();
      break;
    }
    case 'uploadAudio': {
      const fi = $('[data-field="audioFile"]', card);
      if (fi) fi.click();
      break;
    }
    case 'record': toggleRecord(cut.id); break;
    case 'tts': speakCut(cut); break;
    case 'removeAudio': removeCutAudio(cut); break;
  }
});

cutListEl.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('cut-thumb')) {
    e.preventDefault();
    const fi = $('[data-field="imageFile"]', e.target.closest('.cut-card'));
    if (fi) fi.click();
  }
});

// 컷을 편집하기 시작하면 미리보기를 그 컷으로 이동해 바로 확인할 수 있게 한다.
cutListEl.addEventListener('focusin', e => {
  if (playing) return;
  const card = e.target.closest('.cut-card');
  if (!card) return;
  const cut = findCut(card.dataset.id);
  if (!cut) return;
  const idx = project.cuts.indexOf(cut);
  if (idx < 0) return;
  let start = 0;
  for (let i = 0; i < idx; i++) start += Math.max(0.5, Number(project.cuts[i].duration) || 0.5);
  const total = totalDuration();
  currentTime = clamp(start + 0.01, 0, Math.max(0, total - 0.001));
  drawAll(currentTime);
  updateTimeUI();
});

function addCut() {
  const last = project.cuts[project.cuts.length - 1];
  const cut = newCut({ duration: last ? Math.min(5, last.duration) : 3 });
  project.cuts.push(cut);
  scheduleSave();
  renderCutList();
  requestAnimationFrame(() => {
    const card = $(`.cut-card[data-id="${cut.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const ta = $('textarea', card);
      if (ta) ta.focus();
    }
  });
}

/* ------------------------------------------------------------
   11. 전체 자막 스타일 · 설정 UI
   ------------------------------------------------------------ */
function setSegmented(el, value) {
  $$('button', el).forEach(b => b.classList.toggle('on', b.dataset.value === value));
}

function syncProjectUI() {
  $('#projectName').value = project.name || '';
  $('#fontSize').value = String(project.style.fontSize);
  $('#fontSizeOut').textContent = String(project.style.fontSize);
  $('#fontWeight').value = String(project.style.weight);
  setSegmented($('#posSeg'), project.style.position);
  setSegmented($('#bgSeg'), project.style.bg);
  $('#kenBurns').checked = !!project.options.kenBurns;
  $('#resSelect').value = project.options.resolution || '1080x1920';
  $('#stageRes').textContent = (project.options.resolution || '1080x1920').replace('x', '×');
  $('#bgmVol').value = String(Math.round((project.options.bgmVolume ?? 0.18) * 100));
  $('#bgmVolOut').textContent = Math.round((project.options.bgmVolume ?? 0.18) * 100) + '%';
  $('#voiceVol').value = String(Math.round((project.options.voiceVolume ?? 1) * 100));
  $('#voiceVolOut').textContent = Math.round((project.options.voiceVolume ?? 1) * 100) + '%';
  $('#ttsRate').value = String(project.tts.rate || 1);
  $('#ttsRateOut').textContent = Number(project.tts.rate || 1).toFixed(2).replace(/0$/, '') + 'x';
  $('#ttsPitch').value = String(project.tts.pitch || 1);
  $('#ttsPitchOut').textContent = Number(project.tts.pitch || 1).toFixed(1);
  renderBgmUI();
}

$('#fontSize').addEventListener('input', e => {
  project.style.fontSize = clamp(parseInt(e.target.value) || 56, 32, 110);
  $('#fontSizeOut').textContent = String(project.style.fontSize);
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#fontWeight').addEventListener('change', e => {
  project.style.weight = Number(e.target.value) || 800;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#posSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  project.style.position = b.dataset.value;
  setSegmented($('#posSeg'), project.style.position);
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#bgSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  project.style.bg = b.dataset.value;
  setSegmented($('#bgSeg'), project.style.bg);
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#kenBurns').addEventListener('change', e => {
  project.options.kenBurns = !!e.target.checked;
  scheduleSave();
  recalcTimeline();
});
$('#resSelect').addEventListener('change', e => {
  project.options.resolution = e.target.value;
  $('#stageRes').textContent = e.target.value.replace('x', '×');
  scheduleSave();
});
$('#projectName').addEventListener('input', e => {
  project.name = e.target.value.slice(0, 60);
  scheduleSave();
});

$('#ttsVoice').addEventListener('change', e => {
  project.tts.voiceURI = e.target.value;
  scheduleSave();
});
$('#ttsRate').addEventListener('input', e => {
  project.tts.rate = clamp(parseFloat(e.target.value) || 1, 0.8, 1.5);
  $('#ttsRateOut').textContent = Number(project.tts.rate).toFixed(2).replace(/0$/, '') + 'x';
  scheduleSave();
});
$('#ttsPitch').addEventListener('input', e => {
  project.tts.pitch = clamp(parseFloat(e.target.value) || 1, 0.5, 2);
  $('#ttsPitchOut').textContent = Number(project.tts.pitch).toFixed(1);
  scheduleSave();
});
$('#btnTtsStop').addEventListener('click', () => { stopTts(); toast('TTS를 멈췄어요.'); });

/* ------------------------------------------------------------
   12. BGM
   ------------------------------------------------------------ */
function renderBgmUI() {
  const has = !!(project.bgm && project.bgm.key);
  $('#bgmName').textContent = has ? (project.bgm.name || '음악') : '없음';
  $('#btnBgmRemove').classList.toggle('is-hidden', !has);
  const player = $('#bgmPlayer');
  const url = has ? mediaUrl(project.bgm.key) : null;
  if (url) {
    player.classList.remove('is-hidden');
    if (player.getAttribute('src') !== url) player.src = url;
  } else {
    player.classList.add('is-hidden');
    player.removeAttribute('src');
    try { player.load(); } catch (e) {}
  }
  $('#bgmVol').value = String(Math.round((project.options.bgmVolume ?? 0.18) * 100));
  $('#bgmVolOut').textContent = Math.round((project.options.bgmVolume ?? 0.18) * 100) + '%';
  $('#voiceVol').value = String(Math.round((project.options.voiceVolume ?? 1) * 100));
  $('#voiceVolOut').textContent = Math.round((project.options.voiceVolume ?? 1) * 100) + '%';
}

async function handleBgmFile(file) {
  if (!file) return;
  if (!looksLikeAudio(file)) {
    toast('음악 파일이 아니에요. MP3 · WAV · M4A 파일을 선택해 주세요.', 'error');
    return;
  }
  toast('음악을 넣는 중…');
  const key = uid('bgm_');
  try {
    await idbPut(key, file);
  } catch (e) {
    toast('음악 파일을 저장하지 못했어요. 용량이 너무 크지 않은지 확인해 주세요.', 'error');
    return;
  }
  blobCache.set(key, file);
  urlCache.delete(key);
  if (project.bgm && project.bgm.key) releaseMedia(project.bgm.key);
  project.bgm = { key, name: file.name || 'bgm', mime: file.type || '', duration: 0 };
  audioBuffers.delete(key);
  const url = mediaUrl(key);
  project.bgm.duration = await audioDuration(file, url);
  renderBgmUI();
  scheduleSave();
  toast('배경음악을 넣었어요.');
}

$('#btnBgmUpload').addEventListener('click', () => $('#bgmFile').click());
$('#bgmFile').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) handleBgmFile(file);
});
$('#btnBgmRemove').addEventListener('click', () => {
  if (!project.bgm) return;
  releaseMedia(project.bgm.key);
  project.bgm = null;
  renderBgmUI();
  scheduleSave();
  toast('배경음악을 뺐어요.');
});
$('#bgmVol').addEventListener('input', e => {
  project.options.bgmVolume = clamp((parseFloat(e.target.value) || 0) / 100, 0, 1);
  $('#bgmVolOut').textContent = Math.round(project.options.bgmVolume * 100) + '%';
  if (previewBgmGain) previewBgmGain.gain.value = project.options.bgmVolume;
  scheduleSave();
});
$('#voiceVol').addEventListener('input', e => {
  project.options.voiceVolume = clamp((parseFloat(e.target.value) || 0) / 100, 0, 1);
  $('#voiceVolOut').textContent = Math.round(project.options.voiceVolume * 100) + '%';
  scheduleSave();
});

/* ------------------------------------------------------------
   13. 저장 (localStorage) · 복원
   ------------------------------------------------------------ */
function serializeProject() {
  return {
    v: 1,
    savedAt: Date.now(),
    name: project.name,
    style: { ...project.style },
    options: { ...project.options },
    tts: { ...project.tts },
    bgm: project.bgm ? { ...project.bgm } : null,
    cuts: project.cuts.map(c => ({
      id: c.id,
      text: c.text,
      duration: c.duration,
      autoFit: c.autoFit,
      image: c.image ? { ...c.image } : null,
      audio: c.audio ? { ...c.audio } : null,
      style: c.style ? { ...c.style } : null
    }))
  };
}

function setSaveState(text, kind = '') {
  const el = $('#saveState');
  el.textContent = text;
  el.className = 'save-state' + (kind ? ' ' + kind : '');
}

function scheduleSave() {
  setSaveState('저장 중…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 420);
}

function saveNow() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(serializeProject()));
    const d = new Date();
    setSaveState(`자동 저장됨 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`, 'saved');
    clearTimeout(gcTimer);
    gcTimer = setTimeout(gcMedia, 1200);
  } catch (e) {
    console.warn('save failed', e);
    setSaveState('저장 실패 · 용량 확인', 'error');
    toast('브라우저 저장 공간이 부족해요. 프로젝트를 JSON으로 내려받아 두세요.', 'error');
  }
}

async function gcMedia() {
  if (!project) return;
  const refs = referencedKeys();
  const keys = await idbKeys();
  for (const key of keys) {
    if (!refs.has(key)) await idbDel(key);
  }
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.cuts)) return null;
    return normalizeProject(data);
  } catch (e) {
    console.warn('saved project parse failed', e);
    return null;
  }
}

function normalizeProject(raw) {
  const style = raw.style || {};
  const options = raw.options || {};
  const tts = raw.tts || {};
  const normStyle = {
    fontSize: clamp(parseInt(style.fontSize) || DEFAULT_STYLE.fontSize, 32, 110),
    position: ['top', 'center', 'bottom'].includes(style.position) ? style.position : DEFAULT_STYLE.position,
    bg: ['dark', 'light', 'none'].includes(style.bg) ? style.bg : DEFAULT_STYLE.bg,
    weight: STYLE_WEIGHTS.includes(Number(style.weight)) ? Number(style.weight) : DEFAULT_STYLE.weight
  };
  const cuts = (Array.isArray(raw.cuts) ? raw.cuts : []).map(c => {
    let st = null;
    if (c.style && typeof c.style === 'object') {
      st = {
        fontSize: clamp(parseInt(c.style.fontSize) || normStyle.fontSize, 32, 110),
        position: ['top', 'center', 'bottom'].includes(c.style.position) ? c.style.position : normStyle.position,
        bg: ['dark', 'light', 'none'].includes(c.style.bg) ? c.style.bg : normStyle.bg,
        weight: STYLE_WEIGHTS.includes(Number(c.style.weight)) ? Number(c.style.weight) : normStyle.weight
      };
    }
    return {
      id: c.id || uid('cut'),
      text: typeof c.text === 'string' ? c.text : '',
      duration: clamp(parseFloat(c.duration) || 3, 0.5, 120),
      autoFit: c.autoFit !== false,
      image: c.image && (c.image.src || c.image.key)
        ? { src: c.image.src || undefined, key: c.image.key || undefined, name: c.image.name || '' }
        : null,
      audio: c.audio && c.audio.key
        ? { key: c.audio.key, name: c.audio.name || '음성', mime: c.audio.mime || '', duration: parseFloat(c.audio.duration) || 0 }
        : null,
      style: st
    };
  });
  return {
    name: String(raw.name || '내 쇼츠').slice(0, 60),
    style: normStyle,
    options: {
      kenBurns: options.kenBurns !== false,
      resolution: options.resolution === '720x1280' ? '720x1280' : '1080x1920',
      bgmVolume: Number.isFinite(parseFloat(options.bgmVolume))
        ? clamp(parseFloat(options.bgmVolume), 0, 1)
        : DEFAULT_OPTIONS.bgmVolume,
      voiceVolume: Number.isFinite(parseFloat(options.voiceVolume))
        ? clamp(parseFloat(options.voiceVolume), 0, 1)
        : DEFAULT_OPTIONS.voiceVolume
    },
    tts: {
      voiceURI: String(tts.voiceURI || ''),
      rate: clamp(parseFloat(tts.rate) || 1, 0.8, 1.5),
      pitch: clamp(parseFloat(tts.pitch) || 1, 0.5, 2)
    },
    bgm: raw.bgm && raw.bgm.key
      ? { key: raw.bgm.key, name: raw.bgm.name || '음악', mime: raw.bgm.mime || '', duration: parseFloat(raw.bgm.duration) || 0 }
      : null,
    cuts
  };
}

/* ------------------------------------------------------------
   14. 프로젝트 JSON 내보내기 / 불러오기
   ------------------------------------------------------------ */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function buildProjectJson() {
  const data = {
    format: 'shorts-maker-project',
    version: 1,
    savedAt: new Date().toISOString(),
    name: project.name,
    style: { ...project.style },
    options: { ...project.options },
    tts: { ...project.tts },
    bgm: null,
    cuts: []
  };
  for (const cut of project.cuts) {
    const c = {
      text: cut.text,
      duration: cut.duration,
      autoFit: cut.autoFit,
      style: cut.style ? { ...cut.style } : null,
      image: null,
      audio: null
    };
    if (cut.image) {
      if (cut.image.key) {
        const blob = blobCache.get(cut.image.key);
        if (blob) c.image = { name: cut.image.name || 'image', mime: blob.type, dataUrl: await blobToDataURL(blob) };
      } else if (cut.image.src) {
        c.image = { name: cut.image.name || '', src: cut.image.src };
      }
    }
    if (cut.audio && cut.audio.key) {
      const blob = blobCache.get(cut.audio.key);
      if (blob) {
        c.audio = {
          name: cut.audio.name || '음성',
          mime: blob.type || cut.audio.mime || '',
          duration: cut.audio.duration || 0,
          dataUrl: await blobToDataURL(blob)
        };
      }
    }
    data.cuts.push(c);
  }
  if (project.bgm && project.bgm.key) {
    const blob = blobCache.get(project.bgm.key);
    if (blob) {
      data.bgm = {
        name: project.bgm.name || '음악',
        mime: blob.type || project.bgm.mime || '',
        duration: project.bgm.duration || 0,
        dataUrl: await blobToDataURL(blob)
      };
    }
  }
  return data;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportProjectJson() {
  try {
    toast('프로젝트를 포장하는 중…');
    const data = await buildProjectJson();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const safe = (project.name || 'shorts').replace(/[\\/:*?"<>|]/g, '').slice(0, 40).trim() || 'shorts';
    downloadBlob(blob, `${safe}-${stamp()}.json`);
    toast('프로젝트 파일을 내려받았어요. 다른 기기에서 ‘불러오기’로 열 수 있어요.');
  } catch (e) {
    console.error(e);
    toast('프로젝트를 저장하지 못했어요: ' + (e.message || e), 'error');
  }
}

async function importProjectFile(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    toast('JSON 파일을 읽을 수 없어요.', 'error');
    return;
  }
  if (!data || data.format !== 'shorts-maker-project' || !Array.isArray(data.cuts)) {
    toast('쇼츠 메이커 프로젝트 파일이 아니에요.', 'error');
    return;
  }
  if (!confirm('현재 작업을 불러온 프로젝트로 바꿀까요?')) return;

  stopPlayback();
  stopTts();
  clearMediaCache();

  const newProject = normalizeProject(data);
  for (let i = 0; i < data.cuts.length; i++) {
    const rawCut = data.cuts[i];
    const cut = newProject.cuts[i];
    if (!cut) continue;
    if (rawCut.image && rawCut.image.dataUrl) {
      try {
        const blob = dataUrlToBlob(rawCut.image.dataUrl);
        const key = uid('img_');
        await idbPut(key, blob);
        blobCache.set(key, blob);
        cut.image = { key, name: rawCut.image.name || 'image', mime: blob.type };
      } catch (e) { console.warn('import image failed', e); }
    }
    if (rawCut.audio && rawCut.audio.dataUrl) {
      try {
        const blob = dataUrlToBlob(rawCut.audio.dataUrl);
        const key = uid('aud_');
        await idbPut(key, blob);
        blobCache.set(key, blob);
        cut.audio = {
          key,
          name: rawCut.audio.name || '음성',
          mime: blob.type || '',
          duration: parseFloat(rawCut.audio.duration) || 0
        };
        if (!cut.audio.duration) cut.audio.duration = await audioDuration(blob, mediaUrl(key));
      } catch (e) { console.warn('import audio failed', e); }
    }
  }
  if (data.bgm && data.bgm.dataUrl) {
    try {
      const blob = dataUrlToBlob(data.bgm.dataUrl);
      const key = uid('bgm_');
      await idbPut(key, blob);
      blobCache.set(key, blob);
      newProject.bgm = {
        key,
        name: data.bgm.name || '음악',
        mime: blob.type || '',
        duration: parseFloat(data.bgm.duration) || 0
      };
    } catch (e) { console.warn('import bgm failed', e); }
  }

  project = newProject;
  currentTime = 0;
  syncProjectUI();
  refreshVoices();
  renderCutList();
  saveNow();
  toast('프로젝트를 불러왔어요.');
}

/* ------------------------------------------------------------
   15. 영상 내보내기 (Canvas + WebAudio + MediaRecorder)
   ------------------------------------------------------------ */
let exporting = false;
let exportCancel = false;
let exportRec = null;
let exportStream = null;
let exportCtx = null;
let exportChunks = [];
let exportMime = '';
let exportFileBase = '';
let exportRaf = 0;
let exportTotalSeconds = 0;

function detectVideoMime() {
  if (!('MediaRecorder' in window) || !window.MediaRecorder.isTypeSupported) return '';
  const ua = navigator.userAgent || '';
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);

  // H.264/AAC MP4는 아이폰·편집 앱과 가장 잘 맞는다.
  const h264 = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2'
  ];
  const supported = m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } };

  const cands = [];
  if (isSafari) cands.push('video/mp4', ...h264);
  else cands.push(...h264);
  cands.push('video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm');
  if (!isSafari) cands.push('video/mp4');

  for (const m of cands) {
    if (supported(m)) return m;
  }
  return '';
}

function currentResolution() {
  return (project.options.resolution === '720x1280') ? [720, 1280] : [1080, 1920];
}

async function preloadImages() {
  await Promise.all(project.cuts.map(c => loadImage(imageUrl(c))));
}

function setExportProgress(p, label) {
  const pct = clamp(Math.round(p * 100), 0, 100);
  $('#exportPct').textContent = pct + '%';
  $('#exportBar').style.width = pct + '%';
  if (label) $('#exportLabel').textContent = label;
}

function safeName() {
  return (project.name || 'shorts').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40) || 'shorts';
}

async function exportVideo() {
  if (exporting) return;
  if (!project.cuts.length) { toast('컷을 먼저 추가해 주세요.'); return; }
  if (!('MediaRecorder' in window)) {
    toast('이 브라우저는 영상 녹화를 지원하지 않아요. Chrome 또는 최신 Safari에서 열어 주세요.', 'error');
    return;
  }
  if (typeof canvas.captureStream !== 'function' && typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    toast('이 브라우저는 캔버스 녹화를 지원하지 않아요. Chrome 또는 최신 Safari(iOS 17+)에서 열어 주세요.', 'error');
    return;
  }
  exportMime = detectVideoMime();
  if (!exportMime) {
    toast('이 브라우저에서는 MP4/WEBM 녹화가 지원되지 않아요. Chrome(PC·안드로이드)이나 최신 Safari에서 다시 시도해 주세요.', 'error');
    return;
  }

  pause();
  stopTts();

  const [W, H] = currentResolution();
  const total = totalDuration();
  exportTotalSeconds = total;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');

  exporting = true;
  exportCancel = false;
  exportChunks = [];
  $('#btnExport').disabled = true;
  document.body.classList.add('is-exporting');
  const editor = $('.editor-pane');
  const topActions = $('.top-actions');
  if (editor) editor.inert = true;
  if (topActions) topActions.inert = true;
  btnPlay.disabled = true;
  seekEl.disabled = true;
  $('#exportOverlay').classList.remove('is-hidden');
  setExportProgress(0, `준비 중… (${W}×${H})`);
  $('#resultCard').classList.add('is-hidden');

  // AudioContext는 사용자 클릭 직후에 만들어야 iOS에서 잠기지 않는다.
  const AC = window.AudioContext || window.webkitAudioContext;
  exportCtx = AC ? new AC() : null;
  if (exportCtx) { exportCtx.resume().catch(() => {}); }

  try {
    await preloadImages();
    if (exportCtx) { try { await exportCtx.resume(); } catch (e) {} }

    exportStream = out.captureStream(30);
    let master = null;
    if (exportCtx) {
      try {
        const dest = exportCtx.createMediaStreamDestination();
        master = exportCtx.createGain();
        master.gain.value = 1;
        master.connect(dest);
        const audioTrack = dest.stream.getAudioTracks()[0];
        if (audioTrack) exportStream.addTrack(audioTrack);
      } catch (e) { console.warn('audio mix unavailable', e); }
    }

    const mime = exportMime.split(';')[0];
    const ext = mime === 'video/mp4' ? 'mp4' : 'webm';
    exportFileBase = `${safeName()}-${stamp()}.${ext}`;
    const bitrate = W >= 1080 ? 9000000 : 5000000;

    exportRec = new MediaRecorder(exportStream, {
      mimeType: exportMime,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 128000
    });
    exportRec.ondataavailable = e => { if (e.data && e.data.size) exportChunks.push(e.data); };
    exportRec.onstop = () => finishExport(ext);
    exportRec.onerror = e => {
      console.error('MediaRecorder error', e);
      toast('녹화 중 오류가 났어요. 다시 시도해 주세요.', 'error');
      finalizeExportCleanup();
    };

    // 오디오를 미리 디코딩해 두고 녹화 시작과 함께 스케줄한다.
    let buffers = new Map();
    if (exportCtx) {
      try { await decodeAllInto(exportCtx, buffers); } catch (e) {}
    }
    if (exportCtx && master) {
      try { scheduleAudio(exportCtx, master, 0, buffers, []); } catch (e) { console.warn(e); }
    }

    exportRec.start(250);
    const wallStart = performance.now();
    const drawLoop = () => {
      if (!exporting) return;
      const t = (performance.now() - wallStart) / 1000;
      if (exportCancel) {
        try { exportRec.stop(); } catch (e) {}
        return;
      }
      if (t >= total) {
        drawFrame(Math.max(0, total - 0.001), octx, W, H);
        setExportProgress(1, '마무리 중…');
        setTimeout(() => { try { exportRec.stop(); } catch (e) {} }, 220);
        return;
      }
      drawFrame(t, octx, W, H);
      setExportProgress(t / total, `영상 만드는 중… ${Math.floor(t)} / ${Math.ceil(total)}초`);
      exportRaf = requestAnimationFrame(drawLoop);
    };
    exportRaf = requestAnimationFrame(drawLoop);
  } catch (e) {
    console.error('export failed', e);
    if (exportRec) {
      exportRec.onstop = null;
      try { if (exportRec.state !== 'inactive') exportRec.stop(); } catch (err) {}
    }
    toast('내보내기를 시작하지 못했어요: ' + (e.message || e), 'error');
    finalizeExportCleanup();
  }
}

function finishExport(ext) {
  const mime = exportMime.split(';')[0];
  const blob = new Blob(exportChunks, { type: mime });
  const wasCancelled = exportCancel;
  const filename = exportFileBase || `${safeName()}-${stamp()}.${ext}`;

  finalizeExportCleanup();

  if (wasCancelled) {
    toast('내보내기를 취소했어요.');
    return;
  }
  if (!blob.size) {
    toast('영상 파일이 비어 있어요. 다시 시도해 주세요.', 'error');
    return;
  }

  const url = URL.createObjectURL(blob);
  const video = $('#resultVideo');
  video.src = url;
  $('#resultMeta').textContent = `${ext.toUpperCase()} · ${(blob.size / 1048576).toFixed(1)}MB · ${formatTime(exportTotalSeconds || totalDuration())}`;
  const dl = $('#btnDownload');
  dl.href = url;
  dl.download = filename;
  $('#resultCard').classList.remove('is-hidden');

  // 자동 다운로드 (차단되면 결과 카드의 버튼으로 받을 수 있음)
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  toast('✅ 영상이 완성됐어요! 다운로드를 확인해 주세요.');
  if (isMobileView()) {
    setTimeout(() => $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }
}

function finalizeExportCleanup() {
  exporting = false;
  cancelAnimationFrame(exportRaf);
  if (exportStream) {
    try { exportStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  }
  if (exportCtx) {
    try { exportCtx.close(); } catch (e) {}
  }
  exportStream = null;
  exportCtx = null;
  exportRec = null;
  $('#exportOverlay').classList.add('is-hidden');
  $('#btnExport').disabled = false;
  btnPlay.disabled = false;
  seekEl.disabled = false;
  document.body.classList.remove('is-exporting');
  const editor = $('.editor-pane');
  const topActions = $('.top-actions');
  if (editor) editor.inert = false;
  if (topActions) topActions.inert = false;
  setExportProgress(0, '영상 만드는 중…');
}

$('#btnExport').addEventListener('click', exportVideo);
$('#btnCancelExport').addEventListener('click', () => {
  if (!exporting) return;
  exportCancel = true;
  try {
    if (exportRec && exportRec.state !== 'inactive') exportRec.stop();
  } catch (e) {}
});

/* ------------------------------------------------------------
   16. 프로젝트 초기화 · 샘플
   ------------------------------------------------------------ */
function resetProject() {
  if (!confirm('현재 작업을 지우고 새로 시작할까요? 자동 저장된 내용도 사라져요.')) return;
  stopPlayback();
  stopTts();
  clearMediaCache();
  project = blankProject();
  currentTime = 0;
  syncProjectUI();
  renderCutList();
  saveNow();
  toast('새 프로젝트를 시작했어요.');
}

function loadSampleProject() {
  const hasContent = project.cuts.some(c => (c.text || '').trim() || c.image || c.audio);
  if (hasContent && !confirm('샘플 1편으로 바꿀까요? 지금 작업은 사라져요.')) return;
  stopPlayback();
  stopTts();
  clearMediaCache();
  project = sampleProject();
  currentTime = 0;
  syncProjectUI();
  refreshVoices();
  renderCutList();
  saveNow();
  toast('샘플 1편을 불러왔어요. 바로 재생해 보세요!');
}

$('#btnReset').addEventListener('click', resetProject);
$('#btnAddCut').addEventListener('click', addCut);
$('#btnFirstCut').addEventListener('click', addCut);
$('#btnLoadSample').addEventListener('click', loadSampleProject);
$('#btnLoadSample2').addEventListener('click', loadSampleProject);
$('#btnExportJson').addEventListener('click', exportProjectJson);
$('#btnImport').addEventListener('click', () => $('#importJsonInput').click());
$('#importJsonInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) importProjectFile(file);
});

/* ------------------------------------------------------------
   17. 미니 미리보기 · 초기화
   ------------------------------------------------------------ */
function setupMiniPreview() {
  const mini = $('#miniPreview');
  const hideMini = () => {
    miniVisible = false;
    mini.classList.add('is-hidden');
  };
  $('#miniClose').addEventListener('click', e => {
    e.stopPropagation();
    miniDismissed = true;
    hideMini();
  });
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(entries => {
    const entry = entries[0];
    const shouldShow = !miniDismissed && !entry.isIntersecting && isMobileView() && project.cuts.length > 0;
    if (shouldShow === miniVisible) return;
    miniVisible = shouldShow;
    mini.classList.toggle('is-hidden', !shouldShow);
    if (shouldShow) drawAll(currentTime);
  }, { threshold: 0.12 });
  io.observe($('#stage'));
}

function setupKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (playing) pause(); else play();
    } else if (e.key === 'ArrowRight') {
      seekTo(currentTime + 1);
    } else if (e.key === 'ArrowLeft') {
      seekTo(currentTime - 1);
    }
  });
}

async function init() {
  project = loadSaved() || sampleProject();
  await hydrateMedia();
  syncProjectUI();
  renderCutList();
  setupMiniPreview();
  setupKeyboard();
  refreshVoices();
  if ('speechSynthesis' in window) {
    try { speechSynthesis.onvoiceschanged = refreshVoices; } catch (e) {}
    setTimeout(refreshVoices, 400);
  }
  // 이미지가 로드되면 다시 그리기
  project.cuts.forEach(c => {
    const url = imageUrl(c);
    if (url) loadImage(url).then(() => { if (!playing) drawAll(currentTime); });
  });
  // 저장된 프로젝트에 미디어가 있으면 미리 디코딩 없이 준비만
  window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); saveNow(); });
}

init().catch(err => {
  console.error(err);
  toast('앱을 시작하지 못했어요. 페이지를 새로고침해 주세요.', 'error');
});

/* 테스트·디버깅용 최소 핸들 (읽기 전용) */
window.__shortsMaker = {
  version: '1.0.0',
  getProject: () => serializeProject(),
  getState: () => ({ currentTime, playing, exporting, total: totalDuration(), cuts: project.cuts.length })
};
})();
