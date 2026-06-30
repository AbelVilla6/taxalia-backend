'use strict';

const API = '/api/admin';
const $ = (id) => document.getElementById(id);

const views = {
  login: $('view-login'),
  password: $('view-password'),
  list: $('view-list'),
  editor: $('view-editor'),
};

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
async function enterPanel() {
  await loadList();
  show('list');
}

async function checkSession() {
  const { ok, data } = await api('/me');
  if (!ok) { show('login'); return; }
  if (data?.mustChangePassword) { show('password'); return; }
  await enterPanel();
}

$('login-btn').addEventListener('click', async () => {
  msg($('login-msg'), '', '');
  $('login-btn').disabled = true;
  $('login-btn').textContent = 'Entrando…';
  const username = $('login-user').value.trim();
  const password = $('login-pass').value;
  const { ok, data } = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (ok) {
    $('login-pass').value = '';
    if (data?.mustChangePassword) { show('password'); return; }
    await enterPanel();
  } else {
    msg(
      $('login-msg'),
      data?.error === 'INVALID_CREDENTIALS' ? 'Usuario o contraseña incorrectos.' : 'No se pudo iniciar sesión.',
      'err',
    );
  }
  $('login-btn').disabled = false;
  $('login-btn').textContent = 'Entrar';
});

$('password-btn').addEventListener('click', async () => {
  msg($('password-msg'), '', '');
  const currentPassword = $('pass-current').value;
  const newPassword = $('pass-new').value;
  const confirm = $('pass-confirm').value;
  if (newPassword.length < 8) {
    return msg($('password-msg'), 'La nueva contraseña debe tener al menos 8 caracteres.', 'err');
  }
  if (newPassword !== confirm) {
    return msg($('password-msg'), 'Las contraseñas no coinciden.', 'err');
  }
  const { ok, data } = await api('/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (ok) {
    $('pass-current').value = '';
    $('pass-new').value = '';
    $('pass-confirm').value = '';
    await enterPanel();
  } else {
    msg(
      $('password-msg'),
      data?.error === 'INVALID_CREDENTIALS'
        ? 'La contraseña actual no es correcta.'
        : 'No se pudo cambiar la contraseña.',
      'err',
    );
  }
});

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
$('back-btn').addEventListener('click', async () => {
  await saveActive({ silent: true });
  await loadList();
  show('list');
});

// ---- Bilingual editor state ----
const ed = {
  activeLang: 'es',
  ids: { es: null, en: null },
  forms: { es: null, en: null },
};

// ── WYSIWYG Editor (Toast UI) ─────────────────────────────────────────────────
let editor = null;
let previewFrame = null;
let previewTimer = null;
let uploadTarget = null; // 'hero' | 'figure' | 'video'

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

  const btnFigure = makeSvgBtn(
    'Insertar figura (imagen + pie de foto)',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    () => { uploadTarget = 'figure'; $('file-picker').accept = 'image/jpeg,image/png,image/webp,image/gif'; $('file-picker').click(); },
  );

  const btnVideo = makeSvgBtn(
    'Subir vídeo (MP4/WebM)',
    '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
    () => { uploadTarget = 'video'; $('file-picker').accept = 'video/mp4,video/webm'; $('file-picker').click(); },
  );

  const btnYoutube = makeSvgBtn(
    'Insertar vídeo de YouTube',
    '<path d="M22.54 6.42A2.78 2.78 0 0 0 20.6 4.47C18.88 4 12 4 12 4s-6.88 0-8.6.47A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.4 19.53C5.12 20 12 20 12 20s6.88 0 8.6-.47a2.78 2.78 0 0 0 1.94-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02"/>',
    insertYouTube,
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

  setupEditorTabs(mount);
  editor.on('change', schedulePreview);
}

