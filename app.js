// app.js — Prelims Studio (Dedicated Quiz Arena & Post-Answer Metadata Engine)

const FALLBACK_SYLLABUS_SKELETON = {
  P: { name: "Indian Polity & Constitution", file: "P_polity.json", modules: {} },
  E: { name: "Macroeconomics & Indian Economy", file: "E_economy.json", modules: {} },
  G: { name: "Geography (Physical, World & Indian)", file: "G_geography.json", modules: {} },
  V: { name: "Environment & Ecology", file: "V_environment.json", modules: {} },
  M: { name: "Modern Indian History", file: "M_modern_history.json", modules: {} },
  A: { name: "Ancient, Medieval & Art/Culture", file: "A_ancient_medieval.json", modules: {} },
  S: { name: "Science & Technology", file: "S_science_tech.json", modules: {} }
};

const DEFAULT_TRAPS = {
  T1: "Authority / Institution Swap",
  T2: "Constitutional vs Statutory Origin",
  T3: "Extreme / Absolute Word Trap",
  T4: "Cause-and-Effect Inversion",
  T5: "Condition / Exception Reversal",
  T6: "Chronology / Anachronism Trap",
  T7: "Scope / Applicability Confusion"
};

const STORAGE_KEY_PROFILES = "cse_terminal_profiles_v1";
const STORAGE_KEY_ACTIVE_PROFILE = "cse_terminal_active_profile_v1";
const STORAGE_KEY_THEME = "cse_terminal_theme_v1";

const state = {
  taxonomy: null,
  allQuestions: [],
  questionById: new Map(),
  topicMetaById: new Map(),

  profiles: {},
  activeProfileId: "Daemon",

  config: {
    mode: "practice",
    confidenceEnabled: true,
    order: "shuffle",
    poolPreset: "all",
    hideEmptyTopics: true,
    selectedTopics: new Set(),
    difficulties: new Set(["1", "2", "3"]),
    formats: new Set(["F1", "F2", "F3", "F4", "F5", "F6"]),
    limit: 15
  },

  session: {
    active: false,
    finished: false,
    mode: "practice",
    confidenceEnabled: true,
    questions: [],
    currentIndex: 0,
    responses: {},
    timerSeconds: 0,
    timerHandle: null
  },

  ledgerFilter: "all"
};

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initProfiles();
  bindEvents();
  await loadDataset();
  renderSyllabusTree();
  updateConfigPoolCounts();
  renderLedgerView();
  renderTelemetryView();
});

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY_THEME) || "paper";
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY_THEME, theme);
  document.querySelectorAll("[data-theme-target]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeTarget === theme);
  });
}

function initProfiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
    if (raw) state.profiles = JSON.parse(raw);
  } catch (e) {
    state.profiles = {};
  }
  if (!Object.keys(state.profiles).length) {
    state.profiles = {
      Daemon: { created: new Date().toISOString(), records: {} },
      Guest: { created: new Date().toISOString(), records: {} }
    };
    saveProfiles();
  }
  const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE_PROFILE);
  state.activeProfileId = (savedActive && state.profiles[savedActive]) ? savedActive : Object.keys(state.profiles)[0];
  renderProfileDropdown();
}

function saveProfiles() {
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(state.profiles));
  localStorage.setItem(STORAGE_KEY_ACTIVE_PROFILE, state.activeProfileId);
}

function getRecords() {
  if (!state.profiles[state.activeProfileId]) {
    state.profiles[state.activeProfileId] = { created: new Date().toISOString(), records: {} };
  }
  return state.profiles[state.activeProfileId].records;
}

function renderProfileDropdown() {
  const sel = document.getElementById("profile-select");
  sel.innerHTML = "";
  Object.keys(state.profiles).forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === state.activeProfileId) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function loadDataset() {
  const merged = JSON.parse(JSON.stringify(FALLBACK_SYLLABUS_SKELETON));
  let loadedTax = null;

  try {
    const res = await fetch("app_data/taxonomy_index.json?t=" + Date.now());
    if (res.ok) loadedTax = await res.json();
  } catch (e) {}

  if (loadedTax && loadedTax.subjects) {
    for (const [sCode, sObj] of Object.entries(loadedTax.subjects)) {
      merged[sCode] = sObj;
    }
  }

  state.taxonomy = {
    traps: (loadedTax && loadedTax.traps) || DEFAULT_TRAPS,
    subjects: merged
  };

  state.allQuestions = [];
  state.questionById.clear();
  state.topicMetaById.clear();

  for (const [sCode, sData] of Object.entries(state.taxonomy.subjects)) {
    for (const [mNum, mData] of Object.entries(sData.modules || {})) {
      for (const [tNum, tData] of Object.entries(mData.topics || {})) {
        state.topicMetaById.set(tData.id, {
          id: tData.id,
          name: tData.name,
          subjectCode: sCode,
          subjectName: sData.name,
          moduleName: mData.name,
          count: tData.count || 0
        });
        if (tData.count > 0) state.config.selectedTopics.add(tData.id);
      }
    }

    if (sData.file && (sData.count > 0 || sCode === "P")) {
      try {
        const qRes = await fetch(`app_data/${sData.file}?t=${Date.now()}`);
        if (qRes.ok) {
          const qs = await qRes.json();
          qs.forEach((q) => {
            q.d = String(q.d);
            q.topicId = q.id.split("-").slice(0, 3).join("-");
            state.allQuestions.push(q);
            state.questionById.set(q.id, q);
          });
        }
      } catch (e) {}
    }
  }

  document.getElementById("header-dataset-stat").textContent = `${state.allQuestions.length} ready`;
}

