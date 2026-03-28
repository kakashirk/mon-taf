if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function tick() {
  const now = new Date();
  document.getElementById('clock').textContent =
    now.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', hour12: false });
}
tick();
setInterval(tick, 10000);

['from', 'to'].forEach(id =>
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') search();
  })
);

function setGpsStatus(visible, text = '') {
  const bar = document.getElementById('gpsStatusBar');
  const txt = document.getElementById('gpsStatusText');
  const btn = document.getElementById('gpsBtn');
  if (visible) {
    bar.classList.add('visible');
    txt.textContent = text;
    btn.classList.add('spinning');
  } else {
    bar.classList.remove('visible');
    btn.classList.remove('spinning');
    btn.classList.add('active');
  }
}

async function locateMe() {
  if (!navigator.geolocation) {
    showError("La géolocalisation n'est pas disponible sur ce navigateur.");
    return;
  }
  setGpsStatus(true, 'LOCALISATION EN COURS…');
  document.getElementById('from').placeholder = 'Localisation…';
  document.getElementById('from').value = '';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      setGpsStatus(true, 'RECHERCHE GARE LA PLUS PROCHE…');
      try {
        const r = await fetch(
          `https://transport.opendata.ch/v1/locations?x=${longitude}&y=${latitude}&type=station`
        );
        const d = await r.json();
        if (d.stations && d.stations.length > 0) {
          document.getElementById('from').value = d.stations[0].name;
          setGpsStatus(false);
          search();
        } else {
          setGpsStatus(false);
          document.getElementById('from').placeholder = 'Gare de départ…';
          showError('Aucune gare trouvée près de toi. Saisis-la manuellement.');
        }
      } catch (e) {
        setGpsStatus(false);
        showError('Impossible de trouver la gare la plus proche.');
      }
    },
    (err) => {
      setGpsStatus(false);
      document.getElementById('from').placeholder = 'Gare de départ…';
      if (err.code === 1) {
        showError('Autorise la localisation dans ton navigateur, puis réessaie.');
      } else {
        showError('Impossible de te localiser. Saisis ta gare manuellement.');
      }
    },
    { timeout: 12000, maximumAge: 120000 }
  );
}

window.addEventListener('load', () => { locateMe(); });

