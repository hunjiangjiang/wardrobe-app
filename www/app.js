'use strict';

/* ============================================================
   我的衣橱 · 数据存在手机本地（IndexedDB），不上传任何服务器
   ============================================================ */

const DB_NAME = 'wardrobe-db';
const DB_VER = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      ['categories', 'items', 'outfits'].forEach((n) => {
        if (!d.objectStoreNames.contains(n)) {
          d.createObjectStore(n, { keyPath: 'id' });
        }
      });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

const st = (n, mode = 'readonly') => db.transaction(n, mode).objectStore(n);

const dbAll = (n) => new Promise((res, rej) => {
  const q = st(n).getAll();
  q.onsuccess = () => res(q.result || []);
  q.onerror = () => rej(q.error);
});

const dbPut = (n, o) => new Promise((res, rej) => {
  const q = st(n, 'readwrite').put(o);
  q.onsuccess = () => res(o);
  q.onerror = () => rej(q.error);
});

const dbDel = (n, id) => new Promise((res, rej) => {
  const q = st(n, 'readwrite').delete(id);
  q.onsuccess = () => res();
  q.onerror = () => rej(q.error);
});

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= 状态 ================= */
let cats = [];
let items = [];
let outfits = [];

let curTab = 'items';
let filterCat = 'all';

const urlCache = new Map();

function itemUrl(it) {
  if (!it.image) return '';
  let u = urlCache.get(it.id);
  if (!u) { u = URL.createObjectURL(it.image); urlCache.set(it.id, u); }
  return u;
}

function dropUrl(id) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}

const catName = (id) => (cats.find((c) => c.id === id) || {}).name || '未分类';

/* ================= DOM 快捷方式 ================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ================= 图片压缩 ================= */
function readImage(file, maxSide = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const cw = Math.round(img.width * scale);
      const ch = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/* ================= 渲染：衣服 ================= */
function renderFilterBar() {
  const bar = $('#filterBar');
  const hasUncategorized = items.some((i) => !i.categoryId);
  const list = [{ id: 'all', name: `全部 (${items.length})` }]
    .concat(cats.map((c) => ({
      id: c.id,
      name: `${c.name} (${items.filter((i) => i.categoryId === c.id).length})`,
    })));
  if (hasUncategorized) {
    list.push({ id: 'none', name: `未分类 (${items.filter((i) => !i.categoryId).length})` });
  }

  bar.innerHTML = '';
  list.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'chip' + (filterCat === c.id ? ' active' : '');
    b.textContent = c.name;
    b.onclick = () => { filterCat = c.id; renderItems(); };
    bar.appendChild(b);
  });
}

function renderItems() {
  renderFilterBar();
  const grid = $('#itemGrid');
  grid.innerHTML = '';

  let list = items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (filterCat === 'none') list = list.filter((i) => !i.categoryId);
  else if (filterCat !== 'all') list = list.filter((i) => i.categoryId === filterCat);

  $('#emptyItems').hidden = items.length > 0;

  list.forEach((it) => {
    const card = document.createElement('div');
    card.className = 'card';

    const url = itemUrl(it);
    const imgHtml = url
      ? `<img class="thumb" src="${url}" alt="">`
      : `<div class="nophoto">👕</div>`;

    const tags = [];
    if (it.categoryId) tags.push(`<span class="tag">${esc(catName(it.categoryId))}</span>`);
    if (it.season) tags.push(`<span class="tag gray">${esc(it.season)}</span>`);

    card.innerHTML = `
      ${imgHtml}
      <div class="meta">
        <p class="name">${esc(it.name || '未命名')}</p>
        <div class="sub">${esc([it.color, it.note].filter(Boolean).join(' · ') || '—')}</div>
        <div class="tagline">${tags.join('')}</div>
      </div>`;
    card.onclick = () => openItemModal(it);
    grid.appendChild(card);
  });
}