// =====================================================================
// CLEAN SYLLABUS LIST RENDERER
// =====================================================================
function renderSyllabusTree() {
  const container = document.getElementById("syllabus-tree");
  container.innerHTML = "";
  const records = getRecords();
  let hiddenSubjectsCount = 0;

  for (const [sCode, sData] of Object.entries(state.taxonomy.subjects)) {
    const allTopics = [];
    Object.values(sData.modules || {}).forEach((m) => {
      Object.values(m.topics || {}).forEach((t) => {
        allTopics.push({ ...t, moduleName: m.name });
      });
    });

    const visibleTopics = state.config.hideEmptyTopics
      ? allTopics.filter((t) => (t.count || 0) > 0)
      : allTopics;

    if (state.config.hideEmptyTopics && visibleTopics.length === 0) {
      hiddenSubjectsCount++;
      continue;
    }

    const subjTotalQs = allTopics.reduce((acc, t) => acc + (t.count || 0), 0);
    const card = document.createElement("div");
    card.className = `subj-row-card ${subjTotalQs > 0 ? "open" : ""}`;

    const header = document.createElement("div");
    header.className = "subj-row-header";
    header.innerHTML = `
      <span class="subj-row-title">${sData.name}</span>
      <span class="subtle-pill">${subjTotalQs > 0 ? `${subjTotalQs} questions` : "Pending generation"}</span>
    `;
    header.addEventListener("click", () => card.classList.toggle("open"));

    const body = document.createElement("div");
    body.className = "subj-topics-body";

    visibleTopics.forEach((t) => {
      const count = t.count || 0;
      const checked = state.config.selectedTopics.has(t.id) && count > 0;
      let done = 0;
      state.allQuestions.forEach((q) => {
        if (q.topicId === t.id && records[q.id]?.attempts > 0) done++;
      });

      const label = document.createElement("label");
      label.className = `topic-line ${count === 0 ? "empty-topic" : ""}`;
      label.innerHTML = `
        <div class="topic-line-left">
          <input type="checkbox" data-topic-id="${t.id}" ${checked ? "checked" : ""} ${count === 0 ? "disabled" : ""} />
          <span class="topic-code">${t.id}</span>
          <span>${t.name}</span>
        </div>
        <span class="subtle-pill">${count > 0 ? `${done}/${count} done` : "0 Qs"}</span>
      `;

      label.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) state.config.selectedTopics.add(t.id);
        else state.config.selectedTopics.delete(t.id);
        updateConfigPoolCounts();
      });

      body.appendChild(label);
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }

  if (hiddenSubjectsCount > 0) {
    const note = document.createElement("div");
    note.className = "hidden-subjects-note";
    note.textContent = `${hiddenSubjectsCount} subjects with 0 generated questions are hidden. Uncheck "Show only topics with questions ready" above to view the full syllabus.`;
    container.appendChild(note);
  }
}

function getBaseFilteredQuestions() {
  return state.allQuestions.filter((q) => {
    if (!state.config.selectedTopics.has(q.topicId)) return false;
    if (!state.config.difficulties.has(String(q.d))) return false;
    if (!state.config.formats.has(q.f)) return false;
    return true;
  });
}

function filterByPoolPreset(questions, preset) {
  const records = getRecords();
  const todayStr = new Date().toISOString().slice(0, 10);

  return questions.filter((q) => {
    const rec = records[q.id];
    switch (preset) {
      case "unseen": return !rec || !rec.attempts;
      case "blindspots": return Boolean(rec && rec.isBlindspot);
      case "lucky": return Boolean(rec && rec.isLucky);
      case "wrong": return Boolean(rec && rec.lastCorrect === false);
      case "due": return Boolean(rec && rec.dueDate && rec.dueDate <= todayStr);
      case "noted": return Boolean(rec && (rec.bookmarked || (rec.note && rec.note.trim())));
      default: return true;
    }
  });
}

function updateConfigPoolCounts() {
  const base = getBaseFilteredQuestions();
  const labels = {
    all: "All Available Questions",
    unseen: "Unseen Only",
    blindspots: "Critical Blindspots: Sure → Wrong",
    lucky: "Shaky Mastery: 50:50 & Guesses",
    wrong: "All Previously Wrong",
    due: "Spaced Repetition Due Today",
    noted: "Bookmarked & Personal Notes"
  };

  Object.entries(labels).forEach(([key, text]) => {
    const opt = document.getElementById(`opt-pool-${key}`);
    if (opt) opt.textContent = `${text} (${filterByPoolPreset(base, key).length})`;
  });

  const activePool = filterByPoolPreset(base, state.config.poolPreset);
  const targetCount = Math.min(activePool.length, state.config.limit);
  document.getElementById("matching-pool-readout").textContent = `${activePool.length} questions match`;

  const startBtn = document.getElementById("btn-start-session");
  startBtn.disabled = activePool.length === 0;
  startBtn.textContent = activePool.length > 0 ? `Start Quiz (${targetCount} Qs) →` : "No Questions Match";

  const records = getRecords();
  let alerts = 0;
  Object.values(records).forEach((r) => {
    if (r.isBlindspot || r.isLucky || r.note) alerts++;
  });
  document.getElementById("ledger-alert-count").textContent = alerts;
}

