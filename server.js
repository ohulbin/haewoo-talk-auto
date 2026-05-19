const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. DB 연결 (환경변수)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log('📁 MongoDB 연결 성공!'))
    .catch(err => console.error('❌ MongoDB 연결 실패:', err.message));

// ==========================================
// 2. 데이터 모델
// ==========================================
const reservationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true }, 
    reservationTime: { type: Date, required: true },
    lockerId: { type: String, default: '' }, 
    pw: { type: String, default: '' },       
    talkId: { type: String, default: '' },
    status: { type: String, default: 'READY' }, 
    createdAt: { type: Date, default: Date.now }
});
const Reservation = mongoose.model('Reservation', reservationSchema);

const talkUserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    talkId: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});
const TalkUser = mongoose.model('TalkUser', talkUserSchema);

const webhookCaptureSchema = new mongoose.Schema({
    talkId: { type: String, required: true, unique: true },
    lastMessage: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now }
});
const WebhookCapture = mongoose.model('WebhookCapture', webhookCaptureSchema);

// ==========================================
// 3. API 엔드포인트
// ==========================================
app.get('/api/reservations', async (req, res) => {
    try {
        const list = await Reservation.find().sort({ reservationTime: 1 });
        res.send(list);
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 🔄 [구조 전면 혁신] 스마트 보관함 동기화 엔진 (유령 데이터 및 누락 매커니즘 해결)
app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; 

        // 1. 이번 JSON 파일에 들어있는 보관함 번호(lockerId)들을 싹 긁어모읍니다.
        const incomingLockerIds = [...new Set(incomingUsers.map(u => u.lockerId))];

        // 2. [유령 데이터 청소] 해당 보관함 번호들 중 아직 발송 안 된(READY, SCHEDULED 등) 기존 행들만 골라 지웁니다.
        // 이미 발송 완료(SENT)된 내역은 장부 보호를 위해 절대 지우지 않습니다.
        await Reservation.deleteMany({
            lockerId: { $in: incomingLockerIds },
            status: { $ne: 'SENT' }
        });

        // 3. 신규 명단을 순회하며 적재를 시작합니다.
        for (let user of incomingUsers) {
            // 이미 동일 보관함에 동일 번호로 발송 완료(SENT)된 이력이 진짜 존재하는지 최종 체크
            const isAlreadySent = await Reservation.findOne({ phone: user.phone, lockerId: user.lockerId, status: 'SENT' });
            if (isAlreadySent) continue; // 발송 완료된 단골은 중복 뷰 생성 방지를 위해 패스

            const matchedUser = await TalkUser.findOne({ name: user.name, phone: user.phone });
            
            const newLog = new Reservation({
                name: user.name,
                phone: user.phone,
                reservationTime: new Date(user.reservationTime),
                lockerId: user.lockerId, 
                pw: user.pw,             
                talkId: matchedUser ? matchedUser.talkId : '', 
                status: matchedUser ? 'SCHEDULED' : 'READY'   
            });
            await newLog.save();
        }

        const updatedList = await Reservation.find().sort({ reservationTime: 1 });
        res.send({ success: true, data: updatedList });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.get('/api/webhook-captures', async (req, res) => {
    try {
        const captures = await WebhookCapture.find().sort({ receivedAt: -1 }).limit(50);
        res.send(captures);
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/api/scheduler/register', async (req, res) => {
    try {
        const { id, talkId } = req.body; 
        const order = await Reservation.findById(id);
        if (!order) return res.status(404).send({ success: false });

        order.talkId = talkId;
        order.status = 'SCHEDULED';
        await order.save();

        await TalkUser.findOneAndUpdate(
            { phone: order.phone }, 
            { name: order.name, phone: order.phone, talkId: talkId, updatedAt: Date.now() },
            { @returnDocument: 'after', upsert: true } // Mongoose 경고 완벽 해결 패치
        );
        await WebhookCapture.deleteOne({ talkId });
        res.send({ success: true, data: order });
    } catch (error) { res.status(500).send({ success: false }); }
});

app.post('/api/reservations/:id/cancel', async (req, res) => {
    try {
        const order = await Reservation.findById(req.params.id);
        if (order) {
            order.status = 'CANCELLED';
            await order.save();
        }
        res.send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

app.delete('/api/reservations/:id', async (req, res) => {
    try {
        await Reservation.findByIdAndDelete(req.params.id);
        res.send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

app.post('/webhook', async (req, res) => {
    const eventType = req.body.event; 
    const talkId = req.body.user;
    if (eventType === 'send' && req.body.textContent) {
        const text = req.body.textContent.text.trim();
        try {
            await WebhookCapture.findOneAndUpdate(
                { talkId: talkId },
                { talkId: talkId, lastMessage: text, receivedAt: Date.now() },
                { @returnDocument: 'after', upsert: true }
            );
        } catch (err) { console.error(err); }
    }
    res.send({ success: true });
});

// ==========================================
// 4. 네이버 발송 
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGlLZJTC2Fj8iLTRSc'; 

    const messageText = `[합정점 무인 수령 및 반납 안내]

안녕하세요, ${task.name}님 😊
합정 무인보관함 이용 안내드립니다.

📍 1. 매장 위치
주소 : 마포구 양화로 45 메세나폴리스 116호
위치 : 지하철 6호선 10번 출구 도보 1분 ('결이 고운 에스테틱' 옆) / 1층 세븐 일레븐, 야외 공연장 인근

🔐 2. 매장 출입
출입 번호 : [070-5234-5861]
매장 앞에서 위 번호로 전화를 거시면 문이 열립니다.
** 예약 시간 내에만 수령·반납 가능합니다 **

📦 3. 보관함 수령 및 반납
보관함 정보 : [${task.lockerId}번] 보관함 (비밀번호 : [${task.pw}])
🚨 절대 다이얼 비밀번호를 변경하지 말아주세요.

반납 방법 : 수령 시와 동일한 비밀번호로 문을 열고 반납해 주세요.
* 문이 잘 안 열리거나 안 잠긴다면 꾹 누르면서 다이얼을 돌려주시면 됩니다.

📸 4. 사진 전송 (필수)
수령할 때 1장 / 반납할 때 1장
물품 전체 구성품 사진을 찍어 **톡톡**으로 보내주세요.

⚠️ 무단 사용 금지
외부에 비치된 배터리 / 리더기 / SD카드는 추가 결제 고객 전용입니다.
결제 없이 사용 시 요금 청구 또는 이용 제한이 발생할 수 있습니다.

☎️ 비상 연락처 : 010-4607-0732`;

    try {
        const response = await axios.post(url, {
            event: "send",
            user: task.talkId,
            textContent: { text: messageText }
        }, {
            headers: {
                'Authorization': token, 
                'Content-Type': 'application/json;charset=UTF-8'
            }
        });
        return response.data.success;
    } catch (error) { return false; }
}

async function checkQueue() {
    const now = new Date();
    try {
        const activeTasks = await Reservation.find({ status: 'SCHEDULED' });
        for (let task of activeTasks) {
            const resTime = new Date(task.reservationTime);
            const targetTime = new Date(now.getTime() + (60 * 60 * 1000));
            const diff = Math.abs(resTime - targetTime);
            if (diff <= 5 * 60 * 1000) {
                const isSent = await sendTalkMessage(task);
                task.status = isSent ? 'SENT' : 'FAILED';
                await task.save();
            }
        }
    } catch (error) { console.error(error); }
}
setInterval(checkQueue, 60000);

app.listen(process.env.PORT || 5000, () => console.log(`🚀 서버 구동 중`));