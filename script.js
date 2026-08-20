/* ==========================================================
   SIPINTAS - FRONTEND SCRIPT
   Dinas Perhubungan Kota Malang
   Terhubung ke Google Apps Script Web App
   ========================================================== */

"use strict";

const API_URL =
  "https://script.google.com/macros/s/AKfycbwL3hQtC0kpRJCbLyX495grv-e3uHWgQcd9qzYtdvB9fdB8ifPMucJ1L8nehxmfUhTH/exec";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx"];
const ADMIN_TOKEN_KEY = "sipintas_admin_token";
const MALANG_CENTER = [-7.96662, 112.63263];
const MALANG_ZOOM = 13;

let publicMap = null;
let publicDrawnItems = null;
let activeRouteLayer = null;

let adminMap = null;
let adminRouteLayer = null;
let adminData = [];
let selectedApplication = null;

const $ = (id) => document.getElementById(id);

/* ==========================================================
   INISIALISASI
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  setYear();
  initNavigation();
  initInputHelpers();
  initPublicMap();
  initApplicationForm();
  initAdmin();
});

function setYear() {
  const yearEl = $("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

/* ==========================================================
   NAVIGASI MOBILE
   ========================================================== */

function initNavigation() {
  const toggle = $("navToggle");
  const menu = $("navMenu");

  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("show");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menu.classList.remove("show");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* ==========================================================
   INPUT HELPERS
   ========================================================== */

function initInputHelpers() {
  const nik = $("nik");
  const phone = $("noHp");
  const jamMulai = $("jamMulai");
  const jamSelesai = $("jamSelesai");

  if (nik) {
    nik.addEventListener("input", () => {
      nik.value = nik.value.replace(/\D/g, "").slice(0, 16);
    });
  }

  if (phone) {
    phone.addEventListener("input", () => {
      let value = phone.value.replace(/[^\d+]/g, "");
      value = value.replace(/(?!^)\+/g, "");
      phone.value = value.slice(0, 16);
    });
  }

  [jamMulai, jamSelesai].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", () => {
      let digits = input.value.replace(/\D/g, "").slice(0, 4);
      if (digits.length > 2) {
        digits = `${digits.slice(0, 2)}.${digits.slice(2)}`;
      }
      input.value = digits;
    });

    input.addEventListener("blur", () => {
      const normalized = normalizeTimeInput(input.value);
      if (normalized) input.value = normalized;
    });
  });
}

