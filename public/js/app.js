// K-apt Bid Tracker - Main Application JavaScript

class BidTracker {
    constructor() {
        this.bids = [];
        this.filteredBids = [];
        this.selectedBids = new Map(); // 선택된 입찰공고 저장 (ID -> 세부정보)
        this.checkOrder = []; // 체크된 순서 추적 (선택한 역순으로 고정)
        this.currentPage = 1;
        this.itemsPerPage = 10;
        
        // 선택된 입찰목록 일자별 페이지네이션
        this.selectedBidsCurrentDate = null; // 현재 선택된 날짜
        this.selectedBidsByDate = new Map(); // 날짜별 입찰공고 그룹
        this.availableDates = []; // 사용 가능한 날짜 목록
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadData();
        await this.loadSelectedBids();
        this.updateStats();
        this.applyFilters();
        this.startKeepAlive(); // Keep-alive 시작
    }

    bindEvents() {
        // Update button
        document.getElementById('updateBtn').addEventListener('click', () => {
            this.updateBids();
        });

        // Export buttons
        document.getElementById('exportExcelBtn').addEventListener('click', () => {
            this.exportToExcel();
        });
        
        document.getElementById('exportPdfBtn').addEventListener('click', () => {
            this.exportToPdf();
        });

        // Search event
        document.getElementById('searchInput').addEventListener('input', () => {
            this.applyFilters();
        });

        // Method filter event
        document.getElementById('methodFilter').addEventListener('change', () => {
            this.applyFilters();
        });

        // Reset selected bids button
        document.getElementById('resetSelectedBidsBtn').addEventListener('click', () => {
            this.resetSelectedBids();
        });

        // 저장 버튼 이벤트
        document.getElementById('saveSelectionBtn').addEventListener('click', () => {
            this.saveCurrentSelection();
        });
    }

    async loadData() {
        try {
            this.showLoading(true);
            const response = await fetch('/api/bids');
            const data = await response.json();
            
            if (data.success) {
                this.bids = data.bids || [];
                this.cleanupSelectedBids(); // 없어진 공고 제거
                this.preserveCheckboxStates(); // 기존 체크 상태 유지
                this.applyFilters();
                this.updateStatistics();
            } else {
                this.showError('데이터를 불러오는데 실패했습니다.');
            }
        } catch (error) {
            console.error('Error loading bids:', error);
            this.showError('데이터를 불러오는 중 오류가 발생했습니다.');
        } finally {
            this.showLoading(false);
        }
    }

    async updateBids() {
        try {
            this.showLoading(true);
            document.getElementById('updateBtn').disabled = true;
            document.getElementById('updateBtn').innerHTML = '<i class="bi bi-arrow-clockwise"></i> 업데이트 중...';

            const response = await fetch('/api/update', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                await this.loadData();
                await this.loadSelectedBids(); // 선택된 입찰공고 다시 로드
                this.updateLastUpdateTime();
                
                // 상세한 업데이트 결과 메시지 표시
                let message = data.message;
                if (data.removedSelectedBids > 0 || data.invalidSelections > 0) {
                    message += '\n\n선택된 입찰공고가 자동으로 정리되었습니다.';
                }
                
                this.showSuccess(message);
            } else {
                this.showError(data.message || '업데이트에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error updating bids:', error);
            this.showError('업데이트 중 오류가 발생했습니다.');
        } finally {
            this.showLoading(false);
            document.getElementById('updateBtn').disabled = false;
            document.getElementById('updateBtn').innerHTML = '<i class="bi bi-arrow-clockwise"></i> 수동 업데이트';
        }
    }

    applyFilters() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const methodFilter = document.getElementById('methodFilter').value;

        this.filteredBids = this.bids.filter(bid => {
            const matchesSearch = !searchTerm || 
                bid.aptName.toLowerCase().includes(searchTerm);
            
            const matchesMethod = !methodFilter || 
                bid.method.includes(methodFilter);

            return matchesSearch && matchesMethod;
        });

        // 항상 공고일 최신순으로 정렬
        this.filteredBids.sort((a, b) => {
            const aDate = new Date(a.postDate);
            const bDate = new Date(b.postDate);
            return bDate - aDate;
        });

        this.currentPage = 1;
        this.renderTable();
        this.renderPagination();
        this.updateFilteredCount();
    }

    sortBids() {
        const [field, direction] = this.currentSort.split('-');
        
        this.filteredBids.sort((a, b) => {
            let aVal, bVal;
            
            switch (field) {
                case 'postDate':
                case 'deadline':
                    aVal = new Date(a[field]);
                    bVal = new Date(b[field]);
                    break;
                case 'title':
                case 'aptName':
                    aVal = a[field].toLowerCase();
                    bVal = b[field].toLowerCase();
                    break;
                default:
                    aVal = a[field];
                    bVal = b[field];
            }

            if (direction === 'desc') {
                return bVal > aVal ? 1 : -1;
            } else {
                return aVal > bVal ? 1 : -1;
            }
        });
    }

