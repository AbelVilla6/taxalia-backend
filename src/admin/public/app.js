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

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkSession() {
  const { ok } = await api('/me');
  if (ok) { await loadList(); show('list'); } else { show('login'); }
}

$('login-btn').addEventListener('click', async () => {
  msg($('login-msg'), '', '');
  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Entrando…';
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;
  const { ok, data } = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  $('login-btn').disabled = false;
  $('login-btn').textContent = 'Entrar';
  if (ok) {
    $('login-pass').value = '';
    await loadList();
    show('list');
  } else {
    msg($('login-msg'),
      data?.error === 'INVALID_CREDENTIALS'
        ? 'Usuario o contraseña incorrectos.'
        : 'No se pudo iniciar sesión.',
      'err');
  }
});

$('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-pass').focus(); });
$('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });

$('logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  show('login');
});

// ── List ──────────────────────────────────────────────────────────────────────
async function loadList() {
  const { data } = await api('/posts');
  const body = $('list-body');
  body.innerHTML = '';
  const posts = data?.posts ?? [];
  if (posts.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:2rem">Sin artículos todavía</td></tr>';
    return;
  }
  for (const p of posts) {
    const tr = document.createElement('tr');

    const titleCell = document.createElement('td');
    titleCell.style.fontWeight = '600';
    titleCell.textContent = p.title;

    const langCell = document.createElement('td');
    const langPill = document.createElement('span');
    langPill.className = p.lang === 'en' ? 'pill en' : 'pill';
    langPill.textContent = p.lang.toUpperCase();
    langCell.appendChild(langPill);

    const statusCell = document.createElement('td');
    const statusPill = document.createElement('span');
    statusPill.className = p.draft ? 'pill draft' : 'pill';
    statusPill.textContent = p.draft ? 'Borrador' : 'Publicado';
    statusCell.appendChild(statusPill);

    const dateCell = document.createElement('td');
    dateCell.style.color = 'var(--muted)';
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
    deleteBtn.style.fontSize = '0.8rem';
    deleteBtn.style.padding = '0.35rem 0.75rem';

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

// ── WYSIWYG Editor (Toast UI) ─────────────────────────────────────────────────
let editor = null;

function makeSvgBtn(title, svgPath, clickHandler) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = title;
  btn.className = 'tui-media-btn';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
  btn.addEventListener('click', clickHandler);
  return btn;
}

function initEditor() {
  if (editor) {
    editor.destroy();
    editor = null;
  }

  const mount = $('editor-mount');
  mount.innerHTML = '';

  // Custom toolbar elements
  const btnFigure = makeSvgBtn(
    'Insertar figura (imagen + pie de foto)',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    () => { uploadTarget = 'figure'; $('file-picker').accept = 'image/jpeg,image/png,image/webp,image/gif'; $('file-picker').click(); }
  );

  const btnVideo = makeSvgBtn(
    'Subir vídeo (MP4/WebM)',
    '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    () => { uploadTarget = 'video'; $('file-picker').accept = 'video/mp4,video/webm'; $('file-picker').click(); }
  );

  const btnYoutube = makeSvgBtn(
    'Insertar vídeo de YouTube',
    '<path d="M22.54 6.42A2.78 2.78 0 0 0 20.6 4.47C18.88 4 12 4 12 4s-6.88 0-8.6.47A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.4 19.53C5.12 20 12 20 12 20s6.88 0 8.6-.47a2.78 2.78 0 0 0 1.94-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>',
    insertYouTube
  );

  editor = new toastui.Editor({
    el: mount,
    height: '560px',
    initialEditType: 'wysiwyg',
    previewStyle: 'tab',
    usageStatistics: false,
    toolbarItems: [
      ['heading', 'bold', 'italic', 'strike'],
      ['hr', 'quote'],
      ['ul', 'ol', 'task'],
      ['table', 'image', 'link'],
      ['code', 'codeblock'],
      [{ el: btnFigure }, { el: btnVideo }, { el: btnYoutube }],
    ],
    hooks: {
      addImageBlobHook: async (blob, callback) => {
        try {
          const url = await uploadFile(blob);
          callback(url, blob.name ?? 'imagen');
          msg($('editor-msg'), 'Imagen subida: ' + url, 'ok');
        } catch (err) {
          msg($('editor-msg'), 'No se pudo subir la imagen: ' + err.message, 'err');
        }
      },
    },
  });
}

// ── Write / Preview tabs ──────────────────────────────────────────────────────
const tabWrite   = $('tab-write');
const tabPreview = $('tab-preview');
const previewPane = $('editor-preview-pane');

tabWrite.addEventListener('click', () => {
  tabWrite.classList.add('active');
  tabPreview.classList.remove('active');
  $('editor-mount').hidden = false;
  previewPane.hidden = true;
});

tabPreview.addEventListener('click', async () => {
  tabPreview.classList.add('active');
  tabWrite.classList.remove('active');
  $('editor-mount').hidden = true;
  previewPane.hidden = false;
  previewPane.className = 'editor-preview-pane is-loading';
  previewPane.textContent = 'Cargando vista previa…';

  const markdown = editor ? editor.getMarkdown() : '';
  const { data } = await api('/preview', { method: 'POST', body: JSON.stringify({ markdown }) });
  const html = data?.html ?? '';

  previewPane.className = 'editor-preview-pane';
  if (html) {
    previewPane.innerHTML = `<div class="blog-post-detail__body">${html}</div>`;
  } else {
    previewPane.innerHTML = '<p style="color:var(--muted);font-style:italic">Sin contenido todavía…</p>';
  }
});

// ── File picker & upload targets ─────────────────────────────────────────────
let uploadTarget = null; // 'hero' | 'figure' | 'video'

$('hero-upload').addEventListener('click', () => {
  uploadTarget = 'hero';
  $('file-picker').accept = 'image/jpeg,image/png,image/webp,image/gif';
  $('file-picker').click();
});

$('file-picker').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  let url;
  try {
    url = await uploadFile(file);
  } catch (err) {
    return msg($('editor-msg'), 'No se pudo subir el archivo: ' + err.message, 'err');
  }

  if (uploadTarget === 'hero') {
    $('f-heroImage').value = url;
    msg($('editor-msg'), 'Imagen de portada subida: ' + url, 'ok');
    return;
  }

  if (!editor) return;

  if (uploadTarget === 'figure') {
    editor.insertText(
      `\n<figure class="blog-media blog-media--wide">\n  <img src="${url}" alt="" loading="lazy">\n  <figcaption>Escribe aquí el pie de foto</figcaption>\n</figure>\n`
    );
  } else if (uploadTarget === 'video') {
    editor.insertText(
      `\n<figure class="blog-media blog-media--wide">\n  <video controls preload="metadata" class="blog-media-video">\n    <source src="${url}" type="${file.type}">\n  </video>\n  <figcaption>Escribe aquí el pie del vídeo</figcaption>\n</figure>\n`
    );
  }

  msg($('editor-msg'), 'Archivo subido: ' + url, 'ok');
});

