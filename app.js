(() => {
  "use strict";

  const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const STORAGE_KEY = "sudoku-annotator:v1";

  const boardEl = document.getElementById("sudoku-board");
  const modeLabelEl = document.getElementById("mode-label");
  const lockButtonEl = document.getElementById("lock-button");
  const clearBoardButtonEl = document.getElementById("clear-board-button");
  const undoButtonEl = document.getElementById("undo-button");
  const redoButtonEl = document.getElementById("redo-button");
  const clearCellButtonEl = document.getElementById("clear-cell-button");
  const timerElapsedEl = document.getElementById("timer-elapsed");
  const timerToggleButtonEl = document.getElementById("timer-toggle-button");
  const completionBannerEl = document.getElementById("completion-banner");
  const completionTimeEl = document.getElementById("completion-time");
  const confettiCanvasEl = document.getElementById("confetti-canvas");

  const PUG_ICON_SRC = "pug-sudoku-icon.png";
  let pugIconImage = /** @type {HTMLImageElement|null} */ (null);
  let wasPuzzleSolved = false;
  let confettiAnimationId = /** @type {number|null} */ (null);
  let confettiParticles = /** @type {Array<{x:number,y:number,vx:number,vy:number,size:number,rotation:number,vr:number,alpha:number,decay:number}>} */ ([]);

  const modeButtons = Array.from(document.querySelectorAll(".mode-button"));
  const padKeyEls = Array.from(document.querySelectorAll(".pad-key"));

  const dom = {
    cells: /** @type {Array<{el: HTMLElement, answerEl: HTMLElement, edgeEls: HTMLElement[], middleEl: HTMLElement}>} */ (
      []
    ),
  };

  const state = {
    ui: {
      mode: "setup", // 'setup' | 'answer' | 'edge' | 'middle'
      selectedIndex: /** @type {number|null} */ (null),
      activeDigit: /** @type {number|null} */ (null),
    },
    timer: {
      elapsedMs: 0,
      running: false,
      startedAtMs: /** @type {number|null} */ (null),
    },
    cells: /** @type {Array<{given: boolean, value: number|null, edgeNotes: number[], middleNotes: number[]}>} */ (
      []
    ),
    history: {
      past: /** @type {any[]} */ ([]),
      future: /** @type {any[]} */ ([]),
    },
  };

  function emptyCell() {
    return { given: false, value: null, edgeNotes: [], middleNotes: [] };
  }

  function cloneSnapshot() {
    return {
      ui: { ...state.ui },
      timer: { ...state.timer },
      cells: state.cells.map((c) => ({
        given: c.given,
        value: c.value,
        edgeNotes: [...c.edgeNotes],
        middleNotes: [...c.middleNotes],
      })),
    };
  }

  function restoreSnapshot(snap) {
    state.ui = { ...snap.ui };
    state.timer = { ...snap.timer };
    state.cells = snap.cells.map((c) => ({
      given: c.given,
      value: c.value,
      edgeNotes: [...c.edgeNotes],
      middleNotes: [...c.middleNotes],
    }));
  }

  let timerIntervalId = /** @type {number|null} */ (null);

  function nowMs() {
    return Date.now();
  }

  function getElapsedMs() {
    if (!state.timer.running || state.timer.startedAtMs == null) return state.timer.elapsedMs;
    return state.timer.elapsedMs + (nowMs() - state.timer.startedAtMs);
  }

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function renderTimer() {
    const ms = getElapsedMs();
    timerElapsedEl.textContent = formatElapsed(ms);
    const solved = isPuzzleSolved();
    timerToggleButtonEl.disabled = state.ui.mode === "setup" || solved;
    timerToggleButtonEl.textContent = state.timer.running ? "Pause" : "Resume";
  }

  function stopTimerInterval() {
    if (timerIntervalId != null) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function ensureTimerInterval() {
    stopTimerInterval();
    if (!state.timer.running) return;
    timerIntervalId = window.setInterval(() => {
      renderTimer();
    }, 250);
  }

  function startTimerIfNeeded() {
    if (state.timer.running) return;
    state.timer.running = true;
    state.timer.startedAtMs = nowMs();
    ensureTimerInterval();
    renderTimer();
    saveToStorage();
  }

  function pauseTimer() {
    if (!state.timer.running) return;
    state.timer.elapsedMs = getElapsedMs();
    state.timer.running = false;
    state.timer.startedAtMs = null;
    stopTimerInterval();
    renderTimer();
    saveToStorage();
  }

  function toggleTimer() {
    if (state.ui.mode === "setup") return;
    if (state.timer.running) pauseTimer();
    else startTimerIfNeeded();
  }

  function resetTimer() {
    state.timer.elapsedMs = 0;
    state.timer.running = false;
    state.timer.startedAtMs = null;
    stopTimerInterval();
    renderTimer();
  }

  function makePersistedSnapshot() {
    // Do not persist selection/highlight helpers.
    return {
      version: 1,
      ui: { mode: state.ui.mode },
      timer: {
        elapsedMs: getElapsedMs(),
        running: state.timer.running,
      },
      cells: state.cells.map((c) => ({
        given: c.given,
        value: c.value,
        edgeNotes: [...c.edgeNotes],
        middleNotes: [...c.middleNotes],
      })),
    };
  }

  function saveToStorage() {
    try {
      const snap = makePersistedSnapshot();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch {
      // Ignore storage failures (private mode, quota, etc).
    }
  }

  function clearStorage() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  function loadFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cells) || parsed.cells.length !== 81) return false;

      state.cells = parsed.cells.map((c) => ({
        given: Boolean(c.given),
        value: c.value == null ? null : Number(c.value),
        edgeNotes: Array.isArray(c.edgeNotes) ? c.edgeNotes.map(Number).filter((n) => n >= 1 && n <= 9) : [],
        middleNotes: Array.isArray(c.middleNotes) ? c.middleNotes.map(Number).filter((n) => n >= 1 && n <= 9) : [],
      }));

      const mode = parsed.ui?.mode;
      state.ui = { mode: mode === "setup" ? "setup" : mode === "answer" || mode === "edge" || mode === "middle" ? mode : "setup", selectedIndex: null, activeDigit: null };

      const timer = parsed.timer ?? null;
      const elapsedMs = typeof timer?.elapsedMs === "number" && Number.isFinite(timer.elapsedMs) ? Math.max(0, timer.elapsedMs) : 0;
      const running = Boolean(timer?.running) && state.ui.mode !== "setup";
      state.timer = { elapsedMs, running, startedAtMs: running ? nowMs() : null };

      // Ensure history starts clean after refresh.
      state.history.past = [];
      state.history.future = [];

      return true;
    } catch {
      return false;
    }
  }

  function indexToRowCol(i) {
    return { row: Math.floor(i / 9), col: i % 9 };
  }

  function boxIndex(row, col) {
    return Math.floor(row / 3) * 3 + Math.floor(col / 3);
  }

  function getSudokuUnits() {
    const units = [];
    for (let r = 0; r < 9; r++) {
      units.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
    }
    for (let c = 0; c < 9; c++) {
      units.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
    }
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const indices = [];
        for (let dr = 0; dr < 3; dr++) {
          for (let dc = 0; dc < 3; dc++) {
            const r = br * 3 + dr;
            const c = bc * 3 + dc;
            indices.push(r * 9 + c);
          }
        }
        units.push(indices);
      }
    }
    return units;
  }

  function getConflictIndices() {
    const conflict = new Set();
    const units = getSudokuUnits();

    // For each unit: duplicate answers become conflicts.
    for (const indices of units) {
      const map = new Map(); // digit -> indices[]
      for (const idx of indices) {
        const v = state.cells[idx].value;
        if (v == null) continue;
        const arr = map.get(v) ?? [];
        arr.push(idx);
        map.set(v, arr);
      }
      for (const [, idxs] of map.entries()) {
        if (idxs.length > 1) {
          for (const idx of idxs) conflict.add(idx);
        }
      }
    }

    return conflict;
  }

  function getAnswerDigitPresence() {
    /** @type {boolean[][]} */
    const rowHas = Array.from({ length: 9 }, () => Array(10).fill(false));
    /** @type {boolean[][]} */
    const colHas = Array.from({ length: 9 }, () => Array(10).fill(false));
    /** @type {boolean[][]} */
    const boxHas = Array.from({ length: 9 }, () => Array(10).fill(false));

    for (let i = 0; i < 81; i++) {
      const v = state.cells[i].value;
      if (v == null) continue;
      const { row, col } = indexToRowCol(i);
      const b = boxIndex(row, col);
      rowHas[row][v] = true;
      colHas[col][v] = true;
      boxHas[b][v] = true;
    }

    return { rowHas, colHas, boxHas };
  }

  function hasInvalidNotes() {
    const { rowHas, colHas, boxHas } = getAnswerDigitPresence();
    for (let i = 0; i < 81; i++) {
      const { row, col } = indexToRowCol(i);
      const b = boxIndex(row, col);
      const notes = [...state.cells[i].edgeNotes, ...state.cells[i].middleNotes];
      for (const d of notes) {
        if (rowHas[row][d] || colHas[col][d] || boxHas[b][d]) return true;
      }
    }
    return false;
  }

  function isPuzzleSolved() {
    if (state.ui.mode === "setup") return false;

    for (let i = 0; i < 81; i++) {
      const v = state.cells[i].value;
      if (v == null || v < 1 || v > 9) return false;
    }

    if (getConflictIndices().size > 0) return false;
    if (hasInvalidNotes()) return false;

    for (const indices of getSudokuUnits()) {
      const seen = new Set();
      for (const idx of indices) {
        seen.add(state.cells[idx].value);
      }
      if (seen.size !== 9) return false;
      for (let d = 1; d <= 9; d++) {
        if (!seen.has(d)) return false;
      }
    }

    return true;
  }

  function loadPugIcon() {
    const img = new Image();
    img.src = PUG_ICON_SRC;
    img.onload = () => {
      pugIconImage = img;
    };
    img.onerror = () => {
      pugIconImage = null;
    };
  }

  function resizeConfettiCanvas() {
    if (!confettiCanvasEl) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    confettiCanvasEl.width = Math.floor(w * dpr);
    confettiCanvasEl.height = Math.floor(h * dpr);
    confettiCanvasEl.style.width = `${w}px`;
    confettiCanvasEl.style.height = `${h}px`;
    const ctx = confettiCanvasEl.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function stopPugConfetti() {
    if (confettiAnimationId != null) {
      window.cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }
    confettiParticles = [];
    const ctx = confettiCanvasEl?.getContext("2d");
    if (ctx && confettiCanvasEl) {
      ctx.clearRect(0, 0, confettiCanvasEl.width, confettiCanvasEl.height);
    }
  }

  function getConfettiOrigin() {
    const boardSection = document.querySelector(".board-section");
    if (boardSection) {
      const rect = boardSection.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function launchPugConfetti() {
    if (!confettiCanvasEl) return;

    stopPugConfetti();

    const origin = getConfettiOrigin();
    const count = 72;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 18;
      confettiParticles.push({
        x: origin.x + (Math.random() - 0.5) * 24,
        y: origin.y + (Math.random() - 0.5) * 24,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (6 + Math.random() * 8),
        size: 20 + Math.random() * 44,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        alpha: 1,
        decay: 0.006 + Math.random() * 0.008,
      });
    }

    const start = performance.now();
    const maxDurationMs = 4500;

    const tick = (now) => {
      const ctx = resizeConfettiCanvas();
      if (!ctx || !confettiCanvasEl) return;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      let alive = 0;
      for (const p of confettiParticles) {
        p.vy += 0.42;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.alpha -= p.decay;

        if (p.alpha <= 0) continue;
        alive++;

        if (pugIconImage) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, p.alpha);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.drawImage(pugIconImage, -p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
        } else {
          ctx.save();
          ctx.globalAlpha = Math.min(1, p.alpha);
          ctx.fillStyle = "rgba(13, 148, 136, 0.9)";
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillRect(-p.size / 4, -p.size / 4, p.size / 2, p.size / 2);
          ctx.restore();
        }
      }

      if (alive > 0 && now - start < maxDurationMs) {
        confettiAnimationId = window.requestAnimationFrame(tick);
      } else {
        stopPugConfetti();
      }
    };

    confettiAnimationId = window.requestAnimationFrame(tick);
  }

  function updateCompletionBanner() {
    if (!completionBannerEl || !completionTimeEl) return;

    const solved = isPuzzleSolved();
    if (solved) {
      if (state.timer.running) pauseTimer();
      completionTimeEl.textContent = formatElapsed(getElapsedMs());
      completionBannerEl.hidden = false;
      if (!wasPuzzleSolved) {
        wasPuzzleSolved = true;
        launchPugConfetti();
      }
    } else {
      completionBannerEl.hidden = true;
      wasPuzzleSolved = false;
      stopPugConfetti();
    }
  }

  function canEditCell(cellIndex) {
    if (state.ui.mode === "setup") return true;
    return !state.cells[cellIndex].given;
  }

  function setMode(mode) {
    if (mode === state.ui.mode) return;

    if (state.ui.mode === "setup" && mode !== "answer") {
      // Notes are for after lock; keep setup focused on givens.
      return;
    }
    if (mode === "setup") return;

    state.ui.mode = mode;
    render();
    saveToStorage();
  }

  function setActiveDigit(d) {
    state.ui.activeDigit = d;
    // Active digit highlighting is visual-only; doesn't need history.
    render();
  }

  /** Digit used to highlight matching formal answers (not annotations). */
  function getFormalHighlightDigit() {
    const sel = state.ui.selectedIndex;
    if (sel != null) {
      const v = state.cells[sel].value;
      if (v != null) return v;
    }
    return state.ui.activeDigit;
  }

  function selectIndex(i) {
    state.ui.selectedIndex = i;
    const formal = state.cells[i].value;
    if (formal != null) state.ui.activeDigit = formal;
    render();

    // Keep keyboard entry feeling natural.
    const cellDom = dom.cells[i];
    if (cellDom) cellDom.el.focus({ preventScroll: true });
  }

  function moveSetupSelectionLinear(step) {
    const current = state.ui.selectedIndex;
    if (current == null) {
      selectIndex(0);
      return;
    }
    const next = Math.max(0, Math.min(80, current + step));
    selectIndex(next);
  }

  function moveSetupSelectionVertical(deltaRow) {
    const current = state.ui.selectedIndex;
    if (current == null) {
      selectIndex(0);
      return;
    }
    const { row, col } = indexToRowCol(current);
    const nextRow = Math.max(0, Math.min(8, row + deltaRow));
    selectIndex(nextRow * 9 + col);
  }

  function markSetupCellEmptyAndMove(step) {
    if (state.ui.mode !== "setup") return;

    const idx = state.ui.selectedIndex;
    if (idx == null) {
      selectIndex(0);
      return;
    }

    const cell = state.cells[idx];
    const hadValue = cell.value != null || cell.given || cell.edgeNotes.length > 0 || cell.middleNotes.length > 0;
    if (hadValue) {
      saveHistoryBeforeEdit();
      cell.value = null;
      cell.given = false;
      cell.edgeNotes = [];
      cell.middleNotes = [];
    }

    moveSetupSelectionLinear(step);
  }

  function toggleInArrayUnique(arr, d) {
    const idx = arr.indexOf(d);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(d);
    arr.sort((a, b) => a - b);
  }

  function saveHistoryBeforeEdit() {
    state.history.past.push(cloneSnapshot());
    state.history.future = [];
  }

  function undo() {
    const { past, future } = state.history;
    if (past.length === 0) return;
    future.push(cloneSnapshot());
    const prev = past.pop();
    if (prev) restoreSnapshot(prev);
    render();
    saveToStorage();
  }

  function redo() {
    const { past, future } = state.history;
    if (future.length === 0) return;
    past.push(cloneSnapshot());
    const next = future.pop();
    if (next) restoreSnapshot(next);
    render();
    saveToStorage();
  }

  function applyDigitToSelected(d) {
    const idx = state.ui.selectedIndex;
    if (idx == null) return;
    if (!canEditCell(idx)) return;

    saveHistoryBeforeEdit();

    const cell = state.cells[idx];

    if (state.ui.mode === "setup") {
      cell.value = d;
      cell.given = true;
      cell.edgeNotes = [];
      cell.middleNotes = [];
      moveSetupSelectionLinear(1);
      saveToStorage();
      return;
    }

    if (state.ui.mode === "answer") {
      cell.value = d;
      cell.edgeNotes = [];
      cell.middleNotes = [];
      render();
      saveToStorage();
      return;
    }

    // Note modes clear formal answer when you start annotating.
    if (state.ui.mode === "edge") {
      cell.value = null;
      toggleInArrayUnique(cell.edgeNotes, d);
      render();
      saveToStorage();
      return;
    }

    if (state.ui.mode === "middle") {
      cell.value = null;
      toggleInArrayUnique(cell.middleNotes, d);
      render();
      saveToStorage();
      return;
    }
  }

  function clearSelectionInMode() {
    const idx = state.ui.selectedIndex;
    if (idx == null) return;
    if (!canEditCell(idx)) return;

    saveHistoryBeforeEdit();

    const cell = state.cells[idx];

    if (state.ui.mode === "setup") {
      cell.given = false;
      cell.value = null;
      cell.edgeNotes = [];
      cell.middleNotes = [];
      render();
      saveToStorage();
      return;
    }

    if (state.ui.mode === "answer") {
      cell.value = null;
      cell.edgeNotes = [];
      cell.middleNotes = [];
      render();
      saveToStorage();
      return;
    }

    // Notes: clear digit if activeDigit exists; otherwise clear all notes for that mode.
    const d = state.ui.activeDigit;
    if (state.ui.mode === "edge") {
      if (d != null) cell.edgeNotes = cell.edgeNotes.filter((x) => x !== d);
      else cell.edgeNotes = [];
      render();
      saveToStorage();
      return;
    }
    if (state.ui.mode === "middle") {
      if (d != null) cell.middleNotes = cell.middleNotes.filter((x) => x !== d);
      else cell.middleNotes = [];
      render();
      saveToStorage();
      return;
    }
  }

  function clearBoard() {
    saveHistoryBeforeEdit();
    state.ui = { mode: "setup", selectedIndex: null, activeDigit: null };
    state.cells = Array.from({ length: 81 }, () => emptyCell());
    render();
    resetTimer();
    clearStorage();
  }

  function unlockPuzzle() {
    if (state.ui.mode === "setup") return;
    saveHistoryBeforeEdit();
    pauseTimer();
    state.ui.mode = "setup";
    state.ui.selectedIndex = null;
    state.ui.activeDigit = null;
    render();
    saveToStorage();
  }

  function lockPuzzle() {
    if (state.ui.mode !== "setup") return;
    saveHistoryBeforeEdit();
    for (const cell of state.cells) {
      // Any entered value becomes a given.
      cell.given = cell.value != null;
      // Notes are not part of setup.
      cell.edgeNotes = [];
      cell.middleNotes = [];
    }
    state.ui.mode = "answer";
    render();
    startTimerIfNeeded();
    saveToStorage();
  }

  function updateModeUI() {
    const modeText =
      state.ui.mode === "setup"
        ? "Setup mode"
        : state.ui.mode === "answer"
          ? "Answer mode"
          : state.ui.mode === "edge"
            ? "Edge notes"
            : "Middle notes";
    modeLabelEl.textContent = modeText;
    modeLabelEl.classList.remove("setup", "answer", "edge", "middle");
    modeLabelEl.classList.add(state.ui.mode);

    for (const btn of modeButtons) {
      const mode = btn.dataset.mode;
      btn.classList.toggle("active", mode === state.ui.mode);
      // During setup, only Answer is enabled.
      const disabled = state.ui.mode === "setup" && mode !== "answer";
      btn.disabled = disabled;
    }

    const isSetup = state.ui.mode === "setup";
    lockButtonEl.disabled = false;
    const lockLong = lockButtonEl.querySelector(".label-long");
    const lockShort = lockButtonEl.querySelector(".label-short");
    if (isSetup) {
      if (lockLong) lockLong.textContent = "Start / Lock puzzle";
      if (lockShort) lockShort.textContent = "Lock";
    } else {
      if (lockLong) lockLong.textContent = "Unlock to edit givens";
      if (lockShort) lockShort.textContent = "Unlock";
    }
    lockButtonEl.classList.toggle("primary", isSetup);
    lockButtonEl.classList.toggle("secondary", !isSetup);
  }

  function render() {
    updateModeUI();
    renderTimer();

    const conflictIndices = getConflictIndices();
    const { rowHas, colHas, boxHas } = getAnswerDigitPresence();

    undoButtonEl.disabled = state.history.past.length === 0;
    redoButtonEl.disabled = state.history.future.length === 0;

    // Active digit button highlighting.
    for (const btn of padKeyEls) {
      const d = Number(btn.dataset.digit);
      btn.classList.toggle("active-digit", state.ui.activeDigit === d);
    }

    for (let i = 0; i < 81; i++) {
      const cell = state.cells[i];
      const cellDom = dom.cells[i];
      if (!cellDom) continue;

      const { row, col } = indexToRowCol(i);
      const b = boxIndex(row, col);

      // Classes: clear + re-add
      cellDom.el.classList.remove(
        "isSelected",
        "inActiveRow",
        "inActiveCol",
        "inActiveBox",
        "sameDigit",
        "given",
        "conflict"
      );

      if (cell.given && state.ui.mode !== "setup") cellDom.el.classList.add("given");
      if (state.ui.selectedIndex === i) cellDom.el.classList.add("isSelected");

      if (state.ui.selectedIndex != null) {
        const { row: selR, col: selC } = indexToRowCol(state.ui.selectedIndex);
        const selB = boxIndex(selR, selC);
        if (row === selR) cellDom.el.classList.add("inActiveRow");
        if (col === selC) cellDom.el.classList.add("inActiveCol");
        if (b === selB) cellDom.el.classList.add("inActiveBox");
      }

      const highlightDigit = getFormalHighlightDigit();
      if (highlightDigit != null && cell.value === highlightDigit) {
        cellDom.el.classList.add("sameDigit");
      }

      // Answer rendering + conflict coloring.
      cellDom.answerEl.textContent = cell.value == null ? "" : String(cell.value);
      cellDom.el.classList.toggle("conflict", conflictIndices.has(i) && cell.value != null);

      // Edge notes rendering (top-left, top-right, bottom-left, bottom-right).
      const edgeDigits = [...cell.edgeNotes].sort((a, b2) => a - b2).slice(0, 4);
      for (let k = 0; k < 4; k++) {
        const digit = edgeDigits[k] ?? null;
        const noteEl = cellDom.edgeEls[k];
        if (digit == null) {
          noteEl.textContent = "";
          noteEl.classList.remove("invalid");
          continue;
        }
        const invalid = rowHas[row][digit] || colHas[col][digit] || boxHas[b][digit];
        noteEl.textContent = String(digit);
        noteEl.classList.toggle("invalid", invalid);
      }

      // Middle notes: digits as individual spans.
      cellDom.middleEl.innerHTML = "";
      const middleDigits = [...cell.middleNotes].sort((a, b2) => a - b2);
      for (const digit of middleDigits) {
        const span = document.createElement("span");
        span.textContent = String(digit);
        span.className = "middle-digit";
        const invalid = rowHas[row][digit] || colHas[col][digit] || boxHas[b][digit];
        if (invalid) span.classList.add("invalid");
        cellDom.middleEl.appendChild(span);
      }
    }

    updateCompletionBanner();
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    dom.cells = [];

    for (let i = 0; i < 81; i++) {
      const { row, col } = indexToRowCol(i);
      const el = document.createElement("div");
      el.className = "cell";
      el.tabIndex = 0;
      el.setAttribute("role", "gridcell");
      el.dataset.index = String(i);

      // Thick borders at 3x3 box boundaries.
      if (row % 3 === 0) el.classList.add("t-top");
      if (row % 3 === 2) el.classList.add("t-bottom");
      if (col % 3 === 0) el.classList.add("t-left");
      if (col % 3 === 2) el.classList.add("t-right");

      const answerEl = document.createElement("div");
      answerEl.className = "cell-answer";

      const edgeWrapEl = document.createElement("div");
      edgeWrapEl.className = "edge-notes";

      const edgeEls = [];
      for (let k = 0; k < 4; k++) {
        const noteEl = document.createElement("div");
        noteEl.className = "edge-note";
        edgeWrapEl.appendChild(noteEl);
        edgeEls.push(noteEl);
      }

      const middleEl = document.createElement("div");
      middleEl.className = "middle-notes";

      el.appendChild(answerEl);
      el.appendChild(edgeWrapEl);
      el.appendChild(middleEl);

      el.addEventListener("click", () => selectIndex(i));
      el.addEventListener("pointerdown", (e) => {
        // Ensure selection happens before keyboard.
        e.preventDefault();
        selectIndex(i);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectIndex(i);
        }
      });

      boardEl.appendChild(el);

      dom.cells.push({ el, answerEl, edgeEls, middleEl });
    }
  }

  function moveSelection(dr, dc) {
    const sel = state.ui.selectedIndex;
    if (sel == null) {
      selectIndex(40);
      return;
    }
    const { row, col } = indexToRowCol(sel);
    const nr = row + dr;
    const nc = col + dc;
    if (nr < 0 || nr > 8 || nc < 0 || nc > 8) return;
    selectIndex(nr * 9 + nc);
  }

  function handleKeyDown(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    const tag = (target?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const key = e.key;

    // Undo/redo shortcuts
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (key.toLowerCase() === "y" || (e.shiftKey && key.toLowerCase() === "z"))) {
      e.preventDefault();
      redo();
      return;
    }

    if (key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1, 0);
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1, 0);
      return;
    }
    if (key === "ArrowLeft") {
      e.preventDefault();
      moveSelection(0, -1);
      return;
    }
    if (key === "ArrowRight") {
      e.preventDefault();
      moveSelection(0, 1);
      return;
    }

    // Mode shortcuts
    if (key.toLowerCase() === "a") {
      e.preventDefault();
      setMode("answer");
      return;
    }
    if (key.toLowerCase() === "e") {
      e.preventDefault();
      setMode("edge");
      return;
    }
    if (key.toLowerCase() === "m") {
      e.preventDefault();
      setMode("middle");
      return;
    }

    if (key === "Backspace" || key === "Delete" || key === "0") {
      e.preventDefault();
      clearSelectionInMode();
      return;
    }

    if (state.ui.mode === "setup" && key === "Tab") {
      e.preventDefault();
      moveSetupSelectionLinear(e.shiftKey ? -1 : 1);
      return;
    }

    if (state.ui.mode === "setup" && key === "Enter") {
      e.preventDefault();
      moveSetupSelectionVertical(e.shiftKey ? -1 : 1);
      return;
    }

    if (state.ui.mode === "setup" && key === " ") {
      e.preventDefault();
      markSetupCellEmptyAndMove(1);
      return;
    }

    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      e.preventDefault();
      setActiveDigit(digit);
      applyDigitToSelected(digit);
      return;
    }
  }

  function init() {
    state.cells = Array.from({ length: 81 }, () => emptyCell());
    buildBoard();

    // Setup initial mode button states.
    state.ui = { mode: "setup", selectedIndex: null, activeDigit: null };
    state.timer = { elapsedMs: 0, running: false, startedAtMs: null };
    loadFromStorage();
    ensureTimerInterval();

    // Number pad input.
    for (const btn of padKeyEls) {
      btn.addEventListener("click", () => {
        const d = Number(btn.dataset.digit);
        setActiveDigit(d);
        applyDigitToSelected(d);
      });
    }

    clearCellButtonEl.addEventListener("click", () => clearSelectionInMode());
    undoButtonEl.addEventListener("click", undo);
    redoButtonEl.addEventListener("click", redo);
    clearBoardButtonEl.addEventListener("click", clearBoard);
    lockButtonEl.addEventListener("click", () => {
      if (state.ui.mode === "setup") lockPuzzle();
      else unlockPuzzle();
    });
    timerToggleButtonEl.addEventListener("click", toggleTimer);

    for (const btn of modeButtons) {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    }

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", () => {
      if (confettiParticles.length > 0) resizeConfettiCanvas();
    });
    loadPugIcon();
    render();
  }

  init();
})();

