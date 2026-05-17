const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. 데이터베이스 연결 (Render 환경변수)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log('📁 MongoDB Atlas 클라우드 데이터베이스 연결 성공!'))
    .catch(err => console.error('❌ MongoDB 연결 실패:', err.message));

// ==========================================
// 2. Mongoose 데이터 모델 정의
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

app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; 
        await Reservation.deleteMany({}); 

        const savedList = [];
        for (let user of incomingUsers) {
            const matchedUser = await TalkUser.findOne({ name: user.name, phone: user.phone });

            const newLog = new Reservation({
                name: user.name,
                phone: user.phone,
                reservationTime: new Date(user.reservationTime),
                lockerId: user.lockerId || '', 
                pw: user.pw || '',             
                talkId: matchedUser ? matchedUser.talkId : '', 
                status: matchedUser ? 'SCHEDULED' : 'READY'   
            });
            await newLog.save();
            savedList.push(newLog);
        }
        res.send({ success: true, data: savedList });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.get('/api/webhook-captures', async (req, res) => {
    try {
        const captures = await WebhookCapture.find().sort({ receivedAt: -1 }).limit(20);
        res.send(captures);
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/api/scheduler/register', async (req, res) => {
    try {
        const { id, talkId } = req.body; 

        const order = await Reservation.findById(id);
        if (!order) return res.status(404).send({ success: false, message: '예약자를 찾을 수 없습니다.' });

        order.talkId = talkId;
        order.status = 'SCHEDULED';
        await order.save();

        await TalkUser.findOneAndUpdate(
            { phone: order.phone }, 
            { name: order.name, phone: order.phone, talkId: talkId, updatedAt: Date.now() },
            { upsert: true, new: true }
        );

        await WebhookCapture.deleteOne({ talkId });

        res.send({ success: true, data: order });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/api/reservations/:id/cancel', async (req, res) => {
    try {
        const order = await Reservation.findById(req.params.id);
        if (!order) return res.status(404).send({ success: false, message: '예약을 찾을 수 없습니다.' });

        order.status = 'CANCELLED';
        await order.save();
        res.send({ success: true, data: order });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

app.post('/webhook', async (req, res) => {
    const eventType = req.body.event; 
    const talkId = req.body.user;

    if (eventType === 'send' && req.body.textContent) {
        const text = req.body.textContent.text.trim();
        console.log(`\n🚨 [웹훅 수집] ID: ${talkId} | 내용: ${text}`);

        try {
            await WebhookCapture.findOneAndUpdate(
                { talkId: talkId },
                { talkId: talkId, lastMessage: text, receivedAt: Date.now() },
                { upsert: true, new: true }
            );
        } catch (err) {
            console.error('웹훅 임시 저장 에러:', err.message);
        }
    } else {
        console.log(`\nℹ️ [웹훅 패스] ID: ${talkId} | 종류: ${eventType}`);
    }
    
    res.send({ success: true });
});

// ==========================================
// 4. 네이버 톡톡 실시간 API 발송 함수 (디버깅 에러 로그 복구)
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGILZJTC2Fj8iLTRSc'; 

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

        // 💡 [버그 추적 핵심 정보] 네이버가 거절한 진짜 이유를 Render 검은 화면에 뿌려줍니다.
        if (response.data && response.data.success === false) {
            console.log(`\n❌ [네이버 반환 에러 전문] 대상: ${task.name} | 내역:`, response.data);
        }

        return response.data.success;
    } catch (error) {
        console.error('❌ 네이버 통신 장애:', error.message);
        return false;
    }
}

// ==========================================
// 5. 스케줄러 메인 루프 (1분 주기 감시)
// ==========================================
async function checkQueue() {
    const now = new Date();
    try {
        const activeTasks = await Reservation.find({ status: 'SCHEDULED' });

        for (let task of activeTasks) {
            const sendTime = new Date(task.reservationTime);
            sendTime.setHours(sendTime.getHours() - 1); 

            if (now >= sendTime) {
                const isSent = await sendTalkMessage(task);
                task.status = isSent ? 'SENT' : 'FAILED';
                await task.save();
                console.log(`[스케줄러 반영] ${task.name}님 발송 결과: ${task.status}`);
            }
        }
    } catch (error) {
        console.error('스케줄러 큐 감시 오류:', error.message);
    }
}
setInterval(checkQueue, 60000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 백엔드 기동 완료 (포트: ${PORT})`);
});