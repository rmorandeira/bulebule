const DICE_VALUES = ['A', 'K', 'Q', 'J', '10', '9'];
const VALUE_RANK = { A: 6, K: 5, Q: 4, J: 3, '10': 2, '9': 1 };

function rollDie() {
  return DICE_VALUES[Math.floor(Math.random() * DICE_VALUES.length)];
}

function rollDice(kept = []) {
  const result = [...kept];
  while (result.length < 5) result.push(rollDie());
  return result;
}

function evaluateHand(dice) {
  const counts = {};
  for (const d of dice) counts[d] = (counts[d] || 0) + 1;

  const groups = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || VALUE_RANK[b[0]] - VALUE_RANK[a[0]]);

  const [[topKey, topCount]] = groups;
  const secondCount = groups[1]?.[1] ?? 0;

  if (topCount === 5) return { rank: 7, name: 'Quintilla',      desc: `Quintilla de ${topKey}`,          topKey };
  if (topCount === 4) return { rank: 6, name: 'Póker',          desc: `Póker de ${topKey}`,               topKey };
  if (topCount === 3 && secondCount === 2)
                      return { rank: 5, name: 'Full',           desc: `Full de ${topKey}`,                topKey };

  const uniqueRanks = [...new Set(dice.map(d => VALUE_RANK[d]))].sort((a, b) => a - b);
  if (uniqueRanks.length === 5 && uniqueRanks[4] - uniqueRanks[0] === 4)
                      return { rank: 4, name: 'Escalera',       desc: 'Escalera',                         topKey: null };

  if (topCount === 3) return { rank: 3, name: 'Trío',           desc: `Trío de ${topKey}`,                topKey };

  if (topCount === 2 && secondCount === 2) {
    const pairs = groups.filter(([, c]) => c === 2).map(([k]) => k)
      .sort((a, b) => VALUE_RANK[b] - VALUE_RANK[a]);
    return { rank: 2, name: 'Dobles parejas', desc: `Dobles parejas de ${pairs[0]} y ${pairs[1]}`, pairs };
  }

  if (topCount === 2) return { rank: 1, name: 'Pareja',         desc: `Pareja de ${topKey}`,              topKey };

  const highKey = dice.reduce((b, d) => VALUE_RANK[d] > VALUE_RANK[b] ? d : b);
  return { rank: 0, name: 'Carta alta', desc: `Carta alta: ${highKey}`, topKey: highKey };
}

function compareHands(h1, h2) {
  if (h1.rank !== h2.rank) return h1.rank - h2.rank;
  if (h1.topKey && h2.topKey) return VALUE_RANK[h1.topKey] - VALUE_RANK[h2.topKey];
  if (h1.pairs && h2.pairs) {
    const d = VALUE_RANK[h1.pairs[0]] - VALUE_RANK[h2.pairs[0]];
    return d !== 0 ? d : VALUE_RANK[h1.pairs[1]] - VALUE_RANK[h2.pairs[1]];
  }
  return 0;
}

module.exports = { rollDie, rollDice, evaluateHand, compareHands };
