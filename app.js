const DB_NAME = "french-cards-db";
const DB_VERSION = 1;
const SETTINGS_KEY = "french-cards-settings";

const state = {
  sets: [],
  activeSetId: null,
  deck: [],
  cardIndex: 0,
  isBack: false,
  mode: "zh-fr"
};

const els = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  activeSetSelect: document.querySelector("#activeSetSelect"),
  storageStatus: document.querySelector("#storageStatus"),
  progressText: document.querySelector("#progressText"),
  dueText: document.querySelector("#dueText"),
  cardButton: document.querySelector("#cardButton"),
  cardKicker: document.querySelector("#cardKicker"),
  cardMain: document.querySelector("#cardMain"),
  cardExtra: document.querySelector("#cardExtra"),
  againBtn: document.querySelector("#againBtn"),
  flipBtn: document.querySelector("#flipBtn"),
  knowBtn: document.querySelector("#knowBtn"),
  setNameInput: document.querySelector("#setNameInput"),
  importText: document.querySelector("#importText"),
  previewBtn: document.querySelector("#previewBtn"),
  saveSetBtn: document.querySelector("#saveSetBtn"),
  previewList: document.querySelector("#previewList"),
  setsList: document.querySelector("#setsList"),
  newSampleBtn: document.querySelector("#newSampleBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importFile: document.querySelector("#importFile"),
  toast: document.querySelector("#toast"),
  modeButtons: document.querySelectorAll("[data-mode]")
};

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sets", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = callback(store);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getAllSets() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("sets", "readonly");
    const request = transaction.objectStore("sets").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}

function putSet(set) {
  return tx("sets", "readwrite", store => store.put(set));
}

function deleteSet(id) {
  return tx("sets", "readwrite", store => store.delete(id));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    activeSetId: state.activeSetId,
    mode: state.mode
  }));
}

function parseCards(text) {
  return text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line
        .split(/\s*(?:\||\t|,|，|;|；)\s*/)
        .map(part => part.trim())
        .filter(Boolean);
      return {
        id: crypto.randomUUID(),
        french: parts[0] || "",
        chinese: parts[1] || "",
        exampleFr: parts[2] || "",
        exampleZh: parts[3] || "",
        stats: { seen: 0, known: 0, again: 0, lastReviewed: null }
      };
    })
    .filter(card => card.french && card.chinese);
}

function dueCards(set) {
  if (!set) return [];
  return [...set.cards].sort((a, b) => {
    const aScore = (a.stats?.known || 0) - (a.stats?.again || 0);
    const bScore = (b.stats?.known || 0) - (b.stats?.again || 0);
    return aScore - bScore;
  });
}

function currentSet() {
  return state.sets.find(set => set.id === state.activeSetId) || null;
}

function currentCard() {
  return state.deck[state.cardIndex] || null;
}

function cardDirection() {
  if (state.mode !== "mixed") return state.mode;
  const card = currentCard();
  if (!card) return "zh-fr";
  return card.id.charCodeAt(0) % 2 === 0 ? "zh-fr" : "fr-zh";
}

function renderCard() {
  const set = currentSet();
  state.deck = dueCards(set);
  if (state.cardIndex >= state.deck.length) state.cardIndex = 0;

  const card = currentCard();
  els.progressText.textContent = `${state.deck.length ? state.cardIndex + 1 : 0} / ${state.deck.length}`;
  els.dueText.textContent = `今日待复习 ${state.deck.length}`;

  if (!card) {
    els.cardKicker.textContent = "准备开始";
    els.cardMain.textContent = "导入一组词表后开始复习";
    els.cardExtra.textContent = "";
    return;
  }

  const direction = cardDirection();
  const front = direction === "zh-fr" ? card.chinese : card.french;
  const backMain = direction === "zh-fr" ? card.french : card.chinese;
  const example = direction === "zh-fr"
    ? [card.exampleFr, card.exampleZh].filter(Boolean).join("\n")
    : [card.exampleZh, card.exampleFr].filter(Boolean).join("\n");

  els.cardKicker.textContent = state.isBack ? "答案" : (direction === "zh-fr" ? "中→法" : "法→中");
  els.cardMain.textContent = state.isBack ? backMain : front;
  els.cardExtra.textContent = state.isBack ? example : "点卡片或按“翻面”查看答案";
}

