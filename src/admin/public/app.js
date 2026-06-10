'use strict';

const API = '/api/admin';
const $ = (id) => document.getElementById(id);

const views = { login: $('view-login'), list: $('view-list'), editor: $('view-editor') };
function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
  $('logout').hidden = name === 'login';
}
function msg(el, text, kind) {
  el.innerHTML = text ? `<div class="msg ${kind}">${text}</div>` : '';
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(API + '/media', { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? String(res.status));
  return data.url;
}

// ---- Auth ----
async function checkSession() {
  const { ok } = await api('/me');
  if (ok) { await loadList(); show('list'); } else { show('login'); }
}

$('login-btn').addEventListener('click', async () => {
  msg($('login-msg'), '', '');
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;
  const { ok, data } = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (ok) { $('login-pass').value = ''; await loadList(); show('list'); }
  else msg($('login-msg'), data?.error === 'INVALID_CREDENTIALS' ? 'Usuario o contraseña incorrectos.' : 'No se pudo iniciar sesión.', 'err');
});

$('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  show('login');
});

// ---- List ----
async function loadList() {
  const { data } = await api('/posts');
  const body = $('list-body');
  body.innerHTML = '';
  for (const p of data?.posts ?? []) {
    const tr = document.createElement('tr');
    const titleCell = document.createElement('td');
    titleCell.textContent = p.title;

    const langCell = document.createElement('td');
    const langPill = document.createElement('span');
    langPill.className = 'pill';
    langPill.textContent = p.lang;
    langCell.appendChild(langPill);

    const statusCell = document.createElement('td');
    const statusPill = document.createElement('span');
    statusPill.className = p.draft ? 'pill draft' : 'pill';
    statusPill.textContent = p.draft ? 'Borrador' : 'Publicado';
    statusCell.appendChild(statusPill);

    const dateCell = document.createElement('td');
    dateCell.textContent = p.pubDate;

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'ghost';
    editBtn.type = 'button';
    editBtn.dataset.edit = String(p.id);
    editBtn.textContent = 'Editar';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.type = 'button';
    deleteBtn.dataset.del = String(p.id);
    deleteBtn.textContent = 'Borrar';

    actionsCell.append(editBtn, deleteBtn);
    tr.append(titleCell, langCell, statusCell, dateCell, actionsCell);
    body.appendChild(tr);
  }
  body.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEditor(Number(b.dataset.edit))));
  body.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => deletePost(Number(b.dataset.del))));
}

$('new-btn').addEventListener('click', () => openEditor(null));
$('back-btn').addEventListener('click', async () => { await loadList(); show('list'); });

// ---- Markdown editor + live preview ----
const bodyEditor = $('f-bodyMd');
const frame = $('preview-frame');