// ── Write / Preview tabs (injected into the Toast UI toolbar) ────────────────
function setupEditorTabs(root) {
  const toolbar = root.querySelector('.toastui-editor-toolbar');
  const buttonsRow = root.querySelector('.toastui-editor-defaultUI-toolbar');
  const mainArea = root.querySelector('.toastui-editor-main');
  if (!toolbar || !buttonsRow || !mainArea) return;

  const container = document.createElement('div');
  container.className = 'taxalia-tab-container';

  const tabs = document.createElement('div');
  tabs.className = 'toastui-editor-tabs';

  const tabWrite = document.createElement('div');
  tabWrite.className = 'tab-item active';
  tabWrite.textContent = 'Escribir';

  const tabPreview = document.createElement('div');
  tabPreview.className = 'tab-item';
  tabPreview.textContent = 'Vista previa';

  tabs.append(tabWrite, tabPreview);
  container.appendChild(tabs);
  toolbar.insertBefore(container, toolbar.firstChild);

  const frame = document.createElement('iframe');
  frame.className = 'taxalia-preview-frame';
  frame.title = 'Vista previa del artículo';
  frame.hidden = true;
  mainArea.insertAdjacentElement('afterend', frame);
  previewFrame = frame;

  const showWrite = () => {
    tabWrite.classList.add('active');
    tabPreview.classList.remove('active');
    mainArea.style.display = '';
    frame.hidden = true;
    buttonsRow.classList.remove('is-preview-disabled');
  };

  const showPreview = async () => {
    tabPreview.classList.add('active');
    tabWrite.classList.remove('active');
    frame.style.height = mainArea.offsetHeight + 'px';
    mainArea.style.display = 'none';
    frame.hidden = false;
    buttonsRow.classList.add('is-preview-disabled');

    const markdown = editor ? editor.getMarkdown() : '';
    const { data } = await api('/preview', { method: 'POST', body: JSON.stringify({ markdown }) });
    const html = data?.html || '<p style="color:#93867d;font-style:italic">Sin contenido todavía…</p>';
    frame.srcdoc =
      '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="/admin/preview.css"></head>' +
      '<body><div class="blog-post-detail__body">' + html + '</div></body></html>';
  };

  tabWrite.addEventListener('click', showWrite);
  tabPreview.addEventListener('click', showPreview);

  editor.on('changeMode', (mode) => {
    container.style.display = mode === 'markdown' ? 'none' : '';
    showWrite();
  });
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 400);
}

function insertHtmlBlock(snippet) {
  if (!editor) return;
  editor.insertText('\n' + snippet + '\n');
  schedulePreview();
}

function insertYouTube() {
  const input = window.prompt('URL de YouTube (ej: https://youtu.be/xxxxx o https://www.youtube.com/watch?v=xxxxx):');
  if (!input) return;
  const id = ytId(input);
  if (!id) {
    msg($('editor-msg'), 'No se pudo identificar el ID del vídeo de YouTube.', 'err');
    return;
  }
  const embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
  insertHtmlBlock(
    `<figure class="blog-media blog-media--wide">\n  <div class="blog-media-embed">\n    <iframe src="${embedUrl}" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n  </div>\n  <figcaption>Vídeo de YouTube</figcaption>\n</figure>`,
  );
}

function ytId(input) {
  const m = String(input).match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/);
  return m ? m[1] : null;
}

// ── File picker & upload targets ─────────────────────────────────────────────
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
    uploadTarget = null;
    return;
  }

  if (!editor) return;
  if (uploadTarget === 'figure') {
    insertHtmlBlock(
      `<figure class="blog-media blog-media--wide">\n  <img src="${url}" alt="" loading="lazy">\n  <figcaption>Escribe aquí el pie de foto</figcaption>\n</figure>`,
    );
  } else if (uploadTarget === 'video') {
    insertHtmlBlock(
      `<figure class="blog-media blog-media--wide">\n  <video controls preload="metadata" class="blog-media-video">\n    <source src="${url}" type="${file.type}">\n  </video>\n  <figcaption>Escribe aquí el pie del vídeo</figcaption>\n</figure>`,
    );
  }

  uploadTarget = null;
  msg($('editor-msg'), 'Archivo subido: ' + url, 'ok');
});

// ── Form helpers ──────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(lang, base) {
  return {
    title: '',
    slug: '',
    lang,
    translationGroupId: base?.translationGroupId ?? '',
    description: '',
    author: base?.author ?? 'Taxalia',
    tags: [],
    pubDate: base?.pubDate ?? today(),
    updatedDate: base?.updatedDate ?? null,
    heroImage: base?.heroImage ?? null,
    heroAlt: null,
    draft: base?.draft ?? false,
    bodyMd: '',
    jsonLd: '',
  };
}

