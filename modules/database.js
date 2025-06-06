const { MongoClient } = require('mongodb');

class Database {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async connect() {
        if (!this.client) {
            this.client = new MongoClient(process.env.MONGODB_URI);
            await this.client.connect();
            this.db = this.client.db('kapt-bids');
            console.log('MongoDB 연결 성공');
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