"use strict";

const STORE_KEY = "oro-modten-v1";
const ICON = { plus: "+", minus: "−", mul: "×", plain: "" };
const ORDER = { plain: 0, plus: 1, minus: 2, mul: 3 };
const NAMES = ["你", "電腦 A", "電腦 B", "電腦 C"];
let game = null;
let timer = null;
let runId = 0;
let toastTimer = null;

function newDeck() {
  const cards = [];
  let id = 0;
  for (let n = 0; n <= 9; n++) {
    cards.push({ id: "c" + id++, kind: "plus", value: n });
  }
  for (let n = 0; n <= 9; n++) {
    cards.push({ id: "c" + id++, kind: "minus", value: n });
  }
  for (let n = 1; n <= 10; n++) {
    cards.push({ id: "c" + id++, kind: "mul", value: n });
  }
  for (let n = 0; n <= 9; n++) {
    cards.push({ id: "c" + id++, kind: "plain", value: n });
  }
  return cards;
}
function shuffle(input) {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function label(card) { return ICON[card.kind] + card.value; }
function sortHand(cards) {
  return cards.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.value - b.value);
}
function evaluate(cards) {
  if (!cards.length || cards.length > 3) return { ok: false, reason: "每次必須使用 1～3 張牌。" };
  const terms = [{ op: null, digits: String(cards[0].value) }];
  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    if (card.kind === "plain") {
      const last = terms[terms.length - 1];
      if (last.digits.length !== 1 || last.digits === "0") {
        return { ok: false, reason: "不能組成三位數，也不能以 0 作為兩位數十位。" };
      }
      last.digits += String(card.value);
    } else {
      terms.push({ op: card.kind, digits: String(card.value) });
    }
  }
  let value = Number(terms[0].digits);
  let expression = terms[0].digits;
  for (let i = 1; i < terms.length; i++) {
    const t = terms[i];
    const n = Number(t.digits);
    if (t.op === "plus") { value += n; expression += "＋" + t.digits; }
    else if (t.op === "minus") { value -= n; expression += "−" + t.digits; }
    else if (t.op === "mul") { value *= n; expression += "×" + t.digits; }
  }
  return { ok: true, value, expression };
}
function checkMove(cards, state) {
  const ev = evaluate(cards);
  if (!ev.ok) return Object.assign({ legal: false }, ev);
  if (ev.value < 0) return Object.assign({ legal: false, reason: "答案不可為負數。" }, ev);
  if (((ev.value % 10) + 10) % 10 !== state.target) {
    return Object.assign({ legal: false, reason: "答案尾數必須是 " + state.target + "。" }, ev);
  }
  if (ev.value < state.currentValue) {
    return Object.assign({ legal: false, reason: "答案不能小於桌面數值。" }, ev);
  }
  if (ev.value === state.currentValue && cards.length < state.currentCount) {
    return Object.assign({ legal: false, reason: "答案相同時，至少要使用 " + state.currentCount + " 張牌。" }, ev);
  }
  return Object.assign({ legal: true, reason: ev.value > state.currentValue ? "數值提高，合法出牌。" : "數值相同，張數符合要求。" }, ev);
}
function allMoves(hand, state) {
  const result = [];
  function dfs(chosen, used) {
    if (chosen.length) {
      const ev = checkMove(chosen, state);
      if (ev.legal) result.push({ ids: chosen.map(c => c.id), count: chosen.length, value: ev.value, expression: ev.expression });
    }
    if (chosen.length === Math.min(3, hand.length)) return;
    for (let i = 0; i < hand.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      chosen.push(hand[i]);
      dfs(chosen, used);
      chosen.pop();
      used.delete(i);
    }
  }
  dfs([], new Set());
  return result;
}
function rankMove(move, state, personality, handSize) {
  if (move.count === handSize) return 100000 + move.value;
  const delta = Math.max(0, move.value - state.currentValue);
  const countWeight = [150, 128, 145, 138][personality];
  const raiseWeight = [8, 14, 5, 10][personality];
  return move.count * countWeight + Math.log1p(delta) * raiseWeight + (delta > 0 ? 9 : 0);
}
function pickMove(hand, state, personality) {
  const moves = allMoves(hand, state);
  if (!moves.length) return null;
  moves.sort((a, b) =>
    rankMove(b, state, personality, hand.length) - rankMove(a, state, personality, hand.length));
  if (personality === 0) return moves[0];
  const limit = Math.min(moves.length, personality === 1 ? 5 : 3);
  return moves[Math.floor(Math.random() * limit)];
}
function countPassed() { return game.passed.filter(Boolean).length; }
function addLog(message) {
  game.history.unshift(message);
  game.history.length = Math.min(7, game.history.length);
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(game)); } catch (e) { /* private browsing */ }
}
function notify(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2200);
}
function startGame() {
  clearTimeout(timer);
  runId++;
  const deck = shuffle(newDeck());
  const players = NAMES.map(name => ({ name, hand: [] }));
  for (let n = 0; n < 7; n++) for (let i = 0; i < 4; i++) players[i].hand.push(deck.pop());
  players.forEach(p => sortHand(p.hand));
  game = {
    version: 1, players, deck, discard: [], starter: null,
    round: 0, lead: 0, current: 0, currentValue: 0, currentCount: 0,
    target: 0, lastExpression: "", lastPlayedBy: null,
    passed: [false, false, false, false], selected: [],
    history: [], transitioning: false, winner: null, stalemateRounds: 0
  };
  document.getElementById("finishModal").hidden = true;
  beginRound(Math.floor(Math.random() * 4));
}
function beginRound(lead) {
  if (game.starter) game.discard.push(game.starter);
  if (!game.deck.length) {
    game.deck = shuffle(game.discard);
    game.discard = [];
    addLog("牌庫已耗盡，將棄牌洗回牌庫。");
  }
  if (!game.deck.length) {
    // This cannot occur with the standard 40-card / 7-card-per-player setup.
    game.transitioning = false;
    game.winner = -1;
    render();
    return;
  }
  game.round++;
  game.starter = game.deck.pop();
  game.currentValue = game.starter.value;
  game.target = game.currentValue % 10;
  game.currentCount = 0;
  game.lastExpression = "";
  game.lastPlayedBy = null;
  game.passed = [false, false, false, false];
  game.selected = [];
  game.lead = lead;
  game.current = lead;
  game.transitioning = false;
  addLog("第 " + game.round + " 輪：翻開 " + label(game.starter) + "，目標尾數 " + game.target + "。");
  render();
  scheduleAI();
}
function cardsForIds(playerIndex, ids) {
  const hand = game.players[playerIndex].hand;
  return ids.map(id => hand.find(c => c.id === id)).filter(Boolean);
}
function playMove(playerIndex, ids) {
  if (game.winner !== null || game.transitioning || game.current !== playerIndex || game.passed[playerIndex]) return false;
  const cards = cardsForIds(playerIndex, ids);
  if (cards.length !== ids.length || !cards.length || cards.length > 3 || new Set(ids).size !== ids.length) return false;
  const result = checkMove(cards, game);
  if (!result.legal) {
    if (playerIndex === 0) notify(result.reason);
    return false;
  }
  const used = new Set(ids);
  game.players[playerIndex].hand = game.players[playerIndex].hand.filter(c => !used.has(c.id));
  game.discard.push(...cards);
  game.currentValue = result.value;
  game.currentCount = cards.length;
  game.lastExpression = result.expression + "＝" + result.value;
  game.lastPlayedBy = playerIndex;
  game.selected = [];
  game.stalemateRounds = 0;
  addLog(NAMES[playerIndex] + "： " + result.expression + "＝" + result.value + "（" + cards.length + " 張）");
  if (game.players[playerIndex].hand.length === 0) {
    game.winner = playerIndex;
    render();
    showFinish();
    return true;
  }
  advanceTurn();
  return true;
}
function passTurn(playerIndex) {
  if (game.winner !== null || game.transitioning || game.current !== playerIndex || game.passed[playerIndex]) return;
  game.passed[playerIndex] = true;
  game.selected = [];
  addLog(NAMES[playerIndex] + " PASS，本輪不再出牌。");
  advanceTurn();
}
function advanceTurn() {
  if (countPassed() >= 3) {
    const lone = game.passed.findIndex(x => !x);
    const lead = game.lastPlayedBy !== null ? game.lastPlayedBy : lone;
    const noPlay = game.lastPlayedBy === null;
    if (noPlay) game.stalemateRounds++;
    addLog("本輪結束，下輪由 " + NAMES[lead] + " 先手。");
    game.transitioning = true;
    game.current = lead;
    render();
    const currentRun = runId;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (currentRun === runId && game && game.winner === null) beginRound(lead);
    }, 1150);
    return;
  }
  let next = game.current;
  do { next = (next + 1) % 4; } while (game.passed[next]);
  game.current = next;
  render();
  scheduleAI();
}
function scheduleAI() {
  clearTimeout(timer);
  if (!game || game.current === 0 || game.transitioning || game.winner !== null) return;
  const currentRun = runId;
  const actor = game.current;
  timer = setTimeout(() => {
    if (currentRun !== runId || !game || game.current !== actor || game.transitioning || game.winner !== null) return;
    const move = pickMove(game.players[actor].hand, game, actor);
    if (move) playMove(actor, move.ids);
    else passTurn(actor);
  }, 650 + Math.floor(Math.random() * 310));
}
function isMyTurn() {
  return !!game && game.winner === null && !game.transitioning && game.current === 0 && !game.passed[0];
}
function toggleCard(id) {
  if (!isMyTurn()) return;
  if (!game.players[0].hand.some(c => c.id === id)) return;
  const index = game.selected.indexOf(id);
  if (index >= 0) game.selected.splice(index, 1);
  else if (game.selected.length < 3) game.selected.push(id);
  else return notify("每次最多選擇 3 張牌。");
  render();
}
function applyHint() {
  if (!isMyTurn()) return;
  const move = pickMove(game.players[0].hand, game, 0);
  if (!move) return notify("目前沒有合法出牌，可選擇 PASS。");
  game.selected = move.ids.slice();
  render();
  notify("已幫你選好建議牌組，確認後點「出牌」。");
}
function cardMarkup(card, pos) {
  const chosen = game.selected.indexOf(card.id);
  const selected = chosen >= 0;
  return '<button type="button" class="playing-card kind-' + card.kind +
    (selected ? ' selected' : '') + '" data-card="' + card.id +
    '" aria-pressed="' + selected + '" aria-label="' + label(card) +
    (selected ? '，第' + (chosen + 1) + '張' : '') + '">' +
    '<span class="corner">' + label(card) + '</span>' +
    '<strong>' + label(card) + '</strong>' +
    (selected ? '<span class="order">' + (chosen + 1) + '</span>' : '') +
    '</button>';
}
function render() {
  if (!game) return;
  document.getElementById("roundText").textContent = "第 " + game.round + " 輪";
  document.getElementById("starterFace").textContent = label(game.starter);
  document.getElementById("targetDigit").textContent = game.target;
  document.getElementById("boardValue").textContent = game.currentValue;
  document.getElementById("boardCount").textContent = game.currentCount === 0 ?
    "起始值" : game.currentCount + " 張牌";
  document.getElementById("lastExpression").textContent = game.lastExpression || "目前為本輪起始數值";
  document.getElementById("deckCount").textContent = game.deck.length;
  const currentName = NAMES[game.current];
  const turnText = game.winner !== null ? (game.winner >= 0 ? NAMES[game.winner] + " 獲勝！" : "遊戲結束") :
    game.transitioning ? "本輪結束，準備下一輪…" :
    game.current === 0 ? "輪到你出牌" : currentName + " 思考中…";
  document.getElementById("turnText").textContent = turnText;
  document.getElementById("turnPill").classList.toggle("my-turn", isMyTurn());
  document.getElementById("rivals").innerHTML = [1, 2, 3].map(i => {
    const p = game.players[i];
    const active = game.current === i && !game.transitioning && game.winner === null;
    return '<div class="rival' + (active ? ' active' : '') + (game.passed[i] ? ' passed' : '') + '">' +
      '<div class="avatar">' + String.fromCharCode(64 + i) + '</div>' +
      '<div class="rival-name">' + p.name + '</div>' +
      '<div class="rival-count">' + (game.passed[i] ? 'PASS' : p.hand.length + ' 張') + '</div>' +
      '</div>';
  }).join("");
  const hand = game.players[0].hand;
  document.getElementById("handCounter").textContent = "剩 " + hand.length + " 張";
  document.getElementById("hand").innerHTML = hand.map(cardMarkup).join("");
  const selected = cardsForIds(0, game.selected);
  document.getElementById("selectedCards").innerHTML = selected.length ?
    selected.map((c, i) => '<button class="selected-chip" type="button" data-remove="' + c.id +
      '" title="點擊移除">' + (i + 1) + '. ' + label(c) + ' <span>×</span></button>').join("") :
    '<span class="selection-placeholder">依序點選手牌，最多 3 張</span>';
  const result = selected.length ? checkMove(selected, game) : null;
  const preview = document.getElementById("preview");
  preview.className = "preview" + (result ? result.legal ? " is-valid" : " is-invalid" : "");
  if (!result) preview.textContent = "選牌後，這裡會顯示算式與合法性。";
  else if (result.ok) preview.textContent = result.expression + " ＝ " + result.value + "｜" + (result.legal ? "可以出牌" : result.reason);
  else preview.textContent = result.reason;
  const myTurn = isMyTurn();
  document.getElementById("playBtn").disabled = !(myTurn && result && result.legal);
  document.getElementById("passBtn").disabled = !myTurn;
  document.getElementById("hintBtn").disabled = !myTurn;
  document.getElementById("clearBtn").disabled = !myTurn || !game.selected.length;
  document.getElementById("hand").classList.toggle("locked", !myTurn);
  document.getElementById("history").innerHTML = game.history.slice(0, 4).map((line, i) =>
    '<li' + (i === 0 ? ' class="recent"' : '') + '>' + line + '</li>').join("");
  save();
}
function showFinish() {
  document.getElementById("finishTitle").textContent = game.winner === 0 ? "你贏了！" : NAMES[game.winner] + " 獲勝";
  document.getElementById("finishText").textContent = game.winner === 0 ?
    "成功將所有手牌打光！" : "這次由電腦率先打光手牌，再挑戰一次吧。";
  document.getElementById("finishModal").hidden = false;
}
function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!saved || saved.version !== 1 || !Array.isArray(saved.players) || saved.players.length !== 4 ||
        !Array.isArray(saved.deck) || !Array.isArray(saved.discard) ||
        !Array.isArray(saved.passed) || saved.passed.length !== 4 ||
        !saved.starter) return false;
    game = saved;
    game.selected = [];
    if (game.transitioning && game.winner === null) {
      const lead = game.current;
      beginRound(lead);
    } else {
      render();
      if (game.winner !== null) showFinish();
      else scheduleAI();
    }
    return true;
  } catch (e) { return false; }
}
function openRules() { document.getElementById("rulesModal").hidden = false; }
function closeRules() { document.getElementById("rulesModal").hidden = true; }