function formFromApi(p) {
  return {
    title: p.title,
    slug: p.slug,
    lang: p.lang,
    translationGroupId: p.translationGroupId ?? p.translationKey ?? '',
    description: p.description ?? '',
    author: p.author ?? 'Taxalia',
    tags: p.tags ?? [],
    pubDate: (p.pubDate ?? today()).slice(0, 10),
    updatedDate: p.updatedDate ? p.updatedDate.slice(0, 10) : null,
    heroImage: p.heroImage ?? null,
    heroAlt: p.heroAlt ?? null,
    draft: !!p.draft,
    bodyMd: p.bodyMd ?? '',
    jsonLd: p.jsonLd ?? '',
  };
}

function setAutosaveStatus(text) {
  $('autosave-status').textContent = text;
}

function renderTabs() {
  document.querySelectorAll('.lang-tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.lang === ed.activeLang);
  });
  $('delete-btn').hidden = ed.ids[ed.activeLang] == null;
  $('translate-btn').textContent =
    ed.activeLang === 'es' ? 'Traducir con IA → English' : 'Traducir con IA → Español';
}

function writeForm(f) {
  $('f-id').value = ed.ids[f.lang] ?? '';
  $('f-title').value = f.title;
  $('f-slug').value = f.slug;
  $('f-tkey').value = f.translationGroupId;
  $('f-description').value = f.description;
  $('f-author').value = f.author;
  $('f-tags').value = (f.tags ?? []).join(', ');
  $('f-pubDate').value = f.pubDate;
  $('f-updatedDate').value = f.updatedDate ?? '';
  $('f-heroImage').value = f.heroImage ?? '';
  $('f-heroAlt').value = f.heroAlt ?? '';
  $('f-draft').checked = !!f.draft;
  $('f-jsonld').value = f.jsonLd ?? '';
  if (editor) editor.setMarkdown(f.bodyMd ?? '');
}

function readForm() {
  const tags = $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  return {
    title: $('f-title').value.trim(),
    slug: $('f-slug').value.trim(),
    lang: ed.activeLang,
    translationGroupId: $('f-tkey').value.trim() || $('f-slug').value.trim(),
    description: $('f-description').value.trim(),
    author: $('f-author').value.trim() || 'Taxalia',
    tags,
    pubDate: $('f-pubDate').value,
    updatedDate: $('f-updatedDate').value || null,
    heroImage: $('f-heroImage').value.trim() || null,
    heroAlt: $('f-heroAlt').value.trim() || null,
    draft: $('f-draft').checked,
    bodyMd: editor ? editor.getMarkdown() : '',
    jsonLd: $('f-jsonld').value.trim(),
  };
}

// ── Editor open / save / delete ───────────────────────────────────────────────
async function openEditor(id) {
  msg($('editor-msg'), '', '');
  setAutosaveStatus('');
  ed.ids = { es: null, en: null };
  ed.forms = { es: null, en: null };
  initEditor();

  if (id == null) {
    $('editor-title').textContent = 'Nuevo artículo';
    ed.activeLang = 'es';
    ed.forms.es = emptyForm('es');
    ed.forms.en = emptyForm('en');
    writeForm(ed.forms.es);
  } else {
    const { ok, data } = await api('/posts/' + id);
    if (!ok) return;
    const post = data.post;
    const groupId = post.translationGroupId ?? post.translationKey ?? '';
    $('editor-title').textContent = 'Editar artículo';
    ed.activeLang = post.lang;
    ed.ids[post.lang] = post.id;
    ed.forms[post.lang] = formFromApi(post);

    const other = post.lang === 'es' ? 'en' : 'es';
    const list = await api('/posts');
    const sibling = (list.data?.posts ?? []).find(
      (p) => (p.translationGroupId ?? p.translationKey ?? '') === groupId && p.lang === other,
    );
    if (sibling) {
      const full = await api('/posts/' + sibling.id);
      if (full.ok) {
        ed.ids[other] = sibling.id;
        ed.forms[other] = formFromApi(full.data.post);
      }
    }
    if (!ed.forms[other]) ed.forms[other] = emptyForm(other, ed.forms[post.lang]);
    writeForm(ed.forms[post.lang]);
  }

  renderTabs();
  show('editor');
  renderPreview();
}

