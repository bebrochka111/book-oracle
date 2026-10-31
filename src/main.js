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
  $('book').innerHTML = '<option value="">Нет подключения</option>';
}

async function refreshBooks() {
  if (!client) return;
  const { data, error } = await client.from('books').select('id,title,author,page_count,status,storage_path').order('created_at', { ascending: false });
  if (error) { message('readerMessage', `Не удалось загрузить библиотеку: ${error.message}`); return; }
  books = data || [];
  const selected = $('book').value;
  $('book').replaceChildren(new Option('Выберите книгу', ''));
  for (const b of books.filter((b) => b.status === 'ready')) $('book').add(new Option(`${b.title}${b.author ? ` — ${b.author}` : ''}`, b.id));
  if (books.some((b) => b.id === selected && b.status === 'ready')) $('book').value = selected;
  updateMeta();
  renderAdminBooks();
}
function updateMeta() {
  const b = books.find((item) => item.id === $('book').value);
  $('bookMeta').textContent = b ? `${b.page_count} страниц PDF` : '';
  $('page').max = b ? String(b.page_count) : '';
  $('result').classList.add('hidden');
}
$('book').addEventListener('change', updateMeta);
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
});
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(currentQuote); $('copy').textContent = 'Скопировано ✓'; }
  catch { message('readerMessage', 'Не удалось скопировать автоматически.'); }
});
$('adminToggle').addEventListener('click', () => $('admin').classList.toggle('hidden'));

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
async function readPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const rows = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      message('adminMessage', `Обработка PDF: страница ${pageNumber} из ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const sentences = splitSentences(extractPageText(content.items));
      for (let i = 0; i < sentences.length; i++) rows.push({ page_number: pageNumber, sentence_number: i + 1, content: sentences[i] });
      page.cleanup();
    }
    return { pageCount: pdf.numPages, rows };
  } finally { await pdf.destroy(); }
}
$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!client || !isAdmin) return;
  const file = $('file').files[0];
  if (!file || file.size > 20 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) { message('adminMessage', 'Выберите PDF-файл не больше 20 МБ.'); return; }
  const button = $('uploadButton'); button.disabled = true;
  let path = null, bookId = null;
  try {
    const { pageCount, rows } = await readPdf(file);
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
    const published = await client.from('books').update({ status: 'ready' }).eq('id', bookId);
    if (published.error) throw published.error;
    message('adminMessage', `Книга добавлена: ${pageCount} страниц, ${rows.length} предложений.`);
    $('uploadForm').reset();
    await refreshBooks();
  } catch (error) {
    let cleanupFailed = false;
    if (bookId) { const result = await client.from('books').delete().eq('id', bookId); cleanupFailed ||= Boolean(result.error); }
    if (path) { const result = await client.storage.from('books').remove([path]); cleanupFailed ||= Boolean(result.error); }
    message('adminMessage', `Ошибка загрузки: ${error.message}${cleanupFailed ? ' Автоматическая очистка не удалась: проверьте Supabase вручную.' : ''}`);
  } finally { button.disabled = false; }
});
function renderAdminBooks() {
  $('adminBooks').replaceChildren();
  if (!isAdmin) return;
  for (const book of books) {
    const row = document.createElement('div'); row.className = 'bookrow';
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = book.title;
    const sub = document.createElement('small'); sub.textContent = `${book.author || 'Автор не указан'} · ${book.page_count} стр. · ${book.status}`;
    info.append(title, sub);
    const del = document.createElement('button'); del.className = 'delete'; del.type = 'button'; del.textContent = 'Удалить';
    del.addEventListener('click', async () => {
      if (!confirm(`Удалить книгу «${book.title}» и все её предложения?`)) return;
      del.disabled = true;
      // First delete DB; file cleanup is attempted after DB removal.
      const { error } = await client.from('books').delete().eq('id', book.id);
      if (error) { message('adminMessage', `Ошибка удаления: ${error.message}`); del.disabled = false; return; }
      const { error: storageError } = await client.storage.from('books').remove([book.storage_path]);
      message('adminMessage', storageError ? 'Запись удалена, но PDF остался в Storage. Удалите файл вручную.' : 'Книга удалена.');
      await refreshBooks();
    });
    row.append(info, del); $('adminBooks').append(row);
  }
}
if (client) { updateAuth().catch((error) => message('readerMessage', error.message)); }
