const fs = require('fs').promises;
const path = require('path');

// MongoDB 모듈 추가
const database = require('./database');

// 데이터 디렉토리 경로
const DATA_DIR = path.join(__dirname, '../data');

/**
 * 데이터 디렉토리가 존재하는지 확인하고 없으면 생성
 */
async function ensureDataDir() {
    try {
        await fs.access(DATA_DIR);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.mkdir(DATA_DIR, { recursive: true });
            console.log('데이터 디렉토리가 생성되었습니다:', DATA_DIR);
        } else {
            throw error;
        }
    }
}

/**
 * JSON 데이터를 파일에 저장
 * @param {string} filename - 저장할 파일명
 * @param {any} data - 저장할 데이터
 * @param {boolean} createBackup - 백업 생성 여부 (기본값: true)
 */
async function saveData(filename, data, createBackup = true) {
    console.log(`📝 저장 시작: ${filename}, 데이터 타입: ${typeof data}`);
    console.log(`MongoDB URI 존재: ${!!process.env.MONGODB_URI}`);
    
    // MongoDB 우선 시도
    if (process.env.MONGODB_URI) {
        try {
            const collection = filename.replace('.json', '');
            console.log(`MongoDB 컬렉션명: ${collection}`);
            await database.saveData(collection, data);
            console.log(`✅ MongoDB에 저장 성공: ${filename}`);
            return true;
        } catch (error) {
            console.error(`❌ MongoDB 저장 실패, 파일 시스템으로 폴백:`);
            console.error(`에러 이름: ${error.name}`);
            console.error(`에러 메시지: ${error.message}`);
            console.error(`에러 스택: ${error.stack}`);
            // MongoDB 실패 시 파일 시스템으로 계속 진행
        }
    } else {
        console.log(`MongoDB URI가 설정되지 않아 파일 시스템 사용`);
    }
    
    // 파일 시스템 사용 (MongoDB 없거나 실패 시)
    try {
        await ensureDataDir();
        
        const filepath = path.join(DATA_DIR, filename);
        
        // 기존 파일이 있고 백업이 필요한 경우
        if (createBackup && await fileExists(filepath)) {
            await createBackupFile(filepath);
        }
        
        // 데이터를 JSON 형태로 저장
        const jsonData = JSON.stringify(data, null, 2);
        await fs.writeFile(filepath, jsonData, 'utf8');
        
        console.log(`✅ 파일 시스템에 저장 성공: ${filename} (${jsonData.length} bytes)`);
        
        return true;
    } catch (error) {
        console.error(`❌ 파일 저장 최종 실패 (${filename}):`, error);
        throw new Error(`파일 저장 실패: ${error.message}`);
    }
}

/**
 * JSON 파일에서 데이터를 로드
 * @param {string} filename - 로드할 파일명
 * @returns {any} 파싱된 JSON 데이터 또는 null (파일이 없는 경우)
 */
async function loadData(filename) {
    console.log(`📖 로드 시작: ${filename}`);
    console.log(`MongoDB URI 존재: ${!!process.env.MONGODB_URI}`);
    
    // MongoDB 우선 시도
    if (process.env.MONGODB_URI) {
        try {
            const collection = filename.replace('.json', '');
            console.log(`MongoDB 컬렉션명: ${collection}`);
            const data = await database.loadData(collection);
            console.log(`✅ MongoDB에서 로드 성공: ${filename}, 데이터: ${data ? '있음' : '없음'}`);
            return data;
        } catch (error) {
            console.error(`❌ MongoDB 로드 실패, 파일 시스템으로 폴백:`);
            console.error(`에러 이름: ${error.name}`);
            console.error(`에러 메시지: ${error.message}`);
            console.error(`에러 스택: ${error.stack}`);
            // MongoDB 실패 시 파일 시스템으로 계속 진행
        }
    } else {
        console.log(`MongoDB URI가 설정되지 않아 파일 시스템 사용`);
    }
    
    // 파일 시스템 사용 (MongoDB 없거나 실패 시)
    try {
        const filepath = path.join(DATA_DIR, filename);
        
        // 파일 존재 여부 확인
        if (!await fileExists(filepath)) {
            console.log(`📁 파일이 존재하지 않습니다: ${filename}`);
            return null;
        }
        
        // 파일 읽기 및 JSON 파싱
        const fileContent = await fs.readFile(filepath, 'utf8');
        const data = JSON.parse(fileContent);
        
        console.log(`✅ 파일 시스템에서 로드 성공: ${filename} (${fileContent.length} bytes)`);
        
        return data;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`📁 파일이 존재하지 않습니다: ${filename}`);
            return null;
        }
        
        console.error(`❌ 파일 로드 최종 실패 (${filename}):`, error);
        throw new Error(`파일 로드 실패: ${error.message}`);
    }
}

/**
 * 파일 존재 여부 확인
 * @param {string} filepath - 확인할 파일 경로
 * @returns {boolean} 파일 존재 여부
 */