// APP BOOTSTRAP
document.getElementById("hand").addEventListener("click", e => {
  const card = e.target.closest("[data-card]");
  if (card) toggleCard(card.dataset.card);
});
document.getElementById("selectedCards").addEventListener("click", e => {
  const card = e.target.closest("[data-remove]");
  if (card) toggleCard(card.dataset.remove);
});
document.getElementById("playBtn").addEventListener("click", () => {
  if (isMyTurn()) playMove(0, game.selected.slice());
});
document.getElementById("passBtn").addEventListener("click", () => {
  if (isMyTurn()) passTurn(0);
});
document.getElementById("hintBtn").addEventListener("click", applyHint);
document.getElementById("clearBtn").addEventListener("click", () => {
  if (game) { game.selected = []; render(); }
});
document.getElementById("rulesBtn").addEventListener("click", openRules);
document.getElementById("closeRulesBtn").addEventListener("click", closeRules);
document.getElementById("rulesModal").addEventListener("click", e => {
  if (e.target.id === "rulesModal") closeRules();
});
document.getElementById("resetBtn").addEventListener("click", () => {
  if (confirm("確定要重新開始？目前對局會被清除。")) startGame();
});
document.getElementById("playAgainBtn").addEventListener("click", startGame);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeRules();
});
if (!loadSaved()) startGame();
