/**
 * 스케줄러 및 알림 모듈
 * - 자동 업데이트 스케줄 관리
 * - 데스크톱 알림 기능
 * - 시스템 상태 모니터링
 */

/**
 * 간단한 콘솔 알림 (실제 환경에서는 desktop notification 라이브러리 사용 가능)
 * @param {string} message - 알림 메시지
 * @param {string} type - 알림 타입 (info, success, warning, error)
 */
function sendNotification(message, type = 'info') {
    const timestamp = new Date().toLocaleString('ko-KR');
    const typeIcon = {
        info: 'ℹ️',
        success: '✅',
        warning: '⚠️',
        error: '❌'
    };
    
    const icon = typeIcon[type] || typeIcon.info;
    
    console.log(`\n${icon} [${timestamp}] 알림: ${message}\n`);
    
    // 실제 운영 환경에서는 아래와 같은 방식으로 데스크톱 알림 구현 가능
    // const notifier = require('node-notifier');
    // notifier.notify({
    //     title: 'K-apt 입찰공고 관리 시스템',
    //     message: message,
    //     icon: path.join(__dirname, 'icon.png'),
    //     sound: true,
    //     wait: true
    // });
}

/**
 * 시스템 상태 정보 반환
 * @returns {Object} 시스템 상태
 */
function getSystemStatus() {
    const uptime = process.uptime();
    const memory = process.memoryUsage();
    
    return {
        uptime: {
            seconds: Math.floor(uptime),
            formatted: formatUptime(uptime)
        },
        memory: {
            used: Math.round(memory.heapUsed / 1024 / 1024),
            total: Math.round(memory.heapTotal / 1024 / 1024),
            external: Math.round(memory.external / 1024 / 1024),
            rss: Math.round(memory.rss / 1024 / 1024)
        },
        nodejs: process.version,
        platform: process.platform,
        pid: process.pid
    };
}

/**
 * 업타임을 읽기 쉬운 형태로 포맷
 * @param {number} uptime - 초 단위 업타임
 * @returns {string} 포맷된 업타임
 */
function formatUptime(uptime) {
    const days = Math.floor(uptime / (24 * 60 * 60));
    const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((uptime % (60 * 60)) / 60);
    const seconds = Math.floor(uptime % 60);
    
    if (days > 0) {
        return `${days}일 ${hours}시간 ${minutes}분`;
    } else if (hours > 0) {
        return `${hours}시간 ${minutes}분`;
    } else if (minutes > 0) {
        return `${minutes}분 ${seconds}초`;
    } else {
        return `${seconds}초`;
    }
}

/**
 * 스케줄 업데이트 함수들 (서버에서 사용)
 */
const scheduleUpdates = {
    /**
     * 다음 스케줄된 업데이트 시간 계산
     * @returns {Date} 다음 업데이트 시간
     */
    getNextUpdateTime() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // 오늘의 09:00, 17:00
        const morning = new Date(today.getTime() + 9 * 60 * 60 * 1000);
        const evening = new Date(today.getTime() + 17 * 60 * 60 * 1000);
        
        if (now < morning) {
            return morning;
        } else if (now < evening) {
            return evening;
        } else {
            // 내일 09:00
            const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
            return new Date(tomorrow.getTime() + 9 * 60 * 60 * 1000);
        }
    },
    
    /**
     * 다음 업데이트까지 남은 시간 계산
     * @returns {Object} 남은 시간 정보
     */
    getTimeUntilNextUpdate() {
        const nextUpdate = this.getNextUpdateTime();
        const now = new Date();
        const diffMs = nextUpdate.getTime() - now.getTime();
        
        if (diffMs <= 0) {
            return { hours: 0, minutes: 0, seconds: 0, total: 0 };
        }
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
        
        return {
            hours,
            minutes,
            seconds,
            total: diffMs,
            formatted: `${hours}시간 ${minutes}분 ${seconds}초`
        };
    },
    
    /**
     * 스케줄 정보 반환
     * @returns {Object} 스케줄 정보
     */
    getScheduleInfo() {
        return {
            times: ['09:00', '17:00'],
            timezone: 'KST',
            nextUpdate: this.getNextUpdateTime(),
            timeUntilNext: this.getTimeUntilNextUpdate()
        };
    }
};

