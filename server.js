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

app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; 
        const incomingLockerIds = [...new Set(incomingUsers.map(u => u.lockerId))];

        await Reservation.deleteMany({
            lockerId: { $in: incomingLockerIds },
            status: { $ne: 'SENT' }
        });

        for (let user of incomingUsers) {
            const isAlreadySent = await Reservation.findOne({ phone: user.phone, lockerId: user.lockerId, status: 'SENT' });
            if (isAlreadySent) continue; 

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

// 💡 [신규] 웹훅(일반 문의) 개별 삭제용 API
app.delete('/api/webhook-captures/:id', async (req, res) => {
    try {
        await WebhookCapture.findByIdAndDelete(req.params.id);
        res.send({ success: true });
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
            { returnDocument: 'after', upsert: true } 
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
    const token = 'iJaGlLZJTC2Fj8iLTRSc'; // [주의] 회사 실전 토큰으로 변경!
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const headers = { 'Authorization': token, 'Content-Type': 'application/json;charset=UTF-8' };

    // 💡 1. 채팅방 최초 진입 시 (open 이벤트)
    if (eventType === 'open') {
        
        // 🛍️ [상품 링크 진입 감지] 
        if (req.body.options && req.body.options.product) {
            const product = req.body.options.product;
            try {
                await axios.post(url, {
                    event: "send", user: talkId,
                    textContent: { text: "상품을 문의하셨습니다.\n어떤 점이 궁금하신가요? 😊" }
                }, { headers });
                
                await axios.post(url, {
                    event: "send", user: talkId,
                    linkContent: {
                        title: product.name,
                        description: `${Number(product.price).toLocaleString()}원`,
                        imageUrl: product.imageUrl,
                        linkUrl: product.url
                    }
                }, { headers });
            } catch (err) { console.error("상품 카드 발송 실패:", err); }
        }

        // 📋 [FAQ 캐러셀 메뉴판 강제 렌더링] - code 속성 추가로 버튼 증발 완벽 방어
        // 📋 [FAQ 캐러셀 메뉴판 강제 렌더링] - PC버전 버튼 증발 방어용 image 강제 주입
        const initialFaqPayload = {
            event: "send",
            user: talkId,
            compositeContent: {
                compositeList: [
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        // 💡 [핵심] 사진이 없으면 PC에서 버튼이 깨지므로 썸네일을 무조건 넣어야 합니다!
                        image: {
                            imageUrl: "https://via.placeholder.com/600x400/1E3A8A/FFFFFF?text=Haewoo+Camera" // 나중에 실제 로고 이미지 주소로 변경하세요
                        },
                        buttonList: [
                            { type: "TEXT", name: "주문방법", code: "주문방법" },
                            { type: "TEXT", name: "스케줄(재고) 문의", code: "스케줄문의" },
                            { type: "TEXT", name: "수령/반납 방법", code: "수령반납" }
                        ]
                    },
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        image: {
                            imageUrl: "https://via.placeholder.com/600x400/1E3A8A/FFFFFF?text=Haewoo+Camera"
                        },
                        buttonList: [
                            { type: "TEXT", name: "위치/영업시간", code: "위치" },
                            { type: "TEXT", name: "주차안내", code: "주차" }
                        ]
                    }
                ]
            }
        };

        try {
            await axios.post(url, initialFaqPayload, { headers });
        } catch (err) { console.error("FAQ 리스트 발송 실패:", err); }

        return res.send({ success: true });
    }

    // 💡 2. 고객이 메시지를 전송했거나 FAQ 버튼을 눌렀을 때 (send 이벤트)
    if (eventType === 'send' && req.body.textContent) {
        const text = req.body.textContent.text.trim();
        
        // 미니 챗봇 FAQ 자동응답 트리거
        let replyText = "";
        if (text === "주문방법") replyText = "✨ 주문 방법 안내\n스마트스토어에서 원하시는 장비와 일정을 선택해 결제해 주시면 됩니다!";
        else if (text === "스케줄(재고) 문의") replyText = "📅 재고 문의 안내\n대여를 원하시는 [장비명 / 날짜 / 시간]을 텍스트로 남겨주시면 담당자가 빠르게 확인해 드리겠습니다.";
        else if (text === "수령/반납 방법") replyText = "📦 수령/반납 안내\n합정점은 24시간 무인 보관함으로 운영됩니다. 예약 시간 한 시간 전에 보관함 번호와 비밀번호를 톡톡으로 발송해 드립니다.";
        else if (text === "위치/영업시간") replyText = "📍 매장 위치 및 영업시간\n- 주소: 마포구 양화로 45 메세나폴리스 116호\n- 영업시간: 무인보관함 24시간 연중무휴";
        else if (text === "주차안내") replyText = "🚗 주차 안내\n메세나폴리스 지하 주차장을 이용하시면 됩니다. 이용 고객님께는 무료 주차 등록을 지원해 드립니다.";

        if (replyText !== "") {
            // 버튼 답변은 관리자 수신함(DB)에 쌓지 않고 챗봇이 깔끔하게 응답만 수행
            try {
                await axios.post(url, { event: "send", user: talkId, textContent: { text: replyText } }, { headers });
            } catch (err) { console.error("FAQ 답변 발송 실패:", err); }
        } else {
            // 🚨 버튼이 아닌 진짜 고객의 수동 질문만 관리자 대시보드 팝업창에 적재!
            try {
                await WebhookCapture.findOneAndUpdate(
                    { talkId: talkId },
                    { talkId: talkId, lastMessage: text, receivedAt: Date.now() },
                    { returnDocument: 'after', upsert: true }
                );
            } catch (err) { console.error(err); }
        }
    }
    res.send({ success: true });
});
// ==========================================
// 4. 네이버 발송 
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGlLZJTC2Fj8iLTRSc';
    const headers = { 'Authorization': token, 'Content-Type': 'application/json;charset=UTF-8' };

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

