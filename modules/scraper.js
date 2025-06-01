const axios = require('axios');
const cheerio = require('cheerio');

// K-apt 입찰공고 URL
const KAPT_BASE_URL = 'https://www.k-apt.go.kr/bid/bidList.do';

// 지역 코드 매핑 (서울, 인천, 경기, 강원, 충북, 충남)
const REGION_CODES = {
    '11': '서울',
    '28': '인천',
    '41': '경기', 
    '42': '강원',
    '43': '충북',
    '44': '충남'
};

// K-apt 사이트의 실제 카테고리 코드 매핑
const CATEGORY_CODES = {
    '02': '사업자',
    '03': '용역', 
    '04': '경비'
};

/**
 * 현재 날짜를 기준으로 1개월 범위의 날짜를 계산
 */
function getDateRange() {
    const now = new Date();
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setMonth(now.getMonth() - 1);
    
    const formatDate = (date) => {
        return date.toISOString().split('T')[0];
    };
    
    return {
        startDate: formatDate(oneMonthAgo),
        endDate: formatDate(now)
    };
}

/**
 * K-apt 사이트에서 입찰공고 데이터를 수집
 */
async function scrapeBids() {
    try {
        console.log('K-apt 입찰공고 데이터 수집을 시작합니다...');
        
        const { startDate, endDate } = getDateRange();
        const regionCodes = Object.keys(REGION_CODES).join('|');
        
        console.log(`수집 기간: ${startDate} ~ ${endDate}`);
        console.log(`대상 지역: ${Object.values(REGION_CODES).join(', ')}`);
        console.log(`대상 카테고리: ${Object.values(CATEGORY_CODES).join(', ')}`);
        
        let allBids = [];
        let currentPage = 1;
        let hasMorePages = true;
        const maxPages = 10; // 최대 10페이지까지 수집 (안전장치)
        
        while (hasMorePages && currentPage <= maxPages) {
            console.log(`📄 ${currentPage}페이지 데이터 수집 중...`);
            
            // 모든 카테고리를 한 번에 요청 (사용자 제안 방식)
            const params = {
                searchBidGb: 'bid_gb_1',        // 입찰공고 구분
                bidTitle: '',                    // 공고명 (빈값 = 전체)
                aptName: '',                     // 단지명 (빈값 = 전체)
                searchDateGb: 'reg',            // 날짜 구분 (등록일 기준)
                dateStart: startDate,            // 시작일
                dateEnd: endDate,               // 종료일
                dateArea: '1',                  // 기간 범위
                bidState: '',                   // 입찰 상태 (빈값 = 전체)
                codeAuth: '',                   // 인증 코드
                codeWay: '',                    // 방식 코드
                codeAuthSub: '',                // 보조 인증 코드
                codeSucWay: '',                 // 낙찰 방식
                codeClassifyType1: '02',        // 사업자
                codeClassifyType2: '03',        // 용역
                codeClassifyType3: '04',        // 경비
                pageNo: currentPage.toString(), // 현재 페이지
                type: '4',                      // 타입
                bidArea: regionCodes,           // 지역 코드 (11|28|41|42|43|44)
                bidNum: '',                     // 입찰 번호
                bidNo: '',                      // 입찰 번호
                dTime: Date.now(),              // 타임스탬프 (캐시 방지)
                mainKaptCode: '',               // 메인 코드
                aptCode: ''                     // 아파트 코드
            };
            
            try {
                const response = await axios.get(KAPT_BASE_URL, {
                    params,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'DNT': '1',
                        'Connection': 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Referer': 'https://www.k-apt.go.kr/'
                    },
                    timeout: 30000 // 30초 타임아웃
                });
                
                if (response.status !== 200) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const { bids: pageBids, hasNext, totalPages } = parseHtmlToBidsWithPagination(response.data, currentPage);
                
                if (pageBids.length === 0) {
                    console.log(`   ⚠️ ${currentPage}페이지: 데이터 없음`);
                    hasMorePages = false;
                } else {
                    allBids.push(...pageBids);
                    console.log(`   ✅ ${currentPage}페이지: ${pageBids.length}개 수집`);
                    
                    // 다음 페이지 존재 여부 확인
                    hasMorePages = hasNext && currentPage < totalPages;
                    
                    if (hasMorePages) {
                        currentPage++;
                        // 페이지 요청 간 딜레이 (서버 부하 방지)
                        await delay(1000);
                    }
                }
                
            } catch (error) {
                console.error(`   ❌ ${currentPage}페이지 수집 실패:`, error.message);
                hasMorePages = false;
            }
        }
        
        console.log(`📊 전체 수집 완료: ${currentPage - 1}페이지, 총 ${allBids.length}개 (중복 포함)`);
        
        // 중복 제거 (ID 기준)
        const uniqueBids = removeDuplicates(allBids);
        
        // 날짜 기준 정렬 (최신순)
        uniqueBids.sort((a, b) => new Date(b.postDate) - new Date(a.postDate));
        
        // 카테고리별 통계 출력
        const categoryStats = {};
        const regionStats = {};
        uniqueBids.forEach(bid => {
            categoryStats[bid.category] = (categoryStats[bid.category] || 0) + 1;
            regionStats[bid.region] = (regionStats[bid.region] || 0) + 1;
        });
        
        console.log('\n📊 수집 결과 통계:');
        console.log('카테고리별:');
        Object.entries(categoryStats).forEach(([category, count]) => {
            console.log(`   ${category}: ${count}개`);
        });
        console.log('지역별:');
        Object.entries(regionStats).forEach(([region, count]) => {
            console.log(`   ${region}: ${count}개`);
        });
        
        console.log(`\n✅ 최종 결과: 총 ${uniqueBids.length}개 (중복 제거 후)`);
        
        return uniqueBids;
        
    } catch (error) {
        console.error('데이터 수집 중 오류 발생:', error);
        throw new Error(`K-apt 데이터 수집 실패: ${error.message}`);
    }
}

