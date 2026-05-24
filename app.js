// ── IndexedDB ─────────────────────────────────────────────────────────────────
const DB_NAME = "french-cards-db";
const DB_VERSION = 1;
const SETTINGS_KEY = "french-cards-settings";
let _db;

function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore("sets", { keyPath: "id" });
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror   = () => rej(req.error);
  });
}

async function getAllSets() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const req = db.transaction("sets","readonly").objectStore("sets").getAll();
    req.onsuccess = () => res(req.result.sort((a,b) => b.updatedAt - a.updatedAt));
    req.onerror   = () => rej(req.error);
  });
}

async function putSet(set) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("sets","readwrite");
    tx.objectStore("sets").put(set);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function deleteSet(id) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction("sets","readwrite");
    tx.objectStore("sets").delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  sets: [],
  activeSetId: null,
  reviewMode: "flip",   // "flip" | "spell"
  direction: "zh-fr",   // "zh-fr" | "fr-zh" | "mixed"
  // session
  sessionDeck: [],
  sessionTotal: 0,
  sessionStats: { known: 0, again: 0 },
  // flip state
  isBack: false,
  // spell state
  spellResult: null,    // null | "correct" | "wrong"
  spellUserInput: "",
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = s => document.querySelectorAll(s);

const el = {
  tabs: $$(".tab"), views: $$(".view"),
  storageStatus: $("storageStatus"),
  activeSetSelect: $("activeSetSelect"),
  progressFill: $("progressFill"), progressText: $("progressText"),
  // flip
  flipArea: $("flipArea"),
  cardButton: $("cardButton"), cardKicker: $("cardKicker"),
  cardMain: $("cardMain"), cardExtra: $("cardExtra"),
  againBtn: $("againBtn"), flipBtn: $("flipBtn"), knowBtn: $("knowBtn"),
  // spell
  spellArea: $("spellArea"),
  spellKicker: $("spellKicker"), spellPrompt: $("spellPrompt"),
  spellInput: $("spellInput"), spellResult: $("spellResult"),
  checkBtn: $("checkBtn"), nextBtn: $("nextBtn"),
  // completion
  completionScreen: $("completionScreen"),
  statTotal: $("statTotal"), statAgain: $("statAgain"),
  restartBtn: $("restartBtn"),
  // import
  setNameInput: $("setNameInput"), importText: $("importText"),
  previewBtn: $("previewBtn"), saveSetBtn: $("saveSetBtn"),
  previewList: $("previewList"),
  // sets
  setsList: $("setsList"), newSampleBtn: $("newSampleBtn"),
  // backup
  exportBtn: $("exportBtn"), importFile: $("importFile"),
  // toast
  toast: $("toast"),
};

// ── Settings ──────────────────────────────────────────────────────────────────
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    activeSetId: state.activeSetId,
    reviewMode: state.reviewMode,
    direction: state.direction,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
}
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("is-visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove("is-visible"), 2200);
}
function switchView(id) {
  el.tabs.forEach(t => t.classList.toggle("is-active", t.dataset.view === id));
  el.views.forEach(v => v.classList.toggle("is-active", v.id === id));
}

// ── Card parsing ──────────────────────────────────────────────────────────────
function parseCards(text) {
  return text.split(/\n+/).map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(/\s*(?:\||\t)\s*/).map(p => p.trim()).filter(Boolean);
    return {
      id: crypto.randomUUID(),
      french: parts[0] || "", chinese: parts[1] || "",
      exampleFr: parts[2] || "", exampleZh: parts[3] || "",
      stats: { seen:0, known:0, again:0, lastReviewed:null },
    };
  }).filter(c => c.french && c.chinese);
}

// ── Session management ────────────────────────────────────────────────────────
function currentSet() {
  return state.sets.find(s => s.id === state.activeSetId) || null;
}

function cardDir(card) {
  if (state.direction !== "mixed") return state.direction;
  return card.id.charCodeAt(0) % 2 === 0 ? "zh-fr" : "fr-zh";
}

function getCardContent(card) {
  const isFwd = cardDir(card) === "zh-fr";
  return {
    kicker:  isFwd ? "ZH → FR" : "FR → ZH",
    prompt:  isFwd ? card.chinese  : card.french,
    answer:  isFwd ? card.french   : card.chinese,
    example: [card.exampleFr, card.exampleZh].filter(Boolean).join("\n"),
  };
}