    renderTable() {
        const tbody = document.getElementById('bidTableBody');
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageData = this.filteredBids.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center empty-state">
                        <i class="bi bi-inbox"></i>
                        <p>표시할 데이터가 없습니다.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = pageData.map(bid => `
            <tr data-bid-id="${bid.id}" class="fade-in">
                <td>
                    <input type="checkbox" class="form-check-input bid-checkbox" 
                           data-bid-id="${bid.id}" 
                           ${this.selectedBids.has(bid.id) ? 'checked' : ''}>
                </td>
                <td>${this.formatDateOnly(bid.postDate)}</td>
                <td>
                    <span class="badge ${this.getMethodBadgeClass(bid.method)}">${bid.method}</span>
                </td>
                <td>
                    <div class="text-truncate" style="max-width: 350px;" title="${bid.title}">
                        ${this.highlightSearch(bid.title)}
                    </div>
                </td>
                <td>
                    <div class="text-truncate" style="max-width: 200px;" title="${bid.aptName}">
                        ${this.highlightSearch(bid.aptName)}
                    </div>
                </td>
                <td class="${this.getDeadlineClass(bid.deadline)}">
                    ${this.formatDateOnly(bid.deadline)}
                    ${this.getDeadlineBadge(bid.deadline)}
                </td>
                <td>
                    <a href="${this.generateKaptLink(bid)}" target="_blank" class="btn btn-sm btn-outline-primary" title="K-apt 공고문 보기">
                        <i class="bi bi-box-arrow-up-right"></i> 보기
                    </a>
                </td>
            </tr>
        `).join('');

        // 체크박스 이벤트 리스너 추가
        this.bindCheckboxEvents();
    }

    renderPagination() {
        const pagination = document.getElementById('pagination');
        const totalPages = Math.ceil(this.filteredBids.length / this.itemsPerPage);

        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let paginationHTML = '';

        // Previous button
        paginationHTML += `
            <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="bidTracker.goToPage(${this.currentPage - 1})">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        const startPage = Math.max(1, this.currentPage - 2);
        const endPage = Math.min(totalPages, this.currentPage + 2);

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <li class="page-item ${i === this.currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="bidTracker.goToPage(${i})">${i}</a>
                </li>
            `;
        }

        // Next button
        paginationHTML += `
            <li class="page-item ${this.currentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="bidTracker.goToPage(${this.currentPage + 1})">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        pagination.innerHTML = paginationHTML;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredBids.length / this.itemsPerPage);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.renderTable();
            this.renderPagination();
        }
    }

    updateStatistics() {
        const today = new Date();
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + (7 - today.getDay())); // 이번주 일요일
        
        // 오늘 등록
        const todayRegisteredCount = this.bids.filter(bid => {
            const postDate = new Date(bid.postDate);
            return postDate.toDateString() === today.toDateString();
        }).length;
        
        // 오늘 마감
        const todayDeadlineCount = this.bids.filter(bid => {
            const deadline = new Date(bid.deadline);
            return deadline.toDateString() === today.toDateString();
        }).length;
        
        // 이번주 내 마감
        const weekDeadlineCount = this.bids.filter(bid => {
            const deadline = new Date(bid.deadline);
            return deadline >= today && deadline <= endOfWeek;
        }).length;
        
        // 적격심사
        const qualificationCount = this.bids.filter(bid => 
            bid.method.includes('적격심사')
        ).length;
        
        // 최저낙찰
        const lowestBidCount = this.bids.filter(bid => 
            bid.method.toLowerCase().includes('최저') && bid.method.toLowerCase().includes('낙찰')
        ).length;

        document.getElementById('todayRegisteredCount').textContent = todayRegisteredCount;
        document.getElementById('todayDeadlineCount').textContent = todayDeadlineCount;
        document.getElementById('weekDeadlineCount').textContent = weekDeadlineCount;
        document.getElementById('qualificationCount').textContent = qualificationCount;
        document.getElementById('lowestBidCount').textContent = lowestBidCount;
    }

    updateFilteredCount() {
        document.getElementById('filteredCount').textContent = `${this.filteredBids.length}건`;
    }

    updateLastUpdateTime() {
        const now = new Date();
        document.getElementById('lastUpdate').innerHTML = 
            `<i class="bi bi-clock"></i> 마지막 업데이트: ${now.toLocaleString()}`;
    }

    showBidDetails(bidId) {
        const bid = this.bids.find(b => b.id === bidId);
        if (!bid) return;

        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <h6>기본 정보</h6>
                    <table class="table table-sm">
                        <tr><td><strong>공고번호:</strong></td><td>${bid.id}</td></tr>
                        <tr><td><strong>상태:</strong></td><td><span class="badge ${this.getStatusClass(bid.status)}">${bid.status}</span></td></tr>
                        <tr><td><strong>지역:</strong></td><td>${bid.region}</td></tr>
                        <tr><td><strong>분류:</strong></td><td>${bid.category}</td></tr>
                        <tr><td><strong>낙찰방법:</strong></td><td>${bid.method}</td></tr>
                    </table>
                </div>
                <div class="col-md-6">
                    <h6>일정 정보</h6>
                    <table class="table table-sm">
                        <tr><td><strong>등록일:</strong></td><td>${this.formatDate(bid.postDate)}</td></tr>
                        <tr><td><strong>마감일:</strong></td><td class="${this.getDeadlineClass(bid.deadline)}">${this.formatDate(bid.deadline)}</td></tr>
                        <tr><td><strong>남은 시간:</strong></td><td>${this.getRemainingTime(bid.deadline)}</td></tr>
                    </table>
                </div>
            </div>
            <div class="row mt-3">
                <div class="col-12">
                    <h6>공고명</h6>
                    <p class="border p-2 bg-light">${bid.title}</p>
                </div>
            </div>
            <div class="row">
                <div class="col-12">
                    <h6>단지명</h6>
                    <p class="border p-2 bg-light">${bid.aptName}</p>
                </div>
            </div>
        `;