// 캐러셀(슬라이드) 메뉴판 데이터
const chatbotMenuPayload = {
    event: "send",
    user: task.talkId,
    compositeContent: {
        compositeList: [
            {
                title: "해우카메라 합정점",
                description: "24시 무인보관함 운영 / 택배X",
                buttonList: [
                    { type: "TEXT", name: "주문방법" },
                    { type: "TEXT", name: "스케줄(재고) 문의" },
                    { type: "TEXT", name: "수령/반납 방법" }
                ]
            },
            {
                title: "해우카메라 합정점",
                description: "24시 무인보관함 운영 / 택배X",
                buttonList: [
                    { type: "TEXT", name: "위치/영업시간" },
                    { type: "TEXT", name: "주차안내" }
                ]
            }
        ]
    }
};

try {
    // 1타: 무인 보관함 비밀번호 문자 전송
    const response = await axios.post(url, {
        event: "send", user: task.talkId, textContent: { text: messageText }
    }, { headers: headers });

    // 2타: 문자 직후 하단에 FAQ 메뉴판을 콤보로 띄워주어 대화가 끊기지 않게 유도
    if (response.data && response.data.success) {
        await axios.post(url, {
            event: "send",
            user: task.talkId,
            compositeContent: {
                compositeList: [
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        buttonList: [
                            { type: "TEXT", name: "주문방법" },
                            { type: "TEXT", name: "스케줄(재고) 문의" },
                            { type: "TEXT", name: "수령/반납 방법" }
                        ]
                    },
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        buttonList: [
                            { type: "TEXT", name: "위치/영업시간" },
                            { type: "TEXT", name: "주차안내" }
                        ]
                    }
                ]
            }
        }, { headers: headers });
    }
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
            
            // 💡 [수정] 오차 범위 5분 -> 1분 30초 (90 * 1000 ms)로 조여서 중복 실행 방지
            if (diff <= 90 * 1000) {
                const isSent = await sendTalkMessage(task);
                task.status = isSent ? 'SENT' : 'FAILED';
                await task.save();
            }
        }
    } catch (error) { console.error(error); }
}
setInterval(checkQueue, 60000);

app.listen(process.env.PORT || 5000, () => console.log(`🚀 서버 구동 중`));