/**
 * HTML을 파싱하여 입찰공고 데이터 추출 (페이지네이션 정보 포함)
 */
function parseHtmlToBidsWithPagination(html, currentPage) {
    const $ = cheerio.load(html);
    const bids = [];
    
    // 입찰목록 테이블 찾기
    const table = $('table').filter((i, el) => {
        const tableText = $(el).text();
        return tableText.includes('순번') && tableText.includes('공고명');
    });
    
    if (table.length === 0) {
        console.warn(`⚠️ ${currentPage}페이지: 입찰공고 테이블을 찾을 수 없습니다.`);
        return { bids: [], hasNext: false, totalPages: 1 };
    }
    
    // 테이블에서 데이터 추출
    table.find('tr').each((index, element) => {
        if (index === 0) return; // 헤더 행 스킵
        
        const columns = $(element).find('td');
        if (columns.length < 7) return; // 최소 컬럼 수 확인
        
        try {
            const id = $(columns[0]).text().trim();
            const type = $(columns[1]).text().trim();
            const method = $(columns[2]).text().trim();
            const title = $(columns[3]).text().trim();
            const deadline = $(columns[4]).text().trim();
            const status = $(columns[5]).text().trim();
            const aptName = $(columns[6]).text().trim();
            const postDate = $(columns[7]).text().trim();
            
            // 공고명 링크 추출 (K-apt 상세 페이지 링크)
            const titleCell = $(columns[3]);
            const titleLink = titleCell.find('a');
            let detailLink = '';
            
            if (titleLink.length > 0) {
                const href = titleLink.attr('href');
                if (href) {
                    // 상대 경로를 절대 경로로 변환
                    if (href.startsWith('/')) {
                        detailLink = 'https://www.k-apt.go.kr' + href;
                    } else if (href.startsWith('http')) {
                        detailLink = href;
                    } else {
                        detailLink = 'https://www.k-apt.go.kr/bid/' + href;
                    }
                }
            }
            
            // 기본 검증 - 빈 데이터나 "데이터가 없습니다" 등의 메시지 제외
            if (!id || !title || !aptName || 
                title.includes('데이터가 없습니다') || 
                title.includes('검색된') ||
                title.includes('없습니다') ||
                id === '순번' || id === '' ||
                isNaN(parseInt(id))) {
                return;
            }
            
            // 지역 정보 추출
            const region = extractRegion(title);
            
            // 카테고리 분류 (제목에서 키워드 추출)
            const category = classifyCategory(title);
            
            const bid = {
                id: cleanText(id),
                type: cleanText(type),
                method: cleanText(method),
                title: cleanText(title),
                deadline: formatDateTime(deadline),
                status: cleanText(status),
                aptName: cleanText(aptName),
                postDate: formatDateTime(postDate),
                region: region,
                category: category,
                detailLink: detailLink, // K-apt 상세 페이지 링크 추가
                scrapedAt: new Date().toISOString()
            };
            
            bids.push(bid);
            
        } catch (error) {
            console.warn(`⚠️ ${currentPage}페이지 행 파싱 오류 (index: ${index}):`, error.message);
        }
    });
    
    // 간단한 페이지네이션 로직: 10개 행이 있으면 다음 페이지가 있을 가능성
    const hasNext = bids.length === 10; // K-apt는 보통 페이지당 10개씩 표시
    const totalPages = hasNext ? currentPage + 1 : currentPage; // 실제 총 페이지는 알 수 없으므로 현재+1로 설정
    
    return {
        bids: bids,
        hasNext: hasNext,
        totalPages: totalPages
    };
}

/**
 * 페이지네이션 정보 추출 (더 이상 사용하지 않음 - 간단한 로직으로 대체)
 */
function extractPaginationInfo($) {
    // 이 함수는 더 이상 사용되지 않지만 호환성을 위해 유지
    return { hasNext: false, totalPages: 1 };
}