function fmtTime(dt) {
  if (!dt) return '--:--';
  return new Date(dt).toLocaleTimeString('fr-CH', {
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

function fmtDuration(depDt, arrDt) {
  const mins = Math.round((new Date(arrDt) - new Date(depDt)) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

function minutesUntil(dt) {
  return Math.round((new Date(dt) - Date.now()) / 60000);
}

// Retourne le label du moyen de transport + numéro
function getTransportLabel(journey) {
  if (!journey) return null;
  const cat = (journey.category || '').toUpperCase();
  const name = (journey.name || '').trim();
  const num = (journey.number || '').toString().trim();

  // Bus
  if (cat === 'BUS' || cat === 'B') {
    return { label: `Bus ${name || num}`, color: '#f0a500', icon: '🚌' };
  }
  // Types de trains
  if (cat === 'IC') return { label: `IC ${num}`, color: '#e8002d', icon: '🚄' };
  if (cat === 'IR') return { label: `IR ${num}`, color: '#e8002d', icon: '🚄' };
  if (cat === 'RE') return { label: `RE ${num}`, color: '#58a6ff', icon: '🚆' };
  if (cat === 'R')  return { label: `R ${num}`, color: '#3fb950', icon: '🚆' };
  if (cat === 'S')  return { label: `S${num}`, color: '#a371f7', icon: '🚇' };
  if (cat === 'EC') return { label: `EC ${num}`, color: '#e8002d', icon: '🚄' };
  if (cat === 'ICE') return { label: `ICE ${num}`, color: '#e8002d', icon: '🚄' };
  // Fallback
  return { label: name || cat, color: '#7d8590', icon: '🚋' };
}

// Recherche en 2 étapes : départ → Chavornay, puis Chavornay → destination
async function search() {
  const from = document.getElementById('from').value.trim();
  const to   = document.getElementById('to').value.trim();
  if (!from || !to) {
    showError("Indique une gare de départ et d'arrivée.");
    return;
  }

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.innerHTML = '<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Recherche…';
  setResults('<div class="state-box"><div class="spinner"></div><div class="state-text">RECHERCHE VIA CHAVORNAY…</div></div>');

  try {
    // Segment 1 : from → Chavornay
    const url1 = `https://transport.opendata.ch/v1/connections?from=${encodeURIComponent(from)}&to=Chavornay&limit=6`;
    // Segment 2 : Chavornay → destination
    const url2 = `https://transport.opendata.ch/v1/connections?from=Chavornay&to=${encodeURIComponent(to)}&limit=10`;

    const [res1, res2] = await Promise.all([fetch(url1), fetch(url2)]);
    const [data1, data2] = await Promise.all([res1.json(), res2.json()]);

    if (!data1.connections?.length || !data2.connections?.length) {
      setResults('<div class="state-box"><div class="state-icon">🔍</div><div class="state-text">AUCUN TRAIN TROUVÉ<br>VÉRIFIE LES NOMS DE GARES</div></div>');
      return;
    }

    // Combine : pour chaque train vers Chavornay, trouve le prochain train depuis Chavornay
    const combined = [];
    for (const leg1 of data1.connections) {
      const chavArrival = new Date(leg1.to.arrival);
      // Trouve le premier train depuis Chavornay après l'arrivée (+ 2 min de marge)
      const leg2 = data2.connections.find(c => {
        const chavDep = new Date(c.from.departure);
        return chavDep >= new Date(chavArrival.getTime() + 2 * 60000);
      });
      if (leg2) {
        combined.push({ leg1, leg2 });
        if (combined.length >= 5) break;
      }
    }

    if (combined.length === 0) {
      setResults('<div class="state-box"><div class="state-icon">🔍</div><div class="state-text">AUCUNE CORRESPONDANCE TROUVÉE<br>VIA CHAVORNAY</div></div>');
      return;
    }

    renderCombined(combined, from, to);

  } catch (e) {
    showError('Erreur de connexion. Vérifie ton réseau et réessaie.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> Chercher les trains';
  }
}

function renderCombined(combined, from, to) {
  let html = `
    <div class="results-header">
      <span class="results-title">VIA CHAVORNAY</span>
      <span class="results-count">${combined.length} trajets</span>
    </div>
  `;

  combined.forEach(({ leg1, leg2 }, i) => {
    const isNext = i === 0;
    const depTime  = fmtTime(leg1.from.departure);
    const arrTime  = fmtTime(leg2.to.arrival);
    const totalDur = fmtDuration(leg1.from.departure, leg2.to.arrival);
    const mins     = minutesUntil(leg1.from.departure);

    let countdown = '';
    if (mins <= 0) countdown = '<span style="color:var(--red)">MAINTENANT</span>';
    else if (mins < 60) countdown = `dans ${mins} min`;

    const cardId = `card-${i}`;
    const detailId = `detail-${i}`;

    // Génère les étapes détaillées des 2 segments
    const stepsHtml = buildSteps(leg1, leg2);

    html += `
      <div class="train-card ${isNext ? 'next' : ''}" style="animation-delay:${i * 0.07}s">
        ${isNext ? '<div class="next-badge">PROCHAIN</div>' : ''}
        <div class="card-top">
          <div class="times">
            <div class="dep-time">${depTime}</div>
            <div class="arrow">→</div>
            <div class="arr-time">${arrTime}</div>
          </div>
          <div class="right-col">
            <div class="duration-pill">${totalDur}</div>
            ${countdown ? `<div class="countdown">${countdown}</div>` : ''}
          </div>
        </div>

        <!-- Résumé des 2 segments -->
        <div class="segments-row">
          ${segmentBadge(leg1)} 
          <span class="seg-arrow">→</span>
          <span class="seg-station">Chavornay</span>
          <span class="seg-arrow">→</span>
          ${segmentBadge(leg2)}
        </div>

        <div class="card-bottom">
          <span style="font-family:var(--mono);font-size:11px;color:var(--muted)">
            ${fmtTime(leg1.to.arrival)} chgt Chavornay → ${fmtTime(leg2.from.departure)}
          </span>
          <button class="detail-toggle" onclick="toggleDetail('${detailId}', this)">DÉTAILS ↓</button>
        </div>

        <div class="legs-detail" id="${detailId}">
          ${stepsHtml}
        </div>
      </div>
    `;
  });

  setResults(html);
}

function segmentBadge(conn) {
  // Prend le premier journey du segment
  const sec = (conn.sections || []).find(s => s.journey);
  const t = sec ? getTransportLabel(sec.journey) : null;
  if (!t) return `<span class="seg-badge" style="background:#30363d;color:#7d8590">?</span>`;
  return `<span class="seg-badge" style="background:${t.color}22;color:${t.color};border-color:${t.color}44">${t.icon} ${t.label}</span>`;
}

function buildSteps(leg1, leg2) {
  let html = '';

  // Toutes les sections des 2 legs
  const allSections = [
    ...(leg1.sections || []),
    'CHAVORNAY', // séparateur visuel
    ...(leg2.sections || [])
  ];

  allSections.forEach(sec => {
    // Séparateur Chavornay
    if (sec === 'CHAVORNAY') {
      html += `
        <div class="chav-sep">
          <div class="chav-line"></div>
          <span class="chav-label">🔄 Correspondance Chavornay</span>
          <div class="chav-line"></div>
        </div>
      `;
      return;
    }

    if (!sec.journey && !sec.walk) return;

    const depTime = fmtTime(sec.departure?.departure);
    const arrTime = fmtTime(sec.arrival?.arrival);
    const dur = sec.departure?.departure && sec.arrival?.arrival
      ? fmtDuration(sec.departure.departure, sec.arrival.arrival) : '';
    const fromSt = sec.departure?.station?.name || '';
    const toSt   = sec.arrival?.station?.name || '';
    const platform = sec.departure?.platform;

    if (sec.walk) {
      html += `
        <div class="leg-row">
          <div class="leg-times">${depTime}<br>${arrTime}</div>
          <div class="leg-body">
            <span class="leg-line-badge" style="background:#30363d;color:#7d8590">🚶 À pied</span>
            <div class="leg-stations">${fromSt} → ${toSt}</div>
            ${dur ? `<div class="leg-dur">${dur}</div>` : ''}
          </div>
        </div>
      `;
      return;
    }

    const t = getTransportLabel(sec.journey);
    const badgeStyle = t ? `background:${t.color}22;color:${t.color};border-color:${t.color}44` : '';

    html += `
      <div class="leg-row">
        <div class="leg-times">${depTime}<br>${arrTime}</div>
        <div class="leg-body">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span class="leg-line-badge" style="${badgeStyle}">${t ? t.icon + ' ' + t.label : '?'}</span>
            ${platform ? `<span class="platform-tag">Voie ${platform}</span>` : ''}
            ${dur ? `<span class="dur-tag">${dur}</span>` : ''}
          </div>
          <div class="leg-stations">${fromSt} → ${toSt}</div>
        </div>
      </div>
    `;
  });

  return html;
}

function toggleDetail(id, btn) {
  const el = document.getElementById(id);
  el.classList.toggle('open');
  btn.textContent = el.classList.contains('open') ? 'FERMER ↑' : 'DÉTAILS ↓';
}

function setResults(html) {
  document.getElementById('results').innerHTML = html;
}

function showError(msg) {
  document.getElementById('results').innerHTML = `<div class="error-box">⚠️ ${msg}</div>`;
}
