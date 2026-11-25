/**
 * =====================================================================
 *  SI-JADIN — MODUL BERSAMA
 *  Satu sumber kebenaran (parts/dokumen.js) yang dipakai DUA sisi:
 *   1) Frontend : frontend/js/dokumen.js → pratinjau & hitung instan 0 ms.
 *   2) Backend  : Dokumen.gs (salinan identik) → PDF resmi & validasi server.
 *  Isi: terbilang, format tanggal/rupiah, lookup versi (SBU, konfigurasi
 *  hari, pejabat, kop, kode rekening), perhitungan rincian, checklist SPJ,
 *  rekap, laporan sisa anggaran, dan renderer dokumen A4.
 *  ATURAN: tanpa optional chaining (?.) / nullish (??) agar aman di GAS V8.
 * =====================================================================
 */
var SJ = (function () {
  'use strict';

  // ---------------------------------------------------------------
  // 1. UTILITAS UMUM
  // ---------------------------------------------------------------
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  function fmtAngka(n) {
    n = Math.round(num(n));
    var neg = n < 0; n = Math.abs(n);
    var s = String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + s;
  }
  function fmtRp(n) { return 'Rp ' + fmtAngka(n); }
  function fmtNip(nip) {
    var s = str(nip).replace(/\s/g, '');
    if (s.length === 18) return s.substr(0, 8) + ' ' + s.substr(8, 6) + ' ' + s.substr(14, 1) + ' ' + s.substr(15, 3);
    return s;
  }
  function namaLengkap(p) {
    if (!p) return '';
    var n = str(p.Nama);
    if (str(p.GelarDepan)) n = str(p.GelarDepan) + ' ' + n;
    if (str(p.GelarBelakang)) n = n + ', ' + str(p.GelarBelakang);
    return n;
  }
  function kapital(s) {
    return String(s).split(' ').map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' ');
  }
  function sum(arr, f) { var t = 0; (arr || []).forEach(function (x) { t += num(f ? f(x) : x); }); return t; }
  function by(arr, key, val) { return (arr || []).filter(function (r) { return String(r[key]) === String(val); }); }
  function one(arr, key, val) { var a = by(arr, key, val); return a.length ? a[0] : null; }
  function aktif(r) { var s = str(r.Status); return !s || s === 'Aktif'; }
  function parseJSON(s, def) { if (!s) return def; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return def; } }

  // ---------------------------------------------------------------
  // 2. TERBILANG (satu fungsi untuk semua kuitansi — PRD saran 3)
  // ---------------------------------------------------------------
  var SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function terbilangAngka(n) {
    n = Math.floor(Math.abs(num(n)));
    if (n < 12) return SATUAN[n];
    if (n < 20) return terbilangAngka(n - 10) + ' belas';
    if (n < 100) return terbilangAngka(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilangAngka(n % 10) : '');
    if (n < 200) return 'seratus' + (n - 100 ? ' ' + terbilangAngka(n - 100) : '');
    if (n < 1000) return terbilangAngka(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilangAngka(n % 100) : '');
    if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + terbilangAngka(n - 1000) : '');
    if (n < 1e6) return terbilangAngka(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilangAngka(n % 1000) : '');
    if (n < 1e9) return terbilangAngka(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilangAngka(n % 1e6) : '');
    if (n < 1e12) return terbilangAngka(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilangAngka(n % 1e9) : '');
    return terbilangAngka(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + terbilangAngka(n % 1e12) : '');
  }
  function terbilang(n) {
    n = Math.round(num(n));
    if (n === 0) return 'Nol Rupiah';
    return (n < 0 ? 'Minus ' : '') + kapital(terbilangAngka(n)) + ' Rupiah';
  }

  // ---------------------------------------------------------------
  // 3. TANGGAL (disimpan sebagai teks ISO yyyy-MM-dd)
  // ---------------------------------------------------------------
  function parseTgl(s) {
    if (!s) return null;
    if (Object.prototype.toString.call(s) === '[object Date]') return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function iso(d) {
    if (!d) return '';
    if (typeof d === 'string') return d.substr(0, 10);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function hariIni() { return iso(new Date()); }
  function tambahHari(s, n) { var d = parseTgl(s); if (!d) return ''; d.setDate(d.getDate() + n); return iso(d); }
  function selisihHari(a, b) { var x = parseTgl(a), y = parseTgl(b); if (!x || !y) return 0; return Math.round((y - x) / 86400000); }
  function lamaHari(a, b) { var d = selisihHari(a, b); return d < 0 ? 0 : d + 1; }
  function fmtTgl(s) { var d = parseTgl(s); return d ? d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear() : '-'; }
  function fmtTglPendek(s) { var d = parseTgl(s); return d ? pad(d.getDate()) + ' ' + BULAN_PENDEK[d.getMonth()] + ' ' + d.getFullYear() : '-'; }
  function namaHari(s) { var d = parseTgl(s); return d ? HARI[d.getDay()] : ''; }
  function romawi(s) { var d = parseTgl(s); return d ? ROMAWI[d.getMonth()] : ''; }
  function bulanKe(s) { var d = parseTgl(s); return d ? d.getMonth() + 1 : 0; }
  function tahunDari(s) { var d = parseTgl(s); return d ? d.getFullYear() : 0; }
  function rentangTgl(a, b) {
    var x = parseTgl(a), y = parseTgl(b);
    if (!x) return '-';
    if (!y || iso(x) === iso(y)) return fmtTgl(a);
    if (x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()) return x.getDate() + ' s.d. ' + fmtTgl(b);
    if (x.getFullYear() === y.getFullYear()) return x.getDate() + ' ' + BULAN[x.getMonth()] + ' s.d. ' + fmtTgl(b);
    return fmtTgl(a) + ' s.d. ' + fmtTgl(b);
  }
  function hariTanggal(a, b) {
    if (!b || a === b) return namaHari(a) + ', ' + fmtTgl(a);
    return namaHari(a) + ' s.d. ' + namaHari(b) + ', ' + rentangTgl(a, b);
  }
  function rentangOverlap(a1, b1, a2, b2) { return !(b1 < a2 || b2 < a1); }

  // ---------------------------------------------------------------
  // 4. KATALOG
  // ---------------------------------------------------------------
  var PERAN = {
    SUPERADMIN: 'Superadmin', OPERATOR: 'Operator', PELAKSANA: 'Pelaksana',
    VERIFIKATOR: 'Verifikator / Bendahara', PIMPINAN: 'Pimpinan / PPK'
  };
  var PERAN_PEJABAT = {
    KEPALA: 'Kepala (penanda tangan Surat Tugas)', SEKRETARIS: 'Sekretaris (a.n. Kepala, Surat Tugas)',
    PA: 'Pengguna Anggaran (PA)', KPA: 'Kuasa Pengguna Anggaran (KPA)', PPTK: 'PPTK (per bidang)',
    PPK: 'Pejabat Pembuat Komitmen', BENDAHARA: 'Bendahara Pengeluaran', PEMBANTU_BENDAHARA: 'Pembantu Bendahara Pengeluaran (PBP, per bidang)'
  };
  /** Peran yang boleh menandatangani tiap dokumen (pilihan di formulir). */
  var TTD_DOK = { ST: ['KEPALA', 'SEKRETARIS'], SPD: ['PA', 'KPA'] };
  var PERAN_BIDANG = ['PPTK', 'PEMBANTU_BENDAHARA'];
  var ALAT_ANGKUT = ['Kendaraan Dinas', 'Kendaraan Umum', 'Pesawat Udara', 'Kereta Api', 'Kapal Laut', 'Lainnya'];
  var PROVINSI = ['Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau', 'Jambi', 'Sumatera Selatan', 'Kepulauan Bangka Belitung', 'Bengkulu', 'Lampung', 'DKI Jakarta', 'Jawa Barat', 'Banten', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur', 'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur', 'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara', 'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara', 'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah', 'Papua Pegunungan', 'Papua Selatan'];
  var JENIS_JALAN = { DK: 'Dalam Kota', DB: 'Perjalanan Dinas Biasa' };
  /** Komponen biaya. tipe: lumpsum = nilai tetap SBU; atcost = sesuai riil maks plafon SBU. */
  var KOMPONEN = {
    UANG_HARIAN: { label: 'Uang Harian', satuan: 'OH', tipe: 'lumpsum', urut: 1, auto: true, templat: 'KWT_UH', rekap: 'uangHarian' },
    UANG_HARIAN_DIKLAT: { label: 'Uang Harian Diklat', satuan: 'OH', tipe: 'lumpsum', urut: 2, auto: true, templat: 'KWT_UH_DIKLAT', rekap: 'uangHarian' },
    TRANSPORT: { label: 'Transport', satuan: 'PP', tipe: 'lumpsum', urut: 3, auto: true, templat: 'KWT_TRANSPORT', rekap: 'tiket' },
    REPRESENTASI: { label: 'Representasi', satuan: 'OH', tipe: 'lumpsum', urut: 4, auto: true, templat: 'KWT_REPRESENTASI', rekap: 'representasi' },
    PENGINAPAN: { label: 'Penginapan', satuan: 'Malam', tipe: 'atcost', urut: 5, auto: true, templat: 'KWT_PENGINAPAN', rekap: 'penginapan' },
    TAKSI: { label: 'Sewa Taksi', satuan: 'Kali', tipe: 'atcost', urut: 6, auto: true, templat: 'KWT_TAKSI', rekap: 'taksi' },
    UANG_SAKU: { label: 'Uang Saku Peserta', satuan: 'OH', tipe: 'lumpsum', urut: 7, auto: false, templat: 'KWT_UMUM', rekap: 'uangSaku' },
    TIKET: { label: 'Tiket / e-Tol', satuan: 'PP', tipe: 'atcost', urut: 8, auto: false, templat: 'KWT_UMUM', rekap: 'tiket' },
    SEWA_KENDARAAN: { label: 'Sewa Kendaraan', satuan: 'Hari', tipe: 'atcost', urut: 9, auto: false, templat: 'KWT_UMUM', rekap: 'sewa' },
    BBM: { label: 'BBM', satuan: 'Liter', tipe: 'atcost', urut: 10, auto: false, templat: 'KWT_UMUM', rekap: 'bbm' },
    SWAB: { label: 'Swab', satuan: 'Kali', tipe: 'atcost', urut: 11, auto: false, templat: 'KWT_UMUM', rekap: 'swab' },
    LEMBUR: { label: 'Uang Lembur', satuan: 'Jam', tipe: 'lumpsum', urut: 12, auto: false, templat: 'KWT_UMUM', rekap: 'uangHarian' }
  };
  var TEMPLAT_LABEL = {
    ST: 'Surat Tugas', SPD_DB: 'SPD Perjalanan Dinas Biasa', SPD_DK: 'SPD Dalam Kota', RINCIAN: 'Rincian Perjalanan Dinas',
    KWT_UH: 'Kuitansi 1 — Uang Harian DK/DB', KWT_UH_DIKLAT: 'Kuitansi 2 — Uang Harian Diklat', KWT_TRANSPORT: 'Kuitansi 3 — Transport',
    KWT_REPRESENTASI: 'Kuitansi 4 — Representasi', KWT_PENGINAPAN: 'Kuitansi 5 — Penginapan', KWT_TAKSI_JABAR: 'Kuitansi 6 — Taksi Jawa Barat',
    KWT_TAKSI_LUAR: 'Kuitansi 7 — Taksi Luar Jawa Barat', KWT_UMUM: 'Kuitansi Umum (komponen lain)'
  };

  // ---------------------------------------------------------------
  // 5. LOOKUP BERVERSI (tanggal berlaku) — PRD 7.1, 7.11, 7.13
  // ---------------------------------------------------------------
  /** Ambil versi terbaru yang BerlakuMulai <= tgl dari baris yang lolos filter. */
  function versiTerbaru(rows, tgl) {
    var best = null;
    (rows || []).forEach(function (r) {
      if (!aktif(r)) return;
      var b = iso(r.BerlakuMulai) || '0000-00-00';
      if (tgl && b > tgl) return;
      if (r.BerlakuSampai && tgl && iso(r.BerlakuSampai) < tgl) return;
      if (!best || b >= (iso(best.BerlakuMulai) || '0000-00-00')) best = r;
    });
    return best;
  }
  function samaTeks(a, b) { return str(a).toLowerCase() === str(b).toLowerCase(); }
  function instansi(D, opd) { return one(D.Instansi, 'Kode', opd) || { Kode: opd, Nama: opd, NamaSingkat: opd }; }
  function kop(D, opd, tgl) {
    var k = versiTerbaru(by(D.Kop_OPD, 'OPD', opd), tgl) || {};
    var ins = instansi(D, opd);
    return {
      baris1: str(k.Baris1) || 'PEMERINTAH KABUPATEN CIANJUR', baris2: str(k.Baris2) || str(ins.Nama).toUpperCase(),
      baris3: str(k.Baris3), alamat: str(k.Alamat) || str(ins.Alamat), kontak: str(k.Kontak) || str(ins.Telepon),
      laman: str(k.Laman) || str(ins.Laman), logo: str(k.LogoFileId), kopImg: str(k.KopFileId)
    };
  }
  function pegawai(D, nip) { return one(D.Pegawai, 'NIP', nip); }
  /** Pejabat berversi per OPD + peran; PPTK/PBP dapat dibedakan per bidang (fallback: tanpa bidang → terbaru). */
  function pejabat(D, opd, peran, tgl, bidang) {
    var rows = (D.Pejabat_TTD || []).filter(function (r) { return r.OPD === opd && r.Peran === peran; });
    if (str(bidang)) {
      var b = versiTerbaru(rows.filter(function (r) { return samaTeks(r.Bidang, bidang); }), tgl);
      if (b) return b;
    }
    return versiTerbaru(rows.filter(function (r) { return !str(r.Bidang); }), tgl) || versiTerbaru(rows, tgl);
  }
  function pejabatById(D, id) { return one(D.Pejabat_TTD, 'ID', id); }
  /** Daftar pejabat yang boleh dipilih menandatangani dokumen ST/SPD (versi berlaku). */
  function pilihanTTD(D, opd, dok, tgl) {
    var out = [];
    (TTD_DOK[dok] || []).forEach(function (peran) {
      var rows = (D.Pejabat_TTD || []).filter(function (r) { return r.OPD === opd && r.Peran === peran; }), seen = {};
      rows.forEach(function (r) { var k = str(r.Bidang).toLowerCase(); if (seen[k]) return; seen[k] = 1; var v = versiTerbaru(rows.filter(function (x) { return str(x.Bidang).toLowerCase() === k; }), tgl); if (v) out.push(v); });
    });
    return out;
  }
  function bidangSPD(D, spd) { var p = one(D.Pagu, 'ID', spd && spd.PaguID); return p ? str(p.Bidang) : ''; }
  /** Tanggal lahir: kolom TanggalLahir, atau 8 digit pertama NIP (yyyymmdd) bila kosong. */
  function tglLahir(p) {
    if (!p) return '';
    var t = iso(p.TanggalLahir); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    var m = str(p.NIP).match(/^((?:19|20)\d{2})(\d{2})(\d{2})\d{10}$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31) return '';
    return m[1] + '-' + m[2] + '-' + m[3];
  }
  function pangkatGol(pangkat, gol) { pangkat = str(pangkat); gol = str(gol); return pangkat && gol ? pangkat + ', ' + gol : (pangkat || gol || '-'); }
  function ttdData(p) {
    if (!p) return { nama: '', nip: '', jabatan: '', pangkat: '', metode: 'Basah', img: '', peran: '', bidang: '' };
    return { id: p.ID, nama: str(p.Nama), nip: str(p.NIP), jabatan: str(p.Jabatan), pangkat: str(p.Pangkat), metode: str(p.Metode) || 'Basah', img: str(p.GambarFileId), peran: str(p.Peran), bidang: str(p.Bidang) };
  }
  /** Parameter perhitungan per OPD (OPD spesifik mengalahkan '*'). */
  function param(D, opd, nama, tgl, def) {
    var rows = (D.Pengaturan_Perhitungan || []).filter(function (r) { return r.Parameter === nama; });
    var spes = versiTerbaru(rows.filter(function (r) { return r.OPD === opd; }), tgl);
    var umum = versiTerbaru(rows.filter(function (r) { return r.OPD === '*' || !r.OPD; }), tgl);
    var r = spes || umum;
    if (!r) return def;
    return typeof def === 'number' ? num(r.Nilai) : str(r.Nilai);
  }
  function konfigHari(D, opd, komponen, tgl) {
    var rows = (D.Konfigurasi_Hari || []).filter(function (r) { return r.Komponen === komponen; });
    var r = versiTerbaru(rows.filter(function (x) { return x.OPD === opd; }), tgl) ||
      versiTerbaru(rows.filter(function (x) { return x.OPD === '*' || !x.OPD; }), tgl);
    return r ? { awal: num(r.HariAwal), akhir: num(r.HariAkhir), sisa: str(r.SisaJenis) || 'DIKLAT', id: r.ID }
      : { awal: 1, akhir: 1, sisa: 'DIKLAT', id: '' };
  }
  function rekening(D, opd, jenis, tgl) {
    var rows = (D.Kode_Rekening || []).filter(function (r) { return r.Jenis === jenis; });
    return versiTerbaru(rows.filter(function (r) { return r.OPD === opd; }), tgl) ||
      versiTerbaru(rows.filter(function (r) { return r.OPD === '*' || !r.OPD; }), tgl);
  }
  /** Tingkat biaya diturunkan dari golongan/eselon (PRD 7.1) — operator tidak mengisi manual. */
  function tingkatBiaya(D, p, opd, tgl) {
    if (!p) return 'D';
    var es = str(p.Eselon).toUpperCase().replace(/\s/g, ''), gol = str(p.Golongan).toUpperCase(), st = str(p.StatusPegawai).toUpperCase();
    if (/^II(\.|$|[AB])/.test(es)) return 'A';
    if (st === 'PPPK PARUH WAKTU') return param(D, opd, 'TINGKAT_PPPK_PARUH_WAKTU', tgl, 'C');
    if (st === 'PPPK') return param(D, opd, 'TINGKAT_PPPK', tgl, 'C');
    if (/^III(\.|$|[AB])/.test(es) || /^IV/.test(gol)) return 'B';
    if (/^IV(\.|$|[AB])/.test(es) || /^III/.test(gol)) return 'C';
    return 'D';
  }
  function isEselonII(p) { return !!p && /^II(\.|$|[AB])/.test(str(p.Eselon).toUpperCase().replace(/\s/g, '')); }
  /**
   * Cari SBU: versi terbaru per kunci (Jenis, JenisPerjalanan, Tingkat, Wilayah), lalu kunci paling spesifik.
   */
  function sbu(D, jenis, jp, tingkat, wilayah, tgl) {
    var groups = {};
    (D.Master_SBU || []).forEach(function (r) {
      if (r.Jenis !== jenis || !aktif(r)) return;
      var okJp = r.JenisPerjalanan === jp || r.JenisPerjalanan === 'Semua';
      var okT = r.Tingkat === tingkat || r.Tingkat === 'Semua';
      var okW = samaTeks(r.Wilayah, wilayah) || r.Wilayah === 'Semua';
      if (!okJp || !okT || !okW) return;
      var key = [r.JenisPerjalanan, r.Tingkat, str(r.Wilayah).toLowerCase()].join('|');
      (groups[key] = groups[key] || []).push(r);
    });
    var best = null, bestScore = -1;
    Object.keys(groups).forEach(function (k) {
      var v = versiTerbaru(groups[k], tgl);
      if (!v) return;
      var sc = (v.JenisPerjalanan === jp ? 4 : 0) + (v.Tingkat === tingkat ? 2 : 0) + (samaTeks(v.Wilayah, wilayah) ? 1 : 0);
      if (sc > bestScore) { best = v; bestScore = sc; }
    });
    return best;
  }
  /** Kode khusus: dasar diketik bebas oleh operator (nilai.teks). */
  var DASAR_BEBAS = 'BEBAS';
  function dasarTeks(D, opd, kode, nilai) {
    if (kode === DASAR_BEBAS) return str((nilai || {}).teks).replace(/\s+/g, ' ');
    var m = (D.Master_Dasar || []).filter(function (r) { return r.OPD === opd && r.Kode === kode && aktif(r); })[0] ||
      (D.Master_Dasar || []).filter(function (r) { return (r.OPD === '*' || !r.OPD) && r.Kode === kode && aktif(r); })[0];
    if (!m) return '';
    var ins = instansi(D, opd);
    var v = Object.assign({ NAMA_OPD: str(ins.Nama), NAMA_SINGKAT_OPD: str(ins.NamaSingkat) }, nilai || {});
    return String(m.Teks).replace(/\{([A-Za-z_]+)\}/g, function (all, k) {
      var val = v[k];
      if (k === 'tanggal' && /^\d{4}-\d{2}-\d{2}/.test(str(val))) val = fmtTgl(val);
      return val === undefined || val === '' ? '…' : val;
    });
  }
  function variabelDasar(D, opd, kode) {
    if (kode === DASAR_BEBAS) return ['teks'];
    var m = (D.Master_Dasar || []).filter(function (r) { return (r.OPD === opd || r.OPD === '*') && r.Kode === kode; })[0];
    if (!m) return [];
    return str(m.Variabel).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  /** Pilihan dropdown dasar ST: master dasar OPD + umum (*), dengan label teks yang mudah dibaca. */
  function pilihanDasar(D, opd) {
    var ins = instansi(D, opd), seen = {};
    return (D.Master_Dasar || []).filter(function (m) { return (m.OPD === opd || m.OPD === '*' || !m.OPD) && aktif(m); })
      .sort(function (a, b) { return (a.OPD === opd ? 0 : 1) - (b.OPD === opd ? 0 : 1) || num(a.UrutanDefault) - num(b.UrutanDefault); })
      .filter(function (m) { if (seen[m.Kode]) return false; seen[m.Kode] = 1; return true; })
      .map(function (m) {
        var t = String(m.Teks).replace(/\{NAMA_OPD\}/g, str(ins.Nama)).replace(/\{NAMA_SINGKAT_OPD\}/g, str(ins.NamaSingkat)).replace(/\{[A-Za-z_]+\}/g, '…');
        return { Kode: m.Kode, label: t.length > 110 ? t.slice(0, 107) + '…' : t, variabel: variabelDasar(D, opd, m.Kode) };
      });
  }
  function jabar(prov) { return /jawa\s*barat|jabar/i.test(str(prov)); }

  // ---------------------------------------------------------------
  // 6. PERHITUNGAN RINCIAN (PRD 7.4 & 16)
  // ---------------------------------------------------------------
  /** Pembagian hari DK/DB vs Diklat sesuai konfigurasi. */
  function splitHari(lama, adaDiklat, cfg) {
    lama = num(lama); var a = num(cfg.awal), z = num(cfg.akhir);
    var hariUtama = [], hariSisa = [], i;
    if (!adaDiklat || lama <= a + z) {
      for (i = 1; i <= lama; i++) hariUtama.push(i);
      return { utama: lama, sisa: 0, hariUtama: hariUtama, hariSisa: hariSisa };
    }
    for (i = 1; i <= lama; i++) { if (i <= a || i > lama - z) hariUtama.push(i); else hariSisa.push(i); }
    return { utama: hariUtama.length, sisa: hariSisa.length, hariUtama: hariUtama, hariSisa: hariSisa };
  }
  function konteksSPD(D, spd) {
    var tujuan = by(D.SPD_Tujuan, 'SPDID', spd.ID).sort(function (a, b) { return num(a.Urutan) - num(b.Urutan); });
    var diklat = one(D.SPD_Diklat, 'SPDID', spd.ID);
    var pengikut = by(D.SPD_Pengikut, 'SPDID', spd.ID).sort(function (a, b) { return num(a.Urutan) - num(b.Urutan); });
    var tgl = iso(spd.TglBerangkat);
    var lama = num(spd.LamaHari) || lamaHari(spd.TglBerangkat, spd.TglKembali);
    var prov = tujuan.length ? str(tujuan[0].Provinsi) : 'Jawa Barat';
    return { tujuan: tujuan, diklat: diklat, pengikut: pengikut, tgl: tgl, lama: lama, prov: prov, adaDiklat: str(spd.AdaDiklat) === 'YA' };
  }
  function anggotaSPD(D, spd) {
    var list = [{ NIP: spd.PelaksanaNIP, peran: 'Pelaksana', urut: 0 }];
    by(D.SPD_Pengikut, 'SPDID', spd.ID).sort(function (a, b) { return num(a.Urutan) - num(b.Urutan); })
      .forEach(function (p, i) { if (str(p.NIP)) list.push({ NIP: p.NIP, peran: 'Pengikut ' + (i + 1), urut: i + 1, nama: p.Nama }); });
    return list;
  }
  /**
   * Hitung komponen otomatis untuk satu orang. Komponen manual (tiket, BBM, dll.) tidak disentuh.
   * @return {Array} baris Rincian_Biaya tanpa ID
   */
  function hitungOtomatis(D, spd, nip) {
    var c = konteksSPD(D, spd), p = pegawai(D, nip), opd = spd.OPD, jp = spd.Jenis;
    var t = tingkatBiaya(D, p, opd, c.tgl), items = [];
    function tambah(komp, kat, vol, sb, ket) {
      if (vol <= 0) return;
      var harga = sb ? num(sb.Nilai) : 0;
      items.push({ SPDID: spd.ID, NIP: nip, Komponen: komp, Kategori: kat, Volume: vol, Satuan: KOMPONEN[komp].satuan,
        Harga: harga, Jumlah: vol * harga, NilaiRiil: '', NilaiDiakui: vol * harga, SBUID: sb ? sb.ID : '', Keterangan: ket || '' });
    }
    // Uang harian (split DK/DB vs Diklat)
    var sp = splitHari(c.lama, c.adaDiklat, konfigHari(D, opd, 'UANG_HARIAN', c.tgl));
    tambah('UANG_HARIAN', jp, sp.utama, sbu(D, 'UANG_HARIAN', jp, t, c.prov, c.tgl),
      sp.sisa ? 'Hari ke-' + sp.hariUtama.join(', ') : '');
    if (sp.sisa > 0) tambah('UANG_HARIAN_DIKLAT', 'DIKLAT', sp.sisa, sbu(D, 'UANG_HARIAN', 'DIKLAT', t, c.prov, c.tgl),
      'Hari ke-' + sp.hariSisa[0] + ' s.d. ke-' + sp.hariSisa[sp.hariSisa.length - 1]);
    // Representasi (hanya eselon II)
    if (isEselonII(p)) {
      var sr = splitHari(c.lama, c.adaDiklat, konfigHari(D, opd, 'REPRESENTASI', c.tgl));
      tambah('REPRESENTASI', jp, sr.utama, sbu(D, 'REPRESENTASI', jp, 'A', c.prov, c.tgl), sr.sisa ? 'Hari ke-' + sr.hariUtama.join(', ') : '');
      if (sr.sisa > 0) {
        var sd = sbu(D, 'REPRESENTASI', 'DIKLAT', 'A', c.prov, c.tgl);
        if (sd && sd.JenisPerjalanan === 'DIKLAT') tambah('REPRESENTASI', 'DIKLAT', sr.sisa, sd, 'Masa diklat');
      }
    }
    if (jp === 'DB') {
      // Penginapan: (lama - 1) malam, plafon SBU tingkat & provinsi
      if (c.lama > 1) tambah('PENGINAPAN', jp, c.lama - 1, sbu(D, 'PENGINAPAN', jp, t, c.prov, c.tgl), 'Plafon SBU');
      // Transport: hanya kendaraan umum / lainnya (PRD 19 no. 9)
      if (spd.AlatAngkut === 'Kendaraan Umum' || spd.AlatAngkut === 'Lainnya')
        tambah('TRANSPORT', jp, 1, sbu(D, 'TRANSPORT', jp, t, c.prov, c.tgl), 'Pergi-pulang');
      // Taksi: asal + tujuan bila menggunakan pesawat / kereta
      if (spd.AlatAngkut === 'Pesawat Udara' || spd.AlatAngkut === 'Kereta Api')
        tambah('TAKSI', jabar(c.prov) ? 'JABAR' : 'LUAR_JABAR', 2, sbu(D, 'TAKSI', jp, t, c.prov, c.tgl), 'Kota asal + kota tujuan');
    }
    return items;
  }
  /** Normalisasi satu baris rincian: hitung Jumlah & NilaiDiakui sesuai tipe komponen. */
  function normalisasiBaris(r) {
    var k = KOMPONEN[r.Komponen] || { tipe: 'atcost' };
    r.Volume = num(r.Volume); r.Harga = num(r.Harga);
    r.Jumlah = Math.round(r.Volume * r.Harga);
    var riil = r.NilaiRiil === '' || r.NilaiRiil === null || r.NilaiRiil === undefined ? null : num(r.NilaiRiil);
    if (k.tipe === 'lumpsum') r.NilaiDiakui = r.Jumlah;
    else r.NilaiDiakui = riil === null ? r.Jumlah : (r.Jumlah > 0 ? Math.min(riil, r.Jumlah) : riil);
    return r;
  }
  function rincianOrang(D, spdId, nip) {
    return (D.Rincian_Biaya || []).filter(function (r) { return r.SPDID === spdId && String(r.NIP) === String(nip); })
      .sort(function (a, b) { return (KOMPONEN[a.Komponen] || { urut: 99 }).urut - (KOMPONEN[b.Komponen] || { urut: 99 }).urut; });
  }
  function totalOrang(D, spdId, nip) { return sum(rincianOrang(D, spdId, nip), function (r) { return r.NilaiDiakui; }); }
  function totalSPD(D, spdId) { return sum(by(D.Rincian_Biaya, 'SPDID', spdId), function (r) { return r.NilaiDiakui; }); }
  function totalRiilSPD(D, spdId) {
    return sum(by(D.Rincian_Biaya, 'SPDID', spdId), function (r) {
      return r.NilaiRiil === '' || r.NilaiRiil === null || r.NilaiRiil === undefined ? r.Jumlah : r.NilaiRiil;
    });
  }

  /** Rencana kuitansi per orang: satu kuitansi per komponen yang dibayarkan (PRD 7.5). Urutan tetap (saran 8). */
  function rencanaKuitansi(D, spd, nip) {
    var c = konteksSPD(D, spd), groups = {};
    rincianOrang(D, spd.ID, nip).forEach(function (r) {
      if (num(r.NilaiDiakui) <= 0) return;
      // Templat "KWITANSI PEMBAYARAN UANG HARIAN DAN UANG HARIAN DIKLAT": satu kuitansi, rincian dua baris
      var key = r.Komponen === 'UANG_HARIAN_DIKLAT' ? 'UANG_HARIAN' : r.Komponen;
      var g = groups[key] = groups[key] || { Komponen: key, Nominal: 0, volume: 0, rows: [], parts: {} };
      g.Nominal += num(r.NilaiDiakui); g.volume += num(r.Volume); g.rows.push(r);
      g.parts[r.Komponen] = (g.parts[r.Komponen] || 0) + num(r.NilaiDiakui);
    });
    var p = pegawai(D, nip);
    return Object.keys(groups).map(function (k) {
      var g = groups[k], kp = KOMPONEN[k];
      if (k === 'REPRESENTASI' && !isEselonII(p)) return null; // pengaman ganda (kriteria penerimaan)
      var templat = kp.templat;
      if (k === 'TAKSI') templat = jabar(c.prov) ? 'KWT_TAKSI_JABAR' : 'KWT_TAKSI_LUAR';
      var rinc = k === 'UANG_HARIAN' ? { UANG_HARIAN: Math.round(g.parts.UANG_HARIAN || 0), UANG_HARIAN_DIKLAT: Math.round(g.parts.UANG_HARIAN_DIKLAT || 0) } : null;
      return { Komponen: k, Templat: templat, Nominal: Math.round(g.Nominal), Volume: g.volume, Uraian: uraianKuitansi(D, spd, c, k, g), Rincian: rinc, urut: kp.urut };
    }).filter(Boolean).sort(function (a, b) { return a.urut - b.urut; });
  }
  /** Kalimat "Untuk pembayaran" mengikuti templat kuitansi resmi. */
  function uraianKuitansi(D, spd, c, k, g) {
    var tujuan = c.tujuan.map(function (t) { return str(t.TempatTujuan); }).filter(Boolean).join(', ') || '-';
    var jenisTeks = spd.Jenis === 'DK' ? 'Dalam Kota' : 'Biasa';
    var vol = g.volume, kp = KOMPONEN[k] || { label: k, satuan: '' };
    var ekor = ' ke ' + tujuan + ' dalam rangka ' + (str(spd.Maksud) || '-') + ' pada Sub Kegiatan ' + (str(spd.SubKegiatan) || '-') +
      ' tanggal ' + fmtTgl(spd.TglBerangkat) + ' sampai dengan ' + fmtTgl(spd.TglKembali);
    switch (k) {
      case 'UANG_HARIAN': return 'Uang Harian Perjalanan Dinas ' + jenisTeks + ekor;
      case 'TRANSPORT': return 'Uang Transport Perjalanan Dinas ' + jenisTeks + ' (pergi-pulang)' + ekor;
      case 'REPRESENTASI': return 'Uang Representasi Perjalanan Dinas ' + jenisTeks + ' selama ' + vol + ' (' + terbilangAngka(vol) + ') hari' + ekor;
      case 'PENGINAPAN': return 'Biaya Penginapan Perjalanan Dinas ' + jenisTeks + ' di Provinsi ' + c.prov + ' selama ' + vol + ' (' + terbilangAngka(vol) + ') malam' + ekor;
      case 'TAKSI': return 'Sewa Taksi Perjalanan Dinas ' + jenisTeks + (jabar(c.prov) ? ' dalam Provinsi Jawa Barat' : ' di Provinsi ' + c.prov) + ' (kota asal dan kota tujuan)' + ekor;
      default: return kp.label + ' Perjalanan Dinas ' + jenisTeks + (vol ? ' (' + vol + ' ' + str(kp.satuan) + ')' : '') + ekor;
    }
  }

  // ---------------------------------------------------------------
  // 7. CHECKLIST SPJ (PRD 7.6) — dipakai klien (tampilan) & server (penegakan)
  // ---------------------------------------------------------------
  var BUKTI_WAJIB = { PENGINAPAN: 'Penginapan', TIKET: 'Tiket', TAKSI: 'Taksi', BBM: 'BBM', SEWA_KENDARAAN: 'Sewa Kendaraan', SWAB: 'Swab' };
  var JENIS_BUKTI = ['Tiket', 'Boarding Pass', 'Penginapan', 'Taksi', 'BBM', 'e-Tol', 'Sewa Kendaraan', 'Swab', 'Dokumentasi', 'SPD Bertanda Tangan', 'Lainnya'];
  function checklistSPJ(D, spd, manual) {
    manual = manual || {};
    var st = one(D.Surat_Tugas, 'ID', spd.STID);
    var anggota = anggotaSPD(D, spd);
    var bukti = by(D.SPJ_Bukti, 'SPDID', spd.ID);
    var items = [];
    items.push({ kode: 'ST', label: 'Surat Tugas terbit', ok: !!st && st.Status === 'Terbit', info: st ? str(st.Nomor) : 'Tidak ditemukan' });
    items.push({ kode: 'SPD', label: 'SPD terbit (depan & belakang)', ok: spd.Status === 'Terbit', info: str(spd.Nomor) });
    var rincOk = anggota.every(function (a) { return totalOrang(D, spd.ID, a.NIP) > 0; });
    items.push({ kode: 'RINCIAN', label: 'Rincian biaya seluruh pelaksana & pengikut', ok: rincOk, info: anggota.length + ' orang' });
    var kurang = [];
    anggota.forEach(function (a) {
      rencanaKuitansi(D, spd, a.NIP).forEach(function (rk) {
        var ada = (D.Kuitansi || []).filter(function (k) {
          return k.SPDID === spd.ID && String(k.NIP) === String(a.NIP) && k.Komponen === rk.Komponen && k.Status !== 'Batal';
        })[0];
        if (!ada || Math.round(num(ada.Nominal)) !== rk.Nominal) kurang.push((KOMPONEN[rk.Komponen] || {}).label + ' – ' + (namaLengkap(pegawai(D, a.NIP)) || a.NIP));
      });
    });
    items.push({ kode: 'KUITANSI', label: 'Kuitansi per komponen terbit & sesuai nominal', ok: kurang.length === 0, info: kurang.length ? 'Belum/berbeda: ' + kurang.join('; ') : 'Lengkap' });
    var perluBukti = {};
    by(D.Rincian_Biaya, 'SPDID', spd.ID).forEach(function (r) { if (BUKTI_WAJIB[r.Komponen] && num(r.NilaiDiakui) > 0) perluBukti[BUKTI_WAJIB[r.Komponen]] = true; });
    var jenisAda = {}; bukti.forEach(function (b) { jenisAda[b.Jenis] = true; if (b.Jenis === 'Boarding Pass') jenisAda.Tiket = true; if (b.Jenis === 'e-Tol') jenisAda.BBM = true; });
    var buktiKurang = Object.keys(perluBukti).filter(function (j) { return !jenisAda[j]; });
    items.push({ kode: 'BUKTI', label: 'Bukti pengeluaran diunggah', ok: bukti.length > 0 && buktiKurang.length === 0,
      info: bukti.length + ' berkas' + (buktiKurang.length ? ' — kurang: ' + buktiKurang.join(', ') : '') });
    var auto = items.every(function (i) { return i.ok; });
    var manualItems = [
      { kode: 'M_TTD', label: 'Tanda tangan basah & nama/NIP lengkap pada seluruh dokumen' },
      { kode: 'M_PENGESAHAN', label: 'Pengesahan tiba/berangkat di halaman belakang SPD' },
      { kode: 'M_KEWAJARAN', label: 'Kewajaran nilai riil terhadap bukti' }
    ].map(function (m) { m.ok = !!manual[m.kode]; m.manual = true; return m; });
    return { items: items, manual: manualItems, autoLengkap: auto, lengkap: auto && manualItems.every(function (m) { return m.ok; }) };
  }

  // ---------------------------------------------------------------
  // 8. BUILDER DATA DOKUMEN (dipakai untuk pratinjau draf & snapshot terbit)
  // ---------------------------------------------------------------
  function docST(D, st, dasarRows, nipList) {
    var opd = st.OPD, tgl = iso(st.TanggalTerbit) || hariIni();
    var pj = pejabatById(D, st.PenandatanganID) || pejabat(D, opd, 'KEPALA', tgl);
    var ttd = ttdData(pj);
    if (pj && pj.Peran === 'SEKRETARIS') {   // a.n. Kepala — Sekretaris
      var ka = pejabat(D, opd, 'KEPALA', tgl);
      ttd.an = 'a.n. ' + (ka && str(ka.Jabatan) ? str(ka.Jabatan) : 'Kepala ' + str(instansi(D, opd).Nama));
    }
    var pegList = (nipList || []).map(function (nip) {
      var p = pegawai(D, nip) || { NIP: nip, Nama: nip };
      return { nama: namaLengkap(p), nip: str(p.NIP), pangkat: str(p.Pangkat), golongan: str(p.Golongan), pangkatGol: pangkatGol(p.Pangkat, p.Golongan), jabatan: str(p.Jabatan), unit: str(p.UnitKerja) };
    });
    var lama = lamaHari(st.TanggalMulai, st.TanggalSelesai);
    return {
      jenis: 'ST', opd: opd, kop: kop(D, opd, tgl), nomor: str(st.Nomor) || '…/…/' + str(instansi(D, opd).NamaSingkat || opd) + '/' + romawi(tgl) + '/' + tahunDari(tgl),
      dasar: (dasarRows || []).map(function (d) { return d.Teks || dasarTeks(D, opd, d.Kode, parseJSON(d.NilaiVariabel, {})); }).filter(Boolean),
      pegawai: pegList, kegiatan: str(st.Kegiatan), mulai: iso(st.TanggalMulai), selesai: iso(st.TanggalSelesai), lama: lama,
      hariTanggal: st.TanggalMulai ? hariTanggal(iso(st.TanggalMulai), iso(st.TanggalSelesai)) : '-', tempat: str(st.Tempat),
      tempatTerbit: str(st.TempatTerbit) || 'Cianjur', tanggalTerbit: tgl, ttd: ttd, kode: str(st.KodeVerifikasi)
    };
  }
  function docSPD(D, spd) {
    var c = konteksSPD(D, spd), opd = spd.OPD, tgl = iso(spd.TanggalTetap) || c.tgl || hariIni();
    var st = one(D.Surat_Tugas, 'ID', spd.STID) || {};
    var p = pegawai(D, spd.PelaksanaNIP) || { NIP: spd.PelaksanaNIP };
    var rek = rekening(D, opd, spd.Jenis, c.tgl) || {};
    var ins = instansi(D, opd);
    var pj = pejabatById(D, spd.PenandatanganID);
    if (!pj || TTD_DOK.SPD.indexOf(pj.Peran) < 0) pj = pejabat(D, opd, 'PA', tgl) || pejabat(D, opd, 'KPA', tgl);
    var pa = ttdData(pj); pa.label = pa.peran === 'KPA' ? 'Kuasa Pengguna Anggaran' : 'Pengguna Anggaran';
    return {
      jenis: 'SPD', jenisJalan: spd.Jenis, opd: opd, kop: kop(D, opd, tgl), nomor: str(spd.Nomor) || '(nomor terbit otomatis)',
      pa: pa, ppk: ttdData(pejabat(D, opd, 'PPK', tgl)), singkatOPD: str(ins.NamaSingkat) || opd, kota: str(ins.Kota) || 'Cianjur',
      pelaksana: { nama: namaLengkap(p), nip: str(p.NIP), pangkat: str(p.Pangkat), golongan: str(p.Golongan), pangkatGol: pangkatGol(p.Pangkat, p.Golongan), jabatan: str(p.Jabatan), instansi: str(ins.Nama), tingkat: tingkatBiaya(D, p, opd, c.tgl) },
      maksud: str(spd.Maksud), alat: str(spd.AlatAngkut), berangkat: str(spd.TempatBerangkat) || 'Cianjur',
      tujuan: c.tujuan.map(function (t) { return { tempat: str(t.TempatTujuan), kab: str(t.KabKota), prov: str(t.Provinsi), tiba: iso(t.TglTiba), brkt: iso(t.TglBerangkat), pengesah: str(t.PejabatPengesah) }; }),
      lama: c.lama, tglBerangkat: iso(spd.TglBerangkat), tglKembali: iso(spd.TglKembali),
      pengikut: c.pengikut.map(function (x) { var pg = pegawai(D, x.NIP); return { nama: pg ? namaLengkap(pg) : str(x.Nama), nip: str(x.NIP), ket: str(x.Keterangan), tglLahir: tglLahir(pg || { NIP: x.NIP }) }; }),
      maksPengikut: param(D, opd, 'MAKS_PENGIKUT', c.tgl, 6),
      skpd: str(ins.KodeSKPD) + ' ' + str(ins.Nama), kodeRek: str(spd.KodeRekening) || str(rek.Kode), uraianRek: str(spd.UraianRekening) || str(rek.Uraian),
      subKegiatan: str(spd.SubKegiatan), diklat: c.diklat ? { nama: str(c.diklat.NamaDiklat), penyelenggara: str(c.diklat.Penyelenggara), mulai: iso(c.diklat.TglMulai), selesai: iso(c.diklat.TglSelesai) } : null,
      keterangan: str(spd.Keterangan), nomorST: str(st.Nomor), tanggalST: iso(st.TanggalTerbit),
      tempatTetap: str(spd.TempatTetap) || 'Cianjur', tanggalTetap: tgl, kode: str(spd.KodeVerifikasi)
    };
  }
  function docRincian(D, spd, nip) {
    var c = konteksSPD(D, spd), opd = spd.OPD, p = pegawai(D, nip) || { NIP: nip };
    var rows = rincianOrang(D, spd.ID, nip).map(function (r) {
      var k = KOMPONEN[r.Komponen] || { label: r.Komponen };
      return { komponen: r.Komponen, label: k.label + (r.Kategori === 'DIKLAT' && r.Komponen !== 'UANG_HARIAN_DIKLAT' ? ' (Diklat)' : ''),
        volume: num(r.Volume), satuan: str(r.Satuan), harga: num(r.Harga), jumlah: num(r.Jumlah), riil: r.NilaiRiil === '' ? null : num(r.NilaiRiil), diakui: num(r.NilaiDiakui), ket: str(r.Keterangan) };
    });
    var total = sum(rows, function (r) { return r.diakui; });
    var bayar = (D.Pembayaran || []).filter(function (b) { return b.SPDID === spd.ID && String(b.NIP) === String(nip); })[0];
    var dibayar = bayar ? num(bayar.NilaiDibayar) : 0;
    var tiket = (D.Tiket || []).filter(function (t) { return t.SPDID === spd.ID && String(t.NIP) === String(nip); });
    var inap = (D.Penginapan || []).filter(function (t) { return t.SPDID === spd.ID && String(t.NIP) === String(nip); });
    var tgl = iso(spd.TanggalTetap) || c.tgl;
    return {
      jenis: 'RINCIAN', opd: opd, kop: kop(D, opd, tgl), nomorSPD: str(spd.Nomor) || '(draf)', tanggalSPD: tgl,
      orang: { nama: namaLengkap(p), nip: str(p.NIP), jabatan: str(p.Jabatan), pangkat: str(p.Pangkat), golongan: str(p.Golongan) },
      tujuan: c.tujuan.map(function (t) { return str(t.TempatTujuan); }).join(', '), lama: c.lama,
      rows: rows, total: total, terbilang: terbilang(total), ditetapkan: total, dibayar: dibayar, sisa: total - dibayar,
      tiket: tiket.map(function (t) { return { arah: str(t.Arah), maskapai: str(t.Maskapai), nama: str(t.NamaPenumpang), nomor: str(t.NomorTiket), booking: str(t.KodeBooking), flight: str(t.NomorPenerbangan), asal: str(t.Asal), tujuan: str(t.Tujuan), tanggal: iso(t.Tanggal), kelas: str(t.Kelas), harga: num(t.Harga) }; }),
      penginapan: inap.map(function (t) { return { nama: str(t.NamaPenginapan), malam: num(t.Malam), harga: num(t.Harga), ket: str(t.Keterangan) }; }),
      bendahara: ttdData(pejabat(D, opd, 'BENDAHARA', tgl)), ppk: ttdData(pejabat(D, opd, 'PPK', tgl)), pa: ttdData(pejabat(D, opd, 'PA', tgl))
    };
  }
  /** Data kuitansi dari rencana (draf) atau baris kuitansi terbit. */
  function docKuitansi(D, spd, nip, rk, kwtRow) {
    var c = konteksSPD(D, spd), opd = spd.OPD, p = pegawai(D, nip) || { NIP: nip };
    var tglBayar = kwtRow ? iso(kwtRow.TanggalBayar) : hariIni();
    var ins = instansi(D, opd), bidang = bidangSPD(D, spd);
    var sp = splitHari(c.lama, c.adaDiklat, konfigHari(D, opd, 'UANG_HARIAN', c.tgl));
    var tglUH = sp.hariUtama.map(function (h) { return fmtTgl(tambahHari(c.tgl, h - 1)); });
    // Penanda tangan "Mengetahui" = PA/KPA yang dipilih di SPD; PPTK & PBP mengikuti bidang pagu
    var pj = pejabatById(D, spd.PenandatanganID);
    if (!pj || TTD_DOK.SPD.indexOf(pj.Peran) < 0) pj = pejabat(D, opd, 'PA', tglBayar) || pejabat(D, opd, 'KPA', tglBayar);
    var pa = ttdData(pj); pa.label = pa.peran === 'KPA' ? 'Kuasa Pengguna Anggaran' : 'Pengguna Anggaran';
    var kp = KOMPONEN[rk.Komponen] || { label: rk.Komponen };
    var rincian = rk.Rincian ? [['UANG HARIAN', num(rk.Rincian.UANG_HARIAN)], ['UANG HARIAN DIKLAT', num(rk.Rincian.UANG_HARIAN_DIKLAT)]]
      : [[str(kp.label).toUpperCase(), rk.Nominal]];
    return {
      jenis: 'KUITANSI', templat: rk.Templat, komponen: rk.Komponen, opd: opd, kop: kop(D, opd, tglBayar), namaOPD: str(ins.Nama), singkatOPD: str(ins.NamaSingkat),
      pemda: 'KABUPATEN ' + (str(ins.Kota) || 'Cianjur').toUpperCase(), kota: str(ins.Kota) || 'Cianjur', bidang: bidang,
      nomor: kwtRow ? str(kwtRow.Nomor) : '(nomor terbit otomatis)', tanggalBayar: tglBayar, kodeRek: str(spd.KodeRekening),
      nominal: rk.Nominal, terbilang: terbilang(rk.Nominal), uraian: kwtRow && kwtRow.Uraian ? str(kwtRow.Uraian) : rk.Uraian, rincian: rincian,
      uraianJenis: spd.Jenis === 'DK' ? 'Dalam Kota' : 'Biasa', subKegiatan: str(spd.SubKegiatan), maksud: str(spd.Maksud),
      tujuan: c.tujuan.length ? c.tujuan.map(function (t) { return str(t.TempatTujuan); }).join(', ') : '', kab: c.tujuan.length ? str(c.tujuan[0].KabKota) : '', prov: c.prov,
      tglBerangkat: iso(spd.TglBerangkat), tglKembali: iso(spd.TglKembali), lama: c.lama, tglUH: tglUH.join(', '),
      diklat: c.diklat ? { nama: str(c.diklat.NamaDiklat), mulai: iso(c.diklat.TglMulai), selesai: iso(c.diklat.TglSelesai) } : null,
      penerima: { nama: namaLengkap(p), nip: str(p.NIP), jabatan: str(p.Jabatan) },
      pa: pa, pptk: ttdData(pejabat(D, opd, 'PPTK', tglBayar, bidang)),
      bendahara: ttdData(pejabat(D, opd, 'BENDAHARA', tglBayar)), pembantu: ttdData(pejabat(D, opd, 'PEMBANTU_BENDAHARA', tglBayar, bidang)),
      kode: kwtRow ? str(kwtRow.KodeVerifikasi) : ''
    };
  }

  // ---------------------------------------------------------------
  // 9. REKAP (PRD 7.8) & LAPORAN SISA ANGGARAN (PRD 7.10)
  // ---------------------------------------------------------------
  var REKAP_KOLOM = [
    ['no', 'No'], ['bulan', 'Bulan'], ['kodeRek', 'Kode Rekening'], ['uraian', 'Uraian'], ['tempatTujuan', 'Nama Kantor / Tempat Tujuan'],
    ['kotaTujuan', 'Kota / Kabupaten Tujuan'], ['nama', 'Nama Pelaksana'], ['nip', 'NIP'], ['jabatan', 'Jabatan'], ['skpd', 'SKPD'],
    ['uangHarian', 'Uang Harian'], ['representasi', 'Representasi'], ['uangSaku', 'Uang Saku Peserta'], ['penginapan', 'Penginapan'],
    ['tiket', 'Tiket / e-Tol'], ['taksi', 'Taksi'], ['sewa', 'Sewa Kendaraan'], ['bbm', 'BBM'], ['swab', 'Swab'], ['total', 'Jumlah Total'],
    ['nomorSPD', 'Nomor SPPD'], ['lama', 'Lama Perjalanan'], ['tglBerangkat', 'Tanggal Berangkat'], ['tglKembali', 'Tanggal Kembali'],
    ['tiketBerangkat', 'Tiket Berangkat'], ['tiketKembali', 'Tiket Kembali'], ['penginapanNama', 'Nama Penginapan'], ['keterangan', 'Keterangan']
  ];
  var REKAP_UANG = ['uangHarian', 'representasi', 'uangSaku', 'penginapan', 'tiket', 'taksi', 'sewa', 'bbm', 'swab', 'total'];
  function rekap(D) {
    var rows = [];
    (D.SPD || []).filter(function (s) { return s.Status === 'Terbit'; })
      .sort(function (a, b) { return iso(a.TglBerangkat) < iso(b.TglBerangkat) ? -1 : 1; })
      .forEach(function (spd) {
        var c = konteksSPD(D, spd), spj = one(D.SPJ, 'SPDID', spd.ID), ins = instansi(D, spd.OPD);
        anggotaSPD(D, spd).forEach(function (a) {
          var p = pegawai(D, a.NIP) || {}, r = { uangHarian: 0, representasi: 0, uangSaku: 0, penginapan: 0, tiket: 0, taksi: 0, sewa: 0, bbm: 0, swab: 0 };
          rincianOrang(D, spd.ID, a.NIP).forEach(function (x) { var k = KOMPONEN[x.Komponen]; if (k) r[k.rekap] += num(x.NilaiDiakui); });
          var tk = (D.Tiket || []).filter(function (t) { return t.SPDID === spd.ID && String(t.NIP) === String(a.NIP); });
          function tinfo(arah) { var t = tk.filter(function (x) { return x.Arah === arah; })[0]; return t ? [t.Maskapai, t.NomorPenerbangan, t.KodeBooking, t.Asal + '-' + t.Tujuan, fmtTglPendek(t.Tanggal), fmtRp(t.Harga)].filter(function (v) { return str(v); }).join(' / ') : ''; }
          var inap = (D.Penginapan || []).filter(function (t) { return t.SPDID === spd.ID && String(t.NIP) === String(a.NIP); }).map(function (t) { return t.NamaPenginapan; }).join(', ');
          var row = {
            spdId: spd.ID, opd: spd.OPD, tahun: tahunDari(spd.TglBerangkat), bulanNum: bulanKe(spd.TglBerangkat), jenis: spd.Jenis,
            diklat: c.adaDiklat ? 'YA' : 'TIDAK', statusSPJ: spj ? spj.Status : 'Belum Diunggah', paguId: spd.PaguID, subKegiatan: str(spd.SubKegiatan), nipRaw: str(a.NIP),
            bulan: BULAN[bulanKe(spd.TglBerangkat) - 1] || '', kodeRek: str(spd.KodeRekening), uraian: str(spd.UraianRekening),
            tempatTujuan: c.tujuan.map(function (t) { return t.TempatTujuan; }).join('; '), kotaTujuan: c.tujuan.map(function (t) { return t.KabKota; }).join('; '),
            nama: namaLengkap(p) || a.nama || a.NIP, nip: fmtNip(a.NIP), jabatan: str(p.Jabatan), skpd: str(ins.NamaSingkat || ins.Nama),
            nomorSPD: str(spd.Nomor), lama: c.lama, tglBerangkat: iso(spd.TglBerangkat), tglKembali: iso(spd.TglKembali),
            tiketBerangkat: tinfo('Berangkat'), tiketKembali: tinfo('Kembali'), penginapanNama: inap,
            keterangan: [a.peran, c.adaDiklat && c.diklat ? 'Diklat: ' + c.diklat.NamaDiklat : '', 'SPJ: ' + (spj ? spj.Status : 'Belum Diunggah')].filter(Boolean).join(' · ')
          };
          Object.keys(r).forEach(function (k) { row[k] = r[k]; });
          row.total = sum(['uangHarian', 'representasi', 'uangSaku', 'penginapan', 'tiket', 'taksi', 'sewa', 'bbm', 'swab'], function (k) { return row[k]; });
          rows.push(row);
        });
      });
    rows.forEach(function (r, i) { r.no = i + 1; });
    return rows;
  }
  /** Realisasi per pagu dari SPJ terverifikasi (tanggal verifikasi menentukan periode). */
  function laporan(D, f) {
    f = f || {};
    var th = num(f.tahun), b1 = num(f.bulanMulai) || 1, b2 = num(f.bulanSelesai) || 12;
    var spdMap = {}; (D.SPD || []).forEach(function (s) { spdMap[s.ID] = s; });
    return (D.Pagu || []).filter(function (p) {
      if (!aktif(p)) return false;
      if (th && num(p.Tahun) !== th) return false;
      if (f.opd && f.opd !== 'Semua' && p.OPD !== f.opd) return false;
      if (f.kodeRek && p.KodeRekening !== f.kodeRek) return false;
      if (f.jenis && f.jenis !== 'Semua' && p.JenisPerjalanan !== f.jenis) return false;
      return true;
    }).map(function (p) {
      var lalu = 0, ini = 0, pending = 0, jumlahSPJ = 0;
      (D.SPJ || []).forEach(function (s) {
        var spd = spdMap[s.SPDID]; var pid = s.PaguID || (spd && spd.PaguID);
        if (pid !== p.ID) return;
        if (s.Status === 'Diverifikasi') {
          var bl = bulanKe(s.TanggalVerifikasi), t = tahunDari(s.TanggalVerifikasi);
          if (th && t !== th) return;
          jumlahSPJ++;
          if (bl < b1) lalu += num(s.TotalDiakui); else if (bl <= b2) ini += num(s.TotalDiakui);
        } else if (s.Status === 'Lengkap') {
          pending += spd ? totalSPD(D, spd.ID) : num(s.TotalDiakui);
        }
      });
      var pagu = num(p.PaguAwal), total = lalu + ini, sisa = pagu - total, persen = pagu > 0 ? total / pagu * 100 : 0;
      var status = sisa <= 0 ? 'Habis' : (persen >= 90 ? 'Waspada' : 'Aman');
      return { id: p.ID, opd: p.OPD, tahun: num(p.Tahun), kodeRek: str(p.KodeRekening), jenis: str(p.JenisPerjalanan), subKegiatan: str(p.SubKegiatan),
        kegiatan: str(p.Kegiatan), pagu: pagu, lalu: lalu, ini: ini, total: total, sisa: sisa, persen: persen, status: status, pending: pending, jumlahSPJ: jumlahSPJ };
    });
  }
  /**
   * Sisa pagu + anggaran kas & SPD (Surat Penyediaan Dana) per triwulan.
   * Realisasi = SPJ terverifikasi; triwulan mengikuti tanggal berangkat SPD.
   */
  function sisaPagu(D, paguId) {
    var p = one(D.Pagu, 'ID', paguId); if (!p) return null;
    var tw = [1, 2, 3, 4].map(function (q) { return { tw: q, kas: num(p['AnggaranKasTW' + q]), spd: num(p['SPDTW' + q]), real: 0 }; });
    var real = 0;
    (D.SPJ || []).forEach(function (s) {
      if (s.Status !== 'Diverifikasi') return;
      var spd = one(D.SPD, 'ID', s.SPDID);
      if (s.PaguID ? s.PaguID !== paguId : !(spd && spd.PaguID === paguId)) return;
      var v = num(s.TotalDiakui); real += v;
      var m = spd ? bulanKe(spd.TglBerangkat) : 0; tw[m ? Math.floor((m - 1) / 3) : 0].real += v;
    });
    var kumSpd = 0, kumReal = 0;
    tw.forEach(function (t) { kumSpd += t.spd; kumReal += t.real; t.spdKum = kumSpd; t.realKum = kumReal; t.sisaSpdKum = kumSpd - kumReal; });
    return { pagu: num(p.PaguAwal), realisasi: real, sisa: num(p.PaguAwal) - real, persen: num(p.PaguAwal) ? real / num(p.PaguAwal) * 100 : 0,
      bidang: str(p.Bidang), tw: tw, totalKas: sum(tw, function (t) { return t.kas; }), totalSpd: kumSpd };
  }
  function triwulan(tgl) { var m = bulanKe(tgl); return m ? Math.floor((m - 1) / 3) + 1 : 0; }

  // ---------------------------------------------------------------
  // 10. RENDERER DOKUMEN A4 (HTML) — dipakai pratinjau & PDF server
  //     opts.img(fileId) → src gambar, opts.qr(teks) → src QR, opts.verifyUrl
  // ---------------------------------------------------------------
  var EMBLEM = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 76"><path d="M32 2 L60 12 V38 C60 56 46 68 32 74 C18 68 4 56 4 38 V12 Z" fill="#1b4332" stroke="#d4a017" stroke-width="3"/><path d="M32 16 L44 28 L32 40 L20 28 Z" fill="#d4a017"/><rect x="18" y="46" width="28" height="4" rx="2" fill="#a5d0b9"/><rect x="22" y="54" width="20" height="4" rx="2" fill="#a5d0b9"/></svg>');
  /** Lambang Kabupaten Cianjur (dari templat resmi) — dipakai bila OPD belum mengunggah logo. */
  var LAMBANG = 'data:image/png;base64,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';
  var CSS = [
    '.dk-page{box-sizing:border-box;width:210mm;min-height:297mm;padding:16mm 18mm 16mm 22mm;background:#fff;color:#000;font-family:"Times New Roman",Times,serif;font-size:11.5pt;line-height:1.38;position:relative;margin:0 auto}',
    '.dk-page.landscape{width:297mm;min-height:210mm;padding:12mm 12mm}',
    '.dk-page+.dk-page{margin-top:10mm;page-break-before:always;break-before:page}',
    '.dk-page *{box-sizing:border-box}',
    '.dk-kop{display:flex;align-items:center;gap:12px;border-bottom:3px solid #000;padding-bottom:6px;margin-bottom:2px}',
    '.dk-kop img.logo{width:62px;height:72px;object-fit:contain}',
    '.dk-kop .txt{flex:1;text-align:center;padding-right:62px}',
    '.dk-kop .b1{font-size:13pt;font-weight:bold;letter-spacing:.5px}.dk-kop .b2{font-size:15pt;font-weight:bold}.dk-kop .b3{font-size:12pt;font-weight:bold}',
    '.dk-kop .al{font-size:9pt}.dk-kopimg{width:100%;display:block;margin-bottom:2px}',
    '.dk-rule2{border-top:1px solid #000;margin:1px 0 10px}',
    '.dk-title{text-align:center;font-weight:bold;text-decoration:underline;font-size:13pt;letter-spacing:1px;margin:8px 0 0}',
    '.dk-sub{text-align:center;margin:0 0 10px}',
    '.dk-row{display:flex;gap:6px;margin:4px 0}.dk-row .l{width:70px;flex:none}.dk-row .c{width:10px;flex:none}.dk-row .v{flex:1}',
    '.dk-ol{margin:0;padding-left:18px}.dk-ol li{margin-bottom:2px;text-align:justify}',
    '.dk-tbl{width:100%;border-collapse:collapse;font-size:10.5pt}.dk-tbl th,.dk-tbl td{border:1px solid #000;padding:3px 5px;vertical-align:top}',
    '.dk-tbl th{text-align:center;font-weight:bold;background:#f2f2f2}.dk-tbl .r{text-align:right;white-space:nowrap}.dk-tbl .ctr{text-align:center}',
    '.dk-plain{width:100%;border-collapse:collapse}.dk-plain td{padding:2px 4px;vertical-align:top}',
    '.dk-ttd{width:260px;margin-left:auto;margin-top:14px;font-size:11pt}.dk-ttd .sp{height:62px;display:flex;align-items:center}',
    '.dk-ttd .sp img{max-height:60px;max-width:150px}.dk-ttd .nm{font-weight:bold;text-decoration:underline}',
    '.dk-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;margin-top:10px;font-size:10pt}',
    '.dk-sig{text-align:center}.dk-sig .sp{height:54px;display:flex;align-items:center;justify-content:center}.dk-sig .sp img{max-height:52px;max-width:130px}.dk-sig .nm{font-weight:bold;text-decoration:underline}',
    '.dk-box{border:1px solid #000;padding:4px 8px;font-size:10pt;display:inline-block}',
    '.dk-note{font-size:8.5pt;color:#333;margin-top:8px}',
    '.dk-qr{display:flex;align-items:flex-end;gap:8px;font-size:8pt;color:#333}.dk-qr img{width:70px;height:70px}',
    '.dk-money{font-weight:bold;border:1px solid #000;padding:4px 10px;display:inline-block;font-size:12pt}',
    '.dk-italic{font-style:italic}.dk-b{font-weight:bold}.dk-u{text-decoration:underline}.dk-small{font-size:9.5pt}.dk-xs{font-size:8.5pt}',
    '.dk-watermark{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:64pt;color:rgba(186,26,26,.10);transform:rotate(-24deg);font-weight:bold;pointer-events:none}',
    // ---- Format resmi (templat DOCX instansi) ----
    '.dk-page.f4{min-height:330mm;padding:15mm 20mm;font-size:11pt;line-height:1.3;page:f4}',
    '.dk-page.spd{page:a4;padding:9mm 20mm 8mm;font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.22}',
    '.dk-page.kwt{width:215.9mm;min-height:140mm;padding:5mm 15mm 4mm;font-size:10pt;line-height:1.28;page:kwt}',
    '.dk-page .t0{border-collapse:collapse;width:100%}.dk-page .t0 td{padding:0 0 1px;vertical-align:top}',
    '.dk-page .hg{padding-left:5mm;text-indent:-5mm}.dk-page .hg4{padding-left:4mm;text-indent:-4mm}',
    '.st-kop{width:100%;border-collapse:collapse}.st-kop td{vertical-align:middle;padding:0}.st-kop img.lg{width:21mm;height:auto;display:block}',
    '.st-kop .tx{text-align:center;font-family:Arial,Helvetica,sans-serif;padding-right:8mm}.st-kop .b1{font-size:13pt;letter-spacing:.4px}',
    '.st-kop .b2{font-size:17pt;font-weight:900;letter-spacing:.2px;line-height:1.15}.st-kop .b3{font-size:13pt;font-weight:700}.st-kop .al{font-size:9pt;margin-top:1px}',
    '.st-rule{border-top:2.6px solid #000;border-bottom:1px solid #000;height:6px;margin:1.5mm 0 0}',
    '.st-judul{text-align:center;font-weight:bold;font-size:13pt;margin-top:5mm}.st-nomor{text-align:center;margin-bottom:5mm}',
    '.st-mng{text-align:center;font-weight:bold;margin:4mm 0 3mm}.st-ttd{margin-left:100mm;margin-top:5mm}.st-ttd .sp{height:21mm;display:flex;align-items:center}.st-ttd .sp img{max-height:20mm;max-width:45mm}',
    '.spd-kop{width:192.6mm;margin-left:-7.3mm;border-collapse:collapse;border-bottom:3.5pt solid #000}.spd-kop td{vertical-align:middle;padding:0 0 3mm}.spd-kop img.lg{width:26mm;height:auto;display:block}',
    '.spd-kop .tx{text-align:center;font-size:12pt;line-height:1.2;padding-right:4mm}.spd-kop .b2{font-size:14pt;font-weight:bold}',
    '.spd-tb{border-collapse:collapse;width:192.6mm;margin-left:-7.3mm;table-layout:fixed}.spd-tb td{border:.75pt solid #000;padding:1px 5px 2px;vertical-align:top}',
    '.spd-bk{border-collapse:collapse;width:174.4mm;margin-left:-2.2mm;table-layout:fixed}.spd-bk td{border:.75pt solid #000;padding:1px 4px 2px;vertical-align:top}',
    '.spd-bk .gs{height:20mm;vertical-align:bottom}.spd-bk .ln{border-bottom:.75pt solid #000;width:70%;margin:0 auto 1px 8mm;height:1px}',
    '.spd-ttd{margin-left:85mm;margin-top:4mm}.spd-ttd .sp{height:17mm;display:flex;align-items:center}.spd-ttd .sp img{max-height:18mm;max-width:45mm}',
    '.kw-hd{width:100%;border-collapse:collapse}.kw-hd td{vertical-align:top;padding:0}.kw-box{border-collapse:collapse;width:70mm}.kw-box td{padding:0 4px}',
    '.kw-tb{border-collapse:collapse;width:185.9mm;margin-left:4.4mm;table-layout:fixed}.kw-tb td{padding:0 2px 1px;vertical-align:top}',
    '.kw-sg{border-collapse:collapse;width:197.5mm;margin-left:1.9mm;table-layout:fixed;font-size:7pt;line-height:1.2;margin-top:4mm}',
    '.kw-sg td{border-top:.75pt solid #000;border-left:.75pt solid #000;text-align:center;vertical-align:top;padding:1px 3px 0}.kw-sg td:first-child{border-left:0}',
    '.kw-sg .cap{height:8.6mm}.kw-sg .sp{height:13mm;display:flex;align-items:center;justify-content:center}.kw-sg .sp img{max-height:9.5mm;max-width:28mm}',
    '@page{size:A4;margin:0}@page a4{size:A4;margin:0}@page f4{size:210mm 330mm;margin:0}@page kwt{size:215.9mm 140mm;margin:0}'
  ].join('\n');

  function imgSrc(opts, id) { if (!id) return ''; return opts && opts.img ? opts.img(id) : ''; }
  function kopHTML(k, opts) {
    var kimg = imgSrc(opts, k.kopImg);
    if (kimg) return '<img class="dk-kopimg" src="' + kimg + '"><div class="dk-rule2"></div>';
    var logo = imgSrc(opts, k.logo) || EMBLEM;
    return '<div class="dk-kop"><img class="logo" src="' + logo + '"><div class="txt"><div class="b1">' + esc(k.baris1) + '</div><div class="b2">' + esc(k.baris2) + '</div>' +
      (k.baris3 ? '<div class="b3">' + esc(k.baris3) + '</div>' : '') + '<div class="al">' + esc(k.alamat) + (k.kontak ? ' Telp. ' + esc(k.kontak) : '') +
      (k.laman ? ' · ' + esc(k.laman) : '') + '</div></div></div><div class="dk-rule2"></div>';
  }
  function ttdSpace(t, opts, kode) {
    if (t.metode === 'Digital') {
      var im = imgSrc(opts, t.img);
      if (im) return '<img src="' + im + '">';
      if (opts && opts.qr && kode) return '<img src="' + opts.qr((opts.verifyUrl || '') + '?v=' + kode) + '" style="width:58px;height:58px">';
      return '<span class="dk-xs dk-italic">[ditandatangani secara elektronik]</span>';
    }
    return '';
  }
  function ttdBlock(cls, judul, t, opts, kode) {
    return '<div class="' + cls + '">' + judul + '<div class="sp">' + ttdSpace(t, opts, kode) + '</div><div class="nm">' + esc(t.nama || '……………………………') + '</div>' +
      (t.pangkat && cls === 'dk-ttd' ? '<div>' + esc(t.pangkat) + '</div>' : '') + '<div>NIP. ' + esc(fmtNip(t.nip) || '……………………') + '</div></div>';
  }
  function page(inner, opts, extraCls) {
    var wm = opts && opts.draf ? '<div class="dk-watermark">DRAF</div>' : '';
    return '<div class="dk-page ' + (extraCls || '') + '">' + wm + inner + '</div>';
  }

  // ---- Surat Tugas: kertas F4 (210 × 330 mm), Times New Roman 11 pt — templat "1. Surat Tugas TEMPLATE BKAD" ----
  function kopST(k, opts) {
    var kimg = imgSrc(opts, k.kopImg);
    if (kimg) return '<img class="dk-kopimg" src="' + kimg + '">';
    var logo = imgSrc(opts, k.logo) || LAMBANG;
    var al = [k.alamat, k.kontak ? 'Telp. ' + k.kontak : '', k.laman ? 'email : ' + k.laman : ''].filter(Boolean).join(' ');
    return '<table class="st-kop"><tr><td style="width:24mm"><img class="lg" src="' + logo + '" alt=""></td><td class="tx"><div class="b1">' + esc(k.baris1) + '</div><div class="b2">' + esc(k.baris2) + '</div>' +
      (k.baris3 ? '<div class="b3">' + esc(k.baris3) + '</div>' : '') + '<div class="al">' + esc(al) + '</div></td></tr></table><div class="st-rule"></div>';
  }
  function barisTitik(label, isi, w1, w2) {
    return '<tr><td style="width:' + w1 + '">' + label + '</td><td style="width:' + (w2 || '5mm') + '">:</td><td>' + isi + '</td></tr>';
  }
  function renderST(d, opts) {
    var h = kopST(d.kop, opts);
    h += '<div class="st-judul">SURAT TUGAS</div><div class="st-nomor">NOMOR : ' + esc(d.nomor) + '</div>';
    var dasar = d.dasar.length ? d.dasar : ['…'];
    h += '<table class="t0">' + dasar.map(function (x, i) { return barisTitik(i === 0 ? 'Dasar' : '', '<div class="hg">' + (i + 1) + '. ' + esc(x) + (/[.;]$/.test(x) ? '' : ';') + '</div>', '22mm'); }).join('') + '</table>';
    h += '<div class="st-mng">MENUGASKAN:</div><div>Kepada&nbsp; :</div>';
    var banyak = d.pegawai.length > 1;
    (d.pegawai.length ? d.pegawai : [{ nama: '…', nip: '', pangkatGol: '', jabatan: '' }]).forEach(function (p, i) {
      var pg = p.pangkatGol || pangkatGol(p.pangkat, p.golongan);
      h += '<table class="t0" style="margin-top:' + (i ? '2mm' : '1mm') + '">' +
        barisTitik((banyak ? (i + 1) + '. ' : '') + 'Nama', esc(p.nama), '32mm') + barisTitik((banyak ? '<span style="visibility:hidden">' + (i + 1) + '. </span>' : '') + 'Pangkat/Gol', esc(pg), '32mm') +
        barisTitik((banyak ? '<span style="visibility:hidden">' + (i + 1) + '. </span>' : '') + 'NIP', esc(fmtNip(p.nip)), '32mm') + barisTitik((banyak ? '<span style="visibility:hidden">' + (i + 1) + '. </span>' : '') + 'Jabatan', esc(p.jabatan), '32mm') + '</table>';
    });
    h += '<table class="t0" style="margin-top:3mm">' + barisTitik('Untuk', '<div class="hg">1. ' + esc(d.kegiatan || '…') + '</div>', '22mm') +
      barisTitik('', '<div style="padding-left:5mm">Hari / Tanggal : ' + esc(d.hariTanggal) + '</div>', '22mm') +
      barisTitik('', '<div style="padding-left:5mm">Tempat : ' + esc(d.tempat || '…') + '</div>', '22mm') +
      barisTitik('', '<div class="hg">2. Surat Tugas ini agar dilaksanakan dengan penuh rasa tanggung jawab.</div>', '22mm') + '</table>';
    h += '<table class="t0" style="margin-top:9mm;width:auto">' + barisTitik('Ditetapkan di', esc(d.tempatTerbit), '40mm') + barisTitik('Pada Tanggal', esc(fmtTgl(d.tanggalTerbit)), '40mm') + '</table>';
    var t = d.ttd || {}, jab = esc(t.jabatan || 'Kepala');
    h += '<div class="st-ttd">' + (t.an ? esc(t.an) + '<br>' : '') + jab + ',<div class="sp">' + (t.metode === 'Digital' ? ttdSpace(t, { img: opts && opts.img }, '') : '') + '</div>' +
      '<div class="dk-b">' + esc(t.nama || '……………………………') + '</div><div>NIP. ' + esc(fmtNip(t.nip) || '……………………') + '</div></div>';
    if (t.metode === 'Digital' && d.kode && opts && opts.qr) h += '<div class="dk-qr" style="margin-top:6mm"><img src="' + opts.qr((opts.verifyUrl || '') + '?v=' + d.kode) + '"><div>Pindai untuk<br>verifikasi keaslian</div></div>';
    return page(h, opts, 'f4');
  }

  // ---- SPD: A4, Arial 10 pt — templat "2. SPD TEMPLATE DB 6 Pengikut" (depan & belakang) ----
  function kopSPD(k, opts) {
    var logo = imgSrc(opts, k.logo) || LAMBANG;
    var b1 = str(k.baris1).replace(/^PEMERINTAH\s+KABUPATEN\s+/i, 'PEMERINTAH DAERAH KABUPATEN ');
    return '<table class="spd-kop"><tr><td style="width:38mm"><img class="lg" src="' + logo + '" alt=""></td><td class="tx"><div>' + esc(b1) + '</div><div class="b2">' + esc(k.baris2) + (k.baris3 ? ' ' + esc(k.baris3) : '') + '</div>' +
      '<div style="height:5mm"></div>' + (k.alamat ? '<div>Jalan : ' + esc(k.alamat) + '</div>' : '') + (k.kontak ? '<div>Telepon ' + esc(k.kontak) + '</div>' : '') + (k.laman ? '<div>Laman ' + esc(k.laman) + '</div>' : '') + '</td></tr></table>';
  }
  function li(huruf, teks) { return '<div class="hg">' + huruf + '.&nbsp; ' + teks + '</div>'; }
  function renderSPD(d, opts) {
    var pa = d.pa || {}, paLabel = pa.label || 'Pengguna Anggaran';
    var maks = Math.max(num(d.maksPengikut) || 6, d.pengikut.length);
    var h = kopSPD(d.kop, opts);
    h += '<table class="t0" style="width:auto;margin:3.5mm 0 0 88mm"><tr><td style="width:25mm;padding-bottom:4px">Lembar Ke</td><td>:</td><td style="padding-left:4px"></td></tr><tr><td style="padding-bottom:4px">Kode No</td><td>:</td><td></td></tr><tr><td>Nomor</td><td>:</td><td style="padding-left:4px">' + esc(d.nomor) + '</td></tr></table>';
    h += '<div style="text-align:center;font-weight:bold;text-decoration:underline;margin:5mm 0 3mm">SURAT PERJALANAN DINAS (SPD)</div>';
    function r(no, a, b) { return '<tr><td style="text-align:center">' + no + '</td><td>' + a + '</td><td colspan="2">' + b + '</td></tr>'; }
    var tj = d.tujuan.map(function (t) { return esc(t.tempat) + (t.kab ? ', ' + esc(t.kab) : '') + (t.prov ? ', Provinsi ' + esc(t.prov) : ''); }).join('; ');
    var pg = '';
    for (var i = 0; i < maks; i++) { var x = d.pengikut[i] || {}; pg += '<tr style="height:6.4mm"><td></td><td style="vertical-align:middle">' + (i + 1) + '.&nbsp;&nbsp;' + esc(x.nama || '') + '</td><td style="vertical-align:middle">' + esc(x.tglLahir ? fmtTgl(x.tglLahir) : '') + '</td><td style="vertical-align:middle">' + esc(x.ket || '') + '</td></tr>'; }
    h += '<table class="spd-tb"><colgroup><col style="width:12.2mm"><col style="width:72.8mm"><col style="width:57.5mm"><col style="width:50.1mm"></colgroup><tbody>' +
      r('1.', 'Pengguna Anggaran/ Kuasa Pengguna Anggaran', '<div style="padding:2mm 0">' + esc(pa.nama) + '</div>') +
      r('2.', 'Nama/NIP Pegawai yang melaksanakan Perjalanan Dinas', esc(d.pelaksana.nama) + '<br>NIP. ' + esc(fmtNip(d.pelaksana.nip))) +
      r('3.', li('a', 'Pangkat dan Golongan') + li('b', 'Jabatan/Instansi') + li('c', 'Tingkat Biaya Perjalanan Dinas'), li('a', esc(d.pelaksana.pangkatGol || pangkatGol(d.pelaksana.pangkat, d.pelaksana.golongan))) + li('b', esc(d.pelaksana.jabatan)) + li('c', esc(d.pelaksana.tingkat))) +
      r('4.', 'Maksud Perjalanan Dinas', esc(d.maksud)) +
      r('5.', '<div style="padding:2mm 0">Alat Angkutan yang dipergunakan</div>', '<div style="padding:2mm 0">' + esc(d.alat) + '</div>') +
      r('6.', li('a', 'Tempat Berangkat') + li('b', 'Tempat Tujuan'), li('a', esc(d.singkatOPD || d.opd) + ' Kab. ' + esc(d.kota || 'Cianjur')) + li('b', tj)) +
      r('7.', li('a', 'Lamanya Perjalanan Dinas') + li('b', 'Tanggal Berangkat') + li('c', 'Tanggal harus kembali/tiba di tempat Baru *)'), '<div style="padding-top:2mm">' + li('a', d.lama + ' (' + terbilangAngka(d.lama) + ') Hari') + li('b', esc(fmtTgl(d.tglBerangkat))) + li('c', esc(fmtTgl(d.tglKembali))) + '</div>') +
      '<tr style="height:8mm"><td style="text-align:center;vertical-align:middle">8</td><td style="vertical-align:middle">Pengikut: Nama</td><td style="vertical-align:middle">Tanggal Lahir</td><td style="vertical-align:middle">Keterangan</td></tr>' + pg +
      r('9', 'Pembebanan Anggaran' + li('a', 'SKPD') + li('b', 'Kode Rekening'), '<div style="padding-top:4mm">' + li('a', esc(d.skpd)) + li('b', esc(d.kodeRek)) + '</div>') +
      r('10', '<div style="padding:1.5mm 0">Keterangan lain-lain</div>', '<div style="padding:1.5mm 0">' + esc(d.keterangan || '') + '</div>') + '</tbody></table>';
    h += '<div class="spd-ttd"><table class="t0" style="width:auto"><tr><td style="width:24mm">Dikeluarkan di</td><td>: ' + esc(d.tempatTetap) + '</td></tr><tr><td>Pada tanggal</td><td>: ' + esc(fmtTgl(d.tanggalTetap)) + '</td></tr></table>' +
      esc(paLabel) + '<div class="sp">' + ttdSpace(pa, opts, d.kode) + '</div><div class="dk-u">' + esc(pa.nama || '……………………………') + '</div><div>NIP. ' + esc(fmtNip(pa.nip) || '……………………') + '</div></div>';
    var p1 = page(h, opts, 'spd');
    // ----- Halaman belakang -----
    var ked = esc(d.berangkat || 'Cianjur'), tuj = d.tujuan.length ? d.tujuan : [{}];
    var legs = Math.max(3, tuj.length), ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    function ttdPA() { return '<div class="sp" style="height:15mm">' + ttdSpace(pa, opts, '') + '</div><span class="dk-u">' + esc(pa.nama || '') + '</span><br>NIP. ' + esc(fmtNip(pa.nip)); }
    var b = '<table class="spd-bk"><colgroup><col style="width:8.8mm"><col style="width:28.5mm"><col style="width:46mm"><col style="width:42.6mm"><col style="width:48.5mm"></colgroup><tbody>';
    b += '<tr><td style="text-align:center">I.</td><td colspan="2" style="border-bottom:0"></td><td>Berangkat dari<br>(Tempat Kedudukan)</td><td>: ' + ked + '</td></tr>' +
      '<tr><td></td><td colspan="2" style="border-top:0;border-bottom:0"></td><td>Ke</td><td>: ' + esc(tuj[0].tempat || '') + '</td></tr>' +
      '<tr><td></td><td colspan="2" style="border-top:0;border-bottom:0"></td><td>Pada Tanggal</td><td>: ' + esc(fmtTgl(d.tglBerangkat)) + '</td></tr>' +
      '<tr><td></td><td colspan="2" style="border-top:0;border-bottom:0"></td><td colspan="2" style="padding-left:2mm">' + esc(paLabel) + '</td></tr>' +
      '<tr><td></td><td colspan="2" style="border-top:0"></td><td colspan="2" style="height:21mm;vertical-align:bottom">' + ttdPA() + '</td></tr>';
    for (var k = 0; k < legs; k++) {
      var t = tuj[k] || {}, nxt = tuj[k + 1], ada = !!t.tempat, akhir = ada && !nxt;
      var tiba = ada ? (t.tiba || (k === 0 ? d.tglBerangkat : '')) : '', brkt = ada ? (t.brkt || (akhir ? d.tglKembali : '')) : '';
      var keTeks = ada ? (nxt ? esc(nxt.tempat) : ked) : '';
      b += '<tr><td style="text-align:center">' + ROM[k + 1] + '.</td><td>Tiba di</td><td>: ' + esc(t.tempat || '') + '</td><td>Berangkat dari</td><td>: ' + esc(t.tempat || '') + '</td></tr>' +
        '<tr><td></td><td>Pada Tanggal</td><td>: ' + esc(tiba ? fmtTgl(tiba) : '') + '</td><td>Ke</td><td>: ' + keTeks + '</td></tr>' +
        '<tr><td></td><td>Kepala</td><td>: ' + esc(t.pengesah || '') + '</td><td>Pada Tanggal</td><td>: ' + esc(brkt ? fmtTgl(brkt) : '') + '</td></tr>' +
        '<tr><td></td><td colspan="2" class="gs"><div class="ln"></div>NIP.</td><td colspan="2" class="gs" style="position:relative"><div style="position:absolute;top:1px;left:4px">Kepala</div><div class="ln"></div>NIP.</td></tr>';
    }
    var nKembali = Math.max(6, legs + 2);   // templat: IV lalu VI (Tiba kembali), VII, VIII
    b += '<tr><td style="text-align:center">' + ROM[nKembali - 1] + '.</td><td>Tiba Kembali di</td><td>: ' + ked + '</td><td colspan="2" rowspan="4" style="text-align:justify">Telah diperiksa, dengan keterangan bahwa perjalanan tersebut di atas dilakukan atas perintahnya dan semata-mata untuk kepentingan jabatan dalam waktu yang sesingkat-singkatnya</td></tr>' +
      '<tr><td></td><td>Pada Tanggal</td><td>: ' + esc(fmtTgl(d.tglKembali)) + '</td></tr>' +
      '<tr><td></td><td colspan="2">' + esc(paLabel) + '</td></tr>' +
      '<tr><td></td><td colspan="2" style="height:21mm;vertical-align:bottom">' + ttdPA() + '</td></tr>';
    b += '<tr><td style="text-align:center">' + ROM[nKembali] + '.</td><td colspan="4">Catatan Lain-lain<br>' + (d.nomorST ? 'Surat Tugas Nomor ' + esc(d.nomorST) + ' tanggal ' + esc(fmtTgl(d.tanggalST)) : '') + (d.diklat ? (d.nomorST ? '; ' : '') + 'Diklat ' + esc(d.diklat.nama) + ' (' + esc(rentangTgl(d.diklat.mulai, d.diklat.selesai)) + ')' : '') + '</td></tr>';
    b += '<tr><td style="text-align:center">' + ROM[nKembali + 1] + '.</td><td colspan="4" style="text-align:justify">PERHATIAN:<br>Pengguna Anggaran/Kuasa Pengguna Anggaran yang menerbitkan SPD, pejabat/pegawai/pihak lain yang melakukan perjalanan dinas, para pejabat yang mengesahkan tanggal berangkat/tiba, serta bendahara pengeluaran bertanggungjawab berdasarkan peraturan-peraturan keuangan daerah apabila negara menderita kerugian akibat kesalahan, kelalaian, dan kealpaannya.</td></tr>';
    b += '</tbody></table>';
    var p2 = page(b, opts, 'spd');
    return p1 + p2;
  }

  function renderRincian(d, opts) {
    var h = kopHTML(d.kop, opts);
    h += '<div class="dk-title">RINCIAN BIAYA PERJALANAN DINAS</div><div class="dk-sub dk-small">Lampiran SPD Nomor: ' + esc(d.nomorSPD) + ' · Tanggal: ' + esc(fmtTgl(d.tanggalSPD)) + '</div>';
    h += '<table class="dk-plain dk-small" style="margin-bottom:6px"><tr><td style="width:110px">Nama / NIP</td><td>: <b>' + esc(d.orang.nama) + '</b> / ' + esc(fmtNip(d.orang.nip)) + '</td></tr><tr><td>Tujuan</td><td>: ' + esc(d.tujuan) + ' (' + d.lama + ' hari)</td></tr></table>';
    h += '<table class="dk-tbl"><thead><tr><th style="width:28px">No</th><th>Perincian Biaya</th><th>Volume</th><th>Harga Satuan</th><th>Jumlah</th><th>Keterangan</th></tr></thead><tbody>' +
      (d.rows.length ? d.rows.map(function (r, i) {
        return '<tr><td class="ctr">' + (i + 1) + '</td><td>' + esc(r.label) + '</td><td class="ctr">' + r.volume + ' ' + esc(r.satuan) + '</td><td class="r">' + fmtRp(r.harga) + '</td><td class="r">' + fmtRp(r.diakui) + '</td><td class="dk-small">' + esc(r.ket) + (r.riil !== null && r.riil !== r.jumlah ? ' (riil ' + fmtRp(r.riil) + ')' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="ctr">Belum ada rincian</td></tr>') +
      '<tr><td colspan="4" class="r"><b>JUMLAH</b></td><td class="r"><b>' + fmtRp(d.total) + '</b></td><td></td></tr></tbody></table>';
    h += '<div class="dk-small" style="margin-top:4px">Terbilang: <i>' + esc(d.terbilang) + '</i></div>';
    if (d.tiket.length) {
      h += '<div class="dk-b dk-small" style="margin-top:8px">Informasi Tiket</div><table class="dk-tbl dk-xs"><thead><tr><th>Arah</th><th>Maskapai/Operator</th><th>Nama</th><th>No. Tiket</th><th>Kode Booking</th><th>No. Penerbangan</th><th>Rute</th><th>Tanggal</th><th>Kelas</th><th>Harga</th></tr></thead><tbody>' +
        d.tiket.map(function (t) { return '<tr><td>' + esc(t.arah) + '</td><td>' + esc(t.maskapai) + '</td><td>' + esc(t.nama) + '</td><td>' + esc(t.nomor) + '</td><td>' + esc(t.booking) + '</td><td>' + esc(t.flight) + '</td><td>' + esc(t.asal) + ' – ' + esc(t.tujuan) + '</td><td>' + esc(fmtTglPendek(t.tanggal)) + '</td><td>' + esc(t.kelas) + '</td><td class="r">' + fmtRp(t.harga) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    if (d.penginapan.length) {
      h += '<div class="dk-b dk-small" style="margin-top:8px">Informasi Penginapan</div><table class="dk-tbl dk-xs"><thead><tr><th>Nama Penginapan / Hotel</th><th>Malam</th><th>Harga/Malam</th><th>Keterangan</th></tr></thead><tbody>' +
        d.penginapan.map(function (t) { return '<tr><td>' + esc(t.nama) + '</td><td class="ctr">' + t.malam + '</td><td class="r">' + fmtRp(t.harga) + '</td><td>' + esc(t.ket) + '</td></tr>'; }).join('') + '</tbody></table>';
    }
    h += '<div class="dk-grid2"><div class="dk-sig">Telah dibayar sejumlah<br><b>' + fmtRp(d.total) + '</b><br>Bendahara Pengeluaran<div class="sp">' + ttdSpace(d.bendahara, opts, '') + '</div><div class="nm">' + esc(d.bendahara.nama) + '</div>NIP. ' + esc(fmtNip(d.bendahara.nip)) + '</div>' +
      '<div class="dk-sig">Cianjur, ' + esc(fmtTgl(d.tanggalSPD)) + '<br>Telah menerima jumlah uang sebesar <b>' + fmtRp(d.total) + '</b><br>Yang Menerima<div class="sp"></div><div class="nm">' + esc(d.orang.nama) + '</div>NIP. ' + esc(fmtNip(d.orang.nip)) + '</div></div>';
    h += '<div style="border-top:1px solid #000;margin-top:12px;padding-top:6px"><div class="dk-b" style="text-align:center">PERHITUNGAN SPD RAMPUNG</div>' +
      '<table class="dk-plain" style="width:auto"><tr><td>Ditetapkan sejumlah</td><td>:</td><td class="dk-b">' + fmtRp(d.ditetapkan) + '</td></tr><tr><td>Yang telah dibayar semula</td><td>:</td><td>' + fmtRp(d.dibayar) + '</td></tr><tr><td>Sisa kurang / lebih</td><td>:</td><td class="dk-b">' + fmtRp(d.sisa) + '</td></tr></table>' +
      '<div class="dk-ttd" style="margin-top:4px">Pejabat Pembuat Komitmen<div class="sp">' + ttdSpace(d.ppk, opts, '') + '</div><div class="nm">' + esc(d.ppk.nama) + '</div><div>NIP. ' + esc(fmtNip(d.ppk.nip)) + '</div></div></div>';
    return page(h, opts);
  }

  // ---- Kuitansi: 215,9 × 140 mm, Times New Roman — templat "3. KWITANSI PEMBAYARAN UANG HARIAN DAN UANG HARIAN DIKLAT" ----
  function ttdKwt(atas, bawah, t, opts, kode) {
    return '<div class="cap"><div>' + atas + '</div><div>' + bawah + '</div></div><div class="sp">' + ttdSpace(t || {}, opts, kode) + '</div>' +
      '<div class="dk-u">' + esc((t && t.nama) || '') + '</div><div>NIP. ' + esc(fmtNip(t && t.nip)) + '</div>';
  }
  function renderKuitansi(d, opts) {
    var rp = function (n) { return num(n) ? 'Rp. ' + fmtAngka(n) : 'Rp. -'; };
    var rinc = d.rincian && d.rincian.length ? d.rincian : [[str((KOMPONEN[d.komponen] || {}).label || 'NILAI').toUpperCase(), d.nominal]];
    var pemda = d.pemda || 'KABUPATEN CIANJUR';
    var h = '<table class="kw-hd"><tr><td style="width:61mm;text-align:center;font-size:12pt;padding-top:5mm">PEMERINTAH ' + esc(pemda) + '</td><td></td>' +
      '<td style="width:72mm"><div style="padding-left:1mm">LEMBAR KE:</div><table class="kw-box" style="border:.75pt solid #000"><tr><td style="width:25mm">Tanggal</td><td style="width:4mm">:</td><td>' + esc(fmtTgl(d.tanggalBayar)) + '</td></tr>' +
      '<tr><td>Nomor</td><td>:</td><td>' + esc(d.nomor) + '</td></tr><tr><td>Kode Rekening</td><td>:</td><td>' + esc(d.kodeRek) + '</td></tr></table></td></tr></table>';
    h += '<div style="text-align:center;font-weight:bold;font-size:12pt;margin:4mm 0 4mm">KWITANSI PEMBAYARAN</div>';
    h += '<table class="kw-tb"><colgroup><col style="width:40mm"><col style="width:4.2mm"><col></colgroup><tbody>' +
      '<tr><td>SUDAH TERIMA DARI</td><td>:</td><td>BENDAHARA ' + esc(str(d.namaOPD).toUpperCase()) + ' ' + esc(pemda) + '</td></tr>' +
      '<tr><td>BANYAKNYA</td><td>:</td><td class="dk-b">' + esc(d.terbilang) + '</td></tr>' +
      '<tr><td colspan="2" style="font-size:14pt;font-weight:bold;text-decoration:underline;padding-left:2mm">' + rp(d.nominal) + '</td><td></td></tr>' +
      '<tr><td>Untuk pembayaran</td><td>:</td><td style="text-align:justify">' + esc(d.uraian) +
      '<table class="t0" style="margin-top:5mm;margin-left:4mm;width:auto"><tr><td style="width:20mm">Rincian :</td><td style="width:44mm">' + esc(rinc[0][0]) + '</td><td>' + rp(rinc[0][1]) + '</td></tr>' +
      rinc.slice(1).map(function (x) { return '<tr><td></td><td>' + esc(x[0]) + '</td><td>' + rp(x[1]) + '</td></tr>'; }).join('') +
      '<tr><td></td><td>JUMLAH</td><td>' + rp(d.nominal) + '</td></tr></table></td></tr></tbody></table>';
    var pa = d.pa || {}, pbp = d.pembantu || {};
    h += '<table class="kw-sg"><colgroup><col style="width:32.5mm"><col style="width:45mm"><col style="width:35mm"><col style="width:32.5mm"><col style="width:52.5mm"></colgroup><tr>' +
      '<td>' + ttdKwt('Mengetahui', esc(pa.label || 'Pengguna Anggaran'), pa, opts, d.kode) + '</td>' +
      '<td>' + ttdKwt('Menyetujui', 'PPTK', d.pptk, opts, '') + '</td>' +
      '<td>' + ttdKwt('Dibayar Oleh', 'Bendahara Pengeluaran', d.bendahara, opts, '') + '</td>' +
      '<td>' + (pbp.nama ? ttdKwt('Pembantu Bendahara', 'Pengeluaran', pbp, opts, '') : '') + '</td>' +
      '<td><div class="cap"><div>Lunas Dibayar tanggal</div><div style="text-align:left;padding-left:2mm">' + esc(d.kota || 'Cianjur') + ', ' + esc(fmtTgl(d.tanggalBayar)) + '</div><div>Yang menerima</div></div>' +
      '<div class="sp"></div><div class="dk-u">' + esc(d.penerima.nama) + '</div><div>NIP. ' + esc(fmtNip(d.penerima.nip)) + '</div></td></tr></table>';
    if (d.kode) h += '<div style="font-size:6.5pt;color:#444;text-align:right;margin-top:1.5mm">Kode verifikasi ' + esc(d.kode) + '</div>';
    return page(h, opts, 'kwt');
  }

  function renderTabel(judul, sub, kolom, rows, opts, uangKeys) {
    uangKeys = uangKeys || [];
    var h = '<div class="dk-title" style="text-decoration:none">' + esc(judul) + '</div><div class="dk-sub dk-small">' + esc(sub) + '</div>';
    h += '<table class="dk-tbl dk-xs"><thead><tr>' + kolom.map(function (k) { return '<th>' + esc(k[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + kolom.map(function (k) {
          var v = r[k[0]]; var isU = uangKeys.indexOf(k[0]) > -1;
          if (/^tgl/.test(k[0])) v = fmtTglPendek(v);
          return '<td class="' + (isU ? 'r' : '') + '">' + esc(isU ? fmtAngka(v) : (k[0] === 'persen' ? num(v).toFixed(1) + '%' : v)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody>';
    if (uangKeys.length) {
      h += '<tfoot><tr>' + kolom.map(function (k, i) {
        if (i === 0) return '<td class="dk-b">JUMLAH</td>';
        return '<td class="r dk-b">' + (uangKeys.indexOf(k[0]) > -1 && k[0] !== 'persen' ? fmtAngka(sum(rows, function (r) { return r[k[0]]; })) : '') + '</td>';
      }).join('') + '</tr></tfoot>';
    }
    h += '</table><div class="dk-note">Dicetak dari SI-JADIN pada ' + esc(fmtTgl(hariIni())) + '</div>';
    return page(h, opts, 'landscape');
  }

  function dokumenLengkap(htmlPages, judul) {
    var m = String(htmlPages).match(/class="dk-page ?([a-z0-9 ]*)"/), cls = m ? m[1] : '';
    var ukuran = /\bf4\b/.test(cls) ? '210mm 330mm' : /\bkwt\b/.test(cls) ? '215.9mm 140mm' : /landscape/.test(cls) ? 'A4 landscape' : 'A4';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(judul || 'Dokumen') + '</title><style>body{margin:0;background:#fff}' + CSS + '\n@page{size:' + ukuran + ';margin:0}.dk-page{min-height:0!important;margin:0!important}</style></head><body>' + htmlPages + '</body></html>';
  }

  // ---------------------------------------------------------------
  // 11. EKSPOR API
  // ---------------------------------------------------------------
  return {
    VERSION: '1.1.0', BULAN: BULAN, BULAN_PENDEK: BULAN_PENDEK, PERAN: PERAN, PERAN_PEJABAT: PERAN_PEJABAT, ALAT_ANGKUT: ALAT_ANGKUT,
    PROVINSI: PROVINSI, JENIS_JALAN: JENIS_JALAN, KOMPONEN: KOMPONEN, TEMPLAT_LABEL: TEMPLAT_LABEL, JENIS_BUKTI: JENIS_BUKTI,
    REKAP_KOLOM: REKAP_KOLOM, REKAP_UANG: REKAP_UANG, EMBLEM: EMBLEM, LAMBANG: LAMBANG, TTD_DOK: TTD_DOK, PERAN_BIDANG: PERAN_BIDANG,
    esc: esc, num: num, str: str, pad: pad, fmtAngka: fmtAngka, fmtRp: fmtRp, fmtNip: fmtNip, namaLengkap: namaLengkap, sum: sum, by: by, one: one,
    parseJSON: parseJSON, terbilang: terbilang, terbilangAngka: terbilangAngka,
    parseTgl: parseTgl, iso: iso, hariIni: hariIni, tambahHari: tambahHari, selisihHari: selisihHari, lamaHari: lamaHari, fmtTgl: fmtTgl,
    fmtTglPendek: fmtTglPendek, namaHari: namaHari, romawi: romawi, bulanKe: bulanKe, tahunDari: tahunDari, rentangTgl: rentangTgl,
    hariTanggal: hariTanggal, rentangOverlap: rentangOverlap, DASAR_BEBAS: DASAR_BEBAS,
    lookup: { pilihanDasar: pilihanDasar, instansi: instansi, kop: kop, pegawai: pegawai, pejabat: pejabat, pejabatById: pejabatById, pilihanTTD: pilihanTTD, bidangSPD: bidangSPD, tglLahir: tglLahir, pangkatGol: pangkatGol, param: param, konfigHari: konfigHari,
      rekening: rekening, tingkatBiaya: tingkatBiaya, isEselonII: isEselonII, sbu: sbu, dasarTeks: dasarTeks, variabelDasar: variabelDasar, jabar: jabar, versiTerbaru: versiTerbaru },
    hitung: { splitHari: splitHari, konteksSPD: konteksSPD, anggotaSPD: anggotaSPD, hitungOtomatis: hitungOtomatis, normalisasiBaris: normalisasiBaris,
      rincianOrang: rincianOrang, totalOrang: totalOrang, totalSPD: totalSPD, totalRiilSPD: totalRiilSPD, rencanaKuitansi: rencanaKuitansi },
    checklistSPJ: checklistSPJ,
    doc: { st: docST, spd: docSPD, rincian: docRincian, kuitansi: docKuitansi },
    rekap: rekap, laporan: laporan, sisaPagu: sisaPagu, triwulan: triwulan,
    render: { css: CSS, st: renderST, spd: renderSPD, rincian: renderRincian, kuitansi: renderKuitansi, tabel: renderTabel, lengkap: dokumenLengkap }
  };
})();
// ===== AKHIR BERKAS js/dokumen.js =====