function renderSets() {
  els.activeSetSelect.innerHTML = "";
  if (!state.sets.length) {
    els.activeSetSelect.innerHTML = '<option value="">暂无词表</option>';
  } else {
    for (const set of state.sets) {
      const option = document.createElement("option");
      option.value = set.id;
      option.textContent = `${set.name} (${set.cards.length})`;
      option.selected = set.id === state.activeSetId;
      els.activeSetSelect.append(option);
    }
  }

  els.setsList.innerHTML = "";
  if (!state.sets.length) {
    els.setsList.innerHTML = '<div class="preview-item"><span class="item-title">还没有词表</span><span class="item-meta">去“导入”粘贴一组内容。</span></div>';
    return;
  }

  for (const set of state.sets) {
    const item = document.createElement("div");
    item.className = "set-item";
    item.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(set.name)}</div>
        <div class="item-meta">${set.cards.length} 张卡片 · ${new Date(set.updatedAt).toLocaleString()}</div>
      </div>
      <button class="secondary danger" type="button" data-delete-set="${set.id}">删除</button>
    `;
    els.setsList.append(item);
  }
}

function renderPreview(cards) {
  els.previewList.innerHTML = "";
  if (!cards.length) {
    els.previewList.innerHTML = '<div class="preview-item"><span class="item-title">没有识别到卡片</span><span class="item-meta">每行至少需要“法语 | 中文”。</span></div>';
    return;
  }

  for (const card of cards.slice(0, 8)) {
    const item = document.createElement("div");
    item.className = "preview-item";
    item.innerHTML = `
      <span class="item-title">${escapeHtml(card.french)} · ${escapeHtml(card.chinese)}</span>
      <span class="item-meta">${escapeHtml([card.exampleFr, card.exampleZh].filter(Boolean).join(" / "))}</span>
    `;
    els.previewList.append(item);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

function switchView(id) {
  els.tabs.forEach(tab => tab.classList.toggle("is-active", tab.dataset.view === id));
  els.views.forEach(view => view.classList.toggle("is-active", view.id === id));
}

async function refresh() {
  state.sets = await getAllSets();
  if (!state.activeSetId || !state.sets.some(set => set.id === state.activeSetId)) {
    state.activeSetId = state.sets[0]?.id || null;
  }
  renderSets();
  renderCard();
  saveSettings();
}

async function saveImportedSet() {
  const cards = parseCards(els.importText.value);
  if (!cards.length) {
    toast("没有识别到可保存的卡片");
    return;
  }

  const now = Date.now();
  const set = {
    id: crypto.randomUUID(),
    name: els.setNameInput.value.trim() || "未命名词表",
    cards,
    createdAt: now,
    updatedAt: now
  };
  await putSet(set);
  state.activeSetId = set.id;
  state.cardIndex = 0;
  state.isBack = false;
  await refresh();
  switchView("reviewView");
  toast(`已保存 ${cards.length} 张卡片`);
}

async function updateCardStats(kind) {
  const set = currentSet();
  const card = currentCard();
  if (!set || !card) return;
  card.stats = card.stats || { seen: 0, known: 0, again: 0, lastReviewed: null };
  card.stats.seen += 1;
  card.stats[kind] += 1;
  card.stats.lastReviewed = Date.now();
  set.updatedAt = Date.now();
  await putSet(set);
  state.cardIndex = Math.min(state.cardIndex + 1, state.deck.length - 1);
  if (state.cardIndex === state.deck.length - 1 && state.deck.length > 1) {
    state.cardIndex = (state.cardIndex + 1) % state.deck.length;
  }
  state.isBack = false;
  await refresh();
}

async function addSampleSet() {
  els.setNameInput.value = "通勤示例";
  els.importText.value = `attendre | 等待 | J'attends le bus. | 我在等公交。
descendre | 下去；下车 | Je descends à la prochaine station. | 我下一站下车。
retard | 迟到；延误 | Le train a du retard. | 火车晚点了。
billet | 票 | J'ai acheté un billet. | 我买了一张票。`;
  await saveImportedSet();
}

async function exportData() {
  const payload = {
    app: "French Cards",
    exportedAt: new Date().toISOString(),
    sets: state.sets
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `french-cards-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const payload = JSON.parse(await file.text());
  const sets = Array.isArray(payload.sets) ? payload.sets : [];
  for (const set of sets) {
    await putSet({ ...set, id: set.id || crypto.randomUUID(), updatedAt: Date.now() });
  }
  await refresh();
  toast(`已导入 ${sets.length} 个词表`);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    els.storageStatus.textContent = "本地保存";
    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js");
    els.storageStatus.textContent = "离线可用";
  } catch {
    els.storageStatus.textContent = "本地保存";
  }
}

els.tabs.forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
els.modeButtons.forEach(button => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    state.isBack = false;
    els.modeButtons.forEach(item => item.classList.toggle("is-active", item === button));
    saveSettings();
    renderCard();
  });
});

els.activeSetSelect.addEventListener("change", () => {
  state.activeSetId = els.activeSetSelect.value;
  state.cardIndex = 0;
  state.isBack = false;
  saveSettings();
  renderCard();
});

els.cardButton.addEventListener("click", () => {
  state.isBack = !state.isBack;
  renderCard();
});
els.flipBtn.addEventListener("click", () => {
  state.isBack = !state.isBack;
  renderCard();
});
els.againBtn.addEventListener("click", () => updateCardStats("again"));
els.knowBtn.addEventListener("click", () => updateCardStats("known"));
els.previewBtn.addEventListener("click", () => renderPreview(parseCards(els.importText.value)));
els.saveSetBtn.addEventListener("click", saveImportedSet);
els.newSampleBtn.addEventListener("click", addSampleSet);
els.exportBtn.addEventListener("click", exportData);
els.importFile.addEventListener("change", event => {
  const [file] = event.target.files;
  if (file) importData(file).catch(() => toast("导入失败，文件格式不对"));
});
els.setsList.addEventListener("click", async event => {
  const button = event.target.closest("[data-delete-set]");
  if (!button) return;
  await deleteSet(button.dataset.deleteSet);
  await refresh();
  toast("已删除词表");
});

async function init() {
  const settings = loadSettings();
  state.activeSetId = settings.activeSetId || null;
  state.mode = settings.mode || "zh-fr";
  els.modeButtons.forEach(item => item.classList.toggle("is-active", item.dataset.mode === state.mode));
  renderPreview(parseCards(els.importText.value));
  await refresh();
  await registerServiceWorker();
}

init().catch(error => {
  console.error(error);
  toast("初始化失败");
});
