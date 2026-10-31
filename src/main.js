import { createClient } from '@supabase/supabase-js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './style.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
const $ = (id) => document.getElementById(id);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const client = url && key ? createClient(url, key) : null;
const message = (id, text) => { $(id).textContent = text; };
let books = [];
let isAdmin = false;
let currentQuote = '';

if (!client) {
  message('readerMessage', 'Сайт не настроен: добавьте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY в Netlify.');
  $('bookTiles').replaceChildren();
  const notice = document.createElement('p'); notice.className = 'book-tiles-status'; notice.textContent = 'Нет подключения к библиотеке';
  $('bookTiles').append(notice);
}

async function refreshBooks() {
  if (!client) return;
  const { data, error } = await client.from('books').select('id,title,author,page_count,status,storage_path,cover_path').order('created_at', { ascending: false });
  if (error) { message('readerMessage', `Не удалось загрузить библиотеку: ${error.message}`); return; }
  books = data || [];
  const selected = $('book').value;
  const readyBooks = books.filter((b) => b.status === 'ready');
  $('book').value = readyBooks.some((b) => b.id === selected) ? selected : '';
  renderBookTiles(readyBooks);
  updateMeta();
  renderAdminBooks();
}
function renderBookTiles(readyBooks) {
  const container = $('bookTiles');
  container.replaceChildren();
  if (!readyBooks.length) {
    const notice = document.createElement('p');
    notice.className = 'book-tiles-status';
    notice.textContent = 'Пока нет доступных книг. Загляните позже.';
    container.append(notice);
    return;
  }
  for (const book of readyBooks) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'book-tile';
    tile.setAttribute('aria-pressed', String(book.id === $('book').value));
    if (book.id === $('book').value) tile.classList.add('is-selected');
    const cover = document.createElement('span');
    cover.className = 'book-tile-cover';
    cover.setAttribute('aria-hidden', 'true');
    const ornament = document.createElement('span');
    ornament.className = 'book-tile-ornament';
    ornament.textContent = '✦';
    const icon = document.createElement('span');
    icon.className = 'book-tile-icon';
    icon.textContent = '▤';
    if (book.cover_path) {
      const img = document.createElement('img');
      img.className = 'book-tile-cover-image';
      img.alt = '';
      img.loading = 'lazy';
      img.src = client.storage.from('book-covers').getPublicUrl(book.cover_path).data.publicUrl;
      img.addEventListener('error', () => { img.remove(); cover.append(ornament, icon); }, { once: true });
      cover.append(img);
      cover.classList.add('has-image');
    } else cover.append(ornament, icon);
    const details = document.createElement('span');
    details.className = 'book-tile-details';
    const title = document.createElement('span');
    title.className = 'book-tile-title';
    title.textContent = book.title;
    const author = document.createElement('span');
    author.className = 'book-tile-author';
    author.textContent = book.author || 'Автор не указан';
    const pages = document.createElement('span');
    pages.className = 'book-tile-pages';
    pages.textContent = `${book.page_count} стр.`;
    details.append(title, author, pages);
    const check = document.createElement('span');
    check.className = 'book-tile-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    tile.append(cover, details, check);
    tile.addEventListener('click', () => {
      $('book').value = book.id;
      for (const button of container.querySelectorAll('.book-tile')) {
        const active = button === tile;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      }
      message('readerMessage', '');
updateMeta();

// Плавно прокручиваем к выбору страницы и предложения
requestAnimationFrame(() => {
  const pageField = document.getElementById('page');
  if (!pageField) return;

  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  pageField.scrollIntoView({
    behavior: reducedMotion ? 'instant' : 'smooth',
    block: 'center'
  });
});
    });
    container.append(tile);
  }
}
function updateMeta() {
  const b = books.find((item) => item.id === $('book').value);
  $('bookMeta').textContent = b ? `${b.page_count} страниц PDF` : '';
  $('page').max = b ? String(b.page_count) : '';
  $('result').classList.add('hidden');
}
$('searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('result').classList.add('hidden');
  message('readerMessage', '');
  if (!client) return;
  const book = books.find((b) => b.id === $('book').value);
  const page = Number($('page').value), number = Number($('number').value);
  if (!book || !Number.isSafeInteger(page) || page < 1 || page > book.page_count || !Number.isSafeInteger(number) || number < 1) {
    message('readerMessage', 'Выберите книгу и корректные номера страницы и предложения.'); return;
  }
  const { data, error } = await client.from('sentences').select('content').eq('book_id', book.id).eq('page_number', page).eq('sentence_number', number).maybeSingle();
  if (error) { message('readerMessage', `Ошибка поиска: ${error.message}`); return; }
  if (!data) { message('readerMessage', 'Такого предложения на этой странице нет. Попробуйте другой номер.'); return; }
  currentQuote = data.content;
  $('quote').textContent = currentQuote;
  $('citation').textContent = `${book.title} · страница ${page} · предложение ${number}`;
  $('result').classList.remove('hidden');
  // Wait until the result is laid out, then move the viewport to the quote.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const result = $('result');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      result.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    });
  });
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(currentQuote); $('copy').textContent = 'Скопировано ✓'; }
  catch { message('readerMessage', 'Не удалось скопировать автоматически.'); }
});
$('adminToggle').addEventListener('click', () => { const panel = $('admin'); panel.classList.toggle('hidden'); $('adminToggle').setAttribute('aria-expanded', String(!panel.classList.contains('hidden'))); if (!panel.classList.contains('hidden')) panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

async function updateAuth() {
  if (!client) return;
  const { data: { session } } = await client.auth.getSession();
  isAdmin = false;
  if (session) {
    const { data, error } = await client.rpc('is_admin');
    isAdmin = !error && data === true;
  }
  $('loginArea').classList.toggle('hidden', isAdmin);
  $('adminArea').classList.toggle('hidden', !isAdmin);
  if (session && !isAdmin) message('adminMessage', 'Аккаунт не назначен администратором. Добавьте его UUID в таблицу admin_users.');
  await refreshBooks();
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!client) return;
  message('adminMessage', 'Выполняется вход…');
  const { error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  $('password').value = '';
  if (error) { message('adminMessage', `Ошибка входа: ${error.message}`); return; }
  message('adminMessage', '');
  await updateAuth();
});
$('logout').addEventListener('click', async () => { await client.auth.signOut(); message('adminMessage', ''); await updateAuth(); });

function splitSentences(text) {
  // MVP heuristic: handles common abbreviations but may require manual review for complex punctuation.
  const protectedText = text.replace(/\b(г|стр|рис|им|т|д|п|е|др)\./gi, '$1∯').replace(/\b([А-ЯЁ])\.(?=\s*[А-ЯЁ]\.)/g, '$1∯');
  const matches = protectedText.match(/[^.!?…]+(?:[.!?…]+(?:[»”"')\]]+)?|$)/g) || [];
  return matches.map((s) => s.replace(/∯/g, '.').replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function extractPageText(items) {
  let text = '';
  let previousY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (text && typeof y === 'number' && previousY !== null && Math.abs(y - previousY) > 3) text += '\n';
    else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
    text += item.str;
    if (item.hasEOL) text += '\n';
    if (typeof y === 'number') previousY = y;
  }
  return text.replace(/([^\s])-\n(?=\p{L})/gu, '$1').replace(/\s+/g, ' ').trim();
}
// The PDF is processed locally; do not write anything to Supabase until validation passes.
const PDF_PAGE_TIMEOUT_MS = 15000;
const PDF_TOTAL_TIMEOUT_MS = 300000;
const MAX_PAGES = 1200;
const MAX_SENTENCES = 100000;
let uploadAbort = null;
function cancelled(signal) {
  if (signal.aborted) throw new Error('Обработка отменена. Книга не добавлена.');
}
function deadline(promise, milliseconds, label, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Обработка отменена.'));
    const timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания. Попробуйте другой PDF или предварительно обработайте файл через OCR.`)), milliseconds);
    const onAbort = () => reject(new Error('Обработка отменена. Книга не добавлена.'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    });
  });
}
async function readPdf(file, signal) {
  const started = Date.now();
  let pdf = null;
  let loadingTask = null;
  const rows = [];
  let pagesWithText = 0;
  let pagesWithoutText = 0;
  try {
    cancelled(signal);
    const buffer = await deadline(file.arrayBuffer(), 15000, 'Чтение файла', signal);
    cancelled(signal);
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    pdf = await deadline(loadingTask.promise, 20000, 'Открытие PDF', signal);
    if (pdf.numPages > MAX_PAGES) throw new Error(`В книге ${pdf.numPages} страниц. Для этой версии поддерживается не более ${MAX_PAGES}.`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      cancelled(signal);
     if (Date.now() - started > PDF_TOTAL_TIMEOUT_MS) throw new Error('Обработка заняла больше 5 минут. Попробуйте меньший PDF или предварительную OCR-обработку.');
      message('adminMessage', `Проверка текстового слоя: страница ${pageNumber} из ${pdf.numPages}…`);
      const page = await deadline(pdf.getPage(pageNumber), PDF_PAGE_TIMEOUT_MS, `Страница ${pageNumber}`, signal);
      try {
        const content = await deadline(page.getTextContent(), PDF_PAGE_TIMEOUT_MS, `Чтение текста страницы ${pageNumber}`, signal);
        const text = extractPageText(content.items);
        if (text.length >= 10) pagesWithText++; else pagesWithoutText++;
        const sentences = splitSentences(text);
        for (let i = 0; i < sentences.length; i++) rows.push({ page_number: pageNumber, sentence_number: i + 1, content: sentences[i] });
        if (rows.length > MAX_SENTENCES) throw new Error('Слишком много предложений для одной загрузки. Разделите PDF на части.');
      } finally { page.cleanup(); }
      // Yield so the browser can update progress and handle Cancel clicks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    cancelled(signal);
    if (!pagesWithText || !rows.length) throw new Error('В PDF не обнаружен текстовый слой. Вероятно, это скан: сначала распознайте текст через OCR и сохраните PDF с текстом. Файл не загружен.');
    return { pageCount: pdf.numPages, rows, pagesWithoutText };
  } finally {
    // Best effort: stop pdf.js work even if an individual page stalls.
    if (pdf) { try { await Promise.race([pdf.destroy(), new Promise((r) => setTimeout(r, 2000))]); } catch {} }
    else if (loadingTask) { try { await Promise.race([loadingTask.destroy(), new Promise((r) => setTimeout(r, 2000))]); } catch {} }
  }
}
$('cancelUpload').addEventListener('click', () => {
  if (uploadAbort) uploadAbort.abort();
});
$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!client || !isAdmin) return;
  const file = $('file').files[0];
  if (!file || file.size > 20 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) { message('adminMessage', 'Выберите PDF-файл не больше 20 МБ.'); return; }
  const button = $('uploadButton'); button.disabled = true;
  const controller = new AbortController(); uploadAbort = controller;
  $('cancelUpload').classList.remove('hidden');
  let path = null, bookId = null, coverPath = null;
  try {
    const { pageCount, rows, pagesWithoutText } = await readPdf(file, controller.signal);
    cancelled(controller.signal);
    uploadAbort = null; $('cancelUpload').classList.add('hidden');
    if (!rows.length) throw new Error('Не удалось извлечь текст. Возможно, это скан без текстового слоя (нужен OCR).');
    path = `${crypto.randomUUID()}.pdf`;
    message('adminMessage', 'Загрузка файла в Supabase Storage…');
    const uploaded = await client.storage.from('books').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await client.from('books').insert({ title: $('title').value.trim(), author: $('author').value.trim(), storage_path: path, page_count: pageCount, status: 'processing' }).select('id').single();
    if (inserted.error) throw inserted.error;
    bookId = inserted.data.id;
    for (let i = 0; i < rows.length; i += 300) {
      message('adminMessage', `Сохранение предложений: ${Math.min(i + 300, rows.length)} из ${rows.length}…`);
      const { error } = await client.from('sentences').insert(rows.slice(i, i + 300).map((row) => ({ ...row, book_id: bookId })));
      if (error) throw error;
    }
    const coverFile = $('newCover').files[0];
    if (coverFile) {
      coverPath = await uploadCover(coverFile, bookId);
      const coverSaved = await client.from('books').update({ cover_path: coverPath }).eq('id', bookId);
      if (coverSaved.error) throw coverSaved.error;
    }
    const published = await client.from('books').update({ status: 'ready' }).eq('id', bookId);
    if (published.error) throw published.error;
    message('adminMessage', `Книга добавлена: ${pageCount} страниц, ${rows.length} предложений.${pagesWithoutText ? ` На ${pagesWithoutText} страницах почти нет извлекаемого текста — проверьте их (возможно, нужен OCR).` : ''}`);
    $('uploadForm').reset();
    await refreshBooks();
  } catch (error) {
    let cleanupFailed = false;
    if (bookId) { const result = await client.from('books').delete().eq('id', bookId); cleanupFailed ||= Boolean(result.error); }
    if (path) { const result = await client.storage.from('books').remove([path]); cleanupFailed ||= Boolean(result.error); }
    if (coverPath) { const result = await client.storage.from('book-covers').remove([coverPath]); cleanupFailed ||= Boolean(result.error); }
    message('adminMessage', `Ошибка загрузки: ${error.message}${cleanupFailed ? ' Автоматическая очистка не удалась: проверьте Supabase вручную.' : ''}`);
  } finally { button.disabled = false; uploadAbort = null; $('cancelUpload').classList.add('hidden'); }
});
const MAX_COVER_BYTES = 3 * 1024 * 1024;
async function uploadCover(file, bookId) {
  const accepted = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = accepted[file.type];
  if (!ext || file.size > MAX_COVER_BYTES || file.size === 0) throw new Error('Обложка должна быть JPG, PNG или WebP размером до 3 МБ.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!(ext === 'jpg' && jpg || ext === 'png' && png || ext === 'webp' && webp)) throw new Error('Содержимое изображения не соответствует формату файла.');
  const path = `${bookId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client.storage.from('book-covers').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}
function renderAdminBooks() {
  $('adminBooks').replaceChildren();
  if (!isAdmin) return;
  for (const book of books) {
    const row = document.createElement('div'); row.className = 'bookrow';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = book.title;
    const sub = document.createElement('small'); sub.textContent = `${book.author || 'Автор не указан'} · ${book.page_count} стр. · ${book.status}`;
    info.append(title, sub);
    const edit = document.createElement('button'); edit.className = 'edit-cover'; edit.type = 'button'; edit.textContent = book.cover_path ? 'Изменить обложку' : 'Добавить обложку';
    const editor = document.createElement('div'); editor.className = 'cover-editor hidden';
    const preview = document.createElement('img'); preview.className = 'cover-preview'; preview.alt = 'Текущая обложка';
    if (book.cover_path) preview.src = client.storage.from('book-covers').getPublicUrl(book.cover_path).data.publicUrl;
    else preview.classList.add('hidden');
    const chooser = document.createElement('input'); chooser.type = 'file'; chooser.accept = 'image/jpeg,image/png,image/webp'; chooser.setAttribute('aria-label', `Изображение обложки для ${book.title}`);
    const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary'; save.textContent = 'Сохранить обложку';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'Убрать обложку';
    if (!book.cover_path) remove.classList.add('hidden');
    const status = document.createElement('p'); status.className = 'cover-status'; status.setAttribute('role', 'status');
    edit.addEventListener('click', () => editor.classList.toggle('hidden'));
    save.addEventListener('click', async () => {
      const file = chooser.files[0]; if (!file) { status.textContent = 'Сначала выберите изображение.'; return; }
      save.disabled = true; remove.disabled = true; status.textContent = 'Загрузка обложки…';
      let newPath = null;
      try {
        newPath = await uploadCover(file, book.id);
        const { error } = await client.from('books').update({ cover_path: newPath }).eq('id', book.id);
        if (error) throw error;
        const oldPath = book.cover_path;
        if (oldPath) {
          const { error: cleanupError } = await client.storage.from('book-covers').remove([oldPath]);
          if (cleanupError) message('adminMessage', 'Обложка обновлена, но старое изображение не удалось удалить из Storage.');
        }
        message('adminMessage', 'Обложка сохранена.');
        await refreshBooks();
      } catch (error) {
        if (newPath) await client.storage.from('book-covers').remove([newPath]);
        status.textContent = `Ошибка: ${error.message}`;
      } finally { save.disabled = false; remove.disabled = false; }
    });
    remove.addEventListener('click', async () => {
      if (!book.cover_path || !confirm(`Убрать обложку книги «${book.title}»?`)) return;
      remove.disabled = true; status.textContent = 'Удаление обложки…';
      const { error } = await client.from('books').update({ cover_path: null }).eq('id', book.id);
      if (error) { status.textContent = `Ошибка: ${error.message}`; remove.disabled = false; return; }
      const { error: cleanupError } = await client.storage.from('book-covers').remove([book.cover_path]);
      message('adminMessage', cleanupError ? 'Обложка скрыта, но файл не удалось удалить из Storage.' : 'Обложка удалена.');
      await refreshBooks();
    });
    editor.append(preview, chooser, save, remove, status);
    const actions = document.createElement('div'); actions.className = 'bookrow-actions'; actions.append(edit);
    const del = document.createElement('button'); del.className = 'delete'; del.type = 'button'; del.textContent = 'Удалить';
    del.addEventListener('click', async () => {
      if (!confirm(`Удалить книгу «${book.title}» и все её предложения?`)) return;
      del.disabled = true;
      // First delete DB; file cleanup is attempted after DB removal.
      const { error } = await client.from('books').delete().eq('id', book.id);
      if (error) { message('adminMessage', `Ошибка удаления: ${error.message}`); del.disabled = false; return; }
      const { error: storageError } = await client.storage.from('books').remove([book.storage_path]);
      const coverError = book.cover_path ? (await client.storage.from('book-covers').remove([book.cover_path])).error : null;
      message('adminMessage', storageError || coverError ? 'Книга удалена, но некоторые файлы остались в Storage. Проверьте их вручную.' : 'Книга удалена.');
      await refreshBooks();
    });
    actions.append(del); row.append(info, actions); const wrap = document.createElement('div'); wrap.className = 'admin-book-item'; wrap.append(row, editor); $('adminBooks').append(wrap);
  }
}
if (client) { updateAuth().catch((error) => message('readerMessage', error.message)); }
