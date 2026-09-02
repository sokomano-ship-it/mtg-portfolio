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
    number(weights.sameEditionValue) +
    number(weights.sameLanguageValue) +
    number(weights.valuePeer) +
    number(weights.global);

  if (total <= 0) {
    return {
      card: 0,
      sameEditionValue: 0,
      sameLanguageValue: 0,
      valuePeer: 0,
      global: 1
    };
  }

  return {
    card:
      number(weights.card) / total,

    sameEditionValue:
      number(weights.sameEditionValue) / total,

    sameLanguageValue:
      number(weights.sameLanguageValue) / total,

    valuePeer:
      number(weights.valuePeer) / total,

    global:
      number(weights.global) / total
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
  cardEvidence = 0,
  sameEditionValueEvidence = 0,
  sameLanguageValueEvidence = 0,
  valuePeerEvidence = 0,
  globalEvidence = 0
} = {}) {

  /*
   * Les nombres ci-dessous sont des priors de régularisation,
   * pas des poids fixes.
   *
   * Les poids finaux restent entièrement dynamiques.
   */
  const cardStrength =
    evidenceStrength(cardEvidence, 3);

  const sameEditionValueStrength =
    evidenceStrength(
      sameEditionValueEvidence,
      5
    );

  const sameLanguageValueStrength =
    evidenceStrength(
      sameLanguageValueEvidence,
      8
    );

  const valuePeerStrength =
    evidenceStrength(
      valuePeerEvidence,
      12
    );

  const globalStrength =
    evidenceStrength(
      globalEvidence,
      100
    );

  let remaining = 1;

  const card =
    remaining * cardStrength;
  remaining -= card;

  const sameEditionValue =
    remaining * sameEditionValueStrength;
  remaining -= sameEditionValue;

  const sameLanguageValue =
    remaining * sameLanguageValueStrength;
  remaining -= sameLanguageValue;

  const valuePeer =
    remaining * valuePeerStrength;
  remaining -= valuePeer;

  /*
   * Le global reste le dernier filet de sécurité.
   * S'il existe peu de données globales, globalStrength
   * est conservé comme information de confiance,
   * mais le poids résiduel doit tout de même être attribué.
   */
  const global = remaining;

  return normalizeWeights({
    card,
    sameEditionValue,
    sameLanguageValue,
    valuePeer,
    global
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
  sameEditionValueRatio = null,
  sameLanguageValueRatio = null,
  valuePeerRatio = null,
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
    sameEditionValue: 0,
    sameLanguageValue: 0,
    valuePeer: 0,
    global: 1
  };

  const sources = [
    {
      name: "card",
      value:
        number(cardRatio) > 0
          ? safeRatio(
              cardRatio,
              fallbackGlobal
            )
          : null,
      weight:
        number(sourceWeights.card)
    },
    {
      name: "sameEditionValue",
      value:
        number(sameEditionValueRatio) > 0
          ? safeRatio(
              sameEditionValueRatio,
              fallbackGlobal
            )
          : null,
      weight:
        number(
          sourceWeights.sameEditionValue
        )
    },
    {
      name: "sameLanguageValue",
      value:
        number(sameLanguageValueRatio) > 0
          ? safeRatio(
              sameLanguageValueRatio,
              fallbackGlobal
            )
          : null,
      weight:
        number(
          sourceWeights.sameLanguageValue
        )
    },
    {
      name: "valuePeer",
      value:
        number(valuePeerRatio) > 0
          ? safeRatio(
              valuePeerRatio,
              fallbackGlobal
            )
          : null,
      weight:
        number(sourceWeights.valuePeer)
    },
    {
      name: "global",
      value: fallbackGlobal,
      weight:
        number(sourceWeights.global)
    }
  ];

  /*
   * Une source sans ratio utilisable ne doit pas
   * conserver artificiellement son poids.
   *
   * On renormalise donc uniquement les sources
   * réellement disponibles pour cette condition.
   */
  const availableSources =
    sources.filter(source =>
      source.value !== null &&
      source.value > 0 &&
      source.weight > 0
    );

  const availableWeight =
    availableSources.reduce(
      (sum, source) =>
        sum + source.weight,
      0
    );

  if (availableWeight <= 0) {
    return fallbackGlobal;
  }

  return availableSources.reduce(
    (sum, source) =>
      sum +
      source.value *
        (source.weight / availableWeight),
    0
  );
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
  sameEditionValueRatios = {},
  sameLanguageValueRatios = {},
  valuePeerRatios = {},
  globalRatios = DEFAULT_GLOBAL_RATIOS,
  evidence = {}
} = {}) {

  const rawRatios = {
    NM: 1
  };

  const weightsByCondition = {
    NM: {
      card: 1,
      sameEditionValue: 0,
      sameLanguageValue: 0,
      valuePeer: 0,
      global: 0
    }
  };

  CONDITIONS
    .filter(condition => condition !== "NM")
    .forEach(condition => {

      /*
       * L'évidence propre à la carte est spécifique
       * à chaque condition.
       *
       * Une paire NM/EX observée renforce EX,
       * sans renforcer artificiellement GD/LP/PL/PO.
       */
      const cardEvidence =
        number(
          evidence.cardEvidenceByCondition?.[
            condition
          ]
        );

      const sameEditionValueEvidence =
        number(
          evidence.sameEditionValueEvidenceByCondition?.[
            condition
          ]
        );

      const sameLanguageValueEvidence =
        number(
          evidence.sameLanguageValueEvidenceByCondition?.[
            condition
          ]
        );

      const valuePeerEvidence =
        number(
          evidence.valuePeerEvidenceByCondition?.[
            condition
          ]
        );

      const globalEvidence =
        number(
          evidence.globalEvidenceByCondition?.[
            condition
          ]
        );

      const weights =
        getBayesianWeights({
          cardEvidence,
          sameEditionValueEvidence,
          sameLanguageValueEvidence,
          valuePeerEvidence,
          globalEvidence
        });

      weightsByCondition[condition] =
        weights;

      rawRatios[condition] =
        blendHierarchicalRatio({
          condition,

          cardRatio:
            cardRatios?.[condition],

          sameEditionValueRatio:
            sameEditionValueRatios?.[
              condition
            ],

          sameLanguageValueRatio:
            sameLanguageValueRatios?.[
              condition
            ],

          valuePeerRatio:
            valuePeerRatios?.[condition],

          globalRatio:
            globalRatios?.[condition],

          weights
        });
    });

  return {
    ratios:
      enforceMonotonicRatios(rawRatios),

    /*
     * Nouveau format :
     * les poids peuvent différer selon EX/GD/LP/etc.
     */
    weightsByCondition
  };
}


