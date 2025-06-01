/**
 * Excel 내보내기 모듈
 * 입찰공고 데이터를 Excel 파일로 내보내는 기능 제공
 */

const XLSX = require('xlsx');
// const htmlPdf = require('html-pdf-node'); // PDF 라이브러리 제거

/**
 * 입찰공고 데이터를 Excel 파일로 변환
 * @param {Array} bids - 입찰공고 데이터 배열
 * @returns {Buffer} Excel 파일 버퍼
 */
async function exportToExcel(bids) {
    try {
        // 워크북 생성
        const workbook = XLSX.utils.book_new();
        
        // 통계 시트 데이터
        const stats = calculateBidStatistics(bids);
        const statsData = [
            ['📊 K-apt 입찰공고 통계 리포트'],
            ['생성일시', new Date().toLocaleString('ko-KR')],
            [''],
            ['항목', '개수'],
            ['전체 공고', stats.total],
            ['오늘 등록', stats.todayRegistered],
            ['오늘 마감', stats.todayDeadline],
            ['이번주 내 마감', stats.weekDeadline],
            ['적격심사', stats.qualification],
            ['최저낙찰', stats.lowestBid],
            [''],
            ['지역별 통계'],
            ...Object.entries(stats.byRegion).map(([region, count]) => [region, count]),
            [''],
            ['카테고리별 통계'],
            ...Object.entries(stats.byCategory).map(([category, count]) => [category, count])
        ];
        
        // 통계 시트 생성
        const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
        XLSX.utils.book_append_sheet(workbook, statsSheet, '통계');
        
        // 데이터 시트용 헤더 및 데이터
        const headers = [
            'ID',
            '공고명',
            '단지명',
            '지역',
            '카테고리',
            '낙찰방법',
            '상태',
            '등록일',
            '마감일'
        ];
        
        const dataRows = bids.map(bid => [
            bid.id || '',
            bid.title || '',
            bid.aptName || '',
            bid.region || '',
            bid.category || '',
            bid.method || '',
            bid.status || '',
            formatDateForExcel(bid.postDate) || '',
            formatDateForExcel(bid.deadline) || ''
        ]);
        
        // 헤더 + 데이터 결합
        const sheetData = [headers, ...dataRows];
        
        // 데이터 시트 생성
        const dataSheet = XLSX.utils.aoa_to_sheet(sheetData);
        
        // 컬럼 너비 자동 조정
        const colWidths = headers.map((header, idx) => {
            const maxLength = Math.max(
                header.length,
                ...dataRows.map(row => String(row[idx] || '').length)
            );
            return { wch: Math.min(Math.max(maxLength + 2, 10), 50) };
        });
        dataSheet['!cols'] = colWidths;
        
        XLSX.utils.book_append_sheet(workbook, dataSheet, '입찰공고');
        
        // Excel 파일을 버퍼로 변환
        const excelBuffer = XLSX.write(workbook, { 
            type: 'buffer', 
            bookType: 'xlsx',
            compression: true
        });
        
        return excelBuffer;
        
    } catch (error) {
        console.error('Excel 내보내기 오류:', error);
        throw new Error(`Excel 내보내기 실패: ${error.message}`);
    }
}

/**
 * 날짜를 Excel 친화적 형식으로 변환
 * @param {string|Date} dateValue - 날짜 값
 * @returns {string} 형식화된 날짜 문자열
 */
function formatDateForExcel(dateValue) {
    if (!dateValue) return '';
    
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return dateValue;
        
        // YYYY-MM-DD 형식
        return date.toLocaleDateString('ko-KR');
            
    } catch (error) {
        return dateValue;
    }
}

/**
 * 입찰공고 통계 계산
 * @param {Array} bids - 입찰공고 데이터
 * @returns {Object} 통계 정보
 */
