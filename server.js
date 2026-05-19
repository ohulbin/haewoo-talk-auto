const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. DB 연결 (환경변수 유지)
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

// 🔄 [수정] 스마트 병합(Merge) 방식으로 변경 (덮어쓰기 및 중복발송 완전 방어)
app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; 

        for (let user of incomingUsers) {
            // 전화번호를 기준으로 기존 예약이 존재하는지 확인
            const existing = await Reservation.findOne({ phone: user.phone });

            if (existing) {
                // 🚨 이미 알림톡이 나간(SENT) 고객은 절대 데이터를 건드리지 않고 보호합니다.
                if (existing.status === 'SENT') continue;

                // 발송 전 상태라면 새로운 보관함 번호와 비밀번호, 시간 정보로 업데이트
                const matchedUser = await TalkUser.findOne({ name: user.name, phone: user.phone });
                existing.name = user.name;
                existing.reservationTime = new Date(user.reservationTime);
                existing.lockerId = user.lockerId || existing.lockerId;
                existing.pw = user.pw || existing.pw;
                
                if (matchedUser) {
                    existing.talkId = matchedUser.talkId;
                    if (existing.status === 'READY' || existing.status === 'CANCELLED') {
                        existing.status = 'SCHEDULED';
                    }
                }
                await existing.save();
            } else {
                // 신규 예약자라면 새롭게 장부에 등록
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
            }
        }

        // 💡 중요: 업로드 후 새로고침 없이 UI가 즉시 갱신되도록 최신 리스트 전체를 반환합니다.
        const updatedList = await Reservation.find().sort({ reservationTime: 1 });
        res.send({ success: true, data: updatedList });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 🔄 [수정] 한번에 보이는 대화내역 한도를 20개에서 50개로 상향 조정
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
        if (!order) return res.status(404).send({ success: false });
        order.status = 'CANCELLED';
        await order.save();
        res.send({ success: true, data: order });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 💡 삭제 시 발송 큐(DB)에서 완벽히 영구 삭제 처리
app.delete('/api/reservations/:id', async (req, res) => {
    try {
        await Reservation.findByIdAndDelete(req.params.id);
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
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
                { upsert: true, new: true }
            );
        } catch (err) { console.error(err); }
    }
    res.send({ success: true });
});

// ==========================================
// 4. 네이버 발송 함수 (토큰 고정 상태 유지)
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGlLZJTC2Fj8iLTRSc'; // 검증된 오피셜 소문자 l 버전 토큰 고정

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

        if (response.data && response.data.success === false) {
            console.log(`\n❌ [에러 반환] 대상: ${task.name} | 내역:`, response.data);
        }
        return response.data.success;
    } catch (error) { return false; }
}

// ==========================================
// 5. 스케줄러 메인 루프 (5분 오차 윈도우 조준 발송 시스템)
// ==========================================
async function checkQueue() {
    const now = new Date();
    const kstString = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`[⏳ 스케줄러 가동] 한국시간 기준: ${kstString} | 큐 체크 중...`);

    try {
        const activeTasks = await Reservation.find({ status: 'SCHEDULED' });
        for (let task of activeTasks) {
            const reservationTime = new Date(task.reservationTime);
            const targetTime = new Date(now.getTime() + (60 * 60 * 1000));

            const timeDifference = Math.abs(reservationTime - targetTime);
            const fiveMinutesInMs = 5 * 60 * 1000;

            if (timeDifference <= fiveMinutesInMs) {
                console.log(`🎯 [타깃 매칭] ${task.name}님 예약 확인됨.`);
                const isSent = await sendTalkMessage(task);
                task.status = isSent ? 'SENT' : 'FAILED';
                await task.save();
                console.log(`[스케줄러 결과] ${task.name}님 전송 상태 ➡️ ${task.status}`);
            }
        }
    } catch (error) { console.error(error); }
}
setInterval(checkQueue, 60000);

app.listen(process.env.PORT || 5000, () => console.log(`🚀 백엔드 프로덕션 시스템 정상 구동 중`));