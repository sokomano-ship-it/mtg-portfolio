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

    const total = edition.cards.length;
    const collected = edition.cards.filter(c => Number(c.owned || 0) > 0).length;
    const ownedCopies = edition.cards.reduce((sum, c) => sum + Number(c.owned || 0), 0);
    $('checklist-summary').replaceChildren(text('p',
      `${edition.name} — ${ownedCopies} exemplaires possédés · ` +
      `${collected} / ${total} impressions différentes ` +
      `(${total ? (100 * collected / total).toFixed(1) : 0} %) · ` +
      `${rows.length} lignes affichées`
    ));
    const progress = document.createElement('progress');
    progress.className = 'checklist-progress';
    progress.max = total || 1;
    progress.value = collected;
    $('checklist-summary').append(progress);

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
    for (const card of rows) {
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
      tr.append(text('td', card.owned));
      for (const grade of grades) tr.append(text('td', count(card, grade) || '–'));
      const rlCell = text('td', card.reserved === true ? 'RL' : card.reserved === false ? '–' : '?');
      if (card.reserved === true) { rlCell.className = 'checklist-rl'; rlCell.title = 'Reserved List'; }
      else if (card.reserved == null) rlCell.title = 'Statut non disponible : régénérer le catalogue';
      tr.append(rlCell);
      tr.append(text('td', bestGrade(card) || '–'));
      const price = priceOf(card);
      const priceCell = text('td', price === null ? '–' : euro.format(price));
      priceCell.className = 'checklist-price';
      priceCell.title = price === null ? 'Prix Scryfall indisponible pour cette impression' : 'Prix indicatif Scryfall, non ajusté à l’état';
      tr.append(priceCell);
      if (!Number(card.owned || 0)) tr.className = 'checklist-muted';
      fragment.append(tr);
    }
    $('checklist-body').replaceChildren(fragment);
  }

  function resetFilters() {
    $('checklist-mode').value = 'all';
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
      for (const id of ['checklist-edition', 'checklist-mode', 'checklist-search', 'checklist-filter-name', 'checklist-filter-number',
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
