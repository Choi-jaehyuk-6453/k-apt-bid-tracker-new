// K-apt Bid Tracker - Main Application JavaScript

class BidTracker {
    constructor() {
        this.bids = [];
        this.filteredBids = [];
        this.selectedBids = new Map(); // 선택된 입찰공고 저장 (ID -> 세부정보)
        this.checkOrder = []; // 체크된 순서 추적
        this.currentPage = 1;
        this.itemsPerPage = 10;
        
        // 선택된 입찰목록 페이지네이션
        this.selectedBidsCurrentPage = 1;
        this.selectedBidsItemsPerPage = 10;
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadData();
        await this.loadSelectedBids();
        this.updateStats();
        this.applyFilters();
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
    }

    async loadData() {
        try {
            this.showLoading(true);
            const response = await fetch('/api/bids');
            const data = await response.json();
            
            if (data.success) {
                this.bids = data.bids || [];
                this.cleanupSelectedBids(); // 없어진 공고 제거
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
                this.updateLastUpdateTime();
                this.showSuccess('업데이트가 완료되었습니다.');
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
        
        // 대안: K-apt 사이트의 검색 결과로 이동 (단지명으로 검색)
        const baseUrl = 'https://www.k-apt.go.kr/bid/bidList.do';
        const params = new URLSearchParams({
            searchBidGb: 'bid_gb_1',
            bidTitle: '', // 공고명은 빈값
            aptName: bid.aptName, // 단지명으로 검색
            searchDateGb: 'reg',
            dateStart: '2025-05-01',
            dateEnd: '2025-05-31',
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
                    
                    // 체크 순서에 추가 (최근 체크된 것이 앞에 오도록)
                    this.checkOrder = this.checkOrder.filter(id => id !== bidId); // 기존 위치 제거
                    this.checkOrder.unshift(bidId); // 맨 앞에 추가
                } else {
                    this.selectedBids.delete(bidId);
                    
                    // 체크 순서에서 제거
                    this.checkOrder = this.checkOrder.filter(id => id !== bidId);
                }
                this.updateSelectedBidsDisplay();
                this.saveSelectedBids();
            });
        });
    }

    updateSelectedBidsDisplay() {
        const container = document.getElementById('selectedBidsContainer');
        const countBadge = document.getElementById('selectedBidsCount');
        
        countBadge.textContent = `${this.selectedBids.size}건`;
        
        if (this.selectedBids.size === 0) {
            container.innerHTML = '<p class="text-muted text-center">입찰할 공고를 선택해주세요.</p>';
            return;
        }

        // 페이지네이션 계산
        const totalItems = this.checkOrder.length;
        const totalPages = Math.ceil(totalItems / this.selectedBidsItemsPerPage);
        const startIndex = (this.selectedBidsCurrentPage - 1) * this.selectedBidsItemsPerPage;
        const endIndex = startIndex + this.selectedBidsItemsPerPage;
        const pageItems = this.checkOrder.slice(startIndex, endIndex);

        let html = '';
        
        // 체크 순서대로 표시 (페이지네이션 적용)
        pageItems.forEach(bidId => {
            if (this.selectedBids.has(bidId)) {
                const bidData = this.selectedBids.get(bidId);
                html += `
                    <div class="card mb-3">
                        <div class="card-body">
                            <div class="row">
                                <div class="col-md-4">
                                    <div class="d-flex justify-content-between align-items-start">
                                        <div>
                                            <h6 class="card-title">${bidData.aptName} <span class="badge ${this.getMethodBadgeClass(bidData.method)}">${bidData.method}</span></h6>
                                            <p class="card-text small text-muted">${bidData.title}</p>
                                            <p class="card-text"><small class="text-muted">마감일: ${this.formatDateOnly(bidData.deadline)}</small></p>
                                        </div>
                                        <button class="btn btn-sm btn-outline-danger" 
                                                onclick="bidTracker.removeSelectedBid('${bidId}')" 
                                                title="선택 해제">
                                            <i class="bi bi-x-circle"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="col-md-2">
                                    <div class="mb-2">
                                        <label class="form-label small">입찰시간</label>
                                        <select class="form-select form-select-sm" 
                                                onchange="bidTracker.updateBidDetail('${bidId}', 'bidTime', undefined, this.value)">
                                            ${this.generateTimeOptions(bidData.bidTime)}
                                        </select>
                                    </div>
                                    <div class="mb-2">
                                        <label class="form-label small">제출방법</label>
                                        <select class="form-select form-select-sm" 
                                                onchange="bidTracker.updateBidDetail('${bidId}', 'submissionMethod', undefined, this.value)">
                                            <option value="전자" ${bidData.submissionMethod === '전자' ? 'selected' : ''}>전자</option>
                                            <option value="직접" ${bidData.submissionMethod === '직접' ? 'selected' : ''}>직접</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="row mb-2">
                                        <div class="col-3">
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" 
                                                       id="siteVisit_${bidId}" 
                                                       ${bidData.siteVisit.enabled ? 'checked' : ''}
                                                       onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'enabled', this.checked)">
                                                <label class="form-check-label small" for="siteVisit_${bidId}">
                                                    현장설명회
                                                </label>
                                            </div>
                                        </div>
                                        <div class="col-9">
                                            <div class="row">
                                                <div class="col-4">
                                                    <input type="date" class="form-control form-control-sm" 
                                                           value="${bidData.siteVisit.date}"
                                                           ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                           onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'date', this.value)">
                                                </div>
                                                <div class="col-4">
                                                    <select class="form-select form-select-sm" 
                                                            ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                            onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'startTime', this.value)">
                                                        ${this.generateTimeOptions(bidData.siteVisit.startTime)}
                                                    </select>
                                                </div>
                                                <div class="col-4">
                                                    <select class="form-select form-select-sm" 
                                                            ${!bidData.siteVisit.enabled ? 'disabled' : ''}
                                                            onchange="bidTracker.updateBidDetail('${bidId}', 'siteVisit', 'endTime', this.value)">
                                                        ${this.generateTimeOptions(bidData.siteVisit.endTime)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="row">
                                                <div class="col-4"><small class="text-muted">날짜</small></div>
                                                <div class="col-4"><small class="text-muted">시작</small></div>
                                                <div class="col-4"><small class="text-muted">종료</small></div>
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
                                                <label class="form-check-label small" for="sitePT_${bidId}">
                                                    현장PT
                                                </label>
                                            </div>
                                        </div>
                                        <div class="col-9">
                                            <div class="row">
                                                <div class="col-6">
                                                    <input type="date" class="form-control form-control-sm" 
                                                           value="${bidData.sitePT.date}"
                                                           ${!bidData.sitePT.enabled ? 'disabled' : ''}
                                                           onchange="bidTracker.updateBidDetail('${bidId}', 'sitePT', 'date', this.value)">
                                                </div>
                                                <div class="col-6">
                                                    <select class="form-select form-select-sm" 
                                                            ${!bidData.sitePT.enabled ? 'disabled' : ''}
                                                            onchange="bidTracker.updateBidDetail('${bidId}', 'sitePT', 'time', this.value)">
                                                        ${this.generateTimeOptions(bidData.sitePT.time)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div class="row">
                                                <div class="col-6"><small class="text-muted">날짜</small></div>
                                                <div class="col-6"><small class="text-muted">시간</small></div>
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
        
        // 페이지네이션 HTML 추가
        if (totalPages > 1) {
            html += this.renderSelectedBidsPagination(totalPages);
        }
        
        container.innerHTML = html;
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
            
            // 서버에 저장
            const response = await fetch('/api/selected-bids', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ selectedBids: selectedBidsData })
            });
            
            if (!response.ok) {
                throw new Error('서버 저장 실패');
            }
            
            // 로컬 스토리지에도 백업으로 저장
            localStorage.setItem('selectedBids', JSON.stringify(selectedBidsData));
            
        } catch (error) {
            console.error('선택 정보 저장 오류:', error);
            // 서버 저장 실패 시 로컬 스토리지에만 저장
            const selectedBidsData = {};
            this.selectedBids.forEach((value, key) => {
                selectedBidsData[key] = value;
            });
            localStorage.setItem('selectedBids', JSON.stringify(selectedBidsData));
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
        const finalData = serverData || localData || {};
        
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
        
        this.checkOrder = Object.keys(finalData);
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
            
            // 체크 순서에서도 제거
            this.checkOrder = this.checkOrder.filter(id => id !== bidId);
            
            // 현재 페이지가 비어있으면 이전 페이지로 이동
            const totalPages = Math.ceil(this.checkOrder.length / this.selectedBidsItemsPerPage);
            if (this.selectedBidsCurrentPage > totalPages && totalPages > 0) {
                this.selectedBidsCurrentPage = totalPages;
            } else if (this.checkOrder.length === 0) {
                this.selectedBidsCurrentPage = 1;
            }
            
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

    // 선택된 입찰목록 페이지네이션 렌더링
    renderSelectedBidsPagination(totalPages) {
        let paginationHTML = `
            <div class="d-flex justify-content-center mt-3">
                <nav aria-label="선택된 입찰목록 페이지네이션">
                    <ul class="pagination pagination-sm">
        `;

        // Previous button
        paginationHTML += `
            <li class="page-item ${this.selectedBidsCurrentPage === 1 ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="bidTracker.goToSelectedBidsPage(${this.selectedBidsCurrentPage - 1})">
                    <i class="bi bi-chevron-left"></i>
                </a>
            </li>
        `;

        // Page numbers
        const startPage = Math.max(1, this.selectedBidsCurrentPage - 2);
        const endPage = Math.min(totalPages, this.selectedBidsCurrentPage + 2);

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <li class="page-item ${i === this.selectedBidsCurrentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="bidTracker.goToSelectedBidsPage(${i})">${i}</a>
                </li>
            `;
        }

        // Next button
        paginationHTML += `
            <li class="page-item ${this.selectedBidsCurrentPage === totalPages ? 'disabled' : ''}">
                <a class="page-link" href="#" onclick="bidTracker.goToSelectedBidsPage(${this.selectedBidsCurrentPage + 1})">
                    <i class="bi bi-chevron-right"></i>
                </a>
            </li>
        `;

        paginationHTML += `
                    </ul>
                </nav>
            </div>
            <div class="text-center mt-2">
                <small class="text-muted">
                    ${this.selectedBidsCurrentPage} / ${totalPages} 페이지 
                    (총 ${this.selectedBids.size}건)
                </small>
            </div>
        `;

        return paginationHTML;
    }

    // 선택된 입찰목록 페이지 이동
    goToSelectedBidsPage(page) {
        const totalPages = Math.ceil(this.checkOrder.length / this.selectedBidsItemsPerPage);
        if (page >= 1 && page <= totalPages) {
            this.selectedBidsCurrentPage = page;
            this.updateSelectedBidsDisplay();
        }
    }
}

// Initialize the application
const bidTracker = new BidTracker(); 