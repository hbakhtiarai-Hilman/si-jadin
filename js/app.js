/* =====================================================================
   SI-JADIN — JavaScript klien (SPA)
   Prinsip instan: (1) navigasi 100% di klien, (2) optimistic UI + localStorage,
   (3) server hanya REST API batch (fetch POST ke Apps Script /exec), (4) render dari memori.
   Frontend statis: GitHub Pages / Vercel. URL API diatur di config.js.
   ===================================================================== */
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const e = SJ.esc, rp = SJ.fmtRp, ang = SJ.fmtAngka, tgl = SJ.fmtTgl, tglp = SJ.fmtTglPendek;
const RL = { SA: 'SUPERADMIN', OP: 'OPERATOR', PL: 'PELAKSANA', VR: 'VERIFIKATOR', PM: 'PIMPINAN' };
const S = { token: null, user: null, cfg: {}, tahun: new Date().getFullYear(), tahunList: [], D: {}, log: [], opd: 'Semua', route: 'dashboard', hist: [], pg: {}, aset: {}, zoom: {}, pending: 0, notif: null, sync: null, charts: {} };
const SHEETS = ['Instansi', 'Kop_OPD', 'Pegawai', 'Master_SBU', 'Pagu', 'Pejabat_TTD', 'Konfigurasi_Hari', 'Pengaturan_Perhitungan', 'Master_Dasar', 'Kode_Rekening', 'Pengaturan_Nomor', 'Templat', 'Users',
  'Surat_Tugas', 'Surat_Tugas_Dasar', 'ST_Pegawai', 'SPD', 'SPD_Pengikut', 'SPD_Diklat', 'SPD_Tujuan', 'Rincian_Biaya', 'Kuitansi', 'Tiket', 'Penginapan', 'Pembayaran', 'SPJ', 'SPJ_Bukti'];

// ---------------------------------------------------------------------
// Peran & cakupan data
// ---------------------------------------------------------------------
const role = () => (S.user ? S.user.Role : '');
const isSA = () => role() === RL.SA, isOP = () => role() === RL.OP, isPL = () => role() === RL.PL, isVR = () => role() === RL.VR, isPM = () => role() === RL.PM;
const bisaTulis = opd => isSA() || (isOP() && S.user.OPD === opd);
const lihatSemua = () => isSA() || isVR() || isPM();
const inOPD = r => S.opd === 'Semua' || !r.OPD || r.OPD === S.opd;
const peg = nip => SJ.lookup.pegawai(S.D, nip);
const nmPeg = nip => { const p = peg(nip); return p ? SJ.namaLengkap(p) : (nip || '-'); };
const singkat = kode => { const i = SJ.one(S.D.Instansi || [], 'Kode', kode); return i ? (i.NamaSingkat || i.Kode) : kode; };
const spjOf = id => SJ.one(S.D.SPJ || [], 'SPDID', id);
const stOf = id => SJ.one(S.D.Surat_Tugas || [], 'ID', id);
const spdOf = id => SJ.one(S.D.SPD || [], 'ID', id);
const inisial = n => String(n || '?').replace(/^(Dr|Drs|Dra|Hj|H|Ir|Prof)\.?\s+/gi, '').split(/[\s,]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const avatar = (n, cls) => `<span class="avatar ${cls || ''}" title="${e(n)}">${e(inisial(n))}</span>`;
const debounce = (fn, ms) => { let t; return function () { const a = arguments, th = this; clearTimeout(t); t = setTimeout(() => fn.apply(th, a), ms || 250); }; };
const uid = p => (p || 'TMP') + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
const deep = o => JSON.parse(JSON.stringify(o));
const bulanIni = () => SJ.hariIni().slice(0, 7);

const STATUS_CLS = { Terbit: 'ok', Diverifikasi: 'ok', Aman: 'ok', Aktif: 'ok', Terkirim: 'ok', Selesai: 'ok', Terdaftar: 'ok', Disetujui: 'pri', Draf: 'neu', Diajukan: 'info', Lengkap: 'info', Antri: 'info', Berjalan: 'info',
  Waspada: 'warn', 'Belum Diunggah': 'warn', 'Belum Dicek': 'warn', Dikembalikan: 'bad', Batal: 'bad', Habis: 'bad', Ditolak: 'bad', Nonaktif: 'bad', Gagal: 'bad', Dibatalkan: 'bad', Dihentikan: 'bad', 'Tidak Terdaftar': 'bad' };
const pill = (s, extra) => `<span class="pill ${STATUS_CLS[s] || 'neu'}">${e(extra || s || '-')}</span>`;
const ic = (n, cls) => `<span class="ms ${cls || ''}" aria-hidden="true">${n}</span>`;
const empty = (icon, txt, act) => `<div class="empty">${ic(icon)}<div>${txt}</div>${act || ''}</div>`;

// ---------------------------------------------------------------------
// Komunikasi server (satu pintu) + indikator progres non-blocking
// ---------------------------------------------------------------------
function progress(d) {
  S.pending = Math.max(0, S.pending + d);
  const bar = $('#topbar-progress');
  if (!bar) return;
  if (S.pending > 0) { bar.className = 'on'; } else { bar.className = 'done'; setTimeout(() => { if (!S.pending) bar.className = ''; }, 600); }
}
// ---------------------------------------------------------------------
// Transport REST: POST text/plain (tanpa preflight CORS) ke Web App /exec
// ---------------------------------------------------------------------
const KONF = window.APP_CONFIG || {};
const API_URL = String(KONF.GAS_URL || '').trim();
const BATAS_WAKTU = 120000;   // ms; unggah berkas besar bisa butuh lama
const apiSiap = () => !!window.__SJ_TRANSPORT || (/^https?:\/\/\S+$/.test(API_URL) && !/GANTI_DENGAN/.test(API_URL));
function kirim(body) {
  if (window.__SJ_TRANSPORT) return window.__SJ_TRANSPORT(body);   // mode demo/uji
  if (!apiSiap()) return Promise.reject(new Error('Konfigurasi belum lengkap: isi GAS_URL di berkas js/config.js dengan URL Web App Apps Script (berakhiran /exec).'));
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const batas = setTimeout(() => { if (ctrl) ctrl.abort(); }, BATAS_WAKTU);
  return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    .then(res => { if (!res.ok) throw new Error('Server menjawab HTTP ' + res.status + '.'); return res.text(); })
    .then(txt => { try { return JSON.parse(txt); } catch (err) { throw new Error('Respons server bukan JSON. Pastikan deployment Web App diatur "Siapa saja" dan URL berakhiran /exec.'); } })
    .catch(err => {
      if (err && err.name === 'AbortError') throw new Error('Server tidak merespons dalam batas waktu. Coba lagi.');
      if (err instanceof TypeError) throw new Error(navigator.onLine === false ? 'Tidak ada koneksi internet.' : 'Tidak dapat terhubung ke server. Periksa internet, GAS_URL di js/config.js, dan akses deployment "Siapa saja".');
      throw err;
    })
    .finally(() => clearTimeout(batas));
}
// Deduplikasi permintaan baca yang sedang berjalan + epoch tulis (gas-scale-turbo 4.1)
const BACA = /^(app\.(bootstrap|info)|aset\.ambil|log\.ambil|crm\.daftar|publik\.)/;
const _inflight = {};
let _epochTulis = 0;
function api(action, data, opt) {
  opt = opt || {};
  if (!BACA.test(action)) { _epochTulis++; return apiJalan(action, data, opt); }
  const k = _epochTulis + '|' + action + '|' + JSON.stringify(data || {});
  if (_inflight[k]) return _inflight[k];            // permintaan kembar menumpang promise yang sama
  const p = apiJalan(action, data, opt);
  _inflight[k] = p;
  const hapus = () => { delete _inflight[k]; };
  p.then(hapus, hapus);
  return p;
}
function apiJalan(action, data, opt) {
  if (!opt.silent) progress(1);
  const done = () => { if (!opt.silent) progress(-1); };
  return kirim({ token: S.token || '', action: action, data: data || {} }).then(r => {
    done();
    if (!r) throw new Error('Server tidak memberi respons.');
    if (r.v) S.verServer = r.v;
    if (r.success) return r;
    if (r.code === 'AUTH' && action !== 'auth.login') sesiHabis();
    throw new Error(r.message || 'Terjadi kesalahan.');
  }, err => { done(); throw err; });
}
/** Mutasi dengan optimistic UI: terapkan perubahan lokal seketika, rollback bila server menolak. */
async function mutasi(action, data, o) {
  o = o || {};
  let rollback = null;
  if (o.opt) { rollback = o.opt(); refresh(); }
  sibuk(o.btn, true);
  try {
    const r = await api(action, data);
    if (rollback) rollback();
    if (r.data && (r.data.upsert || r.data.replace || r.data.hapus)) mergePaket(r.data);
    if (r.message) toast(r.message, /⚠|berbeda|melebihi/.test(r.message) ? 'warn' : 'ok', /⚠/.test(r.message) ? 8000 : 4000);
    if (o.ok) o.ok(r.data);
    refresh();
    return r.data;
  } catch (err) {
    if (rollback) { rollback(); refresh(); }
    toast(err.message, 'bad', 9000);
    if (o.fail) o.fail(err);
    throw err;
  } finally { sibuk(o.btn, false); }
}
function sibuk(btn, on) {
  if (!btn) return;
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + (btn.dataset.busy || 'Memproses…'); }
  else if (btn.dataset.html !== undefined) { btn.disabled = false; btn.innerHTML = btn.dataset.html; delete btn.dataset.html; }
}
function mergePaket(pk) {
  if (!pk) return;
  const rep = pk.replace;
  if (rep) rep.sheets.forEach(n => { S.D[n] = (S.D[n] || []).filter(r => String(r[rep.key]) !== String(rep.val)); });
  if (pk.upsert) Object.keys(pk.upsert).forEach(n => {
    if (rep && rep.sheets.indexOf(n) > -1) S.D[n] = (S.D[n] || []).concat(pk.upsert[n]);
    else pk.upsert[n].forEach(r => upsertRow(n, r));
  });
  if (pk.hapus) Object.keys(pk.hapus).forEach(n => {
    const ids = pk.hapus[n];
    S.D[n] = (S.D[n] || []).filter(r => ids.indexOf(r.ID) < 0);
    const fk = n === 'SPD' ? 'SPDID' : (n === 'Surat_Tugas' ? 'STID' : null);
    if (fk) SHEETS.forEach(s => { if (S.D[s] && S.D[s].length && fk in S.D[s][0]) S.D[s] = S.D[s].filter(r => ids.indexOf(r[fk]) < 0); });
  });
  simpanCache();
}
function upsertRow(n, r, key) {
  key = key || 'ID';
  const arr = S.D[n] = S.D[n] || [];
  const i = arr.findIndex(x => String(x[key]) === String(r[key]));
  if (i > -1) arr[i] = r; else arr.push(r);
}

// ---------------------------------------------------------------------
// Cache lokal (stale-while-revalidate) — tampil instan saat dibuka ulang
// ---------------------------------------------------------------------
const CK = () => 'sj_cache_' + (S.user ? S.user.ID : 'x') + '_' + S.tahun;
const simpanCache = debounce(() => {
  try { localStorage.setItem(CK(), JSON.stringify({ D: S.D, log: S.log, cfg: S.cfg, user: S.user, tahunList: S.tahunList, notif: S.notif, ver: S.ver, vk: S.vk, t: Date.now() })); }
  catch (err) { try { localStorage.removeItem(CK()); } catch (x) { /* kuota */ } }
}, 500);
function bacaCache(uidUser, tahun) {
  try { const raw = localStorage.getItem('sj_cache_' + uidUser + '_' + tahun); return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
}
/** Terapkan hasil bootstrap. Mode delta: hanya sheet yang dikirim server yang diganti. */
function terapkanBoot(b) {
  S.user = b.user; S.cfg = b.config || S.cfg; S.tahun = b.tahun || S.tahun; S.tahunList = b.tahunList || S.tahunList;
  if (b.delta) Object.keys(b.D || {}).forEach(n => { S.D[n] = b.D[n]; });
  else S.D = b.D || {};
  SHEETS.forEach(n => { if (!S.D[n]) S.D[n] = []; });
  S.ver = b.ver || null; S.vk = b.vk || null;
  if (b.log) S.log = b.log; S.notif = b.notif || S.notif; S.sync = new Date();
  if (!lihatSemua()) S.opd = S.user.OPD || 'Semua';
  try { localStorage.setItem('sj_last', JSON.stringify({ id: S.user.ID, tahun: S.tahun })); } catch (err) { /* abaikan */ }
  simpanCache();
}
/** Sinkron delta: kirim versi data yang dimiliki → server hanya membalas sheet yang berubah. */
async function sinkron(silent, penuh) {
  if (!S.token) return;
  const epoch = _epochTulis;
  try {
    const r = await api('app.bootstrap', penuh || !S.ver ? { tahun: S.tahun } : { tahun: S.tahun, ver: S.ver, vk: S.vk }, { silent: silent });
    // Ada simpan/hapus yang dimulai sementara data diambil → hasil ini bisa usang; ulangi sebentar lagi
    if (epoch !== _epochTulis && !r.data.delta) { setTimeout(() => sinkron(true), 1500); return; }
    const adaUbah = !r.data.delta || Object.keys(r.data.D || {}).length > 0;
    terapkanBoot(r.data);
    if (adaUbah) refresh(); else renderNav();
    if (!silent) toast(adaUbah ? 'Data diperbarui dari server.' : 'Data sudah terbaru.', 'ok', 2500);
  } catch (err) { if (!silent) toast(err.message, 'bad'); }
}

// ---------------------------------------------------------------------
// Komponen UI: toast, modal, konfirmasi, prompt, kertas A4, cetak, unduh
// ---------------------------------------------------------------------
function toast(msg, type, ms) {
  const icn = { ok: 'check_circle', bad: 'error', warn: 'warning', info: 'info' }[type || 'info'];
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.innerHTML = ic(icn) + `<div class="grow">${e(msg)}</div><button class="x" aria-label="Tutup">${ic('close', 'sm')}</button>`;
  $('#toast-root').appendChild(t);
  const tutup = () => { t.style.opacity = '0'; setTimeout(() => t.remove(), 200); };
  $('.x', t).onclick = tutup;
  if (ms !== 0) setTimeout(tutup, ms || 4000);   // ms = 0 → tetap tampil sampai ditutup
  return t;
}
let MODALS = [];
function modal(o) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${o.size || ''}" role="dialog" aria-modal="true" aria-label="${e(o.title || '')}">
    <div class="modal-h"><h3>${o.title || ''}</h3><button class="btn ghost icon" data-x aria-label="Tutup">${ic('close')}</button></div>
    <div class="modal-b">${o.body || ''}</div>${o.foot ? `<div class="modal-f">${o.foot}</div>` : ''}</div>`;
  const m = { el: bg, close: () => { bg.remove(); MODALS = MODALS.filter(x => x !== m); if (o.onClose) o.onClose(); } };
  bg.addEventListener('click', ev => { if (ev.target === bg || ev.target.closest('[data-x]')) m.close(); });
  $('#modal-root').appendChild(bg); MODALS.push(m);
  setTimeout(() => { const f = $('[autofocus], .modal-b input, .modal-b select, .modal-b textarea', bg); if (f) f.focus(); }, 30);
  return m;
}
function konfirmasi(teks, o) {
  o = o || {};
  return new Promise(res => {
    const m = modal({ title: o.judul || 'Konfirmasi', size: 'sm', body: `<p style="margin:0">${teks}</p>`,
      foot: `<button class="btn sec" data-n>Batal</button><button class="btn ${o.bahaya ? 'dang' : 'pri'}" data-y>${o.ok || 'Ya, lanjutkan'}</button>`, onClose: () => res(false) });
    $('[data-n]', m.el).onclick = () => m.close();
    $('[data-y]', m.el).onclick = () => { res(true); m.el.remove(); MODALS = MODALS.filter(x => x !== m); };
  });
}
function tanya(judul, label, o) {
  o = o || {};
  return new Promise(res => {
    const m = modal({ title: judul, size: 'sm', body: `<div class="field"><label>${label}</label>${o.multi ? `<textarea class="ta" id="tq" autofocus>${e(o.nilai || '')}</textarea>` : `<input class="inp" id="tq" type="${o.type || 'text'}" value="${e(o.nilai || '')}" autofocus>`}</div>`,
      foot: `<button class="btn sec" data-n>Batal</button><button class="btn ${o.bahaya ? 'dang' : 'pri'}" data-y>${o.ok || 'Simpan'}</button>`, onClose: () => res(null) });
    $('[data-n]', m.el).onclick = () => m.close();
    $('[data-y]', m.el).onclick = () => {
      const v = $('#tq', m.el).value.trim();
      if (o.wajib && !v) { $('#tq', m.el).classList.add('bad'); return; }
      res(v); m.el.remove(); MODALS = MODALS.filter(x => x !== m);
    };
  });
}
// Kertas A4 dengan zoom; konten dirender dari modul bersama (sama persis dengan PDF)
const urlFrontend = () => S.cfg.FRONTEND_URL || (location.origin + location.pathname.replace(/index\.html$/, ''));
const docOpts = draf => ({ img: imgSrc, qr: t => 'https://quickchart.io/qr?size=150&margin=1&text=' + encodeURIComponent(t), verifyUrl: urlFrontend(), draf: !!draf });
function imgSrc(id) {
  if (!id) return '';
  if (S.aset[id]) return S.aset[id];
  if (S.aset[id] === undefined) {
    S.aset[id] = '';
    api('aset.ambil', { ids: [id] }, { silent: true }).then(r => { Object.assign(S.aset, r.data); if (S.aset[id]) refresh(); }).catch(() => { });
  }
  return '';
}
function kertas(key, html, o) {
  o = o || {};
  const z = S.zoom[key] || o.zoom || 0;
  return `<div class="paper-tools"><div class="row gap8 small b">${ic('description', 'sm')} <span class="trunc">${e(o.judul || 'Pratinjau Kertas A4')}</span>${o.draf ? '<span class="tag gold">DRAF</span>' : ''}</div>
    <div class="row gap4"><button class="btn ghost icon sm" data-act="paper.zoom" data-k="${key}" data-d="-1" aria-label="Perkecil">${ic('zoom_out', 'sm')}</button>
    <span class="xs mono muted" style="min-width:38px;text-align:center">${z ? Math.round(z * 100) + '%' : 'Pas'}</span>
    <button class="btn ghost icon sm" data-act="paper.zoom" data-k="${key}" data-d="1" aria-label="Perbesar">${ic('zoom_in', 'sm')}</button>
    ${o.cetak !== false ? `<button class="btn sec sm" data-act="paper.print" data-k="${key}">${ic('print', 'sm')} Cetak</button>` : ''}${o.extra || ''}</div></div>
    <div class="paper-stage" data-paper="${key}"><div class="paper-zoom"><style>${SJ.render.css}</style>${html}</div></div>`;
}
const KERTAS = {};
function pasKertas() {
  $$('.paper-stage').forEach(st => {
    const k = st.dataset.paper, zw = $('.paper-zoom', st);
    if (!zw) return;
    const lebar = st.clientWidth - 28, halaman = $('.dk-page', zw);
    if (!halaman) return;
    const w = halaman.classList.contains('landscape') ? 1123 : halaman.classList.contains('kwt') ? 816 : 794;
    const z = S.zoom[k] || Math.min(1, lebar / w);
    zw.style.zoom = z;
  });
}
function cetakHTML(html, judul) {
  const pr = $('#print-root');
  pr.innerHTML = `<style>${SJ.render.css}</style>${html}`;
  document.body.classList.add('printing');
  const old = document.title; if (judul) document.title = judul;
  setTimeout(() => { window.print(); setTimeout(() => { document.body.classList.remove('printing'); pr.innerHTML = ''; document.title = old; }, 400); }, 60);
}
function unduhB64(b64, nama, mime) {
  if (mime && /html/.test(mime)) { // mode demo emulator: tampilkan pratinjau cetak
    const html = decodeURIComponent(escape(atob(b64)));
    const body = html.replace(/^[\s\S]*<body>/, '').replace(/<\/body>[\s\S]*$/, '');
    const m = modal({ title: e(nama), size: 'xl', body: kertas('dl', body, { judul: nama }), foot: '<span class="small muted grow">Mode demo: PDF dibuat oleh Google Apps Script setelah deploy.</span><button class="btn sec" data-x>Tutup</button>' });
    setTimeout(pasKertas, 30); return m;
  }
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u8], { type: mime || 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
async function unduhPDF(payload, btn) {
  sibuk(btn, true);
  try {
    const r = await api('dok.pdf', payload);
    unduhB64(r.data.data, r.data.nama, r.data.mime || 'application/pdf');
    if (!/html/.test(r.data.mime || '')) toast('PDF "' + r.data.nama + '" diunduh' + (r.data.fileId ? ' dan diarsipkan ke Drive.' : '.'), 'ok');
  } catch (err) { toast(err.message, 'bad', 8000); } finally { sibuk(btn, false); }
}
async function pdfDariHTML(html, nama, btn) {
  sibuk(btn, true);
  try { const r = await api('dok.pdfHtml', { html: html, nama: nama }); unduhB64(r.data.data, r.data.nama, r.data.mime || 'application/pdf'); }
  catch (err) { toast(err.message, 'bad'); } finally { sibuk(btn, false); }
}
// Ekspor Excel di klien (SheetJS dimuat saat pertama dipakai) — fallback CSV
function muatSkrip(url) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function eksporXLSX(namaFile, sheetNama, kolom, rows, judul) {
  const aoa = [];
  if (judul) { aoa.push([judul]); aoa.push([]); }
  aoa.push(kolom.map(k => k[1]));
  rows.forEach(r => aoa.push(kolom.map(k => { const v = r[k[0]]; return typeof v === 'number' ? v : (v === undefined || v === null ? '' : String(v)); })));
  try {
    if (!window.XLSX) await muatSkrip('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = kolom.map(k => ({ wch: Math.min(40, Math.max(10, k[1].length + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetNama.slice(0, 30));
    XLSX.writeFile(wb, namaFile + '.xlsx');
    toast('Excel "' + namaFile + '.xlsx" diunduh (' + rows.length + ' baris).', 'ok');
  } catch (err) {
    const csv = aoa.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = namaFile + '.csv'; a.click();
    toast('Pustaka Excel tidak dapat dimuat; diunduh sebagai CSV.', 'warn');
  }
}
function fileB64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); }); }
/** Kompres foto bukti di klien agar unggah cepat di jaringan seluler. */
async function kompresGambar(file, maks) {
  if (!/^image\/(jpe?g|png|webp)$/.test(file.type) || file.size < 400 * 1024) return { data: await fileB64(file), type: file.type };
  const url = await fileB64(file), img = new Image();
  await new Promise(r => { img.onload = r; img.src = url; });
  const s = Math.min(1, (maks || 1600) / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', 0.82), type: 'image/jpeg' };
}
function pilihBerkas(accept) {
  return new Promise(res => { const f = $('#file-pick'); f.value = ''; f.accept = accept || ''; f.onchange = () => res(f.files[0] || null); f.click(); });
}

// ---------------------------------------------------------------------
// Router SPA (0 ms, tanpa reload, aman di iframe) & navigasi
// ---------------------------------------------------------------------
const MENU = [
  { id: 'dashboard', ic: 'dashboard', lbl: 'Dashboard', r: '*' },
  { id: 'st', ic: 'assignment', lbl: 'Surat Tugas', r: [RL.SA, RL.OP, RL.VR, RL.PM, RL.PL] },
  { id: 'spd', ic: 'commute', lbl: 'SPD (Surat Perjalanan)', r: [RL.SA, RL.OP, RL.VR, RL.PM, RL.PL] },
  { id: 'rincian', ic: 'calculate', lbl: 'Rincian Biaya', r: '*' },
  { id: 'kuitansi', ic: 'receipt_long', lbl: 'Kuitansi', r: '*' },
  { id: 'spj', ic: 'verified', lbl: 'SPJ & Verifikasi', r: '*', badge: () => badgeSPJ() },
  { id: 'anggaran', ic: 'account_balance_wallet', lbl: 'Sisa Anggaran', r: [RL.SA, RL.OP, RL.VR, RL.PM] },
  { id: 'rekap', ic: 'summarize', lbl: 'Rekapitulasi', r: '*' },
  { id: 'crm', ic: 'forum', lbl: 'CRM & Notifikasi', r: [RL.SA] },
  { id: 'pengaturan', ic: 'settings', lbl: 'Pengaturan', r: [RL.SA] }
];
const JUDUL = { dashboard: 'Dashboard', st: 'Surat Tugas', spd: 'Surat Perjalanan Dinas', rincian: 'Rincian Biaya', kuitansi: 'Kuitansi', spj: 'SPJ & Verifikasi', anggaran: 'Laporan Sisa Anggaran', rekap: 'Rekapitulasi', crm: 'CRM & Notifikasi', pengaturan: 'Pengaturan', profil: 'Profil Saya' };
const boleh = id => { if (id === 'profil') return true; const m = MENU.find(x => x.id === id); return !!m && (m.r === '*' || m.r.indexOf(role()) > -1); };
function badgeSPJ() {
  const d = S.D.SPJ || [];
  if (isVR() || isSA()) return d.filter(j => j.Status === 'Lengkap' && inOPD(j)).length;
  if (isOP() || isPL()) return d.filter(j => (j.Status === 'Dikembalikan' || j.Status === 'Belum Diunggah') && inOPD(j) && (!isPL() || (SJ.one(S.D.SPD, 'ID', j.SPDID) || {}).Status === 'Terbit')).length;
  return 0;
}
function renderNav() {
  const items = MENU.filter(m => boleh(m.id));
  $('#side-nav').innerHTML = items.map(m => {
    const b = m.badge ? m.badge() : 0;
    return `<button class="nav-a ${S.route === m.id ? 'on' : ''}" data-act="go" data-r="${m.id}" title="${e(m.lbl)}" ${S.route === m.id ? 'aria-current="page"' : ''}>${ic(m.ic)}<span class="lbl">${e(m.lbl)}</span>${b ? `<span class="nav-badge">${b}</span>` : ''}</button>`;
  }).join('');
  const bn = (isPL() ? ['dashboard', 'spj', 'kuitansi', 'rekap'] : isVR() ? ['dashboard', 'spj', 'anggaran', 'rekap'] : ['dashboard', 'st', 'spj', 'rekap']).filter(boleh);
  $('#bottomnav').innerHTML = bn.map(id => { const m = MENU.find(x => x.id === id), b = m.badge ? m.badge() : 0; return `<button class="bn ${S.route === id ? 'on' : ''}" data-act="go" data-r="${id}">${ic(m.ic)}<span>${e(m.lbl.split(' ')[0])}</span>${b ? `<span class="nav-badge">${b}</span>` : ''}</button>`; }).join('') +
    `<button class="bn" data-act="ui.drawer">${ic('menu')}<span>Menu</span></button>`;
  // Pengalih OPD & tahun
  const sw = $('#opd-switch');
  if (lihatSemua()) {
    sw.hidden = false;
    sw.innerHTML = ['Semua'].concat((S.D.Instansi || []).filter(i => i.Status !== 'Nonaktif').map(i => i.Kode)).map(o => `<button class="${S.opd === o ? 'on' : ''}" data-act="ui.opd" data-o="${e(o)}" role="tab" aria-selected="${S.opd === o}">${e(o)}</button>`).join('');
  } else { sw.hidden = false; sw.innerHTML = `<button class="on" disabled>${e(S.user.OPD || 'OPD')}</button>`; }
  const ys = $('#year-sel'), yrs = Array.from(new Set((S.tahunList || []).concat([S.tahun, new Date().getFullYear()]))).sort();
  ys.innerHTML = yrs.map(y => `<option value="${y}" ${y == S.tahun ? 'selected' : ''}>TA ${y}</option>`).join('');
  $('#notif-dot').hidden = !daftarNotif().length;
}
function go(r, params, opt) {
  opt = opt || {};
  if (!boleh(r)) r = 'dashboard';
  if (!opt.noHist && S.route && S.route !== r) { S.hist.push(S.route); if (S.hist.length > 30) S.hist.shift(); }
  S.route = r;
  if (params) S.pg[r] = Object.assign(S.pg[r] || {}, params);
  $$('.page').forEach(p => p.classList.toggle('on', p.id === 'page-' + r));
  document.body.classList.remove('drawer');
  $('#crumb-page').textContent = JUDUL[r] || '';
  $('#btn-back').hidden = !(S.hist.length && r !== 'dashboard');
  renderNav(); renderPage(r);
  window.scrollTo(0, 0);
}
function renderPage(r) {
  const el = $('#page-' + r), P = PAGES[r];
  if (!el || !P) return;
  try { P.render(el); } catch (err) { console.error(err); el.innerHTML = `<div class="callout bad">${ic('error')}<div><b>Halaman gagal dirender.</b><div class="small">${e(err.message)}</div></div></div>`; }
  setTimeout(pasKertas, 0);
}
function refresh() { if (!S.user) return; renderNav(); renderPage(S.route); }
const PAGES = {};
const ACT = {};   // aksi klik delegasi: data-act="nama"
const INP = {};   // aksi input delegasi: data-in="nama"

// ---------------------------------------------------------------------
// Delegasi event global
// ---------------------------------------------------------------------
document.addEventListener('click', ev => {
  let el = ev.target.closest('[data-act],[data-stop]');
  if (el && !el.dataset.act) el = null;   // area [data-stop]: klik di sela tombol tidak memicu aksi baris
  if (!el || el.disabled) {
    if (!ev.target.closest('#notif-menu,#user-menu,[data-act="ui.notif"],[data-act="ui.user"]')) { $('#notif-menu').innerHTML = ''; $('#user-menu').innerHTML = ''; }
    if (!ev.target.closest('.ac-wrap')) $$('.ac-list').forEach(x => x.remove());
    return;
  }
  const fn = ACT[el.dataset.act];
  if (fn) { ev.preventDefault(); try { const r = fn(el, ev); if (r && r.catch) r.catch(() => { }); } catch (err) { console.error(err); toast(err.message, 'bad'); } }
});
const onInput = ev => {
  const el = ev.target.closest('[data-in]');
  if (!el) return;
  const fn = INP[el.dataset.in];
  if (fn) fn(el, ev);
};
document.addEventListener('input', onInput);
document.addEventListener('change', ev => { const el = ev.target.closest('[data-in]'); if (el && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'date' || el.dataset.change)) onInput(ev); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && MODALS.length) MODALS[MODALS.length - 1].close();
  if (ev.key === 'Escape') document.body.classList.remove('drawer');
});
window.addEventListener('resize', debounce(() => { pasKertas(); }, 120));
window.addEventListener('offline', () => { if (!$('.offline')) document.body.insertAdjacentHTML('beforeend', `<div class="offline">${ic('cloud_off', 'sm')} Anda sedang offline — data tampil dari cache.</div>`); });
window.addEventListener('online', () => { const o = $('.offline'); if (o) o.remove(); sinkron(true); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.sync && Date.now() - S.sync > 120000 && !S.pending) sinkron(true); });

ACT.go = el => go(el.dataset.r, el.dataset.p ? JSON.parse(el.dataset.p) : null);
ACT['ui.back'] = () => { const r = S.hist.pop(); go(r || 'dashboard', null, { noHist: true }); };
ACT['ui.drawer'] = () => document.body.classList.toggle('drawer');
ACT['ui.theme'] = () => {
  const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', n);
  try { localStorage.setItem('sj_theme', n); } catch (err) { /* abaikan */ }
  $('#theme-ic').textContent = n === 'dark' ? 'light_mode' : 'dark_mode';
  refresh();
};
ACT['ui.opd'] = el => { S.opd = el.dataset.o; refresh(); };
ACT['paper.zoom'] = el => {
  const k = el.dataset.k, st = $(`.paper-stage[data-paper="${k}"]`);
  const cur = S.zoom[k] || parseFloat(($('.paper-zoom', st) || {}).style ? $('.paper-zoom', st).style.zoom : 1) || 1;
  S.zoom[k] = Math.max(0.3, Math.min(2, Math.round((cur + 0.1 * Number(el.dataset.d)) * 10) / 10));
  pasKertas();
  const lbl = el.parentElement.querySelector('.mono'); if (lbl) lbl.textContent = Math.round(S.zoom[k] * 100) + '%';
};
ACT['paper.print'] = el => { const st = $(`.paper-stage[data-paper="${el.dataset.k}"] .paper-zoom`); if (st) cetakHTML(st.innerHTML.replace(/<style>[\s\S]*?<\/style>/, ''), 'SI-JADIN'); };
ACT['ui.sync'] = () => sinkron(false);
document.addEventListener('change', ev => { if (ev.target.id === 'year-sel') gantiTahun(Number(ev.target.value)); });
function gantiTahun(y) {
  S.tahun = y;
  const c = bacaCache(S.user.ID, y);
  if (c) { S.D = c.D; S.log = c.log || []; refresh(); }
  sinkron(true).then(() => toast('Tahun anggaran ' + y + ' dimuat.', 'ok', 2000));
}

// ---------------------------------------------------------------------
// Pemberitahuan (dihitung di klien) & menu akun
// ---------------------------------------------------------------------
function daftarNotif() {
  if (!S.user || !S.D.SPJ) return [];
  const out = [], D = S.D;
  if (isVR() || isSA()) D.SPJ.filter(j => j.Status === 'Lengkap' && inOPD(j)).forEach(j => { const s = spdOf(j.SPDID); if (s) out.push({ ic: 'pending_actions', c: 'info', t: 'SPJ menunggu verifikasi', d: s.Nomor + ' · ' + nmPeg(s.PelaksanaNIP), r: 'spj', p: { id: s.ID } }); });
  if (isOP() || isPL() || isSA()) D.SPJ.filter(j => j.Status === 'Dikembalikan' && inOPD(j)).forEach(j => { const s = spdOf(j.SPDID); if (s) out.push({ ic: 'assignment_return', c: 'bad', t: 'SPJ dikembalikan', d: (s.Nomor || '') + ' — ' + (j.Catatan || ''), r: 'spj', p: { id: s.ID } }); });
  if (isPM() || isSA()) D.Surat_Tugas.filter(s => s.Status === 'Diajukan' && inOPD(s)).forEach(s => out.push({ ic: 'approval', c: 'gold', t: 'Surat Tugas menunggu persetujuan', d: s.Kegiatan, r: 'st', p: { id: s.ID, mode: 'form' } }));
  if (!isPL()) SJ.laporan(D, { tahun: S.tahun }).filter(l => l.status !== 'Aman' && inOPD(l)).forEach(l => out.push({ ic: 'warning', c: 'warn', t: 'Pagu ' + l.status + ' (' + l.persen.toFixed(1) + '%)', d: l.subKegiatan, r: 'anggaran' }));
  const besok = SJ.tambahHari(SJ.hariIni(), 1);
  D.SPD.filter(s => s.Status === 'Terbit' && SJ.iso(s.TglBerangkat) === besok && inOPD(s)).forEach(s => out.push({ ic: 'flight_takeoff', c: 'pri', t: 'Berangkat besok', d: nmPeg(s.PelaksanaNIP) + ' → ' + (SJ.by(D.SPD_Tujuan, 'SPDID', s.ID)[0] || {}).TempatTujuan, r: 'spd', p: { id: s.ID } }));
  return out;
}
ACT['ui.notif'] = () => {
  const m = $('#notif-menu'); $('#user-menu').innerHTML = '';
  if (m.innerHTML) { m.innerHTML = ''; return; }
  const n = daftarNotif();
  m.innerHTML = `<div class="menu" style="width:340px;max-width:calc(100vw - 24px)"><div class="row between" style="padding:6px 8px 8px"><b>Pemberitahuan</b><span class="pill neu nodot">${n.length}</span></div>
    ${n.length ? n.slice(0, 12).map((x, i) => `<div class="notif-item" data-act="ui.notifGo" data-i="${i}"><span class="feed-ic kpi-ico ${x.c === 'bad' ? 'r' : x.c === 'warn' || x.c === 'gold' ? 'y' : x.c === 'info' ? 'b' : 'g'}" style="width:32px;height:32px">${ic(x.ic, 'sm')}</span><div class="grow"><div class="b small">${e(x.t)}</div><div class="xs muted trunc">${e(x.d)}</div></div></div>`).join('') : empty('notifications_off', 'Tidak ada pemberitahuan.')}</div>`;
  S._notif = n;
};
ACT['ui.notifGo'] = el => { const x = S._notif[Number(el.dataset.i)]; $('#notif-menu').innerHTML = ''; go(x.r, x.p || {}); };
ACT['ui.user'] = () => {
  const m = $('#user-menu'); $('#notif-menu').innerHTML = '';
  if (m.innerHTML) { m.innerHTML = ''; return; }
  m.innerHTML = `<div class="menu"><div style="padding:8px 10px"><div class="b">${e(S.user.Nama)}</div><div class="xs muted">${e(SJ.PERAN[role()] || role())}${S.user.OPD ? ' · ' + e(S.user.OPD) : ''}</div></div>
    <button data-act="go" data-r="profil">${ic('person')} Profil & kata sandi</button>
    <button data-act="ui.sync">${ic('sync')} Muat ulang data</button>
    ${!terpasang() ? `<button data-act="ui.pwa">${ic('install_mobile')} Pasang aplikasi</button>` : ''}
    <button data-act="auth.logout">${ic('logout')} Keluar</button></div>`;
};
// ---------------------------------------------------------------------
// PWA: pasang aplikasi, service worker, notifikasi versi baru
// ---------------------------------------------------------------------
let promptPasang = null;
const terpasang = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); promptPasang = ev; });
window.addEventListener('appinstalled', () => { promptPasang = null; toast('SI-JADIN terpasang di perangkat ini.', 'ok'); });
ACT['ui.pwa'] = async () => {
  $('#user-menu').innerHTML = '';
  if (promptPasang) {
    promptPasang.prompt();
    try { await promptPasang.userChoice; } catch (err) { /* abaikan */ }
    promptPasang = null; return;
  }
  const url = urlFrontend(), iOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  modal({ title: 'Pasang SI-JADIN', size: 'sm', body: `<ol class="small" style="padding-left:18px;margin:0 0 12px;line-height:1.7">${iOS
      ? '<li>Buka alamat ini di <b>Safari</b>.</li><li>Ketuk <b>Bagikan</b> (kotak dengan panah ke atas).</li><li>Pilih <b>Tambahkan ke Layar Utama</b> → <b>Tambah</b>.</li>'
      : '<li>Buka alamat ini di <b>Chrome</b> atau <b>Edge</b>.</li><li>Ketuk menu <b>⋮</b> → <b>Instal aplikasi</b> / <b>Tambahkan ke layar utama</b>.</li><li>Di komputer: klik ikon instal di ujung kanan bilah alamat.</li>'}</ol>
    <div class="field"><input class="inp" readonly value="${e(url)}" aria-label="Alamat aplikasi"></div>
    <img alt="QR alamat aplikasi untuk dibuka di HP" style="display:block;margin:14px auto 0;width:180px;height:180px" src="https://quickchart.io/qr?size=200&margin=1&text=${encodeURIComponent(url)}">`, foot: '<button class="btn pri" data-x>Selesai</button>' });
};
if ('serviceWorker' in navigator && !window.__SJ_TRANSPORT && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      const tawarkan = sw => {
        const t = toast('Versi baru SI-JADIN tersedia.', 'info', 0);
        if (t && t.querySelector) { const b = document.createElement('button'); b.className = 'btn sm pri'; b.textContent = 'Muat ulang'; b.style.marginLeft = '8px'; b.onclick = () => { window.__sjPerbarui = true; sw.postMessage('SKIP_WAITING'); }; t.insertBefore(b, $('.x', t)); }
      };
      if (reg.waiting && navigator.serviceWorker.controller) tawarkan(reg.waiting);
      reg.addEventListener('updatefound', () => { const sw = reg.installing; if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) tawarkan(sw); }); });
    }).catch(err => console.warn('Service worker tidak aktif:', err));
    // Muat ulang HANYA bila pengguna memilih "Muat ulang" (bukan saat SW pertama kali aktif)
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (window.__sjPerbarui) { window.__sjPerbarui = false; location.reload(); } });
  });
}

// ---------------------------------------------------------------------
// Autentikasi & boot (instan dari cache bila ada)
// ---------------------------------------------------------------------
function tampil(id) { ['screen-login', 'screen-app', 'screen-verify'].forEach(s => { $('#' + s).hidden = s !== id; }); const sp = $('#splash'); if (sp && !sp.classList.contains('hide')) { sp.classList.add('hide'); setTimeout(() => sp.remove(), 300); } }
function mulaiApp() {
  $('#brand-name').textContent = S.cfg.APP_NAME || 'SI-JADIN';
  $('#crumb-pemda').textContent = S.cfg.NAMA_PEMDA || 'Pemerintah Kab. Cianjur';
  $('#side-nm').textContent = S.user.Nama; $('#side-rl').textContent = (SJ.PERAN[role()] || role()) + (S.user.OPD ? ' · ' + S.user.OPD : '');
  $('#side-av').textContent = inisial(S.user.Nama); $('#top-av').textContent = inisial(S.user.Nama);
  $('#theme-ic').textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light_mode' : 'dark_mode';
  tampil('screen-app');
  go(S.route || 'dashboard', null, { noHist: true });
  if (S.user.Darurat) setTimeout(() => toast('Anda masuk dengan AKSES DARURAT. Pulihkan akun Superadmin di Pengaturan → Pengguna & Peran, lalu keluar.', 'warn', 12000), 800);
  if (S.user.WajibGantiSandi && !sessionStorage.getItem('sj_skip_pw')) setTimeout(() => toast('Demi keamanan, segera ganti kata sandi bawaan Anda (menu Profil).', 'warn', 9000), 800);
}
function sesiHabis() {
  if (!S.token) return;
  S.token = null; try { localStorage.removeItem('sj_tok'); } catch (err) { /* abaikan */ }
  toast('Sesi berakhir. Silakan masuk kembali.', 'warn', 6000);
  bukaLogin();
}
function bukaLogin() {
  tampil('screen-login');
  const f = $('#login-form');
  f.onsubmit = async ev => {
    ev.preventDefault();
    const u = $('#lg-user').value.trim(), p = $('#lg-pass').value;
    $('#lg-err').textContent = '';
    if (!u || !p) { $('#lg-err').textContent = 'Isi nama pengguna dan kata sandi.'; return; }
    const btn = $('#lg-btn'); sibuk(btn, true);
    try {
      const r = await api('auth.login', { username: u, password: p, tahun: S.tahun });
      S.token = r.data.token; try { localStorage.setItem('sj_tok', S.token); } catch (err) { /* abaikan */ }
      terapkanBoot(r.data.boot); S.route = 'dashboard'; S.hist = [];
      $('#lg-pass').value = '';
      mulaiApp();
      toast('Selamat datang, ' + S.user.Nama + '.', 'ok', 2500);
    } catch (err) { console.error(err); $('#lg-err').textContent = err.message; } finally { sibuk(btn, false); }
  };
  $('#lg-eye').onclick = () => { const i = $('#lg-pass'); i.type = i.type === 'password' ? 'text' : 'password'; $('#lg-eye').innerHTML = ic(i.type === 'password' ? 'visibility' : 'visibility_off'); };
  api('app.info', {}, { silent: true }).then(r => {
    if (r.data.demo) {
      $('#demo-box').hidden = false;
      $('#demo-acc').innerHTML = [['admin', 'Superadmin'], ['operator.bkad', 'Operator BKAD'], ['bendahara', 'Verifikator'], ['pimpinan', 'Pimpinan/PPK'], ['rina', 'Pelaksana'], ['operator.bkpsdm', 'Operator BKPSDM']]
        .map(a => `<button type="button" class="btn sec sm" data-demo="${a[0]}">${ic('person', 'sm')} ${a[1]}</button>`).join('');
      $('#demo-lbl').textContent = r.data.sandiDemo ? 'Akun demo — klik untuk masuk' : 'Akun contoh — sandi ada di Log eksekusi setup';
      $$('[data-demo]').forEach(b => b.onclick = () => {
        $('#lg-user').value = b.dataset.demo;
        if (r.data.sandiDemo) { $('#lg-pass').value = r.data.sandiDemo; f.requestSubmit ? f.requestSubmit() : f.onsubmit(new Event('submit')); }
        else $('#lg-pass').focus();
      });
    }
  }).catch(() => { });
  setTimeout(() => $('#lg-user').focus(), 50);
}
ACT['auth.logout'] = async () => {
  if (!(await konfirmasi('Keluar dari SI-JADIN? Data cache lokal pada perangkat ini akan dihapus.', { ok: 'Keluar' }))) return;
  api('auth.logout', {}, { silent: true }).catch(() => { });
  try { Object.keys(localStorage).filter(k => k.indexOf('sj_cache_') === 0 || k.indexOf('sj_draf_') === 0).forEach(k => localStorage.removeItem(k)); localStorage.removeItem('sj_tok'); localStorage.removeItem('sj_last'); } catch (err) { /* abaikan */ }
  S.token = null; S.user = null; S.D = {}; S.route = 'dashboard';
  bukaLogin();
};
async function verifikasiPublik(kode) {
  tampil('screen-verify');
  const box = $('#screen-verify');
  box.innerHTML = `<div class="card pad" style="max-width:520px;width:100%"><div class="row gap12"><div class="logo-mark">${ic('verified_user')}</div><div><div class="label">Verifikasi Dokumen</div><div class="bb lg-t">SI-JADIN</div></div></div><div class="mt16"><div class="skel" style="height:80px"></div></div></div>`;
  try {
    const d = (await api('publik.verifikasi', { kode: kode })).data;
    box.querySelector('.mt16').innerHTML = d.valid ? `<div class="callout ok">${ic('verified', 'fill')}<div><b>Dokumen ASLI terdaftar di SI-JADIN</b><div class="small">Kode ${e(kode)}</div></div></div>
      <div class="kv mt16" style="grid-template-columns:1fr">${[['Jenis', d.jenis], ['Nomor', d.nomor], ['Tanggal', d.tanggal], ['Status', d.status], ['Perihal', d.perihal], ['Nama', d.nama], ['OPD', d.opd], ['Nominal', d.nominal]].filter(x => x[1]).map(x => `<div><div class="k">${x[0]}</div><div class="v">${e(x[1])}</div></div>`).join('')}</div>`
      : `<div class="callout bad">${ic('gpp_bad')}<div><b>Dokumen tidak ditemukan</b><div class="small">Kode verifikasi tidak terdaftar. Dokumen mungkin palsu atau kode salah ketik.</div></div></div>`;
  } catch (err) { box.querySelector('.mt16').innerHTML = `<div class="callout bad">${ic('error')}<div>${e(err.message)}</div></div>`; }
}
document.addEventListener('DOMContentLoaded', () => {
  const kodeV = (new URLSearchParams(location.search).get('v') || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  if (kodeV) return verifikasiPublik(kodeV);
  let tok = null, last = null;
  try { tok = localStorage.getItem('sj_tok'); last = JSON.parse(localStorage.getItem('sj_last') || 'null'); } catch (err) { /* abaikan */ }
  if (tok && last) {
    S.token = tok; S.tahun = last.tahun || S.tahun;
    const c = bacaCache(last.id, S.tahun);
    if (c && c.user) {   // tampil instan dari cache, lalu revalidasi diam-diam
      S.user = c.user; S.cfg = c.cfg || {}; S.D = c.D; S.log = c.log || []; S.tahunList = c.tahunList || []; S.notif = c.notif; S.ver = c.ver || null; S.vk = c.vk || null;
      if (!lihatSemua()) S.opd = S.user.OPD || 'Semua';
      mulaiApp(); sinkron(true); return;
    }
    api('app.bootstrap', { tahun: S.tahun }).then(r => { terapkanBoot(r.data); mulaiApp(); }).catch(() => bukaLogin());
    return;
  }
  bukaLogin();
});
// Polling adaptif (gas-scale-turbo 4.3): 45 dtk saat aktif, 5 menit saat diam, berhenti saat tab tersembunyi.
// Sinkron delta yang tidak menemukan perubahan tidak membaca sheet sama sekali di server.
let _aktifTerakhir = Date.now();
['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { _aktifTerakhir = Date.now(); }, { passive: true }));
const jedaPolling = () => (Date.now() - _aktifTerakhir < 120000 ? 45000 : 300000);
setInterval(() => {
  if (!S.token || document.hidden || S.pending || !S.sync) return;
  if (Date.now() - S.sync >= jedaPolling()) sinkron(true);
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.sync && Date.now() - S.sync > 30000) sinkron(true); });
window.addEventListener('online', () => { if (S.token) sinkron(true); });

// =====================================================================
// DASHBOARD
// =====================================================================
const LOG_IC = { ST_TERBIT: ['assignment_turned_in', 'g'], ST_BUAT: ['edit_document', 'b'], SPD_TERBIT: ['commute', 'g'], KUITANSI_TERBIT: ['receipt_long', 'y'], SPJ_VERIFIKASI: ['verified', 'g'],
  SPJ_KEMBALIKAN: ['assignment_return', 'r'], SPJ_AJUKAN: ['upload_file', 'b'], BUKTI_UNGGAH: ['attach_file', 'b'], RINCIAN_SIMPAN: ['calculate', 'b'], MASTER_UBAH: ['tune', 'y'], MASTER_VERSI_BARU: ['history', 'y'], CETAK_ST: ['print', 'b'] };
const LOG_LBL = { ST_TERBIT: 'Surat Tugas terbit', ST_BUAT: 'Draf Surat Tugas dibuat', ST_UBAH: 'Surat Tugas diubah', SPD_TERBIT: 'SPD terbit', SPD_BUAT: 'Draf SPD dibuat', KUITANSI_TERBIT: 'Kuitansi terbit', SPJ_VERIFIKASI: 'SPJ diverifikasi', SPJ_KEMBALIKAN: 'SPJ dikembalikan',
  SPJ_AJUKAN: 'SPJ diajukan', BUKTI_UNGGAH: 'Bukti diunggah', RINCIAN_SIMPAN: 'Rincian disimpan', MASTER_UBAH: 'Master data diubah', MASTER_TAMBAH: 'Master data ditambah', MASTER_VERSI_BARU: 'Versi pengaturan baru', ST_SETUJU: 'Surat Tugas disetujui', ST_TOLAK: 'Surat Tugas ditolak', SPD_BATAL: 'SPD dibatalkan', ST_BATAL: 'Surat Tugas dibatalkan' };
function relWaktu(s) {
  const d = new Date(String(s).replace(' ', 'T')); if (isNaN(d)) return s;
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'baru saja'; if (m < 60) return m + 'm lalu'; if (m < 1440) return Math.round(m / 60) + 'j lalu'; return Math.round(m / 1440) + 'h lalu';
}
function anggotaNip(spd) { return SJ.hitung.anggotaSPD(S.D, spd).map(a => String(a.NIP)); }
function insightDashboard(lap, D) {
  const out = [], th = S.tahun, nowM = new Date().getFullYear() === th ? new Date().getMonth() + 1 : 12;
  const pagu = SJ.sum(lap, l => l.pagu), real = SJ.sum(lap, l => l.total);
  if (pagu > 0) {
    const laju = real / Math.max(1, nowM), sisa = pagu - real;
    const bulanCukup = laju > 0 ? sisa / laju : 99;
    out.push(`Serapan pagu perjalanan dinas <b>${(real / pagu * 100).toFixed(1)}%</b> (${rp(real)} dari ${rp(pagu)}). Rata-rata realisasi <b>${rp(laju)}/bulan</b>; ` +
      (bulanCukup >= 12 - nowM ? `sisa pagu <b>cukup</b> hingga akhir tahun dengan laju saat ini.` : `pada laju ini sisa pagu diperkirakan <b>habis sekitar ${SJ.BULAN[Math.min(11, nowM - 1 + Math.ceil(bulanCukup))]}</b>.`));
  }
  const waspada = lap.filter(l => l.status !== 'Aman');
  if (waspada.length) out.push(`<b>${waspada.length} subkegiatan</b> berstatus waspada/habis: ${waspada.map(l => e(l.subKegiatan) + ' (' + l.persen.toFixed(0) + '%)').join(', ')}. Tinjau sebelum menerbitkan SPD baru.`);
  const men = D.SPJ.filter(j => j.Status === 'Lengkap' && inOPD(j));
  if (men.length) { const tua = men.map(j => SJ.selisihHari(String(j.DiajukanPada).slice(0, 10), SJ.hariIni())).sort((a, b) => b - a)[0]; out.push(`<b>${men.length} SPJ</b> menunggu verifikasi, yang tertua <b>${tua} hari</b>. Nilai antrean ${rp(SJ.sum(men, j => SJ.hitung.totalSPD(D, j.SPDID)))}.`); }
  const kembali = D.SPJ.filter(j => j.Status === 'Dikembalikan' && inOPD(j)).length;
  if (kembali) out.push(`<b>${kembali} SPJ</b> dikembalikan dan perlu diperbaiki operator/pelaksana.`);
  const tanpaKw = D.SPD.filter(s => s.Status === 'Terbit' && inOPD(s) && SJ.iso(s.TglKembali) < SJ.hariIni() && !D.Kuitansi.some(k => k.SPDID === s.ID && k.Status !== 'Batal'));
  if (tanpaKw.length) out.push(`<b>${tanpaKw.length} perjalanan</b> sudah selesai namun belum memiliki kuitansi terbit.`);
  const komp = {}; D.Rincian_Biaya.filter(r => { const s = spdOf(r.SPDID); return s && s.Status === 'Terbit' && inOPD(s); }).forEach(r => { const k = (SJ.KOMPONEN[r.Komponen] || {}).label || r.Komponen; komp[k] = (komp[k] || 0) + SJ.num(r.NilaiDiakui); });
  const tk = Object.keys(komp).sort((a, b) => komp[b] - komp[a]); const totK = SJ.sum(tk, k => komp[k]);
  if (tk.length && totK) out.push(`Komponen biaya terbesar: <b>${e(tk[0])}</b> (${(komp[tk[0]] / totK * 100).toFixed(0)}%)${tk[1] ? `, disusul ${e(tk[1])} (${(komp[tk[1]] / totK * 100).toFixed(0)}%)` : ''}.`);
  const freq = {}; D.SPD.filter(s => s.Status === 'Terbit' && inOPD(s)).forEach(s => anggotaNip(s).forEach(n => { freq[n] = (freq[n] || 0) + 1; }));
  const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
  if (top && freq[top] > 2) out.push(`Pegawai paling sering bertugas: <b>${e(nmPeg(top))}</b> (${freq[top]} perjalanan). Pertimbangkan pemerataan penugasan.`);
  return out.length ? out : ['Belum cukup data untuk dianalisis pada tahun anggaran ini.'];
}
PAGES.dashboard = {
  render(el) {
    if (isPL()) return this.pelaksana(el);
    const D = S.D, today = SJ.hariIni(), lap = SJ.laporan(D, { tahun: S.tahun }).filter(inOPD);
    const pagu = SJ.sum(lap, l => l.pagu), real = SJ.sum(lap, l => l.total), pct = pagu ? real / pagu * 100 : 0;
    const spdT = D.SPD.filter(s => s.Status === 'Terbit' && inOPD(s));
    const stBln = D.Surat_Tugas.filter(s => s.Status === 'Terbit' && inOPD(s) && SJ.iso(s.TanggalTerbit).slice(0, 7) === bulanIni());
    const spdBln = spdT.filter(s => SJ.iso(s.TglBerangkat).slice(0, 7) === bulanIni());
    const menunggu = D.SPJ.filter(j => j.Status === 'Lengkap' && inOPD(j));
    const aktif = spdT.filter(s => SJ.iso(s.TglBerangkat) <= today && SJ.iso(s.TglKembali) >= today);
    const orangAktif = SJ.sum(aktif, s => anggotaNip(s).length);
    const diajukan = D.Surat_Tugas.filter(s => s.Status === 'Diajukan' && inOPD(s));
    const f = S.pg.dashboard = S.pg.dashboard || { filt: 'Semua' };
    const lapT = f.filt === 'Waspada' ? lap.filter(l => l.status !== 'Aman') : lap;
    const sapa = new Date().getHours() < 11 ? 'Selamat pagi' : new Date().getHours() < 15 ? 'Selamat siang' : new Date().getHours() < 18 ? 'Selamat sore' : 'Selamat malam';
    el.innerHTML = `
    <div class="card banner mb16"><div class="row between wrap gap16" style="position:relative;z-index:1">
      <div class="col gap4"><div class="row gap8"><span class="pill ok">Sistem aktif · TA ${S.tahun}</span><span class="label">${e(S.opd === 'Semua' ? 'Semua OPD' : singkat(S.opd))}</span></div>
        <h1 style="margin:4px 0 2px;font-size:clamp(20px,2.4vw,28px);letter-spacing:-.02em">${sapa}, ${e(S.user.Nama)}</h1>
        <p class="muted" style="margin:0">Pantauan perjalanan dinas & serapan pagu TA ${S.tahun}. Sinkron terakhir ${S.sync ? relWaktu(S.sync.toISOString ? SJ.iso(S.sync) + ' ' + S.sync.toTimeString().slice(0, 8) : S.sync) : '—'}.</p></div>
      <div class="row wrap gap8"><button class="btn sec" data-act="dash.rekapBulan">${ic('file_download')} Unduh Rekap Bulan Ini</button>
        ${isSA() || isOP() ? `<button class="btn gold" data-act="st.baru">${ic('add_circle')} Buat Surat Tugas</button>` : ''}
        ${isVR() ? `<button class="btn pri" data-act="go" data-r="spj">${ic('verified')} Verifikasi SPJ</button>` : ''}</div></div></div>
    <div class="grid g4 mb16">
      <div class="card kpi"><div class="kpi-top"><div><div class="label">Sisa Pagu Total</div><div class="kpi-val mono mt8">${rp(pagu - real)}</div></div><div class="kpi-ico g">${ic('account_balance_wallet')}</div></div>
        <div><div class="row between small mb8"><span class="muted mono">Pagu ${rp(pagu)}</span><span class="b ${pct >= 90 ? 'warn-t' : 'pri-t'}">${pct.toFixed(1)}% terserap</span></div><div class="bar thick"><i class="${pct >= 100 ? 'x' : pct >= 90 ? 'w' : 'g'}" style="width:${Math.min(100, pct)}%"></i></div></div></div>
      <div class="card kpi"><div class="kpi-top"><div><div class="label">Surat Tugas Bulan Ini</div><div class="row gap8 mt8" style="align-items:baseline"><span class="kpi-val mono">${stBln.length}</span><span class="muted">surat terbit</span></div></div><div class="kpi-ico d">${ic('assignment')}</div></div>
        <div class="row gap12 small muted"><span class="row gap4"><i class="dot-s" style="background:var(--primary-hover)"></i>${spdBln.filter(s => s.Jenis === 'DK').length} Dalam Kota</span><span class="row gap4"><i class="dot-s" style="background:var(--gold)"></i>${spdBln.filter(s => s.Jenis === 'DB').length} Perjalanan Biasa</span></div></div>
      <div class="card kpi" ${menunggu.length ? 'data-act="go" data-r="spj" style="cursor:pointer"' : ''}><div class="kpi-top"><div><div class="label">SPJ Menunggu Verifikasi</div><div class="row gap8 mt8" style="align-items:baseline"><span class="kpi-val mono ${menunggu.length ? 'bad-t' : ''}">${menunggu.length}</span><span class="muted">berkas masuk</span></div></div><div class="kpi-ico r">${ic('pending_actions')}</div></div>
        <div>${menunggu.length ? `<span class="tag gold">${ic('priority_high', 'sm')} Perlu tindakan · ${rp(SJ.sum(menunggu, j => SJ.hitung.totalSPD(D, j.SPDID)))}</span>` : '<span class="small ok-t">Tidak ada antrean</span>'}</div></div>
      <div class="card kpi"><div class="kpi-top"><div><div class="label">Perjalanan Aktif Hari Ini</div><div class="row gap8 mt8" style="align-items:baseline"><span class="kpi-val mono">${orangAktif}</span><span class="muted">pegawai bertugas</span></div></div><div class="kpi-ico b">${ic('flight_takeoff')}</div></div>
        <div class="small muted trunc">${aktif.length ? 'Tujuan: ' + e(Array.from(new Set(aktif.map(s => (SJ.by(D.SPD_Tujuan, 'SPDID', s.ID)[0] || {}).KabKota))).filter(Boolean).join(', ')) : 'Tidak ada perjalanan hari ini'}</div></div>
    </div>
    ${diajukan.length && (isPM() || isSA()) ? `<div class="callout gold mb16">${ic('approval')}<div class="grow"><b>${diajukan.length} Surat Tugas menunggu persetujuan Anda</b><div class="small">${diajukan.slice(0, 3).map(s => e(s.Kegiatan)).join(' · ')}</div></div><button class="btn sm pri" data-act="go" data-r="st" data-p='{"mode":"list","status":"Diajukan"}'>Tinjau</button></div>` : ''}
    <div class="split s8-4">
      <div class="col gap16">
        <div class="card"><div class="card-h"><div><h3>Realisasi Pagu per Subkegiatan</h3><div class="small muted">Hanya SPJ terverifikasi yang mengurangi pagu</div></div>
          <div class="seg"><button class="${f.filt === 'Semua' ? 'on' : ''}" data-act="dash.filt" data-v="Semua">Semua</button><button class="${f.filt === 'Waspada' ? 'on' : ''}" data-act="dash.filt" data-v="Waspada">Waspada ≥90%</button></div></div>
          <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Subkegiatan & Rekening</th><th class="r">Pagu</th><th class="r">Realisasi</th><th class="r">Sisa</th><th style="min-width:120px">Serapan</th><th class="r">Status</th></tr></thead><tbody>
          ${lapT.length ? lapT.map(l => `<tr class="click" data-act="go" data-r="anggaran"><td><div class="b">${e(l.subKegiatan)}</div><span class="sub mono">${e(l.kodeRek)} · ${e(l.jenis)} · ${e(singkat(l.opd))}</span></td>
            <td class="r mono">${rp(l.pagu)}</td><td class="r mono ${l.status === 'Aman' ? 'ok-t' : 'bad-t'}">${rp(l.total)}</td><td class="r mono t2">${rp(l.sisa)}</td>
            <td><div class="small mono b">${l.persen.toFixed(1)}%</div><div class="bar mt4" style="margin-top:4px"><i class="${l.status === 'Habis' ? 'x' : l.status === 'Waspada' ? 'w' : ''}" style="width:${Math.min(100, l.persen)}%"></i>${l.pending ? `<i class="p" style="width:${Math.min(100 - Math.min(100, l.persen), l.pending / l.pagu * 100)}%" title="Menunggu verifikasi"></i>` : ''}</div></td>
            <td class="r">${pill(l.status)}</td></tr>`).join('') : `<tr><td colspan="6">${empty('savings', 'Belum ada pagu untuk filter ini.')}</td></tr>`}
          </tbody></table></div><div class="tbl-foot"><span>${lap.length} subkegiatan · ${S.opd === 'Semua' ? 'semua OPD' : singkat(S.opd)}</span><a href="javascript:void(0)" data-act="go" data-r="anggaran" class="b">Laporan lengkap →</a></div></div>
        <div class="card pad"><div class="row gap8 mb8">${ic('auto_awesome', 'pri-t')}<h3 style="margin:0;font-size:16px">Analisis Otomatis</h3><span class="tag pri">Dihitung dari data terkini</span></div>
          <ul class="insight small" style="margin:8px 0 0;padding-left:18px;line-height:1.6">${insightDashboard(lap, D).map(x => `<li>${x}</li>`).join('')}</ul></div>
      </div>
      <div class="col gap16">
        <div class="card pad"><div class="row between mb8"><div><h3 style="margin:0;font-size:16px">Intensitas SPD Bulanan</h3><div class="xs muted">Jumlah SPD terbit per OPD · 6 bulan terakhir</div></div></div>
          <div class="chart-box"><canvas id="ch-dash" aria-label="Grafik intensitas SPD bulanan"></canvas></div>
          <div class="row between mt12 small" style="padding:10px;border-radius:8px;background:var(--surface-2)"><span class="row gap4">${ic('trending_up', 'sm pri-t')} Total SPD TA ${S.tahun}</span><b class="mono pri-t">${spdT.length} perjalanan</b></div></div>
        <div class="card pad"><div class="row between mb8"><h3 style="margin:0;font-size:16px">Aktivitas Terkini</h3>${ic('history', 'muted')}</div>
          ${S.log.length ? S.log.slice(0, 7).map(l => { const x = LOG_IC[l.Tindakan] || ['bolt', 'b']; return `<div class="feed-i"><span class="feed-ic kpi-ico ${x[1]}">${ic(x[0], 'sm')}</span><div class="grow" style="min-width:0"><div class="row between gap8"><span class="b small trunc">${e(LOG_LBL[l.Tindakan] || l.Tindakan)}</span><span class="xs muted mono" style="flex:none">${relWaktu(l.Waktu)}</span></div><div class="xs muted trunc">${e(l.Detail || l.Rujukan)} · ${e(l.Pengguna)}</div></div></div>`; }).join('') : empty('history', 'Belum ada aktivitas.')}
          ${isSA() || isVR() || isPM() ? `<button class="btn sec block mt8" data-act="go" data-r="pengaturan" data-p='{"tab":"log"}'>Buka seluruh log audit ${ic('chevron_right', 'sm')}</button>` : ''}</div>
      </div>
    </div>`;
    grafikDashboard();
  },
  pelaksana(el) {
    const D = S.D, nip = String(S.user.NIP);
    const spd = D.SPD.filter(s => s.Status === 'Terbit').sort((a, b) => SJ.iso(b.TglBerangkat) < SJ.iso(a.TglBerangkat) ? -1 : 1);
    const terima = SJ.sum(D.Kuitansi.filter(k => k.Status !== 'Batal' && String(k.NIP) === nip), k => k.Nominal);
    const perlu = spd.filter(s => { const j = spjOf(s.ID); return j && ['Belum Diunggah', 'Dikembalikan'].indexOf(j.Status) > -1 && SJ.iso(s.TglKembali) <= SJ.hariIni(); });
    el.innerHTML = `<div class="card banner mb16"><div style="position:relative;z-index:1"><span class="pill ok">TA ${S.tahun}</span><h1 style="margin:8px 0 4px;font-size:clamp(20px,2.4vw,28px)">Halo, ${e(S.user.Nama)}</h1><p class="muted" style="margin:0">Pantau perjalanan dinas Anda, unggah bukti pengeluaran, dan lihat kuitansi.</p></div></div>
    <div class="grid g3 mb16">
      <div class="card kpi"><div class="kpi-top"><div><div class="label">Perjalanan TA ${S.tahun}</div><div class="kpi-val mono mt8">${spd.length}</div></div><div class="kpi-ico d">${ic('commute')}</div></div></div>
      <div class="card kpi"><div class="kpi-top"><div><div class="label">Total Kuitansi Diterima</div><div class="kpi-val mono mt8">${rp(terima)}</div></div><div class="kpi-ico g">${ic('payments')}</div></div></div>
      <div class="card kpi"><div class="kpi-top"><div><div class="label">SPJ Perlu Tindakan</div><div class="kpi-val mono mt8 ${perlu.length ? 'bad-t' : ''}">${perlu.length}</div></div><div class="kpi-ico r">${ic('upload_file')}</div></div></div></div>
    <div class="card"><div class="card-h"><h3>Perjalanan Saya</h3></div><div class="card-b col gap8">
      ${spd.length ? spd.map(s => { const j = spjOf(s.ID) || {}, tj = SJ.by(D.SPD_Tujuan, 'SPDID', s.ID)[0] || {}; return `<div class="list-card" data-act="go" data-r="spj" data-p='{"id":"${s.ID}"}'><div class="row between wrap gap8"><span class="mono small b pri-t">${e(s.Nomor)}</span>${pill(j.Status || 'Belum Diunggah')}</div>
        <div class="b mt8">${e(s.Maksud)}</div><div class="row wrap gap12 small muted mt8"><span class="row gap4">${ic('location_on', 'sm')}${e(tj.TempatTujuan || '')}, ${e(tj.KabKota || '')}</span><span class="row gap4">${ic('calendar_month', 'sm')}${e(SJ.rentangTgl(s.TglBerangkat, s.TglKembali))}</span><span class="row gap4">${ic('payments', 'sm')}${rp(SJ.hitung.totalOrang(D, s.ID, nip))}</span></div>
        ${j.Status === 'Dikembalikan' ? `<div class="callout bad mt8 small">${ic('info', 'sm')}<div><b>Catatan verifikator:</b> ${e(j.Catatan)}</div></div>` : ''}</div>`; }).join('') : empty('luggage', 'Belum ada perjalanan dinas pada tahun ini.')}
    </div></div>`;
  }
};
function grafikDashboard(tries) {
  const cv = $('#ch-dash'); if (!cv) return;
  if (!window.Chart) { if ((tries || 0) < 100) setTimeout(() => grafikDashboard((tries || 0) + 1), 150); return; }
  const now = new Date(), labels = [], keys = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(S.tahun, (S.tahun === now.getFullYear() ? now.getMonth() : 11) - i, 1); labels.push(SJ.BULAN_PENDEK[d.getMonth()]); keys.push(d.getFullYear() + '-' + SJ.pad(d.getMonth() + 1)); }
  const opds = (S.D.Instansi || []).map(i => i.Kode).filter(o => S.opd === 'Semua' || o === S.opd);
  const cs = getComputedStyle(document.documentElement), col = [cs.getPropertyValue('--primary').trim(), cs.getPropertyValue('--gold').trim(), '#60A5FA', '#F472B6'];
  const ds = opds.map((o, i) => ({ label: o, data: keys.map(k => S.D.SPD.filter(s => s.OPD === o && s.Status === 'Terbit' && SJ.iso(s.TglBerangkat).slice(0, 7) === k).length), backgroundColor: col[i % col.length], borderRadius: 4, maxBarThickness: 18 }));
  if (S.charts.dash) S.charts.dash.destroy();
  S.charts.dash = new Chart(cv, { type: 'bar', data: { labels: labels, datasets: ds }, options: { responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, color: cs.getPropertyValue('--muted').trim(), font: { family: 'Inter', size: 11 } } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + c.raw + ' SPD' } } },
    scales: { x: { grid: { display: false }, ticks: { color: cs.getPropertyValue('--muted').trim(), font: { size: 11 } } }, y: { beginAtZero: true, ticks: { precision: 0, color: cs.getPropertyValue('--muted').trim(), font: { size: 10 } }, grid: { color: cs.getPropertyValue('--row').trim() } } } } });
}
ACT['dash.filt'] = el => { S.pg.dashboard.filt = el.dataset.v; refresh(); };
ACT['dash.rekapBulan'] = () => {
  const m = SJ.bulanKe(SJ.hariIni()), rows = SJ.rekap(S.D).filter(r => inOPD(r) && r.tahun === S.tahun && r.bulanNum === m);
  rows.forEach((r, i) => r.no = i + 1);
  eksporXLSX('Rekap_SPD_' + SJ.BULAN[m - 1] + '_' + S.tahun, 'Rekap', SJ.REKAP_KOLOM, rows, 'REKAPITULASI PERJALANAN DINAS ' + SJ.BULAN[m - 1].toUpperCase() + ' ' + S.tahun);
};

// =====================================================================
// SURAT TUGAS (daftar + formulir dengan pratinjau A4 langsung)
// =====================================================================
const ST_KOSONG = () => ({ ID: '', OPD: isOP() ? S.user.OPD : (S.opd !== 'Semua' ? S.opd : ((S.D.Instansi || [])[0] || {}).Kode), TanggalTerbit: SJ.hariIni(), TempatTerbit: S.cfg.TEMPAT_TERBIT_DEFAULT || 'Cianjur',
  Kegiatan: '', TanggalMulai: '', TanggalSelesai: '', Tempat: '', PenandatanganID: '', dasar: [], pegawai: [] });
function stDariRecord(id) {
  const s = stOf(id); if (!s) return ST_KOSONG();
  return { ID: s.ID, OPD: s.OPD, TanggalTerbit: SJ.iso(s.TanggalTerbit), TempatTerbit: s.TempatTerbit, Kegiatan: s.Kegiatan, TanggalMulai: SJ.iso(s.TanggalMulai), TanggalSelesai: SJ.iso(s.TanggalSelesai), Tempat: s.Tempat, PenandatanganID: s.PenandatanganID,
    dasar: SJ.by(S.D.Surat_Tugas_Dasar, 'STID', id).sort((a, b) => a.Urutan - b.Urutan).map(d => ({ Kode: d.Kode, nilai: SJ.parseJSON(d.NilaiVariabel, {}) })),
    pegawai: SJ.by(S.D.ST_Pegawai, 'STID', id).sort((a, b) => a.Urutan - b.Urutan).map(x => String(x.NIP)) };
}
function stBentrok(f) {
  if (!f.TanggalMulai || !f.pegawai.length) return [];
  const out = [], sel = f.TanggalSelesai || f.TanggalMulai;
  S.D.Surat_Tugas.forEach(s => {
    if (s.ID === f.ID || s.Status === 'Batal' || s.Status === 'Ditolak') return;
    if (!SJ.rentangOverlap(f.TanggalMulai, sel, SJ.iso(s.TanggalMulai), SJ.iso(s.TanggalSelesai))) return;
    SJ.by(S.D.ST_Pegawai, 'STID', s.ID).forEach(x => { if (f.pegawai.indexOf(String(x.NIP)) > -1) out.push(nmPeg(x.NIP) + ' — ' + (s.Nomor || 'draf "' + s.Kegiatan + '"') + ' (' + SJ.rentangTgl(SJ.iso(s.TanggalMulai), SJ.iso(s.TanggalSelesai)) + ')'); });
  });
  return out;
}
function stDocData(f) {
  const s = stOf(f.ID);
  if (s && s.Status === 'Terbit' && s.Snapshot) return { d: SJ.parseJSON(s.Snapshot, {}), draf: false };
  const dasarRows = f.dasar.filter(d => d.Kode).map(d => ({ Kode: d.Kode, NilaiVariabel: JSON.stringify(d.nilai || {}) }));
  return { d: SJ.doc.st(S.D, Object.assign({}, f, { Nomor: '', Status: 'Draf' }), dasarRows, f.pegawai), draf: true };
}
PAGES.st = {
  render(el) {
    const p = S.pg.st = S.pg.st || { mode: 'list', status: 'Semua', q: '' };
    if (isPL() && p.mode === 'form' && !p.id) p.mode = 'list';
    if (p.mode === 'form' && !p.form) p.form = p.id ? stDariRecord(p.id) : (bacaDrafST() || ST_KOSONG());
    const n = S.D.Surat_Tugas.filter(inOPD).length;
    el.innerHTML = `<div class="ph"><div><div class="row gap8"><h1>Surat Tugas</h1><span class="pill pri nodot">Modul utama</span></div><p>Kelola penerbitan, dasar hukum, dan cetak naskah dinas resmi.</p></div>
      <div class="acts"><div class="seg"><button class="${p.mode === 'form' ? 'on' : ''}" data-act="st.mode" data-v="form" ${isPL() && !p.id ? 'disabled' : ''}>${ic('edit_document', 'sm')} Formulir & Pratinjau</button><button class="${p.mode === 'list' ? 'on' : ''}" data-act="st.mode" data-v="list">${ic('table_rows', 'sm')} Daftar Arsip <span class="tag">${n}</span></button></div>
      ${isSA() || isOP() ? `<button class="btn gold" data-act="st.baru">${ic('add_circle')} Buat Surat Tugas</button>` : ''}</div></div>
      <div id="st-body"></div>`;
    p.mode === 'form' ? this.form($('#st-body')) : this.list($('#st-body'));
  },
  list(box) {
    const p = S.pg.st, q = (p.q || '').toLowerCase();
    let rows = S.D.Surat_Tugas.filter(inOPD).slice().sort((a, b) => String(b.DibuatPada || b.TanggalTerbit).localeCompare(String(a.DibuatPada || a.TanggalTerbit)));
    const cnt = st => rows.filter(r => st === 'Semua' || r.Status === st).length;
    rows = rows.filter(r => (p.status === 'Semua' || r.Status === p.status) && (!p.bulan || SJ.iso(r.TanggalMulai).slice(5, 7) === p.bulan) &&
      (!q || [r.Nomor, r.Kegiatan, r.Tempat].concat(SJ.by(S.D.ST_Pegawai, 'STID', r.ID).map(x => nmPeg(x.NIP) + ' ' + x.NIP)).join(' ').toLowerCase().indexOf(q) > -1));
    box.innerHTML = `<div class="card pad-s mb16"><div class="row wrap between gap12"><div class="pills">${['Semua', 'Draf', 'Diajukan', 'Disetujui', 'Terbit', 'Batal'].map(s => `<button class="${p.status === s ? 'on' : ''}" data-act="st.status" data-v="${s}">${s} (${cnt(s)})</button>`).join('')}</div>
      <div class="row gap8 wrap" style="flex:1 1 320px;justify-content:flex-end"><select class="sel" data-in="st.bulan" style="width:auto"><option value="">Semua bulan</option>${SJ.BULAN.map((b, i) => `<option value="${SJ.pad(i + 1)}" ${p.bulan === SJ.pad(i + 1) ? 'selected' : ''}>${b}</option>`).join('')}</select>
      <div class="inp-ic" style="min-width:200px;flex:1 1 200px;max-width:340px">${ic('search')}<input class="inp" placeholder="Cari nomor, kegiatan, pegawai…" value="${e(p.q || '')}" data-in="st.q" aria-label="Cari Surat Tugas"></div></div></div></div>
      <div class="card"><div class="tbl-wrap"><table class="tbl m-card"><thead><tr><th>No. Surat & Tanggal</th><th>Maksud Tugas & Tempat</th><th data-xl>Pegawai</th><th>Pelaksanaan</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody id="st-rows">
      ${rows.length ? rows.map(r => { const pg = SJ.by(S.D.ST_Pegawai, 'STID', r.ID), spds = S.D.SPD.filter(x => x.STID === r.ID && x.Status !== 'Batal');
        return `<tr class="click" data-act="st.buka" data-id="${r.ID}"><td><span class="mono b pri-t">${e(r.Nomor || '— belum bernomor —')}</span><span class="sub">${tgl(r.TanggalTerbit)} · ${e(singkat(r.OPD))}</span></td>
        <td class="m-full" style="max-width:320px"><div class="b trunc">${e(r.Kegiatan)}</div><span class="sub row gap4">${ic('location_on', 'sm')}${e(r.Tempat)}</span></td>
        <td data-xl><div class="row gap8"><div class="avatar-stack">${pg.slice(0, 3).map(x => avatar(nmPeg(x.NIP))).join('')}</div><span class="xs muted">${pg.length} org</span></div></td>
        <td><div class="small">${e(SJ.rentangTgl(r.TanggalMulai, r.TanggalSelesai))}</div><span class="sub">${SJ.lamaHari(r.TanggalMulai, r.TanggalSelesai)} hari</span></td>
        <td>${pill(r.Status)}${spds.length ? `<span class="sub">${spds.length} SPD</span>` : ''}${r._pending ? '<span class="sub"><i class="pending-dot"></i> sinkron…</span>' : ''}</td>
        <td class="r m-full m-act" data-stop><div class="row gap4" style="justify-content:flex-end">
          <button class="btn ghost icon sm" data-act="st.buka" data-id="${r.ID}" aria-label="Lihat">${ic('visibility', 'sm')}</button>
          ${r.Status === 'Terbit' ? `<button class="btn ghost icon sm" data-act="st.pdf" data-id="${r.ID}" aria-label="Unduh PDF" data-busy="">${ic('picture_as_pdf', 'sm')}</button>` : ''}
          ${r.Status === 'Terbit' && bisaTulis(r.OPD) ? `<button class="btn soft sm" data-act="spd.dariST" data-id="${r.ID}">${ic('commute', 'sm')} SPD</button>` : ''}</div></td></tr>`; }).join('') : `<tr><td colspan="6">${empty('assignment', 'Tidak ada Surat Tugas untuk filter ini.', isSA() || isOP() ? '<button class="btn pri sm" data-act="st.baru">Buat Surat Tugas</button>' : '')}</td></tr>`}
      </tbody></table></div><div class="tbl-foot"><span>Menampilkan ${rows.length} Surat Tugas</span><span>Nomor dikunci otomatis (LockService) saat terbit</span></div></div>`;
  },
  form(box) {
    const p = S.pg.st, f = p.form, rec = f.ID ? stOf(f.ID) : null, status = rec ? rec.Status : 'Draf';
    const ro = (rec && ['Terbit', 'Batal'].indexOf(status) > -1) || !bisaTulis(f.OPD) || isPL();
    const pejabat = SJ.lookup.pilihanTTD(S.D, f.OPD, 'ST', f.TanggalTerbit || SJ.hariIni());
    if (f.PenandatanganID && !pejabat.some(j => j.ID === f.PenandatanganID)) { const lm = SJ.lookup.pejabatById(S.D, f.PenandatanganID); if (lm) pejabat.push(lm); }
    if (!f.PenandatanganID) { const k = SJ.lookup.pejabat(S.D, f.OPD, 'KEPALA', SJ.hariIni()); if (k) f.PenandatanganID = k.ID; }
    const opsiDasar = SJ.lookup.pilihanDasar(S.D, f.OPD);
    const optDasar = sel => opsiDasar.map(m => `<option value="${e(m.Kode)}" ${m.Kode === sel ? 'selected' : ''}>${e(m.label)}</option>`).join('') +
      `<option value="${SJ.DASAR_BEBAS}" ${sel === SJ.DASAR_BEBAS ? 'selected' : ''}>Lainnya — ketik teks dasar sendiri</option>`;
    const wajibSetuju = S.cfg.WAJIB_PERSETUJUAN_ST === 'YA';
    const dis = ro ? 'disabled' : '';
    box.innerHTML = `<div class="split s7-5"><div class="col gap16">
      <div class="card pad-s"><div class="row between wrap gap12"><div class="row gap12"><div class="kpi-ico g">${ic(status === 'Terbit' ? 'lock' : 'lock_clock')}</div><div><div class="label">Nomor naskah otomatis</div>
        <div class="mono b pri-t">${rec && rec.Nomor ? e(rec.Nomor) : 'Terbit otomatis saat diterbitkan (tidak dapat ganda)'}</div></div></div>
        <div class="row gap8">${pill(status)}${isSA() && !rec ? `<select class="sel" data-in="st.f" data-k="OPD" style="width:auto">${S.D.Instansi.map(i => `<option ${i.Kode === f.OPD ? 'selected' : ''}>${e(i.Kode)}</option>`).join('')}</select>` : `<span class="tag">${e(singkat(f.OPD))}</span>`}</div></div>
        ${rec && rec.CatatanPersetujuan ? `<div class="callout ${status === 'Ditolak' ? 'bad' : 'info'} mt12 small">${ic('comment', 'sm')}<div><b>Catatan pimpinan:</b> ${e(rec.CatatanPersetujuan)}</div></div>` : ''}</div>
      <div class="card pad"><div class="row between mb16"><div class="sec-title"><span class="sec-num">1</span>Dasar Surat Tugas</div><span class="tag">${f.dasar.length}/3 butir</span></div>
        <div class="col gap12" id="st-dasar">${f.dasar.map((d, i) => { const vars = SJ.lookup.variabelDasar(S.D, f.OPD, d.Kode), bebas = d.Kode === SJ.DASAR_BEBAS; return `<div style="padding:14px;border-radius:10px;background:var(--surface-2)">
          <div class="row gap8 mb8" style="align-items:flex-end"><div class="field grow" style="min-width:0"><label for="st-dk-${i}">Dasar ${i + 1}</label><select class="sel" id="st-dk-${i}" data-in="st.dkode" data-i="${i}" ${dis}>${optDasar(d.Kode)}</select></div>
          ${ro ? '' : `<button class="btn ghost icon sm" data-act="st.dhapus" data-i="${i}" aria-label="Hapus dasar ${i + 1}" style="margin-bottom:4px">${ic('delete', 'sm')}</button>`}</div>
          ${bebas ? `<div class="field"><label for="st-dv-${i}-teks">Teks dasar</label><textarea class="ta" id="st-dv-${i}-teks" data-in="st.dvar" data-i="${i}" data-v="teks" ${dis} maxlength="600" placeholder="Contoh: Surat Sekretaris Daerah Kabupaten Cianjur Nomor 000/123/Org tanggal 10 November 2026 perihal …">${e((d.nilai || {}).teks || '')}</textarea></div>`
            : `<div class="fgrid ${vars.length > 2 ? 'c4' : 'c3'}">${vars.map(v => `<div class="field"><label for="st-dv-${i}-${v}">${e(LABEL_VAR_DASAR[v] || v.charAt(0).toUpperCase() + v.slice(1))}</label><input class="inp" id="st-dv-${i}-${v}" ${v === 'tanggal' ? 'type="date"' : v === 'tahun' ? 'inputmode="numeric" maxlength="4"' : ''} data-in="st.dvar" data-i="${i}" data-v="${v}" value="${e((d.nilai || {})[v] || '')}" ${dis}></div>`).join('')}</div>`}
          ${bebas ? '' : `<div class="small muted mt8" id="st-dtxt-${i}">${e(SJ.lookup.dasarTeks(S.D, f.OPD, d.Kode, d.nilai))}</div>`}</div>`; }).join('') || '<div class="small muted">Belum ada dasar. Pilih dari daftar di bawah — Anda cukup mengisi nomor, tanggal, dan perihal.</div>'}</div>
        ${ro ? '' : f.dasar.length < 3 ? `<div class="field mt12"><label for="st-dpilih">Tambah dasar Surat Tugas</label><select class="sel" id="st-dpilih" data-in="st.dpilih">
            <option value="">— Pilih dasar surat tugas (${f.dasar.length}/3) —</option>${optDasar('')}</select>
            <span class="hint">Daftar berasal dari Pengaturan → Dasar Surat Tugas (bisa ditambah Superadmin). Pilih "Lainnya" untuk mengetik dasar sendiri.</span></div>`
          : `<div class="hint mt12">${ic('check_circle', 'sm')} Sudah 3 dasar (maksimal). Hapus salah satu untuk mengganti.</div>`}</div>
      <div class="card pad"><div class="row between mb16"><div class="sec-title"><span class="sec-num">2</span>Pegawai yang Ditugaskan</div><span class="tag">${f.pegawai.length} orang</span></div>
        <div class="col gap8">${f.pegawai.map((nip, i) => { const pg = peg(nip) || {}; return `<div class="chip"><span class="mono muted b" style="width:18px">${i + 1}</span>${avatar(nmPeg(nip))}<div class="grow" style="min-width:0"><div class="b trunc">${e(nmPeg(nip))}</div><div class="xs muted trunc">NIP ${e(SJ.fmtNip(nip))} · ${e(pg.Pangkat || pg.StatusPegawai || '')} ${pg.Golongan ? '(' + e(pg.Golongan) + ')' : ''} · ${e(pg.Jabatan || '')}</div></div>
          ${SJ.lookup.isEselonII(pg) ? '<span class="tag gold">Eselon II</span>' : ''}${ro ? '' : `<button class="btn ghost icon sm" data-act="st.pdel" data-i="${i}" aria-label="Hapus pegawai">${ic('close', 'sm')}</button>`}</div>`; }).join('')}
        ${ro ? '' : `<div class="ac-wrap" style="position:relative"><div class="inp-ic">${ic('person_add')}<input class="inp" id="st-cari" placeholder="Ketik nama atau NIP pegawai untuk menambahkan…" data-in="st.cari" autocomplete="off" aria-label="Cari pegawai"></div></div>`}
        <div id="st-bentrok"></div></div></div>
      <div class="card pad"><div class="row between mb16"><div class="sec-title"><span class="sec-num">3</span>Maksud & Pelaksanaan</div><span class="tag pri" id="st-lama">${f.TanggalMulai ? SJ.lamaHari(f.TanggalMulai, f.TanggalSelesai || f.TanggalMulai) + ' hari' : '—'}</span></div>
        <div class="fgrid c2">
          <div class="field span3"><label for="st-keg">Maksud / kegiatan penugasan <span class="bad-t">*</span></label><textarea class="ta" id="st-keg" data-in="st.f" data-k="Kegiatan" ${dis} placeholder="Contoh: Mengikuti rapat koordinasi …">${e(f.Kegiatan)}</textarea></div>
          <div class="field"><label>Tanggal mulai <span class="bad-t">*</span></label><input class="inp" type="date" data-in="st.f" data-k="TanggalMulai" value="${e(f.TanggalMulai)}" ${dis}></div>
          <div class="field"><label>Tanggal selesai</label><input class="inp" type="date" data-in="st.f" data-k="TanggalSelesai" value="${e(f.TanggalSelesai)}" min="${e(f.TanggalMulai)}" ${dis}><span class="hint">Satu sumber tanggal pelaksanaan per surat.</span></div>
          <div class="field span3"><label>Tempat tujuan <span class="bad-t">*</span></label><div class="inp-ic">${ic('location_on')}<input class="inp" data-in="st.f" data-k="Tempat" value="${e(f.Tempat)}" ${dis} placeholder="Nama kantor / kota tujuan"></div></div>
          <div class="field"><label>Ditandatangani oleh</label><select class="sel" data-in="st.f" data-k="PenandatanganID" ${dis}>${pejabat.map(j => `<option value="${j.ID}" ${j.ID === f.PenandatanganID ? 'selected' : ''}>${j.Peran === 'SEKRETARIS' ? 'a.n. Kepala — ' + e(j.Jabatan || 'Sekretaris') : 'Kepala'} · ${e(j.Nama)}</option>`).join('')}</select>
            <span class="hint">${pejabat.some(j => j.Peran === 'SEKRETARIS') ? 'Pilih "a.n. Kepala" bila Sekretaris menandatangani atas nama Kepala.' : 'Tambahkan pejabat peran Sekretaris di Pengaturan → Pejabat & TTD untuk opsi a.n. Kepala.'}</span></div>
          <div class="field"><label>Tanggal penerbitan</label><input class="inp" type="date" data-in="st.f" data-k="TanggalTerbit" value="${e(f.TanggalTerbit)}" ${dis}></div>
        </div></div>
      <div class="card pad-s" style="position:sticky;bottom:${window.innerWidth < 768 ? 76 : 12}px;z-index:20;box-shadow:var(--sh3)"><div class="row between wrap gap8">
        <span class="small muted row gap4" id="st-autosave">${ic(ro ? 'lock' : 'cloud_done', 'sm')} ${ro ? 'Dokumen terkunci (snapshot)' : 'Draf tersimpan otomatis di perangkat'}</span>
        <div class="row wrap gap8">${this.tombol(rec, status, ro, wajibSetuju)}</div></div></div>
    </div>
    <div class="sticky" id="st-paper"></div></div>`;
    this.preview();
  },
  tombol(rec, status, ro, wajib) {
    const b = [];
    if (rec && status === 'Diajukan' && (isPM() || isSA())) { b.push(`<button class="btn dang" data-act="st.putus" data-v="0">${ic('block', 'sm')} Tolak</button>`, `<button class="btn pri" data-act="st.putus" data-v="1">${ic('approval', 'sm')} Setujui</button>`); }
    if (rec && status === 'Terbit') {
      b.push(`<button class="btn sec" data-act="st.cetak">${ic('print', 'sm')} Cetak</button>`, `<button class="btn sec" data-act="st.pdf" data-id="${rec.ID}" data-busy="Menyusun PDF…">${ic('picture_as_pdf', 'sm')} Unduh PDF</button>`);
      if (bisaTulis(rec.OPD)) b.push(`<button class="btn dang" data-act="st.batal">${ic('cancel', 'sm')} Batalkan</button>`, `<button class="btn pri" data-act="spd.dariST" data-id="${rec.ID}">${ic('commute', 'sm')} Buat SPD</button>`);
      return b.join('');
    }
    if (ro) return b.join('') || '<span class="small muted">Hanya-baca</span>';
    if (rec && !rec.Nomor) b.push(`<button class="btn ghost" data-act="st.hapus">${ic('delete', 'sm')} Hapus</button>`);
    b.push(`<button class="btn sec" data-act="st.simpan" data-aksi="draf" data-busy="Menyimpan…">Simpan Draf</button>`);
    if (wajib && status !== 'Disetujui') b.push(`<button class="btn pri" data-act="st.simpan" data-aksi="ajukan" data-busy="Mengajukan…">${ic('send', 'sm')} Ajukan Persetujuan</button>`);
    else b.push(`<button class="btn pri" data-act="st.simpan" data-aksi="terbit" data-busy="Menerbitkan nomor…">${ic('print', 'sm')} Terbitkan & Cetak</button>`);
    return b.join('');
  },
  preview() {
    const f = S.pg.st.form; if (!f) return;
    const x = stDocData(f), pv = $('#st-paper');
    if (pv) pv.innerHTML = kertas('st', SJ.render.st(x.d, docOpts(x.draf)), { judul: 'Pratinjau Kertas Resmi (F4)', draf: x.draf });
    const bt = $('#st-bentrok');
    if (bt) { const b = stBentrok(f); bt.innerHTML = !f.pegawai.length || !f.TanggalMulai ? '' : b.length ? `<div class="callout bad small">${ic('event_busy', 'sm')}<div><b>Jadwal bertabrakan</b><div>${b.map(e).join('<br>')}</div></div></div>` : `<div class="callout gold small">${ic('check_circle', 'sm')}<div><b>Pemeriksaan kalender dinas: valid</b><div>Tidak ada penugasan bertabrakan untuk ${f.pegawai.length} pegawai pada ${e(SJ.rentangTgl(f.TanggalMulai, f.TanggalSelesai || f.TanggalMulai))}.</div></div></div>`; }
    const lm = $('#st-lama'); if (lm) lm.textContent = f.TanggalMulai ? SJ.lamaHari(f.TanggalMulai, f.TanggalSelesai || f.TanggalMulai) + ' hari' : '—';
    f.dasar.forEach((d, i) => { const t = $('#st-dtxt-' + i); if (t) t.textContent = SJ.lookup.dasarTeks(S.D, f.OPD, d.Kode, d.nilai); });
    setTimeout(pasKertas, 0);
  }
};
const stPreviewDeb = debounce(() => { PAGES.st.preview(); simpanDrafST(); }, 120);
function simpanDrafST() { const f = S.pg.st && S.pg.st.form; if (!f || f.ID) return; try { localStorage.setItem('sj_draf_st_' + S.user.ID, JSON.stringify(f)); const a = $('#st-autosave'); if (a) a.innerHTML = ic('cloud_done', 'sm') + ' Draf tersimpan otomatis ' + new Date().toTimeString().slice(0, 5); } catch (err) { /* abaikan */ } }
function bacaDrafST() { try { const d = JSON.parse(localStorage.getItem('sj_draf_st_' + S.user.ID) || 'null'); return d && !d.ID ? d : null; } catch (err) { return null; } }
ACT['st.mode'] = el => { const p = S.pg.st; p.mode = el.dataset.v; if (p.mode === 'form' && !p.form) p.form = p.id ? stDariRecord(p.id) : (bacaDrafST() || ST_KOSONG()); refresh(); };
ACT['st.baru'] = () => { S.pg.st = Object.assign(S.pg.st || {}, { mode: 'form', id: '', form: bacaDrafST() || ST_KOSONG() }); go('st'); };
ACT['st.buka'] = el => { S.pg.st = Object.assign(S.pg.st || {}, { mode: 'form', id: el.dataset.id, form: stDariRecord(el.dataset.id) }); go('st'); };
ACT['st.status'] = el => { S.pg.st.status = el.dataset.v; refresh(); };
INP['st.q'] = debounce(el => { S.pg.st.q = el.value; PAGES.st.list($('#st-body')); const i = $('[data-in="st.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
INP['st.bulan'] = el => { S.pg.st.bulan = el.value; refresh(); };
INP['st.f'] = el => {
  const f = S.pg.st.form; f[el.dataset.k] = el.value;
  if (el.dataset.k === 'TanggalMulai' && (!f.TanggalSelesai || f.TanggalSelesai < f.TanggalMulai)) { f.TanggalSelesai = f.TanggalMulai; const s = $('[data-k="TanggalSelesai"]'); if (s) { s.value = f.TanggalSelesai; s.min = f.TanggalMulai; } }
  if (el.dataset.k === 'OPD') { f.PenandatanganID = ''; f.pegawai = []; f.dasar = []; return refresh(); }
  el.classList.remove('bad'); stPreviewDeb();
};
const LABEL_VAR_DASAR = { nomor: 'Nomor', tanggal: 'Tanggal', perihal: 'Perihal / tentang', tahun: 'Tahun', pengundang: 'Pengundang / instansi', pengirim: 'Pengirim / pejabat' };
INP['st.dkode'] = el => {
  const d = S.pg.st.form.dasar[Number(el.dataset.i)], lama = d.nilai || {};
  // pertahankan isian yang namanya sama (mis. nomor, tanggal) saat jenis dasar diganti
  const vars = SJ.lookup.variabelDasar(S.D, S.pg.st.form.OPD, el.value), nilai = {};
  vars.forEach(v => { if (lama[v]) nilai[v] = lama[v]; });
  if (el.value === SJ.DASAR_BEBAS && !nilai.teks) nilai.teks = SJ.lookup.dasarTeks(S.D, S.pg.st.form.OPD, d.Kode, lama).replace(/…/g, '');
  S.pg.st.form.dasar[Number(el.dataset.i)] = { Kode: el.value, nilai: nilai }; refresh(); stPreviewDeb();
};
INP['st.dpilih'] = el => {
  const f = S.pg.st.form, kode = el.value; if (!kode || f.dasar.length >= 3 || el.dataset.dipakai) return;
  el.dataset.dipakai = '1';   // select memicu "input" dan "change" — tambahkan sekali saja
  f.dasar.push({ Kode: kode, nilai: {} }); refresh(); stPreviewDeb();
  setTimeout(() => { const x = $('#st-dasar [id^="st-dv-' + (f.dasar.length - 1) + '-"]'); if (x) x.focus(); }, 30);
};
INP['st.dvar'] = el => { const d = S.pg.st.form.dasar[Number(el.dataset.i)]; d.nilai = d.nilai || {}; d.nilai[el.dataset.v] = el.value; stPreviewDeb(); };
ACT['st.dtambah'] = () => {
  const f = S.pg.st.form; if (f.dasar.length >= 3) return;
  const kode = S.D.Master_Dasar.filter(m => (m.OPD === f.OPD || m.OPD === '*') && m.Status !== 'Nonaktif').sort((a, b) => a.UrutanDefault - b.UrutanDefault).map(m => m.Kode);
  const pakai = f.dasar.map(d => d.Kode);
  f.dasar.push({ Kode: kode.find(k => pakai.indexOf(k) < 0) || kode[0], nilai: {} }); refresh();
};
ACT['st.dhapus'] = el => { S.pg.st.form.dasar.splice(Number(el.dataset.i), 1); refresh(); stPreviewDeb(); };
ACT['st.pdel'] = el => { S.pg.st.form.pegawai.splice(Number(el.dataset.i), 1); refresh(); };
INP['st.cari'] = el => cariPegawai(el, S.pg.st.form.OPD, S.pg.st.form.pegawai, nip => { S.pg.st.form.pegawai.push(nip); refresh(); setTimeout(() => { const c = $('#st-cari'); if (c) c.focus(); }, 10); });
/** Autocomplete pegawai (pencarian lokal, instan). */
function cariPegawai(input, opd, kecuali, pilih) {
  const wrap = input.closest('.ac-wrap'); $$('.ac-list', wrap).forEach(x => x.remove());
  const q = input.value.trim().toLowerCase(); if (q.length < 1) return;
  const hasil = S.D.Pegawai.filter(p => p.Status !== 'Nonaktif' && kecuali.indexOf(String(p.NIP)) < 0 && (SJ.namaLengkap(p) + ' ' + p.NIP + ' ' + p.Jabatan).toLowerCase().indexOf(q) > -1)
    .sort((a, b) => (a.OPD === opd ? 0 : 1) - (b.OPD === opd ? 0 : 1)).slice(0, 8);
  const l = document.createElement('div'); l.className = 'ac-list';
  l.innerHTML = hasil.length ? hasil.map(p => `<div class="ac-item" data-nip="${e(p.NIP)}">${avatar(SJ.namaLengkap(p))}<div class="grow" style="min-width:0"><div class="b small trunc">${e(SJ.namaLengkap(p))}</div><div class="xs muted trunc">${e(SJ.fmtNip(p.NIP))} · ${e(p.Golongan || p.StatusPegawai)} · ${e(p.OPD)}</div></div></div>`).join('') : '<div class="ac-item muted small">Tidak ditemukan</div>';
  wrap.appendChild(l);
  $$('.ac-item[data-nip]', l).forEach(it => it.onclick = () => { l.remove(); input.value = ''; pilih(it.dataset.nip); });
  input.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); const f = $('.ac-item[data-nip]', l); if (f) f.click(); } };
}
function validasiST(f) {
  const err = [];
  if (!f.Kegiatan.trim()) err.push(['Kegiatan', 'Maksud/kegiatan wajib diisi.']);
  if (!f.TanggalMulai) err.push(['TanggalMulai', 'Tanggal mulai wajib diisi.']);
  if (f.TanggalSelesai && f.TanggalSelesai < f.TanggalMulai) err.push(['TanggalSelesai', 'Tanggal selesai tidak boleh sebelum tanggal mulai.']);
  if (!f.Tempat.trim()) err.push(['Tempat', 'Tempat wajib diisi.']);
  if (!f.pegawai.length) err.push(['', 'Pilih minimal satu pegawai.']);
  f.dasar.forEach((d, i) => SJ.lookup.variabelDasar(S.D, f.OPD, d.Kode).forEach(v => { if (!String((d.nilai || {})[v] || '').trim()) err.push(['', 'Dasar ' + (i + 1) + ': isian "' + v + '" wajib diisi.']); }));
  if (stBentrok(f).length) err.push(['', 'Ada jadwal pegawai yang bertabrakan.']);
  return err;
}
ACT['st.simpan'] = async btn => {
  const f = S.pg.st.form, aksi = btn.dataset.aksi, err = validasiST(f);
  $$('#st-body .bad').forEach(x => x.classList.remove('bad'));
  if (err.length) { err.forEach(x => { if (x[0]) { const i = $(`[data-k="${x[0]}"]`); if (i) i.classList.add('bad'); } }); toast(err.map(x => x[1]).join(' '), 'bad', 7000); const first = $('#st-body .bad'); if (first) first.focus(); return; }
  if (aksi === 'terbit' && !(await konfirmasi('Terbitkan Surat Tugas? Nomor akan dikunci permanen dan isi tidak dapat diubah lagi.', { ok: 'Terbitkan' }))) return;
  const tmp = f.ID || uid('ST');
  const data = mutasi('st.simpan', Object.assign({}, f, { aksi: aksi }), {
    btn: btn,
    opt: () => {   // tampil seketika di daftar sebelum server selesai
      const old = deep({ a: S.D.Surat_Tugas, b: S.D.ST_Pegawai });
      upsertRow('Surat_Tugas', Object.assign({}, stOf(f.ID) || {}, { ID: tmp, OPD: f.OPD, Tahun: SJ.tahunDari(f.TanggalMulai), Kegiatan: f.Kegiatan, Tempat: f.Tempat, TanggalMulai: f.TanggalMulai, TanggalSelesai: f.TanggalSelesai || f.TanggalMulai, TanggalTerbit: f.TanggalTerbit, Status: (stOf(f.ID) || {}).Status || 'Draf', _pending: true, DibuatPada: SJ.hariIni() + ' 23:59:59' }));
      if (!f.ID) S.D.ST_Pegawai = S.D.ST_Pegawai.concat(f.pegawai.map((n, i) => ({ ID: uid('STP'), STID: tmp, NIP: n, Urutan: i + 1 })));
      return () => { S.D.Surat_Tugas = old.a; S.D.ST_Pegawai = old.b; };
    }
  });
  const res = await data.catch(() => null); if (!res) return;
  const st = res.upsert.Surat_Tugas[0];
  try { localStorage.removeItem('sj_draf_st_' + S.user.ID); } catch (x) { /* abaikan */ }
  S.pg.st.id = st.ID; S.pg.st.form = stDariRecord(st.ID); refresh();
  if (aksi === 'terbit') { const x = stDocData(S.pg.st.form); cetakHTML(SJ.render.st(x.d, docOpts(false)), 'Surat Tugas ' + st.Nomor); }
};
ACT['st.cetak'] = () => { const x = stDocData(S.pg.st.form); cetakHTML(SJ.render.st(x.d, docOpts(x.draf)), 'Surat Tugas'); };
ACT['st.pdf'] = el => unduhPDF({ jenis: 'ST', id: el.dataset.id }, el);
ACT['st.hapus'] = async () => {
  if (!(await konfirmasi('Hapus draf Surat Tugas ini?', { bahaya: true, ok: 'Hapus' }))) return;
  await mutasi('st.hapus', { ID: S.pg.st.form.ID }).catch(() => null);
  S.pg.st = { mode: 'list', status: 'Semua' }; refresh();
};
ACT['st.batal'] = async () => {
  if (!(await konfirmasi('Batalkan Surat Tugas terbit ini? Nomor tetap tercatat dan tidak dipakai ulang.', { bahaya: true, ok: 'Batalkan' }))) return;
  await mutasi('st.batal', { ID: S.pg.st.form.ID }).catch(() => null);
};
ACT['st.putus'] = async el => {
  const setuju = el.dataset.v === '1';
  const cat = setuju ? '' : await tanya('Tolak Surat Tugas', 'Alasan penolakan', { multi: true, wajib: true, ok: 'Tolak', bahaya: true });
  if (!setuju && cat === null) return;
  await mutasi('st.setujui', { ID: S.pg.st.form.ID, setuju: setuju, catatan: cat || '' }, { btn: el }).catch(() => null);
};

// =====================================================================
// SPD (daftar + wizard 4 tahap)
// =====================================================================
function spdDariRecord(id) {
  const s = spdOf(id), dk = SJ.one(S.D.SPD_Diklat, 'SPDID', id);
  return { ID: s.ID, STID: s.STID, Jenis: s.Jenis, AdaDiklat: s.AdaDiklat, diklat: dk ? { NamaDiklat: dk.NamaDiklat, Penyelenggara: dk.Penyelenggara, TglMulai: SJ.iso(dk.TglMulai), TglSelesai: SJ.iso(dk.TglSelesai) } : { NamaDiklat: '', Penyelenggara: '', TglMulai: '', TglSelesai: '' },
    PelaksanaNIP: String(s.PelaksanaNIP), pengikut: SJ.by(S.D.SPD_Pengikut, 'SPDID', id).sort((a, b) => a.Urutan - b.Urutan).map(x => ({ NIP: String(x.NIP), Keterangan: x.Keterangan })),
    Maksud: s.Maksud, PaguID: s.PaguID, AlatAngkut: s.AlatAngkut, TempatBerangkat: s.TempatBerangkat, TglBerangkat: SJ.iso(s.TglBerangkat), TglKembali: SJ.iso(s.TglKembali),
    tujuan: SJ.by(S.D.SPD_Tujuan, 'SPDID', id).sort((a, b) => a.Urutan - b.Urutan).map(t => ({ TempatTujuan: t.TempatTujuan, KabKota: t.KabKota, Provinsi: t.Provinsi, TglTiba: SJ.iso(t.TglTiba), TglBerangkat: SJ.iso(t.TglBerangkat), PejabatPengesah: t.PejabatPengesah })),
    Keterangan: s.Keterangan, TempatTetap: s.TempatTetap, TanggalTetap: SJ.iso(s.TanggalTetap), PenandatanganID: s.PenandatanganID || '' };
}
function spdDariST(stId) {
  const st = stOf(stId), nips = SJ.by(S.D.ST_Pegawai, 'STID', stId).sort((a, b) => a.Urutan - b.Urutan).map(x => String(x.NIP));
  const maks = SJ.lookup.param(S.D, st.OPD, 'MAKS_PENGIKUT', SJ.iso(st.TanggalMulai), 6);
  const pg = S.D.Pagu.filter(p => p.OPD === st.OPD && p.Status !== 'Nonaktif' && Number(p.Tahun) === SJ.tahunDari(st.TanggalMulai));
  return { ID: '', STID: stId, Jenis: 'DB', AdaDiklat: 'TIDAK', diklat: { NamaDiklat: '', Penyelenggara: '', TglMulai: '', TglSelesai: '' }, PelaksanaNIP: nips[0] || '',
    pengikut: nips.slice(1, 1 + maks).map(n => ({ NIP: n, Keterangan: '' })), Maksud: st.Kegiatan, PaguID: (pg.find(p => p.JenisPerjalanan === 'DB') || pg[0] || {}).ID || '', AlatAngkut: 'Kendaraan Dinas',
    TempatBerangkat: S.cfg.TEMPAT_TERBIT_DEFAULT || 'Cianjur', TglBerangkat: SJ.iso(st.TanggalMulai), TglKembali: SJ.iso(st.TanggalSelesai), tujuan: [{ TempatTujuan: st.Tempat, KabKota: '', Provinsi: 'Jawa Barat', TglTiba: '', TglBerangkat: '', PejabatPengesah: '' }],
    Keterangan: '', TempatTetap: S.cfg.TEMPAT_TERBIT_DEFAULT || 'Cianjur', TanggalTetap: SJ.hariIni(),
    PenandatanganID: ((SJ.lookup.pejabat(S.D, st.OPD, 'PA', SJ.hariIni()) || SJ.lookup.pejabat(S.D, st.OPD, 'KPA', SJ.hariIni())) || {}).ID || '' };
}
/** Data sementara (draf) untuk perhitungan & pratinjau tanpa menunggu server. */
function spdDraftD(f) {
  const st = stOf(f.STID) || {}, id = f.ID || 'DRAF';
  const spd = Object.assign({}, spdOf(f.ID) || {}, { ID: id, OPD: st.OPD, STID: f.STID, Jenis: f.Jenis, AdaDiklat: f.AdaDiklat, PelaksanaNIP: f.PelaksanaNIP, Maksud: f.Maksud, PaguID: f.PaguID,
    SubKegiatan: (SJ.one(S.D.Pagu, 'ID', f.PaguID) || {}).SubKegiatan || '', AlatAngkut: f.AlatAngkut, TempatBerangkat: f.TempatBerangkat, TglBerangkat: f.TglBerangkat, TglKembali: f.TglKembali,
    LamaHari: SJ.lamaHari(f.TglBerangkat, f.TglKembali), Keterangan: f.Keterangan, TempatTetap: f.TempatTetap, TanggalTetap: f.TanggalTetap, PenandatanganID: f.PenandatanganID, Status: (spdOf(f.ID) || {}).Status || 'Draf' });
  const rek = SJ.lookup.rekening(S.D, st.OPD, f.Jenis, f.TglBerangkat) || {};
  spd.KodeRekening = rek.Kode || ''; spd.UraianRekening = rek.Uraian || '';
  const not = r => r.SPDID !== id;
  const Dx = Object.assign({}, S.D, { SPD: S.D.SPD.filter(s => s.ID !== id).concat([spd]),
    SPD_Tujuan: S.D.SPD_Tujuan.filter(not).concat(f.tujuan.map((t, i) => Object.assign({ SPDID: id, Urutan: i + 1 }, t))),
    SPD_Pengikut: S.D.SPD_Pengikut.filter(not).concat(f.pengikut.filter(x => x.NIP).map((x, i) => ({ SPDID: id, Urutan: i + 1, NIP: x.NIP, Keterangan: x.Keterangan, Nama: nmPeg(x.NIP) }))),
    SPD_Diklat: S.D.SPD_Diklat.filter(not).concat(f.AdaDiklat === 'YA' ? [Object.assign({ SPDID: id }, f.diklat)] : []) });
  return { Dx: Dx, spd: spd };
}
PAGES.spd = {
  render(el) {
    const p = S.pg.spd = S.pg.spd || { mode: 'list', status: 'Semua', q: '' };
    if (p.mode === 'wizard' && !p.form) p.mode = 'list';
    el.innerHTML = p.mode === 'wizard' ? '' : `<div class="ph"><div><h1>Surat Perjalanan Dinas</h1><p>SPD dibuat dari Surat Tugas terbit. Jenis DK/DB menentukan nomor & kode rekening; Diklat dapat digabung.</p></div>
      <div class="acts">${isSA() || isOP() ? `<button class="btn gold" data-act="spd.baru">${ic('add_circle')} Buat SPD</button>` : ''}</div></div>`;
    const box = document.createElement('div'); el.appendChild(box);
    p.mode === 'wizard' ? this.wizard(box) : this.list(box);
  },
  list(box) {
    const p = S.pg.spd, q = (p.q || '').toLowerCase();
    let rows = S.D.SPD.filter(inOPD).slice().sort((a, b) => SJ.iso(b.TglBerangkat).localeCompare(SJ.iso(a.TglBerangkat)));
    const cnt = st => rows.filter(r => st === 'Semua' || r.Status === st).length;
    rows = rows.filter(r => (p.status === 'Semua' || r.Status === p.status) && (!q || [r.Nomor, r.Maksud, nmPeg(r.PelaksanaNIP), r.PelaksanaNIP].concat(SJ.by(S.D.SPD_Tujuan, 'SPDID', r.ID).map(t => t.TempatTujuan + ' ' + t.KabKota)).join(' ').toLowerCase().indexOf(q) > -1));
    box.innerHTML = `<div class="card pad-s mb16"><div class="row wrap between gap12"><div class="pills">${['Semua', 'Draf', 'Terbit', 'Batal'].map(s => `<button class="${p.status === s ? 'on' : ''}" data-act="spd.status" data-v="${s}">${s} (${cnt(s)})</button>`).join('')}</div>
      <div class="inp-ic" style="min-width:240px">${ic('search')}<input class="inp" placeholder="Cari nomor, pelaksana, tujuan…" value="${e(p.q || '')}" data-in="spd.q" aria-label="Cari SPD"></div></div></div>
      <div class="card"><div class="tbl-wrap"><table class="tbl m-card"><thead><tr><th>Nomor SPD</th><th>Pelaksana & Rombongan</th><th>Tujuan</th><th>Tanggal</th><th class="r" data-xl>Estimasi</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => { const tj = SJ.by(S.D.SPD_Tujuan, 'SPDID', r.ID), j = spjOf(r.ID), n = anggotaNip(r).length;
        return `<tr class="click" data-act="spd.buka" data-id="${r.ID}"><td><span class="mono b pri-t">${e(r.Nomor || '— draf —')}</span><span class="sub"><span class="tag ${r.Jenis === 'DB' ? 'gold' : 'pri'}">${r.Jenis}</span>${r.AdaDiklat === 'YA' ? ' <span class="tag">+ Diklat</span>' : ''} · ${e(singkat(r.OPD))}</span></td>
        <td><div class="row gap8">${avatar(nmPeg(r.PelaksanaNIP))}<div style="min-width:0"><div class="b small trunc">${e(nmPeg(r.PelaksanaNIP))}</div><span class="sub">${n > 1 ? '+' + (n - 1) + ' pengikut' : 'tanpa pengikut'}</span></div></div></td>
        <td style="max-width:180px"><div class="small trunc">${e(tj.map(t => t.TempatTujuan).join('; '))}</div><span class="sub">${e(tj.map(t => t.KabKota).filter(Boolean).join(', '))}</span></td>
        <td><div class="small" style="white-space:nowrap">${e(SJ.rentangTgl(r.TglBerangkat, r.TglKembali))}</div><span class="sub" style="white-space:nowrap">${r.LamaHari} hari · ${e(r.AlatAngkut)}</span></td>
        <td class="r mono" data-xl style="white-space:nowrap">${rp(SJ.hitung.totalSPD(S.D, r.ID))}</td>
        <td>${pill(r.Status)}${j ? `<span class="sub" style="white-space:nowrap">SPJ: ${e(j.Status)}</span>` : ''}</td>
        <td class="r m-full m-act" data-stop><div class="row gap4" style="justify-content:flex-end">
          ${r.Status === 'Terbit' ? `<button class="btn ghost icon sm" data-act="spd.pdf" data-id="${r.ID}" aria-label="Unduh PDF SPD">${ic('picture_as_pdf', 'sm')}</button><button class="btn ghost icon sm" data-xxl data-act="go" data-r="rincian" data-p='{"spd":"${r.ID}"}' aria-label="Rincian">${ic('calculate', 'sm')}</button><button class="btn ghost icon sm" data-xxl data-act="go" data-r="kuitansi" data-p='{"spd":"${r.ID}"}' aria-label="Kuitansi">${ic('receipt_long', 'sm')}</button>` : ''}
          <button class="btn ghost icon sm" data-act="spd.buka" data-id="${r.ID}" aria-label="Buka">${ic('chevron_right', 'sm')}</button></div></td></tr>`; }).join('') : `<tr><td colspan="7">${empty('commute', 'Belum ada SPD.', isSA() || isOP() ? '<button class="btn pri sm" data-act="spd.baru">Buat dari Surat Tugas</button>' : '')}</td></tr>`}
      </tbody></table></div><div class="tbl-foot"><span>${rows.length} SPD</span><span>Estimasi = jumlah rincian diakui</span></div></div>`;
  },
  wizard(box) {
    const p = S.pg.spd, f = p.form, rec = f.ID ? spdOf(f.ID) : null, st = stOf(f.STID);
    const ro = (rec && rec.Status !== 'Draf') || !st || !bisaTulis(st.OPD);
    p.step = p.step || 1;
    const steps = [['Dasar & Jenis', 'Tahap 1'], ['Pelaksana & Pengikut', 'Tahap 2'], ['Rute & Perjalanan', 'Tahap 3'], ['Pembebanan & Pratinjau', 'Tahap 4']];
    box.innerHTML = `<div class="ph" style="margin-bottom:12px"><div><div class="label">${rec ? 'SPD ' + e(rec.Nomor || 'draf') : 'SPD baru'} · ${st ? 'ST ' + e(st.Nomor) : ''}</div><h1>${rec && rec.Status === 'Terbit' ? 'Surat Perjalanan Dinas' : 'Penerbitan Surat Perjalanan Dinas (SPD)'}</h1></div>
      <div class="acts">${rec ? pill(rec.Status) : ''}<button class="btn sec" data-act="spd.tutup">${ic('arrow_back', 'sm')} Daftar SPD</button></div></div>
      <div class="stepper mb16">${steps.map((s, i) => `<button class="step ${p.step === i + 1 ? 'on' : p.step > i + 1 ? 'done' : ''}" data-act="spd.step" data-v="${i + 1}"><span class="n">${p.step > i + 1 ? ic('check', 'sm') : i + 1}</span><span class="col gap4" style="gap:0"><span class="k">${p.step === i + 1 ? 'Tahap aktif' : s[1]}</span><span class="b small">${s[0]}</span></span></button>`).join('')}</div>
      ${ro && rec ? `<div class="callout ${rec.Status === 'Batal' ? 'bad' : 'ok'} mb16">${ic(rec.Status === 'Batal' ? 'cancel' : 'lock')}<div class="grow"><b>SPD ${e(rec.Status.toLowerCase())} — isi terkunci (snapshot).</b><div class="small">Biaya dapat disesuaikan di menu Rincian selama SPJ belum diajukan.</div></div>
        ${rec.Status === 'Terbit' ? `<div class="row wrap gap8"><button class="btn sm sec" data-act="spd.pdf" data-id="${rec.ID}" data-busy="Menyusun PDF…">${ic('picture_as_pdf', 'sm')} PDF</button><button class="btn sm sec" data-act="go" data-r="rincian" data-p='{"spd":"${rec.ID}"}'>${ic('calculate', 'sm')} Rincian</button><button class="btn sm sec" data-act="go" data-r="kuitansi" data-p='{"spd":"${rec.ID}"}'>${ic('receipt_long', 'sm')} Kuitansi</button>${bisaTulis(rec.OPD) && (spjOf(rec.ID) || {}).Status !== 'Diverifikasi' ? `<button class="btn sm dang" data-act="spd.batal">${ic('cancel', 'sm')} Batalkan</button>` : ''}</div>` : ''}</div>` : ''}
      <div id="spd-step"></div>
      <div class="card pad-s mt16" style="position:sticky;bottom:${window.innerWidth < 768 ? 76 : 12}px;z-index:20;box-shadow:var(--sh3)"><div class="row between wrap gap8">
        <button class="btn sec" data-act="spd.step" data-v="${Math.max(1, p.step - 1)}" ${p.step === 1 ? 'disabled' : ''}>${ic('arrow_back', 'sm')} Kembali</button>
        <div class="row wrap gap8">${ro ? '' : `<button class="btn ghost" data-act="spd.simpan" data-busy="Menyimpan…">${ic('bookmark', 'sm')} Simpan Sementara</button>`}
        ${p.step < 4 ? `<button class="btn gold" data-act="spd.step" data-v="${p.step + 1}" data-cek="1">Lanjut: ${steps[p.step][0]} ${ic('arrow_forward', 'sm')}</button>` : (ro ? '' : `<button class="btn pri" data-act="spd.simpan" data-terbit="1" data-busy="Menerbitkan nomor…">${ic('verified', 'sm')} Terbitkan SPD</button>`)}</div></div></div>`;
    this['step' + p.step]($('#spd-step'), f, ro, st);
  },
  step1(box, f, ro, st) {
    const dis = ro ? 'disabled' : '';
    const stOpsi = S.D.Surat_Tugas.filter(s => s.Status === 'Terbit' && inOPD(s) && bisaTulis(s.OPD) || s.ID === f.STID);
    const pagu = st ? S.D.Pagu.filter(p => p.OPD === st.OPD && p.Status !== 'Nonaktif' && (p.JenisPerjalanan === f.Jenis || p.JenisPerjalanan === 'Semua')) : [];
    if (st && f.PaguID && !pagu.some(p => p.ID === f.PaguID)) f.PaguID = (pagu[0] || {}).ID || '';
    const kh = st ? SJ.lookup.konfigHari(S.D, st.OPD, 'UANG_HARIAN', f.TglBerangkat) : { awal: 1, akhir: 1 };
    box.innerHTML = `<div class="col gap16"><div class="card pad"><div class="sec-title mb16">${ic('assignment', 'pri-t')} Dasar Surat Tugas</div>
      <div class="fgrid c2"><div class="field span3"><label>Surat Tugas terbit</label><select class="sel" data-in="spd.st" ${dis}><option value="">— pilih —</option>${stOpsi.map(s => `<option value="${s.ID}" ${s.ID === f.STID ? 'selected' : ''}>${e(s.Nomor)} · ${e(s.Kegiatan.slice(0, 70))}</option>`).join('')}</select></div></div>
      ${st ? `<div class="kv c4 mt12"><div><div class="k">Kegiatan</div><div class="v small">${e(st.Kegiatan)}</div></div><div><div class="k">Tanggal</div><div class="v small">${e(SJ.rentangTgl(st.TanggalMulai, st.TanggalSelesai))}</div></div><div><div class="k">Tempat</div><div class="v small">${e(st.Tempat)}</div></div><div><div class="k">Pegawai</div><div class="v small">${SJ.by(S.D.ST_Pegawai, 'STID', st.ID).length} orang</div></div></div>` : ''}</div>
      <div class="card pad"><div class="sec-title mb16">${ic('tune', 'pri-t')} Jenis Perjalanan & Pembebanan</div>
        <div class="field"><label>Jenis perjalanan dinas</label><div class="seg dark" role="radiogroup">${['DK', 'DB'].map(j => `<button class="${f.Jenis === j ? 'on' : ''}" data-act="spd.jenis" data-v="${j}" ${dis} role="radio" aria-checked="${f.Jenis === j}">${ic(j === 'DK' ? 'near_me' : 'flight_takeoff', 'sm')} ${SJ.JENIS_JALAN[j]} (${j})</button>`).join('')}</div></div>
        <div class="fgrid c2 mt16"><div class="field"><label>Pagu / sub kegiatan <span class="bad-t">*</span></label><select class="sel" data-in="spd.f" data-k="PaguID" ${dis}>${pagu.map(p => { const s = SJ.sisaPagu(S.D, p.ID); return `<option value="${p.ID}" ${p.ID === f.PaguID ? 'selected' : ''}>${e(p.SubKegiatan)} — sisa ${rp(s.sisa)}</option>`; }).join('') || '<option value="">Tidak ada pagu ' + f.Jenis + '</option>'}</select></div>
        <div class="field"><label>Alat angkut</label><select class="sel" data-in="spd.f" data-k="AlatAngkut" ${dis}>${SJ.ALAT_ANGKUT.map(a => `<option ${a === f.AlatAngkut ? 'selected' : ''}>${a}</option>`).join('')}</select><span class="hint">Kendaraan umum/lainnya → uang transport; pesawat/kereta → taksi.</span></div></div></div>
      <div class="card pad"><div class="row between gap12"><div class="row gap12 top"><div class="kpi-ico y">${ic('school')}</div><div><label class="b" for="sw-diklat">Digabung dengan Diklat / Bimbingan Teknis</label><div class="small muted">Diklat bukan jenis perjalanan tersendiri; nomor & kode rekening tetap ${f.Jenis}.</div></div></div>
        <label class="switch"><input type="checkbox" id="sw-diklat" data-in="spd.diklatOn" ${f.AdaDiklat === 'YA' ? 'checked' : ''} ${dis}><span class="tr"></span></label></div>
        ${f.AdaDiklat === 'YA' ? `<div class="fgrid c2 mt16"><div class="field"><label>Nama diklat / bimtek</label><input class="inp" data-in="spd.dk" data-k="NamaDiklat" value="${e(f.diklat.NamaDiklat)}" ${dis}></div><div class="field"><label>Penyelenggara</label><input class="inp" data-in="spd.dk" data-k="Penyelenggara" value="${e(f.diklat.Penyelenggara)}" ${dis}></div>
          <div class="field"><label>Mulai diklat</label><input class="inp" type="date" data-in="spd.dk" data-k="TglMulai" value="${e(f.diklat.TglMulai)}" min="${e(f.TglBerangkat)}" max="${e(f.TglKembali)}" ${dis}></div><div class="field"><label>Selesai diklat</label><input class="inp" type="date" data-in="spd.dk" data-k="TglSelesai" value="${e(f.diklat.TglSelesai)}" min="${e(f.TglBerangkat)}" max="${e(f.TglKembali)}" ${dis}></div></div>
          <div class="callout gold mt12 small">${ic('gavel', 'sm')}<div><b>Aturan pembagian hari (konfigurasi berlaku):</b> ${kh.awal} hari pertama & ${kh.akhir} hari terakhir dibayar uang harian ${f.Jenis}; hari di antaranya dibayar uang harian Diklat. Perjalanan ≤ ${kh.awal + kh.akhir} hari dibayar penuh ${f.Jenis}.</div></div>` : ''}</div></div>`;
  },
  step2(box, f, ro, st) {
    const dis = ro ? 'disabled' : '', opd = st ? st.OPD : '';
    const maks = st ? SJ.lookup.param(S.D, st.OPD, 'MAKS_PENGIKUT', f.TglBerangkat, 6) : 6;
    const pl = peg(f.PelaksanaNIP) || {}, t = SJ.lookup.tingkatBiaya(S.D, pl, opd, f.TglBerangkat);
    const stNips = st ? SJ.by(S.D.ST_Pegawai, 'STID', st.ID).map(x => String(x.NIP)) : [];
    const dipakai = [f.PelaksanaNIP].concat(f.pengikut.map(x => x.NIP));
    box.innerHTML = `<div class="col gap16"><div class="card pad"><div class="row between wrap gap8 mb16"><div><div class="label">Pejabat utama · penanggung jawab SPD</div><div class="sec-title">Data Pelaksana Utama</div></div>
      <select class="sel" data-in="spd.f" data-k="PelaksanaNIP" ${dis} style="width:auto;max-width:100%">${stNips.concat(dipakai.indexOf(f.PelaksanaNIP) > -1 && stNips.indexOf(f.PelaksanaNIP) < 0 ? [f.PelaksanaNIP] : []).map(n => `<option value="${n}" ${n === f.PelaksanaNIP ? 'selected' : ''}>${e(nmPeg(n))}</option>`).join('')}</select></div>
      <div class="grid g4"><div class="row gap12" style="padding:14px;border-radius:12px;background:var(--surface-2)">${avatar(nmPeg(f.PelaksanaNIP), 'lg')}<div style="min-width:0"><div class="b trunc">${e(nmPeg(f.PelaksanaNIP))}</div><div class="xs mono muted">NIP ${e(SJ.fmtNip(f.PelaksanaNIP))}</div><div class="xs ok-t b">${e(pl.StatusPegawai || '')}</div></div></div>
        <div style="padding:14px;border-radius:12px;background:var(--surface-2)"><div class="label">Pangkat / golongan</div><div class="b mt8">${e(pl.Pangkat || '-')} ${pl.Golongan ? '(' + e(pl.Golongan) + ')' : ''}</div></div>
        <div style="padding:14px;border-radius:12px;background:var(--surface-2)"><div class="label">Jabatan</div><div class="b mt8 small">${e(pl.Jabatan || '-')}</div><div class="xs muted">${pl.Eselon ? 'Eselon ' + e(pl.Eselon) : 'Non-eselon'}</div></div>
        <div style="padding:14px;border-radius:12px;background:var(--primary-soft)"><div class="label pri-t">Tingkat biaya SPPD</div><div class="bb mt8" style="font-size:18px">Tingkat ${t}</div><div class="xs muted">Diturunkan otomatis dari golongan/eselon</div></div></div></div>
      <div class="card pad"><div class="row between wrap gap8 mb12"><div><div class="sec-title">Daftar Pengikut <span class="tag">${f.pengikut.length} / ${maks}</span></div><div class="small muted">Maksimal ${maks} orang sesuai Pengaturan → Perhitungan.</div></div></div>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th style="width:36px">No</th><th>Nama & NIP</th><th>Pangkat / Gol.</th><th>Tingkat</th><th>Keterangan</th><th></th></tr></thead><tbody>
        ${f.pengikut.map((x, i) => { const g = peg(x.NIP) || {}; return `<tr><td class="c mono">${i + 1}</td><td><div class="row gap8">${avatar(nmPeg(x.NIP))}<div><div class="b small">${e(nmPeg(x.NIP))}</div><span class="sub mono">${e(SJ.fmtNip(x.NIP))}</span></div></div></td>
          <td class="small">${e(g.Pangkat || g.StatusPegawai || '')} ${g.Golongan ? '(' + e(g.Golongan) + ')' : ''}</td><td><span class="tag pri">${SJ.lookup.tingkatBiaya(S.D, g, opd, f.TglBerangkat)}</span></td>
          <td><input class="inp" style="min-height:32px" data-in="spd.pket" data-i="${i}" value="${e(x.Keterangan || '')}" ${dis} placeholder="Keterangan"></td><td class="r">${ro ? '' : `<button class="btn ghost icon sm" data-act="spd.pdel" data-i="${i}" aria-label="Hapus pengikut">${ic('delete', 'sm bad-t')}</button>`}</td></tr>`; }).join('') || `<tr><td colspan="6" class="muted small center">Tanpa pengikut.</td></tr>`}</tbody></table></div>
        ${ro ? '' : `<div class="row wrap gap8 mt12">${stNips.filter(n => dipakai.indexOf(n) < 0).map(n => `<button class="btn soft sm" data-act="spd.padd" data-nip="${n}" ${f.pengikut.length >= maks ? 'disabled' : ''}>${ic('person_add', 'sm')} ${e(nmPeg(n))}</button>`).join('')}
          <div class="ac-wrap grow" style="position:relative;min-width:220px"><div class="inp-ic">${ic('search')}<input class="inp" id="spd-cari" placeholder="Tambah pegawai lain (nama/NIP)…" data-in="spd.cari" ${f.pengikut.length >= maks ? 'disabled' : ''} autocomplete="off"></div></div></div>`}
        <div class="row between mt12 small muted"><span>${ic('info', 'sm')} Kapasitas tersisa ${Math.max(0, maks - f.pengikut.length)} orang.</span><div class="bar" style="width:180px"><i style="width:${Math.min(100, f.pengikut.length / maks * 100)}%"></i></div></div></div></div>`;
  },
  step3(box, f, ro, st) {
    const dis = ro ? 'disabled' : '', lama = SJ.lamaHari(f.TglBerangkat, f.TglKembali);
    const kh = st ? SJ.lookup.konfigHari(S.D, st.OPD, 'UANG_HARIAN', f.TglBerangkat) : { awal: 1, akhir: 1 };
    const sp = SJ.hitung.splitHari(lama, f.AdaDiklat === 'YA', kh);
    box.innerHTML = `<div class="col gap16"><div class="card pad"><div class="sec-title mb16">${ic('route', 'pri-t')} Waktu Perjalanan</div>
      <div class="fgrid c3"><div class="field"><label>Tempat berangkat</label><input class="inp" data-in="spd.f" data-k="TempatBerangkat" value="${e(f.TempatBerangkat)}" ${dis}></div>
      <div class="field"><label>Tanggal berangkat <span class="bad-t">*</span></label><input class="inp" type="date" data-in="spd.f" data-k="TglBerangkat" value="${e(f.TglBerangkat)}" ${dis}></div>
      <div class="field"><label>Tanggal kembali <span class="bad-t">*</span></label><input class="inp" type="date" data-in="spd.f" data-k="TglKembali" value="${e(f.TglKembali)}" min="${e(f.TglBerangkat)}" ${dis}></div></div></div>
      <div class="card pad"><div class="row between mb12"><div class="sec-title">${ic('location_on', 'pri-t')} Tempat Tujuan</div>${ro ? '' : `<button class="btn soft sm" data-act="spd.tadd">${ic('add', 'sm')} Tambah tujuan</button>`}</div>
        <div class="col gap12">${f.tujuan.map((t, i) => `<div style="padding:14px;border-radius:10px;background:var(--surface-2)"><div class="row between mb8"><span class="b small">Tujuan ${i + 1}</span>${ro || f.tujuan.length < 2 ? '' : `<button class="btn ghost icon sm" data-act="spd.tdel" data-i="${i}" aria-label="Hapus tujuan">${ic('delete', 'sm')}</button>`}</div>
          <div class="fgrid c3"><div class="field"><label>Nama kantor / tempat</label><input class="inp" data-in="spd.t" data-i="${i}" data-k="TempatTujuan" value="${e(t.TempatTujuan)}" ${dis}></div>
          <div class="field"><label>Kabupaten / kota</label><input class="inp" data-in="spd.t" data-i="${i}" data-k="KabKota" value="${e(t.KabKota)}" ${dis}></div>
          <div class="field"><label>Provinsi <span class="bad-t">*</span></label><select class="sel" data-in="spd.t" data-i="${i}" data-k="Provinsi" ${dis}>${SJ.PROVINSI.map(pv => `<option ${pv === t.Provinsi ? 'selected' : ''}>${pv}</option>`).join('')}</select></div>
          <div class="field"><label>Tanggal tiba</label><input class="inp" type="date" data-in="spd.t" data-i="${i}" data-k="TglTiba" value="${e(t.TglTiba)}" ${dis}></div>
          <div class="field"><label>Tanggal berangkat dari tujuan</label><input class="inp" type="date" data-in="spd.t" data-i="${i}" data-k="TglBerangkat" value="${e(t.TglBerangkat)}" ${dis}></div>
          <div class="field"><label>Pejabat pengesah</label><input class="inp" data-in="spd.t" data-i="${i}" data-k="PejabatPengesah" value="${e(t.PejabatPengesah)}" ${dis} placeholder="Kepala unit tujuan"></div></div></div>`).join('')}</div></div>
      <div class="card pad"><div class="row between mb12"><div class="sec-title">${ic('date_range', 'pri-t')} Estimasi Linimasa</div><span class="tag">${lama} hari</span></div>
        <div class="days">${Array.from({ length: Math.min(lama, 31) }, (x, i) => { const u = sp.hariUtama.indexOf(i + 1) > -1; return `<div class="day ${u ? 'u' : ''}"><b class="${u ? 'pri-t' : 'warn-t'}">Hari ${i + 1}</b><span class="muted">${tglp(SJ.tambahHari(f.TglBerangkat, i))}</span><div class="bar"><i class="${u ? '' : 'g'}"></i></div><span class="b" style="font-size:10px">${u ? 'UH ' + f.Jenis : 'UH DIKLAT'}</span></div>`; }).join('')}</div>
        <div class="legend mt12"><span><i class="dot-s" style="background:var(--primary-hover)"></i>Uang harian ${f.Jenis}</span><span><i class="dot-s" style="background:var(--gold)"></i>Uang harian Diklat</span></div></div></div>`;
  },
  step4(box, f, ro, st) {
    const dis = ro ? 'disabled' : '', x = spdDraftD(f), rec = spdOf(f.ID);
    const anggota = SJ.hitung.anggotaSPD(x.Dx, x.spd);
    const est = anggota.map(a => { const it = rec && rec.Status === 'Terbit' ? SJ.hitung.rincianOrang(S.D, rec.ID, a.NIP) : SJ.hitung.hitungOtomatis(x.Dx, x.spd, a.NIP); return { a: a, it: it, tot: SJ.sum(it, r => r.NilaiDiakui) }; });
    const total = SJ.sum(est, z => z.tot), sp = f.PaguID ? SJ.sisaPagu(S.D, f.PaguID) : null;
    const doc = rec && rec.Status !== 'Draf' && rec.Snapshot ? { d: SJ.parseJSON(rec.Snapshot, {}), draf: false } : { d: SJ.doc.spd(x.Dx, x.spd), draf: true };
    box.innerHTML = `<div class="split s5-7"><div class="col gap16">
      <div class="card pad"><div class="sec-title mb12">${ic('account_balance', 'pri-t')} Pembebanan Anggaran</div>
        <div class="kv" style="grid-template-columns:1fr"><div><div class="k">Kode rekening (otomatis dari jenis ${f.Jenis})</div><div class="v mono">${e(x.spd.KodeRekening || 'Belum diatur')} </div><div class="xs muted">${e(x.spd.UraianRekening)}</div></div><div><div class="k">Sub kegiatan</div><div class="v small">${e(x.spd.SubKegiatan || '-')}</div></div></div>
        <div class="fgrid c2 mt12"><div class="field span3"><label>Maksud perjalanan</label><textarea class="ta" data-in="spd.f" data-k="Maksud" ${dis}>${e(f.Maksud)}</textarea></div>
          <div class="field span3"><label>Penanda tangan SPD</label><select class="sel" data-in="spd.f" data-k="PenandatanganID" ${dis}>${SJ.lookup.pilihanTTD(S.D, (stOf(f.STID) || {}).OPD, 'SPD', f.TanggalTetap || SJ.hariIni()).map(j => `<option value="${j.ID}" ${j.ID === f.PenandatanganID ? 'selected' : ''}>${j.Peran === 'KPA' ? 'Kuasa Pengguna Anggaran' : 'Pengguna Anggaran'} · ${e(j.Nama)}</option>`).join('') || '<option value="">Belum ada pejabat PA/KPA — atur di Pengaturan → Pejabat & TTD</option>'}</select></div>
          <div class="field"><label>Dikeluarkan di</label><input class="inp" data-in="spd.f" data-k="TempatTetap" value="${e(f.TempatTetap)}" ${dis}></div><div class="field"><label>Tanggal penetapan</label><input class="inp" type="date" data-in="spd.f" data-k="TanggalTetap" value="${e(f.TanggalTetap)}" ${dis}></div>
          <div class="field span3"><label>Keterangan lain-lain</label><input class="inp" data-in="spd.f" data-k="Keterangan" value="${e(f.Keterangan)}" ${dis}></div></div></div>
      <div class="card"><div class="card-h"><h3>Estimasi Biaya (SBU berlaku)</h3><span class="tag gold">Dihitung instan</span></div>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Nama</th><th>Komponen</th><th class="r">Jumlah</th></tr></thead><tbody>
        ${est.map(z => `<tr><td><div class="b small">${e(nmPeg(z.a.NIP))}</div><span class="sub">${e(z.a.peran)}</span></td><td class="xs muted">${z.it.map(r => (SJ.KOMPONEN[r.Komponen] || {}).label + ' ' + r.Volume + r.Satuan.charAt(0).toLowerCase()).join(' · ')}</td><td class="r mono b">${rp(z.tot)}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">Total rombongan</td><td class="r mono">${rp(total)}</td></tr></tfoot></table></div>
        ${sp ? `<div class="card-b"><div class="row between small"><span class="muted">Sisa pagu saat ini</span><b class="mono">${rp(sp.sisa)}</b></div><div class="bar thick mt8"><i style="width:${Math.min(100, sp.persen)}%"></i><i class="p" style="width:${Math.min(100, total / Math.max(1, sp.pagu) * 100)}%"></i></div>
          ${total > sp.sisa ? `<div class="callout bad small mt12">${ic('warning', 'sm')}<div>Estimasi melebihi sisa pagu. SPJ akan <b>ditolak</b> saat verifikasi bila pagu tidak ditambah.</div></div>` : (sp.realisasi + total) / sp.pagu >= 0.9 ? `<div class="callout gold small mt12">${ic('warning', 'sm')}<div>Serapan akan mencapai ≥ 90% (waspada).</div></div>` : ''}</div>` : ''}</div>
      </div><div id="spd-paper" class="sticky">${kertas('spd', SJ.render.spd(doc.d, docOpts(doc.draf)), { judul: 'Pratinjau SPD (depan & belakang)', draf: doc.draf })}</div></div>`;
  }
};
function cekStepSPD(step, f) {
  const err = [];
  if (step >= 1) { if (!f.STID) err.push('Pilih Surat Tugas.'); if (!f.PaguID) err.push('Pilih pagu.'); if (f.AdaDiklat === 'YA' && (!f.diklat.NamaDiklat || !f.diklat.Penyelenggara || !f.diklat.TglMulai || !f.diklat.TglSelesai)) err.push('Lengkapi data diklat.'); }
  if (step >= 2) { if (!f.PelaksanaNIP) err.push('Pilih pelaksana.'); }
  if (step >= 3) {
    if (!f.TglBerangkat || !f.TglKembali) err.push('Isi tanggal berangkat & kembali.'); else if (f.TglKembali < f.TglBerangkat) err.push('Tanggal kembali sebelum tanggal berangkat.');
    if (!f.tujuan.some(t => t.TempatTujuan)) err.push('Isi minimal satu tempat tujuan.');
    if (f.AdaDiklat === 'YA' && (f.diklat.TglMulai < f.TglBerangkat || f.diklat.TglSelesai > f.TglKembali)) err.push('Tanggal diklat harus di dalam rentang perjalanan.');
  }
  return err;
}
ACT['spd.baru'] = () => { const st = S.D.Surat_Tugas.filter(s => s.Status === 'Terbit' && inOPD(s) && bisaTulis(s.OPD)).sort((a, b) => String(b.DibuatPada).localeCompare(String(a.DibuatPada)))[0]; if (!st) return toast('Belum ada Surat Tugas terbit. Terbitkan Surat Tugas terlebih dahulu.', 'warn'); S.pg.spd = Object.assign(S.pg.spd || {}, { mode: 'wizard', step: 1, form: spdDariST(st.ID) }); go('spd'); };
ACT['spd.dariST'] = el => { S.pg.spd = Object.assign(S.pg.spd || {}, { mode: 'wizard', step: 1, form: spdDariST(el.dataset.id) }); go('spd'); };
ACT['spd.buka'] = el => { S.pg.spd = Object.assign(S.pg.spd || {}, { mode: 'wizard', step: spdOf(el.dataset.id).Status === 'Draf' ? 1 : 4, form: spdDariRecord(el.dataset.id) }); go('spd'); };
ACT['spd.tutup'] = () => { S.pg.spd.mode = 'list'; S.pg.spd.form = null; refresh(); };
ACT['spd.status'] = el => { S.pg.spd.status = el.dataset.v; refresh(); };
INP['spd.q'] = debounce(el => { S.pg.spd.q = el.value; PAGES.spd.list($('#page-spd > div:last-child')); const i = $('[data-in="spd.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
ACT['spd.step'] = el => {
  const p = S.pg.spd, v = Number(el.dataset.v), rec = spdOf(p.form.ID);
  if (v > p.step && el.dataset.cek && !(rec && rec.Status !== 'Draf')) { const err = cekStepSPD(p.step, p.form); if (err.length) return toast(err.join(' '), 'bad', 6000); }
  p.step = v; refresh();
};
INP['spd.st'] = el => { S.pg.spd.form = el.value ? spdDariST(el.value) : S.pg.spd.form; refresh(); };
ACT['spd.jenis'] = el => { S.pg.spd.form.Jenis = el.dataset.v; S.pg.spd.form.PaguID = ''; refresh(); };
INP['spd.f'] = el => {
  const f = S.pg.spd.form; f[el.dataset.k] = el.value;
  if (el.dataset.k === 'TglBerangkat' && (!f.TglKembali || f.TglKembali < f.TglBerangkat)) f.TglKembali = f.TglBerangkat;
  if (['PelaksanaNIP', 'TglBerangkat', 'TglKembali', 'AlatAngkut', 'PaguID'].indexOf(el.dataset.k) > -1) { f.pengikut = f.pengikut.filter(x => x.NIP !== f.PelaksanaNIP); refresh(); }
  else if (S.pg.spd.step === 4) spdPaperDeb();
};
const spdPaperDeb = debounce(() => { const f = S.pg.spd.form, x = spdDraftD(f), pv = $('#spd-paper'); if (pv && (!spdOf(f.ID) || spdOf(f.ID).Status === 'Draf')) { pv.innerHTML = kertas('spd', SJ.render.spd(SJ.doc.spd(x.Dx, x.spd), docOpts(true)), { judul: 'Pratinjau SPD (depan & belakang)', draf: true }); pasKertas(); } }, 150);
INP['spd.diklatOn'] = el => { const f = S.pg.spd.form; f.AdaDiklat = el.checked ? 'YA' : 'TIDAK'; if (el.checked && !f.diklat.TglMulai) { f.diklat.TglMulai = SJ.tambahHari(f.TglBerangkat, 1); f.diklat.TglSelesai = SJ.tambahHari(f.TglKembali, -1) < f.diklat.TglMulai ? f.diklat.TglMulai : SJ.tambahHari(f.TglKembali, -1); } refresh(); };
INP['spd.dk'] = el => { S.pg.spd.form.diklat[el.dataset.k] = el.value; };
INP['spd.pket'] = el => { S.pg.spd.form.pengikut[Number(el.dataset.i)].Keterangan = el.value; };
ACT['spd.pdel'] = el => { S.pg.spd.form.pengikut.splice(Number(el.dataset.i), 1); refresh(); };
ACT['spd.padd'] = el => { S.pg.spd.form.pengikut.push({ NIP: el.dataset.nip, Keterangan: '' }); refresh(); };
INP['spd.cari'] = el => { const f = S.pg.spd.form; cariPegawai(el, (stOf(f.STID) || {}).OPD, [f.PelaksanaNIP].concat(f.pengikut.map(x => x.NIP)), nip => { f.pengikut.push({ NIP: nip, Keterangan: '' }); refresh(); }); };
ACT['spd.tadd'] = () => { S.pg.spd.form.tujuan.push({ TempatTujuan: '', KabKota: '', Provinsi: 'Jawa Barat', TglTiba: '', TglBerangkat: '', PejabatPengesah: '' }); refresh(); };
ACT['spd.tdel'] = el => { S.pg.spd.form.tujuan.splice(Number(el.dataset.i), 1); refresh(); };
INP['spd.t'] = el => { S.pg.spd.form.tujuan[Number(el.dataset.i)][el.dataset.k] = el.value; if (el.tagName === 'SELECT') refresh(); };
ACT['spd.simpan'] = async btn => {
  const p = S.pg.spd, f = p.form, terbit = !!btn.dataset.terbit, err = cekStepSPD(terbit ? 4 : 1, f);
  if (err.length) return toast(err.join(' '), 'bad', 6000);
  if (terbit && !(await konfirmasi('Terbitkan SPD? Nomor dikunci, rincian biaya otomatis dibuat, dan SPJ dibuka.', { ok: 'Terbitkan SPD' }))) return;
  const res = await mutasi('spd.simpan', Object.assign({}, f, { terbitkan: terbit }), { btn: btn }).catch(() => null);
  if (!res) return;
  const s = res.upsert.SPD[0]; p.form = spdDariRecord(s.ID); p.step = terbit ? 4 : p.step; refresh();
};
ACT['spd.pdf'] = el => unduhPDF({ jenis: 'SPD', id: el.dataset.id }, el);
ACT['spd.batal'] = async () => { if (!(await konfirmasi('Batalkan SPD ini? Seluruh kuitansinya ikut dibatalkan.', { bahaya: true, ok: 'Batalkan SPD' }))) return; await mutasi('spd.batal', { ID: S.pg.spd.form.ID }).catch(() => null); };

// =====================================================================
// PEMILIH SPD (dipakai Rincian, Kuitansi)
// =====================================================================
function spdTersedia(termasukDraf) {
  return S.D.SPD.filter(s => inOPD(s) && (s.Status === 'Terbit' || (termasukDraf && s.Status === 'Draf'))).sort((a, b) => SJ.iso(b.TglBerangkat).localeCompare(SJ.iso(a.TglBerangkat)));
}
function pilihSPDHTML(pg, cur, draf) {
  const list = spdTersedia(draf);
  return `<select class="sel" data-in="${pg}.spd" aria-label="Pilih SPD" style="min-width:260px;max-width:100%">${list.length ? list.map(s => `<option value="${s.ID}" ${s.ID === cur ? 'selected' : ''}>${e(s.Nomor || 'Draf')} · ${e(nmPeg(s.PelaksanaNIP))} · ${e(tglp(s.TglBerangkat))}</option>`).join('') : '<option>Tidak ada SPD</option>'}</select>`;
}
function tabOrang(pg, spd, cur, nilai) {
  return `<div class="row wrap gap8">${SJ.hitung.anggotaSPD(S.D, spd).filter(a => !isPL() || String(a.NIP) === String(S.user.NIP)).map(a => { const on = String(a.NIP) === String(cur), g = peg(a.NIP) || {};
    return `<button class="btn ${on ? 'pri' : 'sec'}" style="min-height:52px;padding:6px 12px;justify-content:flex-start" data-act="${pg}.orang" data-nip="${a.NIP}">${avatar(nmPeg(a.NIP), on ? 'gold' : '')}<span class="col" style="gap:0;text-align:left"><span class="small b">${e(nmPeg(a.NIP))}</span><span class="xs" style="opacity:.8">${e(a.peran)} · ${e(g.Golongan || g.StatusPegawai || '')}</span></span><span class="tag mono" style="${on ? 'background:rgba(255,255,255,.2);color:inherit' : ''}">${rp(nilai(a.NIP))}</span></button>`; }).join('')}</div>`;
}

// =====================================================================
// RINCIAN BIAYA (lampiran SPD) — PRD 7.4
// =====================================================================
function rinMuat(spdId, nip) {
  const p = S.pg.rincian;
  p.spd = spdId; p.nip = nip; p.dirty = false;
  const by = (S.D.Pembayaran || []).find(b => b.SPDID === spdId && String(b.NIP) === String(nip));
  p.edit = { items: deep(SJ.hitung.rincianOrang(S.D, spdId, nip)), tiket: deep((S.D.Tiket || []).filter(t => t.SPDID === spdId && String(t.NIP) === String(nip))),
    penginapan: deep((S.D.Penginapan || []).filter(t => t.SPDID === spdId && String(t.NIP) === String(nip))), dibayar: by ? SJ.num(by.NilaiDibayar) : 0 };
  ['Berangkat', 'Kembali'].forEach(a => { if (!p.edit.tiket.some(t => t.Arah === a)) p.edit.tiket.push({ Arah: a, Maskapai: '', NamaPenumpang: nmPeg(nip), NomorTiket: '', KodeBooking: '', NomorPenerbangan: '', Asal: '', Tujuan: '', Tanggal: '', Kelas: '', Harga: '' }); });
}
function rinTerkunci(spdId) { const j = spjOf(spdId); return j && (j.Status === 'Lengkap' || j.Status === 'Diverifikasi'); }
PAGES.rincian = {
  render(el) {
    const p = S.pg.rincian = S.pg.rincian || {};
    const list = spdTersedia(true);
    if (!p.spd || !spdOf(p.spd)) p.spd = (list[0] || {}).ID;
    const spd = spdOf(p.spd);
    if (!spd) { el.innerHTML = `<div class="ph"><div><h1>Rincian Biaya Perjalanan Dinas</h1></div></div>${empty('calculate', 'Belum ada SPD. Rincian dibuat otomatis saat SPD disimpan.')}`; return; }
    const ang = SJ.hitung.anggotaSPD(S.D, spd).map(a => String(a.NIP));
    if (isPL()) p.nip = String(S.user.NIP);
    if (!p.nip || ang.indexOf(String(p.nip)) < 0) p.nip = ang[0];
    if (!p.edit || p.editKey !== p.spd + '|' + p.nip || !p.dirty) { rinMuat(p.spd, p.nip); p.editKey = p.spd + '|' + p.nip; }
    const c = SJ.hitung.konteksSPD(S.D, spd), j = spjOf(spd.ID), kunci = rinTerkunci(spd.ID) || spd.Status === 'Batal';
    const bolehUbah = !kunci && (bisaTulis(spd.OPD) || isPL()), opr = bolehUbah && !isPL();
    const kh = SJ.lookup.konfigHari(S.D, spd.OPD, 'UANG_HARIAN', c.tgl), sp = SJ.hitung.splitHari(c.lama, c.adaDiklat, kh);
    const totRomb = SJ.hitung.totalSPD(S.D, spd.ID);
    el.innerHTML = `<div class="ph"><div><div class="label">${e(spd.Nomor || 'SPD draf')} · Rincian Biaya</div><h1>Rincian Biaya Perjalanan Dinas</h1><p>Lampiran SPD. Komponen otomatis dari SBU berlaku; komponen at-cost diakui sesuai riil maksimal plafon.</p></div>
      <div class="acts">${pilihSPDHTML('rin', spd.ID, true)}${opr && spd.Status !== 'Batal' ? `<button class="btn sec" data-act="rin.hitung" data-busy="Menghitung…">${ic('sync', 'sm')} Hitung ulang SBU</button>` : ''}
      ${bolehUbah ? `<button class="btn sec" data-act="rin.simpan" data-busy="Menyimpan…" id="rin-save">${ic('save', 'sm')} Simpan Perhitungan</button>` : ''}
      <button class="btn pri" data-act="rin.cetak">${ic('print', 'sm')} Cetak A4</button></div></div>
      <div class="card pad-s mb16"><div class="row wrap between gap12">${tabOrang('rin', spd, p.nip, n => n === p.nip ? SJ.sum(p.edit.items, r => r.NilaiDiakui) : SJ.hitung.totalOrang(S.D, spd.ID, n))}
        <div class="right"><div class="label">Total rombongan (${SJ.hitung.anggotaSPD(S.D, spd).length} orang)</div><div class="bb mono pri-t" style="font-size:20px">${rp(totRomb)}</div></div></div></div>
      ${kunci ? `<div class="callout neutral mb16">${ic('lock')}<div><b>Rincian terkunci</b> — SPJ berstatus ${e(j ? j.Status : spd.Status)}. ${j && j.Status === 'Lengkap' ? 'Minta verifikator mengembalikan SPJ bila perlu koreksi.' : ''}</div></div>` : ''}
      ${c.adaDiklat ? `<div class="callout gold mb16">${ic('balance')}<div><b>Ketentuan khusus: ${e(SJ.JENIS_JALAN[spd.Jenis])} digabung Diklat (${c.lama} hari)</b> <span class="tag gold">Split-rate</span><div class="small">Hari ke-${sp.hariUtama.join(' & ')} dibayar uang harian ${spd.Jenis}; ${sp.sisa ? 'hari ke-' + sp.hariSisa[0] + ' s.d. ' + sp.hariSisa[sp.hariSisa.length - 1] + ' dibayar uang harian Diklat' : 'tanpa hari Diklat (lama ≤ ' + (kh.awal + kh.akhir) + ' hari)'}. ${c.diklat ? e(c.diklat.NamaDiklat) + ' — ' + e(c.diklat.Penyelenggara) : ''}</div></div></div>` : ''}
      <div class="split s8-4 lebar"><div class="col gap16" id="rin-left"></div><div class="col gap16" id="rin-right"></div></div>`;
    this.kiri(spd, bolehUbah, opr); this.kanan(spd, bolehUbah, opr);
  },
  kiri(spd, ubah, opr) {
    const p = S.pg.rincian, it = p.edit.items, c = SJ.hitung.konteksSPD(S.D, spd), pg = peg(p.nip), t = SJ.lookup.tingkatBiaya(S.D, pg, spd.OPD, c.tgl);
    const manual = Object.keys(SJ.KOMPONEN).filter(k => k !== 'REPRESENTASI' || SJ.lookup.isEselonII(pg));
    const tot = SJ.sum(it, r => r.NilaiDiakui);
    $('#rin-left').innerHTML = `<div class="card"><div class="card-h"><div class="row gap8">${ic('receipt_long', 'pri-t')}<h3>Rincian per Komponen</h3></div><span class="tag">Tingkat ${t} · ${e(c.prov)}</span></div>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th style="width:30px">No</th><th style="min-width:150px">Komponen</th><th class="r">Volume</th><th class="r">Harga / Plafon<span class="sub" style="font-weight:500;text-transform:none;letter-spacing:0">= ketetapan</span></th><th class="r">Nilai Riil</th><th class="r">Diakui</th>${opr ? '<th></th>' : ''}</tr></thead><tbody>
      ${it.length ? it.map((r, i) => { const k = SJ.KOMPONEN[r.Komponen] || { label: r.Komponen, tipe: 'atcost' }, lump = k.tipe === 'lumpsum', beda = r.NilaiRiil !== '' && r.NilaiRiil !== null && SJ.num(r.NilaiRiil) > SJ.num(r.Jumlah) && SJ.num(r.Jumlah) > 0;
        return `<tr><td class="c mono muted">${i + 1}</td><td><div class="b small">${e(k.label)}${r.Kategori === 'DIKLAT' && r.Komponen !== 'UANG_HARIAN_DIKLAT' ? ' (Diklat)' : ''}</div>
          ${opr ? `<input class="inp" style="min-height:28px;font-size:11.5px;margin-top:4px" data-in="rin.it" data-i="${i}" data-k="Keterangan" value="${e(r.Keterangan || '')}" placeholder="Keterangan">` : `<span class="sub">${e(r.Keterangan || '')}</span>`}</td>
          <td class="r">${opr ? `<input class="cell" type="number" min="0" step="1" data-in="rin.it" data-i="${i}" data-k="Volume" value="${r.Volume}" aria-label="Volume" style="width:58px">` : SJ.num(r.Volume)} <span class="xs muted">${e(r.Satuan)}</span></td>
          <td class="r">${opr && !lump ? `<input class="cell" type="number" min="0" data-in="rin.it" data-i="${i}" data-k="Harga" value="${r.Harga}" aria-label="Harga plafon" style="width:100px">` : `<span class="mono">${rp(r.Harga)}</span>`}<span class="sub">${lump ? 'SBU tetap' : 'plafon'} · <b class="mono" data-out="jml-${i}">${rp(r.Jumlah)}</b></span></td>
          <td class="r">${!lump && ubah ? `<input class="cell ${beda ? 'bad' : ''}" type="number" min="0" data-in="rin.it" data-i="${i}" data-k="NilaiRiil" value="${r.NilaiRiil === null ? '' : r.NilaiRiil}" placeholder="= ketetapan" aria-label="Nilai riil" style="width:104px">` : `<span class="mono muted">${lump ? '—' : (r.NilaiRiil === '' ? '—' : rp(r.NilaiRiil))}</span>`}</td>
          <td class="r mono b" data-out="dk-${i}">${rp(r.NilaiDiakui)}</td>${opr ? `<td><button class="btn ghost icon sm" data-act="rin.del" data-i="${i}" aria-label="Hapus komponen">${ic('delete', 'sm')}</button></td>` : ''}</tr>`; }).join('') : `<tr><td colspan="7">${empty('calculate', 'Belum ada komponen.')}</td></tr>`}
      </tbody><tfoot><tr><td colspan="5" class="r">JUMLAH TOTAL<div class="xs muted" style="font-weight:400;font-style:italic" data-out="terbilang">${e(SJ.terbilang(tot))}</div></td><td class="r mono" data-out="tot">${rp(tot)}</td>${opr ? '<td></td>' : ''}</tr></tfoot></table></div>
      ${opr ? `<div class="card-b row wrap gap8"><select class="sel" id="rin-addk" style="width:auto">${manual.map(k => `<option value="${k}">${e(SJ.KOMPONEN[k].label)}</option>`).join('')}</select><button class="btn soft" data-act="rin.add">${ic('add', 'sm')} Tambah komponen</button><span class="small muted grow">Representasi hanya untuk eselon II. Komponen lumpsum memakai nilai SBU.</span></div>` : ''}</div>
      <details class="card" open><summary class="card-h" style="cursor:pointer;list-style:none"><div class="row gap8"><span class="kpi-ico g" style="width:32px;height:32px">${ic('confirmation_number', 'sm')}</span><div><b>Informasi Tiket Berangkat & Kembali</b><div class="xs muted">Dicatat untuk rekap; total otomatis menjadi komponen Tiket.</div></div></div>${ic('expand_more')}</summary>
        <div class="card-b col gap12">${p.edit.tiket.map((x, i) => `<div style="padding:12px;border-radius:10px;background:var(--surface-2)"><div class="row between mb8"><span class="tag ${x.Arah === 'Berangkat' ? 'pri' : 'gold'}">${ic(x.Arah === 'Berangkat' ? 'flight_takeoff' : 'flight_land', 'sm')} ${x.Arah}</span>${x.Tanggal && SJ.iso(x.Tanggal) !== SJ.iso(x.Arah === 'Berangkat' ? spd.TglBerangkat : spd.TglKembali) ? `<span class="tag" style="background:var(--warn-bg);color:var(--warn)">${ic('warning', 'sm')} Tanggal beda dengan SPD</span>` : ''}</div>
          <div class="fgrid c4">${[['Maskapai', 'Maskapai / operator'], ['NamaPenumpang', 'Nama'], ['NomorTiket', 'No. tiket'], ['KodeBooking', 'Kode booking'], ['NomorPenerbangan', 'No. penerbangan/KA'], ['Asal', 'Asal'], ['Tujuan', 'Tujuan'], ['Kelas', 'Kelas']].map(fl => `<div class="field"><label>${fl[1]}</label><input class="inp" data-in="rin.tk" data-i="${i}" data-k="${fl[0]}" value="${e(x[fl[0]] || '')}" ${ubah ? '' : 'disabled'}></div>`).join('')}
          <div class="field"><label>Tanggal</label><input class="inp" type="date" data-in="rin.tk" data-i="${i}" data-k="Tanggal" value="${e(SJ.iso(x.Tanggal))}" ${ubah ? '' : 'disabled'}></div><div class="field"><label>Harga (Rp)</label><input class="inp" type="number" min="0" data-in="rin.tk" data-i="${i}" data-k="Harga" value="${e(x.Harga)}" ${ubah ? '' : 'disabled'}></div></div></div>`).join('')}</div></details>
      <details class="card" ${p.edit.penginapan.length ? 'open' : ''}><summary class="card-h" style="cursor:pointer;list-style:none"><div class="row gap8"><span class="kpi-ico g" style="width:32px;height:32px">${ic('hotel', 'sm')}</span><div><b>Informasi Penginapan</b><div class="xs muted">Nilai riil penginapan terisi otomatis dari data ini.</div></div></div>${ic('expand_more')}</summary>
        <div class="card-b col gap8">${p.edit.penginapan.map((x, i) => `<div class="fgrid c4" style="align-items:end"><div class="field"><label>Nama penginapan</label><input class="inp" data-in="rin.inp" data-i="${i}" data-k="NamaPenginapan" value="${e(x.NamaPenginapan)}" ${ubah ? '' : 'disabled'}></div>
          <div class="field"><label>Malam</label><input class="inp" type="number" min="0" data-in="rin.inp" data-i="${i}" data-k="Malam" value="${e(x.Malam)}" ${ubah ? '' : 'disabled'}></div><div class="field"><label>Harga / malam</label><input class="inp" type="number" min="0" data-in="rin.inp" data-i="${i}" data-k="Harga" value="${e(x.Harga)}" ${ubah ? '' : 'disabled'}></div>
          <div class="row gap8"><input class="inp" placeholder="Keterangan" data-in="rin.inp" data-i="${i}" data-k="Keterangan" value="${e(x.Keterangan || '')}" ${ubah ? '' : 'disabled'}>${ubah ? `<button class="btn ghost icon" data-act="rin.inpdel" data-i="${i}" aria-label="Hapus">${ic('delete', 'sm')}</button>` : ''}</div></div>`).join('') || '<div class="small muted">Belum ada data penginapan.</div>'}
          ${ubah ? `<button class="btn soft sm" data-act="rin.inpadd" style="align-self:flex-start">${ic('add', 'sm')} Tambah penginapan</button>` : ''}</div></details>`;
  },
  kanan(spd, ubah, opr) {
    const p = S.pg.rincian, tot = SJ.sum(p.edit.items, r => r.NilaiDiakui), sisa = tot - SJ.num(p.edit.dibayar), j = spjOf(spd.ID);
    const pptk = SJ.lookup.pejabat(S.D, spd.OPD, 'PPTK', SJ.iso(spd.TglBerangkat)) || {};
    $('#rin-right').innerHTML = `<div class="card" style="overflow:hidden"><div class="row between" style="padding:12px 16px;background:var(--primary);color:#fff"><div class="row gap8">${ic('account_balance_wallet', 'sm')}<b>Status Pembayaran & Kas</b></div><span class="xs mono" style="opacity:.8">${e(singkat(spd.OPD))}</span></div>
      <div class="card-b col gap12"><div class="row between"><span class="muted small">Nilai ditetapkan</span><b class="mono" data-out="tet">${rp(tot)}</b></div>
        <div class="field"><label>Dibayar semula (uang muka/panjar)</label><div class="inp-g"><span class="pre">Rp</span><input class="inp mono" type="number" min="0" data-in="rin.bayar" value="${p.edit.dibayar}" ${opr ? '' : 'disabled'}></div></div>
        <div style="padding:14px;border-radius:12px;background:var(--primary-soft)"><div class="row between"><span class="label pri-t">Sisa kurang / (lebih)</span><span class="pill ${sisa >= 0 ? 'ok' : 'bad'} nodot" data-out="sisaLbl">${sisa >= 0 ? 'Kurang bayar ke pegawai' : 'Lebih bayar (dikembalikan)'}</span></div><div class="bb mono pri-t" style="font-size:26px" data-out="sisa">${rp(Math.abs(sisa))}</div></div>
        <div class="kv" style="grid-template-columns:1fr"><div><div class="k">Kode rekening</div><div class="v mono small">${e(spd.KodeRekening)}</div><div class="xs muted">${e(spd.UraianRekening)}</div></div><div><div class="k">Sub kegiatan</div><div class="v small">${e(spd.SubKegiatan)}</div></div></div></div></div>
      <div class="card pad"><div class="row gap8 mb12">${ic('draw', 'pri-t')}<b>Lembar Pengesahan Rincian</b></div>
        <div class="col gap8"><div class="chip"><span class="kpi-ico g" style="width:32px;height:32px">${ic('person', 'sm')}</span><div class="grow"><div class="xs muted">Yang menerima</div><div class="b small">${e(nmPeg(p.nip))}</div><div class="xs mono muted">NIP ${e(SJ.fmtNip(p.nip))}</div></div></div>
        <div class="chip"><span class="kpi-ico b" style="width:32px;height:32px">${ic('approval', 'sm')}</span><div class="grow"><div class="xs muted">PPTK</div><div class="b small">${e(pptk.Nama || '—')}</div><div class="xs mono muted">NIP ${e(SJ.fmtNip(pptk.NIP || ''))}</div></div><span class="tag">${e(pptk.Metode || 'Basah')}</span></div></div>
        <div class="col gap8 mt16">${spd.Status === 'Terbit' && bisaTulis(spd.OPD) ? `<button class="btn pri block" data-act="go" data-r="kuitansi" data-p='{"spd":"${spd.ID}","nip":"${p.nip}"}'>${ic('receipt_long', 'sm')} Terbitkan / Lihat Kuitansi</button>` : ''}
          <button class="btn sec block" data-act="go" data-r="spj" data-p='{"id":"${spd.ID}"}'>${ic('verified', 'sm')} SPJ: ${e(j ? j.Status : '—')}</button></div></div>`;
  },
  turunan() {
    const p = S.pg.rincian, it = p.edit.items;
    it.forEach((r, i) => { SJ.hitung.normalisasiBaris(r); const a = $(`[data-out="jml-${i}"]`), b = $(`[data-out="dk-${i}"]`); if (a) a.textContent = rp(r.Jumlah); if (b) b.textContent = rp(r.NilaiDiakui); });
    const tot = SJ.sum(it, r => r.NilaiDiakui), sisa = tot - SJ.num(p.edit.dibayar);
    const set = (k, v) => { const x = $(`[data-out="${k}"]`); if (x) x.textContent = v; };
    set('tot', rp(tot)); set('tet', rp(tot)); set('terbilang', SJ.terbilang(tot)); set('sisa', rp(Math.abs(sisa))); set('sisaLbl', sisa >= 0 ? 'Kurang bayar ke pegawai' : 'Lebih bayar (dikembalikan)');
    p.dirty = true; const b = $('#rin-save'); if (b) b.classList.replace('sec', 'gold');
  }
};
INP['rin.spd'] = async el => { const p = S.pg.rincian; if (p.dirty && !(await konfirmasi('Perubahan rincian belum disimpan. Tinggalkan?', { ok: 'Tinggalkan' }))) { el.value = p.spd; return; } p.spd = el.value; p.nip = ''; p.dirty = false; refresh(); };
ACT['rin.orang'] = async el => { const p = S.pg.rincian; if (p.dirty && !(await konfirmasi('Perubahan rincian belum disimpan. Tinggalkan?', { ok: 'Tinggalkan' }))) return; p.nip = el.dataset.nip; p.dirty = false; refresh(); };
INP['rin.it'] = el => { const r = S.pg.rincian.edit.items[Number(el.dataset.i)]; r[el.dataset.k] = el.dataset.k === 'Keterangan' ? el.value : (el.value === '' && el.dataset.k === 'NilaiRiil' ? '' : SJ.num(el.value)); PAGES.rincian.turunan(); };
INP['rin.bayar'] = el => { S.pg.rincian.edit.dibayar = SJ.num(el.value); PAGES.rincian.turunan(); };
INP['rin.tk'] = el => { S.pg.rincian.edit.tiket[Number(el.dataset.i)][el.dataset.k] = el.value; S.pg.rincian.dirty = true; };
INP['rin.inp'] = el => { S.pg.rincian.edit.penginapan[Number(el.dataset.i)][el.dataset.k] = el.value; S.pg.rincian.dirty = true; };
ACT['rin.inpadd'] = () => { const p = S.pg.rincian; p.edit.penginapan.push({ NamaPenginapan: '', Malam: Math.max(0, SJ.num((spdOf(p.spd) || {}).LamaHari) - 1), Harga: '', Keterangan: '' }); p.dirty = true; PAGES.rincian.kiri(spdOf(p.spd), true, bisaTulis(spdOf(p.spd).OPD)); };
ACT['rin.inpdel'] = el => { const p = S.pg.rincian; p.edit.penginapan.splice(Number(el.dataset.i), 1); p.dirty = true; PAGES.rincian.kiri(spdOf(p.spd), true, bisaTulis(spdOf(p.spd).OPD)); };
ACT['rin.del'] = el => { const p = S.pg.rincian; p.edit.items.splice(Number(el.dataset.i), 1); p.dirty = true; PAGES.rincian.kiri(spdOf(p.spd), true, true); PAGES.rincian.turunan(); };
ACT['rin.add'] = () => {
  const p = S.pg.rincian, spd = spdOf(p.spd), k = $('#rin-addk').value, kp = SJ.KOMPONEN[k], c = SJ.hitung.konteksSPD(S.D, spd);
  const t = SJ.lookup.tingkatBiaya(S.D, peg(p.nip), spd.OPD, c.tgl);
  const sb = SJ.lookup.sbu(S.D, k === 'UANG_HARIAN_DIKLAT' ? 'UANG_HARIAN' : k, k === 'UANG_HARIAN_DIKLAT' ? 'DIKLAT' : spd.Jenis, k === 'REPRESENTASI' ? 'A' : t, c.prov, c.tgl);
  p.edit.items.push(SJ.hitung.normalisasiBaris({ ID: '', SPDID: spd.ID, NIP: p.nip, Komponen: k, Kategori: k === 'UANG_HARIAN_DIKLAT' ? 'DIKLAT' : spd.Jenis, Volume: k === 'TIKET' ? 1 : (kp.satuan === 'OH' ? c.lama : 1), Satuan: kp.satuan, Harga: sb ? SJ.num(sb.Nilai) : 0, NilaiRiil: '', SBUID: sb ? sb.ID : '', Keterangan: '' }));
  p.dirty = true; PAGES.rincian.kiri(spd, true, true); PAGES.rincian.turunan();
};
ACT['rin.simpan'] = async btn => {
  const p = S.pg.rincian, spd = spdOf(p.spd), nip = p.nip, ed = deep(p.edit);
  ed.tiket = ed.tiket.filter(t => t.Maskapai || SJ.num(t.Harga));
  const res = await mutasi('rincian.simpan', { SPDID: spd.ID, NIP: nip, items: ed.items, tiket: ed.tiket, penginapan: ed.penginapan, dibayar: ed.dibayar }, {
    btn: btn,
    opt: () => {
      const old = deep({ r: S.D.Rincian_Biaya, t: S.D.Tiket, i: S.D.Penginapan });
      const not = r => !(r.SPDID === spd.ID && String(r.NIP) === String(nip));
      S.D.Rincian_Biaya = S.D.Rincian_Biaya.filter(not).concat(ed.items.map(r => Object.assign({}, r, { SPDID: spd.ID, NIP: nip })));
      return () => { S.D.Rincian_Biaya = old.r; S.D.Tiket = old.t; S.D.Penginapan = old.i; };
    }
  }).catch(() => null);
  if (res) { p.dirty = false; p.editKey = ''; refresh(); }
};
ACT['rin.hitung'] = async btn => {
  const p = S.pg.rincian;
  if (!(await konfirmasi('Hitung ulang komponen otomatis (uang harian, representasi, penginapan, transport, taksi) dari SBU & konfigurasi yang berlaku? Komponen manual dan nilai riil dipertahankan.', { ok: 'Hitung ulang' }))) return;
  await mutasi('rincian.hitungUlang', { SPDID: p.spd }, { btn: btn }).catch(() => null);
  p.dirty = false; p.editKey = ''; refresh();
};
ACT['rin.cetak'] = () => {
  const p = S.pg.rincian, spd = spdOf(p.spd);
  const orang = isPL() ? [S.user.NIP] : SJ.hitung.anggotaSPD(S.D, spd).map(a => a.NIP);
  const html = orang.map(n => SJ.render.rincian(SJ.doc.rincian(S.D, spd, n), docOpts(spd.Status !== 'Terbit'))).join('');
  const m = modal({ title: 'Rincian Biaya — ' + e(spd.Nomor || 'draf'), size: 'xl', body: kertas('rinmod', html, { judul: orang.length + ' lembar rincian', draf: spd.Status !== 'Terbit' }),
    foot: `<button class="btn sec" data-x>Tutup</button><button class="btn pri" data-act="rin.pdf" data-busy="Menyusun PDF…">${ic('picture_as_pdf', 'sm')} Unduh PDF</button>` });
  setTimeout(pasKertas, 30); return m;
};
ACT['rin.pdf'] = el => unduhPDF({ jenis: 'RINCIAN', id: S.pg.rincian.spd, nip: isPL() ? S.user.NIP : '' }, el);

// =====================================================================
// KUITANSI PER KOMPONEN — PRD 7.5 (7 templat)
// =====================================================================
const SLOT_KWT = [
  ['KWT_UH', 'UANG_HARIAN', 'Uang Harian & Uang Harian Diklat', 'Kuitansi 1 · DK/DB + Diklat (satu lembar)'],
  ['KWT_TRANSPORT', 'TRANSPORT', 'Uang Transport', 'Kuitansi 3'], ['KWT_REPRESENTASI', 'REPRESENTASI', 'Uang Representasi', 'Kuitansi 4'],
  ['KWT_PENGINAPAN', 'PENGINAPAN', 'Biaya Penginapan', 'Kuitansi 5'], ['KWT_TAKSI_JABAR', 'TAKSI', 'Sewa Taksi Dalam Jawa Barat', 'Kuitansi 6'], ['KWT_TAKSI_LUAR', 'TAKSI', 'Sewa Taksi Luar Jawa Barat', 'Kuitansi 7']
];
function alasanTidak(slot, spd, nip) {
  const c = SJ.hitung.konteksSPD(S.D, spd), g = peg(nip);
  switch (slot[0]) {
    case 'KWT_UH_DIKLAT': return c.adaDiklat ? 'Lama perjalanan tidak melebihi hari awal + akhir' : 'Perjalanan tidak digabung Diklat';
    case 'KWT_TRANSPORT': return spd.Jenis !== 'DB' ? 'Hanya untuk Perjalanan Dinas Biasa' : 'Alat angkut bukan kendaraan umum/lainnya (' + spd.AlatAngkut + ')';
    case 'KWT_REPRESENTASI': return SJ.lookup.isEselonII(g) ? 'Tidak ada komponen representasi' : 'Hanya pejabat eselon II';
    case 'KWT_PENGINAPAN': return 'Tidak ada biaya penginapan';
    case 'KWT_TAKSI_JABAR': return SJ.lookup.jabar(c.prov) ? 'Tidak ada komponen taksi' : 'Tujuan di luar Jawa Barat (' + c.prov + ')';
    case 'KWT_TAKSI_LUAR': return SJ.lookup.jabar(c.prov) ? 'Tujuan di Jawa Barat' : 'Tidak ada komponen taksi';
    default: return 'Tidak ada komponen';
  }
}
PAGES.kuitansi = {
  render(el) {
    const p = S.pg.kuitansi = S.pg.kuitansi || {};
    const list = spdTersedia(false);
    if (!p.spd || !spdOf(p.spd) || spdOf(p.spd).Status !== 'Terbit') p.spd = (list[0] || {}).ID;
    const spd = spdOf(p.spd);
    if (!spd) { el.innerHTML = `<div class="ph"><div><h1>Kuitansi per Komponen Biaya</h1></div></div>${empty('receipt_long', 'Belum ada SPD terbit.')}`; return; }
    const ang = SJ.hitung.anggotaSPD(S.D, spd).map(a => String(a.NIP));
    if (isPL()) p.nip = String(S.user.NIP);
    if (!p.nip || ang.indexOf(String(p.nip)) < 0) p.nip = ang[0];
    const kwAll = S.D.Kuitansi.filter(k => k.SPDID === spd.ID && k.Status !== 'Batal');
    const kw = kwAll.filter(k => String(k.NIP) === String(p.nip));
    const rencana = SJ.hitung.rencanaKuitansi(S.D, spd, p.nip);
    const j = spjOf(spd.ID), kunci = j && j.Status === 'Diverifikasi', ubah = bisaTulis(spd.OPD) && !kunci;
    const belum = SJ.hitung.anggotaSPD(S.D, spd).reduce((n, a) => n + SJ.hitung.rencanaKuitansi(S.D, spd, a.NIP).filter(rk => !kwAll.some(k => String(k.NIP) === String(a.NIP) && k.Komponen === rk.Komponen && Math.round(SJ.num(k.Nominal)) === rk.Nominal)).length, 0);
    const nomor = kwAll.map(k => k.Nomor).sort();
    const tot = SJ.sum(kw, k => k.Nominal);
    p.tgl = p.tgl || SJ.hariIni();
    // Slot terpilih
    const slots = SLOT_KWT.concat(rencana.filter(r => r.Templat === 'KWT_UMUM').map(r => ['KWT_UMUM', r.Komponen, SJ.KOMPONEN[r.Komponen].label, 'Kuitansi umum']))
      .concat(kw.filter(k => k.Komponen === 'UANG_HARIAN_DIKLAT').map(k => [k.Templat, k.Komponen, 'Uang Harian Diklat (format lama)', 'Kini digabung ke Kuitansi 1 — terbitkan ulang']));
    const isi = slots.map(s => {
      const rk = rencana.find(r => r.Komponen === s[1] && r.Templat === s[0]) || rencana.find(r => r.Komponen === s[1] && s[0] === 'KWT_UMUM');
      const k = kw.find(x => x.Komponen === s[1] && (x.Templat === s[0] || s[0] === 'KWT_UMUM'));
      return { s: s, rk: rk, k: k, aktif: !!(rk || k) };
    });
    if (!p.sel || !isi.some(x => x.aktif && x.s[0] + x.s[1] === p.sel)) { const f = isi.find(x => x.aktif); p.sel = f ? f.s[0] + f.s[1] : ''; }
    el.innerHTML = `<div class="ph"><div><div class="label">${e(spd.Nomor)} · Kuitansi komponen biaya</div><h1>Kuitansi per Komponen Biaya</h1><p>Satu kuitansi untuk setiap komponen yang dibayarkan kepada setiap pelaksana/pengikut. Kop & pejabat mengikuti OPD pemilik SPD (${e(singkat(spd.OPD))}).</p></div>
      <div class="acts">${pilihSPDHTML('kw', spd.ID, false)}<button class="btn sec" data-act="kw.cetakSemua">${ic('print', 'sm')} Cetak ${isPL() ? 'kuitansi saya' : 'pegawai ini'}</button>
      <button class="btn pri" data-act="kw.bundel" data-busy="Menyusun bundel PDF…">${ic('picture_as_pdf', 'sm')} Unduh Bundel PDF</button></div></div>
      ${ubah && belum ? `<div class="callout gold mb16 wrap">${ic('receipt_long')}<div class="grow"><b>${belum} kuitansi belum terbit / berbeda nominal</b> untuk rombongan ini.<div class="small">Nomor diambil berurutan & dikunci (LockService), urutan tetap: uang harian → transport → representasi → penginapan → taksi.</div></div>
        <div class="row gap8 wrap"><div class="field" style="min-width:160px"><label class="xs">Tanggal bayar</label><input class="inp" type="date" data-in="kw.tgl" value="${e(p.tgl)}" style="min-height:34px"></div><button class="btn pri" data-act="kw.terbit" data-busy="Menerbitkan…" style="align-self:flex-end">${ic('verified', 'sm')} Terbitkan Kuitansi</button></div></div>` : ''}
      ${kunci ? `<div class="callout ok mb16">${ic('lock')}<div><b>SPJ diverifikasi</b> — kuitansi terkunci. Nomor ${e(nomor[0] || '')}${nomor.length > 1 ? ' s.d. ' + e(nomor[nomor.length - 1]) : ''}.</div></div>` : ''}
      <div class="card pad-s mb16"><div class="row wrap between gap12"><div class="row gap8"><span class="kpi-ico g" style="width:32px;height:32px">${ic('group', 'sm')}</span><div><b>Pelaksana & Pengikut</b><div class="xs muted">Pilih pegawai untuk melihat set kuitansinya.</div></div></div>
        ${tabOrang('kw', spd, p.nip, n => SJ.sum(kwAll.filter(k => String(k.NIP) === String(n)), k => k.Nominal))}</div></div>
      <div class="grid g4 mb16">
        <div class="card kpi"><div class="kpi-top"><span class="label">Total Nominal Kuitansi</span>${ic('payments', 'pri-t')}</div><div><div class="kpi-val mono">${rp(tot)}</div><div class="xs muted mt8">Rincian diakui ${rp(SJ.sum(rencana, r => r.Nominal))}</div></div><div class="bar"><i style="width:${Math.min(100, tot / Math.max(1, SJ.sum(rencana, r => r.Nominal)) * 100)}%"></i></div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">Templat Terbit</span><span class="tag pri">${kw.length}/${rencana.length}</span></div><div><div class="kpi-val mono">${kw.length} <span class="muted" style="font-size:14px;font-weight:500">/ ${SLOT_KWT.length} slot</span></div><div class="xs muted mt8">${SLOT_KWT.length - isi.filter(x => x.aktif && x.s[0] !== 'KWT_UMUM' && x.s[1] !== 'UANG_HARIAN_DIKLAT').length} slot tidak memenuhi kriteria</div></div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">Penomoran LockService</span>${ic('verified_user', 'pri-t')}</div><div><div class="mono b small">${kw.length ? e(kw.map(k => k.Nomor).sort()[0]) + (kw.length > 1 ? '<br>s.d. ' + e(kw.map(k => k.Nomor).sort().slice(-1)[0]) : '') : 'Belum ada nomor'}</div><div class="xs ok-t b mt8">Tidak dapat ganda</div></div></div>
        <div class="card kpi"><div class="kpi-top"><span class="label">Status Rekonsiliasi</span>${pill(j ? j.Status : '-')}</div><div><div class="b ${kunci ? 'ok-t' : ''}">${kunci ? 'Siap SPJ & lunas bayar' : j && j.Status === 'Lengkap' ? 'Menunggu verifikasi' : 'Dalam proses'}</div><div class="xs muted mt8">Total SPJ rombongan ${rp(SJ.hitung.totalSPD(S.D, spd.ID))}</div></div></div></div>
      <div class="split s7-5"><div class="col gap12">${isi.map((x, i) => this.kartu(x, i, spd, ubah)).join('')}</div><div class="sticky" id="kw-paper"></div></div>`;
    this.preview();
  },
  kartu(x, i, spd, ubah) {
    const p = S.pg.kuitansi, on = p.sel === x.s[0] + x.s[1];
    if (!x.aktif) return `<div class="card pad" style="opacity:.62;background:var(--surface-2)"><div class="row between gap12"><div class="row gap12"><span class="kpi-ico" style="background:var(--surface-3);color:var(--muted)">${i + 1}</span><div><div class="b muted">${e(x.s[2])}</div><div class="xs muted">${e(x.s[3])} · ${e(alasanTidak(x.s, spd, p.nip))}</div></div></div><span class="pill neu">Tidak berlaku</span></div></div>`;
    const k = x.k, rk = x.rk, beda = k && rk && Math.round(SJ.num(k.Nominal)) !== rk.Nominal;
    const nominal = k ? SJ.num(k.Nominal) : rk.Nominal;
    return `<div class="list-card ${on ? 'on' : ''}" data-act="kw.pilih" data-v="${x.s[0] + x.s[1]}" role="button" tabindex="0">
      <div class="row between top gap12"><div class="row top gap12"><span class="kpi-ico ${on ? 'd' : 'g'}" style="font-weight:700">${i + 1}</span><div style="min-width:0"><div class="row wrap gap8"><b>${e(x.s[2])}</b>${k ? pill(beda ? 'Waspada' : 'Terbit', beda ? 'Nominal berubah' : 'Terbit') : pill('Draf', 'Belum terbit')}</div>
        <div class="xs muted mt8 row wrap gap8">${k ? `<span>No: <b class="mono" style="color:var(--text)">${e(k.Nomor)}</b></span><span>Tgl bayar: <b>${e(tglp(k.TanggalBayar))}</b></span>` : `<span>${e(x.s[3])}</span>`}<span>Rek: <b class="mono">${e(spd.KodeRekening)}</b></span></div></div></div>
        <div class="right" style="flex:none"><div class="bb mono pri-t" style="font-size:18px">${rp(nominal)}</div>${beda ? `<div class="xs bad-t">rincian kini ${rp(rk.Nominal)}</div>` : ''}</div></div>
      <div class="small mt12" style="padding:10px;border-radius:8px;background:var(--surface-2)"><div><b>Uraian:</b> ${e(k ? k.Uraian : rk.Uraian)}</div><div class="muted mt8" style="font-style:italic">Terbilang: “${e(SJ.terbilang(nominal))}”</div></div>
      ${k ? `<div class="row between mt12" data-stop><span class="xs muted row gap4">${ic('verified', 'sm ok-t')} Penerima: ${e(k.NamaPenerima)}</span><div class="row gap4">
        <button class="btn sec sm" data-act="kw.cetak1" data-id="${k.ID}">${ic('print', 'sm')} Cetak</button><button class="btn sec sm" data-act="kw.pdf1" data-id="${k.ID}" data-busy="">${ic('picture_as_pdf', 'sm')}</button>
        ${ubah ? `<button class="btn ghost sm" data-act="kw.batal" data-id="${k.ID}" aria-label="Batalkan kuitansi">${ic('block', 'sm')}</button>` : ''}</div></div>` : ''}</div>`;
  },
  preview() {
    const p = S.pg.kuitansi, spd = spdOf(p.spd); if (!spd) return;
    const rencana = SJ.hitung.rencanaKuitansi(S.D, spd, p.nip);
    const k = S.D.Kuitansi.find(x => x.SPDID === spd.ID && String(x.NIP) === String(p.nip) && x.Status !== 'Batal' && (x.Templat + x.Komponen === p.sel || ('KWT_UMUM' + x.Komponen === p.sel)));
    const rk = rencana.find(r => r.Templat + r.Komponen === p.sel);
    let d = null, draf = false;
    if (k) d = SJ.parseJSON(k.Snapshot, null); else if (rk) { d = SJ.doc.kuitansi(S.D, spd, p.nip, rk, null); draf = true; }
    const pv = $('#kw-paper'); if (!pv) return;
    pv.innerHTML = d ? kertas('kw', SJ.render.kuitansi(d, docOpts(draf)), { judul: 'Pratinjau lembar fisik kuitansi', draf: draf }) +
      `<div class="card pad-s mt12 small"><div class="row between"><b>Blok tanda tangan (5 kolom)</b><span class="tag">${e(d.bidang || 'Tanpa bidang')}</span></div><div class="muted mt8">Mengetahui ${e((d.pa || {}).label || 'Pengguna Anggaran')} · Menyetujui PPTK${d.bidang ? ' ' + e(d.bidang) : ''} · Dibayar oleh Bendahara Pengeluaran · Pembantu Bendahara Pengeluaran${d.bidang ? ' ' + e(d.bidang) : ''} · Yang menerima: <b>${e(nmPeg(p.nip))}</b></div><div class="xs muted mt8">PPTK & PBP mengikuti <b>bidang</b> pada pagu sub kegiatan SPD (Pengaturan → Pagu).</div></div>` : empty('receipt', 'Pilih kuitansi.');
    setTimeout(pasKertas, 0);
  }
};
INP['kw.spd'] = el => { S.pg.kuitansi.spd = el.value; S.pg.kuitansi.nip = ''; S.pg.kuitansi.sel = ''; refresh(); };
INP['kw.tgl'] = el => { S.pg.kuitansi.tgl = el.value; };
ACT['kw.orang'] = el => { S.pg.kuitansi.nip = el.dataset.nip; S.pg.kuitansi.sel = ''; refresh(); };
ACT['kw.pilih'] = el => { S.pg.kuitansi.sel = el.dataset.v; $$('#page-kuitansi .list-card').forEach(c => c.classList.toggle('on', c.dataset.v === el.dataset.v)); PAGES.kuitansi.preview(); };
ACT['kw.terbit'] = async btn => {
  const p = S.pg.kuitansi, spd = spdOf(p.spd);
  const adaBeda = S.D.Kuitansi.some(k => { if (k.SPDID !== spd.ID || k.Status === 'Batal') return false; const rr = SJ.hitung.rencanaKuitansi(S.D, spd, k.NIP), m = rr.find(rk => rk.Komponen === k.Komponen); return !m || m.Nominal !== Math.round(SJ.num(k.Nominal)); });
  let ganti = false;
  if (adaBeda) { ganti = await konfirmasi('Ada kuitansi terbit yang nominalnya kini berbeda dengan rincian. Batalkan yang lama dan terbitkan ulang dengan nomor baru?', { ok: 'Ya, terbitkan ulang' }); }
  await mutasi('kuitansi.terbit', { SPDID: spd.ID, TanggalBayar: p.tgl, ganti: ganti }, { btn: btn }).catch(() => null);
};
ACT['kw.batal'] = async el => { if (!(await konfirmasi('Batalkan kuitansi ini? Nomor tidak dipakai ulang.', { bahaya: true, ok: 'Batalkan' }))) return; await mutasi('kuitansi.batal', { ID: el.dataset.id }).catch(() => null); };
ACT['kw.cetak1'] = el => { const k = SJ.one(S.D.Kuitansi, 'ID', el.dataset.id); cetakHTML(SJ.render.kuitansi(SJ.parseJSON(k.Snapshot, {}), docOpts(false)), 'Kuitansi ' + k.Nomor); };
ACT['kw.cetakSemua'] = () => {
  const p = S.pg.kuitansi, kw = S.D.Kuitansi.filter(k => k.SPDID === p.spd && String(k.NIP) === String(p.nip) && k.Status !== 'Batal').sort((a, b) => (SJ.KOMPONEN[a.Komponen] || {}).urut - (SJ.KOMPONEN[b.Komponen] || {}).urut);
  if (!kw.length) return toast('Belum ada kuitansi terbit untuk pegawai ini.', 'warn');
  cetakHTML(kw.map(k => SJ.render.kuitansi(SJ.parseJSON(k.Snapshot, {}), docOpts(false))).join(''), 'Kuitansi ' + nmPeg(p.nip));
};
ACT['kw.pdf1'] = el => unduhPDF({ jenis: 'KUITANSI', id: el.dataset.id }, el);
ACT['kw.bundel'] = el => unduhPDF({ jenis: 'KUITANSI_BUNDEL', id: S.pg.kuitansi.spd, nip: S.pg.kuitansi.nip }, el);

// =====================================================================
// SPJ & VERIFIKASI — PRD 7.6 & 7.7
// =====================================================================
PAGES.spj = {
  render(el) {
    const p = S.pg.spj = S.pg.spj || { filt: isVR() ? 'Lengkap' : 'Semua', q: '', tab: 'data', manual: {} };
    let semua = S.D.SPD.filter(s => s.Status === 'Terbit' && inOPD(s)).map(s => ({ s: s, j: spjOf(s.ID) || { Status: 'Belum Diunggah' } }));
    const cnt = st => semua.filter(x => st === 'Semua' || x.j.Status === st).length;
    const q = (p.q || '').toLowerCase();
    let list = semua.filter(x => (p.filt === 'Semua' || x.j.Status === p.filt) && (!q || [x.s.Nomor, nmPeg(x.s.PelaksanaNIP), x.s.PelaksanaNIP, x.s.Maksud].join(' ').toLowerCase().indexOf(q) > -1))
      .sort((a, b) => { const o = { Lengkap: 0, Dikembalikan: 1, 'Belum Diunggah': 2, Diverifikasi: 3 }; return (o[a.j.Status] - o[b.j.Status]) || SJ.iso(b.s.TglBerangkat).localeCompare(SJ.iso(a.s.TglBerangkat)); });
    if (!p.id || !semua.some(x => x.s.ID === p.id)) p.id = (list[0] || semua[0] || { s: {} }).s.ID;
    const antre = semua.filter(x => x.j.Status === 'Lengkap');
    el.innerHTML = `<div class="ph"><div class="row gap12"><div class="logo-mark" style="width:40px;height:40px">${ic('verified_user')}</div><div><h1 style="margin:0">Verifikasi & Pengesahan SPJ</h1><p>Periksa kelengkapan bukti, nilai riil terhadap SBU, lalu sahkan untuk mengurangi pagu.</p></div></div>
      <div class="acts"><span class="tag">${ic('pending', 'sm')} Menunggu: ${antre.length} berkas</span><span class="tag gold">${ic('payments', 'sm')} Antrean ${rp(SJ.sum(antre, x => SJ.hitung.totalSPD(S.D, x.s.ID)))}</span><span class="tag pri">${ic('account_balance', 'sm')} TA ${S.tahun}</span></div></div>
      <div class="split s5-7"><div class="col gap12"><div class="card pad-s"><div class="row between mb8"><b>Daftar Pengajuan SPJ</b><span class="xs muted">${semua.length} SPD</span></div>
        <div class="inp-ic mb8">${ic('search')}<input class="inp" placeholder="Cari nomor SPD, NIP, atau nama…" value="${e(p.q || '')}" data-in="spj.q" aria-label="Cari SPJ"></div>
        <div class="pills">${['Semua', 'Belum Diunggah', 'Lengkap', 'Diverifikasi', 'Dikembalikan'].map(s => `<button class="${p.filt === s ? 'on' : ''}" data-act="spj.filt" data-v="${s}">${s} (${cnt(s)})</button>`).join('')}</div></div>
        <div class="col gap8" id="spj-list">${list.length ? list.map(x => this.kartu(x)).join('') : empty('task', 'Tidak ada SPJ pada filter ini.')}</div></div>
      <div class="col gap16" id="spj-detail"></div></div>`;
    this.detail();
  },
  kartu(x) {
    const s = x.s, j = x.j, tj = SJ.by(S.D.SPD_Tujuan, 'SPDID', s.ID)[0] || {}, on = S.pg.spj.id === s.ID;
    return `<button class="list-card ${on ? 'on' : ''}" data-act="spj.pilih" data-id="${s.ID}"><div class="row between gap8"><span class="mono xs b ${on ? 'pri-t' : 'muted'}">${e(s.Nomor)}</span>${pill(j.Status)}</div>
      <div class="row between gap8 mt8"><span class="row gap4 b small trunc">${ic('person', 'sm muted')}${e(nmPeg(s.PelaksanaNIP))}</span><span class="xs muted">${e(singkat(s.OPD))}</span></div>
      <div class="row gap4 small muted mt8 trunc">${ic('location_on', 'sm')}${e(tj.TempatTujuan || '')}${tj.KabKota ? ', ' + e(tj.KabKota) : ''}</div>
      ${j.Status === 'Dikembalikan' && j.Catatan ? `<div class="callout bad small mt8" style="padding:8px 10px">${ic('info', 'sm')}<div><b>Catatan:</b> ${e(j.Catatan)}</div></div>` : ''}
      <div class="row between mt8 small" style="padding:6px 8px;border-radius:8px;background:var(--surface-2)"><span class="row gap4 muted">${ic('calendar_month', 'sm')}${e(SJ.rentangTgl(s.TglBerangkat, s.TglKembali))}</span><b class="mono">${rp(j.Status === 'Diverifikasi' ? j.TotalDiakui : SJ.hitung.totalSPD(S.D, s.ID))}</b></div></button>`;
  },
  detail() {
    const p = S.pg.spj, box = $('#spj-detail'), spd = spdOf(p.id);
    if (!box) return;
    if (!spd) { box.innerHTML = `<div class="card pad">${empty('fact_check', 'Pilih SPJ di sebelah kiri.')}</div>`; return; }
    const D = S.D, j = spjOf(spd.ID) || { Status: 'Belum Diunggah' }, c = SJ.hitung.konteksSPD(D, spd), pl = peg(spd.PelaksanaNIP) || {};
    const manual = j.Status === 'Diverifikasi' ? SJ.parseJSON(j.Checklist, {}) : (p.manual[spd.ID] = p.manual[spd.ID] || {});
    const cl = SJ.checklistSPJ(D, spd, manual);
    const ver = (isVR() || isSA()) && j.Status === 'Lengkap', ajukan = (bisaTulis(spd.OPD) || isPL()) && ['Belum Diunggah', 'Dikembalikan'].indexOf(j.Status) > -1;
    const bisaBukti = (bisaTulis(spd.OPD) || isPL()) && ['Belum Diunggah', 'Dikembalikan'].indexOf(j.Status) > -1;
    const total = j.Status === 'Diverifikasi' ? SJ.num(j.TotalDiakui) : SJ.hitung.totalSPD(D, spd.ID);
    const sp = SJ.sisaPagu(D, spd.PaguID) || { pagu: 0, realisasi: 0, sisa: 0, persen: 0 };
    const sisaSesudah = j.Status === 'Diverifikasi' ? sp.sisa : sp.sisa - total, melebihi = j.Status !== 'Diverifikasi' && total > sp.sisa;
    // Riil vs SBU per komponen (agregat rombongan)
    const agg = {};
    SJ.by(D.Rincian_Biaya, 'SPDID', spd.ID).filter(r => !isPL() || String(r.NIP) === String(S.user.NIP)).forEach(r => {
      const k = r.Komponen + (r.Kategori === 'DIKLAT' && r.Komponen !== 'UANG_HARIAN_DIKLAT' ? ' D' : ''), a = agg[k] = agg[k] || { k: r.Komponen, lbl: (SJ.KOMPONEN[r.Komponen] || {}).label + (r.Kategori === 'DIKLAT' && r.Komponen !== 'UANG_HARIAN_DIKLAT' ? ' (Diklat)' : ''), riil: 0, dk: 0, n: 0, vol: 0, harga: SJ.num(r.Harga) };
      a.riil += r.NilaiRiil === '' || r.NilaiRiil === null ? SJ.num(r.Jumlah) : SJ.num(r.NilaiRiil); a.dk += SJ.num(r.NilaiDiakui); a.n++; a.vol += SJ.num(r.Volume);
    });
    const rows = Object.keys(agg).map(k => agg[k]).sort((a, b) => (SJ.KOMPONEN[a.k] || {}).urut - (SJ.KOMPONEN[b.k] || {}).urut);
    const bukti = SJ.by(D.SPJ_Bukti, 'SPDID', spd.ID);
    const pagu = SJ.one(D.Pagu, 'ID', spd.PaguID) || {};
    box.innerHTML = `<style>@media(max-width:1179px){#spj-detail[data-tab="data"] .t-dok{display:none}#spj-detail[data-tab="dok"] .t-data{display:none}}@media(min-width:1180px){.spj-tabs{display:none!important}}</style>
      <div class="card pad"><div class="row between wrap gap8"><div><div class="label">Pemeriksaan & verifikasi SPJ · <span class="pri-t">${e(SJ.JENIS_JALAN[spd.Jenis])} (${spd.Jenis})</span></div><h2 style="margin:4px 0 0;font-size:20px;letter-spacing:-.01em">SPD ${e(spd.Nomor)}</h2></div>
        <div class="row gap8 wrap">${pill(j.Status)}<button class="btn sec sm" data-act="spj.berkas">${ic('visibility', 'sm')} Pratinjau berkas</button><button class="btn sec sm" data-act="spj.lembar">${ic('print', 'sm')} Lembar verifikasi</button></div></div>
        <div class="kv c4 mt12"><div><div class="k">Pelaksana</div><div class="v">${e(nmPeg(spd.PelaksanaNIP))}</div><div class="xs mono muted">NIP ${e(SJ.fmtNip(spd.PelaksanaNIP))}</div></div><div><div class="k">Pangkat / golongan</div><div class="v small">${e(pl.Pangkat || pl.StatusPegawai || '-')} ${pl.Golongan ? '(' + e(pl.Golongan) + ')' : ''}</div><div class="xs muted trunc">${e(pl.Jabatan || '')}</div></div>
          <div><div class="k">Tujuan & durasi</div><div class="v small">${e(c.tujuan.map(t => t.KabKota || t.TempatTujuan).join(', '))}</div><div class="xs muted">${c.lama} hari (${e(SJ.rentangTgl(spd.TglBerangkat, spd.TglKembali))})</div></div><div><div class="k">Rombongan</div><div class="v small">${SJ.hitung.anggotaSPD(D, spd).length} orang</div><div class="xs muted">${e(spd.AlatAngkut)}</div></div></div>
        ${j.Status === 'Dikembalikan' ? `<div class="callout bad mt12 small">${ic('assignment_return', 'sm')}<div><b>Dikembalikan oleh ${e(j.Verifikator || 'verifikator')}:</b> ${e(j.Catatan)}</div></div>` : ''}
        ${j.Status === 'Diverifikasi' ? `<div class="callout ok mt12 small">${ic('verified', 'sm')}<div><b>Diverifikasi ${e(tgl(j.TanggalVerifikasi))} oleh ${e(j.Verifikator)}</b>${j.Catatan ? ' — ' + e(j.Catatan) : ''}</div></div>` : ''}
        <div class="seg mt12 spj-tabs"><button class="${p.tab === 'data' ? 'on' : ''}" data-act="spj.tab" data-v="data">Data Verifikasi</button><button class="${p.tab === 'dok' ? 'on' : ''}" data-act="spj.tab" data-v="dok">Dokumen Lampiran (${bukti.length})</button></div></div>
      <div class="card pad t-data"><div class="row between mb12"><div class="sec-title">${ic('checklist_rtl', 'pri-t')} 1. Daftar Kelengkapan Dokumen</div><span class="pill ${cl.lengkap ? 'ok' : cl.autoLengkap ? 'info' : 'warn'}">${cl.items.concat(cl.manual).filter(i => i.ok).length} / ${cl.items.length + cl.manual.length} terpenuhi</span></div>
        <div class="col gap8">${cl.items.map((it, i) => `<div class="check-i ${it.ok ? 'ok' : 'no'}"><div class="row gap12" style="min-width:0">${ic(it.ok ? 'check_circle' : 'radio_button_unchecked', 'fill ' + (it.ok ? 'okc' : 'noc'))}<div style="min-width:0"><div class="b small">${i + 1}. ${e(it.label)}</div><div class="xs muted">${e(it.info || '')}</div></div></div><span class="tag">Otomatis</span></div>`).join('')}
          ${cl.manual.map((it, i) => `<label class="check-i ${it.ok ? 'ok' : 'no'}" style="cursor:${ver ? 'pointer' : 'default'}"><div class="row gap12"><input type="checkbox" data-in="spj.man" data-k="${it.kode}" ${it.ok ? 'checked' : ''} ${ver ? '' : 'disabled'} style="width:18px;height:18px;accent-color:var(--primary-hover)"><div><div class="b small">${cl.items.length + i + 1}. ${e(it.label)}</div><div class="xs muted">Pemeriksaan fisik oleh verifikator</div></div></div><span class="tag gold">Manual</span></label>`).join('')}</div></div>
      <div class="card pad t-dok"><div class="row between mb12"><div class="sec-title">${ic('folder_open', 'pri-t')} Bukti Pengeluaran</div><span class="xs muted">Folder Drive otomatis per Surat Tugas</span></div>
        <div class="col gap8">${bukti.length ? bukti.map(b => `<div class="chip"><span class="kpi-ico ${/pdf/.test(b.MimeType) ? 'r' : 'b'}" style="width:34px;height:34px">${ic(/pdf/.test(b.MimeType) ? 'picture_as_pdf' : 'image', 'sm')}</span><div class="grow" style="min-width:0"><div class="b small trunc">${e(b.Jenis)} · ${e(b.NamaFile)}</div><div class="xs muted">${b.NIP ? e(nmPeg(b.NIP)) : 'Rombongan'} · ${b.Ukuran ? Math.max(1, Math.round(b.Ukuran / 1024)) + ' KB · ' : ''}${e(relWaktu(b.Tanggal))} oleh ${e(b.DiunggahOleh)}</div></div>
          <button class="btn ghost icon sm" data-act="spj.lihat" data-id="${b.ID}" aria-label="Lihat bukti">${ic('open_in_new', 'sm')}</button>${bisaBukti && (!isPL() || b.DiunggahOleh === S.user.Username) ? `<button class="btn ghost icon sm" data-act="spj.hapusBukti" data-id="${b.ID}" aria-label="Hapus bukti">${ic('delete', 'sm')}</button>` : ''}</div>`).join('') : '<div class="small muted">Belum ada bukti diunggah.</div>'}</div>
        ${bisaBukti ? `<div class="fgrid c3 mt12"><div class="field"><label>Jenis bukti</label><select class="sel" id="bk-jenis">${SJ.JENIS_BUKTI.map(x => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label>Milik</label><select class="sel" id="bk-nip">${isPL() ? `<option value="${S.user.NIP}">${e(S.user.Nama)}</option>` : `<option value="">Rombongan</option>${SJ.hitung.anggotaSPD(D, spd).map(a => `<option value="${a.NIP}">${e(nmPeg(a.NIP))}</option>`).join('')}`}</select></div>
          <div class="field"><label>&nbsp;</label><button class="btn pri" data-act="spj.unggah" data-busy="Mengunggah…">${ic('upload', 'sm')} Unggah bukti</button></div></div>
          <div class="dz mt8" data-act="spj.unggah">${ic('cloud_upload')}<div class="small">Klik untuk memilih foto/PDF (maks. 8 MB). Foto dikompres otomatis sebelum diunggah.</div></div>` : ''}</div>
      <div class="card pad t-data"><div class="row between wrap mb12"><div class="sec-title">${ic('balance', 'pri-t')} 2. Perbandingan Biaya Riil vs SBU</div><span class="xs muted">${e(pagu.KodeRekening || spd.KodeRekening)}</span></div>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Komponen</th><th class="r">Nilai riil bukti</th><th class="r">Diakui SBU</th><th class="r">Selisih</th><th>Keterangan</th></tr></thead><tbody>
        ${rows.map(r => { const sel = r.riil - r.dk; return `<tr class="${sel > 0 ? '' : ''}" style="${sel > 0 ? 'background:var(--warn-bg)' : ''}"><td><div class="b small">${e(r.lbl)}</div><span class="sub">${r.n} orang · ${r.vol} vol</span></td><td class="r mono ${sel > 0 ? 'muted' : ''}" style="${sel > 0 ? 'text-decoration:line-through' : ''}">${rp(r.riil)}</td><td class="r mono b pri-t">${rp(r.dk)}</td><td class="r mono ${sel > 0 ? 'warn-t b' : 'muted'}">${sel > 0 ? '+' + rp(sel) : rp(0)}</td>
          <td class="small">${sel > 0 ? `<span class="warn-t row gap4">${ic('warning', 'sm')} Melebihi plafon (dibayar batas SBU)</span>` : `<span class="ok-t row gap4">${ic('check', 'sm')} Sesuai SBU</span>`}</td></tr>`; }).join('') || `<tr><td colspan="5" class="muted small">Belum ada rincian.</td></tr>`}
        </tbody></table></div>
        <div class="row between wrap gap12 mt12" style="padding:14px;border-radius:12px;background:var(--surface-2)"><div><div class="label">Hasil rekonsiliasi</div><div class="small">${SJ.sum(rows, r => Math.max(0, r.riil - r.dk)) > 0 ? 'Kelebihan ' + rp(SJ.sum(rows, r => Math.max(0, r.riil - r.dk))) + ' ditolak otomatis sesuai batas SBU.' : 'Seluruh komponen sesuai SBU.'}</div></div><div class="right"><div class="xs muted">Total diakui untuk pembayaran</div><div class="bb mono pri-t" style="font-size:22px">${rp(total)}</div></div></div></div>
      ${isPL() ? '' : `<div class="card pad t-data"><div class="sec-title mb12">${ic('pie_chart', 'pri-t')} 3. Verifikasi & Dampak Pagu</div>
        <div class="callout green"><span class="ms" style="color:var(--gold)">info</span><div class="grow"><div class="xs b" style="letter-spacing:.04em;text-transform:uppercase;opacity:.85">${e(pagu.SubKegiatan || spd.SubKegiatan)} · ${e(pagu.KodeRekening || '')}</div>
          <div class="small mt8" style="line-height:1.6">${j.Status === 'Diverifikasi' ? `SPJ ini telah memotong pagu sebesar <b class="mono" style="color:var(--gold)">${rp(total)}</b>. Sisa pagu kini <b class="mono" style="color:var(--gold)">${rp(sp.sisa)}</b>.` : `Sisa pagu saat ini <b class="mono" style="color:var(--gold)">${rp(sp.sisa)}</b>. Pengesahan SPJ ini akan memotong <b class="mono" style="color:var(--gold)">${rp(total)}</b> menjadi <b class="mono" style="color:var(--gold)">${rp(sisaSesudah)}</b>.`}</div>
          <div class="row between xs mt8" style="opacity:.85"><span>Realisasi${j.Status === 'Diverifikasi' ? '' : ' (termasuk pengajuan ini)'}</span><span class="mono">${rp(sp.realisasi + (j.Status === 'Diverifikasi' ? 0 : total))} / ${rp(sp.pagu)} (${((sp.realisasi + (j.Status === 'Diverifikasi' ? 0 : total)) / Math.max(1, sp.pagu) * 100).toFixed(1)}%)</span></div>
          <div class="bar thick mt8" style="background:rgba(0,0,0,.3)"><i style="width:${Math.min(100, sp.persen)}%;background:#A5D0B9"></i>${j.Status !== 'Diverifikasi' ? `<i class="g" style="width:${Math.min(100 - Math.min(100, sp.persen), total / Math.max(1, sp.pagu) * 100)}%"></i>` : ''}</div>
          <div class="xs mt8" style="text-align:right;opacity:.85">${melebihi ? '⛔ Melebihi sisa pagu — verifikasi akan ditolak' : (sp.realisasi + total) / Math.max(1, sp.pagu) >= 0.9 ? '⚠ Serapan ≥ 90% (waspada)' : 'Pagu aman'}</div></div></div>
        ${ver ? `<div class="field mt12"><label>${ic('edit_note', 'sm')} Catatan verifikator (opsional; wajib bila dikembalikan)</label><input class="inp" id="spj-cat" placeholder="Contoh: Kuitansi hotel dipotong sesuai plafon SBU."></div>` : ''}</div>`}
      <div class="card pad-s" style="position:sticky;bottom:${window.innerWidth < 768 ? 76 : 12}px;z-index:20;box-shadow:var(--sh3)"><div class="row between wrap gap8"><span class="xs muted row gap4">${ic('lock_clock', 'sm')} ${j.Status === 'Diverifikasi' ? 'Data SPJ terkunci' : 'Verifikasi final mengunci data SPJ'}</span>
        <div class="row wrap gap8">${ajukan ? `<button class="btn pri" data-act="spj.ajukan" data-busy="Mengajukan…" ${cl.autoLengkap ? '' : 'aria-disabled="true"'}>${ic('send', 'sm')} Ajukan SPJ (Lengkap)</button>` : ''}
          ${ver ? `<button class="btn dang" data-act="spj.kembali" data-busy="Mengembalikan…">${ic('replay', 'sm')} Kembalikan dengan Catatan</button><button class="btn pri" data-act="spj.setujui" data-busy="Memverifikasi…" ${cl.lengkap && !melebihi ? '' : 'aria-disabled="true"'}>${ic('verified', 'sm')} Setujui & Kurangi Pagu</button>` : ''}
          ${isSA() && j.Status === 'Diverifikasi' ? `<button class="btn dang" data-act="spj.batalVer">${ic('undo', 'sm')} Batalkan verifikasi</button>` : ''}
          ${!ajukan && !ver && j.Status !== 'Diverifikasi' ? `<span class="small muted">${j.Status === 'Lengkap' ? 'Menunggu verifikator' : '—'}</span>` : ''}</div></div></div>`;
    box.dataset.tab = p.tab || 'data';
  }
};
ACT['spj.filt'] = el => { S.pg.spj.filt = el.dataset.v; refresh(); };
INP['spj.q'] = debounce(el => { S.pg.spj.q = el.value; refresh(); const i = $('[data-in="spj.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
ACT['spj.pilih'] = el => { S.pg.spj.id = el.dataset.id; $$('#spj-list .list-card').forEach(c => c.classList.toggle('on', c.dataset.id === el.dataset.id)); PAGES.spj.detail(); if (window.innerWidth < 1180) $('#spj-detail').scrollIntoView({ behavior: 'smooth' }); };
ACT['spj.tab'] = el => { S.pg.spj.tab = el.dataset.v; const b = $('#spj-detail'); b.dataset.tab = el.dataset.v; $$('.spj-tabs button').forEach(x => x.classList.toggle('on', x.dataset.v === el.dataset.v)); };
INP['spj.man'] = el => { const m = S.pg.spj.manual[S.pg.spj.id] = S.pg.spj.manual[S.pg.spj.id] || {}; m[el.dataset.k] = el.checked; PAGES.spj.detail(); };
ACT['spj.ajukan'] = async btn => {
  if (btn.getAttribute('aria-disabled') === 'true') return toast('Lengkapi daftar kelengkapan otomatis terlebih dahulu (kuitansi & bukti).', 'warn', 6000);
  await mutasi('spj.ajukan', { SPDID: S.pg.spj.id }, { btn: btn }).catch(() => null);
};
ACT['spj.setujui'] = async btn => {
  if (btn.getAttribute('aria-disabled') === 'true') return toast('Centang seluruh pemeriksaan manual dan pastikan sisa pagu mencukupi.', 'warn', 6000);
  const spd = spdOf(S.pg.spj.id), tot = SJ.hitung.totalSPD(S.D, spd.ID);
  if (!(await konfirmasi(`Setujui SPJ ${e(spd.Nomor)} dan kurangi pagu sebesar <b>${rp(tot)}</b>? Data SPJ akan dikunci.`, { ok: 'Setujui & kurangi pagu' }))) return;
  const cat = ($('#spj-cat') || {}).value || '';
  await mutasi('spj.verifikasi', { SPDID: spd.ID, manual: S.pg.spj.manual[spd.ID] || {}, catatan: cat }, { btn: btn }).catch(() => null);
};
ACT['spj.kembali'] = async btn => {
  let cat = ($('#spj-cat') || {}).value || '';
  if (!cat.trim()) cat = await tanya('Kembalikan SPJ', 'Catatan untuk operator/pelaksana', { multi: true, wajib: true, ok: 'Kembalikan', bahaya: true });
  if (!cat) return;
  await mutasi('spj.kembalikan', { SPDID: S.pg.spj.id, catatan: cat }, { btn: btn }).catch(() => null);
};
ACT['spj.batalVer'] = async () => { const a = await tanya('Batalkan verifikasi', 'Alasan pembatalan (tercatat di log audit)', { multi: true, wajib: true, ok: 'Batalkan verifikasi', bahaya: true }); if (!a) return; await mutasi('spj.batalVerifikasi', { SPDID: S.pg.spj.id, alasan: a }).catch(() => null); };
ACT['spj.unggah'] = async btn => {
  const file = await pilihBerkas('image/*,application/pdf'); if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('Ukuran berkas maksimal 8 MB.', 'bad');
  if (!/^image\/|application\/pdf/.test(file.type)) return toast('Hanya gambar atau PDF.', 'bad');
  const jenis = $('#bk-jenis').value, nip = $('#bk-nip').value, b = btn.tagName === 'BUTTON' ? btn : $('[data-act="spj.unggah"].btn');
  sibuk(b, true);
  try {
    const k = await kompresGambar(file);
    await mutasi('bukti.unggah', { SPDID: S.pg.spj.id, NIP: nip, Jenis: jenis, NamaFile: file.name, MimeType: k.type, data: k.data });
  } catch (err) { /* toast sudah tampil */ } finally { sibuk(b, false); }
};
ACT['spj.hapusBukti'] = async el => { if (!(await konfirmasi('Hapus bukti ini? Berkas dipindahkan ke sampah Drive.', { bahaya: true, ok: 'Hapus' }))) return; await mutasi('bukti.hapus', { ID: el.dataset.id }).catch(() => null); };
ACT['spj.lihat'] = async el => {
  const m = modal({ title: 'Bukti pengeluaran', size: 'wide', body: '<div class="skel" style="height:320px"></div>', foot: '<button class="btn sec" data-x>Tutup</button>' });
  try {
    const r = (await api('bukti.ambil', { ID: el.dataset.id })).data;
    const src = 'data:' + r.mime + ';base64,' + r.data;
    $('.modal-b', m.el).innerHTML = /^image\//.test(r.mime) ? `<img src="${src}" alt="${e(r.nama)}" style="max-width:100%;display:block;margin:auto;border-radius:8px">` : `<embed src="${src}" type="${e(r.mime)}" style="width:100%;height:70vh;border-radius:8px"><p class="small muted">Jika pratinjau tidak tampil, gunakan tombol Unduh.</p>`;
    $('.modal-f', m.el).insertAdjacentHTML('beforeend', `<button class="btn pri" id="bk-dl">${ic('download', 'sm')} Unduh</button>`);
    $('#bk-dl', m.el).onclick = () => unduhB64(r.data, r.nama, r.mime);
  } catch (err) { $('.modal-b', m.el).innerHTML = `<div class="callout bad">${ic('error')}<div>${e(err.message)}</div></div>`; }
};
ACT['spj.berkas'] = () => {
  const spd = spdOf(S.pg.spj.id), st = stOf(spd.STID);
  const stDoc = st && st.Snapshot ? SJ.parseJSON(st.Snapshot, {}) : null, spdDoc = spd.Snapshot ? SJ.parseJSON(spd.Snapshot, {}) : SJ.doc.spd(S.D, spd);
  const orang = isPL() ? [S.user.NIP] : SJ.hitung.anggotaSPD(S.D, spd).map(a => a.NIP);
  const html = (stDoc ? SJ.render.st(stDoc, docOpts(false)) : '') + SJ.render.spd(spdDoc, docOpts(false)) + orang.map(n => SJ.render.rincian(SJ.doc.rincian(S.D, spd, n), docOpts(false))).join('') +
    S.D.Kuitansi.filter(k => k.SPDID === spd.ID && k.Status !== 'Batal' && orang.indexOf(String(k.NIP)) > -1).map(k => SJ.render.kuitansi(SJ.parseJSON(k.Snapshot, {}), docOpts(false))).join('');
  modal({ title: 'Berkas SPJ — ' + e(spd.Nomor), size: 'xl', body: kertas('berkas', html, { judul: 'ST · SPD · Rincian · Kuitansi' }), foot: '<button class="btn sec" data-x>Tutup</button>' });
  setTimeout(pasKertas, 30);
};
ACT['spj.lembar'] = () => {
  const spd = spdOf(S.pg.spj.id), j = spjOf(spd.ID) || {}, cl = SJ.checklistSPJ(S.D, spd, j.Status === 'Diverifikasi' ? SJ.parseJSON(j.Checklist, {}) : (S.pg.spj.manual[spd.ID] || {}));
  const rows = cl.items.concat(cl.manual).map((x, i) => ({ no: i + 1, item: x.label, hasil: x.ok ? 'Sesuai' : 'Belum', ket: x.info || (x.manual ? 'Pemeriksaan manual' : '') }));
  cetakHTML(SJ.render.tabel('LEMBAR VERIFIKASI SPJ', 'SPD ' + spd.Nomor + ' · ' + nmPeg(spd.PelaksanaNIP) + ' · Total ' + rp(SJ.hitung.totalSPD(S.D, spd.ID)) + ' · Status ' + (j.Status || '-'), [['no', 'No'], ['item', 'Item Pemeriksaan'], ['hasil', 'Hasil'], ['ket', 'Keterangan']], rows, docOpts(false), []), 'Lembar Verifikasi');
};

// =====================================================================
// LAPORAN SISA ANGGARAN — PRD 7.10
// =====================================================================
const LAP_KOLOM = [['subKegiatan', 'Subkegiatan'], ['kodeRek', 'Kode Rekening'], ['jenis', 'Jenis'], ['opd', 'OPD'], ['pagu', 'Pagu'], ['lalu', 'Realisasi s.d. Periode Lalu'], ['ini', 'Realisasi Periode Ini'], ['total', 'Total Realisasi'], ['sisa', 'Sisa'], ['persen', 'Serapan (%)'], ['status', 'Status'], ['pending', 'Menunggu Verifikasi']];
PAGES.anggaran = {
  render(el) {
    const now = new Date(), p = S.pg.anggaran = S.pg.anggaran || { jenis: 'Semua', kodeRek: '', b1: 1, b2: S.tahun === now.getFullYear() ? now.getMonth() + 1 : 12 };
    const rows = this.data(), sum = k => SJ.sum(rows, r => r[k]);
    const rek = Array.from(new Set(S.D.Pagu.map(x => x.KodeRekening))).sort();
    const pct = sum('pagu') ? sum('total') / sum('pagu') * 100 : 0;
    el.innerHTML = `<div class="ph"><div><h1>Laporan Sisa Anggaran</h1><p>Pagu, realisasi, sisa, dan serapan per subkegiatan & kode rekening. Hanya SPJ terverifikasi yang dihitung; SPJ menunggu verifikasi ditampilkan terpisah.</p></div>
      <div class="acts"><button class="btn sec" data-act="lap.xlsx">${ic('table_view', 'sm')} Excel</button><button class="btn sec" data-act="lap.cetak">${ic('print', 'sm')} Cetak</button><button class="btn pri" data-act="lap.pdf" data-busy="Menyusun PDF…">${ic('picture_as_pdf', 'sm')} PDF</button></div></div>
      <div class="card pad-s mb16"><div class="fgrid c4" style="align-items:end"><div class="field"><label>Jenis perjalanan</label><div class="seg">${['Semua', 'DK', 'DB'].map(j => `<button class="${p.jenis === j ? 'on' : ''}" data-act="lap.set" data-k="jenis" data-v="${j}">${j}</button>`).join('')}</div></div>
        <div class="field"><label>Kode rekening</label><select class="sel" data-in="lap.f" data-k="kodeRek"><option value="">Semua</option>${rek.map(r => `<option ${r === p.kodeRek ? 'selected' : ''}>${e(r)}</option>`).join('')}</select></div>
        <div class="field"><label>Periode mulai</label><select class="sel" data-in="lap.f" data-k="b1">${SJ.BULAN.map((b, i) => `<option value="${i + 1}" ${i + 1 == p.b1 ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
        <div class="field"><label>Periode selesai</label><select class="sel" data-in="lap.f" data-k="b2">${SJ.BULAN.map((b, i) => `<option value="${i + 1}" ${i + 1 == p.b2 ? 'selected' : ''}>${b}</option>`).join('')}</select></div></div></div>
      <div class="grid g4 mb16">
        <div class="card kpi"><div class="label">Total pagu</div><div class="kpi-val mono">${rp(sum('pagu'))}</div><div class="xs muted">${rows.length} subkegiatan · ${S.opd === 'Semua' ? 'semua OPD' : singkat(S.opd)}</div></div>
        <div class="card kpi"><div class="label">Realisasi ${SJ.BULAN[p.b1 - 1]}–${SJ.BULAN[p.b2 - 1]}</div><div class="kpi-val mono pri-t">${rp(sum('ini'))}</div><div class="xs muted">s.d. periode lalu ${rp(sum('lalu'))}</div></div>
        <div class="card kpi"><div class="label">Sisa pagu</div><div class="kpi-val mono">${rp(sum('sisa'))}</div><div class="bar"><i class="${pct >= 90 ? 'w' : ''}" style="width:${Math.min(100, pct)}%"></i></div><div class="xs muted">${pct.toFixed(1)}% terserap</div></div>
        <div class="card kpi"><div class="label">Menunggu verifikasi</div><div class="kpi-val mono warn-t">${rp(sum('pending'))}</div><div class="xs muted">Belum mengurangi pagu</div></div></div>
      <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Subkegiatan & rekening</th><th class="r">Pagu</th><th class="r">s.d. lalu</th><th class="r">Periode ini</th><th class="r">Total</th><th class="r">Sisa</th><th style="min-width:110px">Serapan</th><th>Status</th><th class="r">Menunggu</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr><td><div class="b small">${e(r.subKegiatan)}</div><span class="sub mono">${e(r.kodeRek)} · ${e(r.jenis)} · ${e(singkat(r.opd))}</span></td><td class="r mono">${rp(r.pagu)}</td><td class="r mono muted">${rp(r.lalu)}</td><td class="r mono">${rp(r.ini)}</td><td class="r mono b">${rp(r.total)}</td><td class="r mono ${r.sisa <= 0 ? 'bad-t b' : ''}">${rp(r.sisa)}</td>
        <td><div class="small mono b">${r.persen.toFixed(1)}%</div><div class="bar" style="margin-top:4px"><i class="${r.status === 'Habis' ? 'x' : r.status === 'Waspada' ? 'w' : ''}" style="width:${Math.min(100, r.persen)}%"></i></div></td><td>${pill(r.status)}</td><td class="r mono warn-t">${r.pending ? rp(r.pending) : '—'}</td></tr>`).join('') : `<tr><td colspan="9">${empty('savings', 'Tidak ada pagu untuk filter ini.')}</td></tr>`}
      </tbody>${rows.length ? `<tfoot><tr><td>JUMLAH</td><td class="r mono">${rp(sum('pagu'))}</td><td class="r mono">${rp(sum('lalu'))}</td><td class="r mono">${rp(sum('ini'))}</td><td class="r mono">${rp(sum('total'))}</td><td class="r mono">${rp(sum('sisa'))}</td><td class="mono">${pct.toFixed(1)}%</td><td></td><td class="r mono">${rp(sum('pending'))}</td></tr></tfoot>` : ''}</table></div>
      <div class="tbl-foot"><span>Status: Aman &lt; 90% · Waspada ≥ 90% · Habis = sisa ≤ 0</span><span>Format final menyesuaikan contoh instansi</span></div></div>`;
  },
  data() { const p = S.pg.anggaran; return SJ.laporan(S.D, { tahun: S.tahun, bulanMulai: Math.min(p.b1, p.b2), bulanSelesai: Math.max(p.b1, p.b2), opd: S.opd, kodeRek: p.kodeRek, jenis: p.jenis }); },
  judul() { const p = S.pg.anggaran; return 'Laporan Sisa Anggaran Perjalanan Dinas ' + (S.opd === 'Semua' ? '' : singkat(S.opd) + ' ') + 'TA ' + S.tahun + ' (' + SJ.BULAN[p.b1 - 1] + '–' + SJ.BULAN[p.b2 - 1] + ')'; }
};
ACT['lap.set'] = el => { S.pg.anggaran[el.dataset.k] = el.dataset.v; refresh(); };
INP['lap.f'] = el => { S.pg.anggaran[el.dataset.k] = /^b\d$/.test(el.dataset.k) ? Number(el.value) : el.value; refresh(); };
ACT['lap.xlsx'] = () => { const rows = PAGES.anggaran.data().map(r => Object.assign({}, r, { opd: singkat(r.opd), persen: Math.round(r.persen * 10) / 10 })); eksporXLSX('Laporan_Sisa_Anggaran_' + S.tahun, 'Sisa Anggaran', LAP_KOLOM, rows, PAGES.anggaran.judul().toUpperCase()); };
const lapHTML = () => SJ.render.tabel(PAGES.anggaran.judul().toUpperCase(), (S.cfg.NAMA_PEMDA || '') + ' · dicetak oleh ' + S.user.Nama, LAP_KOLOM, PAGES.anggaran.data().map(r => Object.assign({}, r, { opd: singkat(r.opd) })), docOpts(false), ['pagu', 'lalu', 'ini', 'total', 'sisa', 'pending', 'persen']);
ACT['lap.cetak'] = () => cetakHTML(lapHTML(), 'Laporan Sisa Anggaran');
ACT['lap.pdf'] = el => pdfDariHTML(lapHTML(), 'Laporan Sisa Anggaran TA ' + S.tahun, el);

// =====================================================================
// REKAPITULASI PERJALANAN DINAS & SPJ — PRD 7.8
// =====================================================================
PAGES.rekap = {
  render(el) {
    const p = S.pg.rekap = S.pg.rekap || { b1: 1, b2: 12, jenis: 'Semua', diklat: 'Semua', status: 'Semua', nip: '', paguId: '', q: '', hal: 1 };
    const rows = this.data(), all = SJ.rekap(S.D).filter(r => r.tahun === S.tahun && inOPD(r));
    const tot = SJ.sum(rows, r => r.total), spdU = new Set(rows.map(r => r.spdId)).size, tunda = new Set(rows.filter(r => r.statusSPJ !== 'Diverifikasi').map(r => r.spdId)).size;
    const per = (k, lab) => { const m = {}; rows.forEach(r => { const key = lab(r); m[key] = (m[key] || 0) + r.total; }); return Object.keys(m).map(x => [x, m[x]]).sort((a, b) => b[1] - a[1]); };
    const perOPD = per('opd', r => singkat(r.opd)), perSub = per('sub', r => r.subKegiatan || '-'), perBln = per('bln', r => SJ.pad(r.bulanNum) + ' ' + r.bulan).sort();
    const nips = Array.from(new Set(all.map(r => r.nipRaw))).sort((a, b) => nmPeg(a).localeCompare(nmPeg(b)));
    const PER = 50, hal = Math.min(p.hal, Math.max(1, Math.ceil(rows.length / PER)));
    const kol = SJ.REKAP_KOLOM, uang = SJ.REKAP_UANG;
    el.innerHTML = `<div class="ph"><div><h1>Rekapitulasi Perjalanan Dinas</h1><p>Satu baris per pegawai per perjalanan. Kolom & urutan sesuai format rekapitulasi baku; judul dan SKPD dari konfigurasi OPD.</p></div>
      <div class="acts"><button class="btn sec" data-act="rek.pdf" data-busy="Menyusun PDF…">${ic('picture_as_pdf', 'sm')} PDF</button><button class="btn pri" data-act="rek.xlsx">${ic('table_view', 'sm')} Ekspor Excel</button></div></div>
      <div class="card pad-s mb16"><div class="fgrid c4" style="align-items:end">
        <div class="field"><label>Bulan</label><div class="row gap4"><select class="sel" data-in="rek.f" data-k="b1">${SJ.BULAN.map((b, i) => `<option value="${i + 1}" ${i + 1 == p.b1 ? 'selected' : ''}>${SJ.BULAN_PENDEK[i]}</option>`).join('')}</select><span class="muted">–</span><select class="sel" data-in="rek.f" data-k="b2">${SJ.BULAN.map((b, i) => `<option value="${i + 1}" ${i + 1 == p.b2 ? 'selected' : ''}>${SJ.BULAN_PENDEK[i]}</option>`).join('')}</select></div></div>
        <div class="field"><label>Pegawai</label><select class="sel" data-in="rek.f" data-k="nip"><option value="">Semua pegawai</option>${nips.map(n => `<option value="${n}" ${n === p.nip ? 'selected' : ''}>${e(nmPeg(n))}</option>`).join('')}</select></div>
        <div class="field"><label>Kode rekening / subkegiatan</label><select class="sel" data-in="rek.f" data-k="paguId"><option value="">Semua</option>${S.D.Pagu.filter(inOPD).map(x => `<option value="${x.ID}" ${x.ID === p.paguId ? 'selected' : ''}>${e(x.KodeRekening)} · ${e(x.SubKegiatan)}</option>`).join('')}</select></div>
        <div class="field"><label>Cari</label><div class="inp-ic">${ic('search')}<input class="inp" data-in="rek.q" value="${e(p.q)}" placeholder="Nama, nomor SPPD, tujuan…"></div></div>
        <div class="field"><label>Jenis</label><div class="seg">${['Semua', 'DK', 'DB'].map(j => `<button class="${p.jenis === j ? 'on' : ''}" data-act="rek.set" data-k="jenis" data-v="${j}">${j}</button>`).join('')}</div></div>
        <div class="field"><label>Diklat</label><div class="seg">${[['Semua', 'Semua'], ['YA', 'Dengan diklat'], ['TIDAK', 'Tanpa']].map(j => `<button class="${p.diklat === j[0] ? 'on' : ''}" data-act="rek.set" data-k="diklat" data-v="${j[0]}">${j[1]}</button>`).join('')}</div></div>
        <div class="field span2"><label>Status SPJ</label><div class="pills">${['Semua', 'Belum Diunggah', 'Lengkap', 'Diverifikasi', 'Dikembalikan'].map(s => `<button class="${p.status === s ? 'on' : ''}" data-act="rek.set" data-k="status" data-v="${s}">${s}</button>`).join('')}</div></div></div></div>
      <div class="grid g4 mb16">
        <div class="card kpi"><div class="label">Jumlah total biaya</div><div class="kpi-val mono pri-t">${rp(tot)}</div><div class="xs muted">${rows.length} baris pegawai-perjalanan</div></div>
        <div class="card kpi"><div class="label">Jumlah perjalanan</div><div class="kpi-val mono">${spdU}</div><div class="xs muted">${rows.filter(r => r.jenis === 'DB').length} DB · ${rows.filter(r => r.jenis === 'DK').length} DK (orang)</div></div>
        <div class="card kpi"><div class="label">SPJ tertunda</div><div class="kpi-val mono ${tunda ? 'warn-t' : ''}">${tunda}</div><div class="xs muted">Belum diverifikasi</div></div>
        <div class="card kpi"><div class="label">Rata-rata per orang</div><div class="kpi-val mono">${rp(rows.length ? tot / rows.length : 0)}</div><div class="xs muted">per perjalanan</div></div></div>
      <div class="grid g3 mb16">${[['Per OPD', perOPD], ['Per subkegiatan', perSub], ['Per bulan', perBln]].map(x => `<div class="card pad-s"><div class="label mb8">${x[0]}</div><div style="max-height:172px;overflow:auto">${x[1].length ? x[1].map(y => `<div class="row between small" style="padding:5px 0;border-bottom:1px solid var(--row)"><span class="trunc">${e(y[0])}</span><b class="mono">${rp(y[1])}</b></div>`).join('') : '<div class="small muted">—</div>'}</div></div>`).join('')}</div>
      <div class="card"><div class="tbl-wrap" style="max-height:70vh"><table class="tbl compact sticky-c1 nowrap"><thead><tr>${kol.map(k => `<th class="${uang.indexOf(k[0]) > -1 || k[0] === 'lama' ? 'r' : ''}">${e(k[1])}</th>`).join('')}</tr></thead><tbody>
        ${rows.length ? rows.slice((hal - 1) * PER, hal * PER).map(r => `<tr>${kol.map(k => { let v = r[k[0]]; if (uang.indexOf(k[0]) > -1) return `<td class="r mono ${k[0] === 'total' ? 'b' : ''}">${v ? ang(v) : '—'}</td>`; if (/^tgl/.test(k[0])) v = tglp(v); return `<td class="${k[0] === 'lama' ? 'r mono' : ''} ${k[0] === 'nama' ? 'b' : ''} ${k[0] === 'nip' ? 'mono' : ''}" ${['keterangan', 'tiketBerangkat', 'tiketKembali', 'tempatTujuan', 'jabatan', 'uraian', 'maksud', 'subKegiatan'].indexOf(k[0]) > -1 ? 'style="white-space:normal;min-width:220px;max-width:320px"' : ''}>${e(v)}</td>`; }).join('')}</tr>`).join('') : `<tr><td colspan="${kol.length}">${empty('summarize', 'Tidak ada data untuk filter ini.')}</td></tr>`}
      </tbody>${rows.length ? `<tfoot><tr>${kol.map((k, i) => `<td class="${uang.indexOf(k[0]) > -1 ? 'r mono' : ''}">${i === 0 ? 'JUMLAH' : uang.indexOf(k[0]) > -1 ? ang(SJ.sum(rows, r => r[k[0]])) : ''}</td>`).join('')}</tr></tfoot>` : ''}</table></div>
      <div class="tbl-foot"><span>Baris ${rows.length ? (hal - 1) * PER + 1 : 0}–${Math.min(rows.length, hal * PER)} dari ${rows.length}</span><div class="row gap4"><button class="btn sec sm" data-act="rek.hal" data-v="${hal - 1}" ${hal <= 1 ? 'disabled' : ''}>Sebelumnya</button><span class="tag">${hal} / ${Math.max(1, Math.ceil(rows.length / PER))}</span><button class="btn sec sm" data-act="rek.hal" data-v="${hal + 1}" ${hal * PER >= rows.length ? 'disabled' : ''}>Selanjutnya</button></div></div></div>`;
  },
  data() {
    const p = S.pg.rekap, q = (p.q || '').toLowerCase(), b1 = Math.min(p.b1, p.b2), b2 = Math.max(p.b1, p.b2);
    const rows = SJ.rekap(S.D).filter(r => r.tahun === S.tahun && inOPD(r) && r.bulanNum >= b1 && r.bulanNum <= b2 && (p.jenis === 'Semua' || r.jenis === p.jenis) && (p.diklat === 'Semua' || r.diklat === p.diklat)
      && (p.status === 'Semua' || r.statusSPJ === p.status) && (!p.nip || r.nipRaw === p.nip) && (!p.paguId || r.paguId === p.paguId) && (!isPL() || r.nipRaw === String(S.user.NIP))
      && (!q || [r.nama, r.nomorSPD, r.tempatTujuan, r.kotaTujuan, r.nip].join(' ').toLowerCase().indexOf(q) > -1));
    rows.forEach((r, i) => { r.no = i + 1; });
    return rows;
  },
  judul() { const p = S.pg.rekap, o = S.opd === 'Semua' ? null : SJ.one(S.D.Instansi, 'Kode', S.opd); return 'REKAPITULASI PERJALANAN DINAS ' + (o ? o.Nama.toUpperCase() + ' ' : '') + 'TAHUN ANGGARAN ' + S.tahun + (p.b1 !== 1 || p.b2 !== 12 ? ' (' + SJ.BULAN[Math.min(p.b1, p.b2) - 1].toUpperCase() + '–' + SJ.BULAN[Math.max(p.b1, p.b2) - 1].toUpperCase() + ')' : ''); }
};
ACT['rek.set'] = el => { S.pg.rekap[el.dataset.k] = el.dataset.v; S.pg.rekap.hal = 1; refresh(); };
INP['rek.f'] = el => { S.pg.rekap[el.dataset.k] = /^b\d$/.test(el.dataset.k) ? Number(el.value) : el.value; S.pg.rekap.hal = 1; refresh(); };
INP['rek.q'] = debounce(el => { S.pg.rekap.q = el.value; S.pg.rekap.hal = 1; refresh(); const i = $('[data-in="rek.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
ACT['rek.hal'] = el => { S.pg.rekap.hal = Number(el.dataset.v); refresh(); };
ACT['rek.xlsx'] = () => { const rows = PAGES.rekap.data().map(r => Object.assign({}, r, { tglBerangkat: SJ.fmtTgl(r.tglBerangkat), tglKembali: SJ.fmtTgl(r.tglKembali) })); eksporXLSX('Rekapitulasi_Perjalanan_Dinas_' + S.tahun, 'Rekapitulasi', SJ.REKAP_KOLOM, rows, PAGES.rekap.judul()); };
ACT['rek.pdf'] = el => {
  const kol = [['no', 'No'], ['bulan', 'Bulan'], ['nama', 'Nama Pelaksana'], ['nomorSPD', 'Nomor SPPD'], ['tempatTujuan', 'Tujuan'], ['tglBerangkat', 'Berangkat'], ['lama', 'Lama'], ['uangHarian', 'Uang Harian'], ['representasi', 'Repres.'], ['penginapan', 'Penginapan'], ['tiket', 'Tiket/e-Tol'], ['taksi', 'Taksi'], ['total', 'Jumlah']];
  pdfDariHTML(SJ.render.tabel(PAGES.rekap.judul(), (S.cfg.NAMA_PEMDA || '') + ' · Ringkasan kolom utama (lengkap di Excel)', kol, PAGES.rekap.data(), docOpts(false), ['uangHarian', 'representasi', 'penginapan', 'tiket', 'taksi', 'total']), 'Rekapitulasi TA ' + S.tahun, el);
};

// =====================================================================
// CRM & NOTIFIKASI (WA Fonnte / Email) — Superadmin
// =====================================================================
PAGES.crm = {
  render(el) {
    const p = S.pg.crm = S.pg.crm || { tab: 'kontak', q: '', seg: 'Semua' };
    el.innerHTML = `<div class="ph"><div><h1>CRM & Notifikasi</h1><p>Kontak pegawai & pengguna, notifikasi otomatis (WhatsApp Fonnte & email), dan pesan siaran ber-batch. Antrean diproses trigger tiap menit sehingga transaksi tidak pernah tertahan.</p></div>
      <div class="acts"><div class="seg">${[['kontak', 'contacts', 'Kontak'], ['blast', 'campaign', 'Blast WA'], ['antrian', 'queue', 'Antrean'], ['atur', 'tune', 'Pengaturan']].map(t => `<button class="${p.tab === t[0] ? 'on' : ''}" data-act="crm.tab" data-v="${t[0]}">${ic(t[1], 'sm')} ${t[2]}</button>`).join('')}</div></div></div><div id="crm-body"></div>`;
    if (!p.data) { $('#crm-body').innerHTML = '<div class="card pad"><div class="skel" style="height:220px"></div></div>'; api('crm.daftar', {}).then(r => { p.data = r.data; if (S.route === 'crm') this.isi(); }).catch(err => { $('#crm-body').innerHTML = `<div class="callout bad">${ic('error')}<div>${e(err.message)}</div></div>`; }); return; }
    this.isi();
  },
  isi() {
    const p = S.pg.crm, d = p.data, rg = d.ringkas || {}, box = $('#crm-body');
    const status = `<div class="grid g4 mb16"><div class="card kpi"><div class="label">WhatsApp (Fonnte)</div><div class="b ${rg.waAktif && rg.adaToken ? 'ok-t' : 'muted'}">${rg.waAktif && rg.adaToken ? 'Aktif' : 'Nonaktif'}</div><div class="xs muted">Token: ${e(rg.token || 'belum diatur')}</div></div>
      <div class="card kpi"><div class="label">Email (MailApp)</div><div class="b ${rg.emailAktif ? 'ok-t' : 'muted'}">${rg.emailAktif ? 'Aktif' : 'Nonaktif'}</div><div class="xs muted">Sisa kuota harian: ${rg.kuotaEmail === null || rg.kuotaEmail === undefined ? '-' : rg.kuotaEmail}</div></div>
      <div class="card kpi"><div class="label">Antrean</div><div class="kpi-val mono">${rg.antri || 0}</div><div class="xs muted">${rg.terkirim || 0} terkirim · ${rg.gagal || 0} gagal</div></div>
      <div class="card kpi"><div class="label">Kontak CRM</div><div class="kpi-val mono">${d.kontak.length}</div><div class="xs muted">${d.kontak.filter(k => k.OptOut === 'YA').length} opt-out · ${d.kontak.filter(k => k.Duplikat).length} duplikat</div></div></div>`;
    if (p.tab === 'kontak') {
      const q = (p.q || '').toLowerCase(), segs = ['Semua'].concat(Array.from(new Set(d.kontak.map(k => k.Segmen))));
      const ks = d.kontak.filter(k => (p.seg === 'Semua' || k.Segmen === p.seg) && (!q || [k.Nama, k.NoWA, k.Email, k.Tag, k.OPD].join(' ').toLowerCase().indexOf(q) > -1));
      box.innerHTML = status + `<div class="card pad-s mb16"><div class="row wrap between gap8"><div class="row wrap gap8"><div class="inp-ic" style="min-width:220px">${ic('search')}<input class="inp" data-in="crm.q" value="${e(p.q)}" placeholder="Cari nama, nomor, tag…"></div>
        <select class="sel" data-in="crm.seg" style="width:auto">${segs.map(s => `<option ${s === p.seg ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></div>
        <div class="row wrap gap8"><button class="btn sec" data-act="crm.aksi" data-a="crm.sync" data-busy="Menyinkronkan…">${ic('sync', 'sm')} Sinkron sumber</button><button class="btn sec" data-act="crm.aksi" data-a="crm.cekWA" data-busy="Memeriksa…">${ic('verified_user', 'sm')} Cek nomor WA</button>
        <button class="btn sec" data-act="crm.aksi" data-a="crm.merge" data-busy="Menggabung…">${ic('merge', 'sm')} Gabung duplikat</button><button class="btn pri" data-act="crm.edit" data-id="">${ic('person_add', 'sm')} Kontak</button></div></div></div>
        <div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Segmen / OPD</th><th>WhatsApp</th><th>Email</th><th>Tag</th><th class="r">Pesan</th><th>Terakhir</th><th></th></tr></thead><tbody>
        ${ks.length ? ks.slice(0, 300).map(k => `<tr class="click" data-act="crm.edit" data-id="${k.KontakID}"><td><div class="row gap8">${avatar(k.Nama)}<div><div class="b small">${e(k.Nama)}</div><span class="sub">${e(k.Sumber)}${k.Duplikat ? ' · <span class="bad-t">duplikat</span>' : ''}</span></div></div></td><td class="small">${e(k.Segmen)}<span class="sub">${e(k.OPD || '')}</span></td>
          <td class="small mono">${e(k.NoWA || '—')}${k.StatusWA ? `<span class="sub">${pill(k.StatusWA)}</span>` : ''}</td><td class="small">${e(k.Email || '—')}</td><td>${String(k.Tag || '').split(',').filter(Boolean).map(t => `<span class="tag">${e(t.trim())}</span>`).join(' ')}${k.OptOut === 'YA' ? ' <span class="pill bad nodot">Opt-out</span>' : ''}</td>
          <td class="r mono">${k.JumlahPesan || 0}</td><td class="xs muted">${k.TerakhirDihubungi ? relWaktu(k.TerakhirDihubungi) : '—'}</td><td>${ic('chevron_right', 'sm muted')}</td></tr>`).join('') : `<tr><td colspan="8">${empty('contacts', 'Belum ada kontak. Klik "Sinkron sumber" untuk menarik dari data pegawai & pengguna.')}</td></tr>`}
        </tbody></table></div><div class="tbl-foot"><span>${ks.length} kontak</span><span>Nomor dinormalisasi 08… (simpan) → 62… (kirim)</span></div></div>`;
    } else if (p.tab === 'blast') {
      const segs = ['Semua'].concat(Array.from(new Set(d.kontak.map(k => k.Segmen)))), f = p.blast = p.blast || { judul: '', pesan: 'Yth. {nama},\n\n…\n\n— {institusi}', segmen: 'Semua', opd: 'Semua', tag: '', ukuranBatch: 20, jeda: '3-8' };
      box.innerHTML = status + `<div class="split s7-5"><div class="card pad"><div class="sec-title mb16">${ic('campaign', 'pri-t')} Pesan Siaran (Blast) WhatsApp</div>
        <div class="fgrid c2"><div class="field span3"><label>Judul (internal)</label><input class="inp" data-in="crm.bf" data-k="judul" value="${e(f.judul)}"></div>
        <div class="field span3"><label>Isi pesan</label><textarea class="ta" rows="7" data-in="crm.bf" data-k="pesan">${e(f.pesan)}</textarea><span class="hint">Token: {nama} {institusi} {link}. Kontak opt-out & nomor tidak terdaftar otomatis dikecualikan.</span></div>
        <div class="field"><label>Segmen</label><select class="sel" data-in="crm.bf" data-k="segmen">${segs.map(s => `<option ${s === f.segmen ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></div>
        <div class="field"><label>OPD</label><select class="sel" data-in="crm.bf" data-k="opd">${['Semua'].concat(S.D.Instansi.map(i => i.Kode)).map(s => `<option ${s === f.opd ? 'selected' : ''}>${e(s)}</option>`).join('')}</select></div>
        <div class="field"><label>Tag (opsional)</label><input class="inp" data-in="crm.bf" data-k="tag" value="${e(f.tag)}"></div>
        <div class="field"><label>Ukuran batch & jeda (detik)</label><div class="row gap8"><select class="sel" data-in="crm.bf" data-k="ukuranBatch">${[10, 20, 50].map(n => `<option ${n == f.ukuranBatch ? 'selected' : ''}>${n}</option>`).join('')}</select><input class="inp" data-in="crm.bf" data-k="jeda" value="${e(f.jeda)}" style="max-width:90px"></div></div></div>
        <div class="row gap8 mt16"><button class="btn sec" data-act="crm.blast" data-pv="1" data-busy="Menghitung…">${ic('preview', 'sm')} Pratinjau penerima</button><button class="btn pri" data-act="crm.blast" data-busy="Menjadwalkan…">${ic('send', 'sm')} Jadwalkan blast</button></div><div id="crm-pv" class="mt12"></div></div>
        <div class="card"><div class="card-h"><h3>Riwayat Blast</h3></div><div class="card-b col gap8">${(d.blast || []).length ? d.blast.map(b => `<div class="chip" style="flex-direction:column;align-items:stretch;gap:6px"><div class="row between"><b class="small">${e(b.Judul)}</b>${pill(b.Status)}</div><div class="bar"><i style="width:${b.Total ? (Number(b.Terkirim) + Number(b.Gagal)) / b.Total * 100 : 0}%"></i></div>
          <div class="row between xs muted"><span>${b.Terkirim}/${b.Total} terkirim · ${b.Gagal} gagal · batch ${b.UkuranBatch}</span>${b.Status === 'Berjalan' ? `<button class="btn dang sm" data-act="crm.stop" data-id="${b.BlastID}">Hentikan</button>` : `<span>${e(relWaktu(b.Tanggal))}</span>`}</div></div>`).join('') : empty('campaign', 'Belum ada blast.')}</div></div></div>`;
    } else if (p.tab === 'antrian') {
      box.innerHTML = status + `<div class="card"><div class="card-h"><h3>Antrean Notifikasi (200 terakhir)</h3><button class="btn sec sm" data-act="crm.proses" data-busy="Memproses…">${ic('send', 'sm')} Proses sekarang</button></div><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Waktu</th><th>Kanal</th><th>Tujuan</th><th>Kejadian</th><th>Pesan</th><th>Status</th><th class="r">Coba</th><th>Respon</th></tr></thead><tbody>
        ${(d.antrian || []).length ? d.antrian.map(a => `<tr><td class="xs mono">${e(a.DibuatPada)}</td><td><span class="tag ${a.Kanal === 'WA' ? 'pri' : ''}">${e(a.Kanal)}</span></td><td class="small mono">${e(a.Tujuan)}<span class="sub">${e(a.NamaPenerima)}</span></td><td class="xs">${e(a.Event)}</td><td class="xs" style="max-width:280px"><span class="trunc" style="display:block">${e(String(a.Pesan).replace(/\n/g, ' '))}</span></td><td>${pill(a.Status)}</td><td class="r mono">${a.Percobaan}</td><td class="xs muted" style="max-width:180px"><span class="trunc" style="display:block">${e(a.Respon)}</span></td></tr>`).join('') : `<tr><td colspan="8">${empty('inbox', 'Antrean kosong.')}</td></tr>`}</tbody></table></div></div>`;
    } else {
      const m = rg.matriks || {};
      box.innerHTML = status + `<div class="split s6-6"><div class="card pad"><div class="sec-title mb16">${ic('tune', 'pri-t')} Saklar Utama & Token</div>
        <div class="col gap12"><label class="switch"><input type="checkbox" id="nt-wa" ${rg.waAktif ? 'checked' : ''}><span class="tr"></span><span><b>Notifikasi WhatsApp</b><div class="xs muted">via Fonnte API</div></span></label>
        <label class="switch"><input type="checkbox" id="nt-em" ${rg.emailAktif ? 'checked' : ''}><span class="tr"></span><span><b>Notifikasi Email</b><div class="xs muted">via MailApp (kuota akun Google)</div></span></label>
        <div class="field"><label>Token Fonnte ${rg.adaToken ? `<span class="tag">tersimpan: ${e(rg.token)}</span>` : ''}</label><input class="inp" id="nt-tok" type="password" autocomplete="off" placeholder="${rg.adaToken ? 'Kosongkan bila tidak diganti' : 'Tempel token dari dashboard Fonnte'}"><span class="hint">Disimpan di Script Properties, tidak pernah dikirim ke peramban.</span></div>
        <div class="row gap8"><button class="btn pri" data-act="crm.simpanAtur" data-busy="Menyimpan…">${ic('save', 'sm')} Simpan pengaturan</button>${rg.adaToken ? `<button class="btn ghost" data-act="crm.hapusTok">Hapus token</button>` : ''}</div>
        <hr class="sep"><div class="b small">Uji kirim</div><div class="row gap8"><select class="sel" id="nt-uk" style="width:auto"><option>WA</option><option>EMAIL</option></select><input class="inp" id="nt-ut" placeholder="08… atau email"><button class="btn sec" data-act="crm.uji" data-busy="…">Uji</button></div></div></div>
        <div class="card"><div class="card-h"><h3>Matriks Notifikasi per Kejadian</h3></div><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Kejadian</th><th class="c">WA</th><th class="c">Email</th><th></th></tr></thead><tbody>
        ${Object.keys(m).filter(k => k !== 'BLAST').map(k => `<tr><td><div class="b small">${e(m[k].label)}</div><span class="sub mono">${k}</span></td><td class="c"><input type="checkbox" data-mx="${k}" data-c="wa" ${m[k].wa ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary-hover)"></td><td class="c"><input type="checkbox" data-mx="${k}" data-c="email" ${m[k].email ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary-hover)"></td><td class="r"><button class="btn ghost sm" data-act="crm.templat" data-k="${k}">${ic('edit', 'sm')} Templat</button></td></tr>`).join('')}
        </tbody></table></div><div class="card-b xs muted">Notifikasi transaksi hanya menulis ke antrean; pengiriman oleh trigger 1 menit (maks 3 percobaan).</div></div></div>`;
    }
  }
};
ACT['crm.tab'] = el => { S.pg.crm.tab = el.dataset.v; PAGES.crm.render($('#page-crm')); };
INP['crm.q'] = debounce(el => { S.pg.crm.q = el.value; PAGES.crm.isi(); const i = $('[data-in="crm.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
INP['crm.seg'] = el => { S.pg.crm.seg = el.value; PAGES.crm.isi(); };
INP['crm.bf'] = el => { S.pg.crm.blast[el.dataset.k] = el.value; };
ACT['crm.aksi'] = async el => { sibuk(el, true); try { const r = await api(el.dataset.a, {}); S.pg.crm.data = r.data; toast(r.message || 'Selesai.', 'ok'); PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad', 7000); } finally { sibuk(el, false); } };
ACT['crm.proses'] = async el => { sibuk(el, true); try { const r = await api('notif.proses', {}); const d = await api('crm.daftar', {}); S.pg.crm.data = d.data; toast('Antrean: ' + r.data.hasil, 'ok'); PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad'); } finally { sibuk(el, false); } };
ACT['crm.edit'] = el => {
  const d = S.pg.crm.data, k = d.kontak.find(x => x.KontakID === el.dataset.id) || { KontakID: '', Nama: '', NoWA: '', Email: '', Segmen: 'Lainnya', OPD: '', Tag: '', Catatan: '', OptOut: 'TIDAK' };
  const ints = (d.interaksi || []).filter(i => i.KontakID === k.KontakID).slice(-15).reverse();
  const m = modal({ title: k.KontakID ? 'Kontak: ' + e(k.Nama) : 'Kontak baru', size: 'wide', body: `<div class="split s6-6"><div class="fgrid c2">
      ${[['Nama', 'Nama'], ['NoWA', 'No. WhatsApp'], ['Email', 'Email'], ['Segmen', 'Segmen'], ['OPD', 'OPD'], ['Tag', 'Tag (pisahkan koma)']].map(x => `<div class="field"><label>${x[1]}</label><input class="inp" id="ck-${x[0]}" value="${e(k[x[0]] || '')}"></div>`).join('')}
      <div class="field span3"><label>Catatan</label><textarea class="ta" id="ck-Catatan">${e(k.Catatan || '')}</textarea></div>
      <label class="switch span3"><input type="checkbox" id="ck-OptOut" ${k.OptOut === 'YA' ? 'checked' : ''}><span class="tr"></span><span>Opt-out (tidak menerima blast)</span></label></div>
      <div><div class="b small mb8">Riwayat interaksi</div>${k.KontakID ? `<div class="row gap8 mb8"><select class="sel" id="ci-k" style="width:auto"><option>Telepon</option><option>WA</option><option>Email</option><option>Kunjungan</option></select><input class="inp" id="ci-r" placeholder="Ringkasan interaksi"><button class="btn soft" id="ci-add">Catat</button></div>` : ''}
      <div class="col gap4" style="max-height:320px;overflow:auto">${ints.length ? ints.map(i => `<div class="chip" style="padding:8px 10px"><span class="tag">${e(i.Kanal)}</span><div class="grow small">${e(i.Ringkasan)}<div class="xs muted">${e(i.Tanggal)} · ${e(i.Oleh)}</div></div></div>`).join('') : '<div class="small muted">Belum ada interaksi.</div>'}</div></div></div>`,
    foot: `<button class="btn sec" data-x>Batal</button><button class="btn pri" id="ck-save">Simpan</button>` });
  $('#ck-save', m.el).onclick = async ev => {
    const rec = { KontakID: k.KontakID }; ['Nama', 'NoWA', 'Email', 'Segmen', 'OPD', 'Tag', 'Catatan'].forEach(f => { rec[f] = $('#ck-' + f, m.el).value; }); rec.OptOut = $('#ck-OptOut', m.el).checked ? 'YA' : 'TIDAK';
    sibuk(ev.currentTarget, true);
    try { const r = await api('crm.simpan', rec); S.pg.crm.data = r.data; toast(r.message, 'ok'); m.close(); PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad'); sibuk(ev.currentTarget, false); }
  };
  const add = $('#ci-add', m.el);
  if (add) add.onclick = async () => { const rs = $('#ci-r', m.el).value.trim(); if (!rs) return; try { const r = await api('crm.interaksi', { KontakID: k.KontakID, Kanal: $('#ci-k', m.el).value, Ringkasan: rs }); S.pg.crm.data = r.data; m.close(); ACT['crm.edit']({ dataset: { id: k.KontakID } }); } catch (err) { toast(err.message, 'bad'); } };
};
ACT['crm.blast'] = async el => {
  const f = S.pg.crm.blast, pv = !!el.dataset.pv;
  if (!pv && !(await konfirmasi('Jadwalkan blast "' + e(f.judul) + '"? Pesan dikirim bertahap per batch oleh trigger.', { ok: 'Jadwalkan' }))) return;
  sibuk(el, true);
  try {
    const r = await api('notif.blast', { judul: f.judul, pesan: f.pesan, sasaran: { segmen: f.segmen, opd: f.opd, tag: f.tag }, ukuranBatch: Number(f.ukuranBatch), jeda: f.jeda, pratinjau: pv });
    if (pv) $('#crm-pv').innerHTML = r.data.jumlah ? `<div class="callout info small">${ic('group', 'sm')}<div><b>${r.data.jumlah} penerima</b><div>${r.data.contoh.map(e).join(', ')}${r.data.jumlah > 5 ? ', …' : ''}</div></div></div>`
      : `<div class="callout gold small">${ic('person_off', 'sm')}<div><b>0 penerima</b><div>Belum ada kontak dengan nomor WhatsApp valid pada sasaran ini. Lengkapi No. WA di data Pegawai/Pengguna lalu klik "Sinkron sumber".</div></div></div>`;
    else { S.pg.crm.data = r.data; S.pg.crm.blast = null; toast(r.message, 'ok', 6000); PAGES.crm.isi(); }
  } catch (err) { toast(err.message, 'bad', 7000); } finally { sibuk(el, false); }
};
ACT['crm.stop'] = async el => { if (!(await konfirmasi('Hentikan blast ini? Pesan yang belum terkirim dibatalkan.', { bahaya: true, ok: 'Hentikan' }))) return; try { const r = await api('notif.blastStop', { BlastID: el.dataset.id }); S.pg.crm.data = r.data; PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad'); } };
ACT['crm.simpanAtur'] = async el => {
  const mx = {}; $$('[data-mx]').forEach(c => { mx[c.dataset.mx] = mx[c.dataset.mx] || {}; mx[c.dataset.mx][c.dataset.c] = c.checked; });
  const cur = S.pg.crm.data.ringkas.matriks; Object.keys(mx).forEach(k => { mx[k].pesan = (S.pg.crm.tpl || {})[k] || cur[k].pesan; mx[k].subjek = cur[k].subjek; });
  sibuk(el, true);
  try { const r = await api('notif.simpan', { waAktif: $('#nt-wa').checked, emailAktif: $('#nt-em').checked, token: $('#nt-tok').value, matriks: mx }); S.pg.crm.data.ringkas = r.data.ringkas; toast(r.message, 'ok'); PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad'); } finally { sibuk(el, false); }
};
ACT['crm.hapusTok'] = async () => { if (!(await konfirmasi('Hapus token Fonnte? Notifikasi WA berhenti.', { bahaya: true, ok: 'Hapus token' }))) return; try { const r = await api('notif.simpan', { hapusToken: true }); S.pg.crm.data.ringkas = r.data.ringkas; PAGES.crm.isi(); } catch (err) { toast(err.message, 'bad'); } };
ACT['crm.uji'] = async el => { sibuk(el, true); try { const r = await api('notif.uji', { kanal: $('#nt-uk').value, tujuan: $('#nt-ut').value }); toast(r.message, 'ok', 6000); } catch (err) { toast(err.message, 'bad'); } finally { sibuk(el, false); } };
ACT['crm.templat'] = async el => {
  const k = el.dataset.k, cur = S.pg.crm.data.ringkas.matriks[k];
  const v = await tanya('Templat: ' + cur.label, 'Isi pesan (token: {nama} {nomor} {tanggal} {tujuan} {total} {catatan} {link} {institusi})', { multi: true, nilai: (S.pg.crm.tpl || {})[k] || cur.pesan, ok: 'Pakai' });
  if (v === null) return; S.pg.crm.tpl = S.pg.crm.tpl || {}; S.pg.crm.tpl[k] = v; toast('Templat diperbarui — klik "Simpan pengaturan".', 'info');
};

// =====================================================================
// PENGATURAN (Superadmin) — master data berversi, migrasi, log, sistem
// =====================================================================
const JENIS_SBU = ['UANG_HARIAN', 'REPRESENTASI', 'PENGINAPAN', 'TAKSI', 'TRANSPORT', 'UANG_SAKU', 'TIKET', 'SEWA_KENDARAAN', 'BBM', 'SWAB', 'LEMBUR'];
const opdOpsi = (bintang) => (bintang ? ['*'] : []).concat((S.D.Instansi || []).map(i => i.Kode));
/** Daftar bidang yang sudah dipakai (pagu, pejabat, unit kerja pegawai) — saran isian agar penulisan seragam. */
const bidangOpsi = () => Array.from(new Set([].concat((S.D.Pagu || []).map(r => r.Bidang), (S.D.Pejabat_TTD || []).map(r => r.Bidang),
  (S.D.Pegawai || []).map(r => r.UnitKerja).filter(u => /^bidang/i.test(u || ''))).map(x => String(x || '').trim()).filter(Boolean))).sort();
const TW_F = [1, 2, 3, 4].reduce((a, q) => a.concat([['AnggaranKasTW' + q, 'Anggaran kas TW ' + ['I', 'II', 'III', 'IV'][q - 1] + ' (Rp)', 'num']]), [])
  .concat([1, 2, 3, 4].map(q => ['SPDTW' + q, 'SPD (Surat Penyediaan Dana) TW ' + ['I', 'II', 'III', 'IV'][q - 1] + ' (Rp)', 'num']));
const MF = {
  Master_SBU: { judul: 'SBU & Tarif Satuan', ic: 'payments', versi: true, kunci: r => [r.Jenis, r.JenisPerjalanan, r.Tingkat, r.Wilayah].join('|'),
    kol: [['Jenis', 'Kategori biaya'], ['JenisPerjalanan', 'Perjalanan'], ['Tingkat', 'Tingkat'], ['Wilayah', 'Wilayah'], ['Satuan', 'Satuan', '', 'xl'], ['Nilai', 'Standar (Rp)', 'rp'], ['DasarHukum', 'Dasar hukum', '', 'xl'], ['BerlakuMulai', 'Berlaku', 'tgl']],
    f: () => [['Jenis', 'Jenis biaya', 'sel', JENIS_SBU], ['JenisPerjalanan', 'Jenis perjalanan', 'sel', ['DK', 'DB', 'DIKLAT', 'Semua']], ['Tingkat', 'Tingkat biaya', 'sel', ['A', 'B', 'C', 'D', 'Semua']], ['Wilayah', 'Wilayah / provinsi', 'sel', ['Semua'].concat(SJ.PROVINSI)], ['Satuan', 'Satuan'], ['Nilai', 'Nilai (Rp)', 'num'], ['Uraian', 'Uraian'], ['DasarHukum', 'Dasar hukum'], ['BerlakuMulai', 'Berlaku mulai', 'date']] },
  Pegawai: { judul: 'Data Pegawai', ic: 'badge', opd: true, cari: r => SJ.namaLengkap(r) + ' ' + r.NIP + ' ' + r.Jabatan,
    kol: [['Nama', 'Nama', 'nama'], ['NIP', 'NIP', 'nip'], ['Golongan', 'Gol.'], ['Jabatan', 'Jabatan'], ['Eselon', 'Eselon', '', 'xl'], ['OPD', 'OPD'], ['StatusPegawai', 'Status', '', 'xl'], ['_tingkat', 'Tingkat biaya']],
    f: () => [['NIP', 'NIP (18 digit)'], ['Nama', 'Nama (tanpa gelar)'], ['GelarDepan', 'Gelar depan'], ['GelarBelakang', 'Gelar belakang'], ['Pangkat', 'Pangkat'], ['Golongan', 'Golongan (mis. III/d)'], ['Jabatan', 'Jabatan'], ['Eselon', 'Eselon (mis. II.b, kosong = non-eselon)'], ['UnitKerja', 'Unit kerja / bidang'], ['OPD', 'OPD', 'sel', opdOpsi()], ['StatusPegawai', 'Status', 'sel', ['PNS', 'PPPK', 'PPPK Paruh Waktu']], ['TanggalLahir', 'Tanggal lahir (kosong = dibaca dari NIP)', 'date'], ['NoWA', 'No. WhatsApp'], ['Email', 'Email']] },
  Pagu: { judul: 'Pagu Anggaran', ic: 'savings', opd: true,
    kol: [['SubKegiatan', 'Sub kegiatan'], ['Bidang', 'Bidang'], ['KodeRekening', 'Kode rekening', '', 'xl'], ['JenisPerjalanan', 'Jenis'], ['OPD', 'OPD'], ['Tahun', 'Tahun'], ['PaguAwal', 'Pagu awal', 'rp'], ['_real', 'Realisasi', 'rp'], ['_sisa', 'Sisa', 'rp']],
    f: () => [['OPD', 'OPD', 'sel', opdOpsi()], ['Tahun', 'Tahun anggaran', 'num'], ['JenisPerjalanan', 'Jenis perjalanan', 'sel', ['DK', 'DB', 'Semua']], ['KodeRekening', 'Kode rekening', 'sel', Array.from(new Set((S.D.Kode_Rekening || []).map(r => r.Kode)))], ['Program', 'Program'], ['Kegiatan', 'Kegiatan'], ['SubKegiatan', 'Sub kegiatan'],
      ['Bidang', 'Bidang (menentukan PPTK & PBP di kuitansi)', 'list', bidangOpsi()], ['PaguAwal', 'Pagu awal (Rp)', 'num']].concat(TW_F) },
  Pejabat_TTD: { judul: 'Pejabat & Tanda Tangan SKPD per Bidang', ic: 'draw', opd: true, versi: true, kunci: r => r.OPD + '|' + r.Peran + '|' + (r.Bidang || ''),
    kol: [['Peran', 'Peran', 'peran'], ['Bidang', 'Bidang'], ['Nama', 'Nama'], ['NIP', 'NIP', 'nip'], ['Jabatan', 'Jabatan', '', 'xl'], ['OPD', 'OPD'], ['Metode', 'Metode TTD', 'metode'], ['BerlakuMulai', 'Berlaku', 'tgl']],
    f: () => [['OPD', 'OPD', 'sel', opdOpsi()], ['Peran', 'Peran', 'sel', Object.keys(SJ.PERAN_PEJABAT)], ['Bidang', 'Bidang (khusus PPTK & PBP; kosong = semua bidang)', 'list', bidangOpsi()], ['Nama', 'Nama lengkap + gelar'], ['NIP', 'NIP'], ['Pangkat', 'Pangkat'], ['Jabatan', 'Jabatan (tercetak)'], ['Metode', 'Metode tanda tangan', 'sel', ['Basah', 'Digital']], ['BerlakuMulai', 'Berlaku mulai', 'date']], gambar: 'GambarFileId' },
  Instansi: { judul: 'Instansi / OPD', ic: 'corporate_fare',
    kol: [['Kode', 'Kode'], ['Nama', 'Nama'], ['NamaSingkat', 'Singkatan'], ['KodeSKPD', 'Kode SKPD'], ['Alamat', 'Alamat'], ['Telepon', 'Telepon']],
    f: () => [['Kode', 'Kode (mis. BKAD)'], ['Nama', 'Nama lengkap'], ['NamaSingkat', 'Nama singkat'], ['KodeSKPD', 'Kode SKPD'], ['Alamat', 'Alamat'], ['Telepon', 'Telepon'], ['Laman', 'Laman'], ['Email', 'Email'], ['Kota', 'Kota']] },
  Kop_OPD: { judul: 'Kop Surat per OPD', ic: 'image', opd: true, versi: true, kunci: r => r.OPD,
    kol: [['OPD', 'OPD'], ['Baris2', 'Nama pada kop'], ['Alamat', 'Alamat'], ['_logo', 'Logo / gambar kop'], ['BerlakuMulai', 'Berlaku', 'tgl']],
    f: () => [['OPD', 'OPD', 'sel', opdOpsi()], ['Baris1', 'Baris 1'], ['Baris2', 'Baris 2 (nama OPD)'], ['Baris3', 'Baris 3 (opsional)'], ['Alamat', 'Alamat'], ['Kontak', 'Telepon/faks'], ['Laman', 'Laman/email'], ['BerlakuMulai', 'Berlaku mulai', 'date']], gambar: 'LogoFileId', gambar2: 'KopFileId' },
  Master_Dasar: { judul: 'Master Dasar Surat Tugas', ic: 'text_fields', opd: true,
    kol: [['Kode', 'Kode'], ['OPD', 'OPD'], ['UrutanDefault', 'Urutan'], ['Teks', 'Teks baku'], ['Variabel', 'Variabel isian']],
    f: () => [['OPD', 'OPD (* = semua)', 'sel', opdOpsi(true)], ['Kode', 'Kode (mis. KEP_KA_OPD)'], ['UrutanDefault', 'Urutan default', 'num'], ['Teks', 'Teks dengan {variabel}', 'ta'], ['Variabel', 'Daftar variabel (pisahkan koma)']] },
  Kode_Rekening: { judul: 'Kode Rekening per Jenis', ic: 'account_balance', versi: true, kunci: r => r.OPD + '|' + r.Jenis,
    kol: [['Jenis', 'Jenis'], ['Kode', 'Kode rekening'], ['Uraian', 'Uraian'], ['OPD', 'OPD'], ['BerlakuMulai', 'Berlaku', 'tgl']],
    f: () => [['OPD', 'OPD (* = semua)', 'sel', opdOpsi(true)], ['Jenis', 'Jenis', 'sel', ['DK', 'DB']], ['Kode', 'Kode rekening'], ['Uraian', 'Uraian'], ['Tahun', 'Tahun', 'num'], ['BerlakuMulai', 'Berlaku mulai', 'date']] },
  Pengaturan_Nomor: { judul: 'Pola Penomoran Dokumen', ic: 'pin', opd: true,
    kol: [['JenisDokumen', 'Dokumen'], ['OPD', 'OPD'], ['Pola', 'Pola'], ['Tahun', 'Tahun'], ['NomorTerakhir', 'Nomor terakhir']],
    f: () => [['OPD', 'OPD', 'sel', opdOpsi()], ['JenisDokumen', 'Jenis dokumen', 'sel', ['ST', 'SPD_DK', 'SPD_DB', 'KWT']], ['Pola', 'Pola ({URUT} {ROMAWI} {TAHUN} {BULAN} {OPD})'], ['Tahun', 'Tahun', 'num'], ['NomorTerakhir', 'Nomor terakhir', 'num']] },
  Templat: { judul: 'Templat Dokumen Google Docs', ic: 'description',
    kol: [['Jenis', 'Jenis', 'tpl'], ['OPD', 'OPD'], ['DocId', 'ID / URL Google Docs'], ['Keterangan', 'Keterangan']],
    f: () => [['Jenis', 'Jenis templat', 'sel', Object.keys(SJ.TEMPLAT_LABEL)], ['OPD', 'OPD (* = semua)', 'sel', opdOpsi(true)], ['DocId', 'ID atau URL Google Docs'], ['Keterangan', 'Keterangan']] }
};
const TAB_ATUR = [['Master_SBU', 'payments', 'SBU & Tarif'], ['hitung', 'calculate', 'Perhitungan'], ['Instansi', 'corporate_fare', 'OPD'], ['Kop_OPD', 'image', 'Kop Surat'], ['Pegawai', 'badge', 'Pegawai'], ['Pagu', 'savings', 'Pagu'],
  ['Pejabat_TTD', 'draw', 'Pejabat & TTD'], ['Master_Dasar', 'text_fields', 'Dasar Surat Tugas'], ['Kode_Rekening', 'account_balance', 'Kode Rekening'], ['Pengaturan_Nomor', 'pin', 'Penomoran'], ['Templat', 'description', 'Templat Docs'],
  ['users', 'manage_accounts', 'Pengguna & Peran'], ['app', 'apps', 'Identitas Aplikasi'], ['migrasi', 'move_up', 'Migrasi Data'], ['log', 'policy', 'Log Audit'], ['sistem', 'memory', 'Sistem']];
PAGES.pengaturan = {
  render(el) {
    const p = S.pg.pengaturan = S.pg.pengaturan || { tab: 'Master_SBU', q: '', nonaktif: false };
    el.innerHTML = `<div class="ph"><div><div class="row gap8 wrap"><h1>Pengaturan Master Data & Konfigurasi</h1><span class="pill bad">Superadmin</span></div><p>Perubahan disimpan dengan tanggal berlaku. Dokumen yang sudah terbit tidak berubah karena menyimpan snapshot nilai saat diterbitkan.</p></div></div>
      <div class="callout gold mb16">${ic('lock_clock')}<div class="grow"><b>Prinsip snapshot & versi</b><div class="small">Mengubah <i>tanggal berlaku</i> pada data berversi (SBU, perhitungan, pejabat, kop, kode rekening) membuat <b>versi baru</b>; versi lama tetap dipakai untuk perjalanan yang berangkat sebelum tanggal tersebut.</div></div></div>
      <div class="split s3-9"><div class="card pad-s" style="align-self:start"><div class="label" style="padding:6px 8px">Modul</div><div class="tabs-v">${TAB_ATUR.map(t => `<button class="${p.tab === t[0] ? 'on' : ''}" data-act="atur.tab" data-v="${t[0]}"><span class="row gap8">${ic(t[1], 'sm')}${t[2]}</span>${MF[t[0]] ? `<span class="tag" style="${p.tab === t[0] ? 'background:rgba(255,255,255,.2);color:inherit' : ''}">${(S.D[t[0]] || []).filter(r => r.Status !== 'Nonaktif').length}</span>` : ''}</button>`).join('')}</div></div>
      <div id="atur-body" style="min-width:0"></div></div>`;
    const b = $('#atur-body');
    if (MF[p.tab]) this.master(b, p.tab); else (this[p.tab] || this.Master_SBU).call(this, b);
  },
  master(box, sheet) {
    const p = S.pg.pengaturan, cfg = MF[sheet], q = (p.q || '').toLowerCase();
    let rows = (S.D[sheet] || []).filter(r => (p.nonaktif || r.Status !== 'Nonaktif') && (!cfg.opd || S.opd === 'Semua' || r.OPD === S.opd || r.OPD === '*'));
    if (q) rows = rows.filter(r => (cfg.cari ? cfg.cari(r) : Object.keys(r).map(k => r[k]).join(' ')).toLowerCase().indexOf(q) > -1);
    if (cfg.versi) {   // tandai versi aktif per kunci
      const now = SJ.hariIni(), grp = {};
      rows.forEach(r => { const k = cfg.kunci(r); (grp[k] = grp[k] || []).push(r); });
      Object.keys(grp).forEach(k => { const v = SJ.lookup.versiTerbaru(grp[k], now); grp[k].forEach(r => { r._versi = r === v ? 'Berlaku' : (SJ.iso(r.BerlakuMulai) > now ? 'Terjadwal' : 'Riwayat'); }); });
      rows.sort((a, b) => cfg.kunci(a).localeCompare(cfg.kunci(b)) || SJ.iso(b.BerlakuMulai).localeCompare(SJ.iso(a.BerlakuMulai)));
    }
    const cel = (r, k) => {
      const v = r[k[0]];
      switch (k[2]) {
        case 'rp': return `<td class="r mono">${rp(v)}</td>`;
        case 'tgl': return `<td class="small" style="white-space:nowrap">${tglp(v)}${r._versi ? ` <span class="pill ${r._versi === 'Berlaku' ? 'ok' : r._versi === 'Terjadwal' ? 'info' : 'neu'} nodot">${r._versi}</span>` : ''}</td>`;
        case 'nip': return `<td class="mono small">${e(SJ.fmtNip(v))}</td>`;
        case 'nama': return `<td class="b small">${e(SJ.namaLengkap(r))}</td>`;
        case 'peran': return `<td class="small">${e(SJ.PERAN_PEJABAT[v] || v)}</td>`;
        case 'tpl': return `<td class="small">${e(SJ.TEMPLAT_LABEL[v] || v)}</td>`;
        case 'metode': return `<td>${v === 'Digital' ? '<span class="pill pri">Digital</span>' : '<span class="pill neu">Basah</span>'}${r.GambarFileId ? ' <span class="tag">TTD</span>' : ''}</td>`;
        default: break;
      }
      if (k[0] === '_tingkat') return `<td><span class="tag pri">${SJ.lookup.tingkatBiaya(S.D, r, r.OPD, SJ.hariIni())}</span></td>`;
      if (k[0] === '_real' || k[0] === '_sisa') { const s = SJ.sisaPagu(S.D, r.ID) || {}; return `<td class="r mono">${rp(k[0] === '_real' ? s.realisasi : s.sisa)}</td>`; }
      if (k[0] === '_logo') return `<td>${r.KopFileId ? '<span class="tag pri">Gambar kop</span>' : r.LogoFileId ? '<span class="tag pri">Logo</span>' : '<span class="tag">Lambang bawaan</span>'}</td>`;
      const panjang = ['Teks', 'Alamat', 'Uraian', 'Keterangan'].indexOf(k[0]) > -1;
      return panjang ? `<td class="small" style="min-width:200px;max-width:360px">${e(v)}</td>` : `<td class="small"><span class="trunc" style="display:block;max-width:220px" title="${e(v)}">${e(v)}</span></td>`;
    };
    box.innerHTML = `<div class="card"><div class="card-h" style="flex-wrap:wrap"><div class="row gap8">${ic(cfg.ic, 'pri-t')}<div><h3>${e(cfg.judul)}</h3><div class="xs muted">${rows.length} entri${cfg.versi ? ' · berversi tanggal berlaku' : ''}</div></div></div>
      <div class="row wrap gap8"><div class="inp-ic" style="min-width:200px">${ic('search')}<input class="inp" data-in="atur.q" value="${e(p.q)}" placeholder="Cari…" style="min-height:34px"></div><label class="chk small"><input type="checkbox" data-in="atur.non" ${p.nonaktif ? 'checked' : ''}> Nonaktif</label>
      ${IMPOR[sheet] ? `<button class="btn soft sm" data-act="imp.buka" data-s="${sheet}">${ic('upload_file', 'sm')} Ekspor / Impor Excel</button>` : `<button class="btn sec sm" data-act="atur.csv" data-s="${sheet}">${ic('download', 'sm')} CSV</button>`}<button class="btn pri sm" data-act="atur.edit" data-s="${sheet}" data-id="">${ic('add', 'sm')} Tambah</button></div></div>
      ${sheet === 'Templat' ? `<div class="card-b">${this.panduanTemplat()}</div>` : ''}
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr>${cfg.kol.map(k => `<th class="${k[2] === 'rp' ? 'r' : ''}"${k[3] ? ' data-xxl' : ''}>${e(k[1])}</th>`).join('')}<th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
      ${rows.length ? rows.slice(0, 400).map(r => `<tr class="${r.Status === 'Nonaktif' ? 'dim' : ''}">${cfg.kol.map(k => k[3] ? cel(r, k).replace('<td', '<td data-xxl') : cel(r, k)).join('')}<td>${pill(r.Status || 'Aktif')}</td><td class="r"><div class="row gap4" style="justify-content:flex-end">
        ${cfg.gambar ? `<button class="btn ghost icon sm" data-act="atur.gambar" data-s="${sheet}" data-id="${r.ID}" data-f="${cfg.gambar}" aria-label="Unggah gambar" title="Unggah ${cfg.gambar === 'GambarFileId' ? 'tanda tangan' : 'logo'}">${ic('add_photo_alternate', 'sm')}</button>` : ''}
        ${cfg.gambar2 ? `<button class="btn ghost icon sm" data-act="atur.gambar" data-s="${sheet}" data-id="${r.ID}" data-f="${cfg.gambar2}" aria-label="Unggah gambar kop penuh" title="Unggah gambar kop penuh">${ic('wallpaper', 'sm')}</button>` : ''}
        <button class="btn ghost icon sm" data-act="atur.edit" data-s="${sheet}" data-id="${r.ID}" aria-label="Ubah">${ic('edit', 'sm')}</button>${r.Status !== 'Nonaktif' && 'Status' in r ? `<button class="btn ghost icon sm" data-act="atur.hapus" data-s="${sheet}" data-id="${r.ID}" aria-label="Nonaktifkan">${ic('block', 'sm')}</button>` : ''}</div></td></tr>`).join('') : `<tr><td colspan="${cfg.kol.length + 2}">${empty(cfg.ic, 'Belum ada data.')}</td></tr>`}
      </tbody></table></div></div>${sheet === 'Pagu' ? this.paguTW(rows) : ''}`;
  },
  /** Rekap anggaran kas & SPD (Surat Penyediaan Dana) per triwulan vs realisasi SPJ terverifikasi. */
  paguTW(rows) {
    const R = ['I', 'II', 'III', 'IV'], q = SJ.triwulan(SJ.hariIni());
    const data = rows.filter(r => r.Status !== 'Nonaktif').map(r => ({ r: r, s: SJ.sisaPagu(S.D, r.ID) })).filter(x => x.s);
    return `<div class="card mt16"><div class="card-h" style="flex-wrap:wrap"><div class="row gap8">${ic('calendar_view_month', 'pri-t')}<div><h3>Anggaran Kas & SPD per Triwulan</h3><div class="xs muted">SPD = Surat Penyediaan Dana (kumulatif). Realisasi = SPJ terverifikasi menurut tanggal berangkat. Triwulan berjalan: ${R[q - 1] || '-'}.</div></div></div>
      <button class="btn soft sm" data-act="imp.buka" data-s="Pagu">${ic('upload_file', 'sm')} Impor anggaran kas / SPD</button></div>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th rowspan="2">Sub kegiatan · Bidang</th>${R.map((x, i) => `<th colspan="3" class="c" style="${i + 1 === q ? 'background:var(--pri-soft)' : ''}">TW ${x}</th>`).join('')}<th rowspan="2" class="r">Sisa SPD s.d. TW ${R[q - 1] || ''}</th></tr>
      <tr>${R.map(() => '<th class="r">Kas</th><th class="r">SPD</th><th class="r">Real.</th>').join('')}</tr></thead><tbody>
      ${data.length ? data.map(x => { const t = x.s.tw, now = t[(q || 1) - 1]; return `<tr><td><div class="b small">${e(x.r.SubKegiatan)}</div><span class="sub">${e(x.r.Bidang || 'Tanpa bidang')} · ${e(singkat(x.r.OPD))} ${e(x.r.Tahun)}</span></td>
        ${t.map((w, i) => `<td class="r mono xs">${rp(w.kas)}</td><td class="r mono xs">${rp(w.spd)}</td><td class="r mono xs ${w.realKum > w.spdKum && w.spdKum ? 'bad-t b' : ''}">${rp(w.real)}</td>`).join('')}
        <td class="r mono small b ${now && now.sisaSpdKum < 0 ? 'bad-t' : ''}">${now && now.spdKum ? rp(now.sisaSpdKum) : '<span class="muted">—</span>'}</td></tr>`; }).join('') : `<tr><td colspan="14" class="c muted small">Belum ada pagu.</td></tr>`}
      </tbody></table></div>${data.some(x => x.s.totalKas && Math.round(x.s.totalKas) !== Math.round(x.s.pagu)) ? `<div class="callout warn small" style="margin:12px">${ic('warning', 'sm')}<div>Ada pagu yang jumlah anggaran kas TW I–IV-nya tidak sama dengan pagu awal.</div></div>` : ''}</div>`;
  },
  panduanTemplat() {
    return `<details><summary class="b small" style="cursor:pointer">Panduan placeholder templat (format merge «…»)</summary><div class="small muted mt8" style="line-height:1.7">
      Unggah .docx resmi ke Google Drive akun pemilik skrip → buka dengan Google Docs → salin ID/URL ke tabel ini. Bila templat tidak diatur, SI-JADIN memakai tata letak bawaan yang identik dengan pratinjau.<br>
      <b>Surat Tugas</b>: «NOMOR_ST» «DASAR_1..3» «ULANG_PEGAWAI»…«/ULANG_PEGAWAI» berisi «PEG_NAMA» «PEG_PANGKAT_GOL» «PEG_NIP» «PEG_JABATAN» · «KEGIATAN» «HARI_TANGGAL» «TEMPAT» «TEMPAT_TETAP» «TANGGAL_TETAP» «JABATAN_TTD» (otomatis "a.n. Kepala …" bila Sekretaris) «PENANDATANGAN_NAMA» «PENANDATANGAN_NIP»<br>
      <b>SPD</b>: «NOMOR_SPD» «KOP_NAMA_OPD» «KOP_ALAMAT_OPD» «KOP_TELEPON_OPD» «KOP_LAMAN_OPD» «PA_NAMA / KPA_NAMA» «PA_NIP / KPA_NIP» «PEG_NAMA» «PEG_NIP» «PEG_PANGKAT_GOL» «PEG_JABATAN» «TINGKAT_BIAYA» «Maksud_Perjalanan» «JENIS_KENDARAAN» «NAMA_SINGKAT_OPD» «Tempat_Tujuan» «Kabkota» «Provinsi» «LAMA_HARI» «Tgl_berangkat» «Tgl_Kembali» «PGK_NAMA_1..6» «PGK_TGL_LAHIR_1..6» «PGK_KET_n» «SKPD» «KODE_REKENING» «TEMPAT_TETAP» «TANGGAL_TETAP» · belakang: «KEDUDUKAN» «T1..T3_TIBA_DI» «T1..T3_TGL_TIBA» «T1..T3_DARI» «T1..T3_KE» «T1..T3_TGL_BERANGKAT» «T3_JABATAN_TIBA» «CATATAN_LAIN»<br>
      <b>Kuitansi</b>: «NOMOR» «Tgl_Bayar» «KODE_REKENING» «NAMA_OPD» «TERBILANG…» «NOMINAL» «URAIAN_JENIS» «Tempat_Tujuan» «Maksud_Perjalanan» «Sub_Kegiatan» «Tgl_UH_Mulai» «Tgl_UH_Selesai» «UANG_HARIAN» «UANG_HARIAN_DIKLAT» «JUMLAH» «PA_NAMA» «PA_NIP» «PPTK_NAMA» «PPTK_NIP» «BENDAHARA_NAMA» «BENDAHARA_NIP» «PBP_NAMA» «PBP_NIP» «NAMA» «NIP». Ketiga templat resmi (ST BKAD, SPD DB 6 pengikut, Kwitansi UH + UH Diklat) dapat dipakai apa adanya. Gambar pertama (logo) diganti otomatis dengan logo OPD.</div></details>`;
  },
  hitung(box) {
    const kh = S.D.Konfigurasi_Hari.filter(r => r.Status !== 'Nonaktif'), pp = S.D.Pengaturan_Perhitungan.filter(r => r.Status !== 'Nonaktif'), now = SJ.hariIni();
    const aktif = (rows, k) => { const g = {}; rows.forEach(r => { const kk = k(r); (g[kk] = g[kk] || []).push(r); }); return Object.keys(g).map(x => ({ k: x, v: SJ.lookup.versiTerbaru(g[x], now) || g[x][0], semua: g[x] })); };
    box.innerHTML = `<div class="col gap16"><div class="card"><div class="card-h"><div class="row gap8">${ic('alt_route', 'pri-t')}<div><h3>Pembagian Hari DK/DB vs Diklat</h3><div class="xs muted">Per komponen & OPD (* = semua). Bagian 16 PRD.</div></div></div><button class="btn pri sm" data-act="atur.edit" data-s="Konfigurasi_Hari" data-id="">${ic('add', 'sm')} Versi baru</button></div>
      <div class="card-b grid g2">${aktif(kh, r => r.OPD + '|' + r.Komponen).map(x => `<div style="padding:14px;border-radius:12px;background:var(--surface-2)"><div class="row between"><b class="small">${e(x.v.Komponen === 'UANG_HARIAN' ? 'Uang Harian' : 'Representasi')} · OPD ${e(x.v.OPD)}</b><span class="tag">${x.semua.length} versi</span></div>
        <div class="grid g3 mt12" style="grid-template-columns:repeat(3,1fr)"><div><div class="label">Hari awal</div><div class="bb mono" style="font-size:22px">${x.v.HariAwal}</div></div><div><div class="label">Hari akhir</div><div class="bb mono" style="font-size:22px">${x.v.HariAkhir}</div></div><div><div class="label">Sisa hari</div><div class="b mt8">${e(x.v.SisaJenis)}</div></div></div>
        <div class="row between xs muted mt12"><span>Berlaku ${tglp(x.v.BerlakuMulai)} · ${e(x.v.DasarHukum || '')}</span><button class="btn sec sm" data-act="atur.edit" data-s="Konfigurasi_Hari" data-id="${x.v.ID}">Ubah</button></div></div>`).join('') || empty('alt_route', 'Belum ada konfigurasi.')}</div></div>
      <div class="card"><div class="card-h"><div class="row gap8">${ic('tune', 'pri-t')}<div><h3>Parameter Perhitungan</h3><div class="xs muted">MAKS_PENGIKUT, TINGKAT_PPPK, TINGKAT_PPPK_PARUH_WAKTU, PEMBULATAN_BBM, BATAS_BBM_LITER</div></div></div><button class="btn pri sm" data-act="atur.edit" data-s="Pengaturan_Perhitungan" data-id="">${ic('add', 'sm')} Parameter</button></div>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Parameter</th><th>OPD</th><th>Nilai</th><th>Berlaku</th><th>Dasar</th><th></th></tr></thead><tbody>${aktif(pp, r => r.OPD + '|' + r.Parameter).map(x => `<tr><td class="mono small b">${e(x.v.Parameter)}</td><td>${e(x.v.OPD)}</td><td class="mono b">${e(x.v.Nilai)}</td><td class="small">${tglp(x.v.BerlakuMulai)} <span class="tag">${x.semua.length} versi</span></td><td class="small muted">${e(x.v.DasarHukum)}</td><td class="r"><button class="btn ghost icon sm" data-act="atur.edit" data-s="Pengaturan_Perhitungan" data-id="${x.v.ID}" aria-label="Ubah">${ic('edit', 'sm')}</button></td></tr>`).join('')}</tbody></table></div></div></div>`;
  },
  users(box) {
    const rows = S.D.Users || [];
    box.innerHTML = `<div class="card"><div class="card-h"><div class="row gap8">${ic('manage_accounts', 'pri-t')}<div><h3>Pengguna & Peran</h3><div class="xs muted">Hak akses diperiksa di server pada setiap permintaan.</div></div></div><button class="btn pri sm" data-act="atur.user" data-id="">${ic('person_add', 'sm')} Pengguna</button></div>
      <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>OPD</th><th>NIP</th><th>Login terakhir</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(u => `<tr class="${u.Status !== 'Aktif' ? 'dim' : ''}"><td><div class="row gap8">${avatar(u.Nama)}<b class="small">${e(u.Nama)}</b></div></td><td class="mono small">${e(u.Username)}</td><td><span class="tag pri">${e(SJ.PERAN[u.Role] || u.Role)}</span></td><td>${e(u.OPD || 'Semua')}</td><td class="mono xs">${e(SJ.fmtNip(u.NIP))}</td><td class="xs muted">${u.TerakhirLogin ? relWaktu(u.TerakhirLogin) : '—'}</td><td>${pill(u.Status)}${u.WajibGantiSandi ? ' <span class="tag gold">sandi awal</span>' : ''}</td>
        <td class="r"><button class="btn ghost icon sm" data-act="atur.user" data-id="${u.ID}" aria-label="Ubah">${ic('edit', 'sm')}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card-b small muted">${Object.keys(SJ.PERAN).map(k => `<b>${e(SJ.PERAN[k])}</b>: ${{ SUPERADMIN: 'semua akses & master data', OPERATOR: 'membuat ST/SPD/rincian/kuitansi di OPD-nya', PELAKSANA: 'melihat tugas sendiri, unggah bukti, kuitansi', VERIFIKATOR: 'verifikasi SPJ seluruh OPD, pantau pagu', PIMPINAN: 'menyetujui pengajuan, dashboard & rekap' }[k]}`).join(' · ')}</div></div>`;
  },
  app(box) {
    const c = S.cfg;
    box.innerHTML = `<div class="card pad"><div class="sec-title mb16">${ic('apps', 'pri-t')} Identitas & Perilaku Aplikasi</div><div class="fgrid c2">
      <div class="field"><label>Nama aplikasi</label><input class="inp" id="cf-APP_NAME" value="${e(c.APP_NAME)}"></div><div class="field"><label>Nama pemerintah daerah</label><input class="inp" id="cf-NAMA_PEMDA" value="${e(c.NAMA_PEMDA)}"></div>
      <div class="field"><label>Tempat penerbitan default</label><input class="inp" id="cf-TEMPAT_TERBIT_DEFAULT" value="${e(c.TEMPAT_TERBIT_DEFAULT)}"></div>
      <div class="field"><label>Surat Tugas wajib disetujui Pimpinan</label><select class="sel" id="cf-WAJIB_PERSETUJUAN_ST"><option ${c.WAJIB_PERSETUJUAN_ST === 'TIDAK' ? 'selected' : ''}>TIDAK</option><option ${c.WAJIB_PERSETUJUAN_ST === 'YA' ? 'selected' : ''}>YA</option></select></div>
      <div class="field span3"><label for="cf-FRONTEND_URL">URL frontend (GitHub Pages / Vercel) — untuk QR verifikasi & tautan notifikasi</label><div class="row gap8"><input class="inp grow" id="cf-FRONTEND_URL" value="${e(c.FRONTEND_URL)}" placeholder="https://akun.github.io/si-jadin/"><button class="btn sec" type="button" data-act="atur.urlIni">Pakai alamat ini</button></div><span class="hint">Alamat yang sedang dibuka: ${e(location.origin + location.pathname.replace(/index\.html$/, ''))}</span></div>
      <div class="field span3"><label>URL API backend (Apps Script /exec)</label><input class="inp mono" readonly value="${e(API_URL || c.APP_URL || '')}"><span class="hint">Diatur di berkas <b>config.js</b> frontend. Server melaporkan: ${e(c.APP_URL || '-')}</span></div>
      <div class="field"><label>Cadangan mingguan</label><select class="sel" id="cf-BACKUP_AKTIF"><option>YA</option><option ${c.BACKUP_AKTIF === 'TIDAK' ? 'selected' : ''}>TIDAK</option></select></div>
      <div class="field"><label>Mode demo (tampilkan akun contoh di halaman masuk)</label><select class="sel" id="cf-MODE_DEMO"><option ${c.MODE_DEMO !== 'YA' ? 'selected' : ''}>TIDAK</option><option ${c.MODE_DEMO === 'YA' ? 'selected' : ''}>YA</option></select><span class="hint">Wajib TIDAK di produksi.</span></div></div>
      ${c.MODE_DEMO === 'YA' ? `<div class="callout warn small mt16">${ic('warning', 'sm')}<div><b>Mode demo aktif.</b> Akun contoh dan kata sandi bawaan terlihat di halaman masuk. Matikan sebelum dipakai resmi, ganti sandi semua akun, dan ganti data contoh dengan data instansi.</div></div>` : ''}
      <button class="btn pri mt16" data-act="atur.cfg" data-busy="Menyimpan…">${ic('save', 'sm')} Simpan</button></div>`;
  },
  migrasi(box) {
    const m = S.pg.pengaturan.mig = S.pg.pengaturan.mig || { sumber: '' };
    const j = S.pg.pengaturan.mj = S.pg.pengaturan.mj || { sumber: '', mode: 'baru', hasil: {} };
    const jalan = !!j.jalan, tot = k => Object.keys(j.hasil).reduce((a, n) => a + (Number(j.hasil[n][k]) || 0), 0);
    const kartuSijadin = `<div class="card pad"><div class="sec-title mb8">${ic('sync_alt', 'pri-t')} Pindahkan dari SI-JADIN versi sebelumnya</div>
      <p class="small muted" style="margin-top:0">Untuk peralihan ke metode PRO (proyek Apps Script baru + frontend GitHub Pages/Vercel). Database lama hanya <b>dibaca</b>; tiap sheet disalin berdasarkan nama kolom dengan <b>upsert idempoten</b> (aman diulang untuk delta-sync sesaat sebelum peralihan). Pengguna dicocokkan lewat <i>username</i>, pegawai lewat NIP; kata sandi di proyek baru tidak ditimpa dan nomor surat terakhir memakai nilai terbesar. Pakai akun Google yang sama agar berkas Drive (PDF, bukti, logo) tetap terbuka. Token Fonnte <b>tidak</b> ikut — isi ulang di Notifikasi.</p>
      <div class="row wrap gap8"><input class="inp grow" id="mj-src" value="${e(j.sumber)}" placeholder="URL atau ID spreadsheet database SI-JADIN lama" style="min-width:260px" ${jalan ? 'disabled' : ''}><button class="btn pri" data-act="mj.pindai" data-busy="Memindai…" ${jalan ? 'disabled' : ''}>${ic('travel_explore', 'sm')} Pindai</button></div>
      ${j.pindai ? `<div class="callout info mt12">${ic('description')}<div><b>${e(j.pindai.judul)}</b><div class="small">${j.pindai.sheets.length} sheet cocok · ${j.pindai.sheets.reduce((a, x) => a + x.sumber, 0)} baris di sumber</div></div></div>
        <div class="row wrap gap8 mt12" style="align-items:center"><label class="small b" for="mj-mode">Mode</label><select class="sel" id="mj-mode" data-in="mj.mode" style="width:auto;max-width:100%;min-width:0;flex:1 1 220px" ${jalan ? 'disabled' : ''}><option value="baru" ${j.mode === 'baru' ? 'selected' : ''}>Tambah baris baru saja (aman)</option><option value="perbarui" ${j.mode === 'perbarui' ? 'selected' : ''}>Tambah + perbarui baris yang berubah</option></select>
          <button class="btn sec" data-act="mj.semua" data-dry="1" ${jalan ? 'disabled' : ''}>${ic('science', 'sm')} Simulasi semua</button><button class="btn pri" data-act="mj.semua" ${jalan ? 'disabled' : ''}>${ic('download_done', 'sm')} Jalankan migrasi</button></div>
        ${jalan || Object.keys(j.hasil).length ? `<div class="mt12"><div class="row wrap gap8 small" aria-live="polite">${jalan ? `<span class="b">${e(j.jalan)}</span>` : `<span class="b">${j.dry ? 'Hasil simulasi' : 'Hasil migrasi'}:</span>`}<span class="pill ok">+${tot('inserted')} baru</span><span class="pill info">~${tot('updated')} diperbarui</span><span class="pill neu">=${tot('skipped')} dilewati</span>${tot('bentrok') ? `<span class="pill warn">!${tot('bentrok')} bentrok ID</span>` : ''}</div>
          ${jalan ? `<div class="bar mt8" style="height:6px"><i style="width:${Math.round(100 * (j.ke || 0) / j.pindai.sheets.length)}%"></i></div>` : ''}</div>` : ''}
        <div class="tbl-wrap mt12" style="max-height:52vh"><table class="tbl compact"><thead><tr><th>Sheet</th><th class="num">Sumber</th><th class="num">Tujuan</th><th>Hasil</th></tr></thead><tbody>${j.pindai.sheets.map(x => { const h = j.hasil[x.sheet];
          return `<tr><td class="mono small">${e(x.sheet)}</td><td class="num">${x.sumber}</td><td class="num">${x.tujuan}</td><td class="small">${h ? (h.error ? `<span class="bad-t">${e(h.error)}</span>` : `<span class="ok-t">+${h.inserted}</span> · ~${h.updated} · =${h.skipped}${h.bentrok ? ` · <span class="warn-t">!${h.bentrok}</span>` : ''}`) : j.jalan && j.aktif === x.sheet ? '<span class="muted">memproses…</span>' : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : ''}</div>`;
    box.innerHTML = `<div class="col gap16">${kartuSijadin}<div class="card pad"><div class="sec-title mb8">${ic('move_up', 'pri-t')} Migrasi dari e-SPPD / SI-STAMP</div>
      <p class="small muted" style="margin-top:0">Spreadsheet lama hanya <b>dibaca</b>. Kolom dicocokkan berdasarkan nama header (dengan alias), impor bersifat <b>upsert idempoten</b> sehingga aman diulang. Jalankan <b>Simulasi</b> dulu, lalu ulangi sesaat sebelum peralihan (delta-sync). Gunakan akun Google yang sama dengan pemilik spreadsheet lama.</p>
      <div class="row wrap gap8"><input class="inp grow" id="mg-src" value="${e(m.sumber)}" placeholder="Tempel URL atau ID spreadsheet lama" style="min-width:260px"><button class="btn pri" data-act="mig.pindai" data-busy="Memindai…">${ic('travel_explore', 'sm')} Pindai</button></div></div>
      ${m.hasil ? `<div class="callout info">${ic('description')}<div><b>${e(m.hasil.judul)}</b><div class="small">${m.hasil.sheets.map(s => e(s.nama) + ' (' + s.baris + ' baris)').join(' · ')}</div></div></div>` +
        m.hasil.rencana.map((r, i) => `<div class="card"><div class="card-h" style="flex-wrap:wrap"><div><h3>${e(r.label)} → <span class="mono">${e(r.target)}</span></h3><div class="xs muted">Kunci: ${e(r.target === 'Pegawai' ? 'NIP' : r.target === 'Pagu' ? 'OPD+Tahun+Rekening+SubKegiatan' : 'komposit')}</div></div>
          <div class="row gap8"><select class="sel" data-in="mig.sheet" data-i="${i}" style="width:auto"><option value="">— sheet sumber —</option>${m.hasil.sheets.map(s => `<option ${s.nama === r.sumberSheet ? 'selected' : ''}>${e(s.nama)}</option>`).join('')}</select></div></div>
          <div class="card-b">${r.sumberSheet ? `<div class="fgrid c4">${r.kolom.map(k => `<div class="field"><label class="xs">${e(k)}</label><select class="sel" data-in="mig.peta" data-i="${i}" data-k="${k}"><option value="">—</option>${(m.hasil.sheets.find(s => s.nama === r.sumberSheet) || { header: [] }).header.filter(Boolean).map(h => `<option ${r.peta[k] === h ? 'selected' : ''}>${e(h)}</option>`).join('')}</select></div>`).join('')}</div>
            ${r.hasil ? `<div class="row wrap gap8 mt12"><span class="pill ok">+${r.hasil.inserted} baru</span><span class="pill info">~${r.hasil.updated} diperbarui</span><span class="pill neu">=${r.hasil.skipped} dilewati</span>${(r.hasil.peringatan || []).length ? `<span class="small warn-t">${e(r.hasil.peringatan.slice(0, 2).join(' · '))}</span>` : ''}</div>` : ''}
            <div class="row gap8 mt12"><button class="btn sec" data-act="mig.jalan" data-i="${i}" data-dry="1" data-busy="Mensimulasikan…">${ic('science', 'sm')} Simulasi</button><button class="btn pri" data-act="mig.jalan" data-i="${i}" data-busy="Mengimpor…">${ic('download_done', 'sm')} Jalankan impor</button></div>` : '<div class="small muted">Tidak ada sheet yang cocok terdeteksi. Pilih sheet sumber secara manual.</div>'}</div></div>`).join('') : ''}</div>`;
  },
  log(box) {
    const p = S.pg.pengaturan;
    box.innerHTML = `<div class="card"><div class="card-h"><div class="row gap8">${ic('policy', 'pri-t')}<div><h3>Log Audit Aktivitas</h3><div class="xs muted">Sheet dilindungi — tidak dapat diubah manual.</div></div></div><div class="inp-ic" style="min-width:220px">${ic('search')}<input class="inp" id="lg-q" placeholder="Cari pengguna/tindakan…" value="${e(p.logq || '')}" style="min-height:34px"></div></div><div id="lg-body"><div class="card-b"><div class="skel" style="height:200px"></div></div></div></div>`;
    const muat = () => api('log.ambil', { limit: 300, q: p.logq || '' }, { silent: true }).then(r => {
      $('#lg-body').innerHTML = `<div class="tbl-wrap" style="max-height:65vh"><table class="tbl compact"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Peran</th><th>Tindakan</th><th>Rujukan</th><th>Detail</th></tr></thead><tbody>${r.data.map(l => `<tr><td class="xs mono">${e(l.Waktu)}</td><td class="small b">${e(l.Pengguna)}</td><td class="xs">${e(l.Peran)}</td><td><span class="tag">${e(l.Tindakan)}</span></td><td class="xs mono">${e(l.Rujukan)}</td><td class="xs muted" style="max-width:360px">${e(l.Detail)}</td></tr>`).join('')}</tbody></table></div>`;
    }).catch(err => { $('#lg-body').innerHTML = `<div class="card-b callout bad">${e(err.message)}</div>`; });
    muat();
    $('#lg-q').oninput = debounce(ev => { p.logq = ev.target.value; muat(); }, 350);
  },
  sistem(box) {
    box.innerHTML = `<div class="grid g2"><div class="card pad"><div class="sec-title mb8">${ic('memory', 'pri-t')} Cache & Rekap</div><p class="small muted">Cache server (CacheService) dibersihkan otomatis saat ada perubahan. Bersihkan manual bila Anda mengedit spreadsheet langsung.</p>
      <div class="row wrap gap8"><button class="btn sec" data-act="atur.sys" data-a="sistem.cache" data-busy="…">${ic('cleaning_services', 'sm')} Bersihkan cache server</button><button class="btn sec" data-act="atur.sys" data-a="rekap.bangun" data-busy="…">${ic('table_view', 'sm')} Bangun ulang Rekap_Cache</button><button class="btn sec" data-act="atur.lokal">${ic('phonelink_erase', 'sm')} Hapus cache perangkat</button></div></div>
      <div class="card pad"><div class="sec-title mb8">${ic('backup', 'pri-t')} Cadangan</div><p class="small muted">Salinan spreadsheet dibuat otomatis setiap Senin 01.00 (8 salinan terakhir disimpan).</p><button class="btn pri" data-act="atur.sys" data-a="sistem.backup" data-busy="Membuat cadangan…">${ic('backup', 'sm')} Buat cadangan sekarang</button></div>
      <div class="card pad"><div class="sec-title mb8">${ic('info', 'pri-t')} Tentang</div><div class="small">SI-JADIN v${e(S.verServer || S.cfg.VERSION || '3.1.0')} · PRD v1.10 · metode PRO<br>Frontend statis PWA (GitHub Pages / Vercel) ↔ REST API Google Apps Script · rahasia di Script Properties · sinkron delta per sheet · CacheService ber-chunk · antrean notifikasi non-blocking · modul bersama dokumen.js = Dokumen.gs (pratinjau = PDF)</div></div></div>`;
  }
};
ACT['atur.tab'] = el => { S.pg.pengaturan.tab = el.dataset.v; S.pg.pengaturan.q = ''; refresh(); };
INP['atur.q'] = debounce(el => { S.pg.pengaturan.q = el.value; PAGES.pengaturan.master($('#atur-body'), S.pg.pengaturan.tab); const i = $('[data-in="atur.q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200);
INP['atur.non'] = el => { S.pg.pengaturan.nonaktif = el.checked; refresh(); };
ACT['atur.edit'] = el => {
  const sheet = el.dataset.s, cfg = MF[sheet] || { judul: sheet, f: () => [] }, r = SJ.one(S.D[sheet] || [], 'ID', el.dataset.id) || {};
  const fields = sheet === 'Konfigurasi_Hari' ? [['OPD', 'OPD (* = semua)', 'sel', opdOpsi(true)], ['Komponen', 'Komponen', 'sel', ['UANG_HARIAN', 'REPRESENTASI']], ['HariAwal', 'Hari awal dibayar DK/DB', 'num'], ['HariAkhir', 'Hari akhir dibayar DK/DB', 'num'], ['SisaJenis', 'Sisa hari dibayar', 'sel', ['DIKLAT']], ['BerlakuMulai', 'Berlaku mulai', 'date'], ['DasarHukum', 'Dasar / keputusan']]
    : sheet === 'Pengaturan_Perhitungan' ? [['OPD', 'OPD (* = semua)', 'sel', opdOpsi(true)], ['Parameter', 'Parameter', 'sel', ['MAKS_PENGIKUT', 'TINGKAT_PPPK', 'TINGKAT_PPPK_PARUH_WAKTU', 'PEMBULATAN_BBM', 'BATAS_BBM_LITER']], ['Nilai', 'Nilai'], ['BerlakuMulai', 'Berlaku mulai', 'date'], ['DasarHukum', 'Dasar / keputusan']] : cfg.f();
  const versi = cfg.versi || sheet === 'Konfigurasi_Hari' || sheet === 'Pengaturan_Perhitungan';
  const def = Object.assign({ BerlakuMulai: SJ.hariIni(), Tahun: S.tahun, OPD: S.opd !== 'Semua' ? S.opd : '' }, r);
  const m = modal({ title: (r.ID ? 'Ubah ' : 'Tambah ') + e(cfg.judul || sheet), size: 'wide', body: `${versi && r.ID ? `<div class="callout gold small mb16">${ic('history', 'sm')}<div>Ubah <b>Berlaku mulai</b> untuk membuat versi baru (versi lama tetap). Tanggal sama = koreksi versi ini.</div></div>` : ''}
    <div class="fgrid c2">${fields.map(f => { const v = def[f[0]] === undefined ? '' : def[f[0]]; const id = 'mf-' + f[0];
      return `<div class="field ${f[2] === 'ta' ? 'span3' : ''}"><label for="${id}">${e(f[1])}</label>${f[2] === 'sel' ? `<select class="sel" id="${id}">${(f[3] || []).map(o => `<option ${String(o) === String(v) ? 'selected' : ''}>${e(o)}</option>`).join('')}</select>` : f[2] === 'ta' ? `<textarea class="ta" id="${id}">${e(v)}</textarea>` : f[2] === 'list' ? `<input class="inp" id="${id}" list="${id}-dl" value="${e(v)}" autocomplete="off"><datalist id="${id}-dl">${(f[3] || []).map(o => `<option value="${e(o)}">`).join('')}</datalist>` : `<input class="inp" id="${id}" type="${f[2] === 'num' ? 'number' : f[2] === 'date' ? 'date' : 'text'}" value="${e(f[2] === 'date' ? SJ.iso(v) : v)}">`}</div>`; }).join('')}</div>`,
    foot: `<button class="btn sec" data-x>Batal</button><button class="btn pri" id="mf-save">${ic('save', 'sm')} Simpan</button>` });
  $('#mf-save', m.el).onclick = async ev => {
    const rec = { ID: r.ID || '' }; fields.forEach(f => { rec[f[0]] = $('#mf-' + f[0], m.el).value; });
    const btn = ev.currentTarget;
    try { await mutasi('master.simpan', { sheet: sheet, record: rec }, { btn: btn, ok: d => { upsertRow(sheet, d.record); simpanCache(); } }); m.close(); } catch (err) { /* toast sudah */ }
  };
};
ACT['atur.hapus'] = async el => { if (!(await konfirmasi('Nonaktifkan data ini? Riwayat tetap tersimpan dan dokumen lama tidak berubah.', { bahaya: true, ok: 'Nonaktifkan' }))) return; await mutasi('master.hapus', { sheet: el.dataset.s, id: el.dataset.id }, { ok: d => upsertRow(d.sheet, d.record) }).catch(() => null); };
ACT['atur.gambar'] = async el => {
  const file = await pilihBerkas('image/png,image/jpeg,image/webp'); if (!file) return;
  const k = await kompresGambar(file, el.dataset.f === 'KopFileId' ? 2000 : 800);
  try { await mutasi('master.unggahGambar', { sheet: el.dataset.s, id: el.dataset.id, field: el.dataset.f, data: k.data, mime: k.type, nama: file.name }, { ok: d => { S.aset[d.fileId] = k.data; if (d.record) upsertRow(el.dataset.s, d.record); } }); } catch (err) { /* toast */ }
};
// =====================================================================
// EKSPOR-IMPOR EXCEL MASTER — SBU · Pagu & anggaran kas/SPD per triwulan · Pejabat & TTD per bidang · Pegawai
// Templat .xlsx (sheet Data + Petunjuk + Referensi) → unggah → simulasi per baris (server) → simpan massal.
// =====================================================================
const TW_KOL = [1, 2, 3, 4].map(q => ['AnggaranKasTW' + q, 'Anggaran Kas TW' + q, 0, 'Rencana anggaran kas triwulan ' + q + ' (Rp)', 15000000])
  .concat([1, 2, 3, 4].map(q => ['SPDTW' + q, 'SPD TW' + q, 0, 'SPD = Surat Penyediaan Dana yang terbit untuk triwulan ' + q + ' (Rp)', q < 3 ? 15000000 : '']));
const IMPOR = {
  Master_SBU: { nama: 'SBU', kol: [['Jenis', 'Jenis Biaya', 1, 'Salah satu: ' + JENIS_SBU.join(', '), 'UANG_HARIAN'], ['JenisPerjalanan', 'Jenis Perjalanan', 1, 'DK, DB, DIKLAT, atau Semua', 'DB'],
    ['Tingkat', 'Tingkat Biaya', 1, 'A, B, C, D, atau Semua', 'Semua'], ['Wilayah', 'Wilayah', 1, 'Nama provinsi persis seperti sheet Referensi, atau Semua', 'Jawa Barat'],
    ['Satuan', 'Satuan', 1, 'OH, Malam, Kali, PP, Hari, Liter, Jam', 'OH'], ['Nilai', 'Nilai (Rp)', 1, 'Angka saja, mis. 430000', 430000], ['Uraian', 'Uraian', 0, 'Keterangan singkat', ''],
    ['DasarHukum', 'Dasar Hukum', 0, 'Mis. Perbup Nomor … Tahun …', 'Perbup … Tahun …'], ['BerlakuMulai', 'Berlaku Mulai', 1, 'yyyy-mm-dd. Tanggal baru = versi baru; tanggal sama = koreksi versi itu', '2027-01-01'],
    ['Status', 'Status', 0, 'Aktif / Nonaktif (kosong = Aktif)', 'Aktif']] },
  Pagu: { nama: 'Pagu & Anggaran Kas-SPD per TW', kol: [['OPD', 'OPD', 1, 'Kode OPD (sheet Referensi)', 'BKAD'], ['Tahun', 'Tahun', 1, 'Tahun anggaran', 2027],
    ['KodeRekening', 'Kode Rekening', 1, 'Kode rekening belanja perjalanan dinas', '5.1.02.04.001.00001'], ['JenisPerjalanan', 'Jenis Perjalanan', 1, 'DK, DB, atau Semua', 'DB'],
    ['Program', 'Program', 0, '', 'Penunjang Urusan Pemerintahan Daerah'], ['Kegiatan', 'Kegiatan', 0, '', 'Pengelolaan Keuangan Daerah'], ['SubKegiatan', 'Sub Kegiatan', 1, 'Nama sub kegiatan (kunci bersama OPD, Tahun, Kode Rekening, Jenis)', 'Koordinasi Pengelolaan Keuangan Daerah'],
    ['Bidang', 'Bidang', 0, 'Bidang pelaksana — menentukan PPTK & PBP pada kuitansi', 'Bidang Perbendaharaan'], ['PaguAwal', 'Pagu (Rp)', 1, 'Pagu anggaran sub kegiatan', 60000000]].concat(TW_KOL).concat([['Status', 'Status', 0, 'Aktif / Nonaktif', 'Aktif']]) },
  Pejabat_TTD: { nama: 'Pejabat & TTD per Bidang', kol: [['OPD', 'OPD', 1, 'Kode OPD', 'BKAD'], ['Bidang', 'Bidang', 0, 'Isi untuk PPTK & Pembantu Bendahara (PBP); kosong = berlaku semua bidang', 'Bidang Perbendaharaan'],
    ['Peran', 'Peran', 1, 'Kode peran (sheet Referensi): ' + Object.keys(SJ.PERAN_PEJABAT).join(', '), 'PPTK'], ['Nama', 'Nama', 1, 'Nama lengkap + gelar seperti tercetak', 'Nama Lengkap, S.E.'],
    ['NIP', 'NIP', 1, '18 digit — kolom berformat Teks', '198203152006042011'], ['Pangkat', 'Pangkat', 0, '', 'Penata Tk. I'], ['Jabatan', 'Jabatan', 1, 'Jabatan tercetak pada dokumen', 'PPTK'],
    ['Metode', 'Metode TTD', 1, 'Basah atau Digital (gambar TTD diunggah di aplikasi)', 'Basah'], ['BerlakuMulai', 'Berlaku Mulai', 1, 'yyyy-mm-dd. Tanggal baru = versi baru (pejabat lama tetap untuk dokumen lama)', '2027-01-01'],
    ['Status', 'Status', 0, 'Aktif / Nonaktif', 'Aktif']] },
  Pegawai: { nama: 'Pegawai', kol: [['NIP', 'NIP', 1, '18 digit — kolom berformat Teks (kunci: NIP sama = perbarui)', '198203152006042011'], ['Nama', 'Nama', 1, 'Tanpa gelar', 'Nama Pegawai'],
    ['GelarDepan', 'Gelar Depan', 0, '', 'Dr.'], ['GelarBelakang', 'Gelar Belakang', 0, '', 'S.E., M.Ak'], ['Pangkat', 'Pangkat', 0, '', 'Penata Tk. I'], ['Golongan', 'Golongan', 1, 'Mis. III/d (PPPK: IX dst.)', 'III/d'],
    ['Jabatan', 'Jabatan', 1, '', 'Analis Keuangan'], ['Eselon', 'Eselon', 0, 'Mis. II.b; kosong = non-eselon (menentukan tingkat biaya)', ''], ['UnitKerja', 'Unit Kerja / Bidang', 0, '', 'Bidang Perbendaharaan'],
    ['OPD', 'OPD', 1, 'Kode OPD', 'BKAD'], ['StatusPegawai', 'Status Pegawai', 1, 'PNS, PPPK, atau PPPK Paruh Waktu', 'PNS'], ['TanggalLahir', 'Tanggal Lahir', 0, 'yyyy-mm-dd; kosong = dibaca dari NIP', '1982-03-15'],
    ['NoWA', 'No. WhatsApp', 0, 'Format 08… (kolom Teks)', ''], ['Email', 'Email', 0, '', ''], ['Status', 'Status', 0, 'Aktif / Nonaktif', 'Aktif']] }
};
const TEKS_IMPOR = ['NIP', 'NoWA', 'KodeRekening'], TGL_IMPOR = ['BerlakuMulai', 'TanggalLahir'];
const normKol = s => String(s || '').toLowerCase().replace(/\(.*?\)|\*/g, '').replace(/[^a-z0-9]/g, '');
async function siapXLSX() { if (!window.XLSX) await muatSkrip('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'); return window.XLSX; }
/** Unduh templat kosong (isi=false) atau data saat ini (isi=true) dalam format yang sama → bisa diunggah ulang. */
async function unduhTemplatImpor(sheet, isi) {
  const cfg = IMPOR[sheet], X = await siapXLSX().catch(() => null);
  if (!X) return toast('Pustaka Excel tidak dapat dimuat. Periksa koneksi internet.', 'bad');
  const rows = isi ? (S.D[sheet] || []).filter(r => (S.opd === 'Semua' || !r.OPD || r.OPD === S.opd)) : [];
  const head = cfg.kol.map(k => k[1] + (k[2] ? ' *' : ''));
  const aoa = [head].concat(rows.map(r => cfg.kol.map(k => { const v = r[k[0]]; return TGL_IMPOR.indexOf(k[0]) > -1 ? SJ.iso(v) : (v === undefined || v === null ? '' : v); })));
  const ws = X.utils.aoa_to_sheet(aoa), n = Math.max(rows.length + 200, 300);
  cfg.kol.forEach((k, c) => {   // kolom NIP / No. WA / kode rekening sebagai Teks agar digit tidak hilang
    if (TEKS_IMPOR.indexOf(k[0]) < 0) return;
    for (let r = 1; r <= n; r++) { const a = X.utils.encode_cell({ r: r, c: c }), cell = ws[a]; ws[a] = { t: 's', v: cell ? String(cell.v) : '', z: '@' }; }
  });
  ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, n), c: cfg.kol.length - 1 } });
  ws['!cols'] = cfg.kol.map(k => ({ wch: Math.min(42, Math.max(12, k[1].length + 4, String(k[4] || '').length + 2)) }));
  const pet = [['PETUNJUK PENGISIAN — ' + cfg.nama.toUpperCase()], ['Isi sheet "Data" mulai baris 2. Kolom bertanda * wajib. Jangan ubah judul kolom. Unggah lewat SI-JADIN → Pengaturan → ' + (MF[sheet] || {}).judul + ' → Ekspor / Impor Excel.'],
    ['Data yang kuncinya sama akan DIPERBARUI, sisanya DITAMBAHKAN. Aman diunggah ulang: baris yang tidak berubah dilewati.'], [], ['Kolom', 'Wajib', 'Keterangan', 'Contoh']]
    .concat(cfg.kol.map(k => [k[1], k[2] ? 'Ya' : '', k[3] || '', k[4] === undefined ? '' : k[4]]));
  const ref = [['OPD (kode)', 'Nama OPD', '', 'Peran pejabat (kode)', 'Keterangan', '', 'Provinsi / wilayah', '', 'Jenis biaya SBU', '', 'Bidang terpakai']];
  const opd = S.D.Instansi || [], per = Object.keys(SJ.PERAN_PEJABAT), prov = ['Semua'].concat(SJ.PROVINSI), bid = bidangOpsi();
  for (let i = 0; i < Math.max(opd.length, per.length, prov.length, JENIS_SBU.length, bid.length); i++) {
    ref.push([(opd[i] || {}).Kode || '', (opd[i] || {}).Nama || '', '', per[i] || '', per[i] ? SJ.PERAN_PEJABAT[per[i]] : '', '', prov[i] || '', '', JENIS_SBU[i] || '', '', bid[i] || '']);
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Data');
  const wp = X.utils.aoa_to_sheet(pet); wp['!cols'] = [{ wch: 22 }, { wch: 7 }, { wch: 80 }, { wch: 30 }]; X.utils.book_append_sheet(wb, wp, 'Petunjuk');
  const wr = X.utils.aoa_to_sheet(ref); wr['!cols'] = [{ wch: 12 }, { wch: 46 }, { wch: 2 }, { wch: 20 }, { wch: 44 }, { wch: 2 }, { wch: 26 }, { wch: 2 }, { wch: 18 }, { wch: 2 }, { wch: 28 }]; X.utils.book_append_sheet(wb, wr, 'Referensi');
  const nama = (isi ? 'Data_' : 'Templat_Upload_') + cfg.nama.replace(/[^A-Za-z0-9]+/g, '_') + '_' + SJ.hariIni();
  X.writeFile(wb, nama + '.xlsx');
  toast('"' + nama + '.xlsx" diunduh' + (isi ? ' (' + rows.length + ' baris).' : '.'), 'ok');
}
function tglImpor(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.getFullYear() + '-' + SJ.pad(v.getMonth() + 1) + '-' + SJ.pad(v.getDate());
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + SJ.pad(d.getUTCMonth() + 1) + '-' + SJ.pad(d.getUTCDate()); }
  const s = String(v).trim(); let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return m[1] + '-' + SJ.pad(+m[2]) + '-' + SJ.pad(+m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return m[3] + '-' + SJ.pad(+m[2]) + '-' + SJ.pad(+m[1]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) { const b = SJ.BULAN.findIndex(x => x.toLowerCase().indexOf(m[2].toLowerCase().slice(0, 3)) === 0); if (b > -1) return m[3] + '-' + SJ.pad(b + 1) + '-' + SJ.pad(+m[1]); }
  return s;
}
/** Baca berkas → { rows (dikirim ke server), galatKlien (mis. NIP terbaca angka) }. */
async function bacaBerkasImpor(file, sheet) {
  const cfg = IMPOR[sheet], X = await siapXLSX();
  const wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: /\.csv$/i.test(file.name) });
  const ws = wb.Sheets.Data || wb.Sheets[wb.SheetNames[0]];
  const aoa = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const peta = {}; cfg.kol.forEach(k => { peta[normKol(k[0])] = k[0]; peta[normKol(k[1])] = k[0]; });
  Object.assign(peta, { namapegawai: 'Nama', namalengkap: 'Nama', pagu: 'PaguAwal', paguawal: 'PaguAwal', gol: 'Golongan', tgllahir: 'TanggalLahir', tanggallahir: 'TanggalLahir', nowa: 'NoWA', nohp: 'NoWA', kodeopd: 'OPD', subkegiatan: 'SubKegiatan', nilairp: 'Nilai', nilai: 'Nilai', jenisbiaya: 'Jenis' });
  let hi = -1, map = [];
  for (let i = 0; i < Math.min(aoa.length, 15); i++) { const m = aoa[i].map(h => peta[normKol(h)] || ''); if (m.filter(Boolean).length >= 2) { hi = i; map = m; break; } }
  if (hi < 0) throw new Error('Judul kolom tidak dikenali. Gunakan templat dari tombol "Unduh templat".');
  const kurang = cfg.kol.filter(k => k[2] && map.indexOf(k[0]) < 0).map(k => k[1]);
  if (kurang.length) throw new Error('Kolom wajib tidak ada: ' + kurang.join(', ') + '.');
  const rows = [], galat = [];
  for (let i = hi + 1; i < aoa.length; i++) {
    const a = aoa[i]; if (!a.some(v => String(v).trim() !== '')) continue;
    const o = { _baris: i + 1 }; let salah = '';
    map.forEach((k, c) => {
      if (!k) return; let v = a[c];
      if (TGL_IMPOR.indexOf(k) > -1) v = tglImpor(v);
      else if (TEKS_IMPOR.indexOf(k) > -1 && typeof v === 'number') {
        if (k === 'NIP' && v > Number.MAX_SAFE_INTEGER) salah = 'NIP terbaca sebagai angka sehingga digit terakhir hilang (' + v + '). Ubah format kolom NIP menjadi Teks lalu ketik ulang.';
        v = String(Math.round(v));
      } else if (v instanceof Date) v = tglImpor(v);
      else if (typeof v === 'string') v = v.trim();
      if (k === 'NoWA' && v && /^8/.test(String(v))) v = '0' + v;
      o[k] = v;
    });
    if (salah) galat.push({ baris: o._baris, status: 'galat', pesan: salah, _o: o }); else rows.push(o);
  }
  if (!rows.length && !galat.length) throw new Error('Sheet "Data" belum berisi baris.');
  return { rows: rows, galatKlien: galat };
}
ACT['imp.buka'] = el => {
  const sheet = el.dataset.s, cfg = IMPOR[sheet], st = { sheet: sheet };
  const kunciLbl = { Pegawai: 'NIP', Master_SBU: 'Jenis + Jenis Perjalanan + Tingkat + Wilayah + Berlaku Mulai', Pagu: 'OPD + Tahun + Kode Rekening + Jenis + Sub Kegiatan', Pejabat_TTD: 'OPD + Peran + Bidang + Berlaku Mulai' }[sheet];
  const m = modal({ title: 'Ekspor / Impor Excel — ' + e(cfg.nama), size: 'wide', body: `<div class="col gap16">
    <div class="grid g2"><div class="card pad-s"><div class="b small row gap8">${ic('download', 'sm pri-t')} 1. Unduh</div><div class="xs muted mt8">Templat berisi sheet <b>Data</b>, <b>Petunjuk</b> (arti tiap kolom + contoh) dan <b>Referensi</b> (kode OPD, peran, provinsi, bidang).</div>
      <div class="row wrap gap8 mt12"><button class="btn sec sm" data-act="imp.templat" data-s="${sheet}">${ic('description', 'sm')} Templat kosong</button><button class="btn sec sm" data-act="imp.templat" data-s="${sheet}" data-isi="1">${ic('table_view', 'sm')} Data saat ini (.xlsx)</button></div></div>
      <div class="card pad-s"><div class="b small row gap8">${ic('upload_file', 'sm pri-t')} 2. Unggah & periksa</div><div class="xs muted mt8">Format .xlsx / .xls / .csv, maks. 3.000 baris. Baris dengan kunci <b>${e(kunciLbl)}</b> yang sama diperbarui; lainnya ditambahkan.</div>
      <label class="btn pri sm mt12" style="width:max-content">${ic('attach_file', 'sm')} Pilih berkas…<input type="file" id="imp-file" accept=".xlsx,.xls,.csv" hidden></label></div></div>
    <div id="imp-hasil"><div class="callout info small">${ic('info', 'sm')}<div>Berkas diperiksa dulu (simulasi): tidak ada data yang tersimpan sebelum Anda menekan <b>Simpan</b>.</div></div></div></div>`,
    foot: `<button class="btn sec" data-x>Tutup</button><button class="btn pri" id="imp-simpan" disabled>${ic('save', 'sm')} Simpan</button>` });
  const box = $('#imp-hasil', m.el), tSimpan = $('#imp-simpan', m.el);
  const tampil = (r, galatKlien) => {
    const semua = r.hasil.concat(galatKlien).sort((a, b) => a.baris - b.baris), rg = Object.assign({}, r.ringkas); rg.galat += galatKlien.length;
    st.ok = rg.baru + rg.ubah; st.galat = rg.galat;
    const baris = n => st.rows.find(x => x._baris === n) || (galatKlien.find(g => g.baris === n) || {})._o || {};
    const lbl = o => cfg.kol.filter(k => k[2]).slice(0, 3).map(k => o[k[0]]).filter(v => v !== '' && v !== undefined).join(' · ');
    box.innerHTML = `<div class="row wrap gap8 mb12"><span class="pill ok">+${rg.baru} baru</span><span class="pill info">~${rg.ubah} diperbarui</span><span class="pill neu">=${rg.sama} tidak berubah</span>${rg.galat ? `<span class="pill bad">!${rg.galat} bermasalah</span>` : ''}</div>
      ${rg.galat ? `<label class="chk small mb12"><input type="checkbox" id="imp-lewati"> Lewati ${rg.galat} baris bermasalah dan simpan sisanya</label>` : ''}
      <div class="tbl-wrap" style="max-height:44vh"><table class="tbl compact"><thead><tr><th>Baris</th><th>Data</th><th>Hasil</th></tr></thead><tbody>${semua.slice(0, 500).map(h => `<tr><td class="mono xs">${h.baris}</td><td class="small">${e(lbl(baris(h.baris)))}</td>
        <td class="small">${h.status === 'galat' ? `<span class="bad-t">${e(h.pesan)}</span>` : h.status === 'baru' ? '<span class="ok-t b">Baru</span>' : h.status === 'ubah' ? `<span class="pri-t b">Diperbarui</span> <span class="xs muted">${e((h.kolom || []).join(', '))}</span>` : '<span class="muted">Tidak berubah</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${semua.length > 500 ? `<div class="xs muted mt8">Menampilkan 500 dari ${semua.length} baris.</div>` : ''}`;
    const cek = () => { tSimpan.disabled = !st.ok || (st.galat && !($('#imp-lewati', m.el) || {}).checked); };
    const lw = $('#imp-lewati', m.el); if (lw) lw.onchange = cek; cek();
    tSimpan.innerHTML = ic('save', 'sm') + ' Simpan ' + st.ok + ' baris';
  };
  $('#imp-file', m.el).onchange = async ev => {
    const file = ev.target.files[0]; if (!file) return;
    box.innerHTML = `<div class="row gap8 small muted">${ic('hourglass_top', 'sm')} Membaca & memeriksa ${e(file.name)}…</div>`; tSimpan.disabled = true;
    try {
      const b = await bacaBerkasImpor(file, sheet); st.rows = b.rows; st.galatKlien = b.galatKlien;
      if (b.rows.length > 3000) throw new Error('Berkas berisi ' + b.rows.length + ' baris; maksimal 3.000 per unggahan.');
      const r = b.rows.length ? (await api('master.impor', { sheet: sheet, rows: b.rows, dryRun: true })).data : { hasil: [], ringkas: { baru: 0, ubah: 0, sama: 0, galat: 0 } };
      tampil(r, b.galatKlien);
    } catch (err) { box.innerHTML = `<div class="callout bad small">${ic('error', 'sm')}<div>${e(err.message)}</div></div>`; }
    ev.target.value = '';
  };
  tSimpan.onclick = async ev => {
    try {
      await mutasi('master.impor', { sheet: sheet, rows: st.rows, lewatiGalat: !!($('#imp-lewati', m.el) || {}).checked }, { btn: ev.currentTarget });
      m.close();
    } catch (err) { /* toast sudah tampil */ }
  };
};
ACT['imp.templat'] = el => unduhTemplatImpor(el.dataset.s, el.dataset.isi === '1');
ACT['atur.csv'] = el => { const s = el.dataset.s, rows = S.D[s] || [], keys = rows.length ? Object.keys(rows[0]).filter(k => k.charAt(0) !== '_') : []; eksporXLSX(s + '_' + SJ.hariIni(), s, keys.map(k => [k, k]), rows, null); };
ACT['atur.user'] = el => {
  const u = SJ.one(S.D.Users, 'ID', el.dataset.id) || { Role: 'OPERATOR', Status: 'Aktif' };
  const m = modal({ title: u.ID ? 'Ubah pengguna' : 'Pengguna baru', size: 'wide', body: `<div class="fgrid c2">
    <div class="field"><label>Nama</label><input class="inp" id="us-Nama" value="${e(u.Nama || '')}"></div><div class="field"><label>Username</label><input class="inp" id="us-Username" value="${e(u.Username || '')}" autocapitalize="none"></div>
    <div class="field"><label>Peran</label><select class="sel" id="us-Role">${Object.keys(SJ.PERAN).map(k => `<option value="${k}" ${k === u.Role ? 'selected' : ''}>${e(SJ.PERAN[k])}</option>`).join('')}</select></div>
    <div class="field"><label>OPD (kosong = semua)</label><select class="sel" id="us-OPD"><option value="">—</option>${opdOpsi().map(o => `<option ${o === u.OPD ? 'selected' : ''}>${e(o)}</option>`).join('')}</select></div>
    <div class="field"><label>NIP (wajib untuk pelaksana)</label><input class="inp" id="us-NIP" value="${e(u.NIP || '')}" list="dl-nip"><datalist id="dl-nip">${S.D.Pegawai.map(p => `<option value="${p.NIP}">${e(SJ.namaLengkap(p))}</option>`).join('')}</datalist></div>
    <div class="field"><label>No. WhatsApp</label><input class="inp" id="us-NoWA" value="${e(u.NoWA || '')}"></div><div class="field"><label>Email</label><input class="inp" id="us-Email" value="${e(u.Email || '')}"></div>
    <div class="field"><label>Status</label><select class="sel" id="us-Status"><option ${u.Status === 'Aktif' ? 'selected' : ''}>Aktif</option><option ${u.Status === 'Nonaktif' ? 'selected' : ''}>Nonaktif</option></select></div>
    <div class="field span3"><label>${u.ID ? 'Reset kata sandi (kosongkan bila tidak diubah)' : 'Kata sandi awal'}</label><input class="inp" id="us-password" type="text" autocomplete="new-password" placeholder="min. 8 karakter, huruf & angka"><span class="hint">Pengguna diminta mengganti sandi setelah masuk.</span></div></div>`,
    foot: `<button class="btn sec" data-x>Batal</button><button class="btn pri" id="us-save">${ic('save', 'sm')} Simpan</button>` });
  $('#us-save', m.el).onclick = async ev => {
    const rec = { ID: u.ID || '' }; ['Nama', 'Username', 'Role', 'OPD', 'NIP', 'NoWA', 'Email', 'Status', 'password'].forEach(f => { rec[f] = $('#us-' + f, m.el).value; });
    try { await mutasi('users.simpan', rec, { btn: ev.currentTarget, ok: d => upsertRow('Users', d.record) }); m.close(); } catch (err) { /* toast */ }
  };
};
ACT['atur.cfg'] = async el => {
  const v = {}; ['APP_NAME', 'NAMA_PEMDA', 'TEMPAT_TERBIT_DEFAULT', 'WAJIB_PERSETUJUAN_ST', 'FRONTEND_URL', 'BACKUP_AKTIF', 'MODE_DEMO'].forEach(k => { v[k] = $('#cf-' + k).value; });
  await mutasi('config.simpan', { values: v }, { btn: el, ok: () => { Object.assign(S.cfg, v); simpanCache(); $('#brand-name').textContent = v.APP_NAME; refresh(); } }).catch(() => null);
};
ACT['atur.urlIni'] = () => { $('#cf-FRONTEND_URL').value = location.origin + location.pathname.replace(/index\.html$/, ''); };
ACT['atur.sys'] = async el => { sibuk(el, true); try { const r = await api(el.dataset.a, {}); toast(r.message || 'Selesai.', 'ok'); } catch (err) { toast(err.message, 'bad'); } finally { sibuk(el, false); } };
ACT['atur.lokal'] = () => { try { Object.keys(localStorage).filter(k => k.indexOf('sj_cache_') === 0).forEach(k => localStorage.removeItem(k)); } catch (err) { /* abaikan */ } toast('Cache perangkat dihapus; memuat ulang dari server…', 'info'); sinkron(false); };
// ---- Migrasi SI-JADIN lama → proyek PRO (per sheet, berurutan, dengan kemajuan) ----
ACT['mj.pindai'] = async el => {
  const j = S.pg.pengaturan.mj; j.sumber = $('#mj-src').value.trim(); if (!j.sumber) return toast('Masukkan URL/ID spreadsheet SI-JADIN lama.', 'warn');
  sibuk(el, true); try { j.pindai = (await api('migrasi.sijadinPindai', { sumber: j.sumber })).data; j.hasil = {}; refresh(); } catch (err) { toast(err.message, 'bad', 8000); } finally { sibuk(el, false); }
};
INP['mj.mode'] = el => { S.pg.pengaturan.mj.mode = el.value; };
ACT['mj.semua'] = async el => {
  const j = S.pg.pengaturan.mj, dry = !!el.dataset.dry, daftar = j.pindai.sheets.filter(x => x.sumber > 0);
  if (!daftar.length) return toast('Tidak ada baris untuk dipindahkan.', 'info');
  if (!dry && !(await konfirmasi(`Pindahkan <b>${daftar.length} sheet</b> dari "${e(j.pindai.judul)}" ke database aplikasi ini (mode: ${j.mode === 'perbarui' ? 'tambah + perbarui' : 'tambah saja'})? Database lama tidak diubah dan proses aman diulang.`, { ok: 'Jalankan migrasi' }))) return;
  j.hasil = {}; j.dry = dry; j.ke = 0;
  for (const x of daftar) {
    j.aktif = x.sheet; j.jalan = (dry ? 'Simulasi ' : 'Memindahkan ') + x.sheet + ' (' + (j.ke + 1) + '/' + daftar.length + ')…'; refresh();
    try { j.hasil[x.sheet] = (await api('migrasi.sijadin', { sumber: j.sumber, sheet: x.sheet, mode: j.mode, dryRun: dry }, { silent: true })).data; }
    catch (err) { j.hasil[x.sheet] = { error: err.message }; }
    j.ke++;
  }
  j.jalan = ''; j.aktif = '';
  const gagal = Object.keys(j.hasil).filter(n => j.hasil[n].error).length;
  toast(dry ? 'Simulasi selesai — belum ada data yang ditulis.' : gagal ? gagal + ' sheet gagal; perbaiki lalu jalankan ulang (aman diulang).' : 'Migrasi selesai. Memuat ulang data…', gagal ? 'warn' : 'ok', 7000);
  refresh();
  if (!dry) { try { j.pindai = (await api('migrasi.sijadinPindai', { sumber: j.sumber }, { silent: true })).data; } catch (err) { /* abaikan */ } sinkron(true, true); }
};
ACT['mig.pindai'] = async el => {
  const m = S.pg.pengaturan.mig; m.sumber = $('#mg-src').value.trim(); if (!m.sumber) return toast('Masukkan URL/ID spreadsheet lama.', 'warn');
  sibuk(el, true); try { m.hasil = (await api('migrasi.pindai', { sumber: m.sumber })).data; refresh(); } catch (err) { toast(err.message, 'bad', 8000); } finally { sibuk(el, false); }
};
INP['mig.sheet'] = el => { const r = S.pg.pengaturan.mig.hasil.rencana[Number(el.dataset.i)]; r.sumberSheet = el.value; r.peta = {}; r.hasil = null; refresh(); };
INP['mig.peta'] = el => { const r = S.pg.pengaturan.mig.hasil.rencana[Number(el.dataset.i)]; r.peta[el.dataset.k] = el.value; };
ACT['mig.jalan'] = async el => {
  const m = S.pg.pengaturan.mig, r = m.hasil.rencana[Number(el.dataset.i)], dry = !!el.dataset.dry;
  if (!dry && !(await konfirmasi(`Impor <b>${e(r.label)}</b> dari sheet "${e(r.sumberSheet)}"? Operasi idempoten — aman diulang.`, { ok: 'Jalankan impor' }))) return;
  sibuk(el, true);
  try { const res = (await api('migrasi.jalankan', { sumber: m.sumber, target: r.target, sumberSheet: r.sumberSheet, peta: r.peta, dryRun: dry })); r.hasil = res.data; if (res.data.rows) { S.D[r.target] = res.data.rows; simpanCache(); } toast(res.message, 'ok', 6000); refresh(); }
  catch (err) { toast(err.message, 'bad', 8000); } finally { sibuk(el, false); }
};

// =====================================================================
// PROFIL
// =====================================================================
PAGES.profil = {
  render(el) {
    const u = S.user;
    el.innerHTML = `<div class="ph"><div><h1>Profil Saya</h1><p>Informasi akun, keamanan, dan preferensi tampilan.</p></div></div><div class="split s6-6"><div class="card pad"><div class="row gap12">${avatar(u.Nama, 'lg gold')}<div><div class="bb lg-t">${e(u.Nama)}</div><div class="small muted">${e(u.Username)} · ${e(SJ.PERAN[u.Role] || u.Role)}${u.OPD ? ' · ' + e(u.OPD) : ''}</div>${u.NIP ? `<div class="xs mono muted">NIP ${e(SJ.fmtNip(u.NIP))}</div>` : ''}</div></div>
      ${u.Darurat ? `<div class="callout warn small mt16">${ic('emergency_home', 'sm')}<div><b>Anda masuk dengan akses darurat.</b> Gunakan hanya untuk memulihkan akses: buat atau perbaiki akun Superadmin di Pengaturan → Pengguna &amp; Peran, lalu keluar. Sandi darurat diganti dari editor Apps Script (fungsi <code>resetAksesDarurat</code>).</div></div>` : ''}
      ${u.WajibGantiSandi ? `<div class="callout gold small mt16">${ic('key', 'sm')}<div>Anda masih memakai kata sandi awal. Segera ganti.</div></div>` : ''}
      <hr class="sep"><div class="sec-title mb12">${ic('lock_reset', 'pri-t')} Ganti kata sandi</div><form id="pw-form" class="col gap12" autocomplete="off"><div class="field"><label for="pw-l">Kata sandi lama</label><input class="inp" id="pw-l" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pw-b">Kata sandi baru</label><input class="inp" id="pw-b" type="password" autocomplete="new-password"><span class="hint">Minimal 8 karakter, berisi huruf dan angka.</span></div><div class="field"><label for="pw-u">Ulangi kata sandi baru</label><input class="inp" id="pw-u" type="password" autocomplete="new-password"></div>
      <button class="btn pri" type="submit" id="pw-btn">${ic('save', 'sm')} Simpan kata sandi</button></form></div>
      <div class="col gap16"><div class="card pad"><div class="sec-title mb12">${ic('palette', 'pri-t')} Tampilan</div><div class="seg"><button class="${document.documentElement.getAttribute('data-theme') !== 'dark' ? 'on' : ''}" data-act="ui.theme">${ic('light_mode', 'sm')} Terang</button><button class="${document.documentElement.getAttribute('data-theme') === 'dark' ? 'on' : ''}" data-act="ui.theme">${ic('dark_mode', 'sm')} Gelap</button></div></div>
        <div class="card pad"><div class="sec-title mb12">${ic('install_mobile', 'pri-t')} Pasang di HP / komputer</div><p class="small muted" style="margin-top:0">SI-JADIN bisa dipasang seperti aplikasi: ikon di layar utama, terbuka layar penuh, dan langsung tampil dari cache perangkat.</p>${terpasang() ? '<div class="callout ok small">' + ic('check_circle', 'sm') + '<div>Sudah terpasang di perangkat ini.</div></div>' : `<button class="btn sec" data-act="ui.pwa">${ic('install_mobile', 'sm')} Pasang aplikasi</button>`}</div>
        <div class="card pad"><div class="sec-title mb12">${ic('sync', 'pri-t')} Data</div><div class="small muted">Sinkron terakhir: ${S.sync && S.sync.toTimeString ? e(SJ.fmtTgl(SJ.iso(S.sync)) + ', ' + S.sync.toTimeString().slice(0, 5)) : '—'}</div><button class="btn sec mt12" data-act="ui.sync">${ic('sync', 'sm')} Muat ulang dari server</button></div></div></div>`;
    $('#pw-form').onsubmit = async ev => {
      ev.preventDefault();
      const l = $('#pw-l').value, b = $('#pw-b').value, u2 = $('#pw-u').value;
      if (b !== u2) return toast('Ulangan kata sandi tidak sama.', 'bad');
      if (b.length < 8 || !/[A-Za-z]/.test(b) || !/\d/.test(b)) return toast('Kata sandi minimal 8 karakter berisi huruf dan angka.', 'bad');
      try {
        const d = await mutasi('auth.gantiSandi', { lama: l, baru: b }, { btn: $('#pw-btn') });
        if (d && d.token) { S.token = d.token; try { localStorage.setItem('sj_tok', S.token); } catch (x) { /* abaikan */ } }   // sesi baru; perangkat lain otomatis keluar
        S.user.WajibGantiSandi = false; simpanCache(); ev.target.reset(); refresh();
      } catch (err) { /* toast */ }
    };
  }
};
// ===== AKHIR BERKAS js/app.js =====