function calculateBidStatistics(bids) {
    const stats = {
        total: bids.length,
        todayRegistered: 0,
        todayDeadline: 0,
        weekDeadline: 0,
        qualification: 0,
        lowestBid: 0,
        byRegion: {},
        byCategory: {}
    };
    
    const today = new Date();
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
    
    bids.forEach(bid => {
        // 오늘 등록
        const postDate = new Date(bid.postDate);
        if (postDate.toDateString() === today.toDateString()) {
            stats.todayRegistered++;
        }
        
        // 오늘 마감
        const deadline = new Date(bid.deadline);
        if (deadline.toDateString() === today.toDateString()) {
            stats.todayDeadline++;
        }
        
        // 이번주 내 마감
        if (deadline >= today && deadline <= endOfWeek) {
            stats.weekDeadline++;
        }
        
        // 적격심사
        if (bid.method && bid.method.includes('적격심사')) {
            stats.qualification++;
        }
        
        // 최저낙찰
        if (bid.method && bid.method.toLowerCase().includes('최저') && bid.method.toLowerCase().includes('낙찰')) {
            stats.lowestBid++;
        }
        
        // 지역별 집계
        const region = bid.region || '기타';
        stats.byRegion[region] = (stats.byRegion[region] || 0) + 1;
        
        // 카테고리별 집계
        const category = bid.category || '기타';
        stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    });
    
    return stats;
}

/**
 * 필터링된 데이터를 Excel로 내보내기
 * @param {Array} bids - 입찰공고 데이터
 * @param {Object} filters - 필터 조건
 * @returns {Buffer} Excel 파일 버퍼
 */
async function exportFilteredData(bids, filters = {}) {
    try {
        let filteredBids = [...bids];
        
        // 필터 적용
        if (filters.search) {
            filteredBids = filteredBids.filter(bid => 
                bid.aptName && bid.aptName.toLowerCase().includes(filters.search.toLowerCase())
            );
        }
        
        if (filters.method) {
            filteredBids = filteredBids.filter(bid => 
                bid.method && bid.method.includes(filters.method)
            );
        }
        
        if (filters.region) {
            filteredBids = filteredBids.filter(bid => 
                bid.region && bid.region.includes(filters.region)
            );
        }
        
        return await exportToExcel(filteredBids);
        
    } catch (error) {
        console.error('필터링된 Excel 내보내기 오류:', error);
        throw new Error(`필터링된 Excel 내보내기 실패: ${error.message}`);
    }
}

/**
 * Excel 템플릿 생성
 * @returns {Buffer} 빈 템플릿 Excel 파일 버퍼
 */
async function createTemplate() {
    try {
        const workbook = XLSX.utils.book_new();
        
        const headers = [
            'ID',
            '공고명',
            '단지명',
            '지역',
            '카테고리',
            '낙찰방법',
            '상태',
            '등록일',
            '마감일'
        ];
        
        const templateData = [
            headers,
            ['예시1', '샘플 공고명', '샘플 단지', '서울', '경비', '적격심사', '진행중', '2025-05-31', '2025-06-15']
        ];
        
        const sheet = XLSX.utils.aoa_to_sheet(templateData);
        XLSX.utils.book_append_sheet(workbook, sheet, '템플릿');
        
        const templateBuffer = XLSX.write(workbook, { 
            type: 'buffer', 
            bookType: 'xlsx' 
        });
        
        return templateBuffer;
        
    } catch (error) {
        console.error('템플릿 생성 오류:', error);
        throw new Error(`템플릿 생성 실패: ${error.message}`);
    }
}

/**
 * 낙찰방법을 축약 형태로 변환
 * @param {string} method - 낙찰방법
 * @returns {string} 축약된 낙찰방법
 */
function getMethodPrefix(method) {
    if (!method) {
        return '';
    }
    
    // 최저낙찰만 "[최저]" 형태로 표시, 나머지는 빈 문자열 반환
    const methodLower = method.toLowerCase().trim();
    
    // 다양한 최저낙찰 표기 방식을 모두 처리
    if ((methodLower.includes('최저') && methodLower.includes('낙찰')) ||
        methodLower.includes('최저낙찰') ||
        methodLower === '최저' ||
        methodLower.match(/최저.{0,3}낙찰/)) {  // 최저와 낙찰 사이에 0~3글자
        return '[최저]';
    }
    
    return ''; // 적격심사나 다른 방법들은 표시하지 않음
}

