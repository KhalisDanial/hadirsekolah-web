import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// 1. Konfigurasi Supabase
const supabaseUrl = 'https://cawrvnutflgvbrisuqtd.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNhd3J2bnV0ZmxndmJyaXN1cXRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNDcwODgsImV4cCI6MjA4MTYyMzA4OH0.ZLSVVcZUl2muc584TL_UIYxykjrf_F_dOtDJp53A3cU'
const supabase = createClient(supabaseUrl, supabaseKey)

let currentSchoolId = null;
let analyzedRiskData = [];

const id = (name) => document.getElementById(name);

// 2. Inisialisasi Enjin AI
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'index.html';
        return;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', session.user.id)
        .single();

    if (profile) {
        currentSchoolId = profile.school_id;
        await runAIPredictiveEngine();
    }
});

// 3. Enjin Klasifikasi & Pengiraan Risiko AI
async function runAIPredictiveEngine() {
    const currentYear = new Date().getFullYear();
    const startDate = `${currentYear}-01-01`;

    // A. Ambil Senarai Murid
    const { data: students } = await supabase
        .from('students')
        .select('*')
        .eq('school_id', currentSchoolId);

    if (!students || students.length === 0) {
        id('ai-table-body').innerHTML = '<tr><td colspan="6" style="text-align:center;">Tiada data murid dijumpai.</td></tr>';
        return;
    }

    // B. Tarik Data Kehadiran Keseluruhan (Pagination Loop)
    let allAttendance = [];
    let fetchMore = true;
    let fromIndex = 0;
    const step = 1000;

    while (fetchMore) {
        const { data, error } = await supabase
            .from('students_attendance')
            .select('*')
            .eq('school_id', currentSchoolId)
            .gte('date', startDate)
            .range(fromIndex, fromIndex + step - 1);

        if (error) break;
        if (data && data.length > 0) {
            allAttendance = allAttendance.concat(data);
            if (data.length < step) fetchMore = false;
            else fromIndex += step;
        } else {
            fetchMore = false;
        }
    }

    // C. Pengiraan Tarikh Persekolahan Rasmi (Ambang 50 imbasan)
    const dateCounts = {};
    allAttendance.forEach(a => {
        dateCounts[a.date] = (dateCounts[a.date] || 0) + 1;
    });

    const officialDates = new Set();
    for (const d in dateCounts) {
        if (dateCounts[d] >= 50) officialDates.add(d);
    }
    const totalSchoolDays = officialDates.size;

    // D. Pengiraan Skor Risiko bagi Setiap Murid (Machine Learning Rules Engine)
    analyzedRiskData = students.map(s => {
        const studentScans = allAttendance.filter(a => a.student_id === s.id && officialDates.has(a.date));
        const attendedDates = new Set(studentScans.map(a => a.date));
        
        const attendCount = attendedDates.size;
        const absentCount = totalSchoolDays - attendCount;
        
        // --- ASPEK 1: Analisis Kekerapan Hari Ponteng ---
        const daysOfWeekCount = { Isnin: 0, Selasa: 0, Rabu: 0, Khamis: 0, Jumaat: 0 };
        const dayNames = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];

        officialDates.forEach(dStr => {
            if (!attendedDates.has(dStr)) {
                const dayIdx = new Date(dStr).getDay();
                const dName = dayNames[dayIdx];
                if (daysOfWeekCount[dName] !== undefined) {
                    daysOfWeekCount[dName]++;
                }
            }
        });

        // Pengesanan Corak Hari Tertentu (Contoh: Ponteng Isnin/Jumaat tegar)
        let dominantDayPattern = null;
        if (daysOfWeekCount['Isnin'] >= 3) dominantDayPattern = 'Ponteng Kerap Isnin';
        else if (daysOfWeekCount['Jumaat'] >= 3) dominantDayPattern = 'Ponteng Kerap Jumaat';

        // --- ASPEK 2: Analisis Kelewatan ---
        // (Mengandaikan imbasan selepas 07:30 dikira lewat)
        let lateCount = 0;
        studentScans.forEach(sc => {
            if (sc.timestamp) {
                const scanTime = new Date(sc.timestamp);
                const totalMins = (scanTime.getHours() * 60) + scanTime.getMinutes();
                if (totalMins > (7 * 60 + 30)) lateCount++;
            }
        });

        // --- ALGORITMA SKOR RISIKO AI (0 - 100%) ---
        let riskScore = 0;
        let riskCategory = 'LOW';
        let aiRecommendation = 'Kehadiran Memuaskan';

        if (attendCount === 0 && totalSchoolDays > 0) {
            // TANGKAPAN KHAS: Murid langsung tiada rekod (Ghost Student)
            riskScore = 100;
            riskCategory = 'GHOST';
            aiRecommendation = 'KRITIKAL: Siasat Status Pindah / Kod Bar Rosak';
        } else {
            // Komponen 1: Kadar Ponteng (Sehingga 60 Mata)
            const absentRate = totalSchoolDays > 0 ? (absentCount / totalSchoolDays) : 0;
            riskScore += Math.min(60, Math.round(absentRate * 100 * 1.5));

            // Komponen 2: Corak Hari Khusus (15 Mata)
            if (dominantDayPattern) riskScore += 15;

            // Komponen 3: Kekerapan Lewat (15 Mata)
            if (lateCount >= 4) riskScore += 15;
            else if (lateCount >= 2) riskScore += 8;

            // Cap Skor Maksimum 100%
            riskScore = Math.min(100, riskScore);

            // Kategori Risiko AI Biasa
            if (riskScore >= 50 || absentCount >= 5) {
                riskCategory = 'HIGH';
                aiRecommendation = 'Syor: Sesi Kaunseling & Surat Amaran Pertama';
            } else if (riskScore >= 25 || absentCount >= 3 || lateCount >= 3) {
                riskCategory = 'MEDIUM';
                aiRecommendation = 'Syor: Panggilan Mesra Ibu Bapa / Peringatan Kelas';
            }
        }

        return {
            ...s,
            attendCount,
            absentCount,
            lateCount,
            dominantDayPattern,
            riskScore,
            riskCategory,
            aiRecommendation
        };
    });

    // Isih mengikut skor risiko tertinggi ke terendah
    analyzedRiskData.sort((a, b) => b.riskScore - a.riskScore);

    // E. Kemas kini UI Dashboard
    renderAIDashboardUI();
}

