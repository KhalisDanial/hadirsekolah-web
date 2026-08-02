import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// 1. Konfigurasi Supabase
const supabaseUrl = 'https://cawrvnutflgvbrisuqtd.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhd3J2bnV0ZmxndmJyaXN1cXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNDcwODgsImV4cCI6MjA4MTYyMzA4OH0.ZLSVVcZUl2muc584TL_UIYxykjrf_F_dOtDJp53A3cU'
const supabase = createClient(supabaseUrl, supabaseKey)

let currentSchoolId = null;
let currentAIView = 'murid'; // Pembolehubah untuk kawal paparan aktif ('murid' atau 'staf')

let analyzedStudentData = [];
let analyzedStaffData = [];

window.globalAllAttendance = [];
window.globalOfficialDates = new Set();
window.globalAllStaffAttendance = [];
window.globalOfficialStaffDates = new Set();

const id = (name) => document.getElementById(name);

// 2. Inisialisasi Enjin AI
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }
    const { data: profile } = await supabase.from('profiles').select('school_id').eq('id', session.user.id).single();
    if (profile) {
        currentSchoolId = profile.school_id;
        await runAIPredictiveEngine();
    }
});

// 3. Enjin Klasifikasi & Pengiraan Risiko AI (DWI-FUNGSI)
async function runAIPredictiveEngine() {
    const currentYear = new Date().getFullYear();
    const startDate = `${currentYear}-01-01`;

    // --- FUNGSI PEMBANTU (HELPER) UNTUK MENGIRA DATA TANPA MENGULANG KOD ---
    async function processAIEngine(tableName, attendanceTableName, attendanceThreshold) {
        const { data: users } = await supabase.from(tableName).select('*').eq('school_id', currentSchoolId);
        if (!users || users.length === 0) return { analyzed: [], allAtt: [], offDates: new Set() };

        let allAtt = [];
        let fetchMore = true;
        let fromIndex = 0;
        const step = 1000;

        while (fetchMore) {
            const { data, error } = await supabase
                .from(attendanceTableName)
                .select('*')
                .eq('school_id', currentSchoolId)
                .gte('date', startDate)
                .range(fromIndex, fromIndex + step - 1);

            if (error) break;
            if (data && data.length > 0) {
                allAtt = allAtt.concat(data);
                if (data.length < step) fetchMore = false;
                else fromIndex += step;
            } else { fetchMore = false; }
        }

        const dateCounts = {};
        allAtt.forEach(a => { dateCounts[a.date] = (dateCounts[a.date] || 0) + 1; });

        const offDates = new Set();
        for (const d in dateCounts) {
            if (dateCounts[d] >= attendanceThreshold) offDates.add(d);
        }
        const totalWorkingDays = offDates.size;

        const analyzed = users.map(u => {
            // Sokong padanan student_id ATAU staff_id dengan String() conversion
            const userScans = allAtt.filter(a => String(a.student_id || a.staff_id) === String(u.id) && offDates.has(a.date));
            const attendedDates = new Set(userScans.map(a => a.date));
            
            const attendCount = attendedDates.size;
            const absentCount = totalWorkingDays - attendCount;
            
            const daysOfWeekCount = { Isnin: 0, Selasa: 0, Rabu: 0, Khamis: 0, Jumaat: 0 };
            const dayNames = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];

            offDates.forEach(dStr => {
                if (!attendedDates.has(dStr)) {
                    const dName = dayNames[new Date(dStr).getDay()];
                    if (daysOfWeekCount[dName] !== undefined) daysOfWeekCount[dName]++;
                }
            });

            let dominantDayPattern = null;
            if (daysOfWeekCount['Isnin'] >= 3) dominantDayPattern = 'Ponteng Kerap Isnin';
            else if (daysOfWeekCount['Jumaat'] >= 3) dominantDayPattern = 'Ponteng Kerap Jumaat';

            let lateCount = 0;
            userScans.forEach(sc => {
                if (sc.timestamp) {
                    const scanTime = new Date(sc.timestamp);
                    const totalMins = (scanTime.getHours() * 60) + scanTime.getMinutes();
                    if (totalMins > (7 * 60 + 30)) lateCount++; // Lewat lepas 07:30
                }
            });

            let riskScore = 0;
            let riskCategory = 'LOW';
            let aiRecommendation = 'Kehadiran Memuaskan';

            if (attendCount === 0 && totalWorkingDays > 0) {
                riskScore = 100;
                riskCategory = 'GHOST';
                aiRecommendation = tableName === 'students' ? 'KRITIKAL: Siasat Status Pindah / Kod Bar Rosak' : 'KRITIKAL: Semak Status Staf (Pindah/Cuti Panjang)';
            } else {
                const absentRate = totalWorkingDays > 0 ? (absentCount / totalWorkingDays) : 0;
                riskScore += Math.min(60, Math.round(absentRate * 100 * 1.5));
                if (dominantDayPattern) riskScore += 15;
                
                if (lateCount >= 4) riskScore += 15;
                else if (lateCount >= 2) riskScore += 8;

                riskScore = Math.min(100, riskScore);

                if (riskScore >= 50 || absentCount >= 5) {
                    riskCategory = 'HIGH';
                    aiRecommendation = tableName === 'students' ? 'Syor: Sesi Kaunseling & Surat Amaran Pertama' : 'Syor: Surat Tunjuk Sebab (Tatatertib)';
                } else if (riskScore >= 25 || absentCount >= 3 || lateCount >= 3) {
                    riskCategory = 'MEDIUM';
                    aiRecommendation = tableName === 'students' ? 'Syor: Panggilan Mesra Ibu Bapa / Peringatan' : 'Syor: Teguran Lisan Pengetua/Guru Besar';
                }
            }

            return { ...u, attendCount, absentCount, lateCount, dominantDayPattern, riskScore, riskCategory, aiRecommendation };
        });

        analyzed.sort((a, b) => b.riskScore - a.riskScore);
        return { analyzed, allAtt, offDates };
    }

    // A. Proses Data Murid (Ambang 50 Hari Sekolah)
    const studentData = await processAIEngine('students', 'students_attendance', 50);
    analyzedStudentData = studentData.analyzed;
    window.globalAllAttendance = studentData.allAtt;
    window.globalOfficialDates = studentData.offDates;

    // B. Proses Data Staf (Ambang 10 Hari Bekerja)
    const staffData = await processAIEngine('staff', 'staff_attendance', 10);
    analyzedStaffData = staffData.analyzed;
    window.globalAllStaffAttendance = staffData.allAtt;
    window.globalOfficialStaffDates = staffData.offDates;

    renderAIDashboardUI();
}

