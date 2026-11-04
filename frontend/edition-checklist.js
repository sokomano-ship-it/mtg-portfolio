(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const grades = ['NM','EX','GD','LP','PL','PO'];
  let dataset;
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = String(value ?? ''); return el; };
  function render() {
    const edition = dataset.editions.find(e => e.name === $('checklist-edition').value);
    if (!edition) return;
    const mode = $('checklist-mode').value;
    const query = $('checklist-search').value.toLocaleLowerCase('fr');
    const rows = edition.cards.filter(c => (mode === 'all' || (mode === 'owned' ? c.owned > 0 : c.owned === 0)) && `${c.name} ${c.variant} ${c.collectorNumber}`.toLocaleLowerCase('fr').includes(query));
    const total = edition.cards.length;
const collected = edition.cards.filter(c => c.owned > 0).length;
const ownedCopies = edition.cards.reduce((sum, c) => sum + c.owned, 0);

$('checklist-summary').replaceChildren(
  text('p',
    `${edition.name} — ${ownedCopies} exemplaires possédés · ` +
    `${collected} / ${total} impressions différentes ` +
    `(${total ? (100 * collected / total).toFixed(1) : 0} %) · ` +
    `${rows.length} lignes affichées`
  )
);    const progress = document.createElement('progress'); progress.className='checklist-progress'; progress.max=total||1; progress.value=collected; $('checklist-summary').append(progress);
    const warnings = $('checklist-warnings'); warnings.replaceChildren();
if (edition.unresolved.length) {
  const box = text(
    'div',
    `${edition.unresolved.length} exemplaire(s) restent à associer à une impression précise. Ces cartes ne sont pas incluses dans les compteurs ci-dessus.`
  );
  box.className = 'checklist-warning';
  warnings.append(box);
}    const body=$('checklist-body'); body.replaceChildren();
    const fragment=document.createDocumentFragment();
    for (const card of rows) {
      const tr=document.createElement('tr');
      const imageCell=document.createElement('td');
      if(card.imageUrl){const img=document.createElement('img'); img.src=card.imageUrl; img.alt=card.name; img.loading='lazy'; imageCell.append(img);} tr.append(imageCell);
      tr.append(text('td', card.name+(card.variant ? ` — ${card.variant}` : '')));
      tr.append(text('td', card.collectorNumber)); tr.append(text('td',card.owned));
      for (const grade of grades) tr.append(text('td',card.conditions[grade] || '–'));
      tr.append(text('td', grades.find(g => card.conditions[g]>0) || '–'));
      if(!card.owned) tr.className='checklist-muted'; fragment.append(tr);
    }
    body.append(fragment);
  }
  async function init(){
    try {
      const res=await fetch(`data/edition-checklist.json?v=${Date.now()}`,{cache:'no-store'});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      dataset=await res.json();
      const select=$('checklist-edition');
      for(const edition of dataset.editions){const option=document.createElement('option');option.value=edition.name;option.textContent=edition.name;select.append(option);}
      $('checklist-status').textContent=`Catalogue actualisé le ${new Date(dataset.generatedAt).toLocaleString('fr-FR')}`;
      if(dataset.warnings?.length){$('checklist-status').textContent+=' — Certaines éditions n’ont pas pu être chargées : '+dataset.warnings.join('; ');}
      for(const id of ['checklist-edition','checklist-mode','checklist-search']) $(id).addEventListener(id==='checklist-search'?'input':'change',render);
      render();
    } catch(err){$('checklist-status').textContent=`Catalogue indisponible (${err.message}). Le portefeuille principal reste accessible.`;}
  }
  document.addEventListener('DOMContentLoaded',init);
})();