/**
 * HTML 월력 생성 (인쇄용)
 * @param {Array} bids - 입찰공고 데이터
 * @param {string} year - 년도 (기본값: 현재 년도)
 * @param {string} month - 월 (기본값: 현재 월)
 * @param {Array} selectedBids - 선택된 입찰공고 추가 정보
 * @returns {string} 완전한 HTML 파일 내용
 */
async function exportToHtmlCalendar(bids, year = null, month = null, selectedBids = []) {
    try {
        console.log('HTML 월력 생성 시작...');
        
        // 기본값 설정
        const now = new Date();
        const targetYear = year || now.getFullYear();
        const targetMonth = month || (now.getMonth() + 1);
        
        console.log(`대상 월: ${targetYear}년 ${targetMonth}월`);
        console.log(`선택된 입찰공고: ${selectedBids.length}건`);
        
        // 월력 HTML 생성
        const calendarHtml = generateCalendarHtml(bids, targetYear, targetMonth, selectedBids);
        console.log('HTML 생성 완료');
        
        // 완전한 HTML 문서 생성 (인쇄용 안내 포함)
        const completeHtml = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>K-apt 입찰공고 4주 일정 - ${targetYear}년 ${targetMonth}월</title>
    <style>
        /* 인쇄 안내 스타일 */
        .print-instructions {
            background: #e3f2fd;
            border: 2px solid #1976d2;
            border-radius: 8px;
            padding: 20px;
            margin: 20px;
            font-family: 'Malgun Gothic', Arial, sans-serif;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .print-instructions h2 {
            color: #1976d2;
            margin-top: 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .print-instructions .step {
            background: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
            border-left: 4px solid #1976d2;
        }
        .print-instructions .step-number {
            background: #1976d2;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            margin-right: 10px;
        }
        .print-button {
            background: #1976d2;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            margin: 10px 5px;
        }
        .print-button:hover {
            background: #1565c0;
        }
        
        /* 인쇄 시 안내 숨김 */
        @media print {
            .print-instructions {
                display: none !important;
            }
            body {
                margin: 0;
                padding: 0;
            }
        }
        
        /* 기존 월력 스타일 */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            font-family: 'Malgun Gothic', Arial, sans-serif;
            font-size: 10px;
            line-height: 1.2;
        }
        .calendar-container {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
        }
        .calendar-header {
            text-align: center;
            padding: 8px 0;
            background-color: #2c5aa0;
            color: white;
            margin-bottom: 8px;
        }
        .calendar-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 2px;
        }
        .calendar-subtitle {
            font-size: 11px;
            opacity: 0.9;
        }
        .calendar-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 0 5mm;
        }
        .calendar-grid {
            width: 100%;
            border-collapse: collapse;
            border: 2px solid #2c5aa0;
            flex: 1;
            min-height: 600px;
        }
        .day-header {
            background-color: #f8f9fa;
            font-weight: bold;
            text-align: center;
            padding: 8px 3px;
            border: 1px solid #dee2e6;
            font-size: 12px;
            height: 40px;
        }
        .sunday { color: #dc3545; }
        .saturday { color: #0066cc; }
        .calendar-cell {
            width: 14.28%;
            border: 1px solid #dee2e6;
            vertical-align: top;
            padding: 4px;
            position: relative;
            height: 150px;
        }
        .date-number {
            font-weight: bold;
            font-size: 13px;
            margin-bottom: 3px;
        }
        .bid-item {
            font-size: 9px;
            padding: 2px 3px;
            margin: 1px 0;
            border-radius: 1px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
        }
        .bid-deadline {
            background-color: #ffebee;
            border-left: 2px solid #d32f2f;
            color: #b71c1c;
        }
        .bid-sitevisit {
            background-color: #e8f5e8;
            border-left: 2px solid #4caf50;
            color: #2e7d32;
        }
        .bid-sitept {
            background-color: #fff3e0;
            border-left: 2px solid #ff9800;
            color: #e65100;
        }
        .legend {
            margin-top: 8px;
            display: flex;
            justify-content: center;
            gap: 15px;
            padding-bottom: 10px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            font-size: 9px;
        }
        .legend-color {
            width: 10px;
            height: 10px;
            margin-right: 3px;
            border-radius: 1px;
        }
        .today {
            background-color: #fff8e1;
            border: 2px solid #ffa000;
        }
        
        /* 인쇄용 최적화 */
        @media print {
            .calendar-container {
                height: 100vh;
                page-break-inside: avoid;
            }
            .calendar-grid {
                min-height: calc(100vh - 150px);
            }
            .calendar-cell {
                height: calc((100vh - 200px) / 4);
            }
        }
        
        @page {
            size: A4 landscape;
            margin: 10mm;
        }
    </style>
</head>
<body>
    <!-- 인쇄 안내 (인쇄 시 숨김) -->
    <div class="print-instructions">
        <h2>📋 PDF 저장 안내</h2>
        <div class="step">
            <span class="step-number">1</span>
            <strong>아래 "인쇄하기" 버튼을 클릭</strong>하거나 <strong>Ctrl+P</strong> (Mac: Cmd+P)를 누르세요
        </div>
        <div class="step">
            <span class="step-number">2</span>
            프린터 선택에서 <strong>"PDF로 저장"</strong> 또는 <strong>"Microsoft Print to PDF"</strong>를 선택하세요
        </div>
        <div class="step">
            <span class="step-number">3</span>
            용지 방향을 <strong>"가로"</strong>로 설정하고 여백을 <strong>"최소"</strong>로 설정하세요
        </div>
        <div class="step">
            <span class="step-number">4</span>
            <strong>"저장"</strong> 버튼을 클릭하여 PDF 파일로 저장하세요
        </div>
        <div style="text-align: center; margin-top: 20px;">
            <button class="print-button" onclick="window.print()">🖨️ 인쇄하기 (PDF 저장)</button>
            <button class="print-button" onclick="window.close()">❌ 닫기</button>
        </div>
    </div>

    <!-- 월력 내용 -->
    ${calendarHtml}
</body>
</html>`;
        
        console.log(`HTML 월력 생성 완료: ${completeHtml.length} characters`);
        return completeHtml;
        
    } catch (error) {
        console.error('HTML 월력 생성 오류:', error);
        throw new Error(`HTML 월력 생성 실패: ${error.message}`);
    }
}

/**
 * 월력 HTML 생성
 * @param {Array} bids - 입찰공고 데이터
 * @param {number} year - 년도
 * @param {number} month - 월
 * @param {Array} selectedBids - 선택된 입찰공고 추가 정보
 * @returns {string} HTML 문자열
 */
function generateCalendarHtml(bids, year, month, selectedBids = []) {
    const monthNames = [
        '1월', '2월', '3월', '4월', '5월', '6월',
        '7월', '8월', '9월', '10월', '11월', '12월'
    ];
    
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    
    // 현재 주의 시작일과 4주 범위 계산
    const today = new Date();
    const currentDayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDayOfWeek);
    
    const endOfFourWeeks = new Date(startOfWeek);
    endOfFourWeeks.setDate(startOfWeek.getDate() + (4 * 7) - 1);
    
    // 4주 범위 내의 입찰공고만 필터링
    const filteredBids = selectedBids.filter(bid => {
        if (!bid.deadline) return false;
        const deadline = new Date(bid.deadline);
        return deadline >= startOfWeek && deadline <= endOfFourWeeks;
    });
    
    // 월력에 표시할 입찰공고 데이터 분류
    const bidsByDate = organizeBidsByDate(bids, year, month, selectedBids);
    
    // 첫 번째 주의 시작 날짜와 마지막 주의 끝 날짜
    const startDate = new Date(startOfWeek);
    const endDate = new Date(endOfFourWeeks);
    
    // HTML 생성
    let html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            html, body {
                height: 100vh;
                width: 100vw;
                font-family: 'Malgun Gothic', Arial, sans-serif;
                font-size: 10px;
                line-height: 1.2;
                page-break-inside: avoid;
            }
            .calendar-container {
                height: 100vh;
                display: flex;
                flex-direction: column;
                padding: 5mm;
            }
            .calendar-header {
                text-align: center;
                padding: 8px 0;
                background-color: #2c5aa0;
                color: white;
                margin-bottom: 8px;
                page-break-inside: avoid;
                flex-shrink: 0;
            }
            .calendar-title {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 2px;
            }
            .calendar-subtitle {
                font-size: 11px;
                opacity: 0.9;
            }
            .calendar-content {
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            .calendar-grid {
                width: 100%;
                height: 100%;
                border-collapse: collapse;
                border: 2px solid #2c5aa0;
                page-break-inside: avoid;
                flex: 1;
            }
            .day-header {
                background-color: #f8f9fa;
                font-weight: bold;
                text-align: center;
                padding: 8px 3px;
                border: 1px solid #dee2e6;
                font-size: 12px;
                height: 40px;
            }
            .sunday { color: #dc3545; }
            .saturday { color: #0066cc; }
            .calendar-cell {
                width: 14.28%;
                border: 1px solid #dee2e6;
                vertical-align: top;
                padding: 4px;
                position: relative;
                page-break-inside: avoid;
            }
            .calendar-row {
                height: calc((100% - 40px) / 4);
            }
            .date-number {
                font-weight: bold;
                font-size: 13px;
                margin-bottom: 3px;
            }
            .bid-item {
                font-size: 9px;
                padding: 2px 3px;
                margin: 1px 0;
                border-radius: 1px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1.2;
            }
            .bid-post {
                background-color: #e3f2fd;
                border-left: 2px solid #1976d2;
                color: #0d47a1;
            }
            .bid-deadline {
                background-color: #ffebee;
                border-left: 2px solid #d32f2f;
                color: #b71c1c;
            }
            .bid-sitevisit {
                background-color: #e8f5e8;
                border-left: 2px solid #4caf50;
                color: #2e7d32;
            }
            .bid-sitept {
                background-color: #fff3e0;
                border-left: 2px solid #ff9800;
                color: #e65100;
            }
            .bid-both {
                background-color: #fff3e0;
                border-left: 2px solid #f57c00;
                color: #e65100;
            }
            .legend {
                margin-top: 8px;
                display: flex;
                justify-content: center;
                gap: 15px;
                page-break-inside: avoid;
                flex-shrink: 0;
            }
            .legend-item {
                display: flex;
                align-items: center;
                font-size: 9px;
            }
            .legend-color {
                width: 10px;
                height: 10px;
                margin-right: 3px;
                border-radius: 1px;
            }
            .empty-cell {
                background-color: #f8f9fa;
            }
            .today {
                background-color: #fff8e1;
                border: 2px solid #ffa000;
            }
            @page {
                size: A4 landscape;
                margin: 0;
            }
            @media print {
                html, body { 
                    height: 100vh;
                    width: 100vw;
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                }
                .calendar-grid {
                    page-break-inside: avoid;
                }
                tr {
                    page-break-inside: avoid;
                }
            }
        </style>
    </head>
    <body>
        <div class="calendar-container">
            <div class="calendar-header">
                <div class="calendar-title">K-apt 입찰공고 4주 일정</div>
                <div class="calendar-subtitle">${startDate.toLocaleDateString('ko-KR')} ~ ${endDate.toLocaleDateString('ko-KR')} (${filteredBids.length}건)</div>
            </div>
            
            <div class="calendar-content">
                <table class="calendar-grid">
                    <tr>`;
    
    // 요일 헤더
    dayNames.forEach((day, index) => {
        const dayClass = index === 0 ? 'sunday' : (index === 6 ? 'saturday' : '');
        html += `<th class="day-header ${dayClass}">${day}</th>`;
    });
    html += '</tr>';
    
    // 4주간의 달력 생성
    let currentDate = new Date(startOfWeek);
    
    for (let week = 0; week < 4; week++) {
        html += '<tr class="calendar-row">';
        
        for (let day = 0; day < 7; day++) {
            const isToday = currentDate.toDateString() === today.toDateString();
            const cellClass = isToday ? 'calendar-cell today' : 'calendar-cell';
            const dateKey = currentDate.toISOString().split('T')[0];
            const dayBids = bidsByDate[dateKey] || [];
            
            let cellContent = `<div class="date-number">${currentDate.getDate()}</div>`;
            
            // 마감일 기준으로 표시 (공고일 정보 포함)
            dayBids.forEach(bid => {
                if (bid.eventType === 'deadline') {
                    const postDateStr = bid.postDate ? 
                        new Date(bid.postDate).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }).replace(/\./g, '.').replace(/\s/g, '') : '';
                    const bidTimeStr = bid.bidTime || '';
                    const submissionStr = bid.submissionMethod || '';
                    
                    let infoStr = '';
                    if (postDateStr || bidTimeStr || submissionStr) {
                        const infoParts = [postDateStr, bidTimeStr, submissionStr].filter(part => part);
                        infoStr = `(${infoParts.join(', ')})`;
                    }
                    
                    cellContent += `<div class="bid-item bid-deadline" title="마감: ${bid.title}">${getMethodPrefix(bid.method)}${bid.aptName}${infoStr}</div>`;
                } else if (bid.eventType === 'siteVisit') {
                    let timeStr = '';
                    if (bid.eventTime && bid.eventTime.startTime && bid.eventTime.endTime) {
                        timeStr = `(${bid.eventTime.startTime}~${bid.eventTime.endTime})`;
                    } else if (bid.eventTime && bid.eventTime.startTime) {
                        timeStr = `(${bid.eventTime.startTime}~)`;
                    }
                    cellContent += `<div class="bid-item bid-sitevisit" title="현장설명회: ${bid.title}">${getMethodPrefix(bid.method)}${bid.aptName}${timeStr}</div>`;
                } else if (bid.eventType === 'sitePT') {
                    const timeStr = bid.eventTime ? `(${bid.eventTime})` : '';
                    cellContent += `<div class="bid-item bid-sitept" title="현장PT: ${bid.title}">${getMethodPrefix(bid.method)}${bid.aptName}${timeStr}</div>`;
                }
            });
            
            html += `<td class="${cellClass}">${cellContent}</td>`;
            
            // 다음 날로 이동
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        html += '</tr>';
    }
    
    html += `
                </table>
                
                <div class="legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #ffebee; border-left: 2px solid #d32f2f;"></div>
                        <span>입찰마감일 (공고일)</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #e8f5e8; border-left: 2px solid #4caf50;"></div>
                        <span>현장설명회 (시간)</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #fff3e0; border-left: 2px solid #ff9800;"></div>
                        <span>현장PT (시간)</span>
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>`;
    
    return html;
}

/**
 * 입찰공고를 날짜별로 분류
 * @param {Array} bids - 입찰공고 데이터
 * @param {number} year - 년도
 * @param {number} month - 월
 * @param {Array} selectedBids - 선택된 입찰공고 추가 정보
 * @returns {Object} 날짜별 분류된 입찰공고
 */
function organizeBidsByDate(bids, year, month, selectedBids = []) {
    const bidsByDate = {};
    
    // 현재 주의 시작일 (일요일) 계산
    const today = new Date();
    const currentDayOfWeek = today.getDay(); // 0: 일요일, 1: 월요일, ...
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - currentDayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // 4주 후의 마지막 날 (토요일) 계산
    const endOfFourWeeks = new Date(startOfWeek);
    endOfFourWeeks.setDate(startOfWeek.getDate() + (4 * 7) - 1); // 4주 = 28일, -1로 토요일까지
    endOfFourWeeks.setHours(23, 59, 59, 999);
    
    console.log(`월력 표시 범위: ${startOfWeek.toLocaleDateString()} ~ ${endOfFourWeeks.toLocaleDateString()}`);
    
    // 선택된 입찰공고만 처리 (기본 마감일 정보 포함)
    selectedBids.forEach(selectedBid => {
        console.log(`선택된 입찰공고 처리: ${selectedBid.aptName}`);
        console.log(`낙찰방법: "${selectedBid.method}"`);
        console.log(`입찰시간: ${selectedBid.bidTime}, 제출방법: ${selectedBid.submissionMethod}`);
        console.log(`현장설명회: ${JSON.stringify(selectedBid.siteVisit)}`);
        console.log(`현장PT: ${JSON.stringify(selectedBid.sitePT)}`);
        
        // 마감일 이벤트 추가
        if (selectedBid.deadline) {
            const deadline = new Date(selectedBid.deadline);
            if (deadline >= startOfWeek && deadline <= endOfFourWeeks) {
                const dateKey = deadline.toISOString().split('T')[0];
                if (!bidsByDate[dateKey]) {
                    bidsByDate[dateKey] = [];
                }
                bidsByDate[dateKey].push({
                    ...selectedBid,
                    eventType: 'deadline'
                });
                console.log(`마감일 이벤트 추가됨: ${dateKey}, 낙찰방법: "${selectedBid.method}"`);
            }
        }
        
        // 현장설명회 이벤트
        if (selectedBid.siteVisit && selectedBid.siteVisit.enabled && selectedBid.siteVisit.date) {
            const visitDate = new Date(selectedBid.siteVisit.date);
            console.log(`현장설명회 날짜: ${visitDate.toISOString()}`);
            if (visitDate >= startOfWeek && visitDate <= endOfFourWeeks) {
                const dateKey = visitDate.toISOString().split('T')[0];
                if (!bidsByDate[dateKey]) {
                    bidsByDate[dateKey] = [];
                }
                bidsByDate[dateKey].push({
                    ...selectedBid,
                    eventType: 'siteVisit',
                    eventTime: {
                        startTime: selectedBid.siteVisit.startTime,
                        endTime: selectedBid.siteVisit.endTime
                    }
                });
                console.log(`현장설명회 이벤트 추가됨: ${dateKey} (${selectedBid.siteVisit.startTime}~${selectedBid.siteVisit.endTime}), 낙찰방법: "${selectedBid.method}"`);
            }
        }
        
        // 현장PT 이벤트
        if (selectedBid.sitePT && selectedBid.sitePT.enabled && selectedBid.sitePT.date) {
            const ptDate = new Date(selectedBid.sitePT.date);
            console.log(`현장PT 날짜: ${ptDate.toISOString()}`);
            if (ptDate >= startOfWeek && ptDate <= endOfFourWeeks) {
                const dateKey = ptDate.toISOString().split('T')[0];
                if (!bidsByDate[dateKey]) {
                    bidsByDate[dateKey] = [];
                }
                bidsByDate[dateKey].push({
                    ...selectedBid,
                    eventType: 'sitePT',
                    eventTime: selectedBid.sitePT.time
                });
                console.log(`현장PT 이벤트 추가됨: ${dateKey}, 낙찰방법: "${selectedBid.method}"`);
            }
        }
    });
    
    return bidsByDate;
}

module.exports = {
    exportToExcel,
    exportFilteredData,
    createTemplate,
    calculateBidStatistics,
    exportToHtmlCalendar,
    generateCalendarHtml,
    organizeBidsByDate
}; 