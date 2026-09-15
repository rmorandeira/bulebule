// Utilidades para el jugador "tester" (marcado desde el backoffice): calcula
// qué tipos de jugada son alcanzables dado lo que ya tiene bloqueado sobre el
// tablero, y elige una combinación de valores para los dados que se van a
// tirar que produzca exactamente la jugada elegida. La física y el banco de
// semillas no cambian — solo se sustituye rollDie() por un valor objetivo
// (ver performDiceRoll en server.js).

const { evaluateHand } = require('../gameLogic');

const DICE_VALUES = ['AS', 'K', 'Q', 'J', '8', '7'];
const RANK_NAMES = ['Carta alta', 'Pareja', 'Dobles parejas', 'Trío', 'Escalera', 'Full', 'Póker', 'Repóker'];

function combosWithRepetition(values, k) {
  const results = [];
  (function rec(start, cur) {
    if (cur.length === k) { results.push([...cur]); return; }
    for (let i = start; i < values.length; i++) {
      cur.push(values[i]);
      rec(i, cur);
      cur.pop();
    }
  })(0, []);
  return results;
}

// Todas las jugadas finales alcanzables manteniendo fijos keptValues y
// completando con n = 5 - keptValues.length dados nuevos (cualquier valor).
function achievableRanks(keptValues) {
  const n = 5 - keptValues.length;
  if (n <= 0 || n > 5) return [];
  const ranks = new Set();
  for (const combo of combosWithRepetition(DICE_VALUES, n)) {
    ranks.add(evaluateHand([...keptValues, ...combo]).rank);
  }
  return [...ranks].sort((a, b) => b - a).map(rank => ({ rank, name: RANK_NAMES[rank] }));
}

// Valores para los n dados nuevos que, junto a keptValues, dan exactamente
// targetRank — elegido al azar entre todas las combinaciones válidas. Null
// si no es alcanzable (no debería pasar si el rank viene de achievableRanks).
function pickCompletionForRank(keptValues, targetRank) {
  const n = 5 - keptValues.length;
  if (n <= 0 || n > 5) return null;
  const matches = combosWithRepetition(DICE_VALUES, n)
    .filter(combo => evaluateHand([...keptValues, ...combo]).rank === targetRank);
  if (matches.length === 0) return null;
  return matches[Math.floor(Math.random() * matches.length)];
}

module.exports = { achievableRanks, pickCompletionForRank, RANK_NAMES };
