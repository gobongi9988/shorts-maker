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
const DEFAULT_STYLE = {
  fontSize: 56, position: 'bottom', bg: 'dark', weight: 800, effect: 'none',
  font: 'system', align: 'center', offsetY: 0,
  color: '#ffffff', outline: 0, outlineColor: '#000000', shadow: 35, bgColor: '#ffd54a'
};
const DEFAULT_OPTIONS = {
  kenBurns: true, motion: 'auto', transition: 'fade',
  resolution: '1080x1920', bgmVolume: 0.18, voiceVolume: 1, voiceRate: 1,
  sfxId: 'none', sfxVolume: 0.6, bgmFadeIn: 0, bgmFadeOut: 0
};
const STYLE_WEIGHTS = [400, 600, 700, 800, 900];
const WEIGHT_LABEL = { 400: '보통', 600: '굵게', 700: '더 굵게', 800: '아주 굵게', 900: '최대' };

/* 내장 한글 웹폰트 (Google Fonts) — canvas에도 같은 글꼴로 그린다 */
const FONT_DEFS = {
  system:   { label: '기본 고딕', family: '', stack: FONT_STACK, weight: '800' },
  notoSans: { label: '노토 산스', family: 'Noto Sans KR', stack: `'Noto Sans KR', ${FONT_STACK}`, weight: '800' },
  blackHan: { label: '검은고딕', family: 'Black Han Sans', stack: `'Black Han Sans', ${FONT_STACK}`, weight: '400' },
  doHyeon:  { label: '도현', family: 'Do Hyeon', stack: `'Do Hyeon', ${FONT_STACK}`, weight: '400' },
  jua:      { label: '주아', family: 'Jua', stack: `'Jua', ${FONT_STACK}`, weight: '400' },
  nanumPen: { label: '나눔손글씨', family: 'Nanum Pen Script', stack: `'Nanum Pen Script', ${FONT_STACK}`, weight: '400' },
  notoSerif:{ label: '노토 명조', family: 'Noto Serif KR', stack: `'Noto Serif KR', ${FONT_STACK}`, weight: '800' }
};
const FONT_KEYS = Object.keys(FONT_DEFS);
const loadedFonts = new Set();

/* 이미지 모션 */
const MOTION_KEYS = ['auto', 'none', 'zoomIn', 'zoomOut', 'panLR', 'panRL', 'shake'];
const MOTION_LABEL = {
  auto: '자동 Ken Burns',
  none: '고정',
  zoomIn: '천천히 줌인',
  zoomOut: '천천히 줌아웃',
  panLR: '좌→우 패닝',
  panRL: '우→좌 패닝',
  shake: '톡톡 흔들림'
};

/* 컷 전환 */
const TRANSITION_KEYS = ['cut', 'fade', 'slide'];
const TRANSITION_LABEL = { cut: '바로 전환(컷)', fade: '부드러운 페이드', slide: '슬라이드 전환' };
const TRANSITION_DUR = { cut: 0, fade: 0.45, slide: 0.4 };

/* 내장 효과음 */
const SFX_KEYS = ['none', 'ding', 'boing', 'boom', 'click', 'whoosh', 'tada'];
const SFX_LABEL = {
  none: '없음', ding: '띵! (알림)', boing: '띠용 (코믹)', boom: '두둥! (충격)',
  click: '찰칵', whoosh: '휙 (전환)', tada: '짜잔'
};
const SFX_DUR = { ding: 0.9, boing: 0.65, boom: 1.1, click: 0.28, whoosh: 0.55, tada: 1.0 };

/* 자막 등장 애니메이션 9종 */
const SUBTITLE_EFFECTS = ['none', 'pop', 'typing', 'highlight', 'slideUp', 'punch', 'zoomIn', 'shake', 'letterPop'];
const EFFECT_LABEL = {
  none: '고정',
  pop: '팝업 통통',
  typing: '타자기',
  highlight: '단어 강조',
  slideUp: '슬라이드 업',
  punch: '펀치 강조',
  zoomIn: '줌인 등장',
  shake: '흔들림 강조',
  letterPop: '한 글자씩 톡톡'
};
const EFFECT_DESC = {
  none: '효과 없이 그대로 표시',
  pop: '통통 튀어오르며 등장',
  typing: '한 글자씩 타다닥',
  highlight: '단어가 순서대로 형광 강조',
  slideUp: '아래에서 부드럽게 올라오며 페이드인',
  punch: '착 달라붙는 강조 + 미세한 흔들림',
  zoomIn: '작고 흐리게 시작해 확 커지며 등장',
  shake: '등장과 함께 톡톡 떨림',
  letterPop: '글자마다 톡톡 튀어나오며 등장'
};
const BG_VALUES = ['dark', 'light', 'none', 'color', 'pill'];
const ALIGN_VALUES = ['left', 'center', 'right'];

/* 목소리 톤 변조 프리셋 (재생 속도 + 이퀄라이저) */
const TONE_KEYS = ['normal', 'bright', 'deep', 'chipmunk', 'radio'];
const TONE_LABEL = {
  normal: '원본',
  bright: '하이톤',
  deep: '중저음',
  chipmunk: '다람쥐',
  radio: '라디오'
};
const TONE_DESC = {
  normal: '변조 없이 원본 그대로',
  bright: '높고 또렷한 썰톤 (속도 1.15배 + 고음 부스트)',
  deep: '낮고 묵직한 내레이션 (속도 0.88배 + 저음 부스트)',
  chipmunk: '빠르고 귀여운 다람쥐 톤 (속도 1.38배)',
  radio: '라디오·전화 통화 질감 (350~3,000Hz 대역만 통과)'
};
const TONE_PRESETS = {
  normal: { rate: 1, filters: [] },
  bright: {
    rate: 1.15,
    filters: [
      { type: 'highshelf', freq: 3200, gain: 6 },
      { type: 'peaking', freq: 2400, gain: 2.5, q: 1 },
      { type: 'highpass', freq: 110 }
    ]
  },
  deep: {
    rate: 0.88,
    filters: [
      { type: 'lowshelf', freq: 330, gain: 6 },
      { type: 'peaking', freq: 140, gain: 3, q: 1 },
      { type: 'lowpass', freq: 7200 }
    ]
  },
  chipmunk: { rate: 1.38, filters: [] },
  radio: {
    rate: 1,
    filters: [
      { type: 'highpass', freq: 350 },
      { type: 'lowpass', freq: 3000 },
      { type: 'peaking', freq: 1700, gain: 4, q: 0.9 }
    ]
  }
};

/* OpenAI AI 성우 (TTS) */
const OPENAI_KEY_LS = 'shorts-maker:openai-key:v1';
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const AI_VOICES = [
  { id: 'nova', label: '여성 · 밝고 또렷한' },
  { id: 'coral', label: '여성 · 생기있는' },
  { id: 'sage', label: '여성 · 차분한' },
  { id: 'shimmer', label: '여성 · 따뜻한' },
  { id: 'alloy', label: '중성 · 차분한' },
  { id: 'ash', label: '남성 · 깔끔한' },
  { id: 'echo', label: '남성 · 중저음' },
  { id: 'onyx', label: '남성 · 묵직한' },
  { id: 'fable', label: '내레이션 · 이야기톤' },
  { id: 'ballad', label: '남성 · 부드러운' }
];
const AI_VOICE_IDS = AI_VOICES.map(v => v.id);
/* tts-1 · tts-1-hd는 지원 목소리가 적다(ballad 등은 gpt-4o-mini-tts 전용) */
const MINI_ONLY_VOICES = ['ballad', 'verse', 'marin', 'cedar'];
const AI_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'];
const AI_TEXT_MAX = 4096;
const DEFAULT_AI = { voice: 'nova', speed: 1.05, model: 'tts-1', autoFit: true };

function normalizeEffect(v) { return SUBTITLE_EFFECTS.includes(v) ? v : 'none'; }
function normalizeTone(v) { return TONE_KEYS.includes(v) ? v : 'normal'; }
function normalizeMotion(v) { return MOTION_KEYS.includes(v) ? v : 'auto'; }
function normalizeTransition(v) { return TRANSITION_KEYS.includes(v) ? v : 'fade'; }
function normalizeSfx(v) { return SFX_KEYS.includes(v) ? v : 'none'; }
function normalizeFont(v) { return FONT_KEYS.includes(v) ? v : 'system'; }
function normalizeBg(v) { return BG_VALUES.includes(v) ? v : 'dark'; }
function normalizeAlign(v) { return ALIGN_VALUES.includes(v) ? v : 'center'; }
function hexColor(v, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : fallback;
}

/* 컷마다 저장한 스타일을 전체 스타일 위에 덮어 쓴다 */
function normalizeStyle(raw, base = DEFAULT_STYLE) {
  const s = raw || {};
  const b = { ...DEFAULT_STYLE, ...base };
  return {
    fontSize: clamp(parseInt(s.fontSize, 10) || b.fontSize, 24, 160),
    position: ['top', 'center', 'bottom'].includes(s.position) ? s.position : b.position,
    bg: normalizeBg(s.bg || b.bg),
    weight: STYLE_WEIGHTS.includes(Number(s.weight)) ? Number(s.weight) : b.weight,
    effect: s.effect === undefined ? normalizeEffect(b.effect) : normalizeEffect(s.effect),
    font: normalizeFont(s.font || b.font),
    align: normalizeAlign(s.align || b.align),
    offsetY: clamp(Number.isFinite(parseFloat(s.offsetY)) ? parseFloat(s.offsetY) : b.offsetY, -30, 30),
    color: hexColor(s.color, b.color),
    outline: clamp(Number.isFinite(parseFloat(s.outline)) ? parseFloat(s.outline) : b.outline, 0, 14),
    outlineColor: hexColor(s.outlineColor, b.outlineColor),
    shadow: clamp(Number.isFinite(parseFloat(s.shadow)) ? parseFloat(s.shadow) : b.shadow, 0, 100),
    bgColor: hexColor(s.bgColor, b.bgColor)
  };
}

/* 컷별 목소리 배속·볼륨 (값이 없으면 전체 설정을 따른다) */
function voiceRateFor(cut) {
  const own = cut && parseFloat(cut.voiceRate);
  const v = Number.isFinite(own) && own > 0 ? own : (parseFloat(project && project.options && project.options.voiceRate) || 1);
  return clamp(v, 0.8, 1.5);
}
function voiceVolumeFor(cut) {
  const own = cut && parseFloat(cut.voiceVolume);
  if (Number.isFinite(own) && own >= 0) return clamp(own, 0, 1);
  return clamp((project && project.options && project.options.voiceVolume != null) ? project.options.voiceVolume : 1, 0, 1);
}
function motionFor(cut, index) {
  const own = cut && cut.motion;
  const v = own ? normalizeMotion(own) : normalizeMotion(project.options.motion);
  return v;
}
function transitionFor(cut) {
  const own = cut && cut.transition;
  return own ? normalizeTransition(own) : normalizeTransition(project.options.transition);
}
function sfxFor(cut) {
  const own = cut && cut.sfx;
  if (own && own.id) return { id: normalizeSfx(own.id), volume: clamp(own.volume != null ? own.volume : (project.options.sfxVolume ?? 0.6), 0, 1) };
  return { id: normalizeSfx(project.options.sfxId), volume: clamp(project.options.sfxVolume ?? 0.6, 0, 1) };
}
function toneFor(cut) {
  return TONE_PRESETS[normalizeTone(cut && cut.tone)] || TONE_PRESETS.normal;
}
/* 톤 변조·배속 후 실제 타임라인에서 차지하는 길이 */
function tonalPlaybackRate(cut) {
  return toneFor(cut).rate * voiceRateFor(cut);
}
function tonalDuration(rawSeconds, cut) {
  const d = Math.max(0, Number(rawSeconds) || 0);
  return d / tonalPlaybackRate(cut);
}
const easeOutCubic = u => 1 - Math.pow(1 - u, 3);

