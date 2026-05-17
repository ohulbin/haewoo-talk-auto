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
// 📌 A. 당일 대기열 명단
const reservationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true }, // 전체 전화번호 (대조용)
    reservationTime: { type: Date, required: true },
    talkId: { type: String, default: '' },
    status: { type: String, default: 'READY' }, // READY, SCHEDULED, SENT, FAILED, CANCELLED
    createdAt: { type: Date, default: Date.now }
});
const Reservation = mongoose.model('Reservation', reservationSchema);

// 📌 B. 영구 고객 장부 (이름+전화번호 조합으로 중복 원천 차단)
const talkUserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true }, 
    talkId: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
});
const TalkUser = mongoose.model('TalkUser', talkUserSchema);

// 📌 C. 웹훅 미확인 임시 수신함 (팝업창 노출용)
const webhookCaptureSchema = new mongoose.Schema({
    talkId: { type: String, required: true, unique: true },
    lastMessage: { type: String, default: '' },
    receivedAt: { type: Date, default: Date.now }
});
const WebhookCapture = mongoose.model('WebhookCapture', webhookCaptureSchema);


// ==========================================
// 3. API 엔드포인트 (컨트롤러)
// ==========================================

// 🔄 [조회] 화면 켤 때/새로고침 시 DB에서 기존 리스트 호출
app.get('/api/reservations', async (req, res) => {
    try {
        const list = await Reservation.find().sort({ reservationTime: 1 });
        res.send(list);
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 📥 [업로드] JSON 명단 등록 + 장부 대조 자동 매핑
app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; // [{name, phone, reservationTime}, ...]
        await Reservation.deleteMany({}); // 당일 신규 조회를 위해 기존 대기열 비우기

        const savedList = [];
        for (let user of incomingUsers) {
            // 💡 핵심: 이름과 전화번호가 모두 일치하는 단골 고객이 장부에 있는지 조회
            const matchedUser = await TalkUser.findOne({ name: user.name, phone: user.phone });

            const newLog = new Reservation({
                name: user.name,
                phone: user.phone,
                reservationTime: new Date(user.reservationTime),
                talkId: matchedUser ? matchedUser.talkId : '', // 찾으면 자동 입력, 없으면 빈칸
                status: matchedUser ? 'SCHEDULED' : 'READY'   // 자동 매핑 시 바로 스케줄 예약 상태로 변경
            });
            await newLog.save();
            savedList.push(newLog);
        }
        res.send({ success: true, data: savedList });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 🗂️ [웹훅 리스트 조회] 프론트엔드 팝업창에 띄울 미확인 톡 목록 리턴
app.get('/api/webhook-captures', async (req, res) => {
    try {
        const captures = await WebhookCapture.find().sort({ receivedAt: -1 }).limit(20);
        res.send(captures);
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// 🔗 [수동 확정] 팝업창에서 특정 ID 선택 시 매핑 유도 및 영구 장부 등록
app.post('/api/scheduler/register', async (req, res) => {
    try {
        const { id, talkId } = req.body; // id: Reservation의 _id 값

        const order = await Reservation.findById(id);
        if (!order) return res.status(404).send({ success: false, message: '예약자를 찾을 수 없습니다.' });

        order.talkId = talkId;
        order.status = 'SCHEDULED';
        await order.save();

        // 💡 다음 예약을 위한 빌드업: 영구 장부(TalkUser)에 고객 정보와 톡 고유 ID 박아두기
        await TalkUser.findOneAndUpdate(
            { phone: order.phone }, // 전화번호는 고유하므로 훌륭한 Key가 됩니다.
            { name: order.name, phone: order.phone, talkId: talkId, updatedAt: Date.now() },
            { upsert: true, new: true }
        );

        // 짝이 맞춰졌으므로 임시 보관함에서 해당 톡 데이터 삭제 삭제
        await WebhookCapture.deleteOne({ talkId });

        res.send({ success: true, data: order });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

// ❌ [수동 취소] 관리자가 리스트에서 특정 고객 발송 취소 처리
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

// 🎣 [웹훅 라우터] 고객이 말을 걸면 미확인 수신함에 일단 다 꽂아둠
app.post('/webhook', async (req, res) => {
    const talkId = req.body.user;
    const text = req.body.textContent ? req.body.textContent.text.trim() : '내용 없음';

    console.log(`\n🚨 [웹훅 수집] ID: ${talkId} | 메시지: ${text}`);

    try {
        // 임시 보관함에 업데이트 (이미 존재하면 최신 메시지와 시간으로 갱신)
        await WebhookCapture.findOneAndUpdate(
            { talkId: talkId },
            { talkId: talkId, lastMessage: text, receivedAt: Date.now() },
            { upsert: true, new: true }
        );
    } catch (err) {
        console.error('웹훅 임시 저장 에러:', err.message);
    }
    res.send({ success: true });
});

// ==========================================
// 4. 네이버 톡톡 실시간 API 발송 함수 (Bearer 제거 완료)
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGlLZTC2Fj8iLTRSc'; // 어울빈 실토큰 유지

    const messageText = `[합정점 무인 수령 및 반납 안내]

안녕하세요, ${task.name}님 😊
합정 무인보관함 이용 안내드립니다.

📍 1. 매장 위치
주소 : 마포구 양화로 45 메세나폴리스 116호
위치 : 지하철 6호선 10번 출구 도보 1분 ('결이 고운 에스테틱' 옆)`;

    try {
        const response = await axios.post(url, {
            event: "send",
            user: task.talkId,
            textContent: { text: messageText }
        }, {
            headers: {
                'Authorization': token, // 네이버 규격 준수
                'Content-Type': 'application/json;charset=UTF-8'
            }
        });
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
            sendTime.setHours(sendTime.getHours() - 1); // 1시간 전 발송 타겟팅

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

// ==========================================
// 6. 서버 포트 오픈
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 백엔드 기동 완료 (포트: ${PORT})`);
});