const DB_NAME = "browser-anki";
const DB_VERSION = 1;
const UI_STORAGE_KEY = "browser-anki-ui-state-v1";
const DAY = 24 * 60 * 60 * 1000;
const TEN_MINUTES = 10 * 60 * 1000;
const ANKI_DEFAULTS = {
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
  graduatingIntervalGood: 1,
  graduatingIntervalEasy: 4,
  initialEaseFactor: 2.5,
  minimumEaseFactor: 1.3,
  hardMultiplier: 1.2,
  easyMultiplier: 1.3,
  lapseMultiplier: 0,
  minimumLapseInterval: 1,
  maximumReviewInterval: 36500,
  leechThreshold: 8,
};
const CARD_TYPES = {
  new: "New",
  learn: "Learning",
  review: "Review",
  relearn: "Relearning",
};
const CARD_QUEUES = {
  new: "New",
  learn: "Learn",
  dayLearn: "DayLearn",
  review: "Review",
};

const state = {
  decks: [],
  cards: [],
  logs: [],
  currentDeckId: "all",
  area: "study",
  currentView: "add",
  reviewStarted: false,
  activeReviewCardId: null,
  answerVisible: false,
  typedAnswer: "",
  search: "",
  selectedTags: [],
  tagRangeStart: "",
  tagRangeEnd: "",
  pendingImage: null,
  csvDraft: null,
  reviewAheadDays: 0,
  previewSession: null,
};

const $ = (selector) => document.querySelector(selector);

const selectors = {
  deckList: $("#deck-list"),
  cardDeck: $("#card-deck"),
  cardAnswerMode: $("#card-answer-mode"),
  cardForm: $("#card-form"),
  cardFront: $("#card-front"),
  cardBack: $("#card-back"),
  cardTags: $("#card-tags"),
  cardImage: $("#card-image"),
  cardImageSide: $("#card-image-side"),
  imagePreview: $("#image-preview"),
  cardSearch: $("#card-search"),
  reviewStage: $("#review-stage"),
  tagFilter: $("#tag-filter"),
  reviewTitle: $("#review-title"),
  reviewSubtitle: $("#review-subtitle"),
  dueCount: $("#due-count"),
  metricDue: $("#metric-due"),
  metricTotal: $("#metric-total"),
  metricStreak: $("#metric-streak"),
  cardList: $("#card-list"),
  statsGrid: $("#stats-grid"),
  historyList: $("#history-list"),
  deckSettingsForm: $("#deck-settings-form"),
  fileInput: $("#file-input"),
  csvFileInput: $("#csv-file-input"),
  csvImportPanel: $("#csv-import-panel"),
  toastRegion: $("#toast-region"),
  storageState: $("#storage-state"),
};

function defaultDeckConfig() {
  return {
    new: {
      delays: [...ANKI_DEFAULTS.learningStepsMinutes],
      graduatingGood: ANKI_DEFAULTS.graduatingIntervalGood,
      graduatingEasy: ANKI_DEFAULTS.graduatingIntervalEasy,
      initialEaseFactor: ANKI_DEFAULTS.initialEaseFactor,
    },
    rev: {
      hardFactor: ANKI_DEFAULTS.hardMultiplier,
      easyBonus: ANKI_DEFAULTS.easyMultiplier,
      intervalModifier: 1,
      maximumInterval: ANKI_DEFAULTS.maximumReviewInterval,
    },
    lapse: {
      delays: [...ANKI_DEFAULTS.relearningStepsMinutes],
      multiplier: ANKI_DEFAULTS.lapseMultiplier,
      minimumInterval: ANKI_DEFAULTS.minimumLapseInterval,
      leechThreshold: ANKI_DEFAULTS.leechThreshold,
    },
  };
}

const dbPromise = openDatabase();

function loadUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}");
    if (typeof saved.currentDeckId === "string") state.currentDeckId = saved.currentDeckId;
    if (typeof saved.area === "string") state.area = saved.area;
    if (typeof saved.currentView === "string") state.currentView = saved.currentView;
    if (Array.isArray(saved.selectedTags)) state.selectedTags = saved.selectedTags.map(String);
    if (typeof saved.tagRangeStart === "string") state.tagRangeStart = saved.tagRangeStart;
    if (typeof saved.tagRangeEnd === "string") state.tagRangeEnd = saved.tagRangeEnd;
    if (typeof saved.reviewAheadDays === "number") state.reviewAheadDays = saved.reviewAheadDays;
    if (saved.previewSession && typeof saved.previewSession.days === "number") {
      state.previewSession = { active: Boolean(saved.previewSession.active), days: saved.previewSession.days };
    }
    state.reviewStarted = Boolean(saved.reviewStarted);
  } catch {
    localStorage.removeItem(UI_STORAGE_KEY);
  }
}

