import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
const supabaseUrl = 'https://cawrvnutflgvbrisuqtd.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhd3J2bnV0ZmxndmJyaXN1cXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNDcwODgsImV4cCI6MjA4MTYyMzA4OH0.ZLSVVcZUl2muc584TL_UIYxykjrf_F_dOtDJp53A3cU'
const supabase = createClient(supabaseUrl, supabaseKey)

let currentSchoolId = null;
let currentSchoolCode = ""; 
let allStudents = [];
let todayAttendance = [];
let allStaff = [];
let todayStaffAttendance = [];
let currentMode = 'MURID'; 
let currentMuridStatusFilter = 'ALL'; // ALL, HADIR, LEWAT, ABSENT
let currentStaffStatusFilter = 'ALL'; // ALL, ACTIVE, DONE, ABSENT
let schoolStartTime = "07:30:00"; // Default fallback

// Utility
function id(name) { return document.getElementById(name); }

// --- AUTH & INITIALIZATION ---
const loginForm = id('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailEl = id('email');
        const passEl = id('password');
        
        if (!emailEl || !passEl) return;

        const { data, error } = await supabase.auth.signInWithPassword({
            email: emailEl.value,
            password: passEl.value
        });
        
        if (error) alert(error.message);
        else if (data?.user) initializeDashboard(data.user.id);
    });
}

// --- PASSWORD VISIBILITY TOGGLE ---
const togglePassword = id('toggle-password');
const passwordInput = id('password');

if (togglePassword && passwordInput) {
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        // Tukar ikon
        togglePassword.classList.toggle('fa-eye');
        togglePassword.classList.toggle('fa-eye-slash');
    });
}

// --- NEW GLOBAL UTILITIES ---
window.toggleSelectAll = (source) => {
    const checkboxes = document.querySelectorAll('.row-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
    window.updateBatchButton();
};

window.updateBatchButton = () => {
    const selected = document.querySelectorAll('.row-checkbox:checked');
    const btn = id('btn-batch-delete');
    const countDisplay = id('selected-count');
    
    if (countDisplay) countDisplay.innerText = selected.length;
    if (btn) btn.classList.toggle('hidden', selected.length === 0);
};

window.deleteSelectedRecords = async (mode) => {
    const selected = document.querySelectorAll('.row-checkbox:checked');
    const records = Array.from(selected).map(cb => ({
        id: parseInt(cb.dataset.id),
        barcode: cb.dataset.barcode 
    }));

    if (records.length === 0) return;
    // if (!confirm(`Padam ${records.length} rekod terpilih? Gambar profil juga akan dipadamkan secara kekal.`)) return;

    const batchWarning = `Padam ${records.length} rekod terpilih? Semua DATA KEHADIRAN berkaitan dan gambar profil akan dipadamkan secara kekal.`;
    if (!confirm(batchWarning)) return;
    
    // --- CAPTURE CURRENT FILTER ---
    const savedClassFilter = id('manage-class-dropdown')?.value || "";
    const savedStaffFilter = id('manage-staff-type-filter')?.value || "ALL";

    const btn = id('btn-batch-delete');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memadam...';

    try {
        const table = mode === 'MURID' ? 'students' : 'teachers';
        const bucket = mode === 'MURID' ? 'students' : 'teachers';
        const ids = records.map(r => r.id);
        
        // 1. Delete Images
        const folderPath = currentSchoolCode.trim();
        const filePaths = records.map(r => `${folderPath}/${r.barcode}.jpg`);
        await supabase.storage.from(bucket).remove(filePaths);

        // 2. Delete Database Records
        const { error: dbErr } = await supabase.from(table).delete().in('id', ids);
        if (dbErr) throw dbErr;
        
        alert(`${records.length} rekod berjaya dipadamkan.`);
        
        // 3. REFRESH & RESTORE FILTER 
        // We await these so 'allStudents' or 'allStaff' arrays are updated first
        if (mode === 'MURID') {
            await refreshClassDropdown();
            if (id('manage-class-dropdown')) id('manage-class-dropdown').value = savedClassFilter;
        } else {
            await refreshStaffTypeDropdown();
            if (id('manage-staff-type-filter')) id('manage-staff-type-filter').value = savedStaffFilter;
        }

        // 4. Reload List (Draws the table using the fresh arrays)
        await loadManagementList();
        
        // 5. Reset the Batch Button (hides it and resets count to 0)
        window.updateBatchButton(); 

    } catch (err) {
        alert("Ralat: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

async function refreshClassDropdown() {
    console.log("Fetching for School ID:", currentSchoolId); // Check if this is NULL for SKDI
    const { data: students } = await supabase
        .from('students')
        .select('*')
        .eq('school_id', currentSchoolId);
    console.log("Students found in DB for this school:", students?.length || 0);    
    allStudents = students || [];
    
    const dropdown = id('manage-class-dropdown');
    const attendanceDropdown = id('class-dropdown');
    
    const classes = [...new Set(allStudents.map(s => s.class_name_full))].filter(Boolean).sort();
    const options = classes.map(c => `<option value="${c}">${c}</option>`).join('');

    if (dropdown) dropdown.innerHTML = '<option value="">Semua Kelas</option>' + options;
    if (attendanceDropdown) {
        attendanceDropdown.innerHTML = options;
        if (attendanceDropdown.value === "" && classes.length > 0) {
            attendanceDropdown.value = classes[0];
            if (typeof fetchMuridAttendance === 'function') fetchMuridAttendance();
        }
    }
}

async function refreshStaffTypeDropdown() {
    const { data: staff } = await supabase
        .from('teachers')
        .select('*')
        .eq('school_id', currentSchoolId);
    
    allStaff = staff || [];
    
    const dropdown = id('manage-staff-type-filter');
    const types = [...new Set(allStaff.map(t => t.staff_type))].filter(Boolean).sort();
    
    if (dropdown) {
        dropdown.innerHTML = '<option value="ALL">Semua Jawatan</option>' + 
            types.map(t => `<option value="${t}">${t}</option>`).join('');
    }
}

async function initializeDashboard(userId) {
    // 1. Fetch Profile and joined School data
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('*, schools(*)')
        .eq('id', userId)
        .single();

    if (error || !profile) {
        console.error("Auth error:", error); 
        alert("Profil tidak sah atau sekolah tidak dijumpai.");
        return;
    }

    // 2. Set Global Variables from Database
    currentSchoolId = profile.school_id;
    currentSchoolCode = profile.schools?.school_code || "UNKNOWN";
    
    // Dynamically set the late threshold (defaulting to 07:30:00 if column is empty)
    schoolStartTime = profile.schools?.start_time || "07:30:00";
    
    console.log(`Authenticated: ${profile.full_name}`);
    console.log(`School: ${currentSchoolCode} (Start Time: ${schoolStartTime})`);
    
    // 3. Update UI Header Info
    const schoolDisplay = id('school-name-display');
    const adminName = id('admin-name');
    const adminRole = id('admin-role');

    if (schoolDisplay) schoolDisplay.innerText = `Hadir${currentSchoolCode}`;
    if (adminName) adminName.innerText = profile.full_name || "Admin";
    if (adminRole) adminRole.innerText = profile.role || "Penyelaras";

    // 4. Date Picker Logic
    const datePicker = id('date-picker');
    const btnToday = id('btn-today');
    const todayISO = new Date().toISOString().split('T')[0];

    if (datePicker) {
        datePicker.value = todayISO;
        datePicker.onchange = () => {
            fetchMuridAttendance();
            if (typeof loadGuruData === 'function') loadGuruData();
        };
    }

    if (btnToday) {
        btnToday.onclick = () => {
            if (datePicker && datePicker.value !== todayISO) {
                datePicker.value = todayISO;
                fetchMuridAttendance();
                if (typeof loadGuruData === 'function') loadGuruData();
            }
        };
    }

    // 5. Switch View from Login to Dashboard
    id('login-container')?.classList.add('hidden');
    id('dashboard-container')?.classList.remove('hidden');

    // 6. Initial Data Load
    await refreshClassDropdown();
    await refreshStaffTypeDropdown();
    await fetchMuridAttendance();
    
    if (typeof loadGuruData === 'function') await loadGuruData();
    if (typeof setupRealtime === 'function') setupRealtime();

    // 7. Image Preview logic
    const formImage = id('form-image');
    if (formImage) {
        formImage.onchange = (e) => {
            const file = e.target.files[0];
            const preview = id('image-preview');
            const placeholder = id('preview-placeholder');
            if (!preview || !placeholder) return;

            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    preview.src = event.target.result;
                    preview.classList.remove('hidden');
                    placeholder.classList.add('hidden');
                };
                reader.readAsDataURL(file);
            } else {
                preview.src = "";
                preview.classList.add('hidden');
                placeholder.classList.remove('hidden');
            }
        };
    }

    // 8. --- CONSOLIDATED MODAL CLOSING LOGIC ---
    const closeModalAction = () => {
        // Match IDs in index.html
        id('student-modal')?.classList.add('hidden');
        
        // Reset image previews
        const preview = id('image-preview');
        const placeholder = id('preview-placeholder');
        if (preview) { 
            preview.src = ""; 
            preview.classList.add('hidden'); 
        }
        if (placeholder) placeholder.classList.remove('hidden');
        
        // Match IDs in index.html
        id('student-form')?.reset();
        
        // Reset global edit state
        if (typeof editingId !== 'undefined') editingId = null; 
    };

    // Binding the X button logic
    const closeModalBtn = id('close-modal-x'); 
    if (closeModalBtn) {
        closeModalBtn.onclick = closeModalAction;
    }

    // Close modal if user clicks on the dark background overlay
    window.onclick = (event) => {
        const modal = id('student-modal');
        if (event.target === modal) {
            closeModalAction();
        }
    };
}

// --- NAVIGATION LOGIC ---
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const targetSectionId = e.currentTarget.getAttribute('data-section');
        
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        e.currentTarget.classList.add('active');

        document.querySelectorAll('.content-section').forEach(sec => sec.classList.add('hidden'));

        const target = id(targetSectionId);
        if (target) {
            target.classList.remove('hidden');
            window.scrollTo(0, 0);
        }

        if (targetSectionId === 'manage-section' && typeof switchManageView === 'function') switchManageView('MURID');
        if (targetSectionId === 'guru-section' && typeof renderGuruTable === 'function') renderGuruTable();
        if (targetSectionId === 'murid-section' && typeof renderMuridTable === 'function') renderMuridTable();
    });
});