/**
 * 제목에서 카테고리 분류
 */
function classifyCategory(title) {
    const lowerTitle = title.toLowerCase();
    
    // 경비 관련 키워드 확인
    if (lowerTitle.includes('경비') || lowerTitle.includes('보안') || lowerTitle.includes('경비용역')) {
        return '경비';
    }
    
    // 용역 관련 키워드 확인
    if (lowerTitle.includes('용역') || lowerTitle.includes('서비스') || lowerTitle.includes('청소') || 
        lowerTitle.includes('관리') || lowerTitle.includes('시설') || lowerTitle.includes('유지보수')) {
        return '용역';
    }
    
    // 사업자 관련 키워드 확인
    if (lowerTitle.includes('사업자') || lowerTitle.includes('업체') || lowerTitle.includes('선정') ||
        lowerTitle.includes('공사') || lowerTitle.includes('시공') || lowerTitle.includes('건설')) {
        return '사업자';
    }
    
    // 기본값
    return '기타';
}

/**
 * 제목에서 지역 정보 추출
 */
function extractRegion(title) {
    const regionMatch = title.match(/^\[(.*?)\]/);
    if (regionMatch) {
        const extractedRegion = regionMatch[1];
        
        // 지역명 정규화
        if (extractedRegion.includes('서울')) return '서울';
        if (extractedRegion.includes('인천')) return '인천';
        if (extractedRegion.includes('경기')) return '경기';
        if (extractedRegion.includes('강원')) return '강원';
        if (extractedRegion.includes('충북') || extractedRegion.includes('충청북도')) return '충북';
        if (extractedRegion.includes('충남') || extractedRegion.includes('충청남도')) return '충남';
        
        return extractedRegion;
    }
    return '기타';
}

/**
 * 텍스트 정리 (불필요한 공백, 특수문자 제거)
 */
function cleanText(text) {
    if (!text) return '';
    
    return text
        .replace(/\s+/g, ' ')           // 연속된 공백을 하나로
        .replace(/^\s+|\s+$/g, '')      // 앞뒤 공백 제거
        .replace(/\n|\r/g, '')          // 줄바꿈 제거
        .trim();
}

/**
 * 날짜/시간 형식 정리
 */
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr || dateTimeStr.trim() === '') {
        return null;
    }
    
    try {
        // "2025-05-30 16:26:45" 형식으로 정리
        const cleaned = dateTimeStr.replace(/\s+/g, ' ').trim();
        const date = new Date(cleaned);
        
        if (isNaN(date.getTime())) {
            return dateTimeStr; // 파싱 실패 시 원본 반환
        }
        
        return date.toISOString().replace('T', ' ').slice(0, 19);
        
    } catch (error) {
        return dateTimeStr; // 오류 시 원본 반환
    }
}

/**
 * 중복 제거 (ID 기준)
 */
function removeDuplicates(bids) {
    const seen = new Set();
    return bids.filter(bid => {
        if (seen.has(bid.id)) {
            return false;
        }
        seen.add(bid.id);
        return true;
    });
}

/**
 * 딜레이 함수
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 테스트용 단일 카테고리 수집
 */
async function scrapeSingleCategory(categoryCode) {
    try {
        const categoryName = CATEGORY_CODES[categoryCode];
        if (!categoryName) {
            throw new Error(`잘못된 카테고리 코드: ${categoryCode}`);
        }
        
        console.log(`🧪 [${categoryName}] 테스트 수집...`);
        
        const { startDate, endDate } = getDateRange();
        const regionCodes = Object.keys(REGION_CODES).join('|');
        
        const params = {
            searchBidGb: 'bid_gb_1',
            bidTitle: '',
            aptName: '',
            searchDateGb: 'reg',
            dateStart: startDate,
            dateEnd: endDate,
            dateArea: '1',
            bidState: '',
            codeAuth: '',
            codeWay: '',
            codeAuthSub: '',
            codeSucWay: '',
            codeClassifyType1: categoryCode, // 단일 카테고리
            codeClassifyType2: '',
            codeClassifyType3: '',
            pageNo: '1',
            type: '4',
            bidArea: regionCodes,
            bidNum: '',
            bidNo: '',
            dTime: Date.now(),
            mainKaptCode: '',
            aptCode: ''
        };
        
        const response = await axios.get(KAPT_BASE_URL, {
            params,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });
        
        const bids = parseHtmlToBids(response.data, categoryName);
        console.log(`   ✅ [${categoryName}] 테스트 결과: ${bids.length}개`);
        
        // 샘플 데이터 출력
        bids.slice(0, 3).forEach(bid => {
            console.log(`      📄 ${bid.title}`);
        });
        
        return bids;
        
    } catch (error) {
        console.error('단일 카테고리 수집 오류:', error);
        throw error;
    }
}

module.exports = {
    scrapeBids,
    scrapeSingleCategory,
    extractRegion,
    REGION_CODES,
    CATEGORY_CODES
}; 