function saveUiState() {
  const payload = {
    currentDeckId: state.currentDeckId,
    area: state.area,
    currentView: state.currentView,
    selectedTags: state.selectedTags,
    tagRangeStart: state.tagRangeStart,
    tagRangeEnd: state.tagRangeEnd,
    reviewAheadDays: state.reviewAheadDays,
    previewSession: state.previewSession,
    reviewStarted: state.reviewStarted,
  };
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(payload));
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("decks")) {
        db.createObjectStore("decks", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("deckId", "deckId", { unique: false });
        cards.createIndex("due", "due", { unique: false });
      }

      if (!db.objectStoreNames.contains("logs")) {
        const logs = db.createObjectStore("logs", { keyPath: "id" });
        logs.createIndex("reviewedAt", "reviewedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const db = await dbPromise;
  const transaction = db.transaction(storeName, "readonly");
  return idbRequest(transaction.objectStore(storeName).getAll());
}

async function put(storeName, value) {
  const db = await dbPromise;
  const transaction = db.transaction(storeName, "readwrite");
  await idbRequest(transaction.objectStore(storeName).put(value));
  return waitForTransaction(transaction);
}

async function remove(storeName, id) {
  const db = await dbPromise;
  const transaction = db.transaction(storeName, "readwrite");
  await idbRequest(transaction.objectStore(storeName).delete(id));
  return waitForTransaction(transaction);
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function uid(prefix) {
  const value = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${value}`;
}

function now() {
  return Date.now();
}

function todayStartTimestamp() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseTags(value) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatDue(timestamp) {
  const diff = timestamp - now();
  if (diff <= 0) return "今";

  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}分後`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}時間後`;

  return `${Math.round(hours / 24)}日後`;
}

function formatInterval(days) {
  if (days <= 0) return "10分";
  if (days < 1) return `${Math.round(days * 24)}時間`;
  if (days < 30) return `${Math.round(days)}日`;
  return `${Math.round(days / 30)}か月`;
}

function formatAnkiInterval(card) {
  if (card.queue === CARD_QUEUES.learn || card.queue === CARD_QUEUES.dayLearn) {
    return card.scheduledSecs >= DAY / 1000
      ? formatInterval(card.scheduledSecs / 86400)
      : `${Math.max(1, Math.round(card.scheduledSecs / 60))}分`;
  }
  return formatInterval(card.intervalDays);
}

function getDeckName(deckId) {
  if (deckId === "all") return "すべて";
  return state.decks.find((deck) => deck.id === deckId)?.name ?? "未分類";
}

function cardStateLabel(value) {
  return {
    New: "新規",
    Learning: "学習中",
    Review: "復習",
    Relearning: "再学習",
    Learn: "学習",
    DayLearn: "日跨ぎ学習",
  }[value] ?? value;
}

function getDeckByName(name) {
  return state.decks.find((deck) => deck.name.toLowerCase() === name.toLowerCase());
}

function cardsForCurrentDeck() {
  if (state.currentDeckId === "all") return state.cards;
  return state.cards.filter((card) => card.deckId === state.currentDeckId);
}

function availableTagsForCurrentDeck() {
  return [...new Set(cardsForCurrentDeck().flatMap((card) => card.tags))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja"));
}

function isNumericTag(tag) {
  return Number.isInteger(Number(tag));
}

function numericTagsForCurrentDeck() {
  return availableTagsForCurrentDeck()
    .map((tag) => ({ tag, number: Number(tag) }))
    .filter((item) => Number.isInteger(item.number))
    .sort((a, b) => a.number - b.number);
}

function cardMatchesSelectedTags(card) {
  if (!state.selectedTags.length) return true;
  const tags = new Set(card.tags);
  return state.selectedTags.some((tag) => tags.has(tag));
}

function studyCardsForCurrentScope() {
  return cardsForCurrentDeck().filter(cardMatchesSelectedTags);
}

function dailyRandomKey(card) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const input = `${dateKey}:${card.id}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function lastReviewLogFor(cardId) {
  return state.logs.find((log) => log.cardId === cardId);
}

function mistakePriority(card) {
  const lastLog = lastReviewLogFor(card.id);
  const lastRating = lastLog?.rating;
  let priority = 0;

  if (card.type === CARD_TYPES.relearn) priority += 120;
  if (card.type === CARD_TYPES.learn) priority += 90;
  if (lastRating === "again") priority += 80;
  if (lastRating === "hard") priority += 35;
  if (card.leech) priority += 30;
  priority += Math.min(60, card.lapses * 12);

  return priority;
}

function compareStudyOrder(a, b) {
  const priorityDiff = mistakePriority(b) - mistakePriority(a);
  if (priorityDiff) return priorityDiff;

  const queueDiff = queueRank(b) - queueRank(a);
  if (queueDiff) return queueDiff;

  const randomDiff = dailyRandomKey(a) - dailyRandomKey(b);
  if (randomDiff) return randomDiff;

  return a.createdAt - b.createdAt;
}

function queueRank(card) {
  if (card.queue === CARD_QUEUES.learn || card.queue === CARD_QUEUES.dayLearn) return 3;
  if (card.queue === CARD_QUEUES.review) return 2;
  if (card.queue === CARD_QUEUES.new) return 1;
  return 0;
}

function dueCards(cards = cardsForCurrentDeck()) {
  const timestamp = now();
  return cards
    .filter((card) => card.due <= timestamp)
    .sort(compareStudyOrder);
}

function reviewQueueCards(cards = cardsForCurrentDeck()) {
  const regularDue = dueCards(cards);
  if (!state.previewSession?.active) return regularDue;

  const cutoff = now() + state.previewSession.days * DAY;
  const seen = new Set(regularDue.map((card) => card.id));
  const ahead = cards
    .filter((card) => {
      if (seen.has(card.id)) return false;
      if (card.due <= now() || card.due > cutoff) return false;
      return [CARD_TYPES.review, CARD_TYPES.learn, CARD_TYPES.relearn].includes(card.type);
    })
    .sort(compareStudyOrder);
  return regularDue.concat(ahead);
}

function nextDueCard(cards = cardsForCurrentDeck()) {
  return cards
    .filter((card) => card.due > now())
    .sort((a, b) => a.due - b.due)[0];
}

function createDeck(name) {
  const timestamp = now();
  return {
    id: uid("deck"),
    name: name.trim(),
    description: "",
    config: defaultDeckConfig(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createCard({
  deckId,
  front,
  back,
  tags = [],
  answerMode = "self",
  image = null,
  timestamp = now(),
}) {
  return {
    id: uid("card"),
    deckId,
    noteId: uid("note"),
    cardOrdinal: 0,
    type: CARD_TYPES.new,
    queue: CARD_QUEUES.new,
    front: String(front).trim(),
    back: String(back).trim(),
    tags,
    answerMode: answerMode === "typed" ? "typed" : "self",
    image,
    flagged: false,
    due: timestamp,
    interval: 0,
    intervalDays: 0,
    ease: ANKI_DEFAULTS.initialEaseFactor,
    easeFactor: ANKI_DEFAULTS.initialEaseFactor,
    remainingSteps: ANKI_DEFAULTS.learningStepsMinutes.length,
    scheduledSecs: 0,
    reps: 0,
    lapses: 0,
    originalPosition: null,
    leech: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastReviewedAt: null,
  };
}

function normalizeDeck(deck) {
  const timestamp = now();
  return {
    id: String(deck.id),
    name: String(deck.name || "未分類"),
    description: String(deck.description ?? ""),
    config: normalizeDeckConfig(deck.config),
    createdAt: Number(deck.createdAt ?? timestamp),
    updatedAt: Number(deck.updatedAt ?? timestamp),
  };
}

function normalizeDeckConfig(config = {}) {
  const defaults = defaultDeckConfig();
  const toNumberArray = (value, fallback) => {
    if (Array.isArray(value)) {
      const result = value.map(Number).filter((item) => Number.isFinite(item) && item >= 0);
      if (result.length) return result;
    }
    if (typeof value === "string") {
      const result = value.split(/[,\s]+/).map(Number).filter((item) => Number.isFinite(item) && item >= 0);
      if (result.length) return result;
    }
    return [...fallback];
  };
  const num = (value, fallback, min = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
  };

  return {
    new: {
      delays: toNumberArray(config.new?.delays, defaults.new.delays),
      graduatingGood: num(config.new?.graduatingGood, defaults.new.graduatingGood, 1),
      graduatingEasy: num(config.new?.graduatingEasy, defaults.new.graduatingEasy, 1),
      initialEaseFactor: num(config.new?.initialEaseFactor, defaults.new.initialEaseFactor, 1.3),
    },
    rev: {
      hardFactor: num(config.rev?.hardFactor, defaults.rev.hardFactor, 1),
      easyBonus: num(config.rev?.easyBonus, defaults.rev.easyBonus, 1),
      intervalModifier: num(config.rev?.intervalModifier, defaults.rev.intervalModifier, 0.1),
      maximumInterval: num(config.rev?.maximumInterval, defaults.rev.maximumInterval, 1),
    },
    lapse: {
      delays: toNumberArray(config.lapse?.delays, defaults.lapse.delays),
      multiplier: num(config.lapse?.multiplier, defaults.lapse.multiplier, 0),
      minimumInterval: num(config.lapse?.minimumInterval, defaults.lapse.minimumInterval, 1),
      leechThreshold: num(config.lapse?.leechThreshold, defaults.lapse.leechThreshold, 0),
    },
  };
}

function deckConfigFor(cardOrDeckId) {
  const deckId = typeof cardOrDeckId === "string" ? cardOrDeckId : cardOrDeckId.deckId;
  return state.decks.find((deck) => deck.id === deckId)?.config ?? defaultDeckConfig();
}

function normalizeCard(card) {
  const timestamp = now();
  const legacyInterval = Number(card.intervalDays ?? card.interval ?? 0);
  const type = Object.values(CARD_TYPES).includes(card.type) ? card.type : legacyInterval > 0 ? CARD_TYPES.review : CARD_TYPES.new;
  const queue = Object.values(CARD_QUEUES).includes(card.queue)
    ? card.queue
    : type === CARD_TYPES.review
      ? CARD_QUEUES.review
      : type === CARD_TYPES.new
        ? CARD_QUEUES.new
        : CARD_QUEUES.learn;
  const easeFactor = Number(card.easeFactor ?? card.ease ?? ANKI_DEFAULTS.initialEaseFactor);
  return {
    id: String(card.id),
    deckId: String(card.deckId),
    noteId: String(card.noteId ?? uid("note")),
    cardOrdinal: Number(card.cardOrdinal ?? 0),
    type,
    queue,
    front: String(card.front ?? ""),
    back: String(card.back ?? ""),
    tags: Array.isArray(card.tags) ? card.tags.map(String) : parseTags(card.tags),
    answerMode: card.answerMode === "typed" ? "typed" : "self",
    image: card.image?.dataUrl ? {
      dataUrl: String(card.image.dataUrl),
      name: String(card.image.name ?? "image"),
      side: card.image.side === "back" ? "back" : "front",
    } : null,
    flagged: Boolean(card.flagged),
    due: Number(card.due ?? timestamp),
    interval: Number(card.interval ?? legacyInterval),
    intervalDays: legacyInterval,
    ease: easeFactor,
    easeFactor,
    remainingSteps: Number(card.remainingSteps ?? (type === CARD_TYPES.new ? ANKI_DEFAULTS.learningStepsMinutes.length : 0)),
    scheduledSecs: Number(card.scheduledSecs ?? 0),
    reps: Number(card.reps ?? 0),
    lapses: Number(card.lapses ?? 0),
    originalPosition: card.originalPosition ?? null,
    leech: Boolean(card.leech),
    createdAt: Number(card.createdAt ?? timestamp),
    updatedAt: Number(card.updatedAt ?? timestamp),
    lastReviewedAt: card.lastReviewedAt ? Number(card.lastReviewedAt) : null,
  };
}

function normalizeLog(log) {
  return {
    id: String(log.id),
    cardId: String(log.cardId),
    deckId: String(log.deckId),
    rating: String(log.rating ?? "good"),
    typedAnswer: String(log.typedAnswer ?? ""),
    reviewedAt: Number(log.reviewedAt ?? now()),
    previousState: String(log.previousState ?? ""),
    nextState: String(log.nextState ?? ""),
    previousQueue: String(log.previousQueue ?? ""),
    nextQueue: String(log.nextQueue ?? ""),
    previousIntervalDays: Number(log.previousIntervalDays ?? 0),
    nextIntervalDays: Number(log.nextIntervalDays ?? 0),
  };
}

async function seedIfEmpty() {
  const decks = await getAll("decks");
  if (decks.length > 0) return;

  const deck = createDeck("日本語サンプル");
  await put("decks", deck);

  const samples = [
    {
      front: "spaced repetition",
      back: "間隔反復。忘れそうな頃に復習して記憶を強める学習方法。",
      tags: ["anki", "memory"],
      answerMode: "self",
    },
    {
      front: "IndexedDB",
      back: "ブラウザ内に大きめの構造化データを保存できるAPI。",
      tags: ["browser", "storage"],
      answerMode: "typed",
    },
    {
      front: "AGPL",
      back: "GNU Affero General Public License。このリポジトリはAGPL-3.0-or-later。",
      tags: ["license"],
      answerMode: "self",
    },
  ];

  for (const sample of samples) {
    await put("cards", createCard({ deckId: deck.id, ...sample }));
  }
}

async function refreshData() {
  const [decks, cards, logs] = await Promise.all([
    getAll("decks"),
    getAll("cards"),
    getAll("logs"),
  ]);

  state.decks = decks.map(normalizeDeck).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  state.cards = cards.map(normalizeCard).sort((a, b) => b.createdAt - a.createdAt);
  state.logs = logs.map(normalizeLog).sort((a, b) => b.reviewedAt - a.reviewedAt);

  if (state.currentDeckId !== "all" && !state.decks.some((deck) => deck.id === state.currentDeckId)) {
    state.currentDeckId = "all";
  }

  render();
}

function render() {
  syncSelectedTags();
  saveUiState();
  renderAreas();
  renderDecks();
  renderDeckSelect();
  renderMetrics();
  renderTagFilter();
  renderReview();
  renderManageTabs();
  renderBrowse();
  renderStats();
  renderSettings();
  renderCsvPanel();
}

function syncSelectedTags() {
  const available = new Set(availableTagsForCurrentDeck());
  state.selectedTags = state.selectedTags.filter((tag) => available.has(tag));
}

function renderTagFilter() {
  if (!selectors.tagFilter) return;
  const tags = availableTagsForCurrentDeck();
  if (!tags.length) {
    selectors.tagFilter.innerHTML = "";
    return;
  }

  const selected = new Set(state.selectedTags);
  const numericTags = numericTagsForCurrentDeck();
  const rangeForm = numericTags.length ? `
    <form class="tag-range-form" data-tag-range-form>
      <label>
        <span>番号タグ</span>
        <input name="start" type="number" step="1" placeholder="1" value="${escapeHtml(state.tagRangeStart)}" />
      </label>
      <span class="tag-range-separator">〜</span>
      <label>
        <span class="visually-hidden">終了番号</span>
        <input name="end" type="number" step="1" placeholder="100" value="${escapeHtml(state.tagRangeEnd)}" />
      </label>
      <button class="secondary-button" type="submit">範囲を適用</button>
    </form>
  ` : "";
  const visibleTags = tags.filter((tag) => !isNumericTag(tag));
  const chips = visibleTags.map((tag) => {
    const active = selected.has(tag) ? " active" : "";
    return `<button class="tag-filter-chip${active}" type="button" data-toggle-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  }).join("");
  const summary = state.selectedTags.length
    ? `${state.selectedTags.length} tags`
    : "All tags";

  selectors.tagFilter.innerHTML = `
    <div class="tag-filter-head">
      <span>出題タグ</span>
      <strong>${escapeHtml(summary)}</strong>
      ${state.selectedTags.length ? `<button class="tag-filter-clear" type="button" data-clear-tags>解除</button>` : ""}
    </div>
    ${rangeForm}
    ${chips ? `<div class="tag-filter-chips">${chips}</div>` : ""}
  `;
}

function applyTagRange(form) {
  const data = new FormData(form);
  const start = Number(data.get("start"));
  const end = Number(data.get("end"));
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    toast("開始番号と終了番号を入力してください");
    return;
  }

  const min = Math.min(start, end);
  const max = Math.max(start, end);
  const matched = numericTagsForCurrentDeck()
    .filter((item) => item.number >= min && item.number <= max)
    .map((item) => item.tag);

  state.tagRangeStart = String(start);
  state.tagRangeEnd = String(end);
  state.selectedTags = matched;
  state.activeReviewCardId = null;
  state.answerVisible = false;
  state.typedAnswer = "";
  render();
  toast(`${matched.length}個のタグを選択しました`);
}

function renderAreas() {
  document.body.classList.toggle("review-focus", state.area === "study" && state.reviewStarted);
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.area === state.area);
  });
  document.querySelectorAll(".area").forEach((area) => {
    area.classList.toggle("active", area.id === `${state.area}-area`);
  });
}

function renderManageTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.currentView);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${state.currentView}-view`);
  });
}

function renderDecks() {
  const allDue = dueCards(state.cards).length;
  const buttons = [deckButtonMarkup("all", "すべて", state.cards.length, allDue)]
    .concat(state.decks.map((deck) => {
      const cards = state.cards.filter((card) => card.deckId === deck.id);
      return deckButtonMarkup(deck.id, deck.name, cards.length, dueCards(cards).length, true);
    }))
    .join("");
  selectors.deckList.innerHTML = buttons;
}

function deckButtonMarkup(id, name, total, due, removable = false) {
  const active = state.currentDeckId === id ? " active" : "";
  const dueClass = due > 0 ? "due-dot" : "due-dot empty";
  const safeDeleteLabel = `${name}\u3092\u524a\u9664`;
  const safeDeleteButton = removable
    ? `<button class="deck-delete-button" type="button" data-delete-deck="${escapeHtml(id)}" title="Delete deck" aria-label="${escapeHtml(safeDeleteLabel)}">x</button>`
    : "";
  const deleteButton = removable
    ? `<button class="deck-delete-button" type="button" data-delete-deck="${escapeHtml(id)}" title="デッキ削除" aria-label="${escapeHtml(name)}を削除">×</button>`
    : "";
  return `
    <div class="deck-row${active}">
      <button class="deck-button${active}" type="button" data-deck-id="${escapeHtml(id)}">
        <span>
          <span class="deck-name">${escapeHtml(name)}</span>
          <span class="deck-meta">${total}枚</span>
        </span>
        <span class="${dueClass}">${due}</span>
      </button>
      ${safeDeleteButton}
    </div>
  `;
}

function renderDeckSelect() {
  selectors.cardDeck.innerHTML = state.decks.map((deck) => {
    const selected = deck.id === state.currentDeckId ? " selected" : "";
    return `<option value="${escapeHtml(deck.id)}"${selected}>${escapeHtml(deck.name)}</option>`;
  }).join("");
}

function renderMetrics() {
  const cards = studyCardsForCurrentScope();
  selectors.metricDue.textContent = dueCards(cards).length;
  selectors.metricTotal.textContent = cards.length;
  selectors.metricStreak.textContent = calculateStreak();
}

function renderReview() {
  const cards = studyCardsForCurrentScope();
  const due = reviewQueueCards(cards);
  const activeCard = state.activeReviewCardId
    ? state.cards.find((card) => card.id === state.activeReviewCardId)
    : null;
  const reviewIds = new Set(due.map((card) => card.id));
  const reviewCard = activeCard && reviewIds.has(activeCard.id) ? activeCard : due[0];
  state.activeReviewCardId = reviewCard?.id ?? null;

  selectors.reviewTitle.textContent = getDeckName(state.currentDeckId);
  selectors.reviewSubtitle.textContent = state.previewSession?.active
    ? `先取り復習 ${state.previewSession.days}日`
    : state.currentDeckId === "all" ? "すべてのデッキを復習" : "デッキを復習";
  selectors.dueCount.textContent = due.length;

  if (!state.reviewStarted) {
    selectors.reviewStage.innerHTML = reviewStartMarkup(cards, due);
    return;
  }

  if (!cards.length) {
    selectors.reviewStage.innerHTML = emptyMarkup(
      "カードがありません",
      "管理画面でカードを追加するか、CSVから読み込んでください。",
      `<button class="primary-button" type="button" data-area-jump="manage">管理へ</button>`,
    );
    return;
  }

  if (!reviewCard) {
    const next = nextDueCard(cards);
    selectors.reviewStage.innerHTML = emptyMarkup(
      "今日の復習は完了",
      next ? `次のカードは${formatDue(next.due)}に出ます。` : "新しいカードを追加すると復習できます。",
      `<button class="secondary-button" type="button" data-area-jump="manage">カード一覧</button>${reviewAheadControlsMarkup()}`,
    );
    return;
  }

  selectors.reviewStage.innerHTML = reviewFocusBarMarkup(due.length) + reviewMarkup(reviewCard);
}

function reviewStartMarkup(cards, due) {
  const next = nextDueCard(cards);
  const description = cards.length
    ? due.length
      ? `${due.length}枚のカードを復習できます。`
      : next
        ? `今は期限カードがありません。次は${formatDue(next.due)}です。`
        : "カードを追加すると復習できます。"
    : "このデッキにはカードがありません。";

  return `
    <section class="review-start">
      <div>
        <p class="eyebrow">デッキ</p>
        <h2>${escapeHtml(getDeckName(state.currentDeckId))}</h2>
        <p>${escapeHtml(description)}</p>
        <div class="review-start-actions">
          <button class="primary-button" type="button" data-start-review ${cards.length ? "" : "disabled"}>スタート</button>
          <button class="secondary-button" type="button" data-area-jump="manage">管理</button>
        </div>
      </div>
    </section>
    ${reviewAheadControlsMarkup()}
  `;
}

function reviewFocusBarMarkup(dueCount) {
  return `
    <div class="review-focus-bar">
      <span>${escapeHtml(getDeckName(state.currentDeckId))}</span>
      <span>${dueCount}枚</span>
      <button class="secondary-button" type="button" data-stop-review>終了</button>
    </div>
  `;
}

function reviewAheadControlsMarkup() {
  const active = state.previewSession?.active;
  return `
    <form class="ahead-form" data-ahead-form>
      <label>
        <span>先取り復習</span>
        <input name="days" type="number" min="1" max="365" step="1" value="${escapeHtml(state.reviewAheadDays || state.previewSession?.days || 1)}" />
      </label>
      <button class="secondary-button" type="submit">${active ? "日数変更" : "開始"}</button>
      ${active ? `<button class="danger-button" type="button" data-stop-ahead>終了</button>` : ""}
    </form>
  `;
  return `
    <form class="ahead-form" data-ahead-form>
      <label>
        <span>先取り復習</span>
        <input name="days" type="number" min="1" max="365" step="1" value="${escapeHtml(state.reviewAheadDays || state.previewSession?.days || 1)}" />
      </label>
      <button class="secondary-button" type="submit">${active ? "日数変更" : "開始"}</button>
      ${active ? `<button class="danger-button" type="button" data-stop-ahead>終了</button>` : ""}
    </form>
  `;
}

function reviewMarkup(card) {
  const isTyped = card.answerMode === "typed";
  const showAnswer = state.answerVisible;
  const tags = tagsMarkup(card.tags);
  const frontImage = cardImageMarkup(card, "front");
  const backImage = cardImageMarkup(card, "back");
  const flagButton = flagButtonMarkup(card);
  const typedBox = isTyped && !showAnswer ? `
    <form class="typed-answer-form" data-typed-form>
      <label>
        <span>回答</span>
        <input id="typed-answer" type="text" autocomplete="off" value="${escapeHtml(state.typedAnswer)}" />
      </label>
      <button class="primary-button" type="submit">答え合わせ</button>
    </form>
  ` : "";
  const answer = showAnswer ? `
    <div class="card-face answer-face">
      <div class="card-label">Back</div>
      ${isTyped ? `<div class="typed-result">入力: ${escapeHtml(state.typedAnswer || "未入力")}</div>` : ""}
      ${backImage}
      <div class="card-text">${escapeHtml(card.back)}</div>
    </div>
  ` : "";
  const actions = showAnswer ? `
    <button class="rating-button rating-again" type="button" data-rate="again">Again</button>
    <button class="rating-button rating-hard" type="button" data-rate="hard">Hard</button>
    <button class="rating-button rating-good" type="button" data-rate="good">Good</button>
    <button class="rating-button rating-easy" type="button" data-rate="easy">Easy</button>
  ` : isTyped ? typedBox : `<button class="primary-button" type="button" data-show-answer>答え</button>`;

  return `
    <article class="review-card">
      <div>
        <div class="card-face">
          <div class="card-label">Front</div>
          ${frontImage}
          <div class="card-text">${escapeHtml(card.front)}</div>
        </div>
        ${answer}
      </div>
      <footer class="review-footer">
        <div class="review-meta">
          <span>${escapeHtml(getDeckName(card.deckId))}</span>
          <span>${escapeHtml(cardStateLabel(card.type))} / ${escapeHtml(cardStateLabel(card.queue))}</span>
          <span>${card.answerMode === "typed" ? "入力式" : "自己採点"}</span>
          <span>復習 ${card.reps} 回</span>
          <span>間隔 ${formatAnkiInterval(card)}</span>
          ${card.flagged ? `<span class="flag-pill">\u30d5\u30e9\u30b0</span>` : ""}
          ${tags}
        </div>
        <div class="review-actions">${actions}${flagButton}</div>
      </footer>
    </article>
  `;
}

function cardImageMarkup(card, side) {
  if (!card.image?.dataUrl || card.image.side !== side) return "";
  return `
    <figure class="card-image">
      <img src="${escapeHtml(card.image.dataUrl)}" alt="${escapeHtml(card.image.name || "card image")}" />
    </figure>
  `;
}

function tagsMarkup(tags) {
  return tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
}

function flagButtonMarkup(card) {
  const active = card.flagged ? " active" : "";
  const label = card.flagged ? "\u30d5\u30e9\u30b0\u4ed8\u304d" : "\u30d5\u30e9\u30b0";
  return `<button class="flag-button${active}" type="button" data-toggle-flag="${escapeHtml(card.id)}">${label}</button>`;
}

function emptyMarkup(title, body, action = "") {
  return `
    <div class="empty-state">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
        ${action}
      </div>
    </div>
  `;
}

function renderBrowse() {
  const query = state.search.trim().toLowerCase();
  const cards = cardsForCurrentDeck().filter((card) => {
    if (!query) return true;
    const haystack = [
      card.front,
      card.back,
      card.tags.join(" "),
      getDeckName(card.deckId),
      card.answerMode === "typed" ? "入力式 typed" : "自己採点 self",
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  if (!cards.length) {
    selectors.cardList.innerHTML = emptyMarkup("一致するカードがありません", "検索語やデッキを変えてください。");
    return;
  }

  const groups = new Map();
  for (const card of cards) {
    const deckId = card.deckId;
    if (!groups.has(deckId)) groups.set(deckId, []);
    groups.get(deckId).push(card);
  }

  selectors.cardList.innerHTML = [...groups.entries()].map(([deckId, deckCards]) => `
    <section class="deck-group">
      <div class="deck-group-header">
        <h2>${escapeHtml(getDeckName(deckId))}</h2>
        <span>${deckCards.length}枚</span>
      </div>
      ${deckCards.map(browseItemMarkup).join("")}
    </section>
  `).join("");
}

function browseItemMarkup(card) {
  const image = card.image?.dataUrl ? `
    <img class="browse-thumb" src="${escapeHtml(card.image.dataUrl)}" alt="${escapeHtml(card.image.name || "image")}" />
  ` : "";
  const flagButton = flagButtonMarkup(card);

  return `
    <article class="browse-item" data-card-id="${escapeHtml(card.id)}">
      <div class="browse-summary">
        <div class="browse-text">
          <div class="browse-front">${escapeHtml(card.front)}</div>
          <div class="browse-back">${escapeHtml(card.back)}</div>
          <div class="review-meta">
            <span>${card.answerMode === "typed" ? "入力式" : "自己採点"}</span>
            <span>${escapeHtml(cardStateLabel(card.type))}</span>
            <span>次回 ${formatDue(card.due)}</span>
            ${tagsMarkup(card.tags)}
          </div>
        </div>
        ${image}
        <div class="item-actions">
          ${flagButton}
          <button class="secondary-button" type="button" data-edit-card="${escapeHtml(card.id)}">編集</button>
          <button class="danger-button" type="button" data-delete-card="${escapeHtml(card.id)}">削除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStats() {
  const cards = cardsForCurrentDeck();
  const deckIds = new Set(state.currentDeckId === "all" ? state.decks.map((deck) => deck.id) : [state.currentDeckId]);
  const logs = state.logs.filter((log) => deckIds.has(log.deckId));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayReviews = logs.filter((log) => log.reviewedAt >= todayStart.getTime()).length;
  const mature = cards.filter((card) => card.intervalDays >= 21).length;
  const typed = cards.filter((card) => card.answerMode === "typed").length;
  const learning = cards.filter((card) => card.type === CARD_TYPES.learn || card.type === CARD_TYPES.relearn).length;

  selectors.statsGrid.innerHTML = [
    statBox("今日", todayReviews),
    statBox("期限", dueCards(cards).length),
    statBox("成熟", mature),
    statBox("学習中", learning),
    statBox("入力式", typed),
  ].join("");

  const historyMarkup = logs.slice(0, 40).map((log) => {
    const card = state.cards.find((item) => item.id === log.cardId);
    return `
      <article class="history-item">
        <div>
          <strong>${escapeHtml(card?.front ?? "削除済みカード")}</strong>
          <div class="review-meta">
            <span>${formatDate(log.reviewedAt)}</span>
            <span>${escapeHtml(getDeckName(log.deckId))}</span>
            <span>${escapeHtml(cardStateLabel(log.previousState ?? ""))} -> ${escapeHtml(cardStateLabel(log.nextState ?? ""))}</span>
            <span>${formatInterval(log.previousIntervalDays)} -> ${formatInterval(log.nextIntervalDays)}</span>
          </div>
        </div>
        <span class="history-rating">${escapeHtml(log.rating)}</span>
      </article>
    `;
  }).join("") || emptyMarkup("記録はまだありません", "復習するとここに履歴が残ります。");
  selectors.historyList.innerHTML = `
    <div class="stats-actions">
      <button class="primary-button" type="button" data-create-mistake-deck>&#20170;&#26085;&#12398;Again/Hard&#12487;&#12483;&#12461;&#20316;&#25104;</button>
    </div>
    ${historyMarkup}
  `;
}

function renderSettings() {
  if (!selectors.deckSettingsForm) return;
  if (!state.decks.length) {
    selectors.deckSettingsForm.innerHTML = emptyMarkup("デッキがありません", "先にデッキを作成してください。");
    return;
  }

  const selectedDeckId = state.currentDeckId === "all" ? state.decks[0].id : state.currentDeckId;
  const deck = state.decks.find((item) => item.id === selectedDeckId) ?? state.decks[0];
  const config = deck.config;

  selectors.deckSettingsForm.innerHTML = `
    <label>
      <span>対象デッキ</span>
      <select name="deckId">
        ${state.decks.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === deck.id ? " selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>新規カードの学習ステップ 分</span>
      <input name="newDelays" type="text" value="${escapeHtml(config.new.delays.join(", "))}" />
    </label>
    <label>
      <span>Good卒業間隔 日</span>
      <input name="graduatingGood" type="number" min="1" step="1" value="${escapeHtml(config.new.graduatingGood)}" />
    </label>
    <label>
      <span>Easy卒業間隔 日</span>
      <input name="graduatingEasy" type="number" min="1" step="1" value="${escapeHtml(config.new.graduatingEasy)}" />
    </label>
    <label>
      <span>初期Ease</span>
      <input name="initialEaseFactor" type="number" min="1.3" step="0.05" value="${escapeHtml(config.new.initialEaseFactor)}" />
    </label>
    <label>
      <span>Hard係数</span>
      <input name="hardFactor" type="number" min="1" step="0.05" value="${escapeHtml(config.rev.hardFactor)}" />
    </label>
    <label>
      <span>Easyボーナス</span>
      <input name="easyBonus" type="number" min="1" step="0.05" value="${escapeHtml(config.rev.easyBonus)}" />
    </label>
    <label>
      <span>間隔修正</span>
      <input name="intervalModifier" type="number" min="0.1" step="0.05" value="${escapeHtml(config.rev.intervalModifier)}" />
    </label>
    <label>
      <span>最大間隔 日</span>
      <input name="maximumInterval" type="number" min="1" step="1" value="${escapeHtml(config.rev.maximumInterval)}" />
    </label>
    <label>
      <span>失敗時ステップ 分</span>
      <input name="lapseDelays" type="text" value="${escapeHtml(config.lapse.delays.join(", "))}" />
    </label>
    <label>
      <span>失敗時の間隔倍率</span>
      <input name="lapseMultiplier" type="number" min="0" step="0.05" value="${escapeHtml(config.lapse.multiplier)}" />
    </label>
    <label>
      <span>失敗後の最小間隔 日</span>
      <input name="minimumInterval" type="number" min="1" step="1" value="${escapeHtml(config.lapse.minimumInterval)}" />
    </label>
    <label>
      <span>Leech判定回数</span>
      <input name="leechThreshold" type="number" min="0" step="1" value="${escapeHtml(config.lapse.leechThreshold)}" />
    </label>
    <div class="settings-note wide">
      Anki本家のDeck Optionsを参考にした設定です。FSRSではなく標準スケジューラの非FSRS経路に反映されます。
    </div>
    <div class="form-actions wide">
      <button class="primary-button" type="submit">保存</button>
      <button class="secondary-button" type="button" data-reset-deck-config>標準に戻す</button>
    </div>
  `;
}

function statBox(label, value) {
  return `
    <div class="stat-box">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function calculateStreak() {
  if (!state.logs.length) return 0;
  const days = new Set(state.logs.map((log) => {
    const date = new Date(log.reviewedAt);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let streak = 0;
  while (days.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function stepsForCard(card) {
  const config = deckConfigFor(card);
  return card.type === CARD_TYPES.relearn
    ? config.lapse.delays
    : config.new.delays;
}

function remainingForFailed(steps) {
  return steps.length;
}

function stepIndex(steps, remaining) {
  const total = steps.length;
  return Math.min(total - Math.abs(remaining % 1000), Math.max(0, total - 1));
}

function secsAtStep(steps, index) {
  const value = steps[index];
  return value == null ? null : Math.round(value * 60);
}

function maybeRoundInDays(secs) {
  return secs > 86400 ? Math.round(secs / 86400) * 86400 : secs;
}

function againDelaySecs(steps) {
  return secsAtStep(steps, 0);
}

function hardDelaySecs(steps, remaining) {
  const index = stepIndex(steps, remaining);
  const current = secsAtStep(steps, index) ?? secsAtStep(steps, 0);
  if (current == null) return null;
  if (index === 0) {
    const next = secsAtStep(steps, 1);
    if (next != null) return maybeRoundInDays(Math.floor((current + next) / 2));
    return maybeRoundInDays(Math.min(Math.floor(current * 1.5), current + 86400));
  }
  return current;
}

function goodDelaySecs(steps, remaining) {
  return secsAtStep(steps, stepIndex(steps, remaining) + 1);
}

function remainingForGood(steps, remaining) {
  const index = stepIndex(steps, remaining);
  return Math.max(0, steps.length - (index + 1));
}

function constrainReviewInterval(value, minimum = 1, config = defaultDeckConfig()) {
  const rounded = Math.round(Math.max(value, minimum));
  return Math.min(config.rev.maximumInterval, Math.max(1, rounded));
}

function applyLearningDelay(card, scheduledSecs, remainingSteps, baseType = CARD_TYPES.learn) {
  const due = scheduledSecs >= 86400
    ? now() + Math.round(scheduledSecs / 86400) * DAY
    : now() + scheduledSecs * 1000;
  return {
    ...card,
    type: baseType,
    queue: scheduledSecs >= 86400 ? CARD_QUEUES.dayLearn : CARD_QUEUES.learn,
    due,
    scheduledSecs,
    remainingSteps,
    updatedAt: now(),
  };
}

function graduateToReview(card, days, easeFactor = deckConfigFor(card).new.initialEaseFactor) {
  const config = deckConfigFor(card);
  const scheduledDays = constrainReviewInterval(days * config.rev.intervalModifier, 1, config);
  return {
    ...card,
    type: CARD_TYPES.review,
    queue: CARD_QUEUES.review,
    due: now() + scheduledDays * DAY,
    interval: scheduledDays,
    intervalDays: scheduledDays,
    scheduledSecs: scheduledDays * 86400,
    remainingSteps: 0,
    ease: easeFactor,
    easeFactor,
    updatedAt: now(),
  };
}

function leechThresholdMet(lapses) {
  const threshold = ANKI_DEFAULTS.leechThreshold;
  if (threshold <= 0 || lapses < threshold) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return (lapses - threshold) % half === 0;
}

function leechThresholdMetForConfig(lapses, config) {
  const threshold = config.lapse.leechThreshold;
  if (threshold <= 0 || lapses < threshold) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return (lapses - threshold) % half === 0;
}

function scheduleNewOrLearning(card, rating) {
  const config = deckConfigFor(card);
  const steps = stepsForCard(card);
  const remaining = card.type === CARD_TYPES.new
    ? remainingForFailed(steps)
    : Math.max(1, card.remainingSteps || remainingForFailed(steps));

  if (rating === "again") {
    const delay = againDelaySecs(steps);
    if (delay == null) return graduateToReview(card, config.new.graduatingGood);
    return applyLearningDelay(card, delay, remainingForFailed(steps), card.type === CARD_TYPES.relearn ? CARD_TYPES.relearn : CARD_TYPES.learn);
  }

  if (rating === "hard") {
    const delay = hardDelaySecs(steps, remaining);
    if (delay == null) return graduateToReview(card, config.new.graduatingGood);
    return applyLearningDelay(card, delay, remaining, card.type === CARD_TYPES.relearn ? CARD_TYPES.relearn : CARD_TYPES.learn);
  }

  if (rating === "good") {
    const delay = goodDelaySecs(steps, remaining);
    if (delay != null) {
      return applyLearningDelay(
        card,
        delay,
        remainingForGood(steps, remaining),
        card.type === CARD_TYPES.relearn ? CARD_TYPES.relearn : CARD_TYPES.learn,
      );
    }
    return graduateToReview(card, config.new.graduatingGood);
  }

  return graduateToReview(card, config.new.graduatingEasy);
}

function elapsedReviewDays(card) {
  if (!card.lastReviewedAt) return Math.max(1, card.intervalDays || card.interval || 1);
  return Math.max(0, Math.round((now() - card.lastReviewedAt) / DAY));
}

function scheduleReview(card, rating) {
  const config = deckConfigFor(card);
  const scheduled = Math.max(1, card.intervalDays || card.interval || 1);
  const elapsed = elapsedReviewDays(card);
  const daysLate = Math.max(0, elapsed - scheduled);
  const ease = card.easeFactor || card.ease || ANKI_DEFAULTS.initialEaseFactor;

  if (rating === "again") {
    const lapses = card.lapses + 1;
    const easeFactor = Math.max(ANKI_DEFAULTS.minimumEaseFactor, ease - 0.2);
    const failingDays = constrainReviewInterval(
      Math.max(1, scheduled) * config.lapse.multiplier,
      config.lapse.minimumInterval,
      config,
    );
    const delay = againDelaySecs(config.lapse.delays);
    const reviewPart = {
      ...card,
      lapses,
      leech: card.leech || leechThresholdMetForConfig(lapses, config),
      ease: easeFactor,
      easeFactor,
      interval: failingDays,
      intervalDays: failingDays,
    };
    return delay == null
      ? graduateToReview(reviewPart, failingDays, easeFactor)
      : applyLearningDelay(reviewPart, delay, remainingForFailed(config.lapse.delays), CARD_TYPES.relearn);
  }

  const hard = constrainReviewInterval(
    scheduled * config.rev.hardFactor,
    config.rev.hardFactor <= 1 ? 1 : scheduled + 1,
    config,
  );
  const good = constrainReviewInterval((scheduled + daysLate / 2) * ease, hard + 1, config);
  const easy = constrainReviewInterval((scheduled + daysLate) * ease * config.rev.easyBonus, good + 1, config);

  if (rating === "hard") {
    return graduateToReview(card, hard, Math.max(ANKI_DEFAULTS.minimumEaseFactor, ease - 0.15));
  }
  if (rating === "good") {
    return graduateToReview(card, good, ease);
  }
  return graduateToReview(card, easy, ease + 0.15);
}

function schedule(card, rating) {
  const next = card.type === CARD_TYPES.review
    ? scheduleReview(card, rating)
    : scheduleNewOrLearning(card, rating);
  return {
    ...next,
    reps: card.reps + 1,
    lastReviewedAt: now(),
    updatedAt: now(),
  };
}

async function rateCard(cardId, rating) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;

  const updated = schedule(card, rating);
  await put("cards", updated);
  await put("logs", {
    id: uid("log"),
    cardId: card.id,
    deckId: card.deckId,
    rating,
    typedAnswer: state.typedAnswer,
    reviewedAt: now(),
    previousState: card.type,
    nextState: updated.type,
    previousQueue: card.queue,
    nextQueue: updated.queue,
    previousIntervalDays: card.intervalDays,
    nextIntervalDays: updated.intervalDays,
  });

  state.activeReviewCardId = null;
  state.answerVisible = false;
  state.typedAnswer = "";
  await refreshData();
}

async function toggleCardFlag(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card) return;

  await put("cards", {
    ...card,
    flagged: !card.flagged,
    updatedAt: now(),
  });
  await refreshData();
  toast(card.flagged ? "Flag removed" : "Flag added");
}

async function createTodayMistakeDeck() {
  const mistakeLogs = state.logs.filter((log) => (
    log.reviewedAt >= todayStartTimestamp()
    && (log.rating === "again" || log.rating === "hard")
  ));
  const cardIds = [...new Set(mistakeLogs.map((log) => log.cardId))];
  const sourceCards = cardIds
    .map((cardId) => state.cards.find((card) => card.id === cardId))
    .filter(Boolean);

  if (!sourceCards.length) {
    toast("\u4eca\u65e5\u306eAgain/Hard\u306f\u3042\u308a\u307e\u305b\u3093");
    return;
  }

  const deckName = `\u4eca\u65e5\u306e\u9593\u9055\u3044 ${new Date().toISOString().slice(0, 10)}`;
  let deck = state.decks.find((item) => item.name === deckName);
  if (!deck) {
    deck = createDeck(deckName);
    await put("decks", deck);
  }

  const existingCards = state.cards.filter((card) => card.deckId === deck.id);
  for (const card of existingCards) {
    await remove("cards", card.id);
  }

  for (const card of sourceCards) {
    const clone = createCard({
      deckId: deck.id,
      front: card.front,
      back: card.back,
      tags: [...new Set([...card.tags, "mistake-today"])],
      answerMode: card.answerMode,
      image: card.image ? { ...card.image } : null,
    });
    await put("cards", {
      ...clone,
      flagged: card.flagged,
      due: now(),
      type: CARD_TYPES.new,
      queue: CARD_QUEUES.new,
    });
  }

  state.currentDeckId = deck.id;
  state.area = "study";
  state.currentView = "add";
  state.reviewStarted = false;
  state.activeReviewCardId = null;
  state.answerVisible = false;
  state.typedAnswer = "";
  await refreshData();
  toast(`${sourceCards.length}\u679a\u3092${deckName}\u306b\u8ffd\u52a0\u3057\u307e\u3057\u305f`);
}

function showDeckCreator() {
  let form = $("#deck-create-form");
  if (!form) {
    form = document.createElement("form");
    form.id = "deck-create-form";
    form.className = "deck-create-form";
    form.dataset.deckCreateForm = "";
    form.innerHTML = `
      <label>
        <span>\u30c7\u30c3\u30ad\u540d</span>
        <input id="deck-name-input" name="name" type="text" autocomplete="off" />
      </label>
      <div class="deck-create-actions">
        <button class="primary-button" type="submit">\u4f5c\u6210</button>
        <button class="secondary-button" type="button" data-cancel-deck-create>\u30ad\u30e3\u30f3\u30bb\u30eb</button>
      </div>
    `;
    document.querySelector(".sidebar-header")?.after(form);
  }

  form.hidden = false;
  const input = $("#deck-name-input");
  input.value = "";
  input.focus();
}

function hideDeckCreator() {
  const form = $("#deck-create-form");
  if (form) form.hidden = true;
}

async function addDeck(event) {
  event?.preventDefault();
  const form = event?.target?.matches?.("[data-deck-create-form]") ? event.target : null;
  if (!form) {
    showDeckCreator();
    return;
  }

  const name = new FormData(form).get("name");
  const cleanName = name?.trim();
  if (!cleanName) {
    toast("\u30c7\u30c3\u30ad\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044");
    $("#deck-name-input")?.focus();
    return;
  }

  const deck = createDeck(cleanName);
  await put("decks", deck);
  state.currentDeckId = deck.id;
  hideDeckCreator();
  await refreshData();
  toast("\u30c7\u30c3\u30ad\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f");
}

async function ensureDeck() {
  if (state.decks.length) return state.decks[0];
  const deck = createDeck("未分類");
  await put("decks", deck);
  state.decks.push(deck);
  return deck;
}

async function addCard(event) {
  event.preventDefault();
  await ensureDeck();

  const deckId = selectors.cardDeck.value || state.decks[0]?.id;
  const front = selectors.cardFront.value.trim();
  const back = selectors.cardBack.value.trim();
  if (!deckId || !front || !back) {
    toast("表と裏を入力してください");
    return;
  }

  await put("cards", createCard({
    deckId,
    front,
    back,
    tags: parseTags(selectors.cardTags.value),
    answerMode: selectors.cardAnswerMode.value,
    image: state.pendingImage ? { ...state.pendingImage, side: selectors.cardImageSide.value } : null,
  }));

  clearCardForm();
  await refreshData();
  toast("カードを追加しました");
}

function clearCardForm() {
  selectors.cardFront.value = "";
  selectors.cardBack.value = "";
  selectors.cardTags.value = "";
  selectors.cardImage.value = "";
  state.pendingImage = null;
  renderImagePreview();
  selectors.cardFront.focus();
}

function renderImagePreview() {
  selectors.imagePreview.innerHTML = state.pendingImage
    ? `<img src="${escapeHtml(state.pendingImage.dataUrl)}" alt="${escapeHtml(state.pendingImage.name)}" /><span>${escapeHtml(state.pendingImage.name)}</span>`
    : "";
}

async function readImageFile(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) {
    toast("画像ファイルを選んでください");
    return null;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result), name: file.name });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function showEditForm(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  const item = document.querySelector(`[data-card-id="${CSS.escape(cardId)}"]`);
  if (!card || !item) return;

  item.querySelector(".edit-form")?.remove();
  const form = document.createElement("form");
  form.className = "edit-form";
  form.innerHTML = `
    <label>
      <span>表</span>
      <textarea name="front" required rows="4">${escapeHtml(card.front)}</textarea>
    </label>
    <label>
      <span>裏</span>
      <textarea name="back" required rows="4">${escapeHtml(card.back)}</textarea>
    </label>
    <label>
      <span>タグ</span>
      <input name="tags" type="text" value="${escapeHtml(card.tags.join(", "))}" />
    </label>
    <label>
      <span>回答方式</span>
      <select name="answerMode">
        <option value="self"${card.answerMode === "self" ? " selected" : ""}>自己採点</option>
        <option value="typed"${card.answerMode === "typed" ? " selected" : ""}>入力式</option>
      </select>
    </label>
    <label>
      <span>デッキ</span>
      <select name="deckId">
        ${state.decks.map((deck) => `<option value="${escapeHtml(deck.id)}"${deck.id === card.deckId ? " selected" : ""}>${escapeHtml(deck.name)}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>画像面</span>
      <select name="imageSide">
        <option value="front"${card.image?.side !== "back" ? " selected" : ""}>表</option>
        <option value="back"${card.image?.side === "back" ? " selected" : ""}>裏</option>
      </select>
    </label>
    <div class="form-actions">
      <button class="primary-button" type="submit">保存</button>
      <button class="secondary-button" type="button" data-remove-image>画像削除</button>
      <button class="secondary-button" type="button" data-cancel-edit>閉じる</button>
    </div>
  `;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const image = card.image ? { ...card.image, side: String(data.get("imageSide")) === "back" ? "back" : "front" } : null;
    await put("cards", {
      ...card,
      deckId: String(data.get("deckId")),
      front: String(data.get("front")).trim(),
      back: String(data.get("back")).trim(),
      tags: parseTags(String(data.get("tags"))),
      answerMode: String(data.get("answerMode")) === "typed" ? "typed" : "self",
      image,
      updatedAt: now(),
    });
    await refreshData();
    toast("保存しました");
  });

  form.querySelector("[data-remove-image]").addEventListener("click", async () => {
    await put("cards", { ...card, image: null, updatedAt: now() });
    await refreshData();
    toast("画像を削除しました");
  });
  form.querySelector("[data-cancel-edit]").addEventListener("click", () => form.remove());
  item.append(form);
}

async function deleteCard(cardId) {
  const card = state.cards.find((item) => item.id === cardId);
  if (!card || !confirm("このカードを削除しますか?")) return;

  await remove("cards", cardId);
  state.activeReviewCardId = null;
  await refreshData();
  toast("削除しました");
}

async function deleteDeck(deckId) {
  const deck = state.decks.find((item) => item.id === deckId);
  if (!deck) return;

  const cards = state.cards.filter((card) => card.deckId === deckId);
  const logs = state.logs.filter((log) => log.deckId === deckId);
  const ok = confirm(
    `デッキ「${deck.name}」を削除しますか?\nこのデッキ内のカード ${cards.length} 枚と学習履歴も削除されます。`,
  );
  if (!ok) return;

  for (const card of cards) {
    await remove("cards", card.id);
  }
  for (const log of logs) {
    await remove("logs", log.id);
  }
  await remove("decks", deckId);

  if (state.currentDeckId === deckId) {
    state.currentDeckId = "all";
  }
  if (cards.some((card) => card.id === state.activeReviewCardId)) {
    state.activeReviewCardId = null;
    state.answerVisible = false;
    state.typedAnswer = "";
  }

  await refreshData();
  toast("デッキを削除しました");
}

async function saveDeckSettings(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const deckId = String(data.get("deckId"));
  const deck = state.decks.find((item) => item.id === deckId);
  if (!deck) return;

  const toArray = (name, fallback) => {
    const value = String(data.get(name) ?? "");
    const parsed = value.split(/[,\s]+/).map(Number).filter((item) => Number.isFinite(item) && item >= 0);
    return parsed.length ? parsed : fallback;
  };
  const num = (name, fallback, min = 0) => {
    const parsed = Number(data.get(name));
    return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
  };

  const updated = {
    ...deck,
    config: normalizeDeckConfig({
      new: {
        delays: toArray("newDelays", deck.config.new.delays),
        graduatingGood: num("graduatingGood", deck.config.new.graduatingGood, 1),
        graduatingEasy: num("graduatingEasy", deck.config.new.graduatingEasy, 1),
        initialEaseFactor: num("initialEaseFactor", deck.config.new.initialEaseFactor, 1.3),
      },
      rev: {
        hardFactor: num("hardFactor", deck.config.rev.hardFactor, 1),
        easyBonus: num("easyBonus", deck.config.rev.easyBonus, 1),
        intervalModifier: num("intervalModifier", deck.config.rev.intervalModifier, 0.1),
        maximumInterval: num("maximumInterval", deck.config.rev.maximumInterval, 1),
      },
      lapse: {
        delays: toArray("lapseDelays", deck.config.lapse.delays),
        multiplier: num("lapseMultiplier", deck.config.lapse.multiplier, 0),
        minimumInterval: num("minimumInterval", deck.config.lapse.minimumInterval, 1),
        leechThreshold: num("leechThreshold", deck.config.lapse.leechThreshold, 0),
      },
    }),
    updatedAt: now(),
  };

  await put("decks", updated);
  await refreshData();
  toast("復習設定を保存しました");
}

async function resetDeckSettings() {
  const deckId = selectors.deckSettingsForm?.querySelector("[name='deckId']")?.value;
  const deck = state.decks.find((item) => item.id === deckId);
  if (!deck || !confirm("このデッキの復習設定を標準に戻しますか?")) return;

  await put("decks", { ...deck, config: defaultDeckConfig(), updatedAt: now() });
  await refreshData();
  toast("標準設定に戻しました");
}

function startReviewAhead(days) {
  const safeDays = Math.max(1, Math.min(365, Math.round(Number(days) || 1)));
  state.reviewAheadDays = safeDays;
  state.previewSession = { active: true, days: safeDays };
  state.activeReviewCardId = null;
  state.answerVisible = false;
  state.typedAnswer = "";
  renderReview();
  toast(`${safeDays}日先まで先取り復習します`);
}

function stopReviewAhead() {
  state.previewSession = null;
  state.activeReviewCardId = null;
  state.answerVisible = false;
  state.typedAnswer = "";
  renderReview();
  toast("先取り復習を終了しました");
}

function exportData() {
  const payload = {
    app: "browser-anki",
    version: 2,
    exportedAt: new Date().toISOString(),
    decks: state.decks,
    cards: state.cards,
    logs: state.logs,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `browser-anki-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("JSONを書き出しました");
}

async function importFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".csv")) {
    startCsvImport(text, file.name);
  } else {
    await importJson(text);
    await refreshData();
  }
}

async function importJson(text) {
  const payload = JSON.parse(text);
  for (const deck of Array.isArray(payload.decks) ? payload.decks : []) {
    if (deck.id && deck.name) await put("decks", normalizeDeck(deck));
  }
  for (const card of Array.isArray(payload.cards) ? payload.cards : []) {
    if (card.id && card.deckId && card.front && card.back) await put("cards", normalizeCard(card));
  }
  for (const log of Array.isArray(payload.logs) ? payload.logs : []) {
    if (log.id && log.cardId && log.deckId) await put("logs", normalizeLog(log));
  }
  toast("JSONを読み込みました");
}

function startCsvImport(text, fileName = "cards.csv") {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) {
    toast("CSVが空です");
    return;
  }

  const header = rows[0].map((cell) => cell.trim());
  const lower = header.map((cell) => cell.toLowerCase());
  const hasHeader = lower.includes("front") || lower.includes("back") || lower.includes("表") || lower.includes("裏");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  state.csvDraft = {
    fileName,
    rows: dataRows,
    columns: hasHeader ? header : rows[0].map((_, index) => `列 ${index + 1}`),
    mapping: {
      front: guessColumn(lower, ["front", "question", "表", "問題"], 0),
      back: guessColumn(lower, ["back", "answer", "裏", "回答", "答え"], 1),
      tags: guessColumn(lower, ["tags", "tag", "タグ"], -1),
      deck: guessColumn(lower, ["deck", "deckname", "デッキ"], -1),
      answerMode: guessColumn(lower, ["mode", "answer_mode", "回答方式"], -1),
      image: guessColumn(lower, ["image", "image_url", "画像"], -1),
      imageSide: guessColumn(lower, ["image_side", "画像面"], -1),
    },
    defaults: {
      deckName: state.currentDeckId === "all" ? (state.decks[0]?.name ?? "未分類") : getDeckName(state.currentDeckId),
      answerMode: "self",
      imageSide: "front",
    },
  };
  state.csvDraft.mapping.frontColumns = state.csvDraft.mapping.front >= 0 ? [state.csvDraft.mapping.front] : [];
  state.csvDraft.mapping.backColumns = state.csvDraft.mapping.back >= 0 ? [state.csvDraft.mapping.back] : [];
  state.csvDraft.defaults.startRow = 1;
  state.csvDraft.defaults.endRow = dataRows.length;
  state.area = "manage";
  state.currentView = "import";
  render();
}

function guessColumn(header, names, fallback) {
  const index = header.findIndex((cell) => names.includes(cell));
  return index >= 0 ? index : fallback;
}

function renderCsvPanel() {
  if (!state.csvDraft) return;

  const draft = state.csvDraft;
  selectors.csvImportPanel.className = "csv-panel";
  selectors.csvImportPanel.innerHTML = `
    <form id="csv-import-form" class="csv-import-form">
      <div class="csv-summary">
        <strong>${escapeHtml(draft.fileName)}</strong>
        <span>${draft.rows.length}行を読み込み予定</span>
      </div>
      <div class="csv-map-grid">
        ${columnSelect("front", "表", draft.mapping.front, true)}
        ${columnSelect("back", "裏", draft.mapping.back, true)}
        ${columnSelect("tags", "タグ", draft.mapping.tags)}
        ${columnSelect("deck", "デッキ", draft.mapping.deck)}
        ${columnSelect("answerMode", "回答方式", draft.mapping.answerMode)}
        ${columnSelect("image", "画像URL/Data URL", draft.mapping.image)}
        ${columnSelect("imageSide", "画像面", draft.mapping.imageSide)}
        <label>
          <span>デフォルトデッキ</span>
          <input name="defaultDeck" type="text" value="${escapeHtml(draft.defaults.deckName)}" />
        </label>
        <label>
          <span>デフォルト回答方式</span>
          <select name="defaultAnswerMode">
            <option value="self"${draft.defaults.answerMode === "self" ? " selected" : ""}>自己採点</option>
            <option value="typed"${draft.defaults.answerMode === "typed" ? " selected" : ""}>入力式</option>
          </select>
        </label>
        <label>
          <span>デフォルト画像面</span>
          <select name="defaultImageSide">
            <option value="front"${draft.defaults.imageSide === "front" ? " selected" : ""}>表</option>
            <option value="back"${draft.defaults.imageSide === "back" ? " selected" : ""}>裏</option>
          </select>
        </label>
      </div>
      <div class="csv-preview">
        <h2>プレビュー</h2>
        <div class="preview-table">${csvPreviewMarkup()}</div>
      </div>
      <div class="form-actions">
        <button class="primary-button" type="submit">読み込む</button>
        <button class="secondary-button" type="button" data-cancel-csv>キャンセル</button>
      </div>
    </form>
  `;

  const mapGrid = selectors.csvImportPanel.querySelector(".csv-map-grid");
  mapGrid?.insertAdjacentHTML("afterbegin", `
    ${columnMultiSelect("frontColumns", "表 複数列", draft.mapping.frontColumns, true)}
    ${columnMultiSelect("backColumns", "裏 複数列", draft.mapping.backColumns, true)}
    <label>
      <span>インポート開始行</span>
      <input name="startRow" type="number" min="1" step="1" value="${escapeHtml(draft.defaults.startRow)}" />
    </label>
    <label>
      <span>インポート終了行</span>
      <input name="endRow" type="number" min="1" step="1" value="${escapeHtml(draft.defaults.endRow)}" />
    </label>
  `);
  mapGrid?.querySelector("select[name='front']")?.closest("label")?.remove();
  mapGrid?.querySelector("select[name='back']")?.closest("label")?.remove();

  $("#csv-import-form").addEventListener("submit", commitCsvImport);
  selectors.csvImportPanel.querySelector("[data-cancel-csv]").addEventListener("click", () => {
    state.csvDraft = null;
    renderCsvPanelEmpty();
  });
}

function renderCsvPanelEmpty() {
  selectors.csvImportPanel.className = "csv-panel empty-state";
  selectors.csvImportPanel.innerHTML = `
    <div>
      <h2>CSVを選んで列を割り当て</h2>
      <p>表、裏、タグ、回答方式、デッキ、画像列を読み込み前に指定できます。</p>
    </div>
  `;
}

function columnSelect(name, label, selectedIndex, required = false) {
  return `
    <label>
      <span>${escapeHtml(label)}${required ? " *" : ""}</span>
      <select name="${escapeHtml(name)}">
        <option value="-1">使わない</option>
        ${state.csvDraft.columns.map((column, index) => `
          <option value="${index}"${index === selectedIndex ? " selected" : ""}>${escapeHtml(column)}</option>
        `).join("")}
      </select>
    </label>
  `;
}

function columnMultiSelect(name, label, selectedIndexes = [], required = false) {
  const selected = new Set(selectedIndexes.map(Number));
  return `
    <fieldset class="csv-column-multi">
      <legend>${escapeHtml(label)}${required ? " *" : ""}</legend>
      <div class="csv-column-options">
        ${state.csvDraft.columns.map((column, index) => `
          <label class="csv-column-option">
            <input type="checkbox" name="${escapeHtml(name)}" value="${index}"${selected.has(index) ? " checked" : ""} />
            <span>${escapeHtml(column)}</span>
          </label>
        `).join("")}
      </div>
    </fieldset>
  `;
}

function csvPreviewMarkup() {
  const rows = state.csvDraft.rows.slice(0, 5);
  return `
    <table>
      <thead>
        <tr>${state.csvDraft.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows.map((row) => `<tr>${state.csvDraft.columns.map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function commitCsvImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const indexFor = (name) => Number(data.get(name));
  const indexesFor = (name, fallbackName) => {
    const values = data.getAll(name).map(Number).filter((index) => Number.isInteger(index) && index >= 0);
    if (values.length) return values;
    const fallback = indexFor(fallbackName);
    return fallback >= 0 ? [fallback] : [];
  };
  const frontIndexes = indexesFor("frontColumns", "front");
  const backIndexes = indexesFor("backColumns", "back");

  if (!frontIndexes.length || !backIndexes.length) {
    toast("表と裏の列を選んでください");
    return;
  }

  const startRow = Math.max(1, Math.round(Number(data.get("startRow")) || 1));
  const endRow = Math.min(
    state.csvDraft.rows.length,
    Math.max(startRow, Math.round(Number(data.get("endRow")) || state.csvDraft.rows.length)),
  );
  const deckCache = new Map(state.decks.map((deck) => [deck.name.toLowerCase(), deck]));
  let count = 0;

  for (const [rowIndex, row] of state.csvDraft.rows.entries()) {
    const rowNumber = rowIndex + 1;
    if (rowNumber < startRow || rowNumber > endRow) continue;

    const front = valuesFromRow(row, frontIndexes);
    const back = valuesFromRow(row, backIndexes);
    if (!front || !back) continue;

    const deckName = valueFromRow(row, indexFor("deck")) || String(data.get("defaultDeck") || "未分類").trim();
    const deck = await findOrCreateDeck(deckName, deckCache);
    const modeValue = valueFromRow(row, indexFor("answerMode")).toLowerCase();
    const answerMode = normalizeAnswerMode(modeValue || String(data.get("defaultAnswerMode")));
    const imageValue = valueFromRow(row, indexFor("image"));
    const imageSideValue = valueFromRow(row, indexFor("imageSide"));
    const image = imageValue ? {
      dataUrl: imageValue,
      name: "csv-image",
      side: imageSideValue === "back" ? "back" : String(data.get("defaultImageSide")) === "back" ? "back" : "front",
    } : null;

    await put("cards", createCard({
      deckId: deck.id,
      front,
      back,
      tags: parseTags(valueFromRow(row, indexFor("tags"))),
      answerMode,
      image,
    }));
    count += 1;
  }

  state.csvDraft = null;
  await refreshData();
  state.area = "manage";
  state.currentView = "browse";
  await refreshData();
  toast(`${count}枚読み込みました`);
}

function valueFromRow(row, index) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function valuesFromRow(row, indexes) {
  return indexes
    .map((index) => valueFromRow(row, index))
    .filter(Boolean)
    .join("\n");
}

function normalizeAnswerMode(value) {
  const clean = String(value).trim().toLowerCase();
  return ["typed", "type", "input", "入力", "入力式"].includes(clean) ? "typed" : "self";
}

async function findOrCreateDeck(name, cache) {
  const cleanName = name.trim() || "未分類";
  const cached = cache.get(cleanName.toLowerCase()) || getDeckByName(cleanName);
  if (cached) return cached;

  const deck = createDeck(cleanName);
  await put("decks", deck);
  cache.set(cleanName.toLowerCase(), deck);
  state.decks.push(deck);
  return deck;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function toast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  selectors.toastRegion.append(element);
  setTimeout(() => element.remove(), 3200);
}

function scrollToAnswerFace() {
  requestAnimationFrame(() => {
    const answer = document.querySelector(".answer-face");
    if (!answer) return;
    answer.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;

    if (target.dataset.area) {
      state.area = target.dataset.area;
      if (state.area !== "study") {
        state.reviewStarted = false;
      }
      renderAreas();
    } else if (target.dataset.areaJump) {
      state.area = target.dataset.areaJump;
      state.currentView = target.dataset.areaJump === "manage" ? "browse" : state.currentView;
      if (state.area !== "study") {
        state.reviewStarted = false;
      }
      render();
    } else if (target.dataset.view) {
      state.currentView = target.dataset.view;
      renderManageTabs();
    } else if (target.dataset.deckId) {
      state.currentDeckId = target.dataset.deckId;
      state.reviewStarted = false;
      state.activeReviewCardId = null;
      state.answerVisible = false;
      state.typedAnswer = "";
      render();
    } else if (target.hasAttribute("data-start-review")) {
      state.area = "study";
      state.reviewStarted = true;
      state.activeReviewCardId = null;
      state.answerVisible = false;
      state.typedAnswer = "";
      render();
    } else if (target.hasAttribute("data-stop-review")) {
      state.reviewStarted = false;
      state.activeReviewCardId = null;
      state.answerVisible = false;
      state.typedAnswer = "";
      render();
    } else if (target.dataset.toggleTag) {
      const tag = target.dataset.toggleTag;
      state.selectedTags = state.selectedTags.includes(tag)
        ? state.selectedTags.filter((item) => item !== tag)
        : state.selectedTags.concat(tag);
      state.activeReviewCardId = null;
      state.answerVisible = false;
      state.typedAnswer = "";
      render();
    } else if (target.hasAttribute("data-clear-tags")) {
      state.selectedTags = [];
      state.tagRangeStart = "";
      state.tagRangeEnd = "";
      state.activeReviewCardId = null;
      state.answerVisible = false;
      state.typedAnswer = "";
      render();
    } else if (target.hasAttribute("data-show-answer")) {
      state.answerVisible = true;
      renderReview();
      scrollToAnswerFace();
    } else if (target.dataset.toggleFlag) {
      toggleCardFlag(target.dataset.toggleFlag);
    } else if (target.dataset.rate) {
      rateCard(state.activeReviewCardId, target.dataset.rate);
    } else if (target.dataset.editCard) {
      showEditForm(target.dataset.editCard);
    } else if (target.dataset.deleteCard) {
      deleteCard(target.dataset.deleteCard);
    } else if (target.dataset.deleteDeck) {
      deleteDeck(target.dataset.deleteDeck);
    } else if (target.hasAttribute("data-stop-ahead")) {
      stopReviewAhead();
    } else if (target.hasAttribute("data-create-mistake-deck")) {
      createTodayMistakeDeck();
    } else if (target.hasAttribute("data-cancel-deck-create")) {
      hideDeckCreator();
    } else if (target.hasAttribute("data-reset-deck-config")) {
      resetDeckSettings();
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.matches("[data-typed-form]")) {
      event.preventDefault();
      state.typedAnswer = $("#typed-answer")?.value ?? "";
      state.answerVisible = true;
      renderReview();
      scrollToAnswerFace();
    } else if (event.target.matches("[data-ahead-form]")) {
      event.preventDefault();
      const days = new FormData(event.target).get("days");
      startReviewAhead(days);
    } else if (event.target.matches("[data-tag-range-form]")) {
      event.preventDefault();
      applyTagRange(event.target);
    } else if (event.target.matches("[data-deck-create-form]")) {
      addDeck(event);
    }
  });

  $("#new-deck").addEventListener("click", addDeck);
  $("#export-data").addEventListener("click", exportData);
  $("#import-data").addEventListener("click", () => selectors.fileInput.click());
  $("#choose-csv").addEventListener("click", () => selectors.csvFileInput.click());
  $("#clear-card-form").addEventListener("click", clearCardForm);
  selectors.cardForm.addEventListener("submit", addCard);
  selectors.deckSettingsForm?.addEventListener("submit", saveDeckSettings);

  selectors.cardSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderBrowse();
  });

  selectors.cardImage.addEventListener("change", async () => {
    state.pendingImage = await readImageFile(selectors.cardImage.files?.[0]);
    renderImagePreview();
  });

  selectors.fileInput.addEventListener("change", async () => {
    const file = selectors.fileInput.files?.[0];
    selectors.fileInput.value = "";
    if (!file) return;
    try {
      await importFile(file);
    } catch (error) {
      console.error(error);
      toast("読み込みに失敗しました");
    }
  });

  selectors.csvFileInput.addEventListener("change", async () => {
    const file = selectors.csvFileInput.files?.[0];
    selectors.csvFileInput.value = "";
    if (!file) return;
    try {
      startCsvImport(await file.text(), file.name);
    } catch (error) {
      console.error(error);
      toast("CSVを開けませんでした");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (state.area !== "study" || !state.activeReviewCardId) return;

    if (event.key === " " && !state.answerVisible) {
      event.preventDefault();
      state.answerVisible = true;
      renderReview();
    } else if (state.answerVisible && ["1", "2", "3", "4"].includes(event.key)) {
      const rating = ["again", "hard", "good", "easy"][Number(event.key) - 1];
      rateCard(state.activeReviewCardId, rating);
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    selectors.storageState.textContent = "Local";
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
    selectors.storageState.textContent = "Offline ready";
  } catch {
    selectors.storageState.textContent = "Local";
  }
}

async function init() {
  bindEvents();
  loadUiState();
  await seedIfEmpty();
  await refreshData();
  await registerServiceWorker();
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main class="empty-state" style="margin: 40px;">
      <div>
        <h1>起動に失敗しました</h1>
        <p>${escapeHtml(error.message ?? String(error))}</p>
      </div>
    </main>
  `;
});
