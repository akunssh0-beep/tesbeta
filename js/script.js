const APP_VERSION = "1.2.1"; 
    const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyDeWZyUvXj3qVOZXviPgN-d42jswXgkm2cvYlA7OBgGSPX-G_rxYti_rJWGVdpmi_f2A/exec";
    
    let TARGET_LOC = { lat: -2.637013, lng: 116.203609, radius: 100 };
    const ADMIN_PASSWORD = "12345";

    let state = { 
        user: localStorage.getItem('gardena_user') || null, 
        data: { officers: [], logs: [], config: { QR_TEXT: "PKM-SAMPANAHAN", THRESHOLD: "0.1" }, descriptors: [] }, 
        stream: null, 
        modelsLoaded: false,
        currentLocation: null,
        currentDescriptor: null,
        geoWatchId: null,
        currentView: 'login',
        isProcessing: false,
        faceDetectionFrame: null,
        adminTriggerCount: 0,
        adminModeEnabled: false,
        isRefreshing: false,
        faceRetryCount: 0,
        authMode: 'LOGIN' 
    };

    function checkAppVersion() {
        const savedVersion = localStorage.getItem('gardena_version');
        if (savedVersion !== APP_VERSION) {
            localStorage.setItem('gardena_version', APP_VERSION);
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    for(let registration of registrations) { registration.unregister(); }
                });
            }
            window.location.reload(true); 
        }
    }

    const detectPlatform = () => {
        const ua = navigator.userAgent;
        if (/iPad|iPhone|iPod/.test(ua)) { document.body.classList.add('platform-ios'); } 
        else if (/Android/.test(ua)) { document.body.classList.add('platform-android'); }
    };

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playTone(freq, type, duration, vol = 0.1) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }
    
    function speakSuccess() {
        if ('speechSynthesis' in window) {
            const msg = new SpeechSynthesisUtterance("Absen Berhasil, Selamat Bertugas");
            msg.lang = 'id-ID';
            msg.rate = 1.0;
            msg.pitch = 1.0;
            window.speechSynthesis.speak(msg);
        }
    }

    function soundSuccess() { 
        playTone(523.25, 'sine', 0.2); 
        setTimeout(() => playTone(659.25, 'sine', 0.3), 100); 
    }
    function soundError() { playTone(220, 'sawtooth', 0.3, 0.05); setTimeout(() => playTone(196, 'sawtooth', 0.4, 0.05), 150); }

    function triggerHaptic(type = "confirm") {
        if ("vibrate" in navigator) {
            if (type === "success") navigator.vibrate(50);
            else if (type === "error") navigator.vibrate([100, 50, 100]);
            else if (type === "confirm") navigator.vibrate(20);
        }
    }

    function formatTimeFix(rawTime) {
        if (!rawTime) return "-";
        try {
            if (typeof rawTime === 'string' && /^\d{2}:\d{2}$/.test(rawTime)) return rawTime;
            const date = new Date(rawTime);
            if (!isNaN(date.getTime())) {
                return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).replace('.', ':');
            }
        } catch (e) {}
        return rawTime;
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
        const R = 6371000; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return Math.round(R * c);
    }

    function startGeoMonitoring() {
        if (!navigator.geolocation) return;
        if (state.geoWatchId) navigator.geolocation.clearWatch(state.geoWatchId);
        
        const dotMain = document.getElementById('geo-dot-main');
        const textMain = document.getElementById('geo-text-main');
        const distMain = document.getElementById('geo-dist-main');
        const limitMain = document.getElementById('geo-radius-limit');
        
        state.geoWatchId = navigator.geolocation.watchPosition((pos) => {
            const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, TARGET_LOC.lat, TARGET_LOC.lng);
            state.currentLocation = pos;
            
            if (limitMain) limitMain.innerText = `${TARGET_LOC.radius}M`;
            
            // Update TOP Indikator
            if (dotMain && textMain && distMain) {
                if (dist <= TARGET_LOC.radius) {
                    dotMain.className = "geo-dot-main active";
                    textMain.innerText = "AREA PKM TERDETEKSI";
                    textMain.className = "text-[9px] font-black text-emerald-600 uppercase tracking-tighter";
                    distMain.innerText = `JARAK: ${dist} METER (AMAN)`;
                } else {
                    dotMain.className = "geo-dot-main inactive";
                    textMain.innerText = "DI LUAR RADIUS PKM";
                    textMain.className = "text-[9px] font-black text-red-500 uppercase tracking-tighter";
                    distMain.innerText = `JARAK: ${dist} METER (TERLALU JAUH)`;
                }
            }

            // Update Old Profile Indikator (Status Pill)
            const profText = document.getElementById('profile-gps-text');
            const profDot = document.getElementById('profile-gps-dot');
            const gpsContainer = document.getElementById('gps-status-container');
            if (profText && gpsContainer) {
                if (dist <= TARGET_LOC.radius) {
                    profText.innerText = "Area PKM";
                    profText.className = "text-[8px] font-black uppercase tracking-tighter text-white";
                    profDot.className = "w-2 h-2 bg-white rounded-full shadow-[0_0_5px_#fff] animate-pulse";
                    gpsContainer.className = "flex items-center gap-1.5 gps-pill";
                } else {
                    profText.innerText = "Luar Area";
                    profText.className = "text-[8px] font-black uppercase tracking-tighter text-red-200";
                    profDot.className = "w-2 h-2 bg-red-500 rounded-full";
                    gpsContainer.className = "flex items-center gap-1.5";
                }
            }
            if (document.getElementById('modal-scan').style.display === 'flex') updateGeoUI(pos);
        }, (err) => { 
            if (textMain) textMain.innerText = "GPS TIDAK AKTIF";
            if (dotMain) dotMain.className = "geo-dot-main inactive";
            const p = document.getElementById('profile-gps-text');
            if(p) p.innerText = "OFFLINE"; 
        }, { enableHighAccuracy: true });
    }

    function updateGeoUI(pos) {
        const dist = calculateDistance(pos.coords.latitude, pos.coords.longitude, TARGET_LOC.lat, TARGET_LOC.lng);
        const statusText = document.getElementById('geo-status-text');
        const distText = document.getElementById('distance-text');
        const bars = document.querySelectorAll('.signal-bar');
        const isSafe = dist <= TARGET_LOC.radius;
        bars.forEach(b => b.classList.remove('signal-active-green', 'signal-active-red'));
        if (isSafe) {
            statusText.innerText = "LOKASI AMAN ✅";
            statusText.className = "text-[10px] font-black text-emerald-500 uppercase";
            distText.innerText = `${dist}m (Radius PKM)`;
            bars.forEach(b => b.classList.add('signal-active-green'));
        } else {
            statusText.innerText = "DILUAR RADIUS ⚠️";
            statusText.className = "text-[10px] font-black text-red-500 uppercase";
            distText.innerText = `${dist}m (Terlalu Jauh)`;
            bars.forEach(b => b.classList.add('signal-active-red'));
        }
        const mapDiv = document.getElementById('map-preview-img');
        mapDiv.classList.remove('hidden');
        mapDiv.style.backgroundImage = `url('https://maps.googleapis.com/maps/api/staticmap?center=${pos.coords.latitude},${pos.coords.longitude}&zoom=16&size=400x150&markers=color:red%7C${pos.coords.latitude},${pos.coords.longitude}&markers=color:blue%7C${TARGET_LOC.lat},${TARGET_LOC.lng}&key=')`;
    }

    function showAlert(title, msg) {
        document.getElementById('alert-title').innerText = title;
        document.getElementById('alert-msg').innerText = msg;
        const alert = document.getElementById('custom-alert');
        alert.classList.add('show');
        if(title === "Gagal" || title === "Ditolak" || title === "Opps") { soundError(); triggerHaptic("error"); }
        else if (title === "Berhasil") { 
            soundSuccess(); 
            triggerHaptic("success"); 
            if (msg.includes("Dicatat")) speakSuccess();
        }
        else { triggerHaptic("confirm"); }
        setTimeout(() => alert.classList.remove('show'), 4000);
    }

    function showLoading(show, text = "Menyelaraskan Data...") { 
        const loadingTextEl = document.getElementById('loading-text');
        if (loadingTextEl) loadingTextEl.innerText = text;
        const overlay = document.getElementById('loading-overlay');
        if(overlay) overlay.classList.toggle('hidden', !show); 
    }

    async function loadModels() {
        if (state.modelsLoaded) return;
        try {
            const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models'; 
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
            state.modelsLoaded = true;
        } catch (e) { 
            showAlert("Error", "Gagal memuat modul AI.");
        }
    }

    async function refreshData(btn) {
        triggerHaptic("confirm");
        state.isRefreshing = true;
        if(btn) btn.classList.add('spinning');
        if(state.currentView === 'profile') renderDailyLog();
        try {
            await fetchData();
            soundSuccess();
            showAlert("Berhasil", "Data disinkronkan ✨");
        } catch(e) {
            soundError();
            showAlert("Gagal", "Gagal sinkron data.");
        } finally {
            state.isRefreshing = false;
            if(btn) setTimeout(() => btn.classList.remove('spinning'), 500);
            if(state.currentView === 'profile') {
                renderDailyLog();
                renderShiftInfo(); 
            }
        }
    }

    function showView(viewName) {
        if (viewName === state.currentView) return;
        triggerHaptic("confirm");
        const viewOrder = ['login', 'profile', 'rekap'];
        const oldIdx = viewOrder.indexOf(state.currentView);
        const newIdx = viewOrder.indexOf(viewName);
        const oldView = document.getElementById(`view-${state.currentView}`);
        const newView = document.getElementById(`view-${viewName}`);
        document.querySelectorAll('.view-content').forEach(v => {
            v.classList.remove('active', 'slide-in-right', 'slide-out-left', 'slide-in-left', 'slide-out-right');
        });
        if (oldView) {
            oldView.classList.add('active');
            if (newIdx > oldIdx) {
                oldView.classList.add('slide-out-left');
                newView.classList.add('active', 'slide-in-right');
            } else {
                oldView.classList.add('slide-out-right');
                newView.classList.add('active', 'slide-in-left');
            }
            setTimeout(() => { if(state.currentView !== viewName) oldView.classList.remove('active'); }, 500);
        } else {
            newView.classList.add('active');
        }
        state.currentView = viewName;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const activeNav = document.getElementById(`nav-${viewName}`);
        if(activeNav) activeNav.classList.add('active');
        const nav = document.getElementById('main-nav');
        const fab = document.getElementById('fab-scan-qr');
        if(viewName === 'login') {
            if(nav) nav.classList.add('hidden'); 
            if(fab) fab.classList.add('hidden');
        } else {
            if(nav) nav.classList.remove('hidden');
            if(fab) {
                fab.classList.toggle('hidden', viewName !== 'profile');
            }
            if(viewName === 'rekap') { setFilterDefault(); renderRekap(); }
            if(viewName === 'profile') { 
                updateProfileInfo(); 
                renderDailyLog(); 
                renderShiftInfo();
                startGeoMonitoring(); 
            }
        }
    }

    function updateProfileInfo() {
        if (!state.user) return;
        const nameEl = document.getElementById('prof-name');
        if(nameEl) nameEl.innerText = state.user;
        const navSet = document.getElementById('nav-settings');
        if(navSet) {
            if(state.user === 'ADMIN') navSet.classList.remove('hidden');
            else navSet.classList.add('hidden');
        }
        const officer = state.data.descriptors ? state.data.descriptors.find(d => d.name === state.user) : null;
        const nipEl = document.getElementById('prof-nip');
        if (officer && officer.nip && nipEl) nipEl.innerText = `NRPK. ${officer.nip}`;
        const avatar = document.getElementById('prof-avatar');
        if(avatar) avatar.innerText = state.user.charAt(0).toUpperCase();
        calculateMonthlyAttendance();
    }

    function calculateMonthlyAttendance() {
        if (!state.user || !state.data.logs) return;
        const now = new Date();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const year = now.getFullYear().toString();
        const monthlyLogs = state.data.logs.filter(l => {
            const p = l.date.split('/');
            return l.name === state.user && p[1] === month && p[2] === year;
        });
        const daysPresent = new Set(monthlyLogs.map(l => l.date)).size;
        const workDays = 22; 
        const pct = Math.min(Math.round((daysPresent / workDays) * 100), 100);
        const pctEl = document.getElementById('monthly-attendance-pct');
        if(pctEl) pctEl.innerText = pct + "%";
    }

    async function fetchData() {
        try {
            const res = await callGAS('getData');
            state.data = res;
            const cfg = res.config || {};
            if(cfg.LAT && cfg.LNG) {
                TARGET_LOC.lat = parseFloat(cfg.LAT);
                TARGET_LOC.lng = parseFloat(cfg.LNG);
                TARGET_LOC.radius = parseInt(cfg.RADIUS) || 100;
            }
            const isMT = cfg.MAINTENANCE === true || cfg.MAINTENANCE === "true";
            const maintenanceModal = document.getElementById('modal-maintenance');
            if (maintenanceModal) maintenanceModal.classList.toggle('hidden', !isMT);
            renderUserSelect();
            if(state.user) { 
                renderDailyLog(); 
                renderRekap(); 
                updateProfileInfo(); 
                renderShiftInfo(); 
            }
        } catch (e) { console.error(e); }
    }

    function renderShiftInfo() {
        const titleEl = document.getElementById('shift-day-title');
        const container = document.getElementById('shift-items-container');
        const footerNote = document.getElementById('shift-footer-note');
        const badge = document.getElementById('session-indicator-badge');
        const badgeText = document.getElementById('session-badge-text');
        const countdownEl = document.getElementById('countdown-pulang');
        const now = new Date();
        const day = now.getDay(); 
        const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        if(titleEl) titleEl.innerText = `Jadwal Hari ${dayNames[day]}`;
        if (day === 0 || day === 6) {
            if(container) {
                container.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-4 bg-red-50 rounded-2xl border border-red-100">
                        <span class="text-2xl mb-1">🏠</span>
                        <p class="text-[10px] font-black text-red-600 uppercase tracking-widest">Jadwal Kerja Tutup</p>
                        <p class="text-[8px] font-bold text-red-400 uppercase mt-1">Sabtu & Minggu Libur</p>
                    </div>
                `;
            }
            if(footerNote) footerNote.style.display = 'none';
            if(badge && badgeText) {
                badge.classList.remove('active', 'waiting');
                badge.classList.add('closed');
                badgeText.innerText = "Sistem Libur";
            }
            if(countdownEl) countdownEl.innerText = "Libur";
            return;
        }
        if(footerNote) footerNote.style.display = 'block';
        const cfg = state.data.config || {};
        if (!cfg.SHIFT_DATA) return;
        try {
            const shift = typeof cfg.SHIFT_DATA === 'string' ? JSON.parse(cfg.SHIFT_DATA) : cfg.SHIFT_DATA;
            const isFriday = (day === 5);
            const data = isFriday ? shift.fri : shift.reg;
            if(container) {
                container.innerHTML = `
                    <div class="shift-item">
                        <span class="shift-label">Buka Absen Masuk</span>
                        <span class="shift-value">${data.inStart}</span>
                    </div>
                    <div class="shift-item">
                        <span class="shift-label">Batas Terlambat</span>
                        <span class="shift-value highlight">${data.inLate}</span>
                    </div>
                    <div class="shift-item">
                        <span class="shift-label">Sesi Absen Pulang</span>
                        <span class="shift-value">${data.outStart} s/d ${data.outEnd}</span>
                    </div>
                `;
            }
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const parse = (t) => {
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            };
            const inS = parse(data.inStart);
            const inL = parse(data.inLate);
            const outS = parse(data.outStart);
            const outE = parse(data.outEnd);
            
            // Logika Status Sesi Real-Time
            if (badge && badgeText) {
                badge.classList.remove('active', 'waiting', 'closed');
                if (currentTime >= inS && currentTime <= inL) {
                    badge.classList.add('active');
                    badgeText.innerText = "SESI MASUK TERBUKA";
                } else if (currentTime >= outS && currentTime <= outE) {
                    badge.classList.add('active');
                    badgeText.innerText = "SESI PULANG TERBUKA";
                } else if (currentTime < inS) {
                    badge.classList.add('waiting');
                    badgeText.innerText = `MENUNGGU MASUK (${data.inStart})`;
                } else if (currentTime > inL && currentTime < outS) {
                    badge.classList.add('waiting');
                    badgeText.innerText = `MENUNGGU PULANG (${data.outStart})`;
                } else {
                    badge.classList.add('closed');
                    badgeText.innerText = "SESI ABSENSI TUTUP";
                }
            }

            if(countdownEl) {
                if(currentTime < outS) {
                    const diff = outS - currentTime;
                    const h = Math.floor(diff / 60);
                    const m = diff % 60;
                    countdownEl.innerText = `${h}j ${m}m lagi`;
                } else if (currentTime >= outS && currentTime <= outE) {
                    countdownEl.innerText = "Sesi Pulang!";
                    countdownEl.classList.add('text-emerald-400');
                } else {
                    countdownEl.innerText = "Selesai";
                }
            }
        } catch(e) { console.log("Shift parse error", e); }
    }

    function openShiftModal() {
        triggerHaptic("confirm");
        const now = new Date();
        const day = now.getDay();
        const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        const modalTitle = document.getElementById('modal-shift-day-text');
        const modalContainer = document.getElementById('modal-shift-details-container');
        if(modalTitle) modalTitle.innerText = `Jadwal Operasional ${dayNames[day]}`;
        if (day === 0 || day === 6) {
            if(modalContainer) {
                modalContainer.innerHTML = `
                    <div class="bg-red-50 p-6 rounded-2xl border border-red-100 text-center">
                        <p class="text-sm font-black text-red-600 uppercase mb-1">Hari Libur</p>
                        <p class="text-[9px] font-bold text-red-400 uppercase leading-relaxed">Pelayanan administratif dan absensi rutin tutup pada hari Sabtu & Minggu.</p>
                    </div>
                `;
            }
            document.getElementById('modal-shift-info').style.display = 'flex';
            return;
        }
        const cfg = state.data.config || {};
        if (!cfg.SHIFT_DATA) return showAlert("Opps", "Data jadwal belum tersedia.");
        try {
            const shift = typeof cfg.SHIFT_DATA === 'string' ? JSON.parse(cfg.SHIFT_DATA) : cfg.SHIFT_DATA;
            const isFriday = (day === 5);
            const data = isFriday ? shift.fri : shift.reg;
            if(modalContainer) {
                modalContainer.innerHTML = `
                    <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <p class="text-[8px] font-black text-slate-400 uppercase mb-2">Sesi Masuk</p>
                        <div class="flex justify-between items-end">
                            <span class="text-lg font-black text-slate-800">${data.inStart}</span>
                            <span class="text-[9px] font-bold text-slate-400 italic">Hingga <span class="text-pink-600">${data.inLate}</span></span>
                        </div>
                    </div>
                    <div class="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <p class="text-[8px] font-black text-slate-400 uppercase mb-2">Sesi Pulang</p>
                        <div class="flex justify-between items-end">
                            <span class="text-lg font-black text-slate-800">${data.outStart} - ${data.outEnd}</span>
                            <span class="text-[9px] font-bold text-slate-400 italic">Waktu Pulang</span>
                        </div>
                    </div>
                `;
            }
            document.getElementById('modal-shift-info').style.display = 'flex';
        } catch(e) { showAlert("Error", "Gagal membaca jadwal."); }
    }

    function closeShiftModal() { document.getElementById('modal-shift-info').style.display = 'none'; }

    function setFilterDefault() {
        const now = new Date();
        const bulan = (now.getMonth() + 1).toString().padStart(2, '0');
        const tahun = now.getFullYear().toString();
        const fB = document.getElementById('filter-bulan');
        const fT = document.getElementById('filter-tahun');
        const fD = document.getElementById('filter-tanggal');
        const fS = document.getElementById('filter-status');
        if(fB) fB.value = bulan;
        if(fT) fT.value = tahun;
        if(fD) fD.value = "";
        if(fS) fS.value = "SEMUA";
    }

    function handleFilterChange(trigger) { 
        if (trigger === 'date') { 
            const dV = document.getElementById('filter-tanggal');
            const dateVal = dV ? dV.value : ""; 
            if (dateVal) { 
                const d = new Date(dateVal); 
                const fB = document.getElementById('filter-bulan');
                const fT = document.getElementById('filter-tahun');
                if(fB) fB.value = (d.getMonth() + 1).toString().padStart(2, '0'); 
                if(fT) fT.value = d.getFullYear().toString(); 
            } 
        } else if (trigger === 'month' || trigger === 'year') {
            const fD = document.getElementById('filter-tanggal');
            if (fD) fD.value = "";
        }
        renderRekap(); 
    }

    function renderRekap() {
        const tbody = document.getElementById('rekap-table-body');
        const ownerNameEl = document.getElementById('rekap-owner-name');
        if(!tbody) return;
        const filterBulan = document.getElementById('filter-bulan').value; 
        const filterTahun = document.getElementById('filter-tahun').value;
        const filterTanggal = document.getElementById('filter-tanggal').value; 
        const filterStatus = document.getElementById('filter-status').value;
        if (ownerNameEl) ownerNameEl.innerText = state.user || "User";
        const grouped = {};
        let formattedDateFilter = "";
        if (filterTanggal) {
            const d = new Date(filterTanggal);
            const dd = d.getDate().toString().padStart(2, '0');
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const yyyy = d.getFullYear();
            formattedDateFilter = `${dd}/${mm}/${yyyy}`;
        }
        state.data.logs.forEach(l => {
            if (l.name !== state.user) return;
            const dateParts = l.date.split('/'); 
            if (dateParts.length < 3) return;
            const logDay = dateParts[0].padStart(2, '0'); 
            const logMonth = dateParts[1].padStart(2, '0'); 
            const logYear = dateParts[2];
            if (formattedDateFilter) { 
                if (l.date !== formattedDateFilter) return; 
            } else { 
                if (logMonth !== filterBulan || logYear !== filterTahun) return; 
            }
            if (filterStatus !== "SEMUA") {
                if (filterStatus === "HADIR" && l.type === "DL") return;
                if (filterStatus === "DL" && l.type !== "DL") return;
                if (filterStatus === "TERLAMBAT" && (!l.status || !l.status.includes("TERLAMBAT"))) return;
            }
            const key = `${l.date}_${l.name}`;
            if (!grouped[key]) { 
                grouped[key] = { 
                    name: l.name, 
                    date: l.date, 
                    masuk: "-", 
                    pulang: "-", 
                    ket: "-", 
                    timestamp: new Date(logYear, parseInt(logMonth) - 1, parseInt(logDay)).getTime() 
                }; 
            }
            const fixedTime = formatTimeFix(l.time);
            if (l.type === "MASUK") grouped[key].masuk = fixedTime;
            if (l.type === "PULANG") grouped[key].pulang = fixedTime;
            if (l.type === "DL") { 
                grouped[key].masuk = "DL"; 
                grouped[key].pulang = "DL"; 
                grouped[key].ket = l.note || "DINAS LUAR"; 
            }
            if (l.status && l.status.includes("TERLAMBAT")) grouped[key].ket = l.status;
        });
        const resultArr = Object.values(grouped).sort((a, b) => b.timestamp - a.timestamp);
        tbody.innerHTML = resultArr.length > 0 ? resultArr.map(r => {
            return `<tr class="my-row"><td>${r.name}</td><td>${r.date}</td><td>${r.masuk} - ${r.pulang}</td><td>${r.ket}</td></tr>`;
        }).join('') : '<tr><td colspan="4" class="text-center py-10 text-slate-400 font-bold uppercase">Data tidak ditemukan</td></tr>';
    }

    async function callGAS(method, args = []) {
        const fetchUrl = `${WEB_APP_URL}?action=${method}&data=${encodeURIComponent(JSON.stringify(args))}`;
        try {
            const response = await fetch(fetchUrl);
            return await response.json();
        } catch (e) { showAlert("Error", "Gagal koneksi server."); throw e; }
    }

    function handleAdminTrigger() {
        state.adminTriggerCount++;
        triggerHaptic("confirm");
        if (state.adminTriggerCount >= 3) {
            state.adminModeEnabled = !state.adminModeEnabled; 
            state.adminTriggerCount = 0;
            soundSuccess();
            if (state.adminModeEnabled) {
                showAlert("Sistem Terbuka", "Mode Admin Aktif ✨");
                document.getElementById('select-user').classList.remove('hidden');
            } else {
                showAlert("Sistem Terkunci", "Mode Admin Nonaktif 🔒");
                document.getElementById('select-user').classList.add('hidden');
            }
            renderUserSelect();
        }
    }

    function renderUserSelect() {
        const sel = document.getElementById('select-user');
        if(!sel) return;
        let html = '<option value="">-- Menu Khusus --</option>';
        const canReg = state.data.config.ALLOW_REG === true || state.data.config.ALLOW_REG === "true";
        if (state.adminModeEnabled) {
            html += '<option value="ADMIN" style="color:#db2777; font-weight:bold;">🛠️ LOGIN ADMIN MANUAL</option>';
            if(canReg) html += '<option value="NEW_REGISTER" style="color:blue; font-weight:bold;">+ DAFTAR AKUN BARU</option>';
            if (state.data && state.data.officers) {
                html += state.data.officers.map(o => `<option value="${o}">${o}</option>`).join('');
            }
        }
        sel.innerHTML = html;
    }

    async function getCameraStream(targetId) {
        try {
            const videoEl = document.getElementById(targetId);
            if (state.stream) { state.stream.getTracks().forEach(track => track.stop()); }
            const constraints = { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } };
            state.stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoEl.srcObject = state.stream;
            return new Promise((resolve) => {
                videoEl.onloadedmetadata = () => { videoEl.play(); resolve(true); };
            });
        } catch (err) {
            showAlert("Gagal Kamera", "Izin kamera diperlukan.");
            return false;
        }
    }

    function isFaceAligned(detection, videoWidth, videoHeight) {
        if (!detection) return { aligned: false, status: "MENCARI WAJAH...", scale: 1.0 };
        const { x, y, width, height } = detection.detection.box;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const isCentered = (centerX > videoWidth * 0.25 && centerX < videoWidth * 0.75) && (centerY > videoHeight * 0.25 && centerY < videoHeight * 0.75);
        let targetScale = 1.0;
        const faceWidthRatio = width / videoWidth;
        if (faceWidthRatio < 0.30) targetScale = 2.0; 
        else if (faceWidthRatio > 0.60) targetScale = 0.8; 
        else targetScale = 1.2; 
        if (!isCentered) return { aligned: false, status: "WAJAH DI TENGAH", scale: targetScale };
        if (width < videoWidth * 0.2) return { aligned: false, status: "TERLALU JAUH", scale: targetScale };
        if (width > videoWidth * 0.7) return { aligned: false, status: "TERLALU DEKAT", scale: targetScale };
        return { aligned: true, status: "POSISI SEMPURNA ✅", scale: targetScale };
    }

    function checkShiftTime() {
        const now = new Date();
        const day = now.getDay(); 
        if (day === 0 || day === 6) return { allow: false, msg: "Hari ini libur (Sabtu/Minggu)." };
        const currentTime = now.getHours() * 60 + now.getMinutes(); 
        const cfg = state.data.config || {};
        if (!cfg.SHIFT_DATA) return { allow: true }; 
        const shift = typeof cfg.SHIFT_DATA === 'string' ? JSON.parse(cfg.SHIFT_DATA) : cfg.SHIFT_DATA;
        const isFriday = (day === 5);
        const data = isFriday ? shift.fri : shift.reg;
        const parse = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        const inStart = parse(data.inStart);
        const inLateLimit = parse(data.inLate);
        const outStart = parse(data.outStart);
        const outEnd = parse(data.outEnd);
        const isMasukTime = currentTime >= inStart && currentTime <= inLateLimit;
        const isPulangTime = currentTime >= outStart && currentTime <= outEnd;
        if (isMasukTime) return { allow: true, type: "MASUK" };
        if (isPulangTime) return { allow: true, type: "PULANG" };
        let msg = (currentTime < inStart) ? `Sesi belum dibuka. Kembali jam ${data.inStart}.` : 
                  (currentTime > inLateLimit && currentTime < outStart) ? `Batas terlambat lewat. Pulang jam ${data.outStart}.` : 
                  (currentTime > outEnd) ? "Sesi hari ini ditutup." : "Bukan jadwal absensi.";
        return { allow: false, msg: msg };
    }

    function handleAttendanceTrigger() {
        triggerHaptic("confirm");
        const todayStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Makassar' }).replace(/\./g, '/');
        if (state.data.logs.some(l => l.name === state.user && l.date === todayStr && l.type === "DL")) {
            showAlert("Ditolak", "Anda sudah DINAS LUAR hari ini.");
            return;
        }
        const timeCheck = checkShiftTime();
        if (!timeCheck.allow) { showAlert("Ditolak", timeCheck.msg); return; }
        const bypassGPS = state.data.config.BYPASS_GPS === true || state.data.config.BYPASS_GPS === "true";
        if (!bypassGPS) {
            if (!state.currentLocation) { showAlert("Opps", "Mendeteksi koordinat GPS..."); return; }
            const currentDist = calculateDistance(state.currentLocation.coords.latitude, state.currentLocation.coords.longitude, TARGET_LOC.lat, TARGET_LOC.lng);
            if (currentDist > TARGET_LOC.radius) { showRadiusModal(currentDist); return; }
        }
        startFaceAuth('ABSENSI');
    }

    function showRadiusModal(dist) {
        soundError(); triggerHaptic("error");
        document.getElementById('radius-distance-val').innerText = `${dist} Meter`;
        document.getElementById('radius-limit-val').innerText = TARGET_LOC.radius;
        document.getElementById('modal-radius-error').style.display = 'flex';
    }
    function closeRadiusModal() { document.getElementById('modal-radius-error').style.display = 'none'; }

    async function startFaceAuth(mode) {
        state.authMode = mode;
        triggerHaptic("confirm");
        const val = document.getElementById('select-user').value;
        if (mode === 'LOGIN' && val === 'NEW_REGISTER') return openRegister();
        if (mode === 'LOGIN' && val === 'ADMIN') return openAdminLogin();
        if(!state.modelsLoaded) { showLoading(true, "Menyiapkan AI..."); await loadModels(); showLoading(false); }
        document.getElementById('face-modal-title').innerText = mode === 'LOGIN' ? "Verifikasi Masuk" : "Verifikasi Absensi";
        document.getElementById('modal-face').style.display = 'flex';
        if (!(await getCameraStream('video-preview'))) return closeFaceModal();
        document.getElementById('face-scanner-line').style.display = 'block';
        detectFaceLoop();
    }

    async function detectFaceLoop() {
        const video = document.getElementById('video-preview');
        const btn = document.getElementById('btn-face-action');
        const statusEl = document.getElementById('face-status-text');
        const oval = document.getElementById('login-oval');
        if (!state.stream || !video || video.paused || document.getElementById('modal-face').style.display === 'none') return;
        const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 }))
                                    .withFaceLandmarks().withFaceDescriptor();
        const alignment = isFaceAligned(detection, video.videoWidth, video.videoHeight);
        video.style.transform = `scaleX(-1) scale(${alignment.scale})`;
        if (alignment.aligned) {
            state.currentDescriptor = detection.descriptor;
            if(oval) oval.classList.add('valid');
            if(statusEl) { statusEl.innerText = alignment.status; statusEl.className = "text-[8px] text-center mt-4 font-bold text-emerald-500 uppercase"; }
            if(btn) { btn.disabled = false; btn.innerText = state.authMode === 'LOGIN' ? "KENALI SAYA & MASUK" : "KONFIRMASI ABSENSI"; }
        } else {
            if(oval) { oval.classList.remove('valid'); if (detection) oval.classList.add('invalid'); }
            if(statusEl) { statusEl.innerText = alignment.status; statusEl.className = "text-[8px] text-center mt-4 font-bold text-red-400 uppercase"; }
            if(btn) { btn.disabled = true; btn.innerText = "MENUNGGU WAJAH..."; }
            state.faceDetectionFrame = requestAnimationFrame(detectFaceLoop);
        }
    }

    async function confirmFaceAuth() {
        triggerHaptic("confirm");
        const btn = document.getElementById('btn-face-action');
        if(btn) btn.disabled = true;
        let selectedUser = document.getElementById('select-user').value;
        const threshold = parseFloat(state.data.config.THRESHOLD) || 0.1;
        try {
            let matchedUser = null;
            if (state.authMode === 'ABSENSI') {
                const off = state.data.descriptors.find(d => d.name === state.user);
                if (off && (new faceapi.FaceMatcher(new Float32Array(JSON.parse(off.descriptor)), threshold)).findBestMatch(state.currentDescriptor).label !== 'unknown') matchedUser = state.user;
            } else if (selectedUser && selectedUser !== "ADMIN" && selectedUser !== "NEW_REGISTER") {
                const off = state.data.descriptors.find(d => d.name === selectedUser);
                if (off && (new faceapi.FaceMatcher(new Float32Array(JSON.parse(off.descriptor)), threshold)).findBestMatch(state.currentDescriptor).label !== 'unknown') matchedUser = selectedUser;
            } else {
                for (const off of state.data.descriptors) {
                    if ((new faceapi.FaceMatcher(new Float32Array(JSON.parse(off.descriptor)), threshold)).findBestMatch(state.currentDescriptor).label !== 'unknown') { matchedUser = off.name; break; }
                }
            }
            if (matchedUser) {
                closeFaceModal(); 
                if (state.authMode === 'LOGIN') {
                    state.user = matchedUser; localStorage.setItem('gardena_user', matchedUser);
                    setTimeout(() => showView('profile'), 300); showAlert("Berhasil", "Selamat datang, " + matchedUser);
                } else { processAttendance("FACE"); }
            } else { 
                soundError(); triggerHaptic("error"); showAlert("Akses Ditolak", "Wajah tidak dikenali!"); 
                if(btn) { btn.disabled = false; btn.innerText = "COBA LAGI"; } detectFaceLoop();
            }
        } catch (e) { soundError(); showAlert("Error", "Gagal memproses AI."); if(btn) btn.disabled = false; }
    }

    function openAdminLogin() { document.getElementById('modal-admin-login').style.display = 'flex'; document.getElementById('admin-pin').value = ""; }
    function closeAdminLogin() { document.getElementById('modal-admin-login').style.display = 'none'; const s = document.getElementById('select-user'); if(s) s.value = ""; }
    function processAdminLogin() { if (document.getElementById('admin-pin').value === ADMIN_PASSWORD) { window.location.href = 'dasbordadmin.html'; } else { showAlert("Ditolak", "PIN Salah!"); } }

    function openLogoutModal() { triggerHaptic("confirm"); document.getElementById('modal-logout').style.display = 'flex'; }
    function closeLogoutModal() { document.getElementById('modal-logout').style.display = 'none'; }
    function logout() { 
        triggerHaptic("confirm"); if(state.geoWatchId) navigator.geolocation.clearWatch(state.geoWatchId);
        localStorage.removeItem('gardena_user'); state.user = null; state.adminModeEnabled = false; 
        document.getElementById('select-user').classList.add('hidden'); closeLogoutModal(); showView('login'); renderUserSelect();
    }

    function closeFaceModal() {
        if(state.stream) state.stream.getTracks().forEach(t => t.stop());
        if(state.faceDetectionFrame) cancelAnimationFrame(state.faceDetectionFrame);
        state.stream = null; document.getElementById('modal-face').style.display = 'none';
        document.getElementById('face-scanner-line').style.display = 'none';
    }

    function handleSelectChange(v) { triggerHaptic("confirm"); if (v === 'NEW_REGISTER') openRegister(); if (v === 'ADMIN') openAdminLogin(); }

    async function openRegister() {
        if(!state.modelsLoaded) { showLoading(true, "Menyiapkan AI..."); await loadModels(); showLoading(false); }
        document.getElementById('modal-register').style.display = 'flex';
        if (await getCameraStream('video-register')) { document.getElementById('reg-scanner-line').style.display = 'block'; detectFaceLoopRegister(); }
    }

    async function detectFaceLoopRegister() {
        const v = document.getElementById('video-register');
        const b = document.getElementById('btn-reg-save');
        const s = document.getElementById('reg-status-text');
        const o = document.getElementById('reg-oval');
        if (!state.stream || !v || v.paused || document.getElementById('modal-register').style.display === 'none') return;
        const d = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.5 })).withFaceLandmarks().withFaceDescriptor();
        const a = isFaceAligned(d, v.videoWidth, v.videoHeight);
        v.style.transform = `scaleX(-1) scale(${a.scale})`;
        if (a.aligned) {
            state.currentDescriptor = d.descriptor; if(o) o.classList.add('valid');
            if(s) { s.innerText = a.status; s.className = "text-[8px] text-center font-bold text-emerald-500 uppercase"; }
            if(b) b.disabled = false;
        } else {
            if(o) { o.classList.remove('valid'); if (d) o.classList.add('invalid'); }
            if(s) { s.innerText = a.status; s.className = "text-[8px] text-center font-bold text-red-400 uppercase"; }
            if(b) b.disabled = true; state.faceDetectionFrame = requestAnimationFrame(detectFaceLoopRegister);
        }
    }

    function closeRegister() {
        if(state.stream) state.stream.getTracks().forEach(t => t.stop());
        if(state.faceDetectionFrame) cancelAnimationFrame(state.faceDetectionFrame);
        state.stream = null; document.getElementById('modal-register').style.display = 'none';
        const sel = document.getElementById('select-user'); if(sel) sel.value = "";
    }

    async function processRegister() {
        triggerHaptic("confirm"); const b = document.getElementById('btn-reg-save'); if(b) b.disabled = true;
        const n = document.getElementById('reg-nama').value; const ni = document.getElementById('reg-nip').value;
        if (!n || !ni) { if(b) b.disabled = false; return showAlert("Gagal", "Data wajib lengkap!"); }
        showLoading(true, "Mendaftarkan...");
        try {
            await callGAS('addOfficer', [n, ni, JSON.stringify(Array.from(state.currentDescriptor))]);
            showAlert("Berhasil", "Terdaftar!"); closeRegister(); fetchData();
        } catch (e) { showLoading(false); if(b) b.disabled = false; }
    }

    function openDLModal() {
        triggerHaptic("confirm");
        const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Makassar' }).replace(/\./g, '/');
        if (state.data.logs.some(l => l.name === state.user && l.date === today && (l.type === "MASUK" || l.type === "PULANG"))) { showAlert("Opps", "Sudah absen rutin. Fitur DL terkunci."); return; }
        if (!checkShiftTime().allow) { showAlert("Ditolak", checkShiftTime().msg); return; }
        document.getElementById('modal-dl').style.display = 'flex';
    }
    
    function closeDLModal() { 
        document.getElementById('modal-dl').style.display = 'none'; 
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const a = document.getElementById(`nav-${state.currentView}`); if(a) a.classList.add('active');
    }
    
    async function processDL() {
        triggerHaptic("confirm"); const b = document.getElementById('btn-dl-submit'); if (state.isProcessing) return;
        const k = document.getElementById('dl-keterangan'); const kv = k ? k.value : "-"; if(!kv || kv === "-") return showAlert("Opps", "Isi keterangan!");
        const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Makassar' }).replace(/\./g, '/');
        if (state.data.logs.some(l => l.name === state.user && l.date === today && l.type === "DL")) return showAlert("Ditolak", "Hari ini sudah DL!");
        if(b) b.disabled = true;
        navigator.geolocation.getCurrentPosition((p) => { state.currentLocation = p; closeDLModal(); processAttendance("DL", kv); }, () => { closeDLModal(); processAttendance("DL", kv); });
    }

    async function processAttendance(m, n = "-") {
        if (state.isProcessing) return; state.isProcessing = true; 
        const tc = checkShiftTime(); if (!tc.allow) { state.isProcessing = false; showAlert("Ditolak", tc.msg); return; }
        const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Makassar' }).replace(/\./g, '/');
        const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).replace('.', ':');
        let t = (m === "DL") ? "DL" : tc.type;
        if (state.data.logs.filter(l => l.name === state.user && l.date === today).some(l => l.type === t)) { state.isProcessing = false; return showAlert("Ditolak", `Sudah absen ${t}!`); }
        showLoading(true, `Mencatat ${t}...`);
        try { 
            await callGAS('saveAttendance', [{ 
                name: state.user, type: t, note: n, 
                accuracy: state.currentLocation ? Math.round(state.currentLocation.coords.accuracy) : 0,
                coord: state.currentLocation ? `${state.currentLocation.coords.latitude},${state.currentLocation.coords.longitude}` : "No-GPS",
                clientTime: timeStr 
            }]); 
            showAlert("Berhasil", `${t} Dicatat ✨`); await fetchData(); 
        } catch (e) { soundError(); showAlert("Error", "Gagal menyimpan."); } finally { state.isProcessing = false; showLoading(false); }
    }

    function renderDailyLog() {
        const c = document.getElementById('daily-log-container'); const m = document.getElementById('home-ket-masuk'); const p = document.getElementById('home-ket-pulang');
        const rm = document.getElementById('ring-masuk'); const rp = document.getElementById('ring-pulang');
        if(!c) return; if (state.isRefreshing) { c.innerHTML = `<div class="skeleton skeleton-log"></div>`; return; }
        const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Makassar' }).replace(/\./g, '/');
        const logs = state.data.logs.filter(l => l.name === state.user);
        const lastDate = [...new Set(logs.map(l => l.date))].sort((a, b) => { const da = a.split('/'); const db = b.split('/'); return new Date(db[2], db[1]-1, db[0]) - new Date(da[2], da[1]-1, da[0]); })[0];
        const displayLogs = logs.filter(l => l.date === lastDate);
        if(m) m.innerText = "--:--"; if(p) p.innerText = "--:--"; if(rm) rm.classList.remove('ring-active'); if(rp) rp.classList.remove('ring-active');
        if (displayLogs.length > 0) {
            c.innerHTML = displayLogs.map(l => {
                const ft = formatTimeFix(l.time);
                if(lastDate === today) {
                    if (l.type === 'MASUK' || l.type === 'DL') { if(m) m.innerText = l.type === 'DL' ? "DL" : ft; if(rm) rm.classList.add('ring-active'); }
                    if (l.type === 'PULANG' || l.type === 'DL') { if(p) p.innerText = l.type === 'DL' ? "DL" : ft; if(rp) rp.classList.add('ring-active'); }
                }
                return `<div class="log-card"><div class="flex items-center gap-3"><div><p class="text-[10px] font-black uppercase">${l.type}</p><p class="text-[8px] text-slate-400 font-bold">${l.date} | ${ft}</p></div></div><span class="text-[7px] font-black px-2 py-1 rounded-lg bg-white border ${l.status?.includes('TERLAMBAT') ? 'text-red-500' : 'text-emerald-500'}">${l.status || 'OK'}</span></div>`;
            }).join('');
        } else { c.innerHTML = '<div class="text-center py-6 text-[9px] font-bold text-slate-300 uppercase">Belum ada riwayat</div>'; }
    }

    function downloadExcel() { 
        const t = document.getElementById('table-to-download');
        XLSX.writeFile(XLSX.utils.table_to_book(t, { sheet: "Rekap" }), `REKAP_${state.user}_${new Date().getTime()}.xlsx`); 
    }

    window.onload = async () => { 
        checkAppVersion(); 
        detectPlatform(); 
        loadModels(); 
        
        // Asynchronous Background Sync
        fetchData().then(() => {
            console.log("Background Sync Completed");
        }).catch(err => {
            console.error("Background Sync Failed", err);
        });

        setTimeout(() => { 
            const s = document.getElementById('splash-screen'); 
            if(s) s.classList.add('fade-out'); 
            if(state.user) {
                showView(state.user === 'ADMIN' ? 'rekap' : 'profile');
            }
        }, 3000); 

        setInterval(() => { 
            const c = document.getElementById('clock-display'); 
            if(c) { 
                c.innerText = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Makassar' }).replace('.', ':'); 
                if(state.currentView === 'profile') renderShiftInfo(); 
            } 
        }, 1000); 
    };

    window.addEventListener('online', () => { const b = document.getElementById('offline-banner'); if(b) b.style.display = 'none'; });
    window.addEventListener('offline', () => { const b = document.getElementById('offline-banner'); if(b) b.style.display = 'block'; });
