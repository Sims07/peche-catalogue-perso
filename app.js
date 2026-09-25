// Carnet de pêche — logique de l'application
// Les données (JSON) sont lues/écrites directement dans le dépôt GitHub via
// l'API Git Data (blobs/trees/commits), ce qui évite la limite de 1 Mo de
// l'API "contents" simple et permet d'accumuler des photos sans problème.
// Le jeton GitHub n'est jamais stocké ailleurs que dans le localStorage
// de ce navigateur : personne d'autre ne peut l'utiliser pour pousser des données.

const CONFIG_KEY = 'cdp_config';
const API = 'https://api.github.com';

let config = null;
let catches = [];
let currentTreeCommitSha = null; // commit sha the in-memory data was read from
let editingId = null; // id of the catch currently being edited, or null when adding
let pendingPhoto = null;
let pendingGPS = null; // {lat, lon} extracted from the current photo's EXIF, or null

// ---------- Config ----------

function loadConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function ghHeaders() {
  return {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

// ---------- Base64 helpers (UTF-8 safe) ----------

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

// ---------- GitHub sync (Git Data API) ----------

async function ghGet(path) {
  const res = await fetch(`${API}${path}`, { headers: ghHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub GET ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function ghPost(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub POST ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function ghPatch(path, payload) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub PATCH ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Load the current catches array from the repo (or [] if the file doesn't exist yet).
async function fetchCatches() {
  const { owner, repo, branch, path } = config;
  const ref = await ghGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const commitSha = ref.object.sha;
  currentTreeCommitSha = commitSha;

  const commit = await ghGet(`/repos/${owner}/${repo}/git/commits/${commitSha}`);
  const tree = await ghGet(`/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`);

  const entry = tree.tree.find(t => t.path === path);
  if (!entry) return []; // file not created yet

  const blob = await ghGet(`/repos/${owner}/${repo}/git/blobs/${entry.sha}`);
  const jsonStr = b64DecodeUnicode(blob.content.replace(/\n/g, ''));
  try {
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

// Commit a new version of the catches array to the repo.
async function commitCatches(newCatches, message) {
  const { owner, repo, branch, path } = config;

  // Always re-read the latest ref right before writing, to reduce race conditions.
  const ref = await ghGet(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const baseCommitSha = ref.object.sha;
  const baseCommit = await ghGet(`/repos/${owner}/${repo}/git/commits/${baseCommitSha}`);

  const content = JSON.stringify(newCatches, null, 2);
  const blob = await ghPost(`/repos/${owner}/${repo}/git/blobs`, {
    content: b64EncodeUnicode(content),
    encoding: 'base64'
  });

  const newTree = await ghPost(`/repos/${owner}/${repo}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }]
  });

  const newCommit = await ghPost(`/repos/${owner}/${repo}/git/commits`, {
    message,
    tree: newTree.sha,
    parents: [baseCommitSha]
  });

  await ghPatch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    sha: newCommit.sha
  });

  currentTreeCommitSha = newCommit.sha;
}

// ---------- GPS extraction from photo EXIF ----------

function dmsToDecimal(dms, ref) {
  if (!dms || dms.length < 3) return null;
  const [deg, min, sec] = dms;
  let decimal = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') decimal *= -1;
  return decimal;
}

function extractGPS(file) {
  return new Promise((resolve) => {
    if (typeof EXIF === 'undefined') { resolve(null); return; }
    try {
      EXIF.getData(file, function () {
        const lat = EXIF.getTag(this, 'GPSLatitude');
        const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
        const lon = EXIF.getTag(this, 'GPSLongitude');
        const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');
        if (!lat || !lon) { resolve(null); return; }
        const latitude = dmsToDecimal(lat, latRef);
        const longitude = dmsToDecimal(lon, lonRef);
        if (latitude == null || longitude == null) { resolve(null); return; }
        resolve({ lat: latitude, lon: longitude });
      });
    } catch {
      resolve(null);
    }
  });
}

// ---------- Image compression ----------

function compressImage(file, maxDim = 900, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Rendering ----------

function $(id) { return document.getElementById(id); }

function showError(msg) {
  const el = $('banner-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearError() {
  $('banner-error').classList.add('hidden');
}

function setLoading(on) {
  $('loading').classList.toggle('hidden', !on);
}

function renderStats() {
  const total = catches.length;
  const withWeight = catches.filter(c => c.poids_kg != null);
  const biggest = withWeight.length
    ? Math.max(...withWeight.map(c => c.poids_kg)).toFixed(2)
    : '—';
  const lastDate = catches.length
    ? [...catches].sort((a, b) => b.date.localeCompare(a.date))[0].date
    : '—';

  $('stats').innerHTML = `
    <div class="stat"><span class="stat__value">${total}</span><span class="stat__label">prise${total > 1 ? 's' : ''} au total</span></div>
    <div class="stat"><span class="stat__value">${biggest}${biggest !== '—' ? ' kg' : ''}</span><span class="stat__label">plus grosse prise</span></div>
    <div class="stat"><span class="stat__value">${lastDate}</span><span class="stat__label">dernière sortie</span></div>
  `;
}

function renderLieuFilter() {
  const select = $('filter-lieu');
  const current = select.value;
  const lieux = [...new Set(catches.map(c => c.lieu).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Tous les lieux</option>' +
    lieux.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  select.value = lieux.includes(current) ? current : '';
}

function renderEspeceFilter() {
  const select = $('filter-espece');
  const current = select.value;
  const especes = [...new Set(catches.map(c => c.espece).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Toutes les espèces</option>' +
    especes.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
  select.value = especes.includes(current) ? current : '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderLedger() {
  const lieuFilter = $('filter-lieu').value;
  const especeFilter = $('filter-espece').value;
  const list = $('ledger-list');
  const sorted = [...catches]
    .filter(c => !lieuFilter || c.lieu === lieuFilter)
    .filter(c => !especeFilter || c.espece === especeFilter)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));

  $('empty-state').classList.toggle('hidden', catches.length > 0);
  list.innerHTML = sorted.map(c => `
    <div class="entry" data-id="${c.id}">
      ${c.photo
        ? `<img class="entry__thumb" src="${c.photo}" alt="Photo de la prise">`
        : `<div class="entry__thumb entry__thumb--empty">🎣</div>`}
      <div class="entry__main">
        <div class="entry__title">${escapeHtml(c.espece || 'Poisson')}${c.poids_kg != null ? ` · ${c.poids_kg} kg` : ''}${c.taille_cm != null ? ` · ${c.taille_cm} cm` : ''}</div>
        <div class="entry__meta">${formatDate(c.date)}${c.lieu ? ' · ' + escapeHtml(c.lieu) : ''}${c.gps ? ' · 📍 GPS' : ''}</div>
        ${c.notes ? `<div class="entry__notes">${escapeHtml(c.notes)}</div>` : ''}
      </div>
      <div class="entry__actions">
        <button data-action="delete" title="Supprimer">✕</button>
      </div>
    </div>
  `).join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderFormSuggestions() {
  const especes = [...new Set(catches.map(c => c.espece).filter(Boolean))].sort();
  const lieux = [...new Set(catches.map(c => c.lieu).filter(Boolean))].sort();
  $('datalist-espece').innerHTML = especes.map(e => `<option value="${escapeHtml(e)}">`).join('');
  $('datalist-lieu').innerHTML = lieux.map(l => `<option value="${escapeHtml(l)}">`).join('');
}

function renderAll() {
  renderStats();
  renderLieuFilter();
  renderEspeceFilter();
  renderFormSuggestions();
  renderLedger();
  renderCatchesMap();
}

// ---------- Maps ----------

let formMap = null;
let formMarker = null;

function showFormMap(lat, lon) {
  const container = $('form-map');
  container.classList.remove('hidden');
  if (!formMap) {
    formMap = L.map(container).setView([lat, lon], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(formMap);
    formMarker = L.marker([lat, lon]).addTo(formMap);
  } else {
    formMap.setView([lat, lon], 13);
    formMarker.setLatLng([lat, lon]);
  }
  setTimeout(() => formMap.invalidateSize(), 50);
}

function hideFormMap() {
  $('form-map').classList.add('hidden');
}

let catchesMap = null;
let catchesMarkersLayer = null;

function renderCatchesMap() {
  const withGps = catches.filter(c => c.gps && c.gps.lat != null && c.gps.lon != null);
  $('map-empty').classList.toggle('hidden', withGps.length > 0);
  $('catches-map').classList.toggle('hidden', withGps.length === 0);
  if (withGps.length === 0) return;

  if (!catchesMap) {
    catchesMap = L.map('catches-map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(catchesMap);
    catchesMarkersLayer = L.layerGroup().addTo(catchesMap);
  }
  catchesMarkersLayer.clearLayers();

  const bounds = [];
  withGps.forEach(c => {
    const marker = L.marker([c.gps.lat, c.gps.lon]);
    marker.bindPopup(`<strong>${escapeHtml(c.espece || 'Poisson')}</strong><br>${formatDate(c.date)}${c.lieu ? ' · ' + escapeHtml(c.lieu) : ''}`);
    marker.addTo(catchesMarkersLayer);
    bounds.push([c.gps.lat, c.gps.lon]);
  });

  if (bounds.length === 1) {
    catchesMap.setView(bounds[0], 12);
  } else {
    catchesMap.fitBounds(bounds, { padding: [24, 24] });
  }
  setTimeout(() => catchesMap.invalidateSize(), 50);
}

// ---------- Edit mode ----------

function enterEditMode(entry) {
  editingId = entry.id;
  $('f-date').value = entry.date || '';
  $('f-espece').value = entry.espece || '';
  $('f-poids').value = entry.poids_kg != null ? entry.poids_kg : '';
  $('f-taille').value = entry.taille_cm != null ? entry.taille_cm : '';
  $('f-lieu').value = entry.lieu || '';
  $('f-notes').value = entry.notes || '';
  $('f-photo').value = '';
  pendingPhoto = entry.photo || null;
  pendingGPS = entry.gps || null;

  const wrap = $('photo-preview-wrap');
  wrap.innerHTML = '';
  if (pendingPhoto) {
    const img = document.createElement('img');
    img.src = pendingPhoto;
    wrap.appendChild(img);
  }

  const status = $('gps-status');
  if (pendingGPS) {
    status.textContent = `📍 Position GPS enregistrée : ${pendingGPS.lat.toFixed(5)}, ${pendingGPS.lon.toFixed(5)}`;
    showFormMap(pendingGPS.lat, pendingGPS.lon);
  } else {
    status.textContent = pendingPhoto ? "Aucune position GPS pour cette photo." : '';
    hideFormMap();
  }

  $('entry-form-title').textContent = 'Modifier la prise';
  $('edit-hint').classList.remove('hidden');
  $('btn-submit').textContent = 'Mettre à jour la prise';
  $('btn-cancel-edit').classList.remove('hidden');
  $('form-catch').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function exitEditMode() {
  editingId = null;
  pendingPhoto = null;
  pendingGPS = null;
  $('form-catch').reset();
  $('f-date').valueAsDate = new Date();
  $('f-espece').value = 'Carpe';
  $('photo-preview-wrap').innerHTML = '';
  $('gps-status').textContent = '';
  hideFormMap();
  $('entry-form-title').textContent = 'Nouvelle prise';
  $('edit-hint').classList.add('hidden');
  $('btn-submit').textContent = 'Enregistrer la prise';
  $('btn-cancel-edit').classList.add('hidden');
}

$('btn-cancel-edit').addEventListener('click', exitEditMode);

// ---------- App flow ----------

async function init() {
  config = loadConfig();
  if (!config) {
    $('setup-screen').classList.remove('hidden');
    return;
  }
  $('main-screen').classList.remove('hidden');
  $('f-date').valueAsDate = new Date();
  await reload();
}

async function reload() {
  clearError();
  setLoading(true);
  try {
    catches = await fetchCatches();
    renderAll();
  } catch (err) {
    console.error(err);
    showError("Impossible de lire les données sur GitHub. Vérifie la configuration (⚙) et le jeton. Détail : " + err.message);
  } finally {
    setLoading(false);
  }
}

// Settings form
$('form-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    owner: $('cfg-owner').value.trim(),
    repo: $('cfg-repo').value.trim(),
    branch: $('cfg-branch').value.trim() || 'main',
    path: $('cfg-path').value.trim() || 'data/prises.json',
    token: $('cfg-token').value.trim()
  };
  saveConfig(cfg);
  config = cfg;
  $('setup-screen').classList.add('hidden');
  $('main-screen').classList.remove('hidden');
  $('f-date').valueAsDate = new Date();
  await reload();
});

$('btn-settings').addEventListener('click', () => {
  const cfg = config || {};
  $('cfg-owner').value = cfg.owner || '';
  $('cfg-repo').value = cfg.repo || '';
  $('cfg-branch').value = cfg.branch || 'main';
  $('cfg-path').value = cfg.path || 'data/prises.json';
  $('cfg-token').value = cfg.token || '';
  $('main-screen').classList.add('hidden');
  $('setup-screen').classList.remove('hidden');
});

// Photo preview
$('f-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const wrap = $('photo-preview-wrap');
  const status = $('gps-status');
  wrap.innerHTML = '';
  status.textContent = '';
  pendingGPS = null;
  hideFormMap();
  if (!file) { pendingPhoto = null; return; }
  try {
    pendingPhoto = await compressImage(file);
    const img = document.createElement('img');
    img.src = pendingPhoto;
    wrap.appendChild(img);

    pendingGPS = await extractGPS(file);
    if (pendingGPS) {
      status.textContent = `📍 Position GPS détectée : ${pendingGPS.lat.toFixed(5)}, ${pendingGPS.lon.toFixed(5)}`;
      showFormMap(pendingGPS.lat, pendingGPS.lon);
    } else {
      status.textContent = "Aucune position GPS trouvée dans cette photo.";
    }
  } catch (err) {
    showError("Impossible de traiter la photo : " + err.message);
  }
});

// Add or update a catch
$('form-catch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-submit');
  btn.disabled = true;
  clearError();

  const fields = {
    date: $('f-date').value,
    espece: $('f-espece').value.trim() || 'Carpe',
    poids_kg: $('f-poids').value ? parseFloat($('f-poids').value) : null,
    taille_cm: $('f-taille').value ? parseFloat($('f-taille').value) : null,
    lieu: $('f-lieu').value.trim(),
    notes: $('f-notes').value.trim(),
    photo: pendingPhoto,
    gps: pendingGPS
  };

  const isEdit = editingId !== null;

  try {
    setLoading(true);
    const latest = await fetchCatches(); // avoid overwriting concurrent changes
    let updated, message;

    if (isEdit) {
      const existing = latest.find(c => c.id === editingId);
      if (!existing) throw new Error("Cette prise n'existe plus (peut-être déjà supprimée ailleurs).");
      const updatedEntry = { ...existing, ...fields, updated_at: new Date().toISOString() };
      updated = latest.map(c => c.id === editingId ? updatedEntry : c);
      message = `Modification d'une prise du ${fields.date}`;
    } else {
      const newEntry = { id: crypto.randomUUID(), ...fields, created_at: new Date().toISOString() };
      updated = [...latest, newEntry];
      message = `Ajout d'une prise du ${fields.date}`;
    }

    await commitCatches(updated, message);
    catches = updated;
    renderAll();
    exitEditMode();
  } catch (err) {
    console.error(err);
    showError((isEdit ? "La mise à jour a échoué." : "L'enregistrement a échoué.") + " Réessaie dans un instant. Détail : " + err.message);
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
});

// ---------- Photo lightbox ----------

function openLightbox(src) {
  $('lightbox-img').src = src;
  $('lightbox-overlay').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox-overlay').classList.add('hidden');
  $('lightbox-img').src = '';
}
$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox-overlay') closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('lightbox-overlay').classList.contains('hidden')) closeLightbox();
});

// Click on a ledger row: view photo, delete (✕ button), or select for editing
$('ledger-list').addEventListener('click', async (e) => {
  const photoThumb = e.target.closest('img.entry__thumb');
  if (photoThumb) {
    openLightbox(photoThumb.src);
    return;
  }

  const entryEl = e.target.closest('.entry');
  if (!entryEl) return;
  const id = entryEl.dataset.id;
  const entry = catches.find(c => c.id === id);
  if (!entry) return;

  const deleteBtn = e.target.closest('button[data-action="delete"]');
  if (deleteBtn) {
    if (!confirm(`Supprimer la prise du ${formatDate(entry.date)} (${entry.espece || 'poisson'}) ?`)) return;
    try {
      setLoading(true);
      const latest = await fetchCatches();
      const updated = latest.filter(c => c.id !== id);
      await commitCatches(updated, `Suppression d'une prise du ${entry.date}`);
      catches = updated;
      if (editingId === id) exitEditMode();
      renderAll();
    } catch (err) {
      console.error(err);
      showError("La suppression a échoué. Détail : " + err.message);
    } finally {
      setLoading(false);
    }
    return;
  }

  enterEditMode(entry);
});

$('filter-lieu').addEventListener('change', renderLedger);
$('filter-espece').addEventListener('change', renderLedger);

// ---------- Export (print / save as PDF) ----------

$('btn-export').addEventListener('click', () => {
  $('exp-from').value = '';
  $('exp-to').value = '';
  $('export-overlay').classList.remove('hidden');
});
$('btn-export-cancel').addEventListener('click', () => {
  $('export-overlay').classList.add('hidden');
});

$('form-export').addEventListener('submit', (e) => {
  e.preventDefault();
  const from = $('exp-from').value;
  const to = $('exp-to').value;
  $('export-overlay').classList.add('hidden');
  generatePrintBook(from, to);
});

function generatePrintBook(from, to) {
  const filtered = catches
    .filter(c => (!from || c.date >= from) && (!to || c.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.created_at || '').localeCompare(b.created_at || ''));

  const periodLabel = (from || to)
    ? `Du ${from ? formatDate(from) : '…'} au ${to ? formatDate(to) : '…'}`
    : 'Toutes les prises';

  const withWeight = filtered.filter(c => c.poids_kg != null);
  const biggest = withWeight.length ? Math.max(...withWeight.map(c => c.poids_kg)).toFixed(2) : null;

  const runningHead = (right) => `
    <div class="print-running-head"><span>🎣 Carnet de pêche</span><span>${right}</span></div>
  `;

  const coverHtml = `
    <section class="print-page print-cover">
      ${runningHead(periodLabel)}
      <div class="print-cover__mark">🐟</div>
      <h1>Carnet de pêche</h1>
      <p class="print-period">${escapeHtml(periodLabel)}</p>
      <div class="print-cover__rule"></div>
      <p class="print-stats">${filtered.length} prise${filtered.length > 1 ? 's' : ''}${biggest ? ` · plus grosse prise : ${biggest} kg` : ''}</p>
    </section>
  `;

  const friezeHtml = `
    <section class="print-page print-frieze">
      ${runningHead('Frise chronologique')}
      <h2>En un coup d'œil</h2>
      <p class="print-frieze__intro">Toutes les prises de la période, dans l'ordre</p>
      <div class="print-frieze__grid">
        ${filtered.map(c => `
          <div class="print-frieze__item">
            ${c.photo
              ? `<img class="print-frieze__thumb" src="${c.photo}" alt="">`
              : `<div class="print-frieze__thumb--empty">🎣</div>`}
            <div class="print-frieze__date">${formatDate(c.date)}</div>
            <div class="print-frieze__espece">${escapeHtml(c.espece || '')}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  const entriesHtml = filtered.map((c, i) => `
    <section class="print-page print-entry">
      ${runningHead(`Prise n° ${i + 1} / ${filtered.length}`)}
      ${c.photo ? `<div class="print-entry__photo-wrap"><img class="print-entry__photo" src="${c.photo}" alt=""></div>` : ''}
      <h2 class="print-entry__title">${escapeHtml(c.espece || 'Poisson')}</h2>
      <table class="print-entry__table">
        <tr><td>Date</td><td>${formatDate(c.date)}</td></tr>
        ${c.poids_kg != null ? `<tr><td>Poids</td><td>${c.poids_kg} kg</td></tr>` : ''}
        ${c.taille_cm != null ? `<tr><td>Taille</td><td>${c.taille_cm} cm</td></tr>` : ''}
        ${c.lieu ? `<tr><td>Lieu</td><td>${escapeHtml(c.lieu)}</td></tr>` : ''}
        ${c.gps ? `<tr><td>Position</td><td>${c.gps.lat.toFixed(5)}, ${c.gps.lon.toFixed(5)}</td></tr>` : ''}
        ${c.notes ? `<tr><td>Notes</td><td>${escapeHtml(c.notes)}</td></tr>` : ''}
      </table>
    </section>
  `).join('');

  const emptyHtml = filtered.length === 0
    ? `<section class="print-page print-entry"><p>Aucune prise sur cette période.</p></section>`
    : '';

  $('print-book').innerHTML = coverHtml + (filtered.length ? friezeHtml : '') + entriesHtml + emptyHtml;
  setTimeout(() => window.print(), 150);
}

init();

// ---------- PWA: service worker registration ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Not critical: the app still works fully online without it.
    });
  });
}