// =====================================================================
// DEDICATED QUIZ ARENA ENGINE
// =====================================================================
function enterQuizArena() {
  document.getElementById("lobby-nav").classList.add("hidden");
  document.getElementById("profile-bar-controls").classList.add("hidden");
  document.getElementById("btn-exit-quiz").classList.remove("hidden");

  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === "view-quiz");
  });
}

function exitQuizArenaToSetup() {
  if (state.session.active && !state.session.finished) {
    if (!confirm("Exit current quiz and return to Setup?")) return;
  }
  if (state.session.timerHandle) clearInterval(state.session.timerHandle);
  state.session.active = false;

  document.getElementById("btn-exit-quiz").classList.add("hidden");
  document.getElementById("lobby-nav").classList.remove("hidden");
  document.getElementById("profile-bar-controls").classList.remove("hidden");

  renderSyllabusTree();
  updateConfigPoolCounts();
  switchLobbyTab("config");
}

function startSession() {
  const pool = filterByPoolPreset(getBaseFilteredQuestions(), state.config.poolPreset);
  if (!pool.length) return;

  const workingPool = [...pool];
  if (state.config.order === "shuffle") {
    for (let i = workingPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [workingPool[i], workingPool[j]] = [workingPool[j], workingPool[i]];
    }
  }

  const selected = workingPool.slice(0, state.config.limit);
  state.session = {
    active: true,
    finished: false,
    mode: state.config.mode,
    confidenceEnabled: state.config.confidenceEnabled,
    questions: selected,
    currentIndex: 0,
    responses: {},
    timerSeconds: state.config.mode === "exam" ? selected.length * 72 : 0,
    timerHandle: null
  };

  selected.forEach((q) => {
    state.session.responses[q.id] = {
      selectedOpt: null,
      locked: false,
      confidence: null,
      isCorrect: null,
      reviewFlagged: false,
      eliminatedStmts: new Set()
    };
  });

  document.getElementById("post-quiz-summary-banner").classList.add("hidden");
  document.getElementById("btn-finish-session").classList.remove("hidden");

  if (state.session.timerHandle) clearInterval(state.session.timerHandle);
  const updateTimerText = () => {
    const m = String(Math.floor(state.session.timerSeconds / 60)).padStart(2, "0");
    const s = String(state.session.timerSeconds % 60).padStart(2, "0");
    document.getElementById("session-timer").textContent = `${m}:${s}`;
  };
  updateTimerText();

  state.session.timerHandle = setInterval(() => {
    if (state.session.finished) return;
    if (state.session.mode === "exam") {
      state.session.timerSeconds = Math.max(0, state.session.timerSeconds - 1);
      if (state.session.timerSeconds === 0) finishSession();
    } else {
      state.session.timerSeconds++;
    }
    updateTimerText();
  }, 1000);

  enterQuizArena();
  renderActiveQuestion();
  renderSidebar();
}