// 4. Fungsi Pertukaran Togol (Murid <-> Staf)
window.switchAIView = (view) => {
    currentAIView = view;
    const btnMurid = id('btn-view-murid');
    const btnStaf = id('btn-view-staf');
    const searchInput = id('ai-search-input');
    
    // Reset carian bila tukar tab
    if (searchInput) searchInput.value = '';

    if (view === 'murid') {
        btnMurid.style.background = 'white'; btnMurid.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'; btnMurid.style.color = '#0f172a';
        btnStaf.style.background = 'transparent'; btnStaf.style.boxShadow = 'none'; btnStaf.style.color = '#64748b';
        id('th-name').innerText = 'Nama Murid';
        id('th-role').innerText = 'Kelas';
    } else {
        btnStaf.style.background = 'white'; btnStaf.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'; btnStaf.style.color = '#0f172a';
        btnMurid.style.background = 'transparent'; btnMurid.style.boxShadow = 'none'; btnMurid.style.color = '#64748b';
        id('th-name').innerText = 'Nama Staf (Guru/AKP)';
        id('th-role').innerText = 'Jawatan';
    }
    
    renderAIDashboardUI();
};

function renderAIDashboardUI() {
    // Pilih sumber data berdasarkan paparan aktif
    const activeData = currentAIView === 'murid' ? analyzedStudentData : analyzedStaffData;

    const ghostRisk = activeData.filter(d => d.riskCategory === 'GHOST');
    const highRisk = activeData.filter(d => d.riskCategory === 'HIGH');
    const medRisk = activeData.filter(d => d.riskCategory === 'MEDIUM');
    const patternRisk = activeData.filter(d => d.dominantDayPattern !== null);
    const lateRisk = activeData.filter(d => d.lateCount >= 3);

    if (id('ai-ghost-count')) id('ai-ghost-count').innerText = ghostRisk.length;
    if (id('ai-high-risk-count')) id('ai-high-risk-count').innerText = highRisk.length;
    if (id('ai-med-risk-count')) id('ai-med-risk-count').innerText = medRisk.length;
    if (id('ai-pattern-count')) id('ai-pattern-count').innerText = patternRisk.length;
    if (id('ai-late-risk-count')) id('ai-late-risk-count').innerText = lateRisk.length;

    window.renderAITableOnly();
}

