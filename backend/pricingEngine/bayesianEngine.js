const DEFAULT_GLOBAL_RATIOS = {
  NM: 1.00,
  EX: 0.85,
  GD: 0.72,
  LP: 0.62,
  PL: 0.48,
  PO: 0.35
};

const CONDITIONS = ["NM", "EX", "GD", "LP", "PL", "PO"];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, number(value)));
}

function normalizeWeights(weights) {
  const total =
    number(weights.card) +
    number(weights.edition) +
    number(weights.language) +
    number(weights.global);

  if (total <= 0) {
    return {
      card: 0,
      edition: 0,
      language: 0,
      global: 1
    };
  }

  return {
    card: number(weights.card) / total,
    edition: number(weights.edition) / total,
    language: number(weights.language) / total,
    global: number(weights.global) / total
  };
}

/**
 * Transforme une quantité d'information en force statistique.
 *
 * 0 observation  -> 0
 * peu de données -> progression rapide
 * beaucoup       -> convergence progressive vers 1
 */
function evidenceStrength(count, priorStrength) {
  const safeCount = Math.max(0, number(count));
  const safePrior = Math.max(1, number(priorStrength));

  return safeCount / (safeCount + safePrior);
}

/**
 * Calcule les poids hiérarchiques :
 *
 * carte -> édition -> langue -> global
 *
 * Le niveau carte devient dominant lorsque les observations propres
 * à la carte augmentent. Les autres niveaux servent de repli.
 */
function getBayesianWeights({
  cardObservationDays = 0,
  cardObservationRows = 0,
  editionObservationRows = 0,
  languageObservationRows = 0,
  globalObservationRows = 0
} = {}) {
  const cardEvidence = Math.max(
    number(cardObservationRows),
    number(cardObservationDays) * 2
  );

  const cardStrength = evidenceStrength(cardEvidence, 8);
  const editionStrength = evidenceStrength(editionObservationRows, 30);
  const languageStrength = evidenceStrength(languageObservationRows, 50);
  const globalStrength = evidenceStrength(globalObservationRows, 100);

  let remaining = 1;

  const card = remaining * cardStrength;
  remaining -= card;

  const edition = remaining * editionStrength;
  remaining -= edition;

  const language = remaining * languageStrength;
  remaining -= language;

  /*
   * Le global reçoit tout le poids restant.
   * globalStrength est utilisé pour conserver une confiance faible lorsque
   * même les données globales sont rares.
   */
  const global =
    remaining * Math.max(0.25, globalStrength);

  const unresolved =
    Math.max(0, 1 - card - edition - language - global);

  return normalizeWeights({
    card,
    edition,
    language,
    global: global + unresolved
  });
}

function safeRatio(value, fallback) {
  const ratio = number(value);

  if (ratio <= 0) {
    return fallback;
  }

  return clamp(ratio, 0.15, 1);
}

/**
 * Combine les ratios disponibles selon les poids calculés.
 *
 * Une source absente ne doit pas être remplacée silencieusement par le global
 * avant la pondération : son poids est redistribué entre les sources valides.
 */
function blendHierarchicalRatio({
  condition,
  cardRatio = null,
  editionRatio = null,
  languageRatio = null,
  globalRatio = null,
  weights = null
}) {
  if (condition === "NM") {
    return 1;
  }

  const fallbackGlobal =
    safeRatio(
      globalRatio,
      DEFAULT_GLOBAL_RATIOS[condition] || 1
    );

  const sourceWeights = weights || {
    card: 0,
    edition: 0,
    language: 0,
    global: 1
  };

  const sources = [
    {
      name: "card",
      value: number(cardRatio) > 0
        ? safeRatio(cardRatio, fallbackGlobal)
        : null,
      weight: number(sourceWeights.card)
    },
    {
      name: "edition",
      value: number(editionRatio) > 0
        ? safeRatio(editionRatio, fallbackGlobal)
        : null,
      weight: number(sourceWeights.edition)
    },
    {
      name: "language",
      value: number(languageRatio) > 0
        ? safeRatio(languageRatio, fallbackGlobal)
        : null,
      weight: number(sourceWeights.language)
    },
    {
      name: "global",
      value: fallbackGlobal,
      weight: number(sourceWeights.global)
    }
  ];

  const validSources = sources.filter(source =>
    source.value !== null &&
    source.weight > 0
  );

  if (!validSources.length) {
    return fallbackGlobal;
  }

  const totalWeight = validSources.reduce(
    (sum, source) => sum + source.weight,
    0
  );

  if (totalWeight <= 0) {
    return fallbackGlobal;
  }

  const blended = validSources.reduce(
    (sum, source) =>
      sum + source.value * (source.weight / totalWeight),
    0
  );

  return clamp(blended, 0.15, 1);
}

