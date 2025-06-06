const { MongoClient } = require('mongodb');

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        if (!this.client) {
            console.log('🔌 MongoDB 연결 시도 중...');
            console.log('MONGODB_URI 존재:', !!process.env.MONGODB_URI);
            console.log('MONGODB_URI 앞 30자:', process.env.MONGODB_URI ? process.env.MONGODB_URI.substring(0, 30) + '...' : 'undefined');
            
            if (!process.env.MONGODB_URI) {
                throw new Error('MONGODB_URI 환경 변수가 설정되지 않았습니다.');
            }
            
            try {
                this.client = new MongoClient(process.env.MONGODB_URI, {
                    connectTimeoutMS: 10000, // 10초 타임아웃
                    serverSelectionTimeoutMS: 5000, // 5초 서버 선택 타임아웃
                });
                
                console.log('MongoDB 클라이언트 생성 완료, 연결 시작...');
                await this.client.connect();
                console.log('MongoDB 연결 완료, 데이터베이스 선택...');
                
                this.db = this.client.db('kapt-bids');
                console.log('✅ MongoDB 연결 성공');
            } catch (error) {
                console.error('❌ MongoDB 연결 실패 상세 정보:');
                console.error('에러 이름:', error.name);
                console.error('에러 메시지:', error.message);
                console.error('에러 코드:', error.code);
                console.error('전체 에러:', error);
                
                this.client = null;
                this.db = null;
                throw error;
            }
        }
        return this.db;
    }

    async saveData(collection, data) {
        const db = await this.connect();
        
        // 백업 생성 (최근 5개만 유지)
        const backups = await db.collection(`${collection}_backup`)
            .find()
            .sort({ timestamp: -1 })
            .toArray();
            
        if (backups.length >= 5) {
            await db.collection(`${collection}_backup`).deleteOne({
                _id: backups[backups.length - 1]._id
            });
        }
        
        await db.collection(`${collection}_backup`).insertOne({
            data: data,
            timestamp: new Date()
        });
        
        // 현재 데이터 저장/업데이트
        await db.collection(collection).replaceOne(
            { _id: 'current' },
            { _id: 'current', data: data, updatedAt: new Date() },
            { upsert: true }
        );
        
        console.log(`MongoDB에 데이터 저장 완료: ${collection}`);
    }

    async loadData(collection) {
        const db = await this.connect();
        const result = await db.collection(collection).findOne({ _id: 'current' });
        console.log(`MongoDB에서 데이터 로드: ${collection}`);
        return result ? result.data : null;
    }

    async close() {
        if (this.client) {
            await this.client.close();
            this.client = null;
            this.db = null;
        }
    }
}

module.exports = new Database(); 