function startSession() {
  const set = currentSet();
  if (!set || !set.cards.length) {
    state.sessionDeck  = [];
    state.sessionTotal = 0;
    state.sessionStats = { known:0, again:0 };
    state.isBack = false; state.spellResult = null;
    renderCard(); return;
  }
  // Hardest first (lowest known – again score)
  state.sessionDeck = [...set.cards].sort((a,b) => {
    const aS = (a.stats?.known||0) - (a.stats?.again||0);
    const bS = (b.stats?.known||0) - (b.stats?.again||0);
    return aS - bS;
  });
  state.sessionTotal = state.sessionDeck.length;
  state.sessionStats = { known:0, again:0 };
  state.isBack = false; state.spellResult = null;
  renderCard();
}

async function markCard(kind) {
  const card = state.sessionDeck[0];
  const set  = currentSet();
  if (!card || !set) return;
  card.stats = card.stats || { seen:0, known:0, again:0, lastReviewed:null };
  card.stats.seen++;
  card.stats[kind]++;
  card.stats.lastReviewed = Date.now();
  set.updatedAt = Date.now();
  await putSet(set);
  state.sessionStats[kind]++;
}

function advanceCard(kind) {
  if (kind === "known") {
    state.sessionDeck.shift();
  } else {
    const c = state.sessionDeck.shift();
    state.sessionDeck.push(c);
  }
  state.isBack = false;
  state.spellResult = null;
  state.spellUserInput = "";

  if (kind === "known" && state.sessionDeck.length === 0) {
    showCompletion(); return;
  }
  renderCard();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderProgress() {
  const known = state.sessionStats.known;
  const total = state.sessionTotal;
  el.progressFill.style.width = total ? (known / total * 100) + "%" : "0%";
  el.progressText.textContent = total ? `${known} / ${total}` : "0 / 0";
}

function renderCard() {
  renderProgress();
  el.completionScreen.classList.add("hidden");

  const card   = state.sessionDeck[0];
  const isFlip = state.reviewMode === "flip";

  // ── empty state ──
  if (!card) {
    el.flipArea.classList.remove("hidden");
    el.spellArea.classList.add("hidden");
    el.cardKicker.textContent = "";
    el.cardMain.textContent   = "Sélectionnez ou importez une liste";
    el.cardExtra.textContent  = "";
    el.cardExtra.className    = "card-extra";
    el.againBtn.classList.add("hidden");
    el.knowBtn.classList.add("hidden");
    el.flipBtn.classList.add("hidden");
    return;
  }

  const { kicker, prompt, answer, example } = getCardContent(card);

  // ── flip mode ──
  if (isFlip) {
    el.flipArea.classList.remove("hidden");
    el.spellArea.classList.add("hidden");

    if (!state.isBack) {
      el.cardKicker.textContent = kicker;
      el.cardMain.textContent   = prompt;
      el.cardExtra.textContent  = "Appuyer pour voir la réponse";
      el.cardExtra.className    = "card-extra is-hint";
      el.againBtn.classList.add("hidden");
      el.knowBtn.classList.add("hidden");
      el.flipBtn.classList.remove("hidden");
    } else {
      el.cardKicker.textContent = "Réponse";
      el.cardMain.textContent   = answer;
      el.cardExtra.textContent  = example;
      el.cardExtra.className    = "card-extra";
      el.againBtn.classList.remove("hidden");
      el.knowBtn.classList.remove("hidden");
      el.flipBtn.classList.add("hidden");
    }
    return;
  }

  // ── spell mode ──
  el.flipArea.classList.add("hidden");
  el.spellArea.classList.remove("hidden");
  el.spellKicker.textContent = kicker;
  el.spellPrompt.textContent = prompt;

  if (state.spellResult === null) {
    el.spellInput.value    = "";
    el.spellInput.className = "";
    el.spellInput.disabled  = false;
    el.spellResult.classList.add("hidden");
    el.checkBtn.classList.remove("hidden");
    el.nextBtn.classList.add("hidden");
  } else {
    el.spellInput.className = state.spellResult === "correct" ? "is-correct" : "is-wrong";
    el.spellInput.disabled  = true;
    el.spellResult.className = "spell-result " + (state.spellResult === "correct" ? "is-correct" : "is-wrong");
    if (state.spellResult === "correct") {
      el.spellResult.innerHTML =
        `<span class="result-icon">✓</span>` +
        `<span class="result-answer">${esc(answer)}</span>` +
        (example ? `<div class="result-example">${esc(example)}</div>` : "");
    } else {
      el.spellResult.innerHTML =
        `<span class="result-icon">✗</span>` +
        `<span class="result-answer">${esc(answer)}</span>` +
        `<div class="result-yours">Votre réponse : ${esc(state.spellUserInput)}</div>` +
        (example ? `<div class="result-example">${esc(example)}</div>` : "");
    }
    el.spellResult.classList.remove("hidden");
    el.checkBtn.classList.add("hidden");
    el.nextBtn.classList.remove("hidden");
  }
}

function showCompletion() {
  el.flipArea.classList.add("hidden");
  el.spellArea.classList.add("hidden");
  el.completionScreen.classList.remove("hidden");
  const again = state.sessionStats.again;
  el.statTotal.textContent = state.sessionTotal;
  el.statAgain.textContent = again;
  // Grey out "0 次重练"
  el.completionScreen.querySelector(".stat-again").classList.toggle("no-again", again === 0);
  renderProgress();
}

function renderSets() {
  el.activeSetSelect.innerHTML = "";
  if (!state.sets.length) {
    el.activeSetSelect.innerHTML = '<option value="">Aucune liste — importez d\'abord</option>';
  } else {
    for (const s of state.sets) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.cards.length})`;
      opt.selected = s.id === state.activeSetId;
      el.activeSetSelect.append(opt);
    }
  }

  el.setsList.innerHTML = "";
  if (!state.sets.length) {
    el.setsList.innerHTML = '<div class="preview-item"><span class="item-title">Aucune liste</span><span class="item-meta">Allez dans « Importer » pour ajouter du contenu.</span></div>';
    return;
  }
  for (const s of state.sets) {
    const div = document.createElement("div");
    div.className = "set-item";
    div.innerHTML = `
      <div class="set-item-info">
        <div class="item-title">${esc(s.name)}</div>
        <div class="item-meta">${s.cards.length} cartes · ${new Date(s.updatedAt).toLocaleString()}</div>
      </div>
      <button class="set-delete" type="button" data-delete-set="${s.id}">Supprimer</button>`;
    el.setsList.append(div);
  }
}

function renderPreview(cards) {
  el.previewList.innerHTML = "";
  if (!cards.length) {
    el.previewList.innerHTML = '<div class="preview-item"><span class="item-title">Aucune carte reconnue</span><span class="item-meta">Format : français | traduction</span></div>';
    return;
  }
  for (const c of cards.slice(0, 10)) {
    const div = document.createElement("div");
    div.className = "preview-item";
    div.innerHTML = `
      <span class="item-title">${esc(c.french)} · ${esc(c.chinese)}</span>
      <span class="item-meta">${esc([c.exampleFr, c.exampleZh].filter(Boolean).join(" / "))}</span>`;
    el.previewList.append(div);
  }
}

// ── Data actions ──────────────────────────────────────────────────────────────
async function refresh() {
  state.sets = await getAllSets();
  if (!state.activeSetId || !state.sets.some(s => s.id === state.activeSetId)) {
    state.activeSetId = state.sets[0]?.id || null;
  }
  renderSets();
  saveSettings();
}

async function saveImportedSet() {
  const cards = parseCards(el.importText.value);
  if (!cards.length) { toast("Aucune carte reconnue — vérifiez le format"); return; }
  const now = Date.now();
  const set = {
    id: crypto.randomUUID(),
    name: el.setNameInput.value.trim() || "Sans titre",
    cards, createdAt: now, updatedAt: now,
  };
  await putSet(set);
  state.activeSetId = set.id;
  await refresh();
  startSession();
  switchView("reviewView");
  toast(`${cards.length} cartes enregistrées`);
}

async function exportData() {
  const blob = new Blob(
    [JSON.stringify({ app:"French Cards", exportedAt:new Date().toISOString(), sets:state.sets }, null, 2)],
    { type:"application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `french-cards-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const payload = JSON.parse(await file.text());
  const sets = Array.isArray(payload.sets) ? payload.sets : [];
  for (const s of sets) await putSet({ ...s, id: s.id || crypto.randomUUID() });
  await refresh();
  toast(`${sets.length} liste(s) importée(s)`);
}