async function fetchMuridAttendance() {
    const datePicker = id('date-picker');
    const selectedDate = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
        .from('students_attendance')
        .select('*')
        .eq('school_id', currentSchoolId)
        .eq('date', selectedDate);

    if (error) {
        console.error("Error fetching attendance:", error);
        return;
    }

    // Process data to inject "Late" status based on dynamic schoolStartTime
    const processedData = (data || []).map(att => {
        // Extract time from created_at (HH:MM:SS)
        const scanTime = new Date(att.created_at).toLocaleTimeString('en-GB', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });

        // Determine status: If scanTime is later than schoolStartTime, mark as LEWAT
        // Note: schoolStartTime is the global variable we updated in initializeDashboard
        const status = scanTime > schoolStartTime ? 'LEWAT' : 'HADIR';

        return {
            ...att,
            computed_status: status,
            scan_time_display: scanTime
        };
    });

    // Sort by barcode for a consistent table view
    todayAttendance = processedData.sort((a, b) => (a.barcode || "").localeCompare(b.barcode || ""));
    
    // Refresh the UI
    if (typeof renderMuridTable === 'function') renderMuridTable();
}

function renderMuridTable() {
    const classDropdown = id('class-dropdown');
    const searchInput = id('student-search-input');
    const tbody = id('murid-list-body');
    if (!classDropdown || !tbody) return;

    const selectedClass = classDropdown.value;
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    
    // Filter students by class and search search term
    const filteredStudents = allStudents.filter(s => 
        s.class_name_full === selectedClass && 
        (s.name.toLowerCase().includes(searchTerm) || s.barcode.includes(searchTerm))
    );

    // Lists for the Stats Modal
    const listHadir = [];
    const listLewat = [];
    const listAbsent = [];

    let hadirCount = 0;
    let lewatCount = 0;
    let rowsHtml = '';
    let visibleIndex = 1;

    // Ensure students are sorted by barcode for a clean table
    filteredStudents.sort((a, b) => (a.barcode || "").localeCompare(b.barcode || ""));

    filteredStudents.forEach((s) => {
        // Find if this student has an attendance record today
        const record = todayAttendance.find(a => a.student_id === s.id);
        const isHadir = !!record;
        
        // Use the dynamic status we computed during data fetching
        const isLewat = record?.computed_status === 'LEWAT';

        if (isHadir) {
            hadirCount++;
            listHadir.push(s);
            if (isLewat) {
                lewatCount++;
                listLewat.push(s);
            }
        } else {
            listAbsent.push(s);
        }

        // Apply UI Filter (from the stats card clicks if active)
        if (currentMuridStatusFilter === 'HADIR' && !isHadir) return;
        if (currentMuridStatusFilter === 'LEWAT' && !isLewat) return;
        if (currentMuridStatusFilter === 'ABSENT' && isHadir) return;

        const statusBadge = isHadir 
            ? (isLewat ? '<span class="badge warning">Lewat</span>' : '<span class="badge success">Hadir</span>')
            : '<span class="badge danger">Tidak Hadir</span>';

        // Display the scan time we formatted during fetch, or a dash if absent
        const timeDisplay = record ? record.scan_time_display : '-';

        rowsHtml += `
            <tr>
                <td>${visibleIndex++}</td>
                <td>${s.name}</td>
                <td><code class="barcode-text">${s.barcode}</code></td>
                <td>${timeDisplay}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml || '<tr><td colspan="5" style="text-align:center;">Tiada data untuk dipaparkan.</td></tr>';
    
    // Update the Stats Numbers on the Dashboard
    if (id('m-total')) id('m-total').innerText = filteredStudents.length;
    if (id('m-hadir')) id('m-hadir').innerText = hadirCount;
    if (id('m-lewat')) id('m-lewat').innerText = lewatCount;
    if (id('m-absent')) id('m-absent').innerText = filteredStudents.length - hadirCount;

    // --- SETUP CLICKABLE CARDS TO OPEN MODAL ---
    const setupCardClick = (statId, title, data) => {
        const target = id(statId);
        // TUKAR '.stat-item' KEPADA '.stat-clickable'
        const container = target?.closest('.stat-clickable'); 
        
        if (container) {
            container.style.cursor = 'pointer';
            container.onclick = () => {
                if (typeof window.openStatsModal === 'function') {
                    window.openStatsModal(title, data);
                }
            };
        }
    };

    // TAMBAH UNTUK 'JUMLAH MURID'
    setupCardClick('m-total', 'Jumlah Murid', filteredStudents); 
    setupCardClick('m-hadir', 'Senarai Murid Hadir', listHadir);
    setupCardClick('m-lewat', 'Senarai Murid Lewat', listLewat);
    setupCardClick('m-absent', 'Senarai Murid Tidak Hadir', listAbsent);
}

// Global function to trigger filtering from cards
window.filterByStatus = (status) => {
    currentMuridStatusFilter = (currentMuridStatusFilter === status) ? 'ALL' : status;
    renderMuridTable();
};

// --- GURU/AKP LOGIC ---
async function loadGuruData() {
    const datePicker = id('date-picker');
    const selectedDate = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];
    
    console.log("Searching Staff records for date:", selectedDate);

    // 1. Fetch all staff members for this school
    const { data: staff, error: staffError } = await supabase
        .from('teachers')
        .select('*')
        .eq('school_id', currentSchoolId);

    if (staffError) {
        console.error("Error fetching staff:", staffError);
        return;
    }

    // 2. Fetch attendance records for the selected date
    const { data: att, error: attError } = await supabase
        .from('teacher_attendance')
        .select('*')
        .eq('school_id', currentSchoolId)
        .eq('date', selectedDate);

    if (attError) {
        console.error("Error fetching staff attendance:", attError);
        return;
    }
    
    // 3. Process attendance to inject "Late" status based on dynamic schoolStartTime
    const processedAttendance = (att || []).map(satt => {
        // Extract time from created_at (HH:MM:SS)
        const staffScanTime = new Date(satt.created_at).toLocaleTimeString('en-GB', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });

        // Determine status: Compare against the global schoolStartTime
        const status = staffScanTime > schoolStartTime ? 'LEWAT' : 'HADIR';

        return {
            ...satt,
            computed_status: status,
            scan_time_display: staffScanTime
        };
    });

    // 4. Update global variables
    // Sorting staff by name for a consistent UI experience
    allStaff = (staff || []).sort((a, b) => (a.nama || "").localeCompare(b.nama || ""));
    todayStaffAttendance = processedAttendance;

    // 5. Refresh the UI
    if (typeof renderGuruTable === 'function') renderGuruTable();
}

function renderGuruTable(roleFilter = 'SEMUA') {
    const tbody = id('guru-list-body');
    if (!tbody) return;

    // Added 'lewat' to the stats tracker
    let stats = { total: 0, active: 0, done: 0, absent: 0, lewat: 0 };
    let htmlContent = '';
    let visibleIndex = 1;

    const listActive = [];
    const listDone = [];
    const listAbsent = [];
    const listLewat = [];

    const filteredByRole = allStaff.filter(s => roleFilter === 'SEMUA' || s.staff_type === roleFilter);

    // --- SORT BY BARCODE (Numeric Natural Sort) ---
    filteredByRole.sort((a, b) => {
        return a.barcode.localeCompare(b.barcode, undefined, { numeric: true, sensitivity: 'base' });
    });

    filteredByRole.forEach((s) => {
        const record = todayStaffAttendance.find(a => a.teacher_id === s.id);
        const isHadir = !!record;
        const isDone = !!(record && record.clock_out);
        const isActive = isHadir && !isDone;
        const isAbsent = !isHadir;
        
        // Use the computed_status from our loadGuruData fetch
        const isLewat = record?.computed_status === 'LEWAT';

        stats.total++;
        if (isActive) { stats.active++; listActive.push(s); }
        if (isDone) { stats.done++; listDone.push(s); }
        if (isAbsent) { stats.absent++; listAbsent.push(s); }
        if (isLewat) { stats.lewat++; listLewat.push(s); }

        // Filter table rows based on dashboard selection
        if (currentStaffStatusFilter === 'ACTIVE' && !isActive) return;
        if (currentStaffStatusFilter === 'DONE' && !isDone) return;
        if (currentStaffStatusFilter === 'ABSENT' && !isAbsent) return;
        if (currentStaffStatusFilter === 'LEWAT' && !isLewat) return;

        let statusText = "Tidak Hadir";
        let statusClass = "danger";
        let lateIndicator = "";
        let workHours = "-";
        
        if (record) {
            // Dynamic late check using schoolStartTime
            if (isLewat) {
                lateIndicator = `<span class="badge late-flash" style="margin-left:8px;">LEWAT</span>`;
            }

            if (isDone) {
                statusText = "Tamat Bertugas";
                statusClass = "success";
                const start = new Date(`${record.date} ${record.clock_in}`);
                const end = new Date(`${record.date} ${record.clock_out}`);
                const diffMs = end - start;
                const h = Math.floor(diffMs / 3600000);
                const m = Math.round(((diffMs % 3600000) / 60000));
                workHours = `${h}j ${m}m`;
            } else {
                statusText = "Sedang Bertugas";
                statusClass = "info";
            }
        }

        htmlContent += `
            <tr>
                <td>${visibleIndex++}</td>
                <td><img src="${s.photo_url || 'default-avatar.png'}" class="staff-img" onerror="this.src='default-avatar.png'"></td>
                <td>${s.honorific_title || ''} ${s.nama || s.name} ${lateIndicator}</td>
                <td><code class="barcode-text">${s.barcode}</code></td>
                <td>${record?.clock_in || '-'}</td>
                <td>${record?.clock_out || '-'}</td>
                <td>${workHours}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = htmlContent || '<tr><td colspan="8" style="text-align:center;">Tiada rekod.</td></tr>';

    // Update Dashboard Stats Numbers
    if (id('g-total')) id('g-total').innerText = stats.total;
    if (id('g-active')) id('g-active').innerText = stats.active;
    if (id('g-done')) id('g-done').innerText = stats.done;
    if (id('g-absent')) id('g-absent').innerText = stats.absent;
    if (id('g-lewat')) id('g-lewat').innerText = stats.lewat;

    // --- SETUP CLICKABLE CARDS TO OPEN MODAL ---
    const setupGuruClick = (statId, title, data) => {
        const target = id(statId);
        // TUKAR '.stat-item' KEPADA '.stat-clickable'
        const container = target?.closest('.stat-clickable'); 
        
        if (container) {
            container.style.cursor = 'pointer';
            container.onclick = () => {
                if (typeof window.openStatsModal === 'function') {
                    window.openStatsModal(title, data);
                }
            };
        }
    };

    // TAMBAH UNTUK 'JUMLAH GURU'
    setupGuruClick('g-total', 'Jumlah Guru/AKP', filteredByRole);
    setupGuruClick('g-active', 'Senarai Staf Sedang Bertugas', listActive);
    setupGuruClick('g-done', 'Senarai Staf Tamat Bertugas', listDone);
    setupGuruClick('g-absent', 'Senarai Staf Tidak Hadir', listAbsent);
    setupGuruClick('g-lewat', 'Senarai Staf Lewat', listLewat);
}

/**
 * Filter staff table by status (Active, Done, Absent)
 * Triggered by clicking the statistic cards
 */
window.filterStaffByStatus = (status) => {
    // If clicking the same filter again, reset to ALL
    currentStaffStatusFilter = (currentStaffStatusFilter === status) ? 'ALL' : status;
    
    // Maintain current role filter if applicable
    const activeRoleBtn = document.querySelector('#guru-filter-group .filter-btn.active');
    const role = activeRoleBtn ? activeRoleBtn.dataset.filter : 'SEMUA';
    
    renderGuruTable(role);
};

// --- PENGURUSAN DATA (MANAGEMENT) ---
let currentManageView = 'MURID'; 
let editingId = null;

window.downloadTemplate = (type) => {
    let headers = "";
    let fileName = "";
    
    if (type === 'MURID') {
        headers = "name,barcode,standard,class_label";
        fileName = "Template_Murid_HadirSekolah.csv";
    } else {
        headers = "name,barcode,honorific_title,staff_type";
        fileName = "Template_Staf_HadirSekolah.csv";
    }

    const blob = new Blob([headers], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
};

window.switchManageView = async (view) => {
    currentManageView = view;
    
    // 1. Update Tab UI
    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
    const activeTabId = view === 'MURID' ? 'view-murid-tab' : 'view-staf-tab';
    const activeTab = id(activeTabId);
    if (activeTab) activeTab.classList.add('active');
    
    // 2. Toggle Filter Groups (Updated to match your new HTML IDs)
    const muridGroup = id('filter-murid-group');
    const stafGroup = id('filter-staf-group');
    if (muridGroup) muridGroup.classList.toggle('hidden', view !== 'MURID');
    if (stafGroup) stafGroup.classList.toggle('hidden', view !== 'STAFF');

    // 3. Update Dynamic Buttons (Injected into the Row under Search)
    const actionContainer = id('dynamic-manage-actions');
    if (actionContainer) {
        if (view === 'MURID') {
            actionContainer.innerHTML = `
                <button class="btn-primary-strike" onclick="openAddMuridModal()">
                    <i class="fas fa-user-plus"></i> Murid Baru
                </button>
                <div class="import-wrapper">
                    <button class="btn-import" onclick="handleCSVImportClick()">
                        <i class="fas fa-file-upload"></i> Mass Import (CSV)
                    </button>
                    <i class="fas fa-question-circle import-help-icon" onclick="showImportHelp()" title="Bantuan Format Murid"></i>
                </div>
                <button onclick="downloadTemplate('MURID')" class="btn-template-sm">
                    <i class="fas fa-file-download"></i> Template Murid
                </button>
            `;
        } else {
            actionContainer.innerHTML = `
                <button class="btn-secondary-strike" onclick="openAddStafModal()">
                    <i class="fas fa-chalkboard-teacher"></i> Staf Baru
                </button>
                <div class="import-wrapper">
                    <button class="btn-import" onclick="handleCSVImportClick()">
                        <i class="fas fa-file-upload"></i> Mass Import (CSV)
                    </button>
                    <i class="fas fa-question-circle import-help-icon" onclick="showImportHelp()" title="Bantuan Format Staf"></i>
                </div>
                <button onclick="downloadTemplate('STAFF')" class="btn-template-sm">
                    <i class="fas fa-file-download"></i> Template Staf
                </button>
            `;
        }
    }
    
    // 4. Load Data & Dropdowns
    if (view === 'MURID') {
        await populateManageClassDropdown();
    } else {
        // Ensure staff filter defaults to ALL when switching
        const staffFilter = id('manage-staff-type-filter');
        if (staffFilter) staffFilter.value = 'ALL';
    }
    
    loadManagementList();
};

// --- MODAL TRIGGER FUNCTIONS ---

window.openAddMuridModal = () => {
    editingId = null;
    currentMode = 'MURID';
    id('data-form')?.reset();
    
    // Update Modal UI
    id('modal-title').innerHTML = '<i class="fas fa-user-plus"></i> Tambah Murid Baru';
    id('student-only-fields')?.classList.remove('hidden');
    id('staff-only-fields')?.classList.add('hidden');
    
    // Show the modal
    id('data-modal')?.classList.remove('hidden');
};

window.openAddStafModal = () => {
    editingId = null;
    currentMode = 'STAFF';
    id('data-form')?.reset();
    
    // Update Modal UI
    id('modal-title').innerHTML = '<i class="fas fa-chalkboard-teacher"></i> Tambah Staf Baru';
    id('student-only-fields')?.classList.add('hidden');
    id('staff-only-fields')?.classList.remove('hidden');
    
    // Show the modal
    id('data-modal')?.classList.remove('hidden');
};

async function populateManageClassDropdown() {
    const dropdown = id('manage-class-dropdown');
    if (!dropdown) return;
    const classes = [...new Set(allStudents.map(s => s.class_name_full))].filter(Boolean).sort();
    dropdown.innerHTML = '<option value="">Semua Kelas</option>' + 
        classes.map(c => `<option value="${c}">${c}</option>`).join('');
}

async function loadManagementList() {
    const container = id('manage-list-container');
    const searchInput = id('manage-search-input');
    if (!container) return;

    const search = searchInput ? searchInput.value.toLowerCase() : "";
    container.innerHTML = '<div class="loader">Memproses data...</div>';

    if (currentManageView === 'MURID') {
        const classDropdown = id('manage-class-dropdown');
        const selectedClass = classDropdown ? classDropdown.value : "";
        
        let filtered = allStudents.filter(s => 
            (selectedClass === "" || s.class_name_full === selectedClass) &&
            (s.name.toLowerCase().includes(search) || s.barcode.toLowerCase().includes(search))
        ).sort((a, b) => (a.barcode || "").localeCompare(b.barcode || ""));

        renderExcelTable(container, ['No.', 'Gambar', 'Nama', 'Barcode', 'Kelas', 'Tindakan'], filtered, 'MURID');
    } else {
        const typeFilter = id('manage-staff-type-filter');
        const selectedType = typeFilter ? typeFilter.value : "ALL";
        
        let filtered = allStaff.filter(t => 
            (selectedType === "ALL" || t.staff_type === selectedType) &&
            (t.name.toLowerCase().includes(search) || t.barcode.toLowerCase().includes(search))
        ).sort((a, b) => (a.barcode || "").localeCompare(b.barcode || ""));

        renderExcelTable(container, ['No.', 'Gambar', 'Nama', 'Barcode', 'Jawatan', 'Tindakan'], filtered, 'STAFF');
    }
}

function renderExcelTable(container, headers, data, mode) {
    const extendedHeaders = [`<input type="checkbox" id="select-all-rows" onclick="toggleSelectAll(this)">`, ...headers];
    
    let rowsHtml = data.map((item, index) => `
        <tr>
            <td>
                <input type="checkbox" 
                       class="row-checkbox" 
                       data-id="${item.id}" 
                       data-barcode="${item.barcode}" 
                       onchange="updateBatchButton()">
            </td>
            <td>${index + 1}</td>
            <td>
                <img src="${item.photo_url || 'default-avatar.png'}" 
                     class="table-img" 
                     onerror="this.src='default-avatar.png';"
                     style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;">
            </td>
            <td style="font-weight:bold;">${item.name}</td>
            <td><code class="barcode-text">${item.barcode}</code></td>
            <td>${mode === 'MURID' ? (item.class_name_full || '-') : (item.staff_type || '-')}</td>
            <td class="actions-cell">
                <button onclick="editRecord('${mode}', ${item.id})" class="btn-edit-small" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteRecord('${mode === 'MURID' ? 'students' : 'teachers'}', ${item.id})" class="btn-delete-small" title="Padam">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');

    container.innerHTML = `
        <div class="batch-actions" style="margin-bottom: 10px; display: flex; align-items: center; gap: 10px; min-height: 40px;">
            <button id="btn-batch-delete" class="btn-delete-small hidden" onclick="deleteSelectedRecords('${mode}')" 
                style="background: #e74c3c; color: white; padding: 8px 15px; border-radius: 6px; border: none; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-trash"></i> Padam Terpilih (<span id="selected-count">0</span>)
            </button>
        </div>
        <table class="excel-style-table">
            <thead>
                <tr>${extendedHeaders.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;
}

async function compressImage(file, { maxWidth = 800, maxHeight = 800, quality = 0.6 } = {}) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onerror = (err) => reject(err);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/jpeg', quality);
            };
        };
    });
}