function fillForm(p) {
  $('f-id').value = p?.id ?? '';
  $('f-title').value = p?.title ?? '';
  $('f-slug').value = p?.slug ?? '';
  $('f-lang').value = p?.lang ?? 'es';
  $('f-tkey').value = p?.translationGroupId ?? '';
  $('f-description').value = p?.description ?? '';
  $('f-author').value = p?.author ?? 'Taxalia';
  $('f-tags').value = (p?.tags ?? []).join(', ');
  $('f-pubDate').value = (p?.pubDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  $('f-updatedDate').value = p?.updatedDate ? p.updatedDate.slice(0, 10) : '';
  $('f-heroImage').value = p?.heroImage ?? '';
  $('f-heroAlt').value = p?.heroAlt ?? '';
  $('f-draft').checked = !!p?.draft;
  bodyEditor.value = p?.bodyMd ?? '';
}

async function openEditor(id) {
  msg($('editor-msg'), '', '');
  if (id == null) {
    $('editor-title').textContent = 'Nuevo artículo';
    $('delete-btn').hidden = true;
    fillForm(null);
  } else {
    const { ok, data } = await api('/posts/' + id);
    if (!ok) return;
    $('editor-title').textContent = 'Editar artículo';
    $('delete-btn').hidden = false;
    fillForm(data.post);
  }
  show('editor');
  renderPreview();
}

function collectForm() {
  const tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  return {
    title: $('f-title').value.trim(),
    slug: $('f-slug').value.trim(),
    lang: $('f-lang').value,
    translationGroupId: $('f-tkey').value.trim() || $('f-slug').value.trim(),
    description: $('f-description').value.trim(),
    author: $('f-author').value.trim() || 'Taxalia',
    tags,
    pubDate: $('f-pubDate').value,
    updatedDate: $('f-updatedDate').value || null,
    heroImage: $('f-heroImage').value.trim() || null,
    heroAlt: $('f-heroAlt').value.trim() || null,
    draft: $('f-draft').checked,
    bodyMd: bodyEditor.value,
  };
}

$('save-btn').addEventListener('click', async () => {
  msg($('editor-msg'), '', '');
  const payload = collectForm();
  if (!payload.title || !payload.slug || !payload.pubDate) {
    return msg($('editor-msg'), 'Título, slug y fecha de publicación son obligatorios.', 'err');
  }
  const id = $('f-id').value;
  const { ok, status, data } = id
    ? await api('/posts/' + id, { method: 'PUT', body: JSON.stringify(payload) })
    : await api('/posts', { method: 'POST', body: JSON.stringify(payload) });

  if (ok) { await loadList(); show('list'); }
  else if (status === 409) msg($('editor-msg'), 'Ya existe un artículo con ese slug en ese idioma.', 'err');
  else msg($('editor-msg'), 'No se pudo guardar (' + (data?.error ?? status) + ').', 'err');
});

$('delete-btn').addEventListener('click', () => deletePost(Number($('f-id').value)));

async function deletePost(id) {
  if (!id || !confirm('¿Eliminar este artículo? Esta acción no se puede deshacer.')) return;
  const { ok } = await api('/posts/' + id, { method: 'DELETE' });
  if (ok) { await loadList(); show('list'); }
}

// ---- Live site-accurate preview (rendered by the backend = published 1:1) ----
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 400);
}
async function renderPreview() {
  const { data } = await api('/preview', { method: 'POST', body: JSON.stringify({ markdown: bodyEditor.value }) });
  const html = data?.html || '<p class="preview-empty">Sin contenido todavía…</p>';
  frame.srcdoc =
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/admin/preview.css"></head>' +
    '<body><div class="blog-post-detail__body">' + html + '</div></body></html>';
}

bodyEditor.addEventListener('input', schedulePreview);

// ---- Multimedia blocks (inserted as HTML; shown in Markdown mode) ----
function insertHtmlBlock(snippet) {
  const start = bodyEditor.selectionStart ?? bodyEditor.value.length;
  const end = bodyEditor.selectionEnd ?? bodyEditor.value.length;
  bodyEditor.setRangeText('\n' + snippet + '\n', start, end, 'end');
  bodyEditor.focus();
  schedulePreview();
}

let uploadTarget = null; // 'hero' | 'wide' | 'right'

$('hero-upload').addEventListener('click', () => { uploadTarget = 'hero'; $('file-picker').click(); });


$('file-picker').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let url;
  try { url = await uploadFile(file); }
  catch (err) { return msg($('editor-msg'), 'No se pudo subir (' + err.message + ').', 'err'); }

  if (uploadTarget === 'hero') {
    $('f-heroImage').value = url;
  } else {
    const cls = uploadTarget === 'right' ? 'blog-media blog-media--right' : 'blog-media blog-media--wide';
    insertHtmlBlock(`<figure class="${cls}">\n  <img src="${url}" alt="" loading="lazy">\n  <figcaption></figcaption>\n</figure>`);
  }
  msg($('editor-msg'), 'Archivo subido: ' + url, 'ok');
});

function ytId(input) {
  const m = String(input).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
  return m ? m[1] : String(input).trim();
}

checkSession();