// ── Spell check ───────────────────────────────────────────────────────────────
async function checkSpell() {
  const card = state.sessionDeck[0];
  if (!card) return;
  const input = el.spellInput.value.trim();
  if (!input) { toast("Veuillez saisir une réponse"); return; }
  const { answer } = getCardContent(card);
  state.spellUserInput = input;
  // Strict: case-insensitive, accent-sensitive
  state.spellResult = input.toLowerCase() === answer.toLowerCase() ? "correct" : "wrong";
  renderCard();
}

// ── Event listeners ───────────────────────────────────────────────────────────

// Tabs
el.tabs.forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

// Review mode
$$("[data-review-mode]").forEach(btn => btn.addEventListener("click", () => {
  state.reviewMode = btn.dataset.reviewMode;
  $$("[data-review-mode]").forEach(b => b.classList.toggle("is-active", b === btn));
  state.isBack = false; state.spellResult = null;
  saveSettings(); renderCard();
}));

// Direction
$$("[data-dir]").forEach(btn => btn.addEventListener("click", () => {
  state.direction = btn.dataset.dir;
  $$("[data-dir]").forEach(b => b.classList.toggle("is-active", b === btn));
  state.isBack = false; state.spellResult = null;
  saveSettings(); renderCard();
}));

// Set select
el.activeSetSelect.addEventListener("change", () => {
  state.activeSetId = el.activeSetSelect.value;
  saveSettings();
  startSession();
});