// --- FORM SUBMISSION ---
const dataForm = id('data-form');
if (dataForm) {
    dataForm.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const barcodeValue = id('form-barcode') ? id('form-barcode').value.trim() : "";

        if (!barcodeValue) return alert("Barcode diperlukan untuk menamakan gambar.");

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = "Memproses & Menyimpan...";
        }

        try {
            const fileInput = id('form-image');
            const file = fileInput ? fileInput.files[0] : null;
            let photoUrl = "";

            if (file) {
                // 1. Size Check
                if (file.size > 10 * 1024 * 1024) {
                    throw new Error("Fail terlalu besar. Sila pilih gambar bawah 10MB.");
                }

                // 2. Compress Image
                const compressedBlob = await compressImage(file, {
                    maxWidth: 600,
                    maxHeight: 600,
                    quality: 0.6
                });

                // 3. Define Path
                const fileName = `${barcodeValue}.jpg`;
                const bucket = currentMode === 'MURID' ? 'students' : 'teachers';
                const folderPath = currentSchoolCode.trim();
                const fullPath = `${folderPath}/${fileName}`;

                // 4. Upload to Supabase (Upsert allows overwriting)
                const { error: upErr } = await supabase.storage
                    .from(bucket)
                    .upload(fullPath, compressedBlob, {
                        upsert: true,
                        contentType: 'image/jpeg'
                    });

                if (upErr) throw upErr;

                // 5. Get Public URL
                const { data: urlData } = supabase.storage
                    .from(bucket)
                    .getPublicUrl(fullPath);

                // 6. CACHE BUSTING (Ensures the browser doesn't show the old photo)
                photoUrl = `${urlData.publicUrl}?t=${new Date().getTime()}`;
            }

            // --- Database Payload Setup ---
            const table = currentMode === 'MURID' ? 'students' : 'teachers';

            let payload = {
                name: id('form-name')?.value.trim() || "",
                barcode: id('form-barcode')?.value.trim() || "",
                school_id: currentSchoolId // This is your UUID
            };

            if (currentMode === 'MURID') {
                payload.standard = id('form-standard')?.value || "";
                payload.class_label = id('form-class')?.value || "";
                payload.class_name_full = `${payload.standard} ${payload.class_label}`.trim();
            } else {
                payload.honorific_title = id('form-title')?.value || "";
                payload.staff_type = id('form-staff-type')?.value || "";
            }

            if (photoUrl) payload.photo_url = photoUrl;

            let res;
            if (editingId) {
                // UPDATE
                res = await supabase
                    .from(table)
                    .update(payload)
                    .eq('id', editingId);
            } else {
                // INSERT - Create a fresh object without 'id'
                const insertData = {
                    name: payload.name,
                    barcode: payload.barcode,
                    school_id: payload.school_id,
                    photo_url: payload.photo_url || null
                };

                if (currentMode === 'MURID') {
                    insertData.standard = payload.standard;
                    insertData.class_label = payload.class_label;
                    insertData.class_name_full = payload.class_name_full;
                } else {
                    insertData.honorific_title = payload.honorific_title;
                    insertData.staff_type = payload.staff_type;
                }

                res = await supabase
                    .from(table)
                    .insert([insertData]); 
            }

            if (res.error) throw res.error;

            alert("Rekod berjaya disimpan!");

            // --- UI REFRESH LOGIC ---
            const savedClassFilter = id('manage-class-dropdown')?.value || "";
            const savedStaffFilter = id('manage-staff-type-filter')?.value || "ALL";

            if (currentMode === 'MURID') {
                await refreshClassDropdown();
                if (id('manage-class-dropdown')) id('manage-class-dropdown').value = savedClassFilter;
            } else {
                await refreshStaffTypeDropdown();
                if (id('manage-staff-type-filter')) id('manage-staff-type-filter').value = savedStaffFilter;
            }

            // UI Cleanup
            id('data-modal')?.classList.add('hidden');
            dataForm.reset();
            const preview = id('image-preview');
            const placeholder = id('preview-placeholder');
            if (preview) { preview.src = ""; preview.classList.add('hidden'); }
            if (placeholder) placeholder.classList.remove('hidden');
            
            editingId = null;
            loadManagementList();

        } catch (err) {
            console.error("Submission error:", err);
            alert(`Ralat: ${err.message}`);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "SIMPAN REKOD";
            }
        }
    };
}