async function saveActive({ silent } = {}) {
  const f = readForm();
  ed.forms[ed.activeLang] = f;

  if (!f.title || !f.slug || !f.pubDate) {
    if (!silent) msg($('editor-msg'), 'Título, slug y fecha de publicación son obligatorios.', 'err');
    else if (f.title || f.slug || f.bodyMd) setAutosaveStatus(`${ed.activeLang}: sin guardar (faltan título/slug/fecha)`);
    return false;
  }
  if (f.jsonLd) {
    try {
      const parsed = JSON.parse(f.jsonLd);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    } catch {
      if (!silent) msg($('editor-msg'), 'El JSON-LD no es un objeto JSON válido.', 'err');
      else setAutosaveStatus(`${ed.activeLang}: sin guardar (JSON-LD inválido)`);
      return false;
    }
  }

  const payload = { ...f, jsonLd: f.jsonLd || null };
  const id = ed.ids[ed.activeLang];
  const { ok, status, data } = id
    ? await api('/posts/' + id, { method: 'PUT', body: JSON.stringify(payload) })
    : await api('/posts', { method: 'POST', body: JSON.stringify(payload) });

  if (ok) {
    if (!id && data?.id) ed.ids[ed.activeLang] = data.id;
    const time = new Date().toLocaleTimeString().slice(0, 5);
    setAutosaveStatus(`${ed.activeLang}: guardado ${time}`);
    await loadList();
    renderTabs();
    return true;
  }

  const text = status === 409
    ? 'Ya existe un artículo con ese slug en ese idioma.'
    : 'No se pudo guardar (' + (data?.error ?? status) + ').';
  if (!silent) msg($('editor-msg'), text, 'err');
  else setAutosaveStatus(`${ed.activeLang}: error al guardar`);
  return false;
}

async function switchLang(target) {
  if (target === ed.activeLang) return;
  await saveActive({ silent: true });

  const current = ed.forms[ed.activeLang];
  ed.activeLang = target;
  if (!ed.forms[target]) ed.forms[target] = emptyForm(target, current);
  if (!ed.forms[target].translationGroupId && current?.translationGroupId) {
    ed.forms[target].translationGroupId = current.translationGroupId;
  }
  writeForm(ed.forms[target]);
  renderTabs();
  renderPreview();
}

document.querySelectorAll('.lang-tab').forEach((tab) => {
  tab.addEventListener('click', () => switchLang(tab.dataset.lang));
});

$('save-btn').addEventListener('click', async () => {
  msg($('editor-msg'), '', '');
  const ok = await saveActive({ silent: false });
  if (ok) msg($('editor-msg'), 'Guardado.', 'ok');
});

$('delete-btn').addEventListener('click', () => deletePost(ed.ids[ed.activeLang]));

async function deletePost(id) {
  if (!id || !confirm('¿Eliminar este artículo? Esta acción no se puede deshacer.')) return;
  const { ok } = await api('/posts/' + id, { method: 'DELETE' });
  if (ok) { await loadList(); show('list'); }
}

// ---- Auto-match: parse a pasted document into form fields ----
function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function parseAutoMatch(raw) {
  let text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  const fields = {};
  let tags = null;
  let jsonLd = null;

  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const header = text.slice(3, end);
      text = text.slice(end + 4).replace(/^[^\S\n]*\n?/, '');

      let inTags = false;
      for (const line of header.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const bullet = t.match(/^[*-]\s+(.+)$/);
        if (inTags && bullet) {
          tags.push(bullet[1].trim());
          continue;
        }
        const kv = t.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!kv) continue;
        inTags = false;
        const key = kv[1].toLowerCase();
        const value = unquote(kv[2]);
        if (key === 'tags') {
          tags = [];
          inTags = true;
          const inline = value.replace(/^\[|\]$/g, '').trim();
          if (inline) tags.push(...inline.split(',').map((x) => unquote(x)).filter(Boolean));
        } else {
          fields[key] = value;
        }
      }
    }
  }

  const jsonLdSection = /(?:^|\n)(?:-{3,}\s*\n+)?#{1,6}[^\n]*json[\s-]?ld[^\n]*\n+```(?:json)?\s*\n([\s\S]*?)\n```\s*/i;
  const match = text.match(jsonLdSection);
  if (match) {
    try {
      jsonLd = JSON.stringify(JSON.parse(match[1]), null, 2);
      text = text.replace(match[0], '\n');
    } catch {
      // Keep invalid JSON-LD in the body.
    }
  }

  text = text.replace(/^\s*-{3,}\s*\n/, '').replace(/\n-{3,}\s*$/, '').trim();
  return { fields, tags, jsonLd, body: text };
}