// Flip mode
el.cardButton.addEventListener("click", () => {
  if (!state.isBack && state.sessionDeck[0]) { state.isBack = true; renderCard(); }
});
el.flipBtn.addEventListener("click", () => {
  if (!state.isBack && state.sessionDeck[0]) { state.isBack = true; renderCard(); }
});
el.againBtn.addEventListener("click", async () => { await markCard("again"); advanceCard("again"); });
el.knowBtn.addEventListener("click",  async () => { await markCard("known"); advanceCard("known"); });

// Spell mode
el.spellInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && state.spellResult === null) checkSpell();
});
$$(".accent-btn").forEach(btn => btn.addEventListener("click", () => {
  const inp = el.spellInput;
  const pos = inp.selectionStart;
  inp.value = inp.value.slice(0, pos) + btn.dataset.char + inp.value.slice(pos);
  inp.selectionStart = inp.selectionEnd = pos + 1;
  inp.focus();
}));
el.checkBtn.addEventListener("click", checkSpell);
el.nextBtn.addEventListener("click",  async () => {
  const kind = state.spellResult === "correct" ? "known" : "again";
  await markCard(kind);
  advanceCard(kind);
});

// Completion
el.restartBtn.addEventListener("click", startSession);

// Import
el.previewBtn.addEventListener("click", () => renderPreview(parseCards(el.importText.value)));
el.saveSetBtn.addEventListener("click", saveImportedSet);
el.newSampleBtn.addEventListener("click", async () => {
  el.setNameInput.value = "Exemple";
  el.importText.value =
`attendre | 等待 | J'attends le bus. | 我在等公交。
descendre | 下去；下车 | Je descends à la prochaine station. | 我下一站下车。
retard | 迟到；延误 | Le train a du retard. | 火车晚点了。
billet | 票 | J'ai acheté un billet. | 我买了一张票。`;
  await saveImportedSet();
});

// Sets list
el.setsList.addEventListener("click", async e => {
  const btn = e.target.closest("[data-delete-set]");
  if (!btn) return;
  const id = btn.dataset.deleteSet;
  await deleteSet(id);
  if (state.activeSetId === id) state.activeSetId = null;
  await refresh();
  startSession();
  toast("Liste supprimée");
});

// Backup
el.exportBtn.addEventListener("click", exportData);
el.importFile.addEventListener("change", e => {
  const [file] = e.target.files;
  if (file) importData(file).catch(() => toast("Échec de l'importation — vérifiez le fichier"));
});

// ── Service Worker ────────────────────────────────────────────────────────────
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
    el.storageStatus.textContent = "Hors ligne ✓";
    el.storageStatus.classList.add("is-online");
  } catch { /* silently fail */ }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const s = loadSettings();
  state.activeSetId = s.activeSetId || null;
  state.reviewMode  = s.reviewMode  || "flip";
  state.direction   = s.direction   || "zh-fr";

  $$("[data-review-mode]").forEach(b => b.classList.toggle("is-active", b.dataset.reviewMode === state.reviewMode));
  $$("[data-dir]").forEach(b => b.classList.toggle("is-active", b.dataset.dir === state.direction));

  await refresh();
  startSession();
  await registerSW();
}

init().catch(err => { console.error(err); toast("Erreur d'initialisation — actualisez la page"); });
