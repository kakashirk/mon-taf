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

async function search() {
  const from = document.getElementById('from').value.trim();
  const to = document.getElementById('to').value.trim();
  if (!from || !to) {
    showError("Indique une gare de départ et d'arrivée.");
    return;
  }
  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.innerHTML = '<div style="width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:spin 0.7s linear infinite"></div> Recherche…';
  setResults('<div class="state-box"><div class="spinner"></div><div class="state-text">RECHERCHE EN COURS…</div></div>');
  try {
    const url = `https://transport.opendata.ch/v1/connections?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=8`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Erreur réseau');
    const data = await res.json();
    if (!data.connections || data.connections.length === 0) {
      setResults('<div class="state-box"><div class="state-icon">🔍</div><div class="state-text">AUCUN TRAIN TROUVÉ<br>VÉRIFIE LES NOMS DE GARES</div></div>');
      return;
    }
    renderResults(data);
  } catch (e) {
    showError('Erreur de connexion. Vérifie ton réseau et réessaie.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>🔍</span> Chercher les trains';
  }
}

function renderResults(data) {
  const conns = data.connections;
  let html = `<div class="results-header"><span class="results-title">PROCHAINS TRAINS</span><span class="results-count">${conns.length} résultats</span></div>`;
  conns.forEach((conn, i) => {
    const dep = conn.from;
    const arr = conn.to;
    const depTime = fmtTime(dep.departure);
    const arrTime = fmtTime(arr.arrival);
    const dur = fmtDuration(dep.departure, arr.arrival);
    const mins = minutesUntil(dep.departure);
    const transfers = conn.transfers || 0;
    const platform = dep.platform;
    const isNext = i === 0;
    let trLabel, trClass;
    if (transfers === 0) { trLabel = '● Direct'; trClass = 'direct'; }
    else if (transfers === 1) { trLabel = `↻ ${transfers} changement`; trClass = 'one-change'; }
    else { trLabel = `↻ ${transfers} changements`; trClass = 'multi-change'; }
    let countdown = '';
    if (mins <= 0) countdown = '<span style="color:var(--red)">MAINTENANT</span>';
    else if (mins < 60) countdown = `dans ${mins} min`;
    const sections = conn.sections || [];
    let legsHtml = '';
    sections.forEach(sec => {
      if (!sec.journey) return;
      const lineId = sec.journey.name || sec.journey.category || '?';
      const legDep = fmtTime(sec.departure?.departure);
      const legArr = fmtTime(sec.arrival?.arrival);
      const legFrom = sec.departure?.station?.name || '';
      const legTo = sec.arrival?.station?.name || '';
      legsHtml += `<div class="leg-row"><div class="leg-times">${legDep}<br>${legArr}</div><div class="leg-body"><span class="leg-line-badge">${lineId}</span><div class="leg-stations">${legFrom} → ${legTo}</div></div></div>`;
    });
    const hasLegs = legsHtml.length > 0;
    const legId = `legs-${i}`;
    html += `
      <div class="train-card ${isNext ? 'next' : ''}" style="animation-delay:${i * 0.06}s">
        ${isNext ? '<div class="next-badge">PROCHAIN</div>' : ''}
        <div class="card-top">
          <div class="times">
            <div class="dep-time">${depTime}</div>
            <div class="arrow">→</div>
            <div class="arr-time">${arrTime}</div>
          </div>
          <div class="right-col">
            <div class="duration-pill">${dur}</div>
            ${countdown ? `<div class="countdown">${countdown}</div>` : ''}
          </div>
        </div>
        <div class="card-bottom">
          <span class="transfer-info ${trClass}">${trLabel}</span>
          ${platform ? `<span class="platform-info">Voie <span class="platform-num">${platform}</span></span>` : ''}
          ${hasLegs ? `<button class="detail-toggle" onclick="toggleLegs('${legId}', this)">DÉTAILS ↓</button>` : ''}
        </div>
        ${hasLegs ? `<div class="legs-detail" id="${legId}">${legsHtml}</div>` : ''}
      </div>`;
  });
  setResults(html);
}

function toggleLegs(id, btn) {
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