/**
 * 이벤트 로거
 */
const eventLogger = {
    /**
     * 업데이트 시작 로그
     * @param {string} type - 업데이트 타입 (manual, scheduled)
     */
    logUpdateStart(type) {
        console.log(`\n🔄 [${new Date().toLocaleString('ko-KR')}] ${type === 'manual' ? '수동' : '자동'} 업데이트 시작`);
    },
    
    /**
     * 업데이트 완료 로그
     * @param {string} type - 업데이트 타입
     * @param {Object} result - 업데이트 결과
     */
    logUpdateComplete(type, result) {
        const typeText = type === 'manual' ? '수동' : '자동';
        console.log(`✅ [${new Date().toLocaleString('ko-KR')}] ${typeText} 업데이트 완료`);
        console.log(`   - 총 공고: ${result.totalBids}개`);
        console.log(`   - 신규 공고: ${result.newBids}개`);
        
        if (result.newBids > 0) {
            sendNotification(`새로운 입찰공고 ${result.newBids}건이 등록되었습니다.`, 'success');
        }
    },
    
    /**
     * 업데이트 실패 로그
     * @param {string} type - 업데이트 타입
     * @param {Error} error - 오류 객체
     */
    logUpdateError(type, error) {
        const typeText = type === 'manual' ? '수동' : '자동';
        console.error(`❌ [${new Date().toLocaleString('ko-KR')}] ${typeText} 업데이트 실패`);
        console.error(`   오류: ${error.message}`);
        
        sendNotification(`${typeText} 업데이트 중 오류가 발생했습니다: ${error.message}`, 'error');
    },
    
    /**
     * 시스템 시작 로그
     */
    logSystemStart() {
        console.log(`\n🚀 [${new Date().toLocaleString('ko-KR')}] K-apt 입찰공고 관리 시스템 시작`);
        
        const schedule = scheduleUpdates.getScheduleInfo();
        console.log(`📅 자동 업데이트: 매일 ${schedule.times.join(', ')}`);
        console.log(`⏰ 다음 업데이트: ${schedule.nextUpdate.toLocaleString('ko-KR')}`);
        console.log(`⏳ 남은 시간: ${schedule.timeUntilNext.formatted}`);
    },
    
    /**
     * 데이터 수집 로그
     * @param {string} category - 카테고리명
     * @param {number} count - 수집된 데이터 개수
     */
    logDataCollection(category, count) {
        console.log(`📊 [${category}] ${count}개 데이터 수집`);
    },
    
    /**
     * 서버 종료 로그
     */
    logSystemShutdown() {
        console.log(`\n🛑 [${new Date().toLocaleString('ko-KR')}] 시스템이 종료됩니다...`);
        sendNotification('K-apt 입찰공고 관리 시스템이 종료됩니다.', 'warning');
    }
};

/**
 * 헬스 체크 도구
 */
const healthCheck = {
    /**
     * 시스템 상태 체크
     * @returns {Object} 상태 정보
     */
    checkHealth() {
        const systemStatus = getSystemStatus();
        const schedule = scheduleUpdates.getScheduleInfo();
        
        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            system: systemStatus,
            schedule: schedule,
            checks: {
                memory: systemStatus.memory.used < 500, // 500MB 미만
                uptime: systemStatus.uptime.seconds > 0
            }
        };
    },
    
    /**
     * 메모리 사용량 체크
     * @returns {boolean} 정상 여부
     */
    checkMemory() {
        const memory = process.memoryUsage();
        const usedMB = memory.heapUsed / 1024 / 1024;
        
        if (usedMB > 1000) { // 1GB 초과 시 경고
            sendNotification(`메모리 사용량이 높습니다: ${Math.round(usedMB)}MB`, 'warning');
            return false;
        }
        
        return true;
    }
};

module.exports = {
    sendNotification,
    getSystemStatus,
    scheduleUpdates,
    eventLogger,
    healthCheck,
    formatUptime
}; 