/**
 * Garantit :
 *
 * NM >= EX >= GD >= LP >= PL >= PO
 */
function enforceMonotonicRatios(ratios = {}) {
  const ordered = {
    NM: 1
  };

  let previousRatio = 1;

  CONDITIONS
    .filter(condition => condition !== "NM")
    .forEach(condition => {
      const currentRatio = safeRatio(
        ratios[condition],
        previousRatio
      );

      ordered[condition] = Math.min(
        previousRatio,
        currentRatio
      );

      previousRatio = ordered[condition];
    });

  return ordered;
}

/**
 * Produit les ratios finaux de tous les états.
 */
function buildHierarchicalRatios({
  cardRatios = {},
  editionRatios = {},
  languageRatios = {},
  globalRatios = DEFAULT_GLOBAL_RATIOS,
  evidence = {}
} = {}) {
  const weights = getBayesianWeights(evidence);

  const rawRatios = {
    NM: 1
  };

  CONDITIONS
    .filter(condition => condition !== "NM")
    .forEach(condition => {
      rawRatios[condition] = blendHierarchicalRatio({
        condition,
        cardRatio: cardRatios?.[condition],
        editionRatio: editionRatios?.[condition],
        languageRatio: languageRatios?.[condition],
        globalRatio: globalRatios?.[condition],
        weights
      });
    });

  return {
    ratios: enforceMonotonicRatios(rawRatios),
    weights
  };
}


function calculateObservationReliability({
  observedPrice,
  expectedPrice,
  sampleSize = 1
} = {}) {
  const observed = number(observedPrice);
  const expected = number(expectedPrice);

  if (observed <= 0 || expected <= 0) {
    return 0.25;
  }

  const ratio = observed / expected;
  const deviation = Math.abs(Math.log(ratio));

  let reliability;

  if (deviation <= Math.log(1.15)) {
    reliability = 1.00;
  } else if (deviation <= Math.log(1.35)) {
    reliability = 0.80;
  } else if (deviation <= Math.log(1.75)) {
    reliability = 0.50;
  } else if (deviation <= Math.log(2.50)) {
    reliability = 0.25;
  } else {
    reliability = 0.10;
  }

  if (sampleSize >= 3) {
    reliability = Math.min(1, reliability + 0.10);
  }

  return reliability;
}

function weightedMedian(entries = []) {
  const clean = entries
    .map(entry => ({
      value: number(entry.value),
      weight: Math.max(0, number(entry.weight))
    }))
    .filter(entry => entry.value > 0 && entry.weight > 0)
    .sort((a, b) => a.value - b.value);

  if (!clean.length) {
    return 0;
  }

  const totalWeight = clean.reduce(
    (sum, entry) => sum + entry.weight,
    0
  );

  let cumulativeWeight = 0;

  for (const entry of clean) {
    cumulativeWeight += entry.weight;

    if (cumulativeWeight >= totalWeight / 2) {
      return entry.value;
    }
  }

  return clean[clean.length - 1].value;
}
/**
 * Confiance du modèle, séparée du prix.
 *
 * L'ancre marché donne une base de confiance.
 * Les données propres à la carte ont le plus d'influence.
 */
function calculateBayesianConfidence({
  hasAnchor = false,
  cardObservationDays = 0,
  cardObservationRows = 0,
  editionObservationRows = 0,
  languageObservationRows = 0,
  globalObservationRows = 0,
  usesExternalReference = false,
  referenceFound = true
} = {}) {
  let confidence = hasAnchor ? 35 : 10;

  confidence += Math.min(number(cardObservationDays) * 6, 24);
  confidence += Math.min(number(cardObservationRows) * 2, 16);
  confidence += Math.min(number(editionObservationRows) / 10, 8);
  confidence += Math.min(number(languageObservationRows) / 20, 5);
  confidence += Math.min(number(globalObservationRows) / 100, 5);

  if (usesExternalReference && referenceFound) {
    confidence += 5;
  }

  if (usesExternalReference && !referenceFound) {
    confidence -= 15;
  }

  const observationDayCap =
  cardObservationDays <= 0
    ? 45
    : cardObservationDays === 1
      ? 60
      : cardObservationDays === 2
        ? 70
        : cardObservationDays <= 5
          ? 80
          : 95;

confidence = Math.min(confidence, observationDayCap);

  return Math.round(clamp(confidence, 10, 95));
}

module.exports = {
  CONDITIONS,
  DEFAULT_GLOBAL_RATIOS,
  evidenceStrength,
  getBayesianWeights,
  blendHierarchicalRatio,
  enforceMonotonicRatios,
  buildHierarchicalRatios,
  calculateObservationReliability,
  weightedMedian,
  calculateBayesianConfidence
};