// --- IMPORT HELP POPUP ---
const showImportHelp = () => {
    const isMurid = currentManageView === 'MURID';
    
    // Define specific details based on view
    const title = isMurid ? "PENGURUSAN MURID" : "PENGURUSAN STAF (GURU/AKP)";
    const columns = isMurid 
        ? "nama, barcode, tahun, nama_kelas" 
        : "nama, barcode, gelaran, jawatan";
    const example = isMurid 
        ? "Ali Bin Abu, STU-101, 6, Ibnu Sina" 
        : "Ahmad, TEA-001, Encik, GURU";
    const additionalNote = isMurid
        ? "• 'tahun' (1-6 / Peralihan / Form 1-5)\n• 'nama_kelas' mestilah tepat."
        : "• 'gelaran' (Encik, Puan, Ustaz, dll)\n• 'jawatan' MESTI: GURU atau AKP.";

    const message = `--- PANDUAN IMPORT CSV: ${title} ---

1. SUSUNAN KOLUM:
${columns}

2. CONTOH REKOD:
${example}

3. NOTA PENTING:
${additionalNote}
• Pastikan fail disimpan dalam format .csv (Comma Delimited).
• Sistem akan memadankan data secara automatik ke kod sekolah ${currentSchoolCode}.`;

    alert(message);
};

