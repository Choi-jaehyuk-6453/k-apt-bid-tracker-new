const express = require('express');
const cors = require('cors');
const path = require('path');

// Import modules
const { scrapeBids } = require('./modules/scraper');
const { saveData, loadData } = require('./modules/storage');
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
        const existingSelectedBids = await loadData('selected-bids.json') || {};
        
        // 새 데이터 수집
        const newBids = await scrapeBids();
        
        // 데이터 저장
        await saveData('bids.json', newBids);
        
        // 새로운 공고 확인
        const existingIds = new Set(existingBids.map(bid => bid.id));
        const newlyAdded = newBids.filter(bid => !existingIds.has(bid.id));
        
        // 선택된 입찰공고 관리
        let removedCount = 0;
        let updatedCount = 0;
        let invalidSelectionCount = 0;
        
        // 1. 삭제된 공고나 날짜가 변경된 공고 제거
        const newBidsMap = new Map(newBids.map(bid => [bid.id, bid]));
        const updatedSelectedBids = {};
        
        Object.entries(existingSelectedBids).forEach(([bidId, selectedBidData]) => {
            const newBid = newBidsMap.get(bidId);
            
            if (!newBid) {
                // 공고가 삭제됨
                removedCount++;
                console.log(`삭제된 공고 제거: ${selectedBidData.aptName || bidId}`);
                return;
            }
            
            // 날짜가 변경되었는지 확인
            const oldDeadline = selectedBidData.deadline;
            const newDeadline = newBid.deadline;
            
            if (oldDeadline !== newDeadline) {
                // 날짜가 변경됨
                removedCount++;
                console.log(`날짜 변경된 공고 제거: ${selectedBidData.aptName || bidId} (${oldDeadline} → ${newDeadline})`);
                return;
            }
            
            // 유효한 공고는 유지하되, 새로운 데이터로 업데이트
            updatedSelectedBids[bidId] = {
                ...newBid, // 새로운 데이터로 업데이트
                // 사용자 설정은 유지
                bidTime: selectedBidData.bidTime || '',
                submissionMethod: selectedBidData.submissionMethod || '전자',
                siteVisit: selectedBidData.siteVisit || { enabled: false, date: '', startTime: '', endTime: '' },
                sitePT: selectedBidData.sitePT || { enabled: false, date: '', time: '' }
            };
            
            // 데이터가 실제로 변경되었는지 확인
            const oldData = JSON.stringify(selectedBidData);
            const newData = JSON.stringify(updatedSelectedBids[bidId]);
            if (oldData !== newData) {
                updatedCount++;
            }
        });
        
        // 2. 새로 추가된 공고 중 잘못 선택된 것들 확인
        newlyAdded.forEach(newBid => {
            if (existingSelectedBids[newBid.id]) {
                invalidSelectionCount++;
                console.log(`잘못 선택된 새 공고 발견: ${newBid.aptName || newBid.id}`);
                // 선택 목록에서 제거
                delete updatedSelectedBids[newBid.id];
            }
        });
        
        // 업데이트된 선택된 입찰공고 저장
        await saveData('selected-bids.json', updatedSelectedBids);
        
        lastUpdateTime = new Date().toISOString();
        
        // 로그 저장
        await saveData('logs.json', {
            timestamp: lastUpdateTime,
            type: 'manual',
            totalBids: newBids.length,
            newBids: newlyAdded.length,
            removedSelectedBids: removedCount,
            updatedSelectedBids: updatedCount,
            invalidSelections: invalidSelectionCount,
            success: true
        });

        console.log(`업데이트 완료: 총 ${newBids.length}개, 신규 ${newlyAdded.length}개`);
        console.log(`선택 관리: ${removedCount}개 제거, ${updatedCount}개 업데이트, ${invalidSelectionCount}개 잘못 선택 제거`);

        // 상세한 메시지 생성
        let message = `업데이트가 완료되었습니다.`;
        let details = [];
        
        if (newlyAdded.length > 0) {
            details.push(`신규 공고: ${newlyAdded.length}건`);
        }
        
        if (removedCount > 0) {
            details.push(`선택 제거: ${removedCount}건 (삭제/날짜변경)`);
        }
        
        if (updatedCount > 0) {
            details.push(`선택 업데이트: ${updatedCount}건`);
        }
        
        if (invalidSelectionCount > 0) {
            details.push(`잘못 선택 제거: ${invalidSelectionCount}건`);
        }
        
        if (details.length > 0) {
            message += ` (${details.join(', ')})`;
        }

        res.json({
            success: true,
            message: message,
            totalBids: newBids.length,
            newBids: newlyAdded.length,
            removedSelectedBids: removedCount,
            updatedSelectedBids: updatedCount,
            invalidSelections: invalidSelectionCount,
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
        // 새로운 구조 (selectedBids + checkOrder) 또는 기존 구조 (selectedBids만) 처리
        const requestData = req.body;
        let dataToSave;
        
        if (requestData.selectedBids && requestData.checkOrder) {
            // 새로운 구조
            dataToSave = {
                selectedBids: requestData.selectedBids,
                checkOrder: requestData.checkOrder
            };
        } else if (requestData.selectedBids) {
            // 기존 구조 (하위 호환성)
            dataToSave = requestData.selectedBids;
        } else {
            // 매우 오래된 구조
            dataToSave = requestData;
        }
        
        await saveData('selected-bids.json', dataToSave);
        
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
        const savedData = await loadData('selected-bids.json') || {};
        
        // 새로운 구조와 기존 구조 모두 처리
        let selectedBids, checkOrder;
        if (savedData.selectedBids && savedData.checkOrder) {
            // 새로운 구조
            selectedBids = savedData.selectedBids;
            checkOrder = savedData.checkOrder;
        } else {
            // 기존 구조 (하위 호환성)
            selectedBids = savedData;
            checkOrder = Object.keys(savedData);
        }
        
        res.json({
            success: true,
            selectedBids: selectedBids,
            checkOrder: checkOrder
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

// 🔄 선택된 입찰공고 저장소 관리 API (새로 추가)

// 저장소 목록 조회
app.get('/api/saved-selections', async (req, res) => {
    try {
        // MongoDB 환경인 경우
        if (process.env.MONGODB_URI) {
            try {
                const database = require('./modules/database');
                const db = await database.connect();
                
                // saved-selection으로 시작하는 컬렉션들 찾기 (백업 제외)
                const collections = await db.listCollections().toArray();
                const savedSelections = collections
                    .filter(col => col.name.startsWith('saved-selection-') && !col.name.endsWith('_backup'))
                    .map(col => {
                        const timestamp = col.name.replace('saved-selection-', '');
                        console.log(`타임스탬프 파싱 시도: ${timestamp}`);
                        
                        // ISO 타임스탬프 파싱 (2025-06-07T08-34-57-377Z 형식)
                        let parsedDate;
                        try {
                            // 2025-06-07T08-34-57-377Z-123 형태를 처리
                            let isoString = timestamp;
                            
                            // 마지막에 추가된 랜덤 접미사 제거 (마지막 하이픈 이후)
                            const lastDashIndex = isoString.lastIndexOf('-');
                            const zIndex = isoString.indexOf('Z');
                            if (lastDashIndex > zIndex) {
                                isoString = isoString.substring(0, lastDashIndex);
                            }
                            
                            // YYYY-MM-DDTHH-MM-SS-sssZ -> YYYY-MM-DDTHH:MM:SS.sssZ
                            const tIndex = isoString.indexOf('T');
                            if (tIndex !== -1) {
                                const timePart = isoString.substring(tIndex + 1);
                                const datePart = isoString.substring(0, tIndex + 1);
                                
                                // 시간 부분에서 하이픈을 콜론과 점으로 변경
                                // HH-MM-SS-sssZ -> HH:MM:SS.sssZ
                                const timeConverted = timePart
                                    .replace(/^(\d{2})-(\d{2})-(\d{2})-(\d{3})(.*)$/, '$1:$2:$3.$4$5');
                                
                                isoString = datePart + timeConverted;
                            }
                            
                            console.log(`변환된 ISO 문자열: ${isoString}`);
                            parsedDate = new Date(isoString);
                            
                            if (isNaN(parsedDate.getTime())) {
                                throw new Error('Invalid date');
                            }
                            
                            // 이미 한국 시간으로 저장된 것이므로 추가 변환 불필요
                            console.log(`파싱 성공: ${parsedDate.toISOString()} (한국 시간 기준)`);
                            console.log(`한국 시간 표시: ${parsedDate.toLocaleString('ko-KR')}`);
                        } catch (e) {
                            console.warn(`타임스탬프 파싱 실패: ${timestamp}, 에러: ${e.message}`);
                            parsedDate = new Date();
                        }
                        
                        return {
                            filename: `${col.name}.json`,
                            timestamp: timestamp,
                            date: parsedDate,
                            size: 0, // MongoDB에서는 크기 정보 없음
                            displayName: parsedDate.toLocaleString('ko-KR')
                        };
                    })
                    .sort((a, b) => b.date - a.date); // 최신순 정렬
                
                return res.json({
                    success: true,
                    savedSelections: savedSelections
                });
            } catch (mongoError) {
                console.error('MongoDB 저장소 목록 조회 실패, 파일 시스템으로 폴백:', mongoError);
            }
        }
        
        // 파일 시스템 사용
        const fs = require('fs');
        const dataDir = path.join(__dirname, 'data');
        
        if (!fs.existsSync(dataDir)) {
            return res.json({
                success: true,
                savedSelections: []
            });
        }
        
        const savedFiles = fs.readdirSync(dataDir)
            .filter(file => file.startsWith('saved-selection-'))
            .map(file => {
                const filePath = path.join(dataDir, file);
                const stats = fs.statSync(filePath);
                const timestamp = file.replace('saved-selection-', '').replace('.json', '');
                
                return {
                    filename: file,
                    timestamp: timestamp,
                    date: stats.mtime,
                    size: stats.size,
                    displayName: new Date(stats.mtime).toLocaleString('ko-KR')
                };
            })
            .sort((a, b) => b.date - a.date); // 최신순 정렬
        
        res.json({
            success: true,
            savedSelections: savedFiles
        });
    } catch (error) {
        console.error('저장소 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '저장소 목록을 불러올 수 없습니다.'
        });
    }
});

// 선택된 입찰공고 저장 (날짜/시간 자동 생성)
app.post('/api/save-selection', async (req, res) => {
    try {
        const requestData = req.body;
        let selectedBids, checkOrder;
        
        // 새로운 구조 처리
        if (requestData.selectedBids && requestData.checkOrder) {
            selectedBids = requestData.selectedBids;
            checkOrder = requestData.checkOrder;
        } else if (requestData.selectedBids) {
            // 기존 구조 (하위 호환성)
            selectedBids = requestData.selectedBids;
            checkOrder = Object.keys(selectedBids);
        } else {
            // 매우 오래된 구조
            selectedBids = requestData;
            checkOrder = Object.keys(selectedBids);
        }
        
        if (!selectedBids || Object.keys(selectedBids).length === 0) {
            return res.status(400).json({
                success: false,
                message: '저장할 선택된 입찰공고가 없습니다.'
            });
        }
        
        // 한국 시간 기준으로 고유한 타임스탬프 생성
        const now = new Date();
        
        // 한국 시간 (Asia/Seoul) 기준으로 Date 생성
        const koreaTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Seoul"}));
        const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        
        // 한국 시간을 수동으로 ISO 형식으로 포맷팅
        const year = koreaTime.getFullYear();
        const month = String(koreaTime.getMonth() + 1).padStart(2, '0');
        const day = String(koreaTime.getDate()).padStart(2, '0');
        const hour = String(koreaTime.getHours()).padStart(2, '0');
        const minute = String(koreaTime.getMinutes()).padStart(2, '0');
        const second = String(koreaTime.getSeconds()).padStart(2, '0');
        const millisecond = String(koreaTime.getMilliseconds()).padStart(3, '0');
        
        const timestamp = `${year}-${month}-${day}T${hour}-${minute}-${second}-${millisecond}Z-${randomSuffix}`;
        const filename = `saved-selection-${timestamp}.json`;
        
        console.log(`서버 현재 시간: ${now.toISOString()}`);
        console.log(`한국 현재 시간: ${now.toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})}`);
        console.log(`생성된 타임스탬프: ${timestamp}`);
        
        console.log(`저장 시작: ${filename}, 항목 수: ${Object.keys(selectedBids).length}`);
        
        const dataToSave = {
            selectedBids: selectedBids,
            checkOrder: checkOrder
        };
        
        await saveData(filename, dataToSave);
        
        const itemCount = Object.keys(selectedBids).length;
        
        res.json({
            success: true,
            message: `선택된 입찰공고가 저장되었습니다. (${itemCount}개 항목)`,
            filename: filename,
            timestamp: timestamp,
            displayName: now.toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}),
            savedCount: itemCount
        });
        
        console.log(`선택 저장 완료: ${filename} → ${itemCount}개 항목`);
        
    } catch (error) {
        console.error('선택 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '선택 저장 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 저장된 선택 불러오기
app.post('/api/load-selection/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        console.log(`선택 불러오기 시도: ${filename}`);
        
        // MongoDB 환경에서는 .json 제거하여 컬렉션명으로 변환
        const collectionName = filename.replace('.json', '');
        const savedData = await loadData(filename);
        
        if (!savedData) {
            console.log(`저장된 데이터를 찾을 수 없습니다: ${filename} (컬렉션: ${collectionName})`);
            return res.status(404).json({
                success: false,
                message: '저장된 파일을 찾을 수 없습니다.'
            });
        }
        
        console.log(`불러온 데이터:`, savedData);
        
        // 현재 선택에 덮어쓰기
        await saveData('selected-bids.json', savedData);
        
        const itemCount = savedData && typeof savedData === 'object' ? Object.keys(savedData).length : 0;
        
        res.json({
            success: true,
            message: `저장된 선택이 불러와졌습니다. (${itemCount}개 항목)`,
            selectedBids: savedData,
            loadedCount: itemCount
        });
        
        console.log(`선택 불러오기 완료: ${filename} → ${itemCount}개 항목`);
        
    } catch (error) {
        console.error('선택 불러오기 오류:', error);
        res.status(500).json({
            success: false,
            message: '선택 불러오기 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 저장된 선택 삭제
app.delete('/api/saved-selections/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        console.log(`선택 삭제 시도: ${filename}`);
        
        // MongoDB 환경인 경우
        if (process.env.MONGODB_URI) {
            try {
                const database = require('./modules/database');
                const db = await database.connect();
                const collectionName = filename.replace('.json', '');
                
                // 컬렉션 존재 여부 확인 (백업이 아닌 실제 컬렉션만)
                const collections = await db.listCollections({ name: collectionName }).toArray();
                if (collections.length === 0 || collectionName.endsWith('_backup')) {
                    return res.status(404).json({
                        success: false,
                        message: '저장된 파일을 찾을 수 없습니다.'
                    });
                }
                
                // 컬렉션 삭제
                await db.collection(collectionName).drop();
                
                console.log(`MongoDB 컬렉션 삭제 완료: ${collectionName}`);
                return res.json({
                    success: true,
                    message: '저장된 선택이 삭제되었습니다.'
                });
                
            } catch (mongoError) {
                console.error('MongoDB 삭제 실패, 파일 시스템으로 폴백:', mongoError);
            }
        }
        
        // 파일 시스템 사용
        const fs = require('fs');
        const dataDir = path.join(__dirname, 'data');
        const filePath = path.join(dataDir, filename);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: '저장된 파일을 찾을 수 없습니다.'
            });
        }
        
        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            message: '저장된 선택이 삭제되었습니다.'
        });
        
        console.log(`파일 시스템 삭제 완료: ${filename}`);
        
    } catch (error) {
        console.error('저장된 선택 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '삭제 중 오류가 발생했습니다.',
            error: error.message
        });
    }
});

// 서버 시작
app.listen(PORT, async () => {
    console.log(`🚀 K-apt 입찰공고 관리 시스템이 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log('📊 시스템 기능:');
    console.log('   - 수동 업데이트');
    console.log('   - Excel 내보내기');
    console.log('   - PDF 월력 내보내기');
    console.log('   - 실시간 필터링 및 검색');
    
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