/* ================= 渲染：分类 ================= */
function renderCats() {
  const ul = $('#catList');
  ul.innerHTML = '';
  $('#emptyCats').hidden = cats.length > 0;

  cats.forEach((c) => {
    const count = items.filter((i) => i.categoryId === c.id).length;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="cname">${esc(c.name)}</span>
      <span class="count">${count} 件</span>
      <button class="iconbtn" data-act="rename">改名</button>
      <button class="iconbtn del" data-act="del">删除</button>`;

    li.querySelector('[data-act="rename"]').onclick = async () => {
      const name = prompt('新的分类名称', c.name);
      if (!name || !name.trim()) return;
      c.name = name.trim();
      await dbPut('categories', c);
      await loadAll();
    };

    li.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm(`删除分类「${c.name}」？\n分类下的衣服会变成「未分类」，衣服本身不会删。`)) return;
      await dbDel('categories', c.id);
      for (const it of items.filter((i) => i.categoryId === c.id)) {
        it.categoryId = '';
        await dbPut('items', it);
      }
      await loadAll();
    };

    ul.appendChild(li);
  });
}

/* ================= 渲染：搭配 ================= */
function renderOutfits() {
  const grid = $('#outfitGrid');
  grid.innerHTML = '';
  $('#emptyOutfits').hidden = outfits.length > 0;

  outfits
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .forEach((o) => {
      const picked = (o.itemIds || [])
        .map((id) => items.find((i) => i.id === id))
        .filter(Boolean);

      const imgs = picked.slice(0, 3).map((it) => {
        const u = itemUrl(it);
        return u ? `<img src="${u}" alt="">` : '';
      }).join('');

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="collage ${picked.length === 1 ? 'one' : ''}">
          ${imgs || '<div class="nophoto">🧥</div>'}
        </div>
        <div class="meta">
          <p class="name">${esc(o.name || '未命名搭配')}</p>
          <div class="sub">${picked.length} 件单品</div>
        </div>`;
      card.onclick = () => openOutfitView(o);
      grid.appendChild(card);
    });
}

/* ================= 衣服弹窗 ================= */
let editingItem = null;
let pendingImage = undefined;   // undefined=未改, null=清空, Blob=新图

function fillCatSelect(select, selected) {
  select.innerHTML = '<option value="">未分类</option>' +
    cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  select.value = selected || '';
}

function openItemModal(it) {
  editingItem = it || null;
  pendingImage = undefined;

  $('#itemTitle').textContent = it ? '编辑衣服' : '添加衣服';
  $('#itemName').value = it ? (it.name || '') : '';
  $('#itemColor').value = it ? (it.color || '') : '';
  $('#itemSeason').value = it ? (it.season || '') : '';
  $('#itemNote').value = it ? (it.note || '') : '';
  fillCatSelect($('#itemCat'), it ? it.categoryId : (cats[0] ? cats[0].id : ''));

  const preview = $('#photoPreview');
  const hint = $('#photoHint');
  if (it && it.image) {
    preview.src = itemUrl(it);
    preview.hidden = false;
    hint.hidden = true;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
    hint.hidden = false;
    hint.textContent = '📷 拍照 / 选择照片';
  }

  $('#itemDelete').hidden = !it;
  $('#itemModal').hidden = false;
}

function closeItemModal() {
  $('#itemModal').hidden = true;
  editingItem = null;
  pendingImage = undefined;
  $('#photoInput').value = '';
}

/* ================= 搭配弹窗 ================= */
let pickedIds = new Set();

function openOutfitModal() {
  pickedIds = new Set();
  $('#outfitName').value = '';
  $('#outfitNote').value = '';

  const picker = $('#outfitPicker');
  picker.innerHTML = '';
  $('#pickerEmpty').hidden = items.length > 0;

  items.forEach((it) => {
    const u = itemUrl(it);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      ${u ? `<img class="thumb" src="${u}" alt="">` : '<div class="nophoto">👕</div>'}
      <div class="meta"><p class="name">${esc(it.name || '未命名')}</p></div>`;
    card.onclick = () => {
      if (pickedIds.has(it.id)) { pickedIds.delete(it.id); card.classList.remove('picked'); }
      else { pickedIds.add(it.id); card.classList.add('picked'); }
    };
    picker.appendChild(card);
  });

  $('#outfitModal').hidden = false;
}

function closeOutfitModal() {
  $('#outfitModal').hidden = true;
  pickedIds = new Set();
}

function openOutfitView(o) {
  $('#outfitViewTitle').textContent = o.name || '未命名搭配';
  const grid = $('#outfitViewGrid');
  grid.innerHTML = '';

  (o.itemIds || []).forEach((id) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const u = itemUrl(it);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      ${u ? `<img class="thumb" src="${u}" alt="">` : '<div class="nophoto">👕</div>'}
      <div class="meta"><p class="name">${esc(it.name || '未命名')}</p></div>`;
    grid.appendChild(card);
  });

  $('#outfitViewNote').textContent = o.note || '';
  $('#outfitViewDelete').onclick = async () => {
    if (!confirm(`删除搭配「${o.name || '未命名'}」？`)) return;
    await dbDel('outfits', o.id);
    $('#outfitView').hidden = true;
    await loadAll();
  };
  $('#outfitView').hidden = false;
}