function normalizeTimeInput(value) {
  const raw = String(value || "").trim().replace(":", ".");
  const match = raw.match(/^(\d{1,2})\.(\d{2})$/);
  if (!match) return raw;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return raw;

  return `${String(hour).padStart(2, "0")}.${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const [hour, minute] = String(value).split(".").map(Number);
  return hour * 60 + minute;
}

/* ==========================================================
   PETA PENGAJUAN
   ========================================================== */

function initPublicMap() {
  const mapElement = $("map");
  if (!mapElement || typeof L === "undefined") return;

  publicMap = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView(MALANG_CENTER, MALANG_ZOOM);

  addBaseMap(publicMap);

  publicDrawnItems = new L.FeatureGroup();
  publicMap.addLayer(publicDrawnItems);

  const drawControl = new L.Control.Draw({
    position: "topleft",
    draw: {
      polyline: {
        shapeOptions: {
          color: "#ef3340",
          weight: 6,
          opacity: 0.95,
        },
        showLength: true,
        metric: true,
      },
      polygon: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false,
    },
    edit: false,
  });

  publicMap.addControl(drawControl);

  publicMap.on(L.Draw.Event.CREATED, (event) => {
    if (activeRouteLayer) {
      publicDrawnItems.removeLayer(activeRouteLayer);
    }

    activeRouteLayer = event.layer;
    activeRouteLayer.setStyle({
      color: "#ef3340",
      weight: 6,
      opacity: 0.95,
    });

    publicDrawnItems.addLayer(activeRouteLayer);
    saveRouteFromLayer(activeRouteLayer);
  });

  const focusButton = $("focusMalangBtn");
  const clearButton = $("clearMapBtn");

  if (focusButton) {
    focusButton.addEventListener("click", () => {
      publicMap.setView(MALANG_CENTER, MALANG_ZOOM);
    });
  }

  if (clearButton) {
    clearButton.addEventListener("click", clearPublicRoute);
  }

  window.addEventListener("resize", () => {
    if (publicMap) publicMap.invalidateSize();
  });
}

function addBaseMap(map) {
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
}

function saveRouteFromLayer(layer) {
  const latLngs = flattenLatLngs(layer.getLatLngs());

  if (latLngs.length < 2) {
    clearRouteHiddenFields();
    showRouteText("Ruas jalan minimal harus memiliki 2 titik.", true);
    return;
  }

  const coordinates = latLngs.map((point) => ({
    lat: roundCoordinate(point.lat),
    lng: roundCoordinate(point.lng),
  }));

  let totalMeters = 0;
  for (let i = 1; i < latLngs.length; i += 1) {
    totalMeters += publicMap.distance(latLngs[i - 1], latLngs[i]);
  }

  const start = coordinates[0];
  const end = coordinates[coordinates.length - 1];
  const meters = Math.round(totalMeters);
  const kilometers = (totalMeters / 1000).toFixed(3);

  $("koordinatRuas").value = JSON.stringify(coordinates);
  $("titikAwal").value = `${start.lat},${start.lng}`;
  $("titikAkhir").value = `${end.lat},${end.lng}`;
  $("panjangMeter").value = String(meters);
  $("panjangKm").value = kilometers;

  showRouteText(
    `${coordinates.length} titik tersimpan • ± ${formatNumber(meters)} meter (${kilometers} km)`,
    false
  );
}

function flattenLatLngs(input) {
  if (!Array.isArray(input)) return [];

  const result = [];
  input.forEach((item) => {
    if (Array.isArray(item)) {
      result.push(...flattenLatLngs(item));
    } else if (item && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      result.push(item);
    }
  });
  return result;
}

function roundCoordinate(value) {
  return Number(Number(value).toFixed(7));
}

function clearPublicRoute() {
  if (publicDrawnItems) publicDrawnItems.clearLayers();
  activeRouteLayer = null;
  clearRouteHiddenFields();
  showRouteText("Belum ada ruas jalan yang digambar.", false, true);
}

function clearRouteHiddenFields() {
  ["koordinatRuas", "titikAwal", "titikAkhir", "panjangMeter", "panjangKm"].forEach((id) => {
    const element = $(id);
    if (element) element.value = "";
  });
}

function showRouteText(text, isError = false, isEmpty = false) {
  const drawingStatus = $("drawingStatus");
  const mapInfo = $("mapInfo");

  if (drawingStatus) {
    drawingStatus.textContent = isEmpty
      ? "Belum ada ruas jalan yang ditandai."
      : isError
        ? text
        : `Ruas berhasil ditandai. ${text}`;
  }

  if (mapInfo) {
    mapInfo.textContent = isEmpty ? "Belum ada ruas jalan yang digambar." : text;
  }
}

/* ==========================================================
   FORM PENGAJUAN
   ========================================================== */

function initApplicationForm() {
  const form = $("applicationForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage($("formMessage"));

    if (!form.reportValidity()) return;

    const validation = validateApplicationForm();
    if (!validation.valid) {
      showMessage($("formMessage"), validation.message, "error");
      focusElement(validation.elementId);
      return;
    }

    const submitButton = $("submitBtn");
    const originalText = submitButton.textContent;

    try {
      setButtonLoading(submitButton, true, "Mengirim pengajuan...");

      const file = $("dokumenPengajuan")?.files?.[0] || null;
      const filePayload = file ? await fileToPayload(file) : null;
      const payload = collectApplicationPayload();

      const result = await postJson({
        action: "submit",
        payload,
        file: filePayload,
      });

      if (!result || !result.success) {
        throw new Error(result?.message || "Pengajuan gagal dikirim.");
      }

      const idText = result.idPengajuan ? ` ID Pengajuan: ${result.idPengajuan}.` : "";
      showMessage(
        $("formMessage"),
        `Pengajuan berhasil dikirim.${idText} Simpan ID tersebut untuk referensi Anda.`,
        "success"
      );

      form.reset();
      clearPublicRoute();

      $("formMessage").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      showMessage(
        $("formMessage"),
        friendlyError(error, "Pengajuan tidak dapat dikirim."),
        "error"
      );
    } finally {
      setButtonLoading(submitButton, false, originalText);
    }
  });
}

function collectApplicationPayload() {
  return {
    nama: valueOf("nama"),
    nik: valueOf("nik"),
    email: valueOf("email").toLowerCase(),
    noHp: valueOf("noHp"),
    alamat: valueOf("alamat"),
    namaKegiatan: valueOf("namaKegiatan"),
    tanggal: valueOf("tanggal"),
    estimasiPeserta: valueOf("estimasiPeserta"),
    jamMulai: normalizeTimeInput(valueOf("jamMulai")),
    jamSelesai: normalizeTimeInput(valueOf("jamSelesai")),
    lokasiPatokan: valueOf("lokasiPatokan"),
    persetujuanTembusan: Boolean($("persetujuanTembusan")?.checked),
    persetujuan: Boolean($("persetujuan")?.checked),
    metodePenandaan: "Leaflet Draw",
    koordinatRuas: valueOf("koordinatRuas"),
    titikAwal: valueOf("titikAwal"),
    titikAkhir: valueOf("titikAkhir"),
    panjangMeter: valueOf("panjangMeter"),
    panjangKm: valueOf("panjangKm"),
    userAgent: navigator.userAgent || "",
  };
}

function validateApplicationForm() {
  const nik = valueOf("nik");
  const noHp = valueOf("noHp");
  const jamMulai = normalizeTimeInput(valueOf("jamMulai"));
  const jamSelesai = normalizeTimeInput(valueOf("jamSelesai"));
  const coordinatesRaw = valueOf("koordinatRuas");
  const file = $("dokumenPengajuan")?.files?.[0] || null;

  // Semua field boleh kosong.
  // Jika field diisi, formatnya tetap diperiksa.
  if (nik && !/^\d{16}$/.test(nik)) {
    return { valid: false, message: "Jika NIK diisi, NIK harus terdiri dari 16 digit angka.", elementId: "nik" };
  }

  if (noHp && !/^(\+62|62|0)\d{8,13}$/.test(noHp)) {
    return { valid: false, message: "Jika nomor HP diisi, format nomor HP / WhatsApp tidak valid.", elementId: "noHp" };
  }

  if (jamMulai && !/^([01]\d|2[0-3])\.[0-5]\d$/.test(jamMulai)) {
    return { valid: false, message: "Jika jam mulai diisi, gunakan format HH.MM, contoh 08.30.", elementId: "jamMulai" };
  }

  if (jamSelesai && !/^([01]\d|2[0-3])\.[0-5]\d$/.test(jamSelesai)) {
    return { valid: false, message: "Jika jam selesai diisi, gunakan format HH.MM, contoh 21.00.", elementId: "jamSelesai" };
  }

  if (jamMulai && jamSelesai && timeToMinutes(jamSelesai) <= timeToMinutes(jamMulai)) {
    return { valid: false, message: "Jika kedua jam diisi, jam selesai harus lebih besar daripada jam mulai.", elementId: "jamSelesai" };
  }

  // Peta opsional. Jika ada koordinat, formatnya harus benar.
  if (coordinatesRaw) {
    try {
      const coordinates = JSON.parse(coordinatesRaw);
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new Error("Koordinat kurang");
      }
    } catch (_error) {
      return {
        valid: false,
        message: "Data ruas jalan pada peta belum valid. Silakan gambar ulang garis ruas jalan.",
        elementId: "peta",
      };
    }
  }

  // Dokumen opsional. Jika ada file, format dan ukurannya tetap diperiksa.
  const fileValidation = validateFile(file, false);
  if (!fileValidation.valid) {
    return { valid: false, message: fileValidation.message, elementId: "dokumenPengajuan" };
  }

  return { valid: true };
}

/* ==========================================================
   FILE HANDLING
   ========================================================== */

function validateFile(file, required = false) {
  if (!file) {
    return required
      ? { valid: false, message: "Dokumen wajib dipilih." }
      : { valid: true };
  }

  const extension = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return { valid: false, message: "Format dokumen harus PDF, DOC, atau DOCX." };
  }

  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return { valid: false, message: "Ukuran dokumen maksimal 8 MB." };
  }

  return { valid: true };
}

function getFileExtension(fileName) {
  const parts = String(fileName || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function fileToPayload(file) {
  if (!file) return Promise.resolve(null);

  const validation = validateFile(file, false);
  if (!validation.valid) return Promise.reject(new Error(validation.message));

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;

        if (!base64) throw new Error("Isi dokumen tidak dapat dibaca.");

        resolve({
          name: file.name,
          mimeType: file.type || mimeFromExtension(getFileExtension(file.name)),
          size: file.size,
          base64,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Dokumen gagal dibaca oleh browser."));
    reader.readAsDataURL(file);
  });
}

function mimeFromExtension(extension) {
  const types = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return types[extension] || "application/octet-stream";
}

/* ==========================================================
   API REQUESTS
   ========================================================== */

async function postJson(body) {
  let response;

  try {
    response = await fetch(API_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        // text/plain digunakan agar request dari hosting statis tidak memicu
        // preflight CORS sebelum mencapai Google Apps Script.
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error("Tidak dapat terhubung ke server Apps Script. Periksa koneksi internet dan deployment Web App.");
  }

  if (!response.ok) {
    throw new Error(`Server mengembalikan HTTP ${response.status}.`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error("Respons Apps Script bukan JSON yang valid. Pastikan deployment Web App sudah menggunakan versi backend terbaru.");
  }
}

function jsonpRequest(params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const callbackName = `__sipintas_jsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch (_error) {
        window[callbackName] = undefined;
      }
    };

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    const searchParams = new URLSearchParams({
      ...params,
      callback: callbackName,
      _: String(Date.now()),
    });

    script.src = `${API_URL}?${searchParams.toString()}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Tidak dapat terhubung ke Apps Script."));
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Koneksi ke Apps Script melebihi batas waktu."));
    }, timeoutMs);

    document.head.appendChild(script);
  });
}

/* ==========================================================
   ADMIN
   ========================================================== */

function initAdmin() {
  const loginForm = $("adminLoginForm");
  const refreshButton = $("refreshAdminBtn");
  const logoutButton = $("logoutAdminBtn");
  const search = $("adminSearch");
  const filter = $("statusFilter");
  const closeDetail = $("closeDetailBtn");
  const statusForm = $("statusForm");
  const printButton = $("printDetailBtn");

  if (loginForm) loginForm.addEventListener("submit", handleAdminLogin);
  if (refreshButton) refreshButton.addEventListener("click", () => loadAdminData());
  if (logoutButton) logoutButton.addEventListener("click", () => logoutAdmin());
  if (search) search.addEventListener("input", renderAdminTable);
  if (filter) filter.addEventListener("change", renderAdminTable);
  if (closeDetail) closeDetail.addEventListener("click", closeDetailPanel);
  if (statusForm) statusForm.addEventListener("submit", handleStatusUpdate);
  if (printButton) printButton.addEventListener("click", () => window.print());

  const tableBody = $("adminTableBody");
  if (tableBody) {
    tableBody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      openApplicationDetail(button.dataset.id);
    });
  }

  const storedToken = getAdminToken();
  if (storedToken) {
    showAdminDashboard();
    loadAdminData();
  } else {
    showAdminLogin();
  }
}

async function handleAdminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearMessage($("adminLoginMessage"));

  if (!form.reportValidity()) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton.textContent;

  try {
    setButtonLoading(submitButton, true, "Memeriksa...");

    const result = await jsonpRequest({
      action: "adminLogin",
      username: valueOf("adminUsername"),
      password: valueOf("adminPassword"),
    });

    if (!result || !result.success || !result.token) {
      throw new Error(result?.message || "Login admin gagal.");
    }

    sessionStorage.setItem(ADMIN_TOKEN_KEY, result.token);
    $("adminPassword").value = "";
    showAdminDashboard();
    await loadAdminData();
  } catch (error) {
    showMessage($("adminLoginMessage"), friendlyError(error, "Login admin gagal."), "error");
  } finally {
    setButtonLoading(submitButton, false, originalText);
  }
}

async function loadAdminData(options = {}) {
  const token = getAdminToken();
  if (!token) {
    logoutAdmin("Silakan login kembali.");
    return;
  }

  const refreshButton = $("refreshAdminBtn");
  const originalText = refreshButton?.textContent || "Refresh Data";
  const preserveDetailId = options.preserveDetailId || null;

  try {
    if (refreshButton) setButtonLoading(refreshButton, true, "Memuat...");

    const result = await jsonpRequest({
      action: "adminList",
      token,
    });

    if (!result || !result.success) {
      const message = result?.message || "Data admin gagal dimuat.";
      if (isSessionError(message)) {
        logoutAdmin(message);
        return;
      }
      throw new Error(message);
    }

    adminData = Array.isArray(result.data) ? result.data : [];
    updateKpis();
    renderAdminTable();

    if (preserveDetailId) {
      openApplicationDetail(preserveDetailId, false);
    }
  } catch (error) {
    const message = friendlyError(error, "Data admin gagal dimuat.");
    if (isSessionError(message)) {
      logoutAdmin(message);
      return;
    }

    showMessage($("adminLoginMessage"), message, "error");
  } finally {
    if (refreshButton) setButtonLoading(refreshButton, false, originalText);
  }
}

function updateKpis() {
  const total = adminData.length;
  const process = adminData.filter((item) => item.status === "Sedang Diverifikasi").length;
  const recommended = adminData.filter(
    (item) => item.status === "Pertimbangan Izin dapat diterbitkan"
  ).length;
  const revision = adminData.filter(
    (item) => item.status === "Pertimbangan Izin tidak dapat diterbitkan"
  ).length;

  setText("kpiTotal", total);
  setText("kpiProcess", process);
  setText("kpiRecommended", recommended);
  setText("kpiRevision", revision);
}

function renderAdminTable() {
  const tableBody = $("adminTableBody");
  if (!tableBody) return;

  const query = valueOf("adminSearch").toLowerCase();
  const status = valueOf("statusFilter");

  const filtered = adminData.filter((item) => {
    const searchable = [
      item.idPengajuan,
      item.nama,
      item.nik,
      item.email,
      item.noHp,
      item.namaKegiatan,
      item.tanggal,
      item.lokasiPatokan,
      item.status,
    ]
      .join(" ")
      .toLowerCase();

    const matchQuery = !query || searchable.includes(query);
    const matchStatus = !status || item.status === status;
    return matchQuery && matchStatus;
  });

  if (!filtered.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:28px;">
          Tidak ada data pengajuan yang sesuai.
        </td>
      </tr>`;
    return;
  }

  tableBody.innerHTML = filtered
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.idPengajuan || "-")}</strong></td>
          <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status || "-")}</span></td>
          <td>${escapeHtml(item.nama || "-")}</td>
          <td>${escapeHtml(item.namaKegiatan || "-")}</td>
          <td>${escapeHtml(formatDisplayDate(item.tanggal))}</td>
          <td>${escapeHtml(item.lokasiPatokan || "-")}</td>
          <td><button class="table-btn" type="button" data-id="${escapeAttribute(item.idPengajuan || "")}">Detail</button></td>
        </tr>`
    )
    .join("");
}

function statusClass(status) {
  if (status === "Pertimbangan Izin dapat diterbitkan" || status === "Selesai") return "good";
  if (status === "Pertimbangan Izin tidak dapat diterbitkan") return "bad";
  return "warn";
}

function openApplicationDetail(idPengajuan, scroll = true) {
  const item = adminData.find((row) => row.idPengajuan === idPengajuan);
  if (!item) return;

  selectedApplication = item;
  setText("detailTitle", `${item.idPengajuan || "-"} — ${item.namaKegiatan || "Pengajuan"}`);

  const pemohonDetail = $("pemohonDetail");
  const kegiatanDetail = $("kegiatanDetail");

  if (pemohonDetail) {
    pemohonDetail.innerHTML = buildDetailList([
      ["Nama", item.nama],
      ["NIK", item.nik],
      ["Email", item.email],
      ["No. HP", item.noHp],
      ["Alamat", item.alamat],
      ["Dokumen", buildSafeLink(item.dokumenPengajuanUrl, item.dokumenPengajuanNama || "Buka dokumen")],
    ]);
  }

  if (kegiatanDetail) {
    kegiatanDetail.innerHTML = buildDetailList([
      ["Status", item.status],
      ["Kegiatan", item.namaKegiatan],
      ["Tanggal", formatDisplayDate(item.tanggal)],
      ["Jam", `${item.jamMulai || "-"} - ${item.jamSelesai || "-"}`],
      ["Peserta", item.estimasiPeserta ? `${item.estimasiPeserta} orang` : "-"],
      ["Lokasi", item.lokasiPatokan],
      ["Panjang", formatRouteLength(item)],
      ["Catatan", item.catatanAdmin || "-"],
      ["Surat", buildSafeLink(item.suratPertimbanganUrl, item.suratPertimbanganNama || "Buka surat")],
    ]);
  }

  const updateStatus = $("updateStatus");
  const adminNote = $("adminNote");
  const letterInput = $("suratPertimbangan");

  if (updateStatus) updateStatus.value = item.status || "Sedang Diverifikasi";
  if (adminNote) adminNote.value = item.catatanAdmin || "";
  if (letterInput) letterInput.value = "";
  clearMessage($("statusMessage"));

  const panel = $("detailPanel");
  if (panel) panel.classList.remove("hidden");

  renderAdminMap(item);

  if (scroll && panel) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function closeDetailPanel() {
  selectedApplication = null;
  const panel = $("detailPanel");
  if (panel) panel.classList.add("hidden");
  clearMessage($("statusMessage"));
}

function renderAdminMap(item) {
  const mapElement = $("adminMap");
  if (!mapElement || typeof L === "undefined") return;

  if (!adminMap) {
    adminMap = L.map("adminMap", {
      zoomControl: true,
      scrollWheelZoom: false,
    }).setView(MALANG_CENTER, MALANG_ZOOM);
    addBaseMap(adminMap);
  }

  if (adminRouteLayer) {
    adminMap.removeLayer(adminRouteLayer);
    adminRouteLayer = null;
  }

  const coordinates = parseCoordinates(item.koordinatRuas);

  if (coordinates.length >= 2) {
    adminRouteLayer = L.polyline(coordinates, {
      color: "#ef3340",
      weight: 6,
      opacity: 0.95,
    }).addTo(adminMap);

    adminMap.fitBounds(adminRouteLayer.getBounds(), { padding: [28, 28] });
  } else {
    adminMap.setView(MALANG_CENTER, MALANG_ZOOM);
  }

  window.setTimeout(() => adminMap.invalidateSize(), 120);
}

function parseCoordinates(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((point) => {
        if (Array.isArray(point) && point.length >= 2) {
          return [Number(point[0]), Number(point[1])];
        }
        if (point && point.lat !== undefined && (point.lng !== undefined || point.lon !== undefined)) {
          return [Number(point.lat), Number(point.lng ?? point.lon)];
        }
        return null;
      })
      .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  } catch (_error) {
    return [];
  }
}

async function handleStatusUpdate(event) {
  event.preventDefault();
  clearMessage($("statusMessage"));

  if (!selectedApplication) {
    showMessage($("statusMessage"), "Pilih data pengajuan terlebih dahulu.", "error");
    return;
  }

  const token = getAdminToken();
  if (!token) {
    logoutAdmin("Session admin tidak tersedia. Silakan login ulang.");
    return;
  }

  const status = valueOf("updateStatus");
  const note = valueOf("adminNote");
  const file = $("suratPertimbangan")?.files?.[0] || null;

  if (
    status === "Pertimbangan Izin dapat diterbitkan" &&
    !file &&
    !selectedApplication.suratPertimbanganUrl
  ) {
    showMessage(
      $("statusMessage"),
      "Surat pertimbangan wajib diunggah sebelum menetapkan status dapat diterbitkan.",
      "error"
    );
    focusElement("suratPertimbangan");
    return;
  }

  if (file) {
    const validation = validateFile(file, false);
    if (!validation.valid) {
      showMessage($("statusMessage"), validation.message, "error");
      return;
    }
  }

  const button = $("statusSubmitBtn");
  const originalText = button.textContent;
  const idPengajuan = selectedApplication.idPengajuan;

  try {
    setButtonLoading(button, true, "Memperbarui...");

    const filePayload = file ? await fileToPayload(file) : null;
    const result = await postJson({
      action: "updateStatusWithFile",
      payload: {
        token,
        idPengajuan,
        status,
        note,
      },
      file: filePayload,
    });

    if (!result || !result.success) {
      const message = result?.message || "Status gagal diperbarui.";
      if (isSessionError(message)) {
        logoutAdmin(message);
        return;
      }
      throw new Error(message);
    }

    await loadAdminData({ preserveDetailId: idPengajuan });

    showMessage(
      $("statusMessage"),
      "Status berhasil diperbarui dan notifikasi email telah diproses.",
      "success"
    );
  } catch (error) {
    const message = friendlyError(error, "Status gagal diperbarui.");
    if (isSessionError(message)) {
      logoutAdmin(message);
      return;
    }
    showMessage($("statusMessage"), message, "error");
  } finally {
    setButtonLoading(button, false, originalText);
  }
}

function showAdminDashboard() {
  const loginBox = $("adminLoginBox");
  const dashboard = $("adminDashboard");
  if (loginBox) loginBox.classList.add("hidden");
  if (dashboard) dashboard.classList.remove("hidden");
}

function showAdminLogin() {
  const loginBox = $("adminLoginBox");
  const dashboard = $("adminDashboard");
  if (loginBox) loginBox.classList.remove("hidden");
  if (dashboard) dashboard.classList.add("hidden");
}

function logoutAdmin(message = "") {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  adminData = [];
  selectedApplication = null;
  showAdminLogin();
  closeDetailPanel();

  setText("kpiTotal", "0");
  setText("kpiProcess", "0");
  setText("kpiRecommended", "0");
  setText("kpiRevision", "0");

  const body = $("adminTableBody");
  if (body) body.innerHTML = "";

  if (message) {
    showMessage($("adminLoginMessage"), message, "error");
  } else {
    clearMessage($("adminLoginMessage"));
  }
}

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

function isSessionError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("session admin") || text.includes("kedaluwarsa") || text.includes("login ulang");
}

/* ==========================================================
   DETAIL HELPERS
   ========================================================== */

function buildDetailList(rows) {
  return `<div class="detail-list">${rows
    .map(([label, value]) => {
      const renderedValue = value && value.__safeHtml
        ? value.html
        : escapeHtml(value === null || value === undefined || value === "" ? "-" : String(value));

      return `<div><span>${escapeHtml(label)}</span><span>${renderedValue}</span></div>`;
    })
    .join("")}</div>`;
}

function buildSafeLink(url, label) {
  const safe = safeHttpUrl(url);
  if (!safe) return { __safeHtml: true, html: "-" };

  return {
    __safeHtml: true,
    html: `<a href="${escapeAttribute(safe)}" target="_blank" rel="noopener noreferrer" style="color:#1267d8;text-decoration:underline;">${escapeHtml(label || "Buka dokumen")}</a>`,
  };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function formatRouteLength(item) {
  const meters = Number(item.panjangMeter || 0);
  const km = item.panjangKm || (meters ? (meters / 1000).toFixed(3) : "");

  if (!meters && !km) return "-";
  return `${meters ? formatNumber(meters) + " meter" : "-"}${km ? ` / ${km} km` : ""}`;
}

function formatDisplayDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "-";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/* ==========================================================
   UI HELPERS
   ========================================================== */

function valueOf(id) {
  const element = $(id);
  return element ? String(element.value || "").trim() : "";
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value ?? "");
}

function showMessage(element, message, type = "success") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("success", "error");
  element.classList.add("show", type === "error" ? "error" : "success");
}

function clearMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.classList.remove("show", "success", "error");
}

function setButtonLoading(button, loading, text) {
  if (!button) return;
  button.disabled = Boolean(loading);
  button.setAttribute("aria-busy", String(Boolean(loading)));
  if (text !== undefined) button.textContent = text;
}

function focusElement(id) {
  const element = $(id);
  if (!element) return;

  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (typeof element.focus === "function" && !["DIV", "SECTION", "ASIDE"].includes(element.tagName)) {
    window.setTimeout(() => element.focus(), 250);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value) || 0);
}

function friendlyError(error, fallback) {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  return error.message || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