// --- REVISED CSV IMPORT LOGIC ---
const handleCSVImport = async (e) => {
    if (!currentSchoolId) {
        alert("Sila tunggu sehingga profil sekolah dimuatkan sepenuhnya.");
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
        const rows = ev.target.result.split('\n').filter(row => row.trim() !== '');
        const dataToInsert = [];
        const table = currentManageView === 'MURID' ? 'students' : 'teachers';

        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(',').map(c => c.trim());
            if (cols[0] && cols[1]) {
                let entry = {
                    name: cols[0],
                    barcode: cols[1],
                    school_id: currentSchoolId
                };

                if (currentManageView === 'MURID') {
                    entry.standard = cols[2] || "";
                    entry.class_label = cols[3] || "";
                    entry.class_name_full = `${cols[2] || ""} ${cols[3] || ""}`.trim();
                } else {
                    entry.honorific_title = cols[2] || "";
                    entry.staff_type = cols[3] || "";
                }
                dataToInsert.push(entry);
            }
        }

        if (dataToInsert.length > 0 && confirm(`Import ${dataToInsert.length} rekod ke ${currentManageView}?`)) {
            try {
                const { error } = await supabase.from(table).insert(dataToInsert);
                
                if (error) {
                    // If duplicate error occurs, we inform the user but still refresh the UI to show existing data
                    alert(`Nota: Terdapat data yang sudah wujud dalam pangkalan data. Menyelaras dashboard... \n(Ralat: ${error.message})`);
                } else {
                    alert("Import Berjaya!");
                }
            } catch (err) {
                alert("Ralat teknikal: " + err.message);
            } finally {
                // --- CRITICAL REFRESH: This now runs regardless of success or duplicate error ---
                if (currentManageView === 'MURID') {
                    await refreshClassDropdown(); 
                    await populateManageClassDropdown(); 
                    if (typeof renderMuridTable === 'function') renderMuridTable();
                } else {
                    await refreshStaffTypeDropdown();
                    if (typeof loadGuruData === 'function') await loadGuruData();
                }
                
                // Re-draw the management list with whatever data is now in 'allStudents' or 'allStaff'
                loadManagementList(); 
            }
        }
        e.target.value = '';
    };
    reader.readAsText(file);
};

