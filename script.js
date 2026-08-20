/* ==========================================================
   SIPINTAS - Frontend VS Code + Google Apps Script
   ========================================================== */

(() => {
  "use strict";

  const API_URL = "https://script.google.com/macros/s/AKfycbwyvni_bpU0x1ocK9JhS1jBIZIQE3x0w8-A-9P1GejcyzJReNJyhDvejTPwyEhQysP8/exec";
  const MALANG_CENTER = [-7.96662, 112.632632];
  const ADMIN_TOKEN_KEY = "sipintas_admin_token";
  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ["pdf", "doc", "docx"];

  const STATUS = {
    PROCESS: "Sedang Diverifikasi",
    APPROVED: "Pertimbangan Izin dapat diterbitkan",
    REJECTED: "Pertimbangan Izin tidak dapat diterbitkan",
    DONE: "Selesai"
  };

  const state = {
    publicMap: null,
    drawnItems: null,
    adminToken: localStorage.getItem(ADMIN_TOKEN_KEY) || "",
    adminData: [],
    selectedDetail: null,
    adminMap: null,
    adminLayerGroup: null
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    setCurrentYear();
    initNavigation();
    initPublicMap();
    initApplicationForm();
    initAdmin();
  }

  /* ========================================================
     GENERAL UI
     ======================================================== */

  function setCurrentYear() {
    const year = byId("year");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function initNavigation() {
    const navToggle = byId("navToggle");
    const navMenu = byId("navMenu");
    if (!navToggle || !navMenu) return;

    navToggle.addEventListener("click", () => {
      const opened = navMenu.classList.toggle("show");
      navToggle.setAttribute("aria-expanded", String(opened));
    });

    navMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navMenu.classList.remove("show");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ========================================================
     PUBLIC MAP
     ======================================================== */

  function initPublicMap() {
    const mapElement = byId("map");
    if (!mapElement) return;

    if (!window.L) {
      showMapFallback(mapElement, "Pustaka Leaflet gagal dimuat. Periksa koneksi internet dan urutan tag script.");
      return;
    }

    try {
      state.publicMap = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true
      }).setView(MALANG_CENTER, 13);

      const tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(state.publicMap);

      tileLayer.on("tileerror", () => {
        const mapInfo = byId("mapInfo");
        if (mapInfo) mapInfo.textContent = "Peta dasar gagal dimuat. Periksa koneksi internet.";
      });

      state.drawnItems = new L.FeatureGroup();
      state.publicMap.addLayer(state.drawnItems);

      const drawPluginReady = Boolean(L.Control && L.Control.Draw && L.Draw && L.Draw.Event);

      if (drawPluginReady) {
        const drawControl = new L.Control.Draw({
          position: "topleft",
          draw: {
            polyline: {
              shapeOptions: {
                color: "#ef3340",
                weight: 8,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round"
              },
              metric: true,
              feet: false
            },
            polygon: false,
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false
          },
          edit: {
            featureGroup: state.drawnItems,
            edit: true,
            remove: true
          }
        });

        state.publicMap.addControl(drawControl);
      } else {
        const mapInfo = byId("mapInfo");
        if (mapInfo) mapInfo.textContent = "Leaflet Draw gagal dimuat. Fitur menggambar belum tersedia.";
      }

      L.circleMarker(MALANG_CENTER, {
        radius: 7,
        color: "#ffffff",
        weight: 3,
        fillColor: "#1267d8",
        fillOpacity: 1
      })
        .addTo(state.publicMap)
        .bindTooltip("Kota Malang");

      if (drawPluginReady) {
        state.publicMap.on(L.Draw.Event.CREATED, (event) => {
          state.drawnItems.clearLayers();
          const layer = event.layer;
          if (typeof layer.setStyle === "function") {
            layer.setStyle({
              color: "#ef3340",
              weight: 8,
              opacity: 0.95,
              lineCap: "round",
              lineJoin: "round"
            });
          }
          state.drawnItems.addLayer(layer);
          updateDrawingData();
        });

        state.publicMap.on(L.Draw.Event.EDITED, updateDrawingData);
        state.publicMap.on(L.Draw.Event.DELETED, updateDrawingData);
      }

      const focusButton = byId("focusMalangBtn");
      if (focusButton) {
        focusButton.addEventListener("click", () => {
          state.publicMap.setView(MALANG_CENTER, 13);
          state.publicMap.invalidateSize();
        });
      }

      const clearButton = byId("clearMapBtn");
      if (clearButton) {
        clearButton.addEventListener("click", () => {
          state.drawnItems.clearLayers();
          updateDrawingData();
        });
      }

      const mapLink = document.querySelector('a[href="#peta"]');
      if (mapLink) {
        mapLink.addEventListener("click", () => {
          window.setTimeout(() => state.publicMap.invalidateSize(), 350);
        });
      }

      window.setTimeout(() => state.publicMap.invalidateSize(), 250);
      window.addEventListener("resize", debounce(() => state.publicMap.invalidateSize(), 150));
    } catch (error) {
      console.error("Gagal menginisialisasi peta:", error);
      showMapFallback(mapElement, "Peta tidak dapat dibuat. Buka Console browser untuk melihat detail kesalahan.");
    }
  }

  function showMapFallback(element, message) {
    element.innerHTML = `<p style="padding:20px;margin:0">${escapeHtml(message)}</p>`;
    const mapInfo = byId("mapInfo");
    if (mapInfo) mapInfo.textContent = message;
  }

  function getDrawnLayer() {
    let selectedLayer = null;
    if (!state.drawnItems) return selectedLayer;

    state.drawnItems.eachLayer((layer) => {
      selectedLayer = layer;
    });
    return selectedLayer;
  }

  function updateDrawingData() {
    const layer = getDrawnLayer();
    const drawingStatus = byId("drawingStatus");
    const mapInfo = byId("mapInfo");

    if (!layer || typeof layer.getLatLngs !== "function") {
      setValue("koordinatRuas", "");
      setValue("titikAwal", "");
      setValue("titikAkhir", "");
      setValue("panjangMeter", "");
      setValue("panjangKm", "");
      if (drawingStatus) drawingStatus.textContent = "Belum ada ruas jalan yang ditandai.";
      if (mapInfo) mapInfo.textContent = "Belum ada ruas jalan yang digambar.";
      return;
    }

    const latLngs = flattenLatLngs(layer.getLatLngs());
    if (latLngs.length < 2) return;

    const coordinates = latLngs.map((point) => [
      Number(point.lat.toFixed(6)),
      Number(point.lng.toFixed(6))
    ]);

    const lengthMeter = calculateLength(latLngs);
    const startPoint = coordinates[0];
    const endPoint = coordinates[coordinates.length - 1];

    setValue("koordinatRuas", JSON.stringify(coordinates));
    setValue("titikAwal", JSON.stringify(startPoint));
    setValue("titikAkhir", JSON.stringify(endPoint));
    setValue("panjangMeter", String(Math.round(lengthMeter)));
    setValue("panjangKm", (lengthMeter / 1000).toFixed(3));

    const readable = formatDistance(lengthMeter);
    if (drawingStatus) {
      drawingStatus.textContent = `Ruas sudah ditandai. Jumlah titik: ${coordinates.length}. Perkiraan panjang: ${readable}.`;
    }
    if (mapInfo) {
      mapInfo.textContent = `Garis merah memiliki ${coordinates.length} titik. Perkiraan panjang: ${readable}.`;
    }
  }

  function flattenLatLngs(latLngs) {
    if (!Array.isArray(latLngs)) return [];
    if (latLngs.length && Array.isArray(latLngs[0])) return flattenLatLngs(latLngs[0]);
    return latLngs;
  }

  function calculateLength(latLngs) {
    if (!state.publicMap) return 0;
    let total = 0;
    for (let index = 1; index < latLngs.length; index += 1) {
      total += state.publicMap.distance(latLngs[index - 1], latLngs[index]);
    }
    return total;
  }

  function formatDistance(meters) {
    if (!meters) return "0 meter";
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} meter`;
  }

  /* ========================================================
     APPLICATION FORM
     ======================================================== */

  function initApplicationForm() {
    const applicationForm = byId("applicationForm");
    if (!applicationForm) return;

    const nik = byId("nik");
    if (nik) {
      nik.addEventListener("input", (event) => {
        event.target.value = onlyDigits(event.target.value).slice(0, 16);
      });
    }

    const phone = byId("noHp");
    if (phone) {
      phone.addEventListener("input", (event) => {
        event.target.value = String(event.target.value || "")
          .replace(/[^\d+]/g, "")
          .replace(/(?!^)\+/g, "")
          .slice(0, 16);
      });
    }

    ["jamMulai", "jamSelesai"].forEach((id) => {
      const input = byId(id);
      if (!input) return;
      input.addEventListener("input", (event) => {
        let value = onlyDigits(event.target.value).slice(0, 4);
        if (value.length >= 3) value = `${value.slice(0, 2)}.${value.slice(2)}`;
        event.target.value = value;
      });
    });

    const documentInput = byId("dokumenPengajuan");
    if (documentInput) {
      documentInput.addEventListener("change", () => {
        const error = validateFile(documentInput.files[0], false);
        documentInput.setCustomValidity(error);
        if (error) documentInput.reportValidity();
      });
    }

    applicationForm.addEventListener("submit", handleApplicationSubmit);
  }

  async function handleApplicationSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = byId("submitBtn");
    const formMessage = byId("formMessage");
    clearMessage(formMessage);
    updateDrawingData();

    const payload = buildApplicationPayload();
    const documentFile = getSelectedFile("dokumenPengajuan");
    const validationMessage = validateApplicationPayload(payload, documentFile);

    if (validationMessage) {
      showMessage(formMessage, "error", validationMessage);
      return;
    }

    if (!isApiReady()) {
      showMessage(formMessage, "error", "API_URL belum diisi dengan URL deployment Google Apps Script.");
      return;
    }

    payload.idPengajuan = createClientRequestId();
    setButtonLoading(submitButton, true, "Mengirim Pengajuan...");

    try {
      const file = await fileToPayload(documentFile);
      await postToAppsScript({
        action: "submit",
        payload,
        file
      });

      showMessage(
        formMessage,
        "success",
        `Permintaan pengajuan sudah dikirim. Simpan ID Pengajuan: ${payload.idPengajuan}. Periksa email pemohon untuk konfirmasi dari sistem.`
      );

      form.reset();
      if (state.drawnItems) state.drawnItems.clearLayers();
      updateDrawingData();
      if (state.publicMap) state.publicMap.setView(MALANG_CENTER, 13);
    } catch (error) {
      console.error(error);
      showMessage(formMessage, "error", `Pengajuan gagal dikirim: ${error.message}`);
    } finally {
      setButtonLoading(submitButton, false, "Kirim Pengajuan Pertimbangan Teknis");
    }
  }

  function buildApplicationPayload() {
    return {
      nama: getValue("nama"),
      nik: getValue("nik"),
      email: getValue("email").toLowerCase(),
      noHp: getValue("noHp"),
      alamat: getValue("alamat"),
      namaKegiatan: getValue("namaKegiatan"),
      tanggal: getValue("tanggal"),
      estimasiPeserta: getValue("estimasiPeserta"),
      jamMulai: getValue("jamMulai"),
      jamSelesai: getValue("jamSelesai"),
      lokasiPatokan: getValue("lokasiPatokan"),
      persetujuanTembusan: isChecked("persetujuanTembusan"),
      persetujuan: isChecked("persetujuan"),
      metodePenandaan: "Manual",
      koordinatRuas: getValue("koordinatRuas"),
      titikAwal: getValue("titikAwal"),
      titikAkhir: getValue("titikAkhir"),
      panjangMeter: getValue("panjangMeter"),
      panjangKm: getValue("panjangKm"),
      userAgent: navigator.userAgent
    };
  }

  function validateApplicationPayload(payload, documentFile) {
    // Semua field boleh kosong.
    // Jika field tertentu diisi, formatnya tetap diperiksa.

    if (payload.nik && !/^\d{16}$/.test(payload.nik)) {
      return "Jika NIK diisi, NIK harus berisi tepat 16 digit angka.";
    }

    if (
      payload.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
    ) {
      return "Jika email diisi, format email pemohon harus valid.";
    }

    if (payload.jamMulai && !isValidTime24(payload.jamMulai)) {
      return "Jika jam mulai diisi, gunakan format 24 jam, contoh 19.00.";
    }

    if (payload.jamSelesai && !isValidTime24(payload.jamSelesai)) {
      return "Jika jam selesai diisi, gunakan format 24 jam, contoh 21.00.";
    }

    if (
      payload.jamMulai &&
      payload.jamSelesai &&
      isValidTime24(payload.jamMulai) &&
      isValidTime24(payload.jamSelesai) &&
      timeToMinutes(payload.jamSelesai) <= timeToMinutes(payload.jamMulai)
    ) {
      return "Jika kedua jam diisi, jam selesai harus lebih besar daripada jam mulai.";
    }

    const fileError = validateFile(documentFile, false);
    if (fileError) return fileError;

    return "";
  }

  /* ========================================================
     ADMIN
     ======================================================== */

  function initAdmin() {
    const adminLoginForm = byId("adminLoginForm");
    const refreshButton = byId("refreshAdminBtn");
    const logoutButton = byId("logoutAdminBtn");
    const adminSearch = byId("adminSearch");
    const statusFilter = byId("statusFilter");
    const closeDetailButton = byId("closeDetailBtn");
    const printButton = byId("printDetailBtn");
    const statusForm = byId("statusForm");
    const tableBody = byId("adminTableBody");
    const letterInput = byId("suratPertimbangan");

    if (adminLoginForm) adminLoginForm.addEventListener("submit", handleAdminLogin);
    if (refreshButton) refreshButton.addEventListener("click", loadAdminData);
    if (logoutButton) logoutButton.addEventListener("click", logoutAdmin);
    if (adminSearch) adminSearch.addEventListener("input", renderAdminTable);
    if (statusFilter) statusFilter.addEventListener("change", renderAdminTable);
    if (closeDetailButton) closeDetailButton.addEventListener("click", () => byId("detailPanel")?.classList.add("hidden"));
    if (printButton) printButton.addEventListener("click", () => window.print());
    if (statusForm) statusForm.addEventListener("submit", handleStatusSubmit);
    if (tableBody) tableBody.addEventListener("click", handleAdminTableClick);

    if (letterInput) {
      letterInput.addEventListener("change", () => {
        const error = validateFile(letterInput.files[0], false);
        letterInput.setCustomValidity(error);
        if (error) letterInput.reportValidity();
      });
    }

    if (state.adminToken) {
      showAdminDashboard();
      loadAdminData();
    }
  }

  async function handleAdminLogin(event) {
    event.preventDefault();
    const message = byId("adminLoginMessage");
    clearMessage(message);

    if (!isApiReady()) {
      showMessage(message, "error", "API_URL belum diisi di script.js.");
      return;
    }

    try {
      const response = await jsonp("adminLogin", {
        username: getValue("adminUsername"),
        password: getValue("adminPassword")
      });

      if (!response?.success) {
        showMessage(message, "error", response?.message || "Login gagal.");
        return;
      }

      state.adminToken = response.token;
      localStorage.setItem(ADMIN_TOKEN_KEY, response.token);
      showAdminDashboard();
      await loadAdminData();
    } catch (error) {
      showMessage(message, "error", error.message);
    }
  }

  function showAdminDashboard() {
    byId("adminLoginBox")?.classList.add("hidden");
    byId("adminDashboard")?.classList.remove("hidden");
  }

  function logoutAdmin() {
    state.adminToken = "";
    state.adminData = [];
    state.selectedDetail = null;
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    byId("adminDashboard")?.classList.add("hidden");
    byId("adminLoginBox")?.classList.remove("hidden");
    byId("detailPanel")?.classList.add("hidden");
  }

  async function loadAdminData() {
    if (!state.adminToken) return;

    try {
      const response = await jsonp("adminList", { token: state.adminToken });
      if (!response?.success) {
        if (String(response?.message || "").toLowerCase().includes("session")) logoutAdmin();
        throw new Error(response?.message || "Gagal mengambil data admin.");
      }

      state.adminData = Array.isArray(response.data) ? response.data : [];
      renderKpis();
      renderAdminTable();
    } catch (error) {
      console.error(error);
      window.alert(error.message);
    }
  }

  function renderKpis() {
    const data = state.adminData;
    setText("kpiTotal", data.length);
    setText("kpiProcess", data.filter((item) => item.status === STATUS.PROCESS).length);
    setText("kpiRecommended", data.filter((item) => item.status === STATUS.APPROVED).length);
    setText("kpiRevision", data.filter((item) => item.status === STATUS.REJECTED).length);
  }

  function renderAdminTable() {
    const tableBody = byId("adminTableBody");
    if (!tableBody) return;

    const keyword = getValue("adminSearch").toLowerCase();
    const selectedStatus = getValue("statusFilter");

    const filtered = state.adminData.filter((item) => {
      const searchableText = [
        item.idPengajuan,
        item.nama,
        item.nik,
        item.email,
        item.noHp,
        item.namaKegiatan,
        item.lokasiPatokan,
        item.status
      ]
        .map((value) => String(value || ""))
        .join(" ")
        .toLowerCase();

      return (!keyword || searchableText.includes(keyword)) && (!selectedStatus || item.status === selectedStatus);
    });

    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td colspan="7">Tidak ada data yang sesuai.</td></tr>';
      return;
    }

    tableBody.innerHTML = filtered
      .map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.idPengajuan || "-")}</strong><br><small>${escapeHtml(item.timestamp || "-")}</small></td>
          <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status || "-")}</span></td>
          <td>${escapeHtml(item.nama || "-")}<br><small>${escapeHtml(item.email || "-")}</small></td>
          <td>${escapeHtml(item.namaKegiatan || "-")}</td>
          <td>${escapeHtml(item.tanggal || "-")}<br><small>${escapeHtml(item.jamMulai || "-")} - ${escapeHtml(item.jamSelesai || "-")}</small></td>
          <td>${escapeHtml(item.lokasiPatokan || "-")}</td>
          <td><button class="table-btn" type="button" data-id="${escapeAttr(item.idPengajuan || "")}">Detail</button></td>
        </tr>
      `)
      .join("");
  }

  function handleAdminTableClick(event) {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    showDetail(button.dataset.id);
  }

  function showDetail(idPengajuan) {
    const item = state.adminData.find((row) => String(row.idPengajuan) === String(idPengajuan));
    if (!item) return;

    state.selectedDetail = item;
    setText("detailTitle", `${item.idPengajuan || "-"} - ${item.namaKegiatan || "-"}`);
    setSelectValue("updateStatus", item.status || STATUS.PROCESS);
    setValue("adminNote", item.catatanAdmin || item.note || "");
    clearFileInput("suratPertimbangan");
    clearMessage(byId("statusMessage"));

    renderDetailRows(byId("pemohonDetail"), [
      ["Nama", item.nama],
      ["NIK", item.nik],
      ["Email", item.email],
      ["No. HP", item.noHp],
      ["Alamat", item.alamat]
    ]);

    renderDetailRows(byId("kegiatanDetail"), [
      ["Kegiatan", item.namaKegiatan],
      ["Tanggal", item.tanggal],
      ["Jam", `${item.jamMulai || "-"} - ${item.jamSelesai || "-"}`],
      ["Peserta", item.estimasiPeserta],
      ["Lokasi", item.lokasiPatokan],
      ["Panjang", `${item.panjangMeter || 0} meter / ${item.panjangKm || 0} km`],
      ["Dokumen pengajuan", item.dokumenPengajuanUrl || item.dokumenUrl, "link"],
      ["Surat pertimbangan", item.suratPertimbanganUrl || item.suratUrl, "link"],
      ["Catatan admin", item.catatanAdmin || item.note]
    ]);

    const detailPanel = byId("detailPanel");
    detailPanel?.classList.remove("hidden");
    detailPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => renderAdminMap(item), 180);
  }

  async function handleStatusSubmit(event) {
    event.preventDefault();
    const message = byId("statusMessage");
    const submitButton = byId("statusSubmitBtn") || event.currentTarget.querySelector('button[type="submit"]');
    clearMessage(message);

    if (!state.selectedDetail) {
      showMessage(message, "error", "Tidak ada pengajuan yang dipilih.");
      return;
    }

    const status = getValue("updateStatus");
    const note = getValue("adminNote");
    const letterFile = getSelectedFile("suratPertimbangan");
    const existingLetter = state.selectedDetail.suratPertimbanganUrl || state.selectedDetail.suratUrl;

    const fileError = validateFile(letterFile, false);
    if (fileError) {
      showMessage(message, "error", fileError);
      return;
    }

    if (status === STATUS.APPROVED && !letterFile && !existingLetter) {
      showMessage(message, "error", "Unggah surat pertimbangan sebelum menetapkan status dapat diterbitkan.");
      return;
    }

    setButtonLoading(submitButton, true, "Memperbarui Status...");

    try {
      if (letterFile) {
        const file = await fileToPayload(letterFile);
        await postToAppsScript({
          action: "updateStatusWithFile",
          payload: {
            token: state.adminToken,
            idPengajuan: state.selectedDetail.idPengajuan,
            status,
            note
          },
          file
        });

        showMessage(message, "success", "Permintaan pembaruan status dan unggah surat sudah dikirim ke backend.");
        window.setTimeout(loadAdminData, 1500);
      } else {
        const response = await jsonp("updateStatus", {
          token: state.adminToken,
          idPengajuan: state.selectedDetail.idPengajuan,
          status,
          note
        });

        if (!response?.success) throw new Error(response?.message || "Gagal memperbarui status.");
        showMessage(message, "success", "Status berhasil diperbarui dan notifikasi diproses.");
        await loadAdminData();
      }

      clearFileInput("suratPertimbangan");
    } catch (error) {
      console.error(error);
      showMessage(message, "error", error.message);
    } finally {
      setButtonLoading(submitButton, false, "Update Status & Kirim Email");
    }
  }

  function renderAdminMap(item) {
    const mapElement = byId("adminMap");
    if (!mapElement || !window.L) return;

    if (!state.adminMap) {
      state.adminMap = L.map(mapElement, {
        zoomControl: true,
        scrollWheelZoom: true
      }).setView(MALANG_CENTER, 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(state.adminMap);

      state.adminLayerGroup = L.layerGroup().addTo(state.adminMap);
    }

    state.adminMap.invalidateSize();
    state.adminLayerGroup.clearLayers();

    const coordinates = parseCoordinates(item.koordinatRuas);
    if (coordinates.length < 2) {
      state.adminMap.setView(MALANG_CENTER, 13);
      return;
    }

    const line = L.polyline(coordinates, {
      color: "#ef3340",
      weight: 8,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(state.adminLayerGroup);

    L.circleMarker(coordinates[0], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#51d26b",
      fillOpacity: 1
    }).addTo(state.adminLayerGroup).bindTooltip("Titik awal");

    L.circleMarker(coordinates[coordinates.length - 1], {
      radius: 7,
      color: "#ffffff",
      weight: 3,
      fillColor: "#ef3340",
      fillOpacity: 1
    }).addTo(state.adminLayerGroup).bindTooltip("Titik akhir");

    state.adminMap.fitBounds(line.getBounds(), { padding: [40, 40] });
  }

  /* ========================================================
     API AND FILES
     ======================================================== */

  async function postToAppsScript(body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);

    try {
      await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        redirect: "follow",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Waktu pengiriman habis. Periksa koneksi dan deployment Apps Script.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function jsonp(action, params = {}) {
    if (!isApiReady()) return Promise.reject(new Error("API_URL belum diisi di script.js."));

    return new Promise((resolve, reject) => {
      const callbackName = `sipintas_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      let settled = false;

      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Request timeout. Periksa URL dan hak akses Web App Apps Script."));
      }, 20000);

      window[callbackName] = (data) => {
        settled = true;
        cleanup();
        resolve(data);
      };

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }

      const url = new URL(API_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("callback", callbackName);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value == null ? "" : String(value));
      });

      script.onerror = () => {
        if (settled) return;
        cleanup();
        reject(new Error("Gagal menghubungi Apps Script. Periksa deployment dan akses Web App."));
      };

      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  function validateFile(file, required = true) {
    if (!file) return required ? "Dokumen wajib dipilih." : "";

    const extension = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return "Format dokumen harus PDF, DOC, atau DOCX.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Ukuran dokumen maksimal 8 MB.";
    }
    return "";
  }

  function fileToPayload(file) {
    if (!file) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        if (commaIndex < 0) {
          reject(new Error("Berkas tidak dapat dibaca."));
          return;
        }
        resolve({
          name: sanitizeFileName(file.name),
          mimeType: file.type || mimeTypeFromExtension(getFileExtension(file.name)),
          size: file.size,
          base64: result.slice(commaIndex + 1)
        });
      };
      reader.onerror = () => reject(new Error("Berkas gagal dibaca oleh browser."));
      reader.readAsDataURL(file);
    });
  }

  /* ========================================================
     HELPERS
     ======================================================== */

  function byId(id) {
    return document.getElementById(id);
  }

  function getValue(id) {
    const element = byId(id);
    return element ? String(element.value || "").trim() : "";
  }

  function setValue(id, value) {
    const element = byId(id);
    if (element) element.value = value == null ? "" : String(value);
  }

  function setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = String(value ?? "");
  }

  function isChecked(id) {
    return Boolean(byId(id)?.checked);
  }

  function getSelectedFile(id) {
    return byId(id)?.files?.[0] || null;
  }

  function clearFileInput(id) {
    const input = byId(id);
    if (input) {
      input.value = "";
      input.setCustomValidity("");
    }
  }

  function onlyDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function isValidTime24(value) {
    return /^([01]\d|2[0-3])\.[0-5]\d$/.test(value);
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value).split(".").map(Number);
    return hours * 60 + minutes;
  }

  function getFileExtension(fileName) {
    return String(fileName || "").split(".").pop().toLowerCase();
  }

  function sanitizeFileName(fileName) {
    return String(fileName || "dokumen")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
  }

  function mimeTypeFromExtension(extension) {
    const mimeTypes = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
    return mimeTypes[extension] || "application/octet-stream";
  }

  function showMessage(element, type, text) {
    if (!element) return;
    element.className = `form-message show ${type}`;
    element.textContent = text;
  }

  function clearMessage(element) {
    if (!element) return;
    element.className = "form-message";
    element.textContent = "";
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return;
    button.disabled = loading;
    button.textContent = text;
  }

  function setSelectValue(id, value) {
    const select = byId(id);
    if (!select) return;

    const exists = [...select.options].some((option) => option.value === value);
    if (!exists && value) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    select.value = value;
  }

  function renderDetailRows(container, rows) {
    if (!container) return;
    container.innerHTML = `<div class="detail-list">${rows
      .map(([label, value, type]) => {
        let renderedValue = escapeHtml(value || "-");
        if (type === "link" && isSafeHttpUrl(value)) {
          renderedValue = `<a href="${escapeAttr(value)}" target="_blank" rel="noopener noreferrer">Buka dokumen</a>`;
        }
        return `<div><span>${escapeHtml(label)}</span><span>${renderedValue}</span></div>`;
      })
      .join("")}</div>`;
  }

  function parseCoordinates(value) {
    try {
      const coordinates = Array.isArray(value) ? value : JSON.parse(value || "[]");
      if (!Array.isArray(coordinates)) return [];
      return coordinates.filter((point) =>
        Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
      );
    } catch (error) {
      return [];
    }
  }

  function isSafeHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function isApiReady() {
    return Boolean(API_URL && /^https:\/\/script\.google\.com\/macros\/s\//.test(API_URL));
  }

  function createClientRequestId() {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("");
    const time = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `SIP-MLG-${date}-${time}-${random}`;
  }

  function statusClass(status) {
    if (status === STATUS.APPROVED || status === STATUS.DONE) return "good";
    if (status === STATUS.PROCESS) return "warn";
    if (status === STATUS.REJECTED) return "bad";
    return "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function debounce(callback, wait) {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
  }
})();