function renderActiveQuestion() {
  if (!state.session.active) return;
  const q = state.session.questions[state.session.currentIndex];
  const resp = state.session.responses[q.id];
  const rec = getRecords()[q.id] || {};

  // Clean Header: Plain text counter on left, real buttons on right
  document.getElementById("q-index-display").textContent =
    `Question ${state.session.currentIndex + 1} of ${state.session.questions.length}`;

  const bmBtn = document.getElementById("btn-bookmark-q");
  bmBtn.textContent = rec.bookmarked ? "★ Bookmarked" : "☆ Bookmark";
  bmBtn.classList.toggle("active", Boolean(rec.bookmarked));

  const revBtn = document.getElementById("btn-flag-review-q");
  revBtn.textContent = resp.reviewFlagged ? "⚑ Flagged for Review" : "⚑ Flag for Review";
  revBtn.classList.toggle("active", Boolean(resp.reviewFlagged));

  document.getElementById("q-stem-text").textContent = q.stem;
  document.getElementById("q-prompt-text").textContent = q.prompt || "";

  // Statements with "Cross out" helper
  const itemsEl = document.getElementById("q-items-list");
  itemsEl.innerHTML = "";
  (q.items || []).forEach((stmt, idx) => {
    const num = idx + 1;
    const isElim = resp.eliminatedStmts.has(num);
    const div = document.createElement("div");
    div.className = `stmt-item ${isElim ? "eliminated" : ""}`;
    div.innerHTML = `
      <span class="stmt-text">${stmt}</span>
      <button type="button" class="btn-cross">${isElim ? "Restore" : "Cross out"}</button>
    `;
    div.querySelector(".btn-cross").addEventListener("click", () => {
      if (isElim) resp.eliminatedStmts.delete(num);
      else resp.eliminatedStmts.add(num);
      renderActiveQuestion();
    });
    itemsEl.appendChild(div);
  });

  // Options A, B, C, D
  const optsEl = document.getElementById("q-options-container");
  optsEl.innerHTML = "";
  const reveal = (state.session.mode === "practice" && resp.locked) || state.session.finished;

  ["A", "B", "C", "D"].forEach((key) => {
    const text = q.opts[key];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-row";
    if (resp.selectedOpt === key) btn.classList.add("selected");

    if (q.f === "F1" && resp.eliminatedStmts.size > 0) {
      for (const n of resp.eliminatedStmts) {
        if (new RegExp(`\\b${n}\\b`).test(text)) btn.classList.add("dimmed");
      }
    }

    if (reveal) {
      if (key === q.ans) btn.classList.add("correct");
      else if (resp.selectedOpt === key) btn.classList.add("wrong");
    }

    btn.disabled = (state.session.mode === "practice" && resp.locked) || state.session.finished;
    btn.innerHTML = `<span class="opt-letter">${key}</span><span>${text}</span>`;
    btn.addEventListener("click", () => {
      resp.selectedOpt = key;
      renderActiveQuestion();
    });
    optsEl.appendChild(btn);
  });

  const canLock = Boolean(resp.selectedOpt) && !state.session.finished && !(state.session.mode === "practice" && resp.locked);
  const confPanel = document.getElementById("confidence-panel");
  const directPanel = document.getElementById("direct-lock-panel");

  if (state.session.confidenceEnabled) {
    confPanel.classList.remove("hidden");
    directPanel.classList.add("hidden");
    ["btn-conf-certain", "btn-conf-5050", "btn-conf-guess"].forEach((id) => {
      document.getElementById(id).disabled = !canLock;
    });
  } else {
    confPanel.classList.add("hidden");
    directPanel.classList.remove("hidden");
    document.getElementById("btn-commit-direct").disabled = !canLock;
  }

  document.getElementById("btn-prev-q").disabled = state.session.currentIndex === 0;
  document.getElementById("btn-next-q").disabled = state.session.currentIndex === state.session.questions.length - 1;

  const expDrawer = document.getElementById("explanation-drawer");
  if (reveal) {
    expDrawer.classList.remove("hidden");
    renderExplanation(q, resp, rec);
  } else {
    expDrawer.classList.add("hidden");
  }
}

function lockCurrentAnswer(confidence) {
  const q = state.session.questions[state.session.currentIndex];
  const resp = state.session.responses[q.id];
  if (!resp.selectedOpt) return;

  resp.locked = true;
  resp.confidence = confidence;
  resp.isCorrect = resp.selectedOpt === q.ans;

  if (state.session.mode === "practice") saveQuestionAttempt(q, resp);

  renderActiveQuestion();
  renderSidebar();

  if (state.session.mode === "exam" && state.session.currentIndex < state.session.questions.length - 1) {
    state.session.currentIndex++;
    renderActiveQuestion();
    renderSidebar();
  }
}

function saveQuestionAttempt(q, resp) {
  const records = getRecords();
  const r = records[q.id] || {
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    trapsHit: [],
    note: "",
    bookmarked: false
  };

  r.attempts++;
  r.lastAns = resp.selectedOpt;
  r.lastCorrect = resp.isCorrect;
  r.lastConfidence = resp.confidence;

  if (resp.isCorrect) r.correctCount++;
  else {
    r.wrongCount++;
    (q.exp || []).forEach((e) => {
      if (!e.ok && e.t && !r.trapsHit.includes(e.t)) r.trapsHit.push(e.t);
    });
  }

  r.isBlindspot = (resp.confidence === "certain" && !resp.isCorrect);
  r.isLucky = (resp.confidence === "5050" || resp.confidence === "guess");

  const next = new Date();
  const days = (!resp.isCorrect || r.isBlindspot) ? 1 : r.isLucky ? 2 : 7;
  next.setDate(next.getDate() + days);
  r.dueDate = next.toISOString().slice(0, 10);

  records[q.id] = r;
  saveProfiles();
  updateConfigPoolCounts();
}