/* ================= 数据加载 ================= */
async function loadAll() {
  cats = (await dbAll('categories')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  items = await dbAll('items');
  outfits = await dbAll('outfits');

  if (filterCat !== 'all' && filterCat !== 'none' && !cats.some((c) => c.id === filterCat)) {
    filterCat = 'all';
  }

  renderItems();
  renderCats();
  renderOutfits();
}

/* ================= 首次启动：预置几个分类 ================= */
async function seedOnce() {
  if (localStorage.getItem('wardrobe-seeded')) return;
  const seed = ['上衣', '裤子', '裙子', '外套', '鞋', '包'];
  for (const name of seed) {
    await dbPut('categories', { id: uid(), name, createdAt: Date.now() });
  }
  localStorage.setItem('wardrobe-seeded', '1');
}

/* ================= 事件绑定 ================= */
function switchTab(tab) {
  curTab = tab;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#page-items').hidden = tab !== 'items';
  $('#page-cats').hidden = tab !== 'cats';
  $('#page-outfits').hidden = tab !== 'outfits';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindEvents() {
  $$('.tab').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

  /* 悬浮按钮 */
  $('#fab').onclick = () => {
    if (curTab === 'cats') $('#newCat').focus();
    else if (curTab === 'outfits') openOutfitModal();
    else openItemModal(null);
  };

  /* 分类新增 */
  $('#addCatBtn').onclick = async () => {
    const input = $('#newCat');
    const name = input.value.trim();
    if (!name) return;
    if (cats.some((c) => c.name === name)) { alert('这个分类已经有了'); return; }
    await dbPut('categories', { id: uid(), name, createdAt: Date.now() });
    input.value = '';
    await loadAll();
  };
  $('#newCat').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#addCatBtn').click();
  });

  /* 照片选择 */
  $('#photoInput').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const blob = await readImage(file);
      pendingImage = blob;
      const preview = $('#photoPreview');
      if (preview.dataset.tmp) URL.revokeObjectURL(preview.dataset.tmp);
      const tmp = URL.createObjectURL(blob);
      preview.dataset.tmp = tmp;
      preview.src = tmp;
      preview.hidden = false;
      $('#photoHint').hidden = true;
    } catch (err) {
      alert('照片读取失败，换一张试试');
    }
  };

  /* 衣服保存 */
  $('#itemSave').onclick = async () => {
    const name = $('#itemName').value.trim();
    const categoryId = $('#itemCat').value;
    const color = $('#itemColor').value.trim();
    const season = $('#itemSeason').value;
    const note = $('#itemNote').value.trim();

    if (!name && pendingImage === undefined && !(editingItem && editingItem.image)) {
      alert('至少填个名称，或者加一张照片');
      return;
    }

    const obj = editingItem
      ? Object.assign({}, editingItem)
      : { id: uid(), createdAt: Date.now() };

    obj.name = name;
    obj.categoryId = categoryId;
    obj.color = color;
    obj.season = season;
    obj.note = note;

    if (pendingImage !== undefined) {
      obj.image = pendingImage;          // Blob 或 null
      dropUrl(obj.id);
    }

    await dbPut('items', obj);
    closeItemModal();
    await loadAll();
  };

  /* 衣服删除 */
  $('#itemDelete').onclick = async () => {
    if (!editingItem) return;
    if (!confirm(`删除「${editingItem.name || '未命名'}」？`)) return;
    const id = editingItem.id;
    await dbDel('items', id);
    dropUrl(id);
    // 从搭配中移除
    for (const o of outfits) {
      if ((o.itemIds || []).includes(id)) {
        o.itemIds = o.itemIds.filter((x) => x !== id);
        await dbPut('outfits', o);
      }
    }
    closeItemModal();
    await loadAll();
  };

  $('#itemCancel').onclick = closeItemModal;

  /* 搭配保存 */
  $('#outfitSave').onclick = async () => {
    const name = $('#outfitName').value.trim();
    if (pickedIds.size === 0) { alert('请至少选一件单品'); return; }
    await dbPut('outfits', {
      id: uid(),
      name: name || '未命名搭配',
      itemIds: Array.from(pickedIds),
      note: $('#outfitNote').value.trim(),
      createdAt: Date.now(),
    });
    closeOutfitModal();
    await loadAll();
    switchTab('outfits');
  };

  $('#outfitCancel').onclick = closeOutfitModal;
  $('#outfitViewClose').onclick = () => { $('#outfitView').hidden = true; };

  /* 点遮罩关闭弹窗 */
  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target !== m) return;
      if (m.id === 'itemModal') closeItemModal();
      else if (m.id === 'outfitModal') closeOutfitModal();
      else m.hidden = true;
    });
  });
}

/* ================= 启动 ================= */
(async function main() {
  try {
    await openDB();
    await seedOnce();
    bindEvents();
    await loadAll();
    switchTab('items');
  } catch (err) {
    document.body.innerHTML =
      '<p style="padding:40px;color:#c0392b">启动失败：' + esc(err.message) + '</p>';
  }
})();