// --- MODAL CONTROLS ---
const addMuridBtn = id('open-add-murid');
if (addMuridBtn) {
    addMuridBtn.onclick = () => {
        editingId = null;
        currentMode = 'MURID';
        id('data-form')?.reset();
        const mTitle = id('modal-title');
        if (mTitle) mTitle.innerText = "Tambah Murid Baru";
        id('student-only-fields')?.classList.remove('hidden');
        id('staff-only-fields')?.classList.add('hidden');
        id('data-modal')?.classList.remove('hidden');
    };
}

const addStafBtn = id('open-add-staf');
if (addStafBtn) {
    addStafBtn.onclick = () => {
        editingId = null;
        currentMode = 'STAFF';
        id('data-form')?.reset();
        const mTitle = id('modal-title');
        if (mTitle) mTitle.innerText = "Tambah Staf Baru";
        id('student-only-fields')?.classList.add('hidden');
        id('staff-only-fields')?.classList.remove('hidden');
        id('data-modal')?.classList.remove('hidden');
    };
}

window.editRecord = async (type, recordId) => {
    editingId = recordId;
    currentMode = type;
    const table = type === 'MURID' ? 'students' : 'teachers';
    const { data, error } = await supabase.from(table).select('*').eq('id', recordId).single();
    if (error) return alert("Gagal mengambil data");

    const nameField = id('form-name');
    const barcodeField = id('form-barcode');
    const mTitle = id('modal-title');
    
    if (nameField) nameField.value = data.name || "";
    if (barcodeField) barcodeField.value = data.barcode || "";
    if (mTitle) mTitle.innerText = `Kemaskini Data ${type === 'MURID' ? 'Murid' : 'Staf'}`;

    if (type === 'MURID') {
        id('student-only-fields')?.classList.remove('hidden');
        id('staff-only-fields')?.classList.add('hidden');
        if (id('form-standard')) id('form-standard').value = data.standard || "";
        if (id('form-class')) id('form-class').value = data.class_label || "";
    } else {
        id('student-only-fields')?.classList.add('hidden');
        id('staff-only-fields')?.classList.remove('hidden');
        if (id('form-staff-type')) id('form-staff-type').value = data.staff_type || "";
        if (id('form-title')) id('form-title').value = data.honorific_title || "";
    }
    id('data-modal')?.classList.remove('hidden');
};

