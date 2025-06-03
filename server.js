const express = require('express');
const cors = require('cors');
const path = require('path');
const schedule = require('node-schedule');

// Import modules
const { scrapeBids } = require('./modules/scraper');
const { saveData, loadData } = require('./modules/storage');
const { scheduleUpdates, sendNotification } = require('./modules/scheduler');
const { exportToExcel, exportToHtmlCalendar } = require('./modules/exporter');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Global variables
let lastUpdateTime = null;
let isUpdating = false;

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/bids', async (req, res) => {
    try {
        const bids = await loadData('bids.json') || [];
        res.json({
            success: true,
            bids: bids,
            lastUpdate: lastUpdateTime,
            count: bids.length
        });
    } catch (error) {
        console.error('Error loading bids:', error);
        res.status(500).json({
            success: false,
            message: '데이터를 불러오는 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

app.post('/api/update', async (req, res) => {
    if (isUpdating) {
        return res.json({
            success: false,
            message: '이미 업데이트가 진행 중입니다.'
        });
    }

    try {
        isUpdating = true;
        console.log('수동 업데이트 시작...');
        
        // 기존 데이터 로드
        const existingBids = await loadData('bids.json') || [];
        
        // 새 데이터 수집
        const newBids = await scrapeBids();
        
        // 데이터 저장
        await saveData('bids.json', newBids);
        
        // 새로운 공고 확인
        const existingIds = new Set(existingBids.map(bid => bid.id));
        const newlyAdded = newBids.filter(bid => !existingIds.has(bid.id));
        
        lastUpdateTime = new Date().toISOString();
        
        // 로그 저장
        await saveData('logs.json', {
            timestamp: lastUpdateTime,
            type: 'manual',
            totalBids: newBids.length,
            newBids: newlyAdded.length,
            success: true
        });

        console.log(`업데이트 완료: 총 ${newBids.length}개, 신규 ${newlyAdded.length}개`);

        res.json({
            success: true,
            message: '업데이트가 완료되었습니다.',
            totalBids: newBids.length,
            newBids: newlyAdded.length,
            lastUpdate: lastUpdateTime
        });

    } catch (error) {
        console.error('Update error:', error);
        
        // 에러 로그 저장
        await saveData('logs.json', {
            timestamp: new Date().toISOString(),
            type: 'manual',
            success: false,
            error: error.message
        });

        res.status(500).json({
            success: false,
            message: '업데이트 중 오류가 발생했습니다.',
            error: error.message
        });
    } finally {
        isUpdating = false;
    }
});

app.post('/api/export', async (req, res) => {
    try {
        const bids = await loadData('bids.json') || [];
        const excelBuffer = await exportToExcel(bids);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=k-apt-bids-${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(excelBuffer);
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({
            success: false,
            message: 'Excel 내보내기 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

app.post('/api/export-pdf', async (req, res) => {
    try {
        const bids = await loadData('bids.json') || [];
        const { year, month, selectedBids } = req.body;
        
        console.log('=== HTML 월력 내보내기 시작 ===');
        console.log(`선택된 입찰공고 개수: ${selectedBids ? selectedBids.length : 0}`);
        
        if (selectedBids && selectedBids.length > 0) {
            selectedBids.forEach((bid, index) => {
                console.log(`[${index + 1}] ${bid.aptName} - 낙찰방법: "${bid.method}"`);
            });
        }
        
        const htmlContent = await exportToHtmlCalendar(bids, year, month, selectedBids);
        
        const now = new Date();
        const targetYear = year || now.getFullYear();
        const targetMonth = month || (now.getMonth() + 1);
        
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename=k-apt-calendar-${targetYear}-${String(targetMonth).padStart(2, '0')}.html`);
        res.send(htmlContent);
        
    } catch (error) {
        console.error('HTML export error:', error);
        res.status(500).json({
            success: false,
            message: 'HTML 월력 내보내기 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: {
            lastUpdate: lastUpdateTime,
            isUpdating: isUpdating,
            uptime: process.uptime(),
            memory: process.memoryUsage()
        }
    });
});

// 선택된 입찰공고 저장 API
app.post('/api/selected-bids', async (req, res) => {
    try {
        const { selectedBids } = req.body;
        await saveData('selected-bids.json', selectedBids);
        
        res.json({
            success: true,
            message: '선택된 입찰공고가 저장되었습니다.'
        });
    } catch (error) {
        console.error('Selected bids save error:', error);
        res.status(500).json({
            success: false,
            message: '선택된 입찰공고 저장 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 선택된 입찰공고 불러오기 API
app.get('/api/selected-bids', async (req, res) => {
    try {
        const selectedBids = await loadData('selected-bids.json') || {};
        res.json({
            success: true,
            selectedBids: selectedBids
        });
    } catch (error) {
        console.error('Selected bids load error:', error);
        res.status(500).json({
            success: false,
            message: '선택된 입찰공고를 불러오는 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 자동 업데이트 스케줄러 초기화
function initializeScheduler() {
    // 매일 09:00, 17:00에 자동 업데이트
    schedule.scheduleJob('0 9,17 * * *', async () => {
        if (isUpdating) {
            console.log('이미 업데이트가 진행 중입니다. 스케줄된 업데이트를 건너뜁니다.');
            return;
        }

        try {
            isUpdating = true;
            console.log('자동 업데이트 시작...');
            
            const existingBids = await loadData('bids.json') || [];
            const newBids = await scrapeBids();
            
            await saveData('bids.json', newBids);
            
            const existingIds = new Set(existingBids.map(bid => bid.id));
            const newlyAdded = newBids.filter(bid => !existingIds.has(bid.id));
            
            lastUpdateTime = new Date().toISOString();
            
            // 로그 저장
            await saveData('logs.json', {
                timestamp: lastUpdateTime,
                type: 'scheduled',
                totalBids: newBids.length,
                newBids: newlyAdded.length,
                success: true
            });

            console.log(`자동 업데이트 완료: 총 ${newBids.length}개, 신규 ${newlyAdded.length}개`);
            
            // 새로운 공고가 있으면 알림
            if (newlyAdded.length > 0) {
                sendNotification(`새로운 입찰공고 ${newlyAdded.length}건이 등록되었습니다.`);
            }

        } catch (error) {
            console.error('자동 업데이트 실패:', error);
            
            await saveData('logs.json', {
                timestamp: new Date().toISOString(),
                type: 'scheduled',
                success: false,
                error: error.message
            });
        } finally {
            isUpdating = false;
        }
    });

    console.log('자동 업데이트 스케줄러가 초기화되었습니다. (09:00, 17:00)');
}

// 서버 시작
app.listen(PORT, async () => {
    console.log(`🚀 K-apt 입찰공고 관리 시스템이 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log('📊 시스템 기능:');
    console.log('   - 자동 데이터 수집 (09:00, 17:00)');
    console.log('   - 수동 업데이트');
    console.log('   - Excel 내보내기');
    console.log('   - PDF 월력 내보내기');
    console.log('   - 실시간 필터링 및 검색');
    
    // 스케줄러 초기화
    initializeScheduler();
    
    // 시작 시 한 번 데이터 로드
    try {
        const existingBids = await loadData('bids.json');
        if (!existingBids || existingBids.length === 0) {
            console.log('초기 데이터를 수집합니다...');
            const initialBids = await scrapeBids();
            await saveData('bids.json', initialBids);
            lastUpdateTime = new Date().toISOString();
            console.log(`초기 데이터 수집 완료: ${initialBids.length}개`);
        } else {
            console.log(`기존 데이터 로드 완료: ${existingBids.length}개`);
        }
    } catch (error) {
        console.error('초기 데이터 로드 실패:', error);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n서버가 종료됩니다...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app; 