function insertYouTube() {
  const input = window.prompt('URL de YouTube (ej: https://youtu.be/xxxxx o https://www.youtube.com/watch?v=xxxxx):');
  if (!input) return;
  const id = ytId(input);
  if (!id) {
    msg($('editor-msg'), 'No se pudo identificar el ID del vídeo de YouTube.', 'err');
    return;
  }
  const embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
  editor.insertText(
    `\n<figure class="blog-media blog-media--wide">\n  <div class="blog-media-embed">\n    <iframe src="${embedUrl}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n  </div>\n  <figcaption>Vídeo de YouTube</figcaption>\n</figure>\n`
  );
}

function ytId(input) {
  const m = String(input).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function fillForm(p) {
  $('f-id').value       = p?.id ?? '';
  $('f-title').value    = p?.title ?? '';
  $('f-slug').value     = p?.slug ?? '';
  $('f-lang').value     = p?.lang ?? 'es';
  $('f-tkey').value     = p?.translationKey ?? '';
  $('f-description').value = p?.description ?? '';
  $('f-author').value   = p?.author ?? 'Taxalia';
  $('f-tags').value     = (p?.tags ?? []).join(', ');
  $('f-pubDate').value  = (p?.pubDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  $('f-updatedDate').value = p?.updatedDate ? p.updatedDate.slice(0, 10) : '';
  $('f-heroImage').value = p?.heroImage ?? '';
  $('f-heroAlt').value  = p?.heroAlt ?? '';
  $('f-draft').checked  = !!p?.draft;

  if (editor) {
    editor.setMarkdown(p?.bodyMd ?? '');
  }
}

function collectForm() {
  const tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  return {
    title: $('f-title').value.trim(),
    slug: $('f-slug').value.trim(),
    lang: $('f-lang').value,
    translationKey: $('f-tkey').value.trim() || $('f-slug').value.trim(),
    description: $('f-description').value.trim(),
    author: $('f-author').value.trim() || 'Taxalia',
    tags,
    pubDate: $('f-pubDate').value,
    updatedDate: $('f-updatedDate').value || null,
    heroImage: $('f-heroImage').value.trim() || null,
    heroAlt: $('f-heroAlt').value.trim() || null,
    draft: $('f-draft').checked,
    bodyMd: editor ? editor.getMarkdown() : '',
  };
}

// ── Editor open / save / delete ───────────────────────────────────────────────
async function openEditor(id) {
  msg($('editor-msg'), '', '');
  // Reset tabs to Write
  tabWrite.classList.add('active');
  tabPreview.classList.remove('active');
  $('editor-mount').hidden = false;
  previewPane.hidden = true;
  previewPane.innerHTML = '';
  initEditor();

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
}

$('save-btn').addEventListener('click', async () => {
  msg($('editor-msg'), '', '');
  const payload = collectForm();
  if (!payload.title || !payload.slug || !payload.pubDate) {
    return msg($('editor-msg'), 'Título, slug y fecha de publicación son obligatorios.', 'err');
  }

  $('save-btn').disabled = true;
  $('save-btn').textContent = 'Guardando…';

  const id = $('f-id').value;
  const { ok, status, data } = id
    ? await api('/posts/' + id, { method: 'PUT', body: JSON.stringify(payload) })
    : await api('/posts', { method: 'POST', body: JSON.stringify(payload) });

  $('save-btn').disabled = false;
  $('save-btn').textContent = 'Guardar artículo';

  if (ok) {
    await loadList();
    show('list');
  } else if (status === 409) {
    msg($('editor-msg'), 'Ya existe un artículo con ese slug en ese idioma.', 'err');
  } else {
    msg($('editor-msg'), 'No se pudo guardar (' + (data?.error ?? status) + ').', 'err');
  }
});

$('delete-btn').addEventListener('click', () => deletePost(Number($('f-id').value)));

async function deletePost(id) {
  if (!id || !confirm('¿Eliminar este artículo? Esta acción no se puede deshacer.')) return;
  const { ok } = await api('/posts/' + id, { method: 'DELETE' });
  if (ok) { await loadList(); show('list'); }
}

// ── Auto-slug from title ──────────────────────────────────────────────────────
$('f-title').addEventListener('input', () => {
  if ($('f-id').value) return; // don't overwrite on edit
  const slug = $('f-title').value
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  $('f-slug').value = slug;
  if (!$('f-tkey').value) $('f-tkey').value = slug;
});

// ── Boot ──────────────────────────────────────────────────────────────────────
checkSession();