async function fileExists(filepath) {
    try {
        await fs.access(filepath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 백업 파일 생성
 * @param {string} originalPath - 원본 파일 경로
 */
async function createBackupFile(originalPath) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = path.extname(originalPath);
        const basename = path.basename(originalPath, ext);
        const dirname = path.dirname(originalPath);
        
        const backupPath = path.join(dirname, `${basename}.backup.${timestamp}${ext}`);
        
        await fs.copyFile(originalPath, backupPath);
        console.log(`백업 파일이 생성되었습니다: ${path.basename(backupPath)}`);
        
        // 오래된 백업 파일 정리 (최근 5개만 유지)
        await cleanupOldBackups(dirname, basename, ext);
        
    } catch (error) {
        console.warn('백업 파일 생성 실패:', error.message);
    }
}

/**
 * 오래된 백업 파일 정리
 * @param {string} dirname - 디렉토리 경로
 * @param {string} basename - 기본 파일명
 * @param {string} ext - 파일 확장자
 */
async function cleanupOldBackups(dirname, basename, ext) {
    try {
        const files = await fs.readdir(dirname);
        const backupPattern = new RegExp(`^${basename}\\.backup\\..+${ext}$`);
        
        const backupFiles = files
            .filter(file => backupPattern.test(file))
            .map(file => ({
                name: file,
                path: path.join(dirname, file),
                stats: null
            }));
        
        // 파일 생성 시간 정보 가져오기
        for (const file of backupFiles) {
            try {
                file.stats = await fs.stat(file.path);
            } catch (error) {
                console.warn(`백업 파일 정보 읽기 실패: ${file.name}`);
            }
        }
        
        // 생성 시간 기준으로 정렬 (최신순)
        backupFiles
            .filter(file => file.stats)
            .sort((a, b) => b.stats.mtime - a.stats.mtime)
            .slice(5) // 최근 5개를 제외한 나머지
            .forEach(async (file) => {
                try {
                    await fs.unlink(file.path);
                    console.log(`오래된 백업 파일 삭제: ${file.name}`);
                } catch (error) {
                    console.warn(`백업 파일 삭제 실패: ${file.name}`);
                }
            });
            
    } catch (error) {
        console.warn('백업 파일 정리 실패:', error.message);
    }
}

/**
 * 로그 데이터 추가 (기존 로그에 append)
 * @param {string} filename - 로그 파일명
 * @param {any} logEntry - 추가할 로그 엔트리
 */
async function appendLog(filename, logEntry) {
    try {
        const existingLogs = await loadData(filename) || [];
        
        // 배열이 아닌 경우 새로운 배열로 초기화
        const logs = Array.isArray(existingLogs) ? existingLogs : [];
        
        // 새 로그 엔트리 추가
        logs.push({
            ...logEntry,
            timestamp: logEntry.timestamp || new Date().toISOString()
        });
        
        // 로그 개수 제한 (최근 1000개만 유지)
        if (logs.length > 1000) {
            logs.splice(0, logs.length - 1000);
        }
        
        await saveData(filename, logs, false); // 로그는 백업 생성하지 않음
        
    } catch (error) {
        console.error('로그 추가 실패:', error);
    }
}

/**
 * 데이터 파일 목록 조회
 * @returns {Array} 데이터 파일 목록
 */
async function listDataFiles() {
    try {
        await ensureDataDir();
        const files = await fs.readdir(DATA_DIR);
        
        const dataFiles = [];
        for (const file of files) {
            if (file.endsWith('.json') && !file.includes('.backup.')) {
                const filepath = path.join(DATA_DIR, file);
                const stats = await fs.stat(filepath);
                
                dataFiles.push({
                    name: file,
                    size: stats.size,
                    modified: stats.mtime,
                    created: stats.birthtime
                });
            }
        }
        
        return dataFiles.sort((a, b) => b.modified - a.modified);
        
    } catch (error) {
        console.error('데이터 파일 목록 조회 실패:', error);
        return [];
    }
}

/**
 * 데이터 파일 삭제
 * @param {string} filename - 삭제할 파일명
 */
async function deleteData(filename) {
    try {
        const filepath = path.join(DATA_DIR, filename);
        
        if (await fileExists(filepath)) {
            await fs.unlink(filepath);
            console.log(`데이터 파일이 삭제되었습니다: ${filename}`);
            return true;
        } else {
            console.log(`삭제할 파일이 존재하지 않습니다: ${filename}`);
            return false;
        }
        
    } catch (error) {
        console.error(`데이터 파일 삭제 실패 (${filename}):`, error);
        throw new Error(`파일 삭제 실패: ${error.message}`);
    }
}

/**
 * 데이터 디렉토리 정보 조회
 * @returns {Object} 디렉토리 정보
 */
async function getDataDirInfo() {
    try {
        await ensureDataDir();
        const files = await listDataFiles();
        
        let totalSize = 0;
        let totalFiles = files.length;
        
        files.forEach(file => {
            totalSize += file.size;
        });
        
        return {
            path: DATA_DIR,
            totalFiles,
            totalSize,
            files
        };
        
    } catch (error) {
        console.error('데이터 디렉토리 정보 조회 실패:', error);
        return {
            path: DATA_DIR,
            totalFiles: 0,
            totalSize: 0,
            files: [],
            error: error.message
        };
    }
}

module.exports = {
    saveData,
    loadData,
    appendLog,
    listDataFiles,
    deleteData,
    fileExists,
    getDataDirInfo,
    ensureDataDir
}; 