        const modal = new bootstrap.Modal(document.getElementById('detailModal'));
        modal.show();
    }

    async exportToExcel() {
        try {
            const response = await fetch('/api/export', { method: 'POST' });
            const blob = await response.blob();
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `k-apt-bids-${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            
            this.showSuccess('Excel 파일이 다운로드되었습니다.');
        } catch (error) {
            console.error('Export error:', error);
            this.showError('Excel 내보내기 중 오류가 발생했습니다.');
        }
    }

    async exportToPdf() {
        try {
            if (this.selectedBids.size === 0) {
                this.showError('선택된 입찰공고가 없습니다.');
                return;
            }

            // 선택된 입찰공고 데이터 준비
            const selectedBidsArray = Array.from(this.selectedBids.values());
            
            this.showLoading(true, 'HTML 월력을 생성하고 있습니다...');

            const response = await fetch('/api/export-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    selectedBids: selectedBidsArray
                })
            });

            if (!response.ok) {
                throw new Error('HTML 내보내기 실패');
            }

            // HTML 파일 다운로드
            const htmlContent = await response.text();
            const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `k-apt-calendar-${new Date().toISOString().split('T')[0]}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.showSuccess('HTML 월력이 다운로드되었습니다. 파일을 열고 Ctrl+P로 PDF 저장하세요.');

        } catch (error) {
            console.error('HTML export error:', error);
            this.showError('HTML 월력 내보내기 중 오류가 발생했습니다.');
        } finally {
            this.showLoading(false);
        }
    }

    // Utility methods
    getStatusClass(status) {
        switch (status) {
            case '신규공고': return 'badge-new';
            case '진행중': return 'badge-ongoing';
            case '마감임박': return 'badge-deadline';
            case '마감': return 'badge-closed';
            default: return 'bg-secondary';
        }
    }

    getDeadlineClass(deadline) {
        const days = this.getDaysUntilDeadline(deadline);
        if (days <= 1) return 'deadline-urgent';
        if (days <= 3) return 'deadline-warning';
        return 'deadline-normal';
    }

    getDeadlineBadge(deadline) {
        const days = this.getDaysUntilDeadline(deadline);
        if (days < 0) return '<span class="badge bg-secondary ms-1">마감</span>'; // 마감된 경우
        if (days <= 1) return '<span class="badge bg-danger ms-1">긴급</span>';
        if (days <= 3) return '<span class="badge bg-warning ms-1">임박</span>';
        return '';
    }

    getDaysUntilDeadline(deadline) {
        const now = new Date();
        const deadlineDate = new Date(deadline);
        const diffTime = deadlineDate - now;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    isUrgentDeadline(deadline) {
        return this.getDaysUntilDeadline(deadline) <= 3;
    }

    getRemainingTime(deadline) {
        const days = this.getDaysUntilDeadline(deadline);
        if (days < 0) return '마감됨';
        if (days === 0) return '오늘 마감';
        if (days === 1) return '1일 남음';
        return `${days}일 남음`;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatDateOnly(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    highlightSearch(text) {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        if (!searchTerm) return text;
        
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    showLoading(show) {
        const spinner = document.getElementById('loadingSpinner');
        if (show) {
            spinner.classList.remove('d-none');
        } else {
            spinner.classList.add('d-none');
        }
    }

    showSuccess(message) {
        this.showToast(message, 'success');
    }

    showError(message) {
        this.showToast(message, 'danger');
    }

    showToast(message, type) {
        // Create toast element
        const toastHtml = `
            <div class="toast align-items-center text-white bg-${type} border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;
        
        // Add to page
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            document.body.appendChild(toastContainer);
        }
        
        toastContainer.insertAdjacentHTML('beforeend', toastHtml);
        
        // Show toast
        const toastElement = toastContainer.lastElementChild;
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
        
        // Remove after hidden
        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    }

    generateKaptLink(bid) {
        // 스크래퍼에서 추출한 실제 상세 링크가 있으면 사용
        if (bid.detailLink && bid.detailLink.trim() !== '') {
            return bid.detailLink;
        }
        
        // 1개월 전부터 현재 날짜까지 동적으로 계산
        const today = new Date();
        const oneMonthAgo = new Date(today);
        oneMonthAgo.setMonth(today.getMonth() - 1);
        
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        const dateStart = formatDate(oneMonthAgo);
        const dateEnd = formatDate(today);
        
        // 대안: K-apt 사이트의 검색 결과로 이동 (단지명으로 검색)
        const baseUrl = 'https://www.k-apt.go.kr/bid/bidList.do';
        const params = new URLSearchParams({
            searchBidGb: 'bid_gb_1',
            bidTitle: '', // 공고명은 빈값
            aptName: bid.aptName, // 단지명으로 검색
            searchDateGb: 'reg',
            dateStart: dateStart,
            dateEnd: dateEnd,
            dateArea: '1',
            bidState: '',
            codeAuth: '',
            codeWay: '',
            codeAuthSub: '',
            codeSucWay: '',
            codeClassifyType1: '02',
            codeClassifyType2: '03',
            codeClassifyType3: '04',
            pageNo: '1',
            type: '4',
            bidArea: '11|28|41|42|43|44',
            bidNum: '',
            bidNo: '',
            dTime: Date.now(),
            mainKaptCode: '',
            aptCode: ''
        });
        
        return `${baseUrl}?${params.toString()}`;
    }

    getMethodBadgeClass(method) {
        const lowerMethod = method.toLowerCase();
        
        if (lowerMethod.includes('최저') && lowerMethod.includes('낙찰')) {
            return 'bg-danger'; // 적색계열
        }
        
        switch (method) {
            case '적격심사': return 'bg-info';
            case '경쟁입찰': return 'bg-primary';
            case '수의계약': return 'bg-success';
            default: return 'bg-secondary';
        }
    }

    bindCheckboxEvents() {
        const checkboxes = document.querySelectorAll('.bid-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const bidId = checkbox.getAttribute('data-bid-id');
                if (checkbox.checked) {
                    const bid = this.bids.find(b => b.id === bidId);
                    this.selectedBids.set(bidId, {
                        ...bid,
                        bidTime: '', // 입찰시간
                        submissionMethod: '전자', // 제출방법 (전자/직접)
                        siteVisit: { enabled: false, date: '', startTime: '', endTime: '' },
                        sitePT: { enabled: false, date: '', time: '' }
                    });
                    
                    // 체크 순서에 추가 (최근 체크된 것이 앞에 오도록, 순서 고정)
                    this.checkOrder = this.checkOrder.filter(id => id !== bidId); // 기존 위치 제거
                    this.checkOrder.unshift(bidId); // 맨 앞에 추가
                } else {
                    this.selectedBids.delete(bidId);
                    
                    // 체크 순서에서 제거 (순서는 유지)
                    this.checkOrder = this.checkOrder.filter(id => id !== bidId);
                }
                this.updateSelectedBidsDisplay();
                this.saveSelectedBids();
            });
        });
    }

    // 기존 체크 상태 유지 함수 (새로 크롤링된 데이터에서)
    preserveCheckboxStates() {
        // 현재 선택된 입찰공고 ID들을 저장
        const currentSelectedIds = new Set(this.selectedBids.keys());
        
        // 새로 로드된 데이터에서 기존 선택된 공고들만 유지
        const updatedSelectedBids = new Map();
        const updatedCheckOrder = [];
        
        // 기존 체크 순서를 유지하면서 현재 데이터에 존재하는 것만 필터링
        this.checkOrder.forEach(bidId => {
            const bid = this.bids.find(b => b.id === bidId);
            if (bid && currentSelectedIds.has(bidId)) {
                const existingBidData = this.selectedBids.get(bidId);
                updatedSelectedBids.set(bidId, {
                    ...bid, // 새로운 데이터로 업데이트
                    // 기존 사용자 설정 유지
                    bidTime: existingBidData.bidTime || '',
                    submissionMethod: existingBidData.submissionMethod || '전자',
                    siteVisit: existingBidData.siteVisit || { enabled: false, date: '', startTime: '', endTime: '' },
                    sitePT: existingBidData.sitePT || { enabled: false, date: '', time: '' }
                });
                updatedCheckOrder.push(bidId);
            }
        });
        
        this.selectedBids = updatedSelectedBids;
        this.checkOrder = updatedCheckOrder;
        
        console.log(`체크 상태 유지: ${updatedSelectedBids.size}건 유지됨`);
    }

    updateSelectedBidsDisplay() {
        const container = document.getElementById('selectedBidsContainer');
        const countBadge = document.getElementById('selectedBidsCount');
        
        countBadge.textContent = `${this.selectedBids.size}건`;
        
        if (this.selectedBids.size === 0) {
            container.innerHTML = '<p class="text-muted text-center">입찰할 공고를 선택해주세요.</p>';
            return;
        }

        // 일자별로 입찰공고 그룹화 (체크 순서 유지)
        this.groupSelectedBidsByDate();
        
        // 현재 선택된 날짜가 없거나 유효하지 않으면 첫 번째 날짜 선택
        if (!this.selectedBidsCurrentDate || !this.availableDates.includes(this.selectedBidsCurrentDate)) {
            this.selectedBidsCurrentDate = this.availableDates[0] || null;
        }

        let html = '';
        
        // 날짜 탭 생성
        if (this.availableDates.length > 1) {
            html += '<div class="mb-3">';
            html += '<ul class="nav nav-pills nav-fill">';
            this.availableDates.forEach(date => {
                const isActive = date === this.selectedBidsCurrentDate;
                const dateObj = new Date(date);
                const displayDate = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
                const dayOfWeek = ['일', '월', '화', '수', '목', '금', '토'][dateObj.getDay()];
                const count = this.selectedBidsByDate.get(date).length;
                
                html += `
                    <li class="nav-item">
                        <a class="nav-link ${isActive ? 'active' : ''}" 
                           href="javascript:void(0)" 
                           onclick="bidTracker.selectDateTab('${date}')">
                            ${displayDate}(${dayOfWeek}) <span class="badge bg-light text-dark ms-1">${count}</span>
                        </a>
                    </li>
                `;
            });
            html += '</ul>';
            html += '</div>';
        }
        
        // 선택된 날짜의 입찰공고 표시
        if (this.selectedBidsCurrentDate && this.selectedBidsByDate.has(this.selectedBidsCurrentDate)) {
            const dateBids = this.selectedBidsByDate.get(this.selectedBidsCurrentDate);
            
            dateBids.forEach(bidId => {
                if (this.selectedBids.has(bidId)) {
                    const bidData = this.selectedBids.get(bidId);
                    html += `
                        <div class="card mb-2" style="border: 1px solid #dee2e6;">
                            <div class="card-body py-2 px-3">
                                <div class="row align-items-center">
                                    <div class="col-md-4">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <div>
                                                <h6 class="card-title mb-1" style="font-size: 0.95rem;">${bidData.aptName} <span class="badge ${this.getMethodBadgeClass(bidData.method)}" style="font-size: 0.7rem;">${bidData.method}</span></h6>
                                                <p class="card-text small text-muted mb-1" style="font-size: 0.8rem; line-height: 1.2;">${bidData.title}</p>
                                                <p class="card-text mb-0"><small class="text-muted" style="font-size: 0.75rem;">마감일: ${this.formatDateOnly(bidData.deadline)}</small></p>
                                            </div>
                                            <button class="btn btn-sm btn-outline-danger p-1" 
                                                    onclick="bidTracker.removeSelectedBid('${bidId}')" 
                                                    title="선택 해제" style="font-size: 0.8rem;">
                                                <i class="bi bi-x-circle"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="col-md-2">
                                        <div class="mb-1">
                                            <label class="form-label small mb-1" style="font-size: 0.75rem;">입찰시간</label>
                                            <select class="form-select form-select-sm" style="font-size: 0.8rem;"
                                                    onchange="bidTracker.updateBidDetail('${bidId}', 'bidTime', undefined, this.value)">
                                                ${this.generateTimeOptions(bidData.bidTime)}
                                            </select>
                                        </div>
                                        <div class="mb-1">
                                            <label class="form-label small mb-1" style="font-size: 0.75rem;">제출방법</label>
                                            <select class="form-select form-select-sm" style="font-size: 0.8rem;"
                                                    onchange="bidTracker.updateBidDetail('${bidId}', 'submissionMethod', undefined, this.value)">
                                                <option value="전자" ${bidData.submissionMethod === '전자' ? 'selected' : ''}>전자</option>
                                                <option value="직접" ${bidData.submissionMethod === '직접' ? 'selected' : ''}>직접</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="row mb-1">
                                            <div class="col-3">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           id="siteVisit_${bidId}" 
                                                           ${bidData.siteVisit.enabled ? 'checked' : ''}
                                                           onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'enabled', this.checked)">
                                                    <label class="form-check-label small" for="siteVisit_${bidId}" style="font-size: 0.75rem;">
                                                        현장설명회
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="col-9">
                                                <div class="row g-1">
                                                    <div class="col-4">
                                                        <input type="date" class="form-control form-control-sm" style="font-size: 0.75rem;"
                                                               value="${bidData.siteVisit.date}"
                                                               ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                               onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'date', this.value)">
                                                    </div>
                                                    <div class="col-4">
                                                        <select class="form-select form-select-sm" style="font-size: 0.75rem;"
                                                                ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                                onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'startTime', this.value)">
                                                            ${this.generateTimeOptions(bidData.siteVisit.startTime)}
                                                        </select>
                                                    </div>
                                                    <div class="col-4">
                                                        <select class="form-select form-select-sm" style="font-size: 0.75rem;"
                                                                ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                                onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'endTime', this.value)">
                                                            ${this.generateTimeOptions(bidData.siteVisit.endTime)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div class="row g-1 mt-0">
                                                    <div class="col-4"><small class="text-muted" style="font-size: 0.65rem;">날짜</small></div>
                                                    <div class="col-4"><small class="text-muted" style="font-size: 0.65rem;">시작</small></div>
                                                    <div class="col-4"><small class="text-muted" style="font-size: 0.65rem;">종료</small></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="row">
                                            <div class="col-3">
                                                <div class="form-check">
                                                    <input class="form-check-input" type="checkbox" 
                                                           id="sitePT_${bidId}" 
                                                           ${bidData.sitePT.enabled ? 'checked' : ''}
                                                           onchange="bidTracker.updateBidDetail('${bidId}', 'sitePT', 'enabled', this.checked)">
                                                    <label class="form-check-label small" for="sitePT_${bidId}" style="font-size: 0.75rem;">
                                                        현장PT
                                                    </label>
                                                </div>
                                            </div>
                                            <div class="col-9">
                                                <div class="row g-1">
                                                    <div class="col-6">
                                                        <input type="date" class="form-control form-control-sm" style="font-size: 0.75rem;"
                                                               value="${bidData.sitePT.date}"
                                                               ${!bidData.sitePT.enabled ? 'disabled' : ''}
                                                               onchange="bidTracker.updateBidDetail('${bidId}', 'sitePT', 'date', this.value)">
                                                    </div>
                                                    <div class="col-6">
                                                        <select class="form-select form-select-sm" style="font-size: 0.75rem;"
                                                                ${!bidData.sitePT.enabled ? 'disabled' : ''}
                                                                onchange="bidTracker.updateBidDetail('${bidId}', 'sitePT', 'time', this.value)">
                                                            ${this.generateTimeOptions(bidData.sitePT.time)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div class="row g-1 mt-0">
                                                    <div class="col-6"><small class="text-muted" style="font-size: 0.65rem;">날짜</small></div>
                                                    <div class="col-6"><small class="text-muted" style="font-size: 0.65rem;">시간</small></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });
        }
        
        container.innerHTML = html;
    }

    // 선택된 입찰공고를 일자별로 그룹화
    groupSelectedBidsByDate() {
        this.selectedBidsByDate.clear();
        this.availableDates = [];
        
        // 체크 순서를 유지하면서 날짜별로 그룹화
        this.checkOrder.forEach(bidId => {
            if (this.selectedBids.has(bidId)) {
                const bidData = this.selectedBids.get(bidId);
                const deadlineDate = this.formatDateOnly(bidData.deadline);
                
                if (!this.selectedBidsByDate.has(deadlineDate)) {
                    this.selectedBidsByDate.set(deadlineDate, []);
                    this.availableDates.push(deadlineDate);
                }
                
                this.selectedBidsByDate.get(deadlineDate).push(bidId);
            }
        });
        
        // 날짜순으로 정렬
        this.availableDates.sort();
    }

    // 날짜 탭 선택
    selectDateTab(date) {
        this.selectedBidsCurrentDate = date;
        this.updateSelectedBidsDisplay();
    }

    updateBidDetail(bidId, category, field, value) {
        if (this.selectedBids.has(bidId)) {
            const bidData = this.selectedBids.get(bidId);
            
            // 단순 필드 (bidTime, submissionMethod) 처리
            if (field === undefined) {
                bidData[category] = value;
            } else {
                // 중첩 객체 필드 처리 (siteVisit, sitePT)
                bidData[category][field] = value;
            }
            
            this.selectedBids.set(bidId, bidData);
            
            // 체크박스 변경 시에만 전체 화면 업데이트 (필드 활성화/비활성화 때문)
            if (field === 'enabled') {
                this.updateSelectedBidsDisplay();
            }
            
            // 선택 정보 저장
            this.saveSelectedBids();
        }
    }

    async saveSelectedBids() {
        try {
            const selectedBidsData = {};
            this.selectedBids.forEach((value, key) => {
                selectedBidsData[key] = value;
            });
            
            // 체크 순서도 함께 저장
            const saveData = {
                selectedBids: selectedBidsData,
                checkOrder: this.checkOrder
            };
            
            // 서버에 저장
            const response = await fetch('/api/selected-bids', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(saveData)
            });
            
            if (!response.ok) {
                throw new Error('서버 저장 실패');
            }
            
            // 로컬 스토리지에도 백업으로 저장
            localStorage.setItem('selectedBids', JSON.stringify(saveData));
            
        } catch (error) {
            console.error('선택 정보 저장 오류:', error);
            // 서버 저장 실패 시 로컬 스토리지에만 저장
            const selectedBidsData = {};
            this.selectedBids.forEach((value, key) => {
                selectedBidsData[key] = value;
            });
            const saveData = {
                selectedBids: selectedBidsData,
                checkOrder: this.checkOrder
            };
            localStorage.setItem('selectedBids', JSON.stringify(saveData));
            this.showError('서버 저장에 실패했습니다. 로컬에만 저장됩니다.');
        }
    }

    async loadSelectedBids() {
        let serverData = null;
        let localData = null;
        
        try {
            // 1. 서버에서 데이터 불러오기 시도
            const response = await fetch('/api/selected-bids');
            const data = await response.json();
            
            if (data.success) {
                serverData = data.selectedBids;
                // 서버에서 체크 순서도 함께 받아옴
                if (data.checkOrder) {
                    serverData = {
                        selectedBids: data.selectedBids,
                        checkOrder: data.checkOrder
                    };
                }
            }
        } catch (error) {
            console.error('서버에서 선택 정보 로드 실패:', error);
        }
        
        try {
            // 2. 로컬 스토리지에서 데이터 불러오기
            const savedData = localStorage.getItem('selectedBids');
            if (savedData) {
                localData = JSON.parse(savedData);
            }
        } catch (error) {
            console.error('로컬 선택 정보 로드 실패:', error);
        }
        
        // 3. 마이그레이션 로직 (로컬 → 서버)
        if (localData && Object.keys(localData).length > 0) {
            if (!serverData || Object.keys(serverData).length === 0) {
                console.log('로컬 스토리지 데이터를 서버로 마이그레이션 중...');
                try {
                    const migrateResponse = await fetch('/api/selected-bids', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ selectedBids: localData })
                    });
                    
                    if (migrateResponse.ok) {
                        console.log('마이그레이션 완료: 로컬 데이터가 서버로 이전되었습니다.');
                        serverData = localData;
                        this.showSuccess('기존 선택 정보가 서버로 이전되었습니다.');
                    }
                } catch (error) {
                    console.error('마이그레이션 중 오류:', error);
                }
            }
        }
        
        // 4. 최종 데이터 적용 (서버 데이터 우선)
        const finalDataSource = serverData || localData || {};
        
        // 새로운 데이터 구조 처리 (selectedBids와 checkOrder 분리)
        let finalData, savedCheckOrder;
        if (finalDataSource.selectedBids && finalDataSource.checkOrder) {
            // 새로운 구조
            finalData = finalDataSource.selectedBids;
            savedCheckOrder = finalDataSource.checkOrder;
        } else if (finalDataSource.selectedBids) {
            // 기존 구조 (하위 호환성)
            finalData = finalDataSource.selectedBids;
            savedCheckOrder = Object.keys(finalDataSource.selectedBids);
        } else {
            // 매우 오래된 구조
            finalData = finalDataSource;
            savedCheckOrder = Object.keys(finalDataSource);
        }
        
        this.selectedBids = new Map();
        
        Object.entries(finalData).forEach(([bidId, bidData]) => {
            const updatedBidData = {
                ...bidData,
                bidTime: bidData.bidTime || '',
                submissionMethod: bidData.submissionMethod || '전자',
                siteVisit: {
                    enabled: false,
                    date: '',
                    startTime: '',
                    endTime: '',
                    ...bidData.siteVisit
                },
                sitePT: {
                    enabled: false,
                    date: '',
                    time: '',
                    ...bidData.sitePT
                }
            };
            this.selectedBids.set(bidId, updatedBidData);
        });
        
        // 체크 순서 복원 (저장된 순서 우선 사용)
        if (savedCheckOrder && savedCheckOrder.length > 0) {
            // 저장된 순서를 사용하되, 현재 데이터에 존재하는 것만 필터링
            this.checkOrder = savedCheckOrder.filter(id => finalData[id]);
            
            // 새로운 항목이 있으면 뒤에 추가
            const existingIds = new Set(this.checkOrder);
            const newIds = Object.keys(finalData).filter(id => !existingIds.has(id));
            this.checkOrder = [...this.checkOrder, ...newIds];
        } else {
            // 저장된 순서가 없으면 키 순서로
            this.checkOrder = Object.keys(finalData);
        }
        
        this.updateSelectedBidsDisplay();
    }

    generateTimeOptions(selectedTime) {
        let options = '<option value="">시간 선택</option>';
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                const selected = selectedTime === formattedTime ? 'selected' : '';
                options += `<option value="${formattedTime}" ${selected}>${formattedTime}</option>`;
            }
        }
        return options;
    }

    resetSelectedBids() {
        this.selectedBids.clear();
        this.checkOrder = []; // 체크 순서도 초기화
        this.updateSelectedBidsDisplay();
        this.saveSelectedBids();
    }

    cleanupSelectedBids() {
        const currentBidIds = new Set(this.bids.map(bid => bid.id));
        const toRemove = [];
        
        this.selectedBids.forEach((bidData, bidId) => {
            if (!currentBidIds.has(bidId)) {
                toRemove.push(bidId);
            }
        });
        
        if (toRemove.length > 0) {
            toRemove.forEach(bidId => this.selectedBids.delete(bidId));
            this.saveSelectedBids();
            this.updateSelectedBidsDisplay();
            console.log(`제거된 선택 공고: ${toRemove.length}건`);
        }
    }

    // 개별 선택된 입찰공고 삭제
    removeSelectedBid(bidId) {
        if (this.selectedBids.has(bidId)) {
            this.selectedBids.delete(bidId);
            
            // 체크 순서에서도 제거 (순서는 유지)
            this.checkOrder = this.checkOrder.filter(id => id !== bidId);
            
            // 메인 테이블의 체크박스도 해제
            const checkbox = document.querySelector(`input[data-bid-id="${bidId}"]`);
            if (checkbox) {
                checkbox.checked = false;
            }
            
            this.updateSelectedBidsDisplay();
            this.saveSelectedBids();
            this.showSuccess('선택된 입찰공고가 제거되었습니다.');
        }
    }

    // 현재 선택 저장
    async saveCurrentSelection() {
        try {
            if (this.selectedBids.size === 0) {
                this.showError('저장할 선택된 입찰공고가 없습니다.');
                return;
            }

            const selectedBidsData = {};
            this.selectedBids.forEach((value, key) => {
                selectedBidsData[key] = value;
            });
            
            const saveData = {
                selectedBids: selectedBidsData,
                checkOrder: this.checkOrder
            };

            const response = await fetch('/api/save-selection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(saveData)
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess(`${data.displayName}으로 저장되었습니다. (${data.savedCount}개 항목)`);
            } else {
                this.showError(data.message);
            }

        } catch (error) {
            console.error('선택 저장 오류:', error);
            this.showError('선택 저장 중 오류가 발생했습니다.');
        }
    }

    // 저장된 목록 불러오기 모달 표시
    async showLoadModal() {
        try {
            const modal = new bootstrap.Modal(document.getElementById('loadModal'));
            modal.show();

            // 저장된 목록 불러오기
            const response = await fetch('/api/saved-selections');
            const data = await response.json();

            const savedList = document.getElementById('savedSelectionsList');

            if (data.success && data.savedSelections.length > 0) {
                savedList.innerHTML = data.savedSelections.map(selection => `
                    <div class="saved-item p-3 border rounded mb-2">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${selection.displayName}</strong><br>
                                <small class="text-muted">${(selection.size / 1024).toFixed(1)} KB</small>
                            </div>
                            <div class="btn-group">
                                <button class="btn btn-primary btn-sm" onclick="loadSelection('${selection.filename}')">
                                    불러오기
                                </button>
                                <button class="btn btn-outline-danger btn-sm" onclick="deleteSelection('${selection.filename}')">
                                    삭제
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('');
            } else {
                savedList.innerHTML = '<div class="text-center text-muted">저장된 선택이 없습니다.</div>';
            }

        } catch (error) {
            console.error('저장된 목록 로드 오류:', error);
            document.getElementById('savedSelectionsList').innerHTML = 
                '<div class="text-center text-danger">저장된 목록을 불러올 수 없습니다.</div>';
        }
    }

    // 저장된 선택 불러오기
    async loadSelection(filename) {
        try {
            const response = await fetch(`/api/load-selection/${filename}`, {
                method: 'POST'
            });

            const data = await response.json();

            if (data.success) {
                // 모달 닫기
                bootstrap.Modal.getInstance(document.getElementById('loadModal')).hide();

                // 성공 메시지
                this.showSuccess(data.message);

                // 데이터 다시 로드
                await this.loadSelectedBids();

            } else {
                this.showError(data.message);
            }

        } catch (error) {
            console.error('선택 불러오기 오류:', error);
            this.showError('선택 불러오기 중 오류가 발생했습니다.');
        }
    }

    // 저장된 선택 삭제
    async deleteSelection(filename) {
        try {
            if (!confirm('정말로 이 저장된 선택을 삭제하시겠습니까?')) {
                return;
            }

            const response = await fetch(`/api/saved-selections/${filename}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('저장된 선택이 삭제되었습니다.');
                
                // 목록 다시 불러오기
                await showLoadModal();

            } else {
                this.showError(data.message);
            }

        } catch (error) {
            console.error('선택 삭제 오류:', error);
            this.showError('선택 삭제 중 오류가 발생했습니다.');
        }
    }

    startKeepAlive() {
        // 12분마다 서버에 상태 확인 요청 (15분 제한보다 짧게)
        setInterval(() => {
            fetch('/api/status')
                .then(response => response.json())
                .then(data => console.log('Keep-alive ping:', data.status))
                .catch(() => {}); // 에러 무시
        }, 12 * 60 * 1000); // 12분
        
        console.log('Keep-alive 기능이 시작되었습니다. (12분 간격)');
    }
}

// Initialize the application
const bidTracker = new BidTracker(); 

// 전역 함수로 등록 (HTML onclick에서 호출하기 위해)
window.showLoadModal = () => bidTracker.showLoadModal();
window.loadSelection = (filename) => bidTracker.loadSelection(filename);
window.deleteSelection = (filename) => bidTracker.deleteSelection(filename); 