window.deleteRecord = async (table, recordId) => {
    const warningMsg = "Adakah anda pasti? Semua REKOD KEHADIRAN dan GAMBAR profil bagi individu ini juga akan dipadamkan secara kekal.";
    if (!confirm(warningMsg)) return;

    try {
        // 1. Fetch record details for storage cleanup
        const { data: record, error: fetchErr } = await supabase
            .from(table)
            .select('barcode, photo_url')
            .eq('id', recordId)
            .single();

        if (fetchErr) throw fetchErr;

        // 2. Delete Image from Storage
        if (record && record.photo_url) {
            const bucket = table === 'students' ? 'students' : 'teachers';
            const filePath = `${currentSchoolCode}/${record.barcode}.jpg`;
            await supabase.storage.from(bucket).remove([filePath]);
        }

        // 3. Delete Database Record
        const { error: dbErr } = await supabase.from(table).delete().eq('id', recordId);
        if (dbErr) throw dbErr;

        alert("Rekod berjaya dipadamkan.");

        // 4. CRITICAL: REFRESH DATA ARRAYS
        // This ensures the local memory is synced with the database
        if (table === 'students') {
            await refreshClassDropdown(); // Re-fetches allStudents
        } else {
            await refreshStaffTypeDropdown(); // Re-fetches allStaff
        }

        // 5. Re-render the management table immediately
        loadManagementList();

    } catch (err) {
        console.error("Delete error:", err);
        alert(`Ralat: ${err.message}`);
    }
};

const closeModalBtn = id('close-modal');
if (closeModalBtn) closeModalBtn.onclick = () => id('data-modal')?.classList.add('hidden');

// --- EVENTS ---
if (id('class-dropdown')) id('class-dropdown').onchange = renderMuridTable;
if (id('student-search-input')) id('student-search-input').oninput = renderMuridTable;
if (id('manage-class-dropdown')) id('manage-class-dropdown').onchange = () => loadManagementList();
if (id('manage-staff-type-filter')) id('manage-staff-type-filter').onchange = () => loadManagementList();
if (id('manage-search-input')) id('manage-search-input').oninput = () => loadManagementList();

const guruFilterGroup = id('guru-filter-group');
if (guruFilterGroup) {
    guruFilterGroup.onclick = (e) => {
        if (e.target.classList.contains('filter-btn')) {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderGuruTable(e.target.dataset.filter);
        }
    };
}

// Fungsi untuk tutup modal edit
window.closeEditModal = () => {
    const modal = id('data-modal');
    if (modal) {
        modal.classList.add('hidden');
        // Reset form jika perlu supaya data lama tak tersangkut
        id('data-form').reset();
        id('preview-img').classList.add('hidden');
        id('preview-placeholder').classList.remove('hidden');
    }
};

