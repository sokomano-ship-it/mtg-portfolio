(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const grades = ['NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
  const sortState = { key: 'number', direction: 'asc' };
  let dataset;

  const text = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = String(value ?? '');
    return el;
  };
  const count = (card, grade) => Number(card.conditions?.[grade] || 0);
  const bestGrade = card => grades.find(grade => count(card, grade) > 0) || '';
  const normalize = value => String(value ?? '').toLocaleLowerCase('fr').trim();
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  const isToken = card => card.category === 'token';
  const isNormal = (card, editionName) => {
    if (isToken(card)) return false;
    if (editionName === 'Foreign Black Bordered' && String(card.collectorNumber ?? '').trim().toLowerCase() === '306a') return false;
    return card.category === 'normal' ||
      (card.category == null && /^\d+[a-d]?$/i.test(String(card.collectorNumber ?? '').trim()));
  };
  const priceOf = card => {
    const value = Number(card.indicativePriceEur);
    return card.indicativePriceEur != null && Number.isFinite(value) && value > 0 ? value : null;
  };

  function compareCards(a, b) {
    const key = sortState.key;
    let result = 0;
    if (key === 'name') {
      result = collator.compare(`${a.name} ${a.variant || ''}`, `${b.name} ${b.variant || ''}`);
    } else if (key === 'number') {
      result = collator.compare(String(a.collectorNumber ?? ''), String(b.collectorNumber ?? ''));
    } else if (key === 'price') {
      const pa = priceOf(a), pb = priceOf(b);
      // Unavailable prices always appear last, regardless of sort direction.
      if (pa === null || pb === null) {
        if (pa === null && pb === null) return collator.compare(String(a.collectorNumber ?? ''), String(b.collectorNumber ?? ''));
        return pa === null ? 1 : -1;
      }
      result = pa - pb;
    } else if (key === 'reserved') {
      const rank = card => card.reserved === true ? 0 : card.reserved === false ? 1 : 2;
      result = rank(a) - rank(b);
    } else if (key === 'best') {
      const rank = card => { const grade = bestGrade(card); return grade ? grades.indexOf(grade) : grades.length; };
      result = rank(a) - rank(b);
    } else {
      const value = card => key === 'owned' ? Number(card.owned || 0) : count(card, key);
      result = value(a) - value(b);
    }
    // Stable, predictable ordering for equal values.
    if (result === 0) result = collator.compare(String(a.collectorNumber ?? ''), String(b.collectorNumber ?? ''));
    return sortState.direction === 'asc' ? result : -result;
  }

  function render() {
    if (!dataset) return;
    const edition = dataset.editions.find(e => e.name === $('checklist-edition').value);
    if (!edition) return;
    const mode = $('checklist-mode').value;
    const categoryMode = $('checklist-category').value;
    const normalCard = card => isNormal(card, edition.name);
    const query = normalize($('checklist-search').value);
    const nameQuery = normalize($('checklist-filter-name').value);
    const numberQuery = normalize($('checklist-filter-number').value);
    const quantity = $('checklist-filter-owned').value;
    const gradeFilters = Object.fromEntries(grades.map(g => [g, $(`checklist-filter-${g}`).value]));
    const bestFilter = $('checklist-filter-best').value;
    const reservedFilter = $('checklist-filter-reserved').value;
    const minPrice = $('checklist-price-min').value === '' ? null : Number($('checklist-price-min').value);
    const maxPrice = $('checklist-price-max').value === '' ? null : Number($('checklist-price-max').value);

    const rows = edition.cards.filter(card => {
      const owned = Number(card.owned || 0);
      if (categoryMode === 'normal' && !normalCard(card)) return false;
      if (categoryMode === 'token' && !isToken(card)) return false;
      if (categoryMode === 'special' && (normalCard(card) || isToken(card))) return false;
      if (mode === 'owned' && owned <= 0) return false;
      if (mode === 'missing' && owned > 0) return false;
      if (query && !normalize(`${card.name} ${card.variant || ''} ${card.collectorNumber || ''}`).includes(query)) return false;
      if (nameQuery && !normalize(`${card.name} ${card.variant || ''}`).includes(nameQuery)) return false;
      if (numberQuery && !normalize(card.collectorNumber).includes(numberQuery)) return false;
      if (quantity !== 'all' && (quantity === '4+' ? owned < 4 : owned !== Number(quantity))) return false;
      if (grades.some(g => gradeFilters[g] === 'yes' && count(card, g) === 0 ||
                            gradeFilters[g] === 'no' && count(card, g) > 0)) return false;
      if (reservedFilter === 'yes' && card.reserved !== true) return false;
      if (reservedFilter === 'no' && card.reserved !== false) return false;
      if (reservedFilter === 'unknown' && typeof card.reserved === 'boolean') return false;
      const price = priceOf(card);
      if ((minPrice !== null || maxPrice !== null) && (price === null || (minPrice !== null && price < minPrice) || (maxPrice !== null && price > maxPrice))) return false;
      const best = bestGrade(card);
      if (bestFilter !== 'all' && (bestFilter === 'none' ? best !== '' : !best || grades.indexOf(best) > grades.indexOf(bestFilter))) return false;
      return true;
    }).sort(compareCards);

    const normal = edition.cards.filter(normalCard);
    const special = edition.cards.filter(card => !normalCard(card) && !isToken(card));
    const tokens = edition.cards.filter(isToken);
    const stats = cards => ({
      total: cards.length,
      collected: cards.filter(c => Number(c.owned || 0) > 0).length,
      copies: cards.reduce((sum, c) => sum + Number(c.owned || 0), 0)
    });
    const regularStats = stats(normal);
    const specialStats = stats(special);
    const tokenStats = stats(tokens);
    const summary = $('checklist-summary');
    const pct = value => `${value.total ? (100 * value.collected / value.total).toFixed(1).replace('.', ',') : '0'} %`;
    const overview = document.createElement('div');
    overview.className = 'checklist-edition-overview';
    const editionTitle = text('h3', edition.name);
    editionTitle.className = 'checklist-edition-title';
    const titleRow = document.createElement('div');
    titleRow.className = 'checklist-edition-title-row';
    // The catalogue already supplies the canonical Scryfall set code.
    const setCode = String(edition.code || '').toLowerCase();
    if (/^[a-z0-9]{2,8}$/.test(setCode)) {
      const symbol = document.createElement('img');
      symbol.className = 'checklist-edition-symbol';
      symbol.src = `https://svgs.scryfall.io/sets/${setCode}.svg`;
      symbol.alt = `Symbole officiel de l'édition ${edition.name}`;
      symbol.title = `${edition.name} (${setCode.toUpperCase()})`;
      symbol.loading = 'lazy';
      symbol.onerror = () => { symbol.hidden = true; };
      titleRow.append(symbol);
    }
    titleRow.append(editionTitle);
    overview.append(titleRow);
    const completion = document.createElement('div');
    completion.className = 'checklist-completion';
    const completionNumber = text('strong', `${pct(regularStats)}`);
    completionNumber.className = 'checklist-completion-number';
    completion.append(completionNumber);
    const completionDetails = document.createElement('div');
    completionDetails.className = 'checklist-completion-details';
    completionDetails.append(text('strong', `de l’édition complétée`));
    completionDetails.append(text('span', `${regularStats.collected} cartes différentes sur ${regularStats.total} · ${regularStats.copies} exemplaires au total`));
    completion.append(completionDetails);
    overview.append(completion);
    overview.append(Object.assign(text('p', `${rows.length} lignes affichées`), { className: 'checklist-edition-detail' }));
    summary.replaceChildren(overview);
    if (specialStats.total > 0) {
      const extra = text('p', `Spéciales / variantes : ${specialStats.collected} / ${specialStats.total} (${pct(specialStats)})`);
      extra.className = 'checklist-summary-extra';
      summary.append(extra);
    }
    if (tokenStats.total > 0) {
      const extra = text('p', `Tokens : ${tokenStats.collected} / ${tokenStats.total} (${pct(tokenStats)})`);
      extra.className = 'checklist-summary-extra';
      summary.append(extra);
    }
    // Répartition exclusive : chaque impression possédée est classée selon son meilleur état.
    // Le calcul porte sur les cartes normales de l'édition, sans compter les exemplaires multiples.
    const ownedNormal = normal.filter(card => Number(card.owned || 0) > 0);
    const gradeTotals = Object.fromEntries(grades.map(grade => [grade, 0]));
    let unknownGrade = 0;
    for (const card of ownedNormal) {
      const grade = bestGrade(card);
      if (grade) gradeTotals[grade] += 1;
      else unknownGrade += 1;
    }
    const breakdown = document.createElement('div');
    breakdown.className = 'checklist-grade-breakdown';
    const gradeHeading = text('h3', 'Meilleur état par carte');
    gradeHeading.className = 'checklist-grade-heading';
    breakdown.append(gradeHeading);
    const gradeItems = document.createElement('div');
    gradeItems.className = 'checklist-grade-items';
    for (const grade of grades) {
      const chip = document.createElement('span');
      chip.className = 'checklist-grade-chip';
      chip.dataset.grade = grade;
      const percentage = ownedNormal.length ? (100 * gradeTotals[grade] / ownedNormal.length) : 0;
      chip.append(text('span', grade));
      chip.append(text('b', `${percentage.toFixed(1).replace('.', ',')} %`));
      chip.title = `${gradeTotals[grade]} carte(s) sur ${ownedNormal.length} cartes normales possédées`;
      gradeItems.append(chip);
    }
    breakdown.append(gradeItems);
    const gradeCaption = text('p', 'Sur les cartes différentes possédées, chaque carte compte une seule fois, dans son meilleur état.');
    gradeCaption.className = 'checklist-grade-caption';
    breakdown.append(gradeCaption);
    if (unknownGrade) {
      breakdown.append(text('p', `État non renseigné : ${(100 * unknownGrade / ownedNormal.length).toFixed(1).replace('.', ',')} %`));
    }
    summary.append(breakdown);
    breakdown.title = 'Pourcentages sur les cartes normales possédées ; chaque carte est comptée une seule fois dans son meilleur état.';

    const progress = document.createElement('progress');
    progress.className = 'checklist-progress';
    progress.max = regularStats.total || 1;
    progress.value = regularStats.collected;
    summary.append(progress);

    const warnings = $('checklist-warnings');
    warnings.replaceChildren();
    if (edition.unresolved?.length) {
      const box = text('div',
        `${edition.unresolved.length} exemplaire(s) restent à associer à une impression précise. Ces cartes ne sont pas incluses dans les compteurs ci-dessus.`);
      box.className = 'checklist-warning';
      warnings.append(box);
    }

    document.querySelectorAll('.checklist-sort').forEach(button => {
      button.setAttribute('aria-sort', button.dataset.sort === sortState.key
        ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    });

    const fragment = document.createDocumentFragment();
    // Normal cards first; special printings are listed and counted separately.
    const groupedRows = [rows.filter(normalCard), rows.filter(card => !normalCard(card) && !isToken(card)), rows.filter(isToken)];
    for (const [index, group] of groupedRows.entries()) {
      if (!group.length) continue;
      const separator = document.createElement('tr');
      separator.className = 'checklist-group-heading';
      const cell = text('td', index === 0 ? `Cartes normales (${group.length})` : index === 1 ? `Cartes spéciales / variantes (${group.length})` : `Tokens (${group.length})`);
      cell.colSpan = 13;
      separator.append(cell);
      fragment.append(separator);
      for (const card of group) {
      const tr = document.createElement('tr');
      const imageCell = document.createElement('td');
      if (card.imageUrl) {
        const img = document.createElement('img');
        img.src = card.imageUrl;
        img.alt = card.name;
        img.loading = 'lazy';
        imageCell.append(img);
      }
      tr.append(imageCell);
      tr.append(text('td', card.name + (card.variant ? ` — ${card.variant}` : '')));
      tr.append(text('td', card.collectorNumber));
      const rlCell = text('td', card.reserved === true ? 'RL' : card.reserved === false ? '–' : '?');
      if (card.reserved === true) { rlCell.className = 'checklist-rl'; rlCell.title = 'Reserved List'; }
      else if (card.reserved == null) rlCell.title = 'Statut non disponible : régénérer le catalogue';
      if (card.reserved === true) {
        rlCell.replaceChildren(Object.assign(text('span', 'RL'), { className: 'checklist-rl-mark' }));
      }
      tr.append(rlCell);
      tr.append(text('td', card.owned));
      const bestCell = document.createElement('td');
      const best = bestGrade(card);
      if (best) {
        const mark = text('span', best);
        mark.className = 'checklist-best-mark';
        mark.dataset.grade = best;
        bestCell.append(mark);
      } else bestCell.textContent = '–';
      tr.append(bestCell);
      for (const grade of grades) {
        const gradeCell = document.createElement('td');
        const amount = count(card, grade);
        if (amount) {
          const mark = text('span', amount);
          mark.className = 'checklist-condition-count';
          mark.dataset.grade = grade;
          gradeCell.append(mark);
        } else gradeCell.textContent = '–';
        tr.append(gradeCell);
      }
      const price = priceOf(card);
      const priceCell = text('td', price === null ? '–' : euro.format(price));
      priceCell.className = 'checklist-price';
      priceCell.title = price === null ? 'Prix Scryfall indisponible pour cette impression' : 'Prix indicatif Scryfall, non ajusté à l’état';
      tr.append(priceCell);
      if (!Number(card.owned || 0)) tr.className = 'checklist-muted';
      fragment.append(tr);
      }
    }
    $('checklist-body').replaceChildren(fragment);
  }

  function resetFilters() {
    $('checklist-mode').value = 'all';
    $('checklist-category').value = 'all';
    $('checklist-search').value = '';
    $('checklist-price-min').value = '';
    $('checklist-price-max').value = '';
    for (const id of ['name', 'number']) $(`checklist-filter-${id}`).value = '';
    for (const id of ['owned', ...grades, 'reserved', 'best']) $(`checklist-filter-${id}`).value = 'all';
    sortState.key = 'number';
    sortState.direction = 'asc';
    render();
  }

  async function init() {
    try {
      const res = await fetch(`data/edition-checklist.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dataset = await res.json();
      const hasReserved = dataset.editions.some(e => e.cards.some(c => typeof c.reserved === 'boolean'));
      if (!hasReserved) {
        $('checklist-status').title = 'Régénérer edition-checklist.json pour obtenir les statuts Reserved List';
      }
      const select = $('checklist-edition');
      for (const edition of dataset.editions) {
        const option = document.createElement('option');
        option.value = edition.name;
        option.textContent = edition.name;
        select.append(option);
      }
      $('checklist-status').textContent = `Catalogue actualisé le ${new Date(dataset.generatedAt).toLocaleString('fr-FR')} · Prix indicatifs Scryfall (non ajustés à l’état)`;
      if (dataset.warnings?.length) {
        $('checklist-status').textContent += ' — Certaines éditions n’ont pas pu être chargées : ' + dataset.warnings.join('; ');
      }
      for (const id of ['checklist-edition', 'checklist-mode', 'checklist-category', 'checklist-search', 'checklist-filter-name', 'checklist-filter-number',
                        'checklist-filter-owned', ...grades.map(g => `checklist-filter-${g}`), 'checklist-filter-best', 'checklist-filter-reserved', 'checklist-price-min', 'checklist-price-max']) {
        $(id).addEventListener(['checklist-search', 'checklist-filter-name', 'checklist-filter-number', 'checklist-price-min', 'checklist-price-max'].includes(id) ? 'input' : 'change', render);
      }
      document.querySelectorAll('.checklist-sort').forEach(button => {
        button.addEventListener('click', () => {
          const key = button.dataset.sort;
          if (sortState.key === key) sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
          else { sortState.key = key; sortState.direction = 'asc'; }
          render();
        });
      });
      $('checklist-reset').addEventListener('click', resetFilters);
      render();
    } catch (err) {
      $('checklist-status').textContent = `Erreur de chargement ou d'initialisation (${err.message}). Le portefeuille principal reste accessible.`;
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