function calculateObservationReliability({
  observedPrice,
  expectedPrice,
  sampleSize = 1
} = {}) {

  const observed =
    number(observedPrice);

  const expected =
    number(expectedPrice);

  if (
    observed <= 0 ||
    expected <= 0
  ) {
    return 0.10;
  }


  /*
   * 1. Cohérence avec le niveau attendu.
   *
   * Ceci mesure si l'observation est plausible,
   * pas encore si elle est statistiquement solide.
   */
  const ratio =
    observed / expected;

  const deviation =
    Math.abs(
      Math.log(ratio)
    );


  let consistency;

  if (
    deviation <= Math.log(1.15)
  ) {

    consistency = 1.00;

  } else if (
    deviation <= Math.log(1.35)
  ) {

    consistency = 0.80;

  } else if (
    deviation <= Math.log(1.75)
  ) {

    consistency = 0.50;

  } else if (
    deviation <= Math.log(2.50)
  ) {

    consistency = 0.25;

  } else {

    consistency = 0.10;

  }


  /*
   * 2. Force statistique.
   *
   * Un minimum observé pendant seulement
   * 1 ou 2 jours ne peut pas être considéré
   * comme parfaitement représentatif.
   *
   * n = 1  -> 25 %
   * n = 2  -> 40 %
   * n = 3  -> 50 %
   * n = 5  -> 62,5 %
   * n = 10 -> 76,9 %
   * n = 30 -> 90,9 %
   */
  const sampleStrength =
    sampleSize /
    (
      sampleSize + 3
    );


  /*
   * Fiabilité finale =
   * plausibilité × quantité d'information.
   */
  return clamp(
    consistency *
      sampleStrength,
    0.10,
    1
  );

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