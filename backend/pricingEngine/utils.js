function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sameCardName(a, b) {
  return normalize(a.nomCarte || a.nomBase) === normalize(b.nomCarte || b.nomBase);
}

function daysOld(dateText) {
  if (!dateText) return 9999;
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return 9999;
  return Math.max(0, (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function recencyWeight(dateText) {
  const d = daysOld(dateText);
  if (d <= 30) return 1.0;
  if (d <= 90) return 0.8;
  if (d <= 180) return 0.6;
  if (d <= 365) return 0.4;
  return 0.2;
}

function weightedAverage(items, getValue, getDate) {
  let total = 0;
  let weights = 0;

  items.forEach(item => {
    const value = Number(getValue(item) || 0);
    if (!value) return;

    const w = recencyWeight(getDate(item));
    total += value * w;
    weights += w;
  });

  return weights ? total / weights : null;
}

module.exports = {
  normalize,
  sameCardName,
  daysOld,
  recencyWeight,
  weightedAverage
};