function finishSession() {
  if (!state.session.active || state.session.finished) return;
  state.session.finished = true;
  if (state.session.timerHandle) clearInterval(state.session.timerHandle);

  if (state.session.mode === "exam") {
    state.session.questions.forEach((q) => {
      const resp = state.session.responses[q.id];
      if (resp && resp.locked) saveQuestionAttempt(q, resp);
    });
  }

  // Compute Post-Quiz Summary Banner Metrics
  let r = 0, w = 0, s = 0, bs = 0;
  state.session.questions.forEach((q) => {
    const resp = state.session.responses[q.id];
    if (!resp || !resp.locked) s++;
    else if (resp.isCorrect) r++;
    else {
      w++;
      if (resp.confidence === "certain") bs++;
    }
  });
  const net = (r * 2) - (w * (2 / 3));
  const maxMarks = state.session.questions.length * 2;

  document.getElementById("sum-net-score").textContent = `${net >= 0 ? "+" : ""}${net.toFixed(2)} / ${maxMarks}`;
  document.getElementById("sum-correct").textContent = r;
  document.getElementById("sum-wrong").textContent = w;
  document.getElementById("sum-skipped").textContent = s;
  document.getElementById("sum-blindspots").textContent = bs;

  document.getElementById("post-quiz-summary-banner").classList.remove("hidden");
  document.getElementById("btn-finish-session").classList.add("hidden");

  renderActiveQuestion();
  renderSidebar();
  renderLedgerView();
  renderTelemetryView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderExplanation(q, resp, rec) {
  const banner = document.getElementById("verdict-banner");
  const statusTag = document.getElementById("verdict-status-tag");
  const diag = document.getElementById("verdict-diagnostic-text");

  banner.className = "exp-banner";
  if (!resp.locked) {
    statusTag.textContent = "Skipped (0.00)";
    diag.textContent = "";
  } else if (resp.isCorrect) {
    banner.classList.add("ok");
    statusTag.textContent = `Correct (+2.00) · You chose ${resp.selectedOpt}`;
    diag.textContent = (resp.confidence === "5050" || resp.confidence === "guess")
      ? `Saved to Notebook under 50:50 / Guess so you can consolidate the concept.`
      : "";
  } else {
    banner.classList.add("err");
    statusTag.textContent = `Incorrect (-0.67) · You chose ${resp.selectedOpt}`;
    diag.textContent = resp.confidence === "certain"
      ? "Blindspot Alert: Marked Sure (100%) but got tricked!"
      : "";
  }

  document.getElementById("verdict-correct-key").textContent = `Official Key: ${q.ans}`;

  // Reveal Toughness, Topic & Question Code HERE inside the Explanation Card!
  const diffNames = { "1": "Easy", "2": "Medium", "3": "Hard" };
  const meta = state.topicMetaById.get(q.topicId);
  document.getElementById("exp-diff-badge").textContent = `Difficulty: ${diffNames[q.d] || "Medium"}`;
  document.getElementById("exp-topic-badge").textContent = meta ? meta.name : q.topicId;
  document.getElementById("exp-serial-badge").textContent = q.id;

  document.getElementById("exp-core-text").textContent = q.core;

  const list = document.getElementById("exp-statements-list");
  list.innerHTML = "";
  (q.exp || []).forEach((item) => {
    const div = document.createElement("div");
    div.className = "exp-item";
    const label = item.s === 0 ? "Option Analysis" : `Statement ${item.s}`;
    const trapName = item.t ? (state.taxonomy.traps[item.t] || item.t) : "";

    div.innerHTML = `
      <div class="exp-item-head">
        <span class="${item.ok ? "tag-ok" : "tag-err"}">${label}: ${item.ok ? "Correct" : "Incorrect"}</span>
        ${!item.ok && trapName ? `<span class="tag-trap">Trap: ${trapName}</span>` : ""}
      </div>
      <div>${item.why}</div>
    `;
    list.appendChild(div);
  });

  document.getElementById("exp-ref-text").textContent = q.ref || "";
  const hooks = document.getElementById("exp-hooks-row");
  hooks.innerHTML = "";
  (q.hooks || []).forEach((h) => {
    const s = document.createElement("span");
    s.className = "subtle-pill";
    s.textContent = `#${h}`;
    hooks.appendChild(s);
  });

  document.getElementById("q-personal-note").value = rec.note || "";
  document.getElementById("note-save-status").textContent = "";
}

function renderSidebar() {
  document.getElementById("sidebar-mode-label").textContent =
    state.session.finished ? "Review Mode" : state.session.mode === "exam" ? "Exam Clock" : "Practice";

  const statsBox = document.getElementById("live-telemetry-box");
  if (state.session.mode === "exam" && !state.session.finished) {
    statsBox.classList.add("hidden");
  } else {
    statsBox.classList.remove("hidden");
    let r = 0, w = 0, bs = 0;
    state.session.questions.forEach((q) => {
      const resp = state.session.responses[q.id];
      if (resp && resp.locked) {
        if (resp.isCorrect) r++;
        else {
          w++;
          if (resp.confidence === "certain") bs++;
        }
      }
    });
    const net = (r * 2) - (w * (2 / 3));
    document.getElementById("live-net-score").textContent = net.toFixed(2);
    document.getElementById("live-right-wrong").textContent = `${r} / ${w}`;
    document.getElementById("live-blindspots").textContent = bs;
  }

  const grid = document.getElementById("question-palette-grid");
  grid.innerHTML = "";
  state.session.questions.forEach((q, idx) => {
    const resp = state.session.responses[q.id];
    const btn = document.createElement("button");
    btn.className = "pal-btn";
    if (idx === state.session.currentIndex) btn.classList.add("current");
    if (resp.reviewFlagged) btn.classList.add("review");
    else if (resp.locked) btn.classList.add("answered");
    btn.textContent = idx + 1;
    btn.addEventListener("click", () => {
      state.session.currentIndex = idx;
      renderActiveQuestion();
      renderSidebar();
    });
    grid.appendChild(btn);
  });
}

// =====================================================================
// LOBBY TABS: NOTEBOOK & STATS
// =====================================================================
function renderLedgerView() {
  const container = document.getElementById("ledger-items-container");
  container.innerHTML = "";
  const records = getRecords();
  const todayStr = new Date().toISOString().slice(0, 10);

  const items = Object.entries(records)
    .map(([id, rec]) => ({ q: state.questionById.get(id), rec }))
    .filter((x) => Boolean(x.q))
    .filter(({ rec }) => {
      if (state.ledgerFilter === "blindspot") return Boolean(rec.isBlindspot);
      if (state.ledgerFilter === "lucky") return Boolean(rec.isLucky);
      if (state.ledgerFilter === "notes") return Boolean(rec.bookmarked || (rec.note && rec.note.trim()));
      if (state.ledgerFilter === "due") return Boolean(rec.dueDate && rec.dueDate <= todayStr);
      return rec.attempts > 0 || rec.bookmarked || (rec.note && rec.note.trim());
    });

  if (!items.length) {
    container.innerHTML = `<div class="empty-state"><p>No questions in this notebook filter yet.</p></div>`;
    return;
  }

  items.forEach(({ q, rec }) => {
    const div = document.createElement("div");
    div.className = "nb-card";
    let tag = "";
    if (rec.isBlindspot) tag = `<span class="tag-err"><strong>Blindspot (Sure → Wrong)</strong></span>`;
    else if (rec.isLucky) tag = `<span class="tag-trap">50:50 / Guess (${rec.lastCorrect ? "Right" : "Wrong"})</span>`;

    div.innerHTML = `
      <div class="nb-top">
        <div><span class="subtle-pill">${q.id}</span> ${tag} ${rec.bookmarked ? "★" : ""}</div>
        <span class="subtle-pill">Answer: ${q.ans}</span>
      </div>
      <div style="font-weight:500; margin-bottom:8px;">${q.stem}</div>
      <div style="font-size:13px; color:var(--text-sub); margin-bottom:6px;"><strong>Takeaway:</strong> ${q.core}</div>
      ${rec.note ? `<div style="font-size:12.5px; padding:6px 10px; background:var(--bg-card); border-radius:4px;"><strong>My Note:</strong> ${rec.note}</div>` : ""}
    `;
    container.appendChild(div);
  });
}

function renderTelemetryView() {
  const entries = Object.values(getRecords()).filter((r) => r.attempts > 0);
  let right = 0, wrong = 0, bs = 0;

  const tiers = {
    certain: { label: "Sure (100%)", att: 0, r: 0, w: 0 },
    "5050": { label: "50:50 Elimination", att: 0, r: 0, w: 0 },
    guess: { label: "Speculative Guess", att: 0, r: 0, w: 0 },
    direct: { label: "Direct (No Prompt)", att: 0, r: 0, w: 0 }
  };

  const trapCounts = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0, T6: 0, T7: 0 };

  entries.forEach((rec) => {
    const k = tiers[rec.lastConfidence] ? rec.lastConfidence : "direct";
    tiers[k].att++;
    if (rec.lastCorrect) {
      right++;
      tiers[k].r++;
    } else {
      wrong++;
      tiers[k].w++;
      if (rec.lastConfidence === "certain") bs++;
    }
    (rec.trapsHit || []).forEach((t) => {
      if (trapCounts[t] !== undefined) trapCounts[t]++;
    });
  });

  const net = (right * 2) - (wrong * (2 / 3));
  const acc = entries.length ? Math.round((right / entries.length) * 100) : 0;
  const bsRate = tiers.certain.att ? Math.round((bs / tiers.certain.att) * 100) : 0;

  document.getElementById("kpi-total-attempted").textContent = entries.length;
  document.getElementById("kpi-accuracy").textContent = `${acc}%`;
  document.getElementById("kpi-net-marks").textContent = (net >= 0 ? "+" : "") + net.toFixed(2);
  document.getElementById("kpi-blindspot-rate").textContent = `${bsRate}%`;

  const tbody = document.getElementById("confidence-matrix-tbody");
  tbody.innerHTML = "";
  Object.values(tiers).forEach((t) => {
    const tNet = (t.r * 2) - (t.w * (2 / 3));
    const verdict = t.att === 0 ? "—" : tNet >= 0 ? "Net Positive" : "Losing Marks";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${t.label}</strong></td>
      <td>${t.att}</td>
      <td class="text-success">${t.r}</td>
      <td class="text-danger">${t.w}</td>
      <td class="${tNet >= 0 ? "text-success" : "text-danger"}"><strong>${tNet >= 0 ? "+" : ""}${tNet.toFixed(2)}</strong></td>
      <td><span class="subtle-pill">${verdict}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const trapEl = document.getElementById("trap-vulnerability-list");
  trapEl.innerHTML = "";
  const maxT = Math.max(1, ...Object.values(trapCounts));
  Object.entries(state.taxonomy.traps).forEach(([code, name]) => {
    const c = trapCounts[code] || 0;
    const pct = Math.round((c / maxT) * 100);
    const div = document.createElement("div");
    div.innerHTML = `
      <div class="trap-item-top">
        <span>${name}</span>
        <span class="subtle-pill">${c}</span>
      </div>
      <div class="trap-bar"><div class="trap-fill" style="width:${c > 0 ? pct : 0}%"></div></div>
    `;
    trapEl.appendChild(div);
  });
}

// =====================================================================
// EVENT BINDINGS
// =====================================================================
function switchLobbyTab(view) {
  document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  if (view === "ledger") renderLedgerView();
  if (view === "telemetry") renderTelemetryView();
}

function bindEvents() {
  document.querySelectorAll(".nav-tab").forEach((b) => b.addEventListener("click", () => switchLobbyTab(b.dataset.view)));
  document.querySelectorAll("[data-theme-target]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeTarget)));

  document.getElementById("btn-exit-quiz").addEventListener("click", exitQuizArenaToSetup);
  document.getElementById("btn-summary-back-setup").addEventListener("click", exitQuizArenaToSetup);

  document.getElementById("profile-select").addEventListener("change", (e) => {
    state.activeProfileId = e.target.value;
    saveProfiles();
    renderSyllabusTree();
    updateConfigPoolCounts();
    renderLedgerView();
    renderTelemetryView();
  });

  document.getElementById("btn-new-profile").addEventListener("click", () => {
    const name = prompt("New Profile Name:");
    if (!name || !name.trim()) return;
    const clean = name.trim();
    if (!state.profiles[clean]) state.profiles[clean] = { created: new Date().toISOString(), records: {} };
    state.activeProfileId = clean;
    saveProfiles();
    renderProfileDropdown();
    renderSyllabusTree();
    updateConfigPoolCounts();
  });

  ["mode-btn-practice", "mode-btn-exam"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      state.config.mode = e.target.dataset.mode;
      document.getElementById("mode-btn-practice").classList.toggle("active", state.config.mode === "practice");
      document.getElementById("mode-btn-exam").classList.toggle("active", state.config.mode === "exam");
    });
  });

  document.getElementById("conf-toggle-on").addEventListener("click", () => {
    state.config.confidenceEnabled = true;
    document.getElementById("conf-toggle-on").classList.add("active");
    document.getElementById("conf-toggle-off").classList.remove("active");
  });
  document.getElementById("conf-toggle-off").addEventListener("click", () => {
    state.config.confidenceEnabled = false;
    document.getElementById("conf-toggle-off").classList.add("active");
    document.getElementById("conf-toggle-on").classList.remove("active");
  });

  ["order-btn-shuffle", "order-btn-sequential"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      state.config.order = e.target.dataset.order;
      document.getElementById("order-btn-shuffle").classList.toggle("active", state.config.order === "shuffle");
      document.getElementById("order-btn-sequential").classList.toggle("active", state.config.order === "sequential");
    });
  });

  document.getElementById("pool-preset-select").addEventListener("change", (e) => {
    state.config.poolPreset = e.target.value;
    updateConfigPoolCounts();
  });

  document.querySelectorAll("#filter-limit .seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.config.limit = parseInt(btn.dataset.limit, 10);
      document.querySelectorAll("#filter-limit .seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
      updateConfigPoolCounts();
    });
  });

  document.getElementById("btn-toggle-more-filters").addEventListener("click", () => {
    document.getElementById("advanced-filters-drawer").classList.toggle("hidden");
  });

  document.getElementById("chk-hide-empty").addEventListener("change", (e) => {
    state.config.hideEmptyTopics = e.target.checked;
    renderSyllabusTree();
  });

  document.querySelectorAll("#filter-difficulty .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const d = chip.dataset.diff;
      if (state.config.difficulties.has(d) && state.config.difficulties.size > 1) {
        state.config.difficulties.delete(d);
        chip.classList.remove("active");
      } else {
        state.config.difficulties.add(d);
        chip.classList.add("active");
      }
      updateConfigPoolCounts();
    });
  });

  document.querySelectorAll("#filter-format .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const f = chip.dataset.fmt;
      if (state.config.formats.has(f) && state.config.formats.size > 1) {
        state.config.formats.delete(f);
        chip.classList.remove("active");
      } else {
        state.config.formats.add(f);
        chip.classList.add("active");
      }
      updateConfigPoolCounts();
    });
  });

  document.getElementById("btn-select-all-topics").addEventListener("click", () => {
    for (const [id, m] of state.topicMetaById.entries()) {
      if (m.count > 0) state.config.selectedTopics.add(id);
    }
    renderSyllabusTree();
    updateConfigPoolCounts();
  });

  document.getElementById("btn-clear-all-topics").addEventListener("click", () => {
    state.config.selectedTopics.clear();
    renderSyllabusTree();
    updateConfigPoolCounts();
  });

  document.getElementById("btn-start-session").addEventListener("click", startSession);

  document.getElementById("btn-conf-certain").addEventListener("click", () => lockCurrentAnswer("certain"));
  document.getElementById("btn-conf-5050").addEventListener("click", () => lockCurrentAnswer("5050"));
  document.getElementById("btn-conf-guess").addEventListener("click", () => lockCurrentAnswer("guess"));
  document.getElementById("btn-commit-direct").addEventListener("click", () => lockCurrentAnswer("direct"));

  document.getElementById("btn-prev-q").addEventListener("click", () => {
    if (state.session.currentIndex > 0) {
      state.session.currentIndex--;
      renderActiveQuestion();
      renderSidebar();
    }
  });

  document.getElementById("btn-next-q").addEventListener("click", () => {
    if (state.session.currentIndex < state.session.questions.length - 1) {
      state.session.currentIndex++;
      renderActiveQuestion();
      renderSidebar();
    }
  });

  document.getElementById("btn-skip-q").addEventListener("click", () => {
    if (state.session.currentIndex < state.session.questions.length - 1) {
      state.session.currentIndex++;
      renderActiveQuestion();
      renderSidebar();
    }
  });

  document.getElementById("btn-bookmark-q").addEventListener("click", () => {
    if (!state.session.active) return;
    const q = state.session.questions[state.session.currentIndex];
    const records = getRecords();
    if (!records[q.id]) records[q.id] = { attempts: 0, correctCount: 0, wrongCount: 0, trapsHit: [] };
    records[q.id].bookmarked = !records[q.id].bookmarked;
    saveProfiles();
    renderActiveQuestion();
    updateConfigPoolCounts();
  });

  document.getElementById("btn-flag-review-q").addEventListener("click", () => {
    if (!state.session.active) return;
    const q = state.session.questions[state.session.currentIndex];
    state.session.responses[q.id].reviewFlagged = !state.session.responses[q.id].reviewFlagged;
    renderActiveQuestion();
    renderSidebar();
  });

  document.getElementById("btn-save-note").addEventListener("click", () => {
    if (!state.session.active) return;
    const q = state.session.questions[state.session.currentIndex];
    const records = getRecords();
    if (!records[q.id]) records[q.id] = { attempts: 0, correctCount: 0, wrongCount: 0, trapsHit: [] };
    records[q.id].note = document.getElementById("q-personal-note").value.trim();
    saveProfiles();
    document.getElementById("note-save-status").textContent = "✓ Saved";
    updateConfigPoolCounts();
  });

  document.getElementById("btn-finish-session").addEventListener("click", finishSession);

  document.querySelectorAll("#ledger-filter-bar .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.ledgerFilter = chip.dataset.ledger;
      document.querySelectorAll("#ledger-filter-bar .filter-chip").forEach((c) => c.classList.toggle("active", c === chip));
      renderLedgerView();
    });
  });

  document.getElementById("btn-export-profile").addEventListener("click", () => {
    const str = JSON.stringify({ profile: state.activeProfileId, data: state.profiles[state.activeProfileId] }, null, 2);
    const url = URL.createObjectURL(new Blob([str], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `PrelimsStudio_${state.activeProfileId}.json`;
    a.click();
  });

  document.getElementById("input-import-profile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (parsed.profile && parsed.data) {
          state.profiles[parsed.profile] = parsed.data;
          state.activeProfileId = parsed.profile;
          saveProfiles();
          renderProfileDropdown();
          renderSyllabusTree();
          updateConfigPoolCounts();
          renderLedgerView();
          renderTelemetryView();
        }
      } catch (err) {
        alert("Invalid backup file.");
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-reset-subject").addEventListener("click", () => {
    const code = document.getElementById("reset-subject-select").value;
    if (!confirm(`Reset history for subject '${code}'?`)) return;
    const records = getRecords();
    Object.keys(records).forEach((id) => {
      if (id.startsWith(code + "-")) delete records[id];
    });
    saveProfiles();
    renderSyllabusTree();
    updateConfigPoolCounts();
    renderLedgerView();
    renderTelemetryView();
  });

  document.getElementById("btn-reset-all-history").addEventListener("click", () => {
    if (!confirm(`Clear ALL history and notes for '${state.activeProfileId}'?`)) return;
    state.profiles[state.activeProfileId].records = {};
    saveProfiles();
    renderSyllabusTree();
    updateConfigPoolCounts();
    renderLedgerView();
    renderTelemetryView();
  });

  document.addEventListener("keydown", (e) => {
    if (!state.session.active || state.session.finished) return;
    if (["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)) return;
    if (!document.getElementById("view-quiz").classList.contains("active")) return;

    const key = e.key.toUpperCase();
    const q = state.session.questions[state.session.currentIndex];
    const resp = state.session.responses[q.id];
    const locked = state.session.mode === "practice" && resp.locked;

    if (!locked && ["A", "B", "C", "D"].includes(key)) {
      resp.selectedOpt = key;
      renderActiveQuestion();
    } else if (!locked && resp.selectedOpt && state.session.confidenceEnabled) {
      if (key === "1") lockCurrentAnswer("certain");
      if (key === "2") lockCurrentAnswer("5050");
      if (key === "3") lockCurrentAnswer("guess");
    } else if (!locked && resp.selectedOpt && !state.session.confidenceEnabled && e.key === "Enter") {
      lockCurrentAnswer("direct");
    }
  });
}