window.renderAITableOnly = () => {
    const tbody = id('ai-table-body');
    const searchInput = id('ai-search-input');
    if (!tbody) return;

    const activeData = currentAIView === 'murid' ? analyzedStudentData : analyzedStaffData;
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    const filteredData = activeData.filter(item => {
        const matchName = item.name ? item.name.toLowerCase().includes(searchTerm) : false;
        const matchBarcode = item.barcode ? item.barcode.toString().toLowerCase().includes(searchTerm) : false;
        return matchName || matchBarcode;
    });

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;">Tiada rekod sepadan ditemui.</td></tr>';
        return;
    }

    let rowsHtml = '';
    filteredData.forEach((item, index) => {
        let badgeColor = '#22c55e';
        let badgeText = 'Rendah';
        
        if (item.riskCategory === 'GHOST') { badgeColor = '#000000'; badgeText = 'TIADA REKOD'; }
        else if (item.riskCategory === 'HIGH') { badgeColor = '#ef4444'; badgeText = 'TINGGI'; }
        else if (item.riskCategory === 'MEDIUM') { badgeColor = '#f59e0b'; badgeText = 'SEDERHANA'; }

        const patternTag = item.riskCategory === 'GHOST' 
            ? `<span style="background:#f1f5f9; color:#0f172a; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;"><i class="fas fa-question-circle"></i> 0 Hari Hadir</span>`
            : (item.dominantDayPattern 
                ? `<span style="background:#f3e8ff; color:#7e22ce; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;"><i class="fas fa-exclamation-triangle"></i> ${item.dominantDayPattern}</span>`
                : (item.lateCount >= 3 ? `<span style="background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">Kerap Lewat (${item.lateCount}x)</span>` : '<span style="color:#94a3b8;">Normal</span>'));

        const recommendationStyle = item.riskCategory === 'GHOST' ? 'color:#ef4444; font-weight: 800;' : 'color:#334155; font-weight: 600;';
        const displayRole = currentAIView === 'murid' ? (item.class_name_full || '-') : (item.role || '-');

        rowsHtml += `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <div style="font-weight:700; color:#1e293b;">${item.name}</div>
                    <code style="font-size: 0.75rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #64748b; margin-top: 4px; display: inline-block;">${item.barcode || '-'}</code>
                </td>
                <td>${displayRole}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="color:${badgeColor}; font-size:1.1rem;">${item.riskScore}%</strong>
                        <span class="badge" style="background:${badgeColor}22; color:${badgeColor}; font-size:0.65rem;">${badgeText}</span>
                    </div>
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 6px;">
                        <i class="fas fa-user-times" style="opacity: 0.7;"></i> Tidak Hadir: <strong style="color: ${item.absentCount > 0 ? '#ef4444' : '#22c55e'};">${item.absentCount}</strong> Hari
                    </div>
                </td>
                <td>${patternTag}</td>
                <td><span style="font-size:0.85rem; ${recommendationStyle}">${item.aiRecommendation}</span></td>
                <td>
                    <button onclick="window.openStudentChart('${item.id}', '${item.name.replace(/'/g, "\\'")}')" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; font-weight: bold; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);">
                        <i class="fas fa-chart-line"></i> Graf
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
};

// 5. Eksport Laporan PDF Mengikut Kumpulan (Murid/Staf)
window.exportAIReportPDF = () => {
    const activeData = currentAIView === 'murid' ? analyzedStudentData : analyzedStaffData;
    if (!activeData || activeData.length === 0) return alert("Tiada data analisis AI untuk dieksport.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text(`Laporan Analisis Risiko Kehadiran (AI) - ${currentAIView === 'murid' ? 'Kategori Murid' : 'Kategori Guru & AKP'}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Tarikh Janaan: ${new Date().toLocaleDateString('ms-MY')}`, 14, 22);

    const highRiskOnly = activeData.filter(d => d.riskCategory === 'HIGH' || d.riskCategory === 'MEDIUM');

    const body = highRiskOnly.map((d, idx) => [
        idx + 1,
        d.name,
        currentAIView === 'murid' ? (d.class_name_full || '-') : (d.role || '-'),
        `${d.riskScore}% (${d.riskCategory})\nTidak Hadir: ${d.absentCount} Hari`,
        d.dominantDayPattern || (d.lateCount >= 3 ? `Kerap Lewat (${d.lateCount}x)` : 'Tiada Corak Khusus'),
        d.aiRecommendation
    ]);

    doc.autoTable({
        startY: 28,
        head: [['Bil.', 'Nama', currentAIView === 'murid' ? 'Kelas' : 'Jawatan', 'Skor Risiko', 'Corak Dikesan', 'Tindakan Disyorkan']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234] }, 
        styles: { fontSize: 8 }
    });

    doc.save(`Laporan_AI_Risiko_${currentAIView === 'murid' ? 'Murid' : 'Staf'}_${new Date().toISOString().split('T')[0]}.pdf`);
};

// 6. FUNGSI JANAAN GRAF PRESTASI BULANAN
let performanceChart = null;

window.openStudentChart = (userId, userName) => {
    const modal = document.getElementById('ai-chart-modal');
    document.getElementById('ai-chart-student-name').innerText = userName;
    modal.style.display = 'flex';

    // Pilih data pangkalan yang betul berdasarkan tab aktif
    const activeScans = currentAIView === 'murid' ? window.globalAllAttendance : window.globalAllStaffAttendance;
    const activeDates = currentAIView === 'murid' ? window.globalOfficialDates : window.globalOfficialStaffDates;

    const scans = activeScans.filter(a => String(a.student_id || a.staff_id) === String(userId));
    const scanDates = new Set(scans.map(a => a.date));

    const monthsMy = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
    const monthlyData = {};
    for (let i = 0; i < 12; i++) {
        monthlyData[i] = { schoolDays: 0, absent: 0, late: 0 };
    }

    activeDates.forEach(dateStr => {
        const dObj = new Date(dateStr);
        const monthIdx = dObj.getMonth();
        
        monthlyData[monthIdx].schoolDays++;

        if (!scanDates.has(dateStr)) {
            monthlyData[monthIdx].absent++; 
        } else {
            const scanRecord = scans.find(s => s.date === dateStr);
            if (scanRecord && scanRecord.timestamp) {
                const st = new Date(scanRecord.timestamp);
                const totalMins = (st.getHours() * 60) + st.getMinutes();
                if (totalMins > (7 * 60 + 30)) {
                    monthlyData[monthIdx].late++;
                }
            }
        }
    });

    const chartLabels = [];
    const absentDataset = [];
    const lateDataset = [];

    for (let i = 0; i < 12; i++) {
        if (monthlyData[i].schoolDays > 0) {
            chartLabels.push(monthsMy[i]);
            absentDataset.push(monthlyData[i].absent);
            lateDataset.push(monthlyData[i].late);
        }
    }

    const ctx = document.getElementById('studentPerformanceChart').getContext('2d');
    
    if (performanceChart) {
        performanceChart.destroy();
    }

    performanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Tidak Hadir (Hari)',
                    data: absentDataset,
                    backgroundColor: 'rgba(239, 68, 68, 0.7)',
                    borderColor: 'rgb(239, 68, 68)',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Kerap Lewat (Kali)',
                    data: lateDataset,
                    backgroundColor: 'rgba(245, 158, 11, 0.7)', 
                    borderColor: 'rgb(245, 158, 11)',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Jumlah Kekerapan' } }
            },
            plugins: { legend: { position: 'top' } }
        }
    });
};