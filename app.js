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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderLedger() {
  const filter = $('filter-lieu').value;
  const list = $('ledger-list');
  const sorted = [...catches]
    .filter(c => !filter || c.lieu === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || '').localeCompare(a.created_at || ''));

  $('empty-state').classList.toggle('hidden', catches.length > 0);
  list.innerHTML = sorted.map(c => `
    <div class="entry" data-id="${c.id}">
      ${c.photo
        ? `<img class="entry__thumb" src="${c.photo}" alt="Photo de la prise">`
        : `<div class="entry__thumb entry__thumb--empty">🎣</div>`}
      <div class="entry__main">
        <div class="entry__title">${escapeHtml(c.espece || 'Poisson')}${c.poids_kg != null ? ` · ${c.poids_kg} kg` : ''}${c.taille_cm != null ? ` · ${c.taille_cm} cm` : ''}</div>
        <div class="entry__meta">${formatDate(c.date)}${c.lieu ? ' · ' + escapeHtml(c.lieu) : ''}</div>
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

function renderAll() {
  renderStats();
  renderLieuFilter();
  renderLedger();
}

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
let pendingPhoto = null;
$('f-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const wrap = $('photo-preview-wrap');
  wrap.innerHTML = '';
  if (!file) { pendingPhoto = null; return; }
  try {
    pendingPhoto = await compressImage(file);
    const img = document.createElement('img');
    img.src = pendingPhoto;
    wrap.appendChild(img);
  } catch (err) {
    showError("Impossible de traiter la photo : " + err.message);
  }
});

// Add catch
$('form-catch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-submit');
  btn.disabled = true;
  clearError();

  const newEntry = {
    id: crypto.randomUUID(),
    date: $('f-date').value,
    espece: $('f-espece').value.trim() || 'Carpe',
    poids_kg: $('f-poids').value ? parseFloat($('f-poids').value) : null,
    taille_cm: $('f-taille').value ? parseFloat($('f-taille').value) : null,
    lieu: $('f-lieu').value.trim(),
    notes: $('f-notes').value.trim(),
    photo: pendingPhoto,
    created_at: new Date().toISOString()
  };

  try {
    setLoading(true);
    const latest = await fetchCatches(); // avoid overwriting concurrent changes
    const updated = [...latest, newEntry];
    await commitCatches(updated, `Ajout d'une prise du ${newEntry.date}`);
    catches = updated;
    renderAll();
    e.target.reset();
    $('f-date').valueAsDate = new Date();
    $('f-espece').value = 'Carpe';
    $('photo-preview-wrap').innerHTML = '';
    pendingPhoto = null;
  } catch (err) {
    console.error(err);
    showError("L'enregistrement a échoué. Réessaie dans un instant. Détail : " + err.message);
  } finally {
    btn.disabled = false;
    setLoading(false);
  }
});

// Delete catch
$('ledger-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="delete"]');
  if (!btn) return;
  const id = btn.closest('.entry').dataset.id;
  const entry = catches.find(c => c.id === id);
  if (!entry) return;
  if (!confirm(`Supprimer la prise du ${formatDate(entry.date)} (${entry.espece || 'poisson'}) ?`)) return;

  try {
    setLoading(true);
    const latest = await fetchCatches();
    const updated = latest.filter(c => c.id !== id);
    await commitCatches(updated, `Suppression d'une prise du ${entry.date}`);
    catches = updated;
    renderAll();
  } catch (err) {
    console.error(err);
    showError("La suppression a échoué. Détail : " + err.message);
  } finally {
    setLoading(false);
  }
});

$('filter-lieu').addEventListener('change', renderLedger);

init();