function renderAIDashboardUI() {
    const ghostRisk = analyzedRiskData.filter(d => d.riskCategory === 'GHOST');
    const highRisk = analyzedRiskData.filter(d => d.riskCategory === 'HIGH');
    const medRisk = analyzedRiskData.filter(d => d.riskCategory === 'MEDIUM');
    const patternRisk = analyzedRiskData.filter(d => d.dominantDayPattern !== null);
    const lateRisk = analyzedRiskData.filter(d => d.lateCount >= 3);

    // Kemas kini nombor pada kad statistik di atas
    if (id('ai-ghost-count')) id('ai-ghost-count').innerText = ghostRisk.length;
    if (id('ai-high-risk-count')) id('ai-high-risk-count').innerText = highRisk.length;
    if (id('ai-med-risk-count')) id('ai-med-risk-count').innerText = medRisk.length;
    if (id('ai-pattern-count')) id('ai-pattern-count').innerText = patternRisk.length;
    if (id('ai-late-risk-count')) id('ai-late-risk-count').innerText = lateRisk.length;

    // Panggil fungsi render jadual kali pertama
    window.renderAITableOnly();
}

// Fungsi Khas: Render Jadual Bersama Tapisan Carian (Search Filter)
window.renderAITableOnly = () => {
    const tbody = id('ai-table-body');
    const searchInput = id('ai-search-input');
    if (!tbody) return;

    // Tangkap teks carian (jika ada) dan tukar huruf kecil (lowercase)
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";

    // Tapis (Filter) data pangkalan berdasarkan carian Nama ATAU Barcode
    const filteredData = analyzedRiskData.filter(item => {
        const matchName = item.name ? item.name.toLowerCase().includes(searchTerm) : false;
        const matchBarcode = item.barcode ? item.barcode.toString().toLowerCase().includes(searchTerm) : false;
        return matchName || matchBarcode;
    });

    if (filteredData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">Tiada murid sepadan dengan carian.</td></tr>';
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

        // Saya tambahkan sedikit paparan ID Barcode di bawah nama murid supaya
        // pengguna tahu bahawa mereka boleh mencari mengikut barcode!
        rowsHtml += `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <div style="font-weight:700; color:#1e293b;">${item.name}</div>
                    <code style="font-size: 0.75rem; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #64748b; margin-top: 4px; display: inline-block;">${item.barcode || '-'}</code>
                </td>
                <td>${item.class_name_full || '-'}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <strong style="color:${badgeColor}; font-size:1.1rem;">${item.riskScore}%</strong>
                        <span class="badge" style="background:${badgeColor}22; color:${badgeColor}; font-size:0.65rem;">${badgeText}</span>
                    </div>
                    <!-- MAKLUMAT TAMBAHAN: HARI TIDAK HADIR -->
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 6px;">
                        <i class="fas fa-user-times" style="opacity: 0.7;"></i> Tidak Hadir: <strong style="color: ${item.absentCount > 0 ? '#ef4444' : '#22c55e'};">${item.absentCount}</strong> Hari
                    </div>
                </td>
                <td>${patternTag}</td>
                <td><span style="font-size:0.85rem; ${recommendationStyle}">${item.aiRecommendation}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
};

// 4. Eksport Laporan PDF untuk Kaunselor Sekolah
window.exportAIReportPDF = () => {
    if (!analyzedRiskData || analyzedRiskData.length === 0) return alert("Tiada data analisis AI.");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Laporan Analisis Prediktif Risiko Ponteng (AI)", 14, 15);
    doc.setFontSize(10);
    doc.text(`Tarikh Janaan: ${new Date().toLocaleDateString('ms-MY')}`, 14, 22);

    const highRiskOnly = analyzedRiskData.filter(d => d.riskCategory === 'HIGH' || d.riskCategory === 'MEDIUM');

    const body = highRiskOnly.map((d, idx) => [
        idx + 1,
        d.name,
        d.class_name_full || '-',
        `${d.riskScore}% (${d.riskCategory})\nTidak Hadir: ${d.absentCount} Hari`, // <-- Diselitkan di sini (\n untuk baris baharu)
        d.dominantDayPattern || (d.lateCount >= 3 ? `Kerap Lewat (${d.lateCount}x)` : 'Tiada Corak Khusus'),
        d.aiRecommendation
    ]);

    doc.autoTable({
        startY: 28,
        head: [['Bil.', 'Nama Murid', 'Kelas', 'Skor Risiko', 'Corak Dikesan', 'Tindakan Disyorkan']],
        body: body,
        theme: 'grid',
        headStyles: { fillColor: [147, 51, 234] }, // Tema warna Ungu AI
        styles: { fontSize: 8 }
    });

    doc.save(`Laporan_AI_Risiko_Ponteng_${new Date().toISOString().split('T')[0]}.pdf`);
};