$('process-btn').addEventListener('click', () => {
  msg($('editor-msg'), '', '');
  const raw = editor ? editor.getMarkdown() : '';
  const { fields, tags, jsonLd, body } = parseAutoMatch(raw);

  if (!body && !Object.keys(fields).length && !jsonLd) {
    return msg($('editor-msg'), 'No hay nada que procesar: pega el documento en el campo de contenido.', 'err');
  }

  if (fields.title) $('f-title').value = fields.title;
  if (fields.description) $('f-description').value = fields.description;
  if (fields.slug) {
    $('f-slug').value = fields.slug;
    if (!$('f-tkey').value.trim()) $('f-tkey').value = fields.slug;
  }
  if (fields.pubdate || fields.date) $('f-pubDate').value = (fields.pubdate || fields.date).slice(0, 10);
  if (fields.updateddate) $('f-updatedDate').value = fields.updateddate.slice(0, 10);
  if (fields.author) $('f-author').value = fields.author;
  if (fields.draft) $('f-draft').checked = fields.draft === 'true';
  if (tags && tags.length) $('f-tags').value = tags.join(', ');
  if (jsonLd) $('f-jsonld').value = jsonLd;
  if (editor) editor.setMarkdown(body);

  const declaredLang = (fields.language || fields.lang || '').toLowerCase();
  if (declaredLang && declaredLang !== ed.activeLang) {
    msg($('editor-msg'), `El texto declara idioma «${declaredLang}» pero estás en la pestaña «${ed.activeLang}». Cambia de pestaña si corresponde.`, 'err');
  } else {
    msg($('editor-msg'), 'Texto procesado: campos rellenados' + (jsonLd ? ' y JSON-LD extraído.' : '.'), 'ok');
  }

  ed.forms[ed.activeLang] = { ...(ed.forms[ed.activeLang] ?? emptyForm(ed.activeLang)), ...readForm() };
  renderPreview();
});

// ---- AI translation via the backend Ollama skill ----
$('translate-btn').addEventListener('click', async () => {
  msg($('editor-msg'), '', '');
  const f = readForm();
  ed.forms[ed.activeLang] = f;
  if (!f.title || !f.bodyMd) {
    return msg($('editor-msg'), 'Necesitas al menos título y contenido para traducir.', 'err');
  }

  const target = ed.activeLang === 'es' ? 'en' : 'es';
  const btn = $('translate-btn');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Traduciendo…';

  try {
    const { ok, status, data } = await api('/translate', {
      method: 'POST',
      body: JSON.stringify({
        post: {
          title: f.title,
          slug: f.slug,
          lang: ed.activeLang,
          description: f.description,
          bodyMd: f.bodyMd,
          tags: f.tags,
          jsonLd: f.jsonLd || null,
        },
        targetLang: target,
      }),
    });
    if (!ok) {
      const reason = status === 503
        ? 'La traducción no está disponible (Ollama no configurado).'
        : 'No se pudo traducir (' + (data?.error ?? status) + ').';
      return msg($('editor-msg'), reason, 'err');
    }

    const t = data.post;
    ed.forms[target] = {
      ...(ed.forms[target] ?? emptyForm(target, f)),
      title: t.title,
      slug: t.slug,
      lang: target,
      translationGroupId: f.translationGroupId,
      description: t.description ?? '',
      tags: t.tags ?? f.tags,
      bodyMd: t.bodyMd ?? '',
      jsonLd: t.jsonLd ?? '',
      author: f.author,
      pubDate: f.pubDate,
      updatedDate: f.updatedDate,
      heroImage: f.heroImage,
      draft: f.draft,
    };
    await switchLang(target);
    msg($('editor-msg'), 'Traducción lista. Revísala y guarda.', 'ok');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    renderTabs();
  }
});

// ---- Live site-accurate preview (rendered by the backend = published 1:1) ----
async function renderPreview() {
  if (!previewFrame) return;
  const markdown = editor ? editor.getMarkdown() : '';
  const { data } = await api('/preview', { method: 'POST', body: JSON.stringify({ markdown }) });
  const html = data?.html || '<p class="preview-empty">Sin contenido todavía…</p>';
  previewFrame.srcdoc =
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<link rel="stylesheet" href="/admin/preview.css"></head>' +
    '<body><div class="blog-post-detail__body">' + html + '</div></body></html>';
}

$('f-title').addEventListener('input', () => {
  if ($('f-id').value) return;
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