// --- EXPORT LOGIC ---
function getDynamicFilename(baseName, includeClass = false) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const dateStr = `${day}-${month}-${year}`;

    if (includeClass) {
        const classDropdown = id('class-dropdown');
        const selectedClass = classDropdown ? classDropdown.value.replace(/\s+/g, '') : "Semua";
        return `${baseName}_${selectedClass}_${dateStr}`;
    }
    return `${baseName}_${dateStr}`;
}

const exportMuridCsv = id('btn-export-murid-csv');
if (exportMuridCsv) exportMuridCsv.onclick = () => exportCSV('table-murid', 'LaporanKehadiran', true);

const exportMuridPdf = id('btn-export-murid-pdf');
if (exportMuridPdf) exportMuridPdf.onclick = () => exportPDF('table-murid', 'LaporanKehadiran', true);

const exportGuruCsv = id('btn-export-guru-csv');
if (exportGuruCsv) exportGuruCsv.onclick = () => exportCSV('table-guru', 'LaporanStaf', false);

const exportGuruPdf = id('btn-export-guru-pdf');
if (exportGuruPdf) exportGuruPdf.onclick = () => exportPDF('table-guru', 'LaporanStaf', false);

function exportCSV(tableId, baseName, includeClass) {
    const table = id(tableId);
    if (!table || typeof XLSX === 'undefined') return alert("Pustaka XLSX tidak dimuatkan.");
    const fileName = getDynamicFilename(baseName, includeClass);
    const wb = XLSX.utils.table_to_book(table);
    XLSX.writeFile(wb, `${fileName}.csv`);
}

function exportPDF(tableId, baseName, includeClass) {
    if (typeof window.jspdf === 'undefined') return alert("Pustaka jsPDF tidak dimuatkan.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const fileName = getDynamicFilename(baseName, includeClass);
    
    doc.setFontSize(18);
    doc.text(fileName.replace(/_/g, ' '), 14, 15); 
    doc.autoTable({ 
        html: `#${tableId}`, 
        margin: { top: 25 },
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] }
    });
    doc.save(`${fileName}.pdf`);
}

// --- REALTIME ---
function setupRealtime() {
    console.log("Setting up Realtime subscriptions...");

    const getTodayStr = () => id('date-picker')?.value || new Date().toISOString().split('T')[0];

    supabase.channel('student-attendance-channel').on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'students_attendance', filter: `school_id=eq.${currentSchoolId}` }, 
        () => { if (getTodayStr() === new Date().toISOString().split('T')[0]) fetchMuridAttendance(); }
    ).subscribe();

    supabase.channel('staff-attendance-channel').on('postgres_changes', 
        { event: '*', schema: 'public', table: 'teacher_attendance', filter: `school_id=eq.${currentSchoolId}` }, 
        () => { if (getTodayStr() === new Date().toISOString().split('T')[0]) loadGuruData(); }
    ).subscribe();

    supabase.channel('student-profiles-channel').on('postgres_changes', 
        { event: '*', schema: 'public', table: 'students', filter: `school_id=eq.${currentSchoolId}` }, 
        async () => {
            await refreshClassDropdown();
            if (currentManageView === 'MURID') loadManagementList();
        }
    ).subscribe();

    supabase.channel('staff-profiles-channel').on('postgres_changes', 
        { event: '*', schema: 'public', table: 'teachers', filter: `school_id=eq.${currentSchoolId}` }, 
        async () => {
            await refreshStaffTypeDropdown();
            if (currentManageView === 'STAFF') loadManagementList();
        }
    ).subscribe();
}

const logoutBtn = id('logout-btn');
if (logoutBtn) {
    logoutBtn.onclick = async () => { 
        await supabase.auth.signOut(); 
        location.reload(); 
    };
}

// --- STATS MODAL & EXPORTS ---

window.openStatsModal = (title, list) => {
    const modal = id('stats-modal');
    const modalTitle = id('stats-modal-title');
    const container = id('stats-modal-content');
    
    if (!modal || !container) return;

    modalTitle.innerText = title;
    window.currentStatsData = list; // Save for PDF/CSV buttons
    window.currentStatsTitle = title;

    if (list.length === 0) {
        container.innerHTML = '<p style="padding:20px; text-align:center;">Tiada rekod untuk dipaparkan.</p>';
    } else {
        let html = `
            <table class="excel-table">
                <thead>
                    <tr>
                        <th>No.</th>
                        <th>Nama</th>
                        <th>Barcode</th>
                        <th>Kelas/Jawatan</th>
                    </tr>
                </thead>
                <tbody>`;
        
        list.forEach((item, idx) => {
            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${item.name || item.nama}</td>
                    <td>${item.barcode}</td>
                    <td>${item.class_name_full || item.role || '-'}</td>
                </tr>`;
        });
        
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    modal.classList.remove('hidden');
};

window.closeStatsModal = () => {
    id('stats-modal')?.classList.add('hidden');
};

window.exportStatsCSV = () => {
    if (!window.currentStatsData || window.currentStatsData.length === 0) return;
    
    const headers = ["Nama", "Barcode", "Info"];
    const rows = window.currentStatsData.map(s => [s.name || s.nama, s.barcode, s.class_name_full || s.role]);
    
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF" // Added BOM for Excel Malay char support
        + [headers, ...rows].map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${window.currentStatsTitle}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.exportStatsPDF = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.text(window.currentStatsTitle, 14, 15);
    doc.setFontSize(10);
    doc.text(`Tarikh: ${new Date().toLocaleDateString('ms-MY')}`, 14, 22);

    const body = window.currentStatsData.map((s, idx) => [
        idx + 1,
        s.name || s.nama,
        s.barcode,
        s.class_name_full || s.role
    ]);

    doc.autoTable({
        startY: 25,
        head: [['No.', 'Nama', 'Barcode', 'Kelas/Jawatan']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] }
    });

    doc.save(`${window.currentStatsTitle}.pdf`);
};

// --- WINDOW EXPORTS ---
window.handleCSVImportClick = () => id('csv-upload')?.click();
window.handleCSVImport = handleCSVImport;
window.showImportHelp = showImportHelp;
window.downloadTemplate = window.downloadTemplate || downloadTemplate; // In case already assigned
window.switchManageView = window.switchManageView || switchManageView;
window.loadManagementList = window.loadManagementList || loadManagementList;