const SAMPLE_01_CUTS = [
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

const SAMPLE_02_CUTS = [
  {
    text: '공항에 친구 데리러 갔다가\n150만 원 물어낼 뻔한 썰',
    duration: 4
  },
  {
    text: '새벽 6시에 데리러 오라길래\n30분이나 기다렸는데 연락 두절',
    duration: 9
  },
  {
    text: '출근해야 해서 먼저 갔더니\n1시간 뒤 전화 와서 난리',
    duration: 8
  },
  {
    text: '알고 보니 친구 부부가\n날짜 착각해 놓고 적반하장',
    duration: 9
  },
  {
    text: '바로 손절하고 차단 박음\n한마디 하고 차단 vs 그냥 차단?',
    duration: 6
  }
];

const SAMPLES = {
  'sample-01': {
    id: 'sample-01',
    name: '쇼츠 1편 · 10억 다이아를 삼킨 도둑',
    assetDir: 'assets/sample-01',
    cuts: SAMPLE_01_CUTS
  },
  'sample-02': {
    id: 'sample-02',
    name: '쇼츠 2편 · 공항 픽업 150만 원 썰',
    assetDir: 'assets/sample-02',
    cuts: SAMPLE_02_CUTS
  }
};
const DEFAULT_SAMPLE_ID = 'sample-01';

function newCut(partial = {}) {
  return {
    id: uid('cut'),
    text: '',
    duration: 3,
    autoFit: true,
    image: null,
    audio: null,
    tone: 'normal',
    style: null,
    motion: null,
    transition: null,
    sfx: null,
    voiceRate: null,
    voiceVolume: null,
    ...partial
  };
}

function isMobileView() {
  return window.matchMedia('(max-width: 980px)').matches;
}

/* ------------------------------------------------------------
   웹폰트 로딩 — canvas에 정확히 그리려면 먼저 글꼴이 준비돼야 한다.
   ------------------------------------------------------------ */
function fontStackFor(key) {
  return (FONT_DEFS[normalizeFont(key)] || FONT_DEFS.system).stack;
}
function fontSpec(key) {
  const f = FONT_DEFS[normalizeFont(key)] || FONT_DEFS.system;
  return f;
}
async function ensureFontLoaded(key) {
  const f = fontSpec(key);
  if (!f.family || !document.fonts) return true;
  const id = f.family;
  try {
    // 굵기별로 실제 사용할 글꼴을 명시적으로 요청해야 canvas 첫 프레임에 바뀐 글꼴이 찍힌다.
    await Promise.all([
      document.fonts.load(`400 48px "${f.family}"`, '가나다 ABC 123'),
      document.fonts.load(`800 48px "${f.family}"`, '가나다 ABC 123'),
      document.fonts.load(`900 48px "${f.family}"`, '가나다 ABC 123')
    ]);
    loadedFonts.add(id);
    return document.fonts.check(`400 48px "${f.family}"`);
  } catch (e) {
    return false;
  }
}
async function ensureAllFontsLoaded() {
  if (!document.fonts) return;
  const keys = FONT_KEYS.filter(k => FONT_DEFS[k].family);
  await Promise.all(keys.map(k => ensureFontLoaded(k)));
  try { await document.fonts.ready; } catch (e) {}
}
function isFontReady(key) {
  const f = fontSpec(key);
  if (!f.family) return true;
  if (!document.fonts) return false;
  try { return document.fonts.check(`400 48px "${f.family}"`, '가나다'); } catch (e) { return false; }
}

function sampleProject(id = DEFAULT_SAMPLE_ID) {
  const sample = SAMPLES[id] || SAMPLES[DEFAULT_SAMPLE_ID];
  return {
    preset: sample.id,
    name: sample.name,
    style: { ...DEFAULT_STYLE },
    options: { ...DEFAULT_OPTIONS, resolution: isMobileView() ? '720x1280' : '1080x1920' },
    tts: { voiceURI: '', rate: 1, pitch: 1 },
    aiVoice: { ...DEFAULT_AI },
    bgm: null,
    cuts: sample.cuts.map((c, i) => newCut({
      text: c.text,
      duration: c.duration,
      image: { src: `${sample.assetDir}/cut${i + 1}.png`, name: `cut${i + 1}.png` }
    }))
  };
}

function blankProject() {
  return {
    preset: null,
    name: '내 쇼츠',
    style: { ...DEFAULT_STYLE },
    options: { ...DEFAULT_OPTIONS, resolution: isMobileView() ? '720x1280' : '1080x1920' },
    tts: { voiceURI: '', rate: 1, pitch: 1 },
    aiVoice: { ...DEFAULT_AI },
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
  if (cut && cut.style) return normalizeStyle(cut.style, base);
  return normalizeStyle(base, DEFAULT_STYLE);
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

const easeOutBack = u => {
  const c1 = 1.70158, c3 = c1 + 1;
  const x = clamp(u, 0, 1);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

function hexToRgba(hex, a) {
  const h = hexColor(hex, '#ffffff').slice(1);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* 카메라(모션) — scale 1 이상, x/y는 -1~1 (확대된 여백 안에서의 위치) */
function cameraFor(cut, index, p, localT) {
  const motion = motionFor(cut, index);
  const q = clamp(p, 0, 1);
  switch (motion) {
    case 'none':
      return { scale: 1, x: 0, y: 0 };
    case 'zoomIn':
      return { scale: 1.02 + 0.10 * q, x: 0, y: 0 };
    case 'zoomOut':
      return { scale: 1.12 - 0.10 * q, x: 0, y: 0 };
    case 'panLR':
      return { scale: 1.16, x: 1 - 2 * q, y: 0 };
    case 'panRL':
      return { scale: 1.16, x: -1 + 2 * q, y: 0 };
    case 'shake': {
      const decay = Math.max(0, 1 - localT / 0.9);
      const amp = 0.11 * decay * decay;
      return { scale: 1.08 + 0.02 * q, x: Math.sin(localT * 42) * amp, y: Math.cos(localT * 33) * amp * 0.6 };
    }
    default: /* auto — 기존 Ken Burns */
      return { scale: index % 2 === 0 ? 1.02 + 0.06 * q : 1.08 - 0.06 * q, x: 0, y: 0 };
  }
}

function drawCover(ctx, img, W, H, cam) {
  const c = cam || { scale: 1, x: 0, y: 0 };
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const ir = iw / ih;
  const cr = W / H;
  let dw, dh;
  if (ir > cr) { dh = H; dw = H * ir; }
  else { dw = W; dh = W / ir; }
  const s = Math.max(1, c.scale || 1);
  dw *= s; dh *= s;
  const ox = dw - W, oy = dh - H;
  const dx = (W - dw) / 2 + (c.x || 0) * ox / 2;
  const dy = (H - dh) / 2 + (c.y || 0) * oy / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
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

function drawSubtitle(ctx, cut, W, H, localTime = 0, cutDuration = 1) {
  const fullText = (cut && cut.text ? cut.text : '').trim();
  if (!fullText) return;
  const st = styleFor(cut);
  const effect = normalizeEffect(st.effect);
  const scale = W / DESIGN_W;
  const fontSize = Math.max(8, st.fontSize * scale);
  const weight = STYLE_WEIGHTS.includes(Number(st.weight)) ? Number(st.weight) : 800;
  const family = fontStackFor(st.font);
  const maxWidth = W * 0.88;
  const t = Math.max(0, Number(localTime) || 0);
  const dur = Math.max(0.2, Number(cutDuration) || 0.2);
  const bgStyle = normalizeBg(st.bg);
  const isBox = bgStyle !== 'none';
  const align = normalizeAlign(st.align);
  const shadowK = clamp((Number(st.shadow) || 0) / 100, 0, 1);

  /* --- 효과별 등장 파라미터 (미리보기·내보내기 공통, 컷 안의 경과 시간 기준) --- */
  let alpha = 1, kScale = 1, dx = 0, dy = 0;
  let drawText = fullText;
  let hlCount = -1;          // highlight: 앞에서 몇 개 단어까지 강조할지
  let letterMode = false;

  if (effect === 'pop') {
    // 0.3초 동안 0.65 → 1.08 → 1.0 탄성 바운스
    const k = clamp(t / 0.3, 0, 1);
    alpha = clamp(t / 0.1, 0, 1);
    kScale = k < 0.6
      ? 0.65 + 0.43 * easeOutCubic(k / 0.6)
      : 1.08 - 0.08 * easeOutCubic((k - 0.6) / 0.4);
  } else if (effect === 'zoomIn') {
    // 작고 흐리게 시작해 확 커지며 등장
    const k = clamp(t / 0.45, 0, 1);
    kScale = 0.42 + 0.58 * easeOutBack(k);
    alpha = clamp(t / 0.16, 0, 1);
  } else if (effect === 'slideUp') {
    // 아래에서 28px 올라오며 페이드인
    const k = easeOutCubic(clamp(t / 0.35, 0, 1));
    alpha = k;
    dy = (1 - k) * 28 * scale;
  } else if (effect === 'punch') {
    // 살짝 커졌다가 착 붙고, 컷 시작에 미세한 흔들림
    const k = clamp(t / 0.18, 0, 1);
    kScale = 1.08 - 0.08 * easeOutCubic(k);
    alpha = clamp(t / 0.08, 0, 1);
    const shake = t < 0.3 ? 1 - t / 0.3 : 0;
    dx = Math.sin(t * 78) * 5 * scale * shake;
    dy = Math.cos(t * 63) * 2 * scale * shake;
  } else if (effect === 'shake') {
    // 등장하며 톡톡 떨리고 잦아든다
    alpha = clamp(t / 0.08, 0, 1);
    const decay = Math.max(0, 1 - t / 0.75);
    const amp = (7 * decay * decay + 1.2) * scale;
    dx = Math.sin(t * 52) * amp;
    dy = Math.cos(t * 41) * amp * 0.55;
  } else if (effect === 'typing') {
    // 컷 앞부분에서 한 글자씩 (10~45자/초)
    const chars = Array.from(fullText);
    const cps = clamp(chars.length / Math.max(0.8, dur * 0.45), 10, 45);
    const n = Math.floor(t * cps);
    if (n <= 0) return;
    drawText = chars.slice(0, n).join('');
  } else if (effect === 'highlight') {
    // 컷이 흐르는 동안 단어가 순서대로 형광 강조
    const words = fullText.split(/\s+/).filter(Boolean).length;
    const k = clamp((t - 0.1) / Math.max(0.6, dur * 0.75), 0, 1);
    hlCount = Math.ceil(k * words);
  } else if (effect === 'letterPop') {
    letterMode = true;
  }

  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (alpha < 1) ctx.globalAlpha = clamp(alpha, 0, 1);

  const lines = wrapText(ctx, drawText, maxWidth);
  const lh = fontSize * 1.34;
  const blockH = Math.max(lh, lines.length * lh);
  const marginX = W * 0.06;
  const anchorX = align === 'left' ? marginX : align === 'right' ? W - marginX : W / 2;

  let top;
  if (st.position === 'top') top = H * 0.085;
  else if (st.position === 'center') top = (H - blockH) / 2;
  else top = H - H * 0.135 - blockH;
  top += H * (Number(st.offsetY) || 0) / 100;
  top = clamp(top, H * 0.035, Math.max(H * 0.035, H - blockH - H * 0.035));

  const padX = fontSize * 0.46;
  const padY = fontSize * 0.22;

  /* 확대·이동은 자막 덩어리 기준점을 중심으로 적용 */
  if (kScale !== 1 || dx || dy) {
    const cy = top + blockH / 2;
    ctx.translate(anchorX + dx, cy + dy);
    ctx.scale(kScale, kScale);
    ctx.translate(-anchorX, -cy);
  }

  const lineWidths = lines.map(l => ctx.measureText(l || ' ').width);
  const maxLineW = Math.max(1, ...lineWidths);

  // 배경 박스는 줄마다 따로 그리지 않고 한 덩어리로 그려 깔끔하게 유지한다.
  if (isBox) {
    const boxW = Math.min(maxLineW + padX * 2, maxWidth + padX * 2);
    const boxH = blockH + padY * 2;
    const bx = align === 'left' ? anchorX - padX
      : align === 'right' ? anchorX + padX - boxW
        : W / 2 - boxW / 2;
    const radius = bgStyle === 'pill' ? boxH / 2 : fontSize * 0.24;
    let fill = 'rgba(8,9,12,0.68)';
    if (bgStyle === 'light') fill = 'rgba(255,255,255,0.93)';
    else if (bgStyle === 'color') fill = hexToRgba(st.bgColor, 0.86);
    else if (bgStyle === 'pill') fill = hexToRgba(st.bgColor, 0.92);
    ctx.save();
    ctx.fillStyle = fill;
    roundRect(ctx, bx, top - padY, boxW, boxH, radius);
    ctx.fill();
    ctx.restore();
  }

  const outlinePx = (Number(st.outline) || 0) * scale;
  // 박스 없이 사진 위에 얹을 때는 최소한의 외곽선을 자동으로 넣어 읽히게 한다.
  const strokeW = bgStyle === 'none' ? Math.max(outlinePx, fontSize * 0.10) : outlinePx;
  const baseColor = st.color;

  const setShadow = on => {
    if (on && shadowK > 0) {
      ctx.shadowColor = `rgba(0,0,0,${(0.72 * shadowK).toFixed(3)})`;
      ctx.shadowBlur = fontSize * 0.42 * shadowK;
      ctx.shadowOffsetY = fontSize * 0.07 * shadowK;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  };
  const strokeTextAt = (text, x, y, limit) => {
    if (strokeW <= 0.2) return;
    setShadow(false);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = st.outlineColor;
    ctx.lineWidth = strokeW;
    if (limit) ctx.strokeText(text, x, y, limit);
    else ctx.strokeText(text, x, y);
  };
  const paintText = (text, x, y, limit) => {
    strokeTextAt(text, x, y, limit);
    setShadow(true);
    ctx.fillStyle = baseColor;
    if (limit) ctx.fillText(text, x, y, limit);
    else ctx.fillText(text, x, y);
    setShadow(false);
  };

  if (effect === 'highlight') {
    // 단어 단위로 배치해 강조된 단어만 형광펜으로 그린다.
    const spaceW = ctx.measureText(' ').width;
    ctx.textAlign = 'left';
    let wordIndex = 0;
    lines.forEach((line, i) => {
      if (!line) return;
      const y = top + i * lh + lh / 2;
      const words = line.split(/\s+/).filter(Boolean);
      const widths = words.map(w => ctx.measureText(w).width);
      const totalW = widths.reduce((a, b) => a + b, 0) + spaceW * Math.max(0, words.length - 1);
      let x = align === 'left' ? anchorX : align === 'right' ? anchorX - totalW : anchorX - totalW / 2;
      words.forEach((word, j) => {
        const active = wordIndex + j < hlCount;
        const cw = widths[j];
        if (active) {
          ctx.save();
          ctx.fillStyle = 'rgba(255,225,77,.95)';
          roundRect(ctx, x - fontSize * 0.06, y - fontSize * 0.62, cw + fontSize * 0.12, fontSize * 1.24, fontSize * 0.15);
          ctx.fill();
          ctx.restore();
          ctx.save();
          ctx.fillStyle = '#141414';
          setShadow(false);
          ctx.fillText(word, x, y);
          ctx.restore();
        } else {
          paintText(word, x, y);
        }
        x += cw + spaceW;
      });
      wordIndex += words.length;
    });
  } else if (letterMode) {
    // 글자마다 톡톡 튀어나오는 등장
    let gi = 0;
    lines.forEach((line, i) => {
      if (!line) return;
      const y = top + i * lh + lh / 2;
      const chars = Array.from(line);
      const widths = chars.map(ch => ctx.measureText(ch).width);
      const totalW = widths.reduce((a, b) => a + b, 0);
      let x = align === 'left' ? anchorX : align === 'right' ? anchorX - totalW : anchorX - totalW / 2;
      ctx.textAlign = 'center';
      chars.forEach((ch, j) => {
        const w = widths[j];
        const cx = x + w / 2;
        const delay = gi * 0.035;
        const k = clamp((t - delay) / 0.22, 0, 1);
        if (ch.trim() && k > 0) {
          const sc = 0.35 + 0.65 * easeOutBack(k);
          ctx.save();
          ctx.translate(cx, y);
          ctx.scale(sc, sc);
          ctx.globalAlpha = clamp(alpha * Math.min(1, k * 1.6), 0, 1);
          paintText(ch, 0, 0);
          ctx.restore();
        }
        x += w;
        gi++;
      });
    });
  } else {
    ctx.textAlign = align;
    lines.forEach((line, i) => {
      if (!line) return;
      const y = top + i * lh + lh / 2;
      paintText(line, anchorX, y, maxWidth);
    });
  }
  ctx.restore();
}

/* 장면 하나(이미지+모션+자막)를 그린다. 전환 효과에서 두 장면을 겹칠 때도 쓴다. */
const sceneBuffers = new Map();
function sceneBuffer(key, W, H) {
  const id = `${key}:${W}x${H}`;
  let b = sceneBuffers.get(id);
  if (!b) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    b = { canvas: c, ctx: c.getContext('2d') };
    sceneBuffers.set(id, b);
  }
  return b;
}

function renderScene(ctx, index, localT, W, H, opts) {
  const cut = project.cuts[index];
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!cut) { ctx.restore(); return; }
  const dur = Math.max(0.5, Number(cut.duration) || 0.5);
  const p = clamp(localT / dur, 0, 1);
  const url = imageUrl(cut);
  if (url) {
    const rec = imgCache.get(url);
    if (rec && rec.ok) {
      drawCover(ctx, rec.img, W, H, cameraFor(cut, index, p, localT));
    } else {
      drawImagePlaceholder(ctx, W, H);
      // 이미지가 늦게 로드되면 한 번 다시 그린다.
      loadImage(url).then(img => {
        if (img && !playing && !exporting) drawAll(currentTime);
      });
    }
  } else {
    drawImagePlaceholder(ctx, W, H);
  }
  /* 정지 상태에서 컷 시작(0초)에 서 있으면 등장 모션이 아직 0프레임이라
     자막이 안 보인다. 편집 중에는 자리 잡은 모습을 보여 준다. */
  const settle = !!(opts && opts.settle) && localT < 0.06;
  drawSubtitle(ctx, cut, W, H, settle ? Math.min(dur, 0.6) : localT, dur);
  ctx.restore();
}

function drawFrame(t, ctx, W, H) {
  ctx.save();
  const cuts = project ? project.cuts : [];
  if (!cuts.length) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawImagePlaceholder(ctx, W, H);
    ctx.restore();
    return;
  }

  const pos = locate(t);
  const trans = transitionFor(pos.cut);
  const trDur = TRANSITION_DUR[trans] || 0;

  // 컷이 바뀌는 앞부분에서는 이전 컷과 현재 컷을 겹쳐 그린다.
  if (pos.index > 0 && trDur > 0 && pos.local < trDur) {
    const k = clamp(pos.local / trDur, 0, 1);
    const prevIdx = pos.index - 1;
    const prevDur = Math.max(0.5, Number(cuts[prevIdx].duration) || 0.5);
    const a = sceneBuffer('prev', W, H);
    const b = sceneBuffer('cur', W, H);
    const settleNow = !playing && !exporting;
    renderScene(a.ctx, prevIdx, prevDur - 0.001, W, H, { settle: settleNow });
    renderScene(b.ctx, pos.index, pos.local, W, H, { settle: settleNow });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (trans === 'slide') {
      const e = easeOutCubic(k);
      ctx.drawImage(a.canvas, -W * 0.28 * e, 0);
      ctx.drawImage(b.canvas, W * (1 - e), 0);
    } else {
      ctx.globalAlpha = 1;
      ctx.drawImage(a.canvas, 0, 0);
      ctx.globalAlpha = k;
      ctx.drawImage(b.canvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    return;
  }

  renderScene(ctx, pos.index, pos.local, W, H, { settle: !playing && !exporting });
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

/* 톤 프리셋의 필터 체인을 소스에 연결하고 마지막 노드를 돌려준다. */
function attachToneChain(ctx, src, tone) {
  let node = src;
  for (const f of tone.filters || []) {
    try {
      const bq = ctx.createBiquadFilter();
      bq.type = f.type;
      bq.frequency.value = f.freq;
      if (f.gain != null) bq.gain.value = f.gain;
      if (f.q != null) bq.Q.value = f.q;
      node.connect(bq);
      node = bq;
    } catch (e) { console.warn('톤 필터를 만들지 못했어요', e); }
  }
  return node;
}

/* ---------- 내장 효과음 합성 (Web Audio) ---------- */
/* 외부 파일 없이 오실레이터·노이즈를 직접 계산해 만든다. */
const sfxCache = new Map();   // `${id}@${sampleRate}` -> AudioBuffer

function buildSfxBuffer(ctx, id) {
  const sr = ctx.sampleRate;
  const dur = SFX_DUR[id] || 0.5;
  const len = Math.max(1, Math.ceil(dur * sr));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const TAU = Math.PI * 2;
  let lp = 0, lp2 = 0, prevNoise = 0, ph = 0, ph2 = 0;
  const noise = () => Math.random() * 2 - 1;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    if (id === 'ding') {
      const env = Math.exp(-t * 5.2) * Math.min(1, t / 0.004);
      s = Math.sin(TAU * 1046.5 * t) * 0.62
        + Math.sin(TAU * 1568 * t) * 0.3 * Math.exp(-t * 3)
        + Math.sin(TAU * 2093 * t) * 0.14 * Math.exp(-t * 6);
      s *= env;
    } else if (id === 'boing') {
      const env = Math.exp(-t * 4.2) * Math.min(1, t / 0.005);
      const f = 170 + 640 * Math.exp(-t * 5.5) + 55 * Math.sin(TAU * 13 * t);
      ph += TAU * f / sr;
      s = (Math.sin(ph) * 0.78 + Math.sin(ph * 2) * 0.12) * env;
    } else if (id === 'boom') {
      const env = Math.exp(-t * 3.0) * Math.min(1, t / 0.006);
      const f = 34 + 66 * Math.exp(-t * 4);
      ph2 += TAU * f / sr;
      const n = noise();
      lp += 0.010 * (n - lp);
      s = Math.sin(ph2) * env * 0.82 + lp * Math.exp(-t * 7) * 2.6;
    } else if (id === 'click') {
      const n = noise();
      const hp = n - prevNoise;
      prevNoise = n;
      const hit = (t0, amp) => {
        if (t < t0) return 0;
        const u = t - t0;
        return Math.exp(-u * 90) * Math.min(1, u / 0.001) * amp;
      };
      s = (hit(0, 0.85) + hit(0.055, 0.62)) * hp * 1.1;
    } else if (id === 'whoosh') {
      const u = clamp(t / dur, 0, 1);
      const env = Math.sin(Math.PI * u) ** 2;
      const cutoff = 400 + 5200 * Math.sin(Math.PI * u);
      const a = clamp(cutoff / sr * 1.2, 0.002, 0.9);
      const n = noise();
      lp += a * (n - lp);
      lp2 += 0.09 * (lp - lp2);
      s = (lp - lp2) * env * 1.15;
    } else if (id === 'tada') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const starts = [0, 0.09, 0.18, 0.27];
      for (let k = 0; k < notes.length; k++) {
        if (t < starts[k]) continue;
        const u = t - starts[k];
        const env = Math.exp(-u * (k === 3 ? 2.2 : 6)) * Math.min(1, u / 0.004);
        s += Math.sin(TAU * notes[k] * u) * env * (k === 3 ? 0.5 : 0.4);
        if (k === 3) s += Math.sin(TAU * notes[k] * 2 * u) * env * 0.1;
      }
    }
    // 마지막 6ms는 부드럽게 (딸깍 소리 방지)
    const tail = (len - i) / (sr * 0.006);
    d[i] = s * clamp(tail, 0, 1);
  }

  // 피크 정규화
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) {
    const k = 0.88 / peak;
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return buf;
}

function sfxBuffer(ctx, id) {
  if (!id || id === 'none') return null;
  if (!SFX_DUR[id]) return null;
  const key = `${id}@${ctx.sampleRate}`;
  if (!sfxCache.has(key)) {
    try { sfxCache.set(key, buildSfxBuffer(ctx, id)); } catch (e) { console.warn('효과음을 만들지 못했어요', e); return null; }
  }
  return sfxCache.get(key);
}

/* 효과음 미리듣기 (편집 중 ▶ 효과음 재생) */
function previewSfx(id, volume) {
  const ctx = getAudioCtx();
  if (!ctx) return false;
  const buf = sfxBuffer(ctx, id);
  if (!buf) return false;
  try {
    ctx.resume().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = clamp(volume == null ? 0.6 : volume, 0, 1);
    src.connect(gain).connect(ctx.destination);
    src.start();
    return true;
  } catch (e) {
    console.warn('효과음 재생 실패', e);
    return false;
  }
}

function scheduleAudio(ctx, destination, fromTime, buffers = audioBuffers, nodes = activeSources) {
  const cuts = project.cuts;
  const total = totalDuration();
  const lead = 0.06;
  const now = ctx.currentTime + lead;
  let acc = 0;

  for (const cut of cuts) {
    const dur = Math.max(0.5, Number(cut.duration) || 0.5);
    if (cut.audio && cut.audio.key) {
      const buf = buffers.get(cut.audio.key);
      const tone = toneFor(cut);
      const rate = tonalPlaybackRate(cut);
      // 톤·배속이 적용된 뒤 타임라인에서 차지하는 길이
      const clipDur = buf ? buf.duration / rate : 0;
      if (buf && acc + dur > fromTime && clipDur > 0) {
        const offset = Math.max(0, fromTime - acc);
        if (offset < clipDur) {
          try {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.playbackRate.value = rate;
            const gain = ctx.createGain();
            gain.gain.value = voiceVolumeFor(cut);
            attachToneChain(ctx, src, tone).connect(gain).connect(destination);
            // 컷 길이를 넘어 다음 컷으로 소리가 새지 않도록 잘라서 재생한다.
            // start()의 offset/duration은 버퍼 시간 기준이므로 배속을 곱해 환산한다.
            const remainingInCut = dur - offset;
            const playDur = Math.max(0.02, Math.min(clipDur - offset, remainingInCut));
            src.start(now + Math.max(0, acc - fromTime), offset * rate, playDur * rate);
            nodes.push(src);
          } catch (e) { console.warn('음성 재생 실패', e); }
        }
      }
    }

    // 컷 시작 지점의 효과음
    const sfx = sfxFor(cut);
    if (sfx.id !== 'none' && acc >= fromTime - 0.02 && acc < total) {
      const buf = sfxBuffer(ctx, sfx.id);
      if (buf) {
        try {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          const gain = ctx.createGain();
          gain.gain.value = clamp(sfx.volume, 0, 1);
          src.connect(gain).connect(destination);
          src.start(now + Math.max(0, acc - fromTime));
          nodes.push(src);
        } catch (e) { console.warn('효과음 재생 실패', e); }
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
        const vol = clamp(project.options.bgmVolume ?? 0.2, 0, 1);
        const gain = ctx.createGain();
        const fadeIn = clamp(Number(project.options.bgmFadeIn) || 0, 0, 3);
        const fadeOut = clamp(Number(project.options.bgmFadeOut) || 0, 0, 3);
        const remain = Math.max(0, total - fromTime);
        gain.gain.setValueAtTime(vol, now);
        if (fadeIn > 0 && fromTime < fadeIn) {
          gain.gain.setValueAtTime(vol * clamp(fromTime / fadeIn, 0, 1), now);
          gain.gain.linearRampToValueAtTime(vol, now + Math.max(0.01, fadeIn - fromTime));
        }
        if (fadeOut > 0 && remain <= fadeOut) {
          const startFade = Math.max(0, remain - fadeOut);
          gain.gain.setValueAtTime(vol, now + startFade);
          gain.gain.linearRampToValueAtTime(0, now + remain);
        }
        src.connect(gain).connect(destination);
        const offset = bgmBuf.duration ? (fromTime % bgmBuf.duration) : 0;
        src.start(now, offset);
        nodes.push(src);
        if (nodes === activeSources) previewBgmGain = gain;
      } catch (e) { console.warn('BGM 재생 실패', e); }
    }
  }
}

function elementAudioDuration(url, timeout = 4000) {
  // audio 엘리먼트 메타데이터 (MediaRecorder webm은 Infinity인 경우가 있음)
  return new Promise(resolve => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    let done = false;
    const finish = v => { if (done) return; done = true; a.src = ''; resolve(v); };
    a.onloadedmetadata = () => finish(isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
    a.onerror = () => finish(0);
    a.src = url;
    try { a.load(); } catch (e) {}
    setTimeout(() => finish(0), timeout);
  });
}

async function decodedAudioDuration(blob) {
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

async function audioDuration(blob, url, preferDecode = false) {
  /* AI 성우처럼 짧은 음성은 디코딩이 가장 확실하다. 길게 잡히는 파일(BGM)은 메타데이터를 먼저 본다. */
  if (preferDecode) {
    const d = await decodedAudioDuration(blob);
    if (d > 0) return d;
    const e1 = await elementAudioDuration(url);
    if (e1 > 0) return e1;
    return await elementAudioDuration(url, 8000);
  }
  const d = await elementAudioDuration(url);
  if (d > 0) return d;
  const decoded = await decodedAudioDuration(blob);
  if (decoded > 0) return decoded;
  return await elementAudioDuration(url, 8000);
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
   8-B. OpenAI AI 성우 (TTS API)
   브라우저에서 api.openai.com으로 직접 호출해 MP3를 받고,
   기존 업로드 음성과 똑같이 IndexedDB에 저장한다.
   ------------------------------------------------------------ */
const aiBusyCuts = new Set();      // 생성 중인 컷 id
let aiBatch = null;                // {running, cancel, total, done, failed, controller}
let aiProgressTimer = null;

function aiSettings() {
  const src = (project && project.aiVoice) || {};
  return {
    voice: AI_VOICE_IDS.includes(src.voice) ? src.voice : DEFAULT_AI.voice,
    speed: clamp(parseFloat(src.speed) || DEFAULT_AI.speed, 0.75, 1.4),
    model: AI_MODELS.includes(src.model) ? src.model : DEFAULT_AI.model,
    autoFit: src.autoFit !== false
  };
}

function getApiKey() {
  try { return localStorage.getItem(OPENAI_KEY_LS) || ''; } catch (e) { return ''; }
}
/* 방금 입력한 값이 있으면 그것을, 없으면 저장해 둔 키를 쓴다. */
function effectiveKey() {
  const typed = ($('#openaiKey') && $('#openaiKey').value || '').trim();
  return typed || getApiKey();
}
function maskKey(k) {
  if (!k) return '';
  return k.length <= 10 ? k.slice(0, 3) + '…' : `${k.slice(0, 3)}…${k.slice(-4)}`;
}
function refreshKeyUI() {
  const stored = getApiKey();
  const input = $('#openaiKey');
  /* 입력 중인 값을 되돌리지 않는다. 비어 있을 때만 저장된 키를 채운다. */
  if (input && !input.value && stored) input.value = stored;
  const typed = ((input && input.value) || '').trim();
  const state = $('#keyState');
  if (!state) return;
  if (typed && typed !== stored) {
    state.textContent = '이번만 사용 · 계속 쓰려면 키 저장';
    state.classList.remove('on');
  } else if (stored) {
    state.textContent = `브라우저에 저장됨 · ${maskKey(stored)}`;
    state.classList.add('on');
  } else {
    state.textContent = '저장된 키 없음';
    state.classList.remove('on');
  }
  $('#btnClearKey').disabled = !stored;
}
function saveApiKey() {
  const v = ($('#openaiKey').value || '').trim();
  if (!v) { toast('OpenAI API 키를 입력해 주세요.'); $('#openaiKey').focus(); return; }
  try {
    localStorage.setItem(OPENAI_KEY_LS, v);
    refreshKeyUI();
    toast(v.startsWith('sk-') ? 'API 키를 이 브라우저에 저장했어요.' : '키를 저장했어요. 보통 sk-로 시작해요.');
  } catch (e) {
    toast('키를 저장하지 못했어요: ' + (e.message || e), 'error');
  }
}
function clearApiKey() {
  try { localStorage.removeItem(OPENAI_KEY_LS); } catch (e) {}
  $('#openaiKey').value = '';
  refreshKeyUI();
  toast('저장한 API 키를 지웠어요.');
}

function syncAiUI() {
  if (!project) return;
  const s = aiSettings();
  const mini = s.model === 'gpt-4o-mini-tts';
  const sel = $('#aiVoice');
  $$('option', sel).forEach(o => { o.disabled = !!o.dataset.miniOnly && !mini; });
  if (!mini && MINI_ONLY_VOICES.includes(s.voice)) project.aiVoice.voice = DEFAULT_AI.voice;
  const cur = aiSettings();
  sel.value = cur.voice;
  $('#aiModel').value = cur.model;
  $('#aiSpeed').value = String(cur.speed);
  $('#aiSpeedOut').textContent = cur.speed.toFixed(2).replace(/0$/, '') + 'x';
  $('#aiAutoFit').checked = cur.autoFit;
  $('#aiVoiceSummary').textContent = `${cur.voice} · ${cur.speed.toFixed(2).replace(/0$/, '')}x`;
  refreshKeyUI();
}

function buildInstructions(s) {
  const pace = s.speed <= 0.88 ? '천천히' : s.speed <= 1.0 ? '조금 느긋하게' : s.speed <= 1.12 ? '조금 빠르게' : '빠르게';
  const voiceDesc = (AI_VOICES.find(v => v.id === s.voice) || {}).label || '';
  return `한국어 쇼츠 썰 영상의 내레이션입니다. ${voiceDesc} 느낌으로 ${pace} 또박또박 말해 주세요. ` +
    '광고 톤이나 과장된 감탄은 피하고, 옆에서 이야기해 주는 듯한 자연스러운 말투로 읽어 주세요.';
}

function speechTextFor(cut) {
  return String((cut && cut.text) || '').replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
}
function aiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

async function requestSpeech(text, s, signal) {
  const key = effectiveKey();
  if (!key) throw aiError('no-key', 'OpenAI API 키를 먼저 입력해 주세요.');
  if (!text) throw aiError('empty-text', '이 컷에 자막이 없어요. 자막을 먼저 입력해 주세요.');
  if (Array.from(text).length > AI_TEXT_MAX) {
    throw aiError('too-long', `한 컷 자막은 ${AI_TEXT_MAX}자까지 만들 수 있어요. 자막을 나눠 주세요.`);
  }
  const body = {
    model: s.model,
    voice: s.voice,
    input: text,
    response_format: 'mp3',
    speed: s.speed
  };
  /* gpt-4o-mini-tts만 톤 지시문(instructions)을 받는다. (speed는 이 모델에서 효과가 약함) */
  if (s.model === 'gpt-4o-mini-tts') body.instructions = buildInstructions(s);

  let res;
  try {
    res = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw aiError('network', 'OpenAI 서버에 연결하지 못했어요. 네트워크와 API 키를 확인해 주세요.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j && j.error && j.error.message) || '';
    } catch (e) { /* JSON이 아닌 오류 응답 */ }
    if (res.status === 401) throw aiError('auth', 'API 키가 올바르지 않아요(401). 키를 다시 확인해 주세요.');
    if (res.status === 403) throw aiError('forbidden', '이 키로는 음성 생성 권한이 없어요(403).');
    if (res.status === 404) throw aiError('model', '이 모델을 쓸 수 없어요(404). 모델을 바꿔 보세요.');
    if (res.status === 429) throw aiError('quota', '요청 한도나 크레딧이 부족해요(429). 잠시 뒤 다시 시도해 주세요.');
    if (res.status >= 500) throw aiError('server', `OpenAI 서버 오류(${res.status}). 잠시 뒤 다시 시도해 주세요.`);
    throw aiError('bad-request', `음성을 만들지 못했어요 (${res.status})${detail ? ' · ' + detail : ''}`);
  }
  const raw = await res.blob();
  if (!raw.size) throw aiError('empty', '음성이 비어 있어요. 다시 시도해 주세요.');
  /* OpenAI는 mp3로 돌려주지만, 응답 형식을 그대로 존중해 확장자를 맞춘다. */
  const type = raw.type && raw.type.startsWith('audio/') ? raw.type : 'audio/mpeg';
  return { blob: new Blob([raw], { type }), ext: extForMime(type) };
}

/* 한 컷의 자막을 AI 성우 음성으로 만들어 그 컷에 장착한다. */
async function generateCutVoice(cut, opts = {}) {
  const s = aiSettings();
  const text = speechTextFor(cut);
  aiBusyCuts.add(cut.id);
  renderCutList();
  try {
    const { blob, ext } = await requestSpeech(text, s, opts.signal);
    if (s.autoFit) cut.autoFit = true;
    const idx = project.cuts.indexOf(cut) + 1;
    const ok = await setCutAudio(cut, blob, `AI-${s.voice}-${idx}.${ext}`);
    if (!ok) throw aiError('save-failed', '음성을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.');
    return cut;
  } finally {
    aiBusyCuts.delete(cut.id);
    renderCutList();
  }
}

async function aiVoiceForCut(cut) {
  if (exporting) { toast('내보내는 중에는 만들 수 없어요. 끝난 뒤 다시 눌러 주세요.'); return; }
  if (aiBusyCuts.has(cut.id)) return;
  if (!effectiveKey()) {
    toast('OpenAI API 키를 먼저 입력해 주세요.', 'error');
    $('#aiVoicePanel').open = true;
    $('#openaiKey').focus();
    return;
  }
  pause();
  stopTts();
  try {
    await generateCutVoice(cut);
    const s = aiSettings();
    const d = cut.audio && cut.audio.duration;
    toast(`🎙️ AI 음성(${s.voice})을 넣었어요${d ? ` · ${d.toFixed(1)}초` : ''}. ▶ 로 들어보세요.`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast((e && e.message) || 'AI 음성을 만들지 못했어요.', 'error');
  }
}

function setAiProgress(done, total, label) {
  const box = $('#aiProgress');
  if (!box) return;
  clearTimeout(aiProgressTimer);
  box.classList.remove('is-hidden');
  $('#aiBar').style.width = Math.round(clamp(total ? done / total : 0, 0, 1) * 100) + '%';
  $('#aiProgressText').textContent = label;
}
function hideAiProgress(delay = 0) {
  clearTimeout(aiProgressTimer);
  aiProgressTimer = setTimeout(() => {
    const box = $('#aiProgress');
    if (box && !(aiBatch && aiBatch.running)) box.classList.add('is-hidden');
  }, delay);
}
function setAiControlsLocked(locked) {
  ['#aiVoice', '#aiModel', '#aiSpeed', '#aiAutoFit', '#btnSaveKey', '#btnClearKey', '#openaiKey'].forEach(sel => {
    const el = $(sel);
    if (el) el.disabled = locked || (sel === '#btnClearKey' && !getApiKey());
  });
}

async function aiVoiceAll() {
  if (aiBatch && aiBatch.running) {
    aiBatch.cancel = true;
    try { aiBatch.controller.abort(); } catch (e) {}
    $('#aiProgressText').textContent = '중지하는 중…';
    return;
  }
  if (exporting) { toast('내보내는 중에는 만들 수 없어요. 끝난 뒤 다시 눌러 주세요.'); return; }
  if (!effectiveKey()) {
    toast('OpenAI API 키를 먼저 입력해 주세요.', 'error');
    $('#aiVoicePanel').open = true;
    $('#openaiKey').focus();
    return;
  }
  const targets = project.cuts.filter(c => speechTextFor(c));
  if (!targets.length) {
    toast('자막이 있는 컷이 없어요. 자막을 먼저 입력해 주세요.');
    return;
  }
  pause();
  stopTts();
  aiBatch = { running: true, cancel: false, total: targets.length, done: 0, failed: 0, controller: new AbortController() };
  const btn = $('#btnAiAll');
  btn.textContent = '■ 중지';
  btn.classList.remove('primary');
  setAiControlsLocked(true);
  setAiProgress(0, targets.length, `0 / ${targets.length} 컷 준비 중…`);

  let fatal = '';
  for (let i = 0; i < targets.length; i++) {
    if (aiBatch.cancel) break;
    setAiProgress(i, targets.length, `${i + 1} / ${targets.length} 컷 생성 중…`);
    try {
      await generateCutVoice(targets[i], { signal: aiBatch.controller.signal });
      aiBatch.done++;
    } catch (e) {
      if (e && e.name === 'AbortError') break;
      aiBatch.failed++;
      if (e && ['no-key', 'auth', 'quota'].includes(e.code)) { fatal = e.message; break; }
    }
    setAiProgress(aiBatch.done + aiBatch.failed, targets.length, `${i + 1} / ${targets.length} 컷 생성 중…`);
  }

  const { done, failed, cancel, total } = aiBatch;
  aiBatch.running = false;
  aiBatch = null;
  btn.textContent = '🎙️ 전체 컷 AI 음성 한 번에 만들기';
  btn.classList.add('primary');
  setAiControlsLocked(false);

  if (fatal) {
    setAiProgress(done, total, `중단됨 · ${done} / ${total} 컷 완성`);
    toast(fatal, 'error');
  } else if (cancel) {
    setAiProgress(done, total, `중지됨 · ${done} / ${total} 컷 완성`);
    toast(`AI 음성 만들기를 중지했어요. ${done}컷은 완성됐어요.`);
  } else if (failed) {
    setAiProgress(done, total, `완료 ${done}컷 · 실패 ${failed}컷`);
    toast(`${done}컷은 완성, ${failed}컷은 실패했어요. 다시 눌러 보세요.`, 'error');
  } else {
    setAiProgress(total, total, `✅ ${total}컷 AI 음성 완성`);
    toast(`🎙️ ${total}컷 AI 음성을 모두 만들었어요. ▶ 로 들어보세요.`);
  }
  hideAiProgress(6000);
}

$('#btnSaveKey').addEventListener('click', saveApiKey);
$('#btnClearKey').addEventListener('click', clearApiKey);
$('#btnToggleKey').addEventListener('click', () => {
  const input = $('#openaiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  const btn = $('#btnToggleKey');
  btn.textContent = show ? '🙈' : '👁';
  btn.setAttribute('aria-label', show ? '키 가리기' : '키 보기');
  btn.title = show ? '키 가리기' : '키 보기';
});
$('#openaiKey').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveApiKey(); }
});
$('#aiVoice').addEventListener('change', e => {
  project.aiVoice.voice = AI_VOICE_IDS.includes(e.target.value) ? e.target.value : DEFAULT_AI.voice;
  scheduleSave();
  syncAiUI();
});
$('#aiModel').addEventListener('change', e => {
  const model = AI_MODELS.includes(e.target.value) ? e.target.value : DEFAULT_AI.model;
  if (model !== 'gpt-4o-mini-tts' && MINI_ONLY_VOICES.includes(aiSettings().voice)) {
    toast('‘ballad’는 gpt-4o-mini-tts 전용이라 nova로 바꿨어요.');
  }
  project.aiVoice.model = model;
  scheduleSave();
  syncAiUI();
});
$('#aiSpeed').addEventListener('input', e => {
  project.aiVoice.speed = clamp(parseFloat(e.target.value) || DEFAULT_AI.speed, 0.75, 1.4);
  $('#aiSpeedOut').textContent = project.aiVoice.speed.toFixed(2).replace(/0$/, '') + 'x';
  $('#aiVoiceSummary').textContent = `${aiSettings().voice} · ${project.aiVoice.speed.toFixed(2).replace(/0$/, '')}x`;
  scheduleSave();
});
$('#aiAutoFit').addEventListener('change', e => {
  project.aiVoice.autoFit = !!e.target.checked;
  scheduleSave();
});
$('#btnAiAll').addEventListener('click', aiVoiceAll);

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
  const dur = await audioDuration(blob, url, true);
  cut.audio.duration = dur;
  if (cut.autoFit && dur > 0) {
    cut.duration = clamp(Math.round((tonalDuration(dur, cut) + 0.25) * 10) / 10, 0.5, 120);
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

/* 목소리 톤 바꾸기 — 미리듣기·자동 길이 맞추기에 바로 반영 */
function setCutTone(cut, tone) {
  const next = normalizeTone(tone);
  if (normalizeTone(cut.tone) === next) return;
  cut.tone = next;
  if (cut.autoFit && cut.audio && cut.audio.duration > 0) {
    cut.duration = clamp(Math.round((tonalDuration(cut.audio.duration, cut) + 0.25) * 10) / 10, 0.5, 120);
  }
  scheduleSave();
  renderCutList();
  toast(`목소리 톤 · ${TONE_LABEL[next]}`);
}

/* 컷 카드의 <audio> 미리듣기에도 톤·배속·볼륨을 반영 */
function applyToneToPlayer(el, cut) {
  if (!el || !cut) return;
  const rate = tonalPlaybackRate(cut);
  const vol = voiceVolumeFor(cut);
  const apply = () => {
    try {
      el.preservesPitch = false;
      el.mozPreservesPitch = false;
      el.webkitPreservesPitch = false;
    } catch (e) {}
    try { el.playbackRate = rate; } catch (e) {}
    try { el.volume = clamp(vol, 0, 1); } catch (e) {}
  };
  apply();
  el.addEventListener('loadedmetadata', apply, { once: true });
  el.addEventListener('play', apply, { once: true });
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
  const aiBusy = aiBusyCuts.has(cut.id);
  const audioUrl = hasAudio ? mediaUrl(cut.audio.key) : null;
  const tone = normalizeTone(cut.tone);
  const rate = tonalPlaybackRate(cut);
  const rawDur = hasAudio && cut.audio.duration ? cut.audio.duration : 0;
  const effDur = rawDur / rate;
  const num = index + 1;

  /* 이 컷만 따로 지정한 값 (없으면 전체 설정을 따름) */
  const motionOwn = cut.motion ? normalizeMotion(cut.motion) : '';
  const transOwn = cut.transition ? normalizeTransition(cut.transition) : '';
  const sfxOwn = cut.sfx && cut.sfx.id ? normalizeSfx(cut.sfx.id) : '';
  const sfxVol = cut.sfx && cut.sfx.volume != null
    ? clamp(cut.sfx.volume, 0, 1)
    : clamp(project.options.sfxVolume ?? 0.6, 0, 1);
  const vRateOwn = cut.voiceRate != null;
  const vVolOwn = cut.voiceVolume != null;
  const vRate = voiceRateFor(cut);
  const vVol = voiceVolumeFor(cut);
  const custom = !!(cut.style || motionOwn || transOwn || sfxOwn || vRateOwn || vVolOwn);

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
            <button type="button" class="chip ai" data-act="aiVoice" ${aiBusy ? 'disabled' : ''} title="현재 AI 성우 설정으로 이 컷 자막을 음성으로 만들어요">${aiBusy ? '⏳ 생성 중…' : '🎙️ AI 음성'}</button>
            ${hasAudio ? '<button type="button" class="chip danger" data-act="removeAudio">음성 삭제</button>' : ''}
          </div>
          ${hasAudio ? `<audio class="cut-audio" controls preload="metadata" src="${escapeAttr(audioUrl || '')}"></audio>
            <div class="tone-row">
              <span class="tone-label">🎚 목소리 톤</span>
              <div class="tone-chips" role="group" aria-label="목소리 톤 변조">
                ${TONE_KEYS.map(k => `<button type="button" class="chip tone-chip ${tone === k ? 'on' : ''}" data-tone="${k}" title="${escapeAttr(TONE_DESC[k])}" aria-pressed="${tone === k ? 'true' : 'false'}">${TONE_LABEL[k]}</button>`).join('')}
              </div>
            </div>
            <div class="audio-state"><b>${escapeHtml(cut.audio.name || '음성')}</b>${rawDur ? ` · ${rawDur.toFixed(1)}초` : ''}${rawDur && rate !== 1 ? ` → 변조 후 ${effDur.toFixed(1)}초` : ''}${` · ${rate.toFixed(2)}x`}</div>` : ''}
          <label class="toggle small"><input type="checkbox" data-field="autoFit" ${cut.autoFit ? 'checked' : ''}><span>음성 길이에 맞추기</span></label>
          <input type="file" data-field="imageFile" accept="image/*" hidden>
          <input type="file" data-field="audioFile" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" hidden>
        </div>
        <details class="cut-style" ${custom ? 'open' : ''}>
          <summary>🎛 이 컷만 따로 설정${custom ? ' <span class="tag">사용 중</span>' : ''}</summary>
          <div class="style-body">
            <div class="mini-title">🎬 화면 · 전환 · 효과음</div>
            <div class="style-grid">
              <label class="field">화면 모션
                <select data-field="motion">
                  <option value="">전체 따르기</option>
                  ${MOTION_KEYS.map(k => `<option value="${k}" ${motionOwn === k ? 'selected' : ''}>${MOTION_LABEL[k]}</option>`).join('')}
                </select>
              </label>
              <label class="field">전환 효과
                <select data-field="transition">
                  <option value="">전체 따르기</option>
                  ${TRANSITION_KEYS.map(k => `<option value="${k}" ${transOwn === k ? 'selected' : ''}>${TRANSITION_LABEL[k]}</option>`).join('')}
                </select>
              </label>
              <label class="field">효과음
                <select data-field="sfxId">
                  <option value="">전체 따르기</option>
                  ${SFX_KEYS.map(k => `<option value="${k}" ${sfxOwn === k ? 'selected' : ''}>${SFX_LABEL[k]}</option>`).join('')}
                </select>
              </label>
              <label class="field">효과음 볼륨 <output data-sfx-out>${Math.round(sfxVol * 100)}%</output>
                <input type="range" data-field="sfxVol" min="0" max="100" step="1" value="${Math.round(sfxVol * 100)}">
              </label>
              <div class="field wide">
                <button type="button" class="chip small" data-act="sfxPreview">🔊 이 컷 효과음 들어보기</button>
              </div>
            </div>

            <div class="style-sep"></div>
            <div class="mini-title">🎚 이 컷 목소리 (${vRateOwn || vVolOwn ? '따로 설정' : '전체 따르기'})</div>
            <div class="style-grid">
              <label class="field">배속 <output data-rate-out>${vRate.toFixed(2)}x</output>
                <input type="range" data-field="voiceRate" min="0.8" max="1.5" step="0.05" value="${vRate}">
              </label>
              <label class="field">볼륨 <output data-vol-out>${Math.round(vVol * 100)}%</output>
                <input type="range" data-field="voiceVol" min="0" max="100" step="1" value="${Math.round(vVol * 100)}">
              </label>
              <div class="field wide">
                <button type="button" class="chip small" data-act="inheritVoice">↺ 목소리 전체 값 따르기</button>
              </div>
            </div>

            <div class="style-sep"></div>
            <div class="mini-title">🔤 이 컷 자막 스타일</div>
            <label class="toggle small"><input type="checkbox" data-style-enable ${cut.style ? 'checked' : ''}><span>이 컷만 다르게 적용</span></label>
            <div class="style-grid" ${cut.style ? '' : 'hidden'}>
              <label class="field">글꼴
                <select data-style="font">
                  ${FONT_KEYS.map(k => `<option value="${k}" ${normalizeFont(st.font) === k ? 'selected' : ''}>${FONT_DEFS[k].label}</option>`).join('')}
                </select>
              </label>
              <label class="field">글자 크기 <output data-style-out>${st.fontSize}</output>
                <input type="range" data-style="fontSize" min="28" max="120" step="1" value="${st.fontSize}">
              </label>
              <label class="field">굵기
                <select data-style="weight">
                  ${STYLE_WEIGHTS.map(w => `<option value="${w}" ${Number(st.weight) === w ? 'selected' : ''}>${WEIGHT_LABEL[w]}</option>`).join('')}
                </select>
              </label>
              <label class="field">자막 효과
                <select data-style="effect">
                  ${SUBTITLE_EFFECTS.map(v => `<option value="${v}" title="${escapeAttr(EFFECT_DESC[v])}" ${normalizeEffect(st.effect) === v ? 'selected' : ''}>${EFFECT_LABEL[v]}</option>`).join('')}
                </select>
              </label>
              <div class="field"><span class="field-label">위치</span>
                ${seg('position', [['top', '상단'], ['center', '중앙'], ['bottom', '하단']], st.position)}
              </div>
              <div class="field"><span class="field-label">정렬</span>
                ${seg('align', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], st.align)}
              </div>
              <div class="field wide"><span class="field-label">배경 박스</span>
                ${seg('bg', [['dark', '검정'], ['light', '흰색'], ['none', '없음'], ['color', '컬러'], ['pill', '알약']], st.bg)}
              </div>
              <div class="field"><span class="field-label">글자색</span>
                <div class="color-row"><input type="color" data-style="color" value="${st.color}" aria-label="이 컷 글자색"></div>
              </div>
              <label class="field">외곽선 <output data-style-out>${st.outline}</output>
                <input type="range" data-style="outline" min="0" max="14" step="1" value="${st.outline}">
              </label>
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
  $$('.cut-audio', cutListEl).forEach(el => {
    const card = el.closest('.cut-card');
    applyToneToPlayer(el, card ? findCut(card.dataset.id) : null);
  });
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
  if (field === 'sfxVol') {
    const v = clamp((parseFloat(el.value) || 0) / 100, 0, 1);
    const baseId = cut.sfx && cut.sfx.id ? cut.sfx.id : project.options.sfxId;
    cut.sfx = { id: normalizeSfx(baseId), volume: v };
    const out = $('[data-sfx-out]', card);
    if (out) out.textContent = Math.round(v * 100) + '%';
    scheduleSave();
    return;
  }
  if (field === 'voiceRate') {
    const v = clamp(parseFloat(el.value) || 1, 0.8, 1.5);
    cut.voiceRate = v;
    const out = $('[data-rate-out]', card);
    if (out) out.textContent = v.toFixed(2) + 'x';
    if (cut.autoFit && cut.audio && cut.audio.duration > 0) {
      cut.duration = clamp(Math.round((tonalDuration(cut.audio.duration, cut) + 0.25) * 10) / 10, 0.5, 120);
      const range = $('[data-field="duration"]', card);
      if (range) range.value = String(cut.duration);
      const num = $('[data-field="durationNum"]', card);
      if (num) num.value = cut.duration.toFixed(1);
      updateDurLabel(card, cut.duration);
    }
    recalcTimeline();
    scheduleSave();
    return;
  }
  if (field === 'voiceVol') {
    const v = clamp((parseFloat(el.value) || 0) / 100, 0, 1);
    cut.voiceVolume = v;
    const out = $('[data-vol-out]', card);
    if (out) out.textContent = Math.round(v * 100) + '%';
    const player = $('.cut-audio', card);
    if (player) { try { player.volume = v; } catch (e) {} }
    scheduleSave();
    return;
  }
  if (el.dataset.style) {
    if (!cut.style) return;
    const key = el.dataset.style;
    const fieldRow = el.closest('.field');
    const out = fieldRow ? $('[data-style-out]', fieldRow) : null;
    if (key === 'fontSize') {
      const v = clamp(parseInt(el.value, 10) || 56, 24, 160);
      cut.style.fontSize = v;
      if (out) out.textContent = v;
    } else if (key === 'outline') {
      const v = clamp(parseInt(el.value, 10) || 0, 0, 14);
      cut.style.outline = v;
      if (out) out.textContent = v;
    } else if (key === 'color') {
      cut.style.color = hexColor(el.value, cut.style.color);
    } else {
      return;
    }
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

  if (el.dataset.field === 'motion') {
    cut.motion = el.value ? normalizeMotion(el.value) : null;
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }
  if (el.dataset.field === 'transition') {
    cut.transition = el.value ? normalizeTransition(el.value) : null;
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }
  if (el.dataset.field === 'sfxId') {
    // 컷에 볼륨을 따로 정한 적이 없으면 전체 효과음 볼륨을 그대로 따른다.
    const ownVol = cut.sfx && cut.sfx.volume != null ? clamp(Number(cut.sfx.volume), 0, 1) : null;
    const vol = ownVol != null ? ownVol : clamp(project.options.sfxVolume ?? 0.6, 0, 1);
    cut.sfx = el.value ? { id: normalizeSfx(el.value), volume: vol } : null;
    scheduleSave();
    if (cut.sfx) {
      const card2 = $(`.cut-card[data-id="${cut.id}"]`);
      const range = card2 ? $('[data-field="sfxVol"]', card2) : null;
      const out = card2 ? $('[data-sfx-out]', card2) : null;
      if (range) range.value = String(Math.round(vol * 100));
      if (out) out.textContent = Math.round(vol * 100) + '%';
    }
    const label = el.value ? SFX_LABEL[normalizeSfx(el.value)] : '전체 따르기';
    toast(`이 컷 효과음 · ${label}`);
    return;
  }
  if (el.dataset.field === 'autoFit') {
    cut.autoFit = !!el.checked;
    if (cut.autoFit && cut.audio && cut.audio.duration > 0) {
      cut.duration = clamp(Math.round((tonalDuration(cut.audio.duration, cut) + 0.25) * 10) / 10, 0.5, 120);
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
  if (el.dataset.style === 'font') {
    if (!cut.style) return;
    cut.style.font = normalizeFont(el.value);
    ensureFontLoaded(el.value).then(() => { if (!playing) drawAll(currentTime); });
    scheduleSave();
    return;
  }
  if (el.dataset.style === 'effect') {
    if (!cut.style) return;
    cut.style.effect = normalizeEffect(el.value);
    scheduleSave();
    if (!playing) drawAll(currentTime);
    return;
  }
  if (el.hasAttribute('data-style-enable')) {
    if (el.checked) {
      cut.style = normalizeStyle(project.style, DEFAULT_STYLE);
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
    // 목소리 톤 칩
    const toneBtn = e.target.closest('[data-tone]');
    if (toneBtn) {
      setCutTone(cut, toneBtn.dataset.tone);
      return;
    }
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
    case 'aiVoice': aiVoiceForCut(cut); break;
    case 'removeAudio': removeCutAudio(cut); break;
    case 'sfxPreview': {
      const s = sfxFor(cut);
      if (s.id === 'none') { toast('이 컷에는 효과음이 없어요. 아래에서 먼저 골라 주세요.'); break; }
      if (previewSfx(s.id, s.volume)) toast(`🔊 ${SFX_LABEL[s.id]}`);
      else toast('이 브라우저에서는 효과음을 재생할 수 없어요.', 'error');
      break;
    }
    case 'inheritVoice': {
      cut.voiceRate = null;
      cut.voiceVolume = null;
      cut.sfx = null;
      scheduleSave();
      renderCutList();
      toast('이 컷 목소리를 전체 설정으로 되돌렸어요.');
      break;
    }
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

function updatePresetButtons() {
  $$('#presetRow .preset-btn').forEach(b => {
    const on = project.preset === b.dataset.preset;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function syncProjectUI() {
  const st = normalizeStyle(project.style, DEFAULT_STYLE);
  $('#projectName').value = project.name || '';
  updatePresetButtons();
  $('#fontSize').value = String(st.fontSize);
  $('#fontSizeNum').value = String(st.fontSize);
  $('#fontSizeOut').textContent = String(st.fontSize);
  $('#fontWeight').value = String(st.weight);
  setSegmented($('#posSeg'), st.position);
  setSegmented($('#alignSeg'), st.align);
  $('#bgSelect').value = normalizeBg(st.bg);
  $('#effectSelect').value = normalizeEffect(st.effect);
  $('#offsetY').value = String(st.offsetY);
  $('#offsetYOut').textContent = String(Math.round(st.offsetY));
  $('#textColor').value = st.color;
  $('#bgColor').value = st.bgColor;
  $('#outline').value = String(st.outline);
  $('#outlineOut').textContent = String(Math.round(st.outline));
  $('#outlineColor').value = st.outlineColor;
  $('#shadow').value = String(Math.round(st.shadow));
  $('#shadowOut').textContent = String(Math.round(st.shadow));
  $$('#fontChips button').forEach(b => b.classList.toggle('on', b.dataset.font === st.font));

  $('#motionSelect').value = normalizeMotion(project.options.motion);
  $('#motionQuick').value = normalizeMotion(project.options.motion);
  $('#transitionSelect').value = normalizeTransition(project.options.transition);
  $('#sfxSelect').value = normalizeSfx(project.options.sfxId);
  $('#sfxVol').value = String(Math.round((project.options.sfxVolume ?? 0.6) * 100));
  $('#sfxVolOut').textContent = Math.round((project.options.sfxVolume ?? 0.6) * 100) + '%';
  $('#voiceRate').value = String(project.options.voiceRate ?? 1);
  $('#voiceRateOut').textContent = Number(project.options.voiceRate ?? 1).toFixed(2) + 'x';
  $('#bgmFadeIn').value = String(project.options.bgmFadeIn ?? 0);
  $('#bgmFadeInOut').textContent = Number(project.options.bgmFadeIn ?? 0).toFixed(1) + '초';
  $('#bgmFadeOut').value = String(project.options.bgmFadeOut ?? 0);
  $('#bgmFadeOutOut').textContent = Number(project.options.bgmFadeOut ?? 0).toFixed(1) + '초';

  $('#motionSummary').textContent = MOTION_LABEL[normalizeMotion(project.options.motion)];
  $('#transitionSummary').textContent = TRANSITION_LABEL[normalizeTransition(project.options.transition)];
  $('#sfxSummary').textContent = normalizeSfx(project.options.sfxId) === 'none'
    ? '없음'
    : `${SFX_LABEL[normalizeSfx(project.options.sfxId)]} · ${Math.round((project.options.sfxVolume ?? 0.6) * 100)}%`;
  $('#fontSummary').textContent = `${FONT_DEFS[st.font].label} · ${st.fontSize}`;
  $('#posSummary').textContent = `${st.position === 'top' ? '상단' : st.position === 'center' ? '중앙' : '하단'} · ${st.align === 'left' ? '왼쪽' : st.align === 'right' ? '오른쪽' : '가운데'}`;
  $('#decoSummary').textContent = `${st.color} · 외곽선 ${st.outline} · 그림자 ${Math.round(st.shadow)}`;
  $('#voiceSummary').textContent = `${Number(project.options.voiceRate ?? 1).toFixed(2)}x · ${Math.round((project.options.voiceVolume ?? 1) * 100)}%`;

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
  syncAiUI();
  renderBgmUI();
}

/* ---------- 도구 탭 ---------- */
function selectToolTab(name) {
  $$('.tool-tabs button').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.tool-panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
}
function syncTopbarHeight() {
  const bar = $('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
}

function syncDecoSummary() {
  const el = $('#decoSummary');
  if (!el) return;
  el.textContent = `${project.style.color} · 외곽선 ${project.style.outline} · 그림자 ${Math.round(project.style.shadow)}`;
}

function commitStyle(patch) {
  Object.assign(project.style, normalizeStyle({ ...project.style, ...patch }, DEFAULT_STYLE));
  scheduleSave();
  if (!playing) drawAll(currentTime);
}

$('#fontSize').addEventListener('input', e => {
  const v = clamp(parseInt(e.target.value, 10) || 56, 24, 160);
  project.style.fontSize = v;
  $('#fontSizeOut').textContent = String(v);
  $('#fontSizeNum').value = String(v);
  $('#fontSummary').textContent = `${FONT_DEFS[normalizeFont(project.style.font)].label} · ${v}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#fontSizeNum').addEventListener('input', e => {
  const raw = parseInt(e.target.value, 10);
  if (!Number.isFinite(raw)) return;
  const v = clamp(raw, 24, 160);
  project.style.fontSize = v;
  $('#fontSize').value = String(v);
  $('#fontSizeOut').textContent = String(v);
  $('#fontSummary').textContent = `${FONT_DEFS[normalizeFont(project.style.font)].label} · ${v}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#fontWeight').addEventListener('change', e => {
  project.style.weight = Number(e.target.value) || 800;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#fontChips').addEventListener('click', e => {
  const b = e.target.closest('button[data-font]');
  if (!b) return;
  project.style.font = normalizeFont(b.dataset.font);
  $$('#fontChips button').forEach(x => x.classList.toggle('on', x === b));
  $('#fontSummary').textContent = `${FONT_DEFS[project.style.font].label} · ${project.style.fontSize}`;
  scheduleSave();
  ensureFontLoaded(project.style.font).then(ok => {
    if (!playing) drawAll(currentTime);
    if (project.style.font !== 'system' && !ok) toast('글꼴을 불러오지 못했어요. 네트워크를 확인해 주세요.', 'error');
  });
  if (!playing) drawAll(currentTime);
});
$('#posSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  project.style.position = b.dataset.value;
  setSegmented($('#posSeg'), project.style.position);
  $('#posSummary').textContent = `${b.textContent} · ${project.style.align === 'left' ? '왼쪽' : project.style.align === 'right' ? '오른쪽' : '가운데'}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#alignSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-value]');
  if (!b) return;
  project.style.align = normalizeAlign(b.dataset.value);
  setSegmented($('#alignSeg'), project.style.align);
  $('#posSummary').textContent = `${project.style.position === 'top' ? '상단' : project.style.position === 'center' ? '중앙' : '하단'} · ${b.textContent}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#offsetY').addEventListener('input', e => {
  const v = clamp(parseFloat(e.target.value) || 0, -30, 30);
  project.style.offsetY = v;
  $('#offsetYOut').textContent = String(Math.round(v));
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#bgSelect').addEventListener('change', e => {
  project.style.bg = normalizeBg(e.target.value);
  // 흰색 박스에서는 흰 글씨가 보이지 않으니 색을 자동으로 바꿔 준다.
  if (project.style.bg === 'light' && project.style.color === '#ffffff') {
    project.style.color = '#111318';
    $('#textColor').value = '#111318';
  } else if (project.style.bg !== 'light' && project.style.color === '#111318') {
    project.style.color = '#ffffff';
    $('#textColor').value = '#ffffff';
  }
  $('#decoSummary').textContent = `${project.style.color} · 외곽선 ${project.style.outline} · 그림자 ${Math.round(project.style.shadow)}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#textColor').addEventListener('input', e => {
  project.style.color = hexColor(e.target.value, '#ffffff');
  syncDecoSummary();
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#textSwatches').addEventListener('click', e => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  project.style.color = hexColor(b.dataset.color, '#ffffff');
  $('#textColor').value = project.style.color;
  syncDecoSummary();
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#outline').addEventListener('input', e => {
  const v = clamp(parseInt(e.target.value, 10) || 0, 0, 14);
  project.style.outline = v;
  $('#outlineOut').textContent = String(v);
  $('#decoSummary').textContent = `${project.style.color} · 외곽선 ${v} · 그림자 ${Math.round(project.style.shadow)}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#outlineColor').addEventListener('input', e => {
  project.style.outlineColor = hexColor(e.target.value, '#000000');
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#outlineSwatches').addEventListener('click', e => {
  const b = e.target.closest('button[data-color]');
  if (!b) return;
  project.style.outlineColor = hexColor(b.dataset.color, '#000000');
  $('#outlineColor').value = project.style.outlineColor;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#shadow').addEventListener('input', e => {
  const v = clamp(parseInt(e.target.value, 10) || 0, 0, 100);
  project.style.shadow = v;
  $('#shadowOut').textContent = String(v);
  $('#decoSummary').textContent = `${project.style.color} · 외곽선 ${project.style.outline} · 그림자 ${v}`;
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#bgColor').addEventListener('input', e => {
  project.style.bgColor = hexColor(e.target.value, '#ffd54a');
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#effectSelect').addEventListener('change', e => {
  project.style.effect = normalizeEffect(e.target.value);
  scheduleSave();
  if (!playing) drawAll(currentTime);
  toast(`자막 효과 · ${EFFECT_LABEL[project.style.effect]}`);
});

function setGlobalMotion(v) {
  project.options.motion = normalizeMotion(v);
  project.options.kenBurns = project.options.motion !== 'none';
  $('#motionSelect').value = project.options.motion;
  $('#motionQuick').value = project.options.motion;
  $('#motionSummary').textContent = MOTION_LABEL[project.options.motion];
  scheduleSave();
  if (!playing) drawAll(currentTime);
}
$('#motionSelect').addEventListener('change', e => setGlobalMotion(e.target.value));
$('#motionQuick').addEventListener('change', e => setGlobalMotion(e.target.value));
$('#transitionSelect').addEventListener('change', e => {
  project.options.transition = normalizeTransition(e.target.value);
  $('#transitionSummary').textContent = TRANSITION_LABEL[project.options.transition];
  scheduleSave();
  if (!playing) drawAll(currentTime);
});
$('#sfxSelect').addEventListener('change', e => {
  project.options.sfxId = normalizeSfx(e.target.value);
  $('#sfxSummary').textContent = project.options.sfxId === 'none'
    ? '없음'
    : `${SFX_LABEL[project.options.sfxId]} · ${Math.round((project.options.sfxVolume ?? 0.6) * 100)}%`;
  scheduleSave();
  if (project.options.sfxId !== 'none') previewSfx(project.options.sfxId, project.options.sfxVolume ?? 0.6);
});
$('#sfxVol').addEventListener('input', e => {
  project.options.sfxVolume = clamp((parseFloat(e.target.value) || 0) / 100, 0, 1);
  $('#sfxVolOut').textContent = Math.round(project.options.sfxVolume * 100) + '%';
  $('#sfxSummary').textContent = normalizeSfx(project.options.sfxId) === 'none'
    ? '없음'
    : `${SFX_LABEL[project.options.sfxId]} · ${Math.round(project.options.sfxVolume * 100)}%`;
  scheduleSave();
});
$('#btnSfxPreview').addEventListener('click', () => {
  const id = normalizeSfx($('#sfxSelect').value);
  if (id === 'none') { toast('먼저 효과음을 골라 주세요.'); return; }
  if (!previewSfx(id, (parseFloat($('#sfxVol').value) || 0) / 100)) toast('이 브라우저에서는 효과음을 재생할 수 없어요.', 'error');
});
$('#voiceRate').addEventListener('input', e => {
  const v = clamp(parseFloat(e.target.value) || 1, 0.8, 1.5);
  project.options.voiceRate = v;
  $('#voiceRateOut').textContent = v.toFixed(2) + 'x';
  $('#voiceSummary').textContent = `${v.toFixed(2)}x · ${Math.round((project.options.voiceVolume ?? 1) * 100)}%`;
  // 배속을 바꿔도 ‘음성 길이에 맞추기’가 켜진 컷은 길이가 어긋나지 않게 자동으로 다시 맞춘다.
  project.cuts.forEach(cut => {
    if (cut.autoFit && cut.audio && cut.audio.duration > 0) {
      cut.duration = clamp(Math.round((tonalDuration(cut.audio.duration, cut) + 0.25) * 10) / 10, 0.5, 120);
    }
  });
  scheduleSave();
  renderCutList();
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
  $('#voiceSummary').textContent = `${Number(project.options.voiceRate ?? 1).toFixed(2)}x · ${Math.round(project.options.voiceVolume * 100)}%`;
  project.cuts.forEach(cut => {
    if (cut.voiceVolume != null) return;
    const card = $(`.cut-card[data-id="${cut.id}"]`);
    const player = card ? $('.cut-audio', card) : null;
    if (player) { try { player.volume = project.options.voiceVolume; } catch (err) {} }
  });
  scheduleSave();
});
$('#bgmFadeIn').addEventListener('input', e => {
  project.options.bgmFadeIn = clamp(parseFloat(e.target.value) || 0, 0, 3);
  $('#bgmFadeInOut').textContent = project.options.bgmFadeIn.toFixed(1) + '초';
  scheduleSave();
});
$('#bgmFadeOut').addEventListener('input', e => {
  project.options.bgmFadeOut = clamp(parseFloat(e.target.value) || 0, 0, 3);
  $('#bgmFadeOutOut').textContent = project.options.bgmFadeOut.toFixed(1) + '초';
  scheduleSave();
});

/* ------------------------------------------------------------
   13. 저장 (localStorage) · 복원
   ------------------------------------------------------------ */
function normalizeOptions(raw) {
  const o = raw || {};
  const num = (v, fallback) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);
  return {
    kenBurns: o.kenBurns !== false,
    motion: o.motion ? normalizeMotion(o.motion) : (o.kenBurns === false ? 'none' : DEFAULT_OPTIONS.motion),
    transition: o.transition ? normalizeTransition(o.transition) : DEFAULT_OPTIONS.transition,
    resolution: o.resolution === '720x1280' ? '720x1280' : '1080x1920',
    bgmVolume: clamp(num(o.bgmVolume, DEFAULT_OPTIONS.bgmVolume), 0, 1),
    voiceVolume: clamp(num(o.voiceVolume, DEFAULT_OPTIONS.voiceVolume), 0, 1),
    voiceRate: clamp(num(o.voiceRate, DEFAULT_OPTIONS.voiceRate), 0.8, 1.5),
    sfxId: normalizeSfx(o.sfxId),
    sfxVolume: clamp(num(o.sfxVolume, DEFAULT_OPTIONS.sfxVolume), 0, 1),
    bgmFadeIn: clamp(num(o.bgmFadeIn, 0), 0, 3),
    bgmFadeOut: clamp(num(o.bgmFadeOut, 0), 0, 3)
  };
}

function serializeProject() {
  const baseStyle = normalizeStyle(project.style, DEFAULT_STYLE);
  return {
    v: 2,
    savedAt: Date.now(),
    preset: project.preset || null,
    name: project.name,
    style: baseStyle,
    options: normalizeOptions(project.options),
    tts: { ...project.tts },
    aiVoice: { voice: project.aiVoice ? project.aiVoice.voice : DEFAULT_AI.voice,
      speed: project.aiVoice ? project.aiVoice.speed : DEFAULT_AI.speed,
      model: project.aiVoice ? project.aiVoice.model : DEFAULT_AI.model,
      autoFit: !project.aiVoice || project.aiVoice.autoFit !== false },
    bgm: project.bgm ? { ...project.bgm } : null,
    cuts: project.cuts.map(c => ({
      id: c.id,
      text: c.text,
      duration: c.duration,
      autoFit: c.autoFit,
      image: c.image ? { ...c.image } : null,
      audio: c.audio ? { ...c.audio } : null,
      tone: normalizeTone(c.tone),
      style: c.style ? normalizeStyle(c.style, baseStyle) : null,
      motion: c.motion ? normalizeMotion(c.motion) : null,
      transition: c.transition ? normalizeTransition(c.transition) : null,
      sfx: c.sfx && c.sfx.id
        ? { id: normalizeSfx(c.sfx.id), volume: clamp(Number(c.sfx.volume != null ? c.sfx.volume : 0.6), 0, 1) }
        : null,
      voiceRate: c.voiceRate != null && Number.isFinite(parseFloat(c.voiceRate)) ? clamp(parseFloat(c.voiceRate), 0.8, 1.5) : null,
      voiceVolume: c.voiceVolume != null && Number.isFinite(parseFloat(c.voiceVolume)) ? clamp(parseFloat(c.voiceVolume), 0, 1) : null
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
  const normStyle = normalizeStyle(style, DEFAULT_STYLE);
  const cuts = (Array.isArray(raw.cuts) ? raw.cuts : []).map(c => {
    const st = c.style && typeof c.style === 'object' ? normalizeStyle(c.style, normStyle) : null;
    const sfxVol = c.sfx && Number.isFinite(parseFloat(c.sfx.volume)) ? parseFloat(c.sfx.volume) : 0.6;
    return {
      id: c.id || uid('cut'),
      text: typeof c.text === 'string' ? c.text : '',
      duration: clamp(parseFloat(c.duration) || 3, 0.5, 120),
      autoFit: c.autoFit !== false,
      tone: normalizeTone(c.tone),
      image: c.image && (c.image.src || c.image.key)
        ? { src: c.image.src || undefined, key: c.image.key || undefined, name: c.image.name || '' }
        : null,
      audio: c.audio && c.audio.key
        ? { key: c.audio.key, name: c.audio.name || '음성', mime: c.audio.mime || '', duration: parseFloat(c.audio.duration) || 0 }
        : null,
      style: st,
      motion: c.motion ? normalizeMotion(c.motion) : null,
      transition: c.transition ? normalizeTransition(c.transition) : null,
      sfx: c.sfx && c.sfx.id ? { id: normalizeSfx(c.sfx.id), volume: clamp(sfxVol, 0, 1) } : null,
      voiceRate: c.voiceRate != null && Number.isFinite(parseFloat(c.voiceRate)) ? clamp(parseFloat(c.voiceRate), 0.8, 1.5) : null,
      voiceVolume: c.voiceVolume != null && Number.isFinite(parseFloat(c.voiceVolume)) ? clamp(parseFloat(c.voiceVolume), 0, 1) : null
    };
  });
  return {
    preset: ['sample-01', 'sample-02'].includes(raw.preset) ? raw.preset : null,
    name: String(raw.name || '내 쇼츠').slice(0, 60),
    style: normStyle,
    options: normalizeOptions(raw.options),
    tts: {
      voiceURI: String((raw.tts || {}).voiceURI || ''),
      rate: clamp(parseFloat((raw.tts || {}).rate) || 1, 0.8, 1.5),
      pitch: clamp(parseFloat((raw.tts || {}).pitch) || 1, 0.5, 2)
    },
    aiVoice: {
      voice: AI_VOICE_IDS.includes(raw.aiVoice && raw.aiVoice.voice) ? raw.aiVoice.voice : DEFAULT_AI.voice,
      speed: clamp(parseFloat(raw.aiVoice && raw.aiVoice.speed) || DEFAULT_AI.speed, 0.75, 1.4),
      model: AI_MODELS.includes(raw.aiVoice && raw.aiVoice.model) ? raw.aiVoice.model : DEFAULT_AI.model,
      autoFit: !(raw.aiVoice && raw.aiVoice.autoFit === false)
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
    preset: project.preset || null,
    name: project.name,
    style: normalizeStyle(project.style, DEFAULT_STYLE),
    options: normalizeOptions(project.options),
    tts: { ...project.tts },
    aiVoice: { ...aiSettings() },
    bgm: null,
    cuts: []
  };
  for (const cut of project.cuts) {
    const c = {
      text: cut.text,
      duration: cut.duration,
      autoFit: cut.autoFit,
      tone: normalizeTone(cut.tone),
      style: cut.style ? normalizeStyle(cut.style, project.style) : null,
      motion: cut.motion || null,
      transition: cut.transition || null,
      sfx: cut.sfx ? { id: normalizeSfx(cut.sfx.id), volume: clamp(Number(cut.sfx.volume ?? 0.6), 0, 1) } : null,
      voiceRate: cut.voiceRate != null ? cut.voiceRate : null,
      voiceVolume: cut.voiceVolume != null ? cut.voiceVolume : null,
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

  if (recorder) stopRecording();
  stopPlayback();
  stopTts();
  clearResultCard();
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
let lastResultUrl = null;
let lastExportDiag = null;

function clearResultCard() {
  const v = $('#resultVideo');
  if (v) {
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src');
    try { v.load(); } catch (e) {}
  }
  if (lastResultUrl) {
    try { URL.revokeObjectURL(lastResultUrl); } catch (e) {}
    lastResultUrl = null;
  }
  $('#resultCard').classList.add('is-hidden');
  $('#resultMeta').textContent = '';
  $('#btnDownload').removeAttribute('href');
}

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
  if (recorder) { toast('녹음을 먼저 멈춘 뒤 내보내 주세요.'); return; }
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

  // 내보내기 첫 프레임부터 바른 글꼴로 그려지도록 미리 불러온다.
  try { await ensureAllFontsLoaded(); } catch (e) {}

  const [W, H] = currentResolution();
  const total = totalDuration();
  exportTotalSeconds = total;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');

  exporting = true;
  exportCancel = false;
  exportChunks = [];
  lastExportDiag = null;
  clearResultCard();
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
        lastExportDiag = {
          mime: exportMime,
          videoTracks: exportStream.getVideoTracks().length,
          audioTracks: exportStream.getAudioTracks().length
        };
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
  lastResultUrl = url;
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
  if (recorder) stopRecording();
  stopPlayback();
  stopTts();
  clearResultCard();
  clearMediaCache();
  project = blankProject();
  currentTime = 0;
  syncProjectUI();
  renderCutList();
  saveNow();
  toast('새 프로젝트를 시작했어요.');
}

function loadSampleProject(id = DEFAULT_SAMPLE_ID) {
  const sample = SAMPLES[id] || SAMPLES[DEFAULT_SAMPLE_ID];
  const hasContent = project.cuts.some(c => (c.text || '').trim() || c.image || c.audio);
  if (hasContent && !confirm(`‘${sample.name}’ 프리셋으로 바꿀까요? 지금 작업은 사라져요.`)) return;
  if (recorder) stopRecording();
  stopPlayback();
  stopTts();
  clearResultCard();
  clearMediaCache();
  project = sampleProject(sample.id);
  currentTime = 0;
  syncProjectUI();
  refreshVoices();
  renderCutList();
  saveNow();
  toast(`${sample.id === 'sample-02' ? '2편' : '1편'} 프리셋을 불러왔어요. 바로 재생해 보세요!`);
}

$('#btnReset').addEventListener('click', resetProject);
$('#btnAddCut').addEventListener('click', addCut);
$('#btnFirstCut').addEventListener('click', addCut);
$('#btnLoadSample').addEventListener('click', () => loadSampleProject('sample-01'));
$('#btnLoadSample2').addEventListener('click', () => loadSampleProject('sample-02'));
$('#presetRow').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (b) loadSampleProject(b.dataset.preset);
});
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
  selectToolTab('screen');
  syncTopbarHeight();
  window.addEventListener('resize', syncTopbarHeight);

  // 글꼴이 늦게 도착하면 한 번 다시 그려 정확한 글꼴로 보여 준다.
  ensureAllFontsLoaded().then(() => { if (!playing) drawAll(currentTime); });
  if (document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => { if (!playing) drawAll(currentTime); });
  }
  const firstKey = normalizeFont(project.style.font);
  if (firstKey !== 'system') ensureFontLoaded(firstKey).then(() => { if (!playing) drawAll(currentTime); });

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

/* 도구 탭 · 상단바 높이 */
$$('.tool-tabs button').forEach(b => {
  b.addEventListener('click', () => selectToolTab(b.dataset.tab));
});

document.addEventListener('keydown', e => {
  if (e.target && /input|textarea|select/i.test(e.target.tagName || '')) return;
  if (e.altKey && /^[1-3]$/.test(e.key)) selectToolTab(['screen', 'text', 'audio'][Number(e.key) - 1]);
});

init().catch(err => {
  console.error(err);
  toast('앱을 시작하지 못했어요. 페이지를 새로고침해 주세요.', 'error');
});

/* 테스트·디버깅용 최소 핸들 (읽기 전용) */
window.__shortsMaker = {
  version: '2.0.0',
  getProject: () => serializeProject(),
  getState: () => ({ currentTime, playing, exporting, total: totalDuration(), cuts: project.cuts.length }),
  getAiVoice: () => ({ ...aiSettings(), hasKey: !!effectiveKey(), busy: aiBusyCuts.size, batch: !!(aiBatch && aiBatch.running) }),
  getLastExport: () => lastExportDiag,
  getFonts: () => FONT_KEYS.reduce((o, k) => { o[k] = isFontReady(k); return o; }, {}),
  getSfx: () => ({
    keys: SFX_KEYS.slice(),
    durations: { ...SFX_DUR },
    buffers: Object.fromEntries(SFX_KEYS.filter(k => k !== 'none').map(k => {
      const ctx = getAudioCtx();
      const buf = ctx ? sfxBuffer(ctx, k) : null;
      return [k, buf ? { duration: Number(buf.duration.toFixed(3)), sampleRate: buf.sampleRate } : null];
    }))
  }),
  drawAt: (t, w = PREVIEW_W, h = PREVIEW_H) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    drawFrame(t, c.getContext('2d'), w, h);
    return c.toDataURL('image/png');
  },
  lineAt: (t, y) => {
    const c = document.createElement('canvas');
    c.width = PREVIEW_W; c.height = PREVIEW_H;
    const cx = c.getContext('2d');
    drawFrame(t, cx, PREVIEW_W, PREVIEW_H);
    const row = cx.getImageData(0, Math.round(y), PREVIEW_W, 2).data;
    let lit = 0;
    for (let i = 0; i < row.length; i += 4) {
      if (row[i] > 200 && row[i + 1] > 200 && row[i + 2] > 200) lit++;
    }
    return lit;
  },
  /* 내보내기와 같은 경로(scheduleAudio)로 오디오 믹스를 오프라인 렌더링해
     0.1초당 RMS를 돌려준다. 효과음·목소리 볼륨이 실제로 섞이는지 검사할 때 쓴다. */
  mixProbe: async (fromTime = 0) => {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const total = Math.max(0.5, totalDuration());
    const octx = new OAC(1, Math.ceil(total * 44100), 44100);
    const cache = new Map();
    await decodeAllInto(octx, cache);
    const master = octx.createGain();
    master.connect(octx.destination);
    scheduleAudio(octx, master, fromTime, cache, []);
    const buf = await octx.startRendering();
    const d = buf.getChannelData(0);
    const win = Math.floor(44100 * 0.1);
    const rms = [];
    for (let i = 0; i + win <= d.length; i += win) {
      let s = 0;
      for (let j = 0; j < win; j++) s += d[i + j] * d[i + j];
      rms.push(Number(Math.sqrt(s / win).toFixed(4)));
    }
    return { duration: Number(buf.duration.toFixed(3)), rms };
  }
};
})();
