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
// 3. API 엔드포인트 (예외 처리 고도화 버전)
// ==========================================

// 1️⃣ 명단 업로드 API (지나간 예약 시간 필터링 추가)
app.post('/api/reservations/upload', async (req, res) => {
    try {
        const incomingUsers = req.body; 
        const incomingLockerIds = [...new Set(incomingUsers.map(u => u.lockerId))];

        await Reservation.deleteMany({
            lockerId: { $in: incomingLockerIds },
            status: { $ne: 'SENT' }
        });

        for (let user of incomingUsers) {
            // 💡 [추가] 예약 시간이 현재 시간보다 과거인 경우 불러오지 않고 건너뜀
            if (new Date(user.reservationTime) < new Date()) {
                continue;
            }

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

// 2️⃣ 톡톡 ID 연동 API (동일 고객 복수 보관함 일괄 매칭 수정)
app.post('/api/scheduler/register', async (req, res) => {
    try {
        const { id, talkId } = req.body; 
        const order = await Reservation.findById(id);
        if (!order) return res.status(404).send({ success: false });

        // 1. 단골 장부(TalkUser) 저장 또는 갱신
        await TalkUser.findOneAndUpdate(
            { phone: order.phone }, 
            { name: order.name, phone: order.phone, talkId: talkId, updatedAt: Date.now() },
            { returnDocument: 'after', upsert: true } 
        );

        // 2. 💡 [수정] 동일한 연락처(phone)를 가진 대기중(READY) 상태의 모든 예약 건을 찾아 한 번에 연동
        await Reservation.updateMany(
            { phone: order.phone, status: 'READY' },
            { talkId: talkId, status: 'SCHEDULED' }
        );

        // 3. 선택한 타겟 예약 건 개별 반영 (확실한 정합성 보장)
        order.talkId = talkId;
        if (order.status === 'READY') {
            order.status = 'SCHEDULED';
        }
        await order.save();

        await WebhookCapture.deleteOne({ talkId });
        res.send({ success: true, data: order });
    } catch (error) { 
        console.error(error);
        res.status(500).send({ success: false }); 
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
        
        // 📋 [FAQ 캐러셀 완벽 복원] - 네이버 API 전용 버튼 규격 적용 완료
        const initialFaqPayload = {
            event: "send",
            user: talkId,
            compositeContent: {
                compositeList: [
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        // 💡 카카오가 아닌 네이버 전용 규격(data: { title, code })으로 완벽 교체!
                        buttonList: [
                            { type: "TEXT", data: { title: "주문방법", code: "주문방법" } },
                            { type: "TEXT", data: { title: "스케줄(재고) 문의", code: "스케줄(재고) 문의" } },
                            { type: "TEXT", data: { title: "수령/반납 방법", code: "수령/반납 방법" } }
                        ]
                    },
                    {
                        title: "해우카메라 합정점",
                        description: "24시 무인보관함 운영 / 택배X",
                        buttonList: [
                            { type: "TEXT", data: { title: "위치/영업시간", code: "위치/영업시간" } },
                            { type: "TEXT", data: { title: "주차안내", code: "주차안내" } }
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
    // 💡 2. 고객이 메시지를 전송했거나 FAQ 버튼을 눌렀을 때 (send 이벤트)
    if (eventType === 'send' && req.body.textContent) {
        const text = req.body.textContent.text.trim();
        
        let replyText = "";

        // 1️⃣ 주문방법 (번호 이모지와 굵은 느낌의 기호 사용)
        if (text === "주문방법") {
            replyText = `📢 [주문방법]
상담 → 결제 → 확정 → 대여·반납

1️⃣ 스케줄 문의 (필수)
네이버톡톡으로 수령/반납
일자, 시간을 정확히 말씀주셔야
스케줄 확인이 가능합니다.
⚠️ 미상담 결제 시 통보 없이 취소

2️⃣ 결제
결제순으로 예약마감이 되므로
상담 후 빠르게 결제 완료해주세요.

3️⃣ 전자계약서 작성 & 예약확정
실명 및 신용증명 확인 절차
카카오톡 [픽스]로 발송되며
작성 후 예약이 확정됩니다.`;
        }

        // 2️⃣ 스케줄(재고) 문의 (입력 양식 강조)
        else if (text === "스케줄(재고) 문의") {
            replyText = `📝 [스케줄(재고) 문의]

아래의 양식으로 문의 남겨주세요.
(택배/퀵 대여 불가)

수령 : O월 O일 OO시
반납 : O월 O일 OO시
(00시~24시 / 24시간 표시)

🗨️ 네이버톡톡 상담시간
평일 10~18시 실시간 상담
(그 외 시간 순차적 상담)`;
        }

        // 3️⃣ 수령/반납 방법 (별 이모지 강조)
        else if (text === "수령/반납 방법") {
            replyText = `📦 [수령/반납 방법]

스케줄 상담 후 예약이 확정되면
수령 전 네이버톡톡으로
자세한 안내를 드립니다.

🌟 24시 무인 보관함으로 운영되어
예약 시간 내에는 편하게 이용하실 수 있습니다.`;
        }

        // 4️⃣ 위치/영업시간 (지도 및 시계 이모지)
        else if (text === "위치/영업시간") {
            replyText = `📍 [위치]
서울 마포구 양화로 45
메세나폴리스 116호 해우카메라
(합정역 6호선 10번 출구 도보 1분)

🕒 [영업시간]
365일 24시간 연중무휴
무인보관함 수령/반납
* 상담 가능 시간은 평일 10~18시입니다.`;
        }

        // 5️⃣ 주차안내 (주차장 위치 및 무료 등록 강조)
        else if (text === "주차안내") {
            replyText = `🚗 [주차안내]

📍 서울 마포구 양화로 45
메세나폴리스 지하주차장

✅ 셀프 주차 등록
3시간 무료 주차 가능
(매장 내 QR코드 인식 후
차량번호 뒤 4자리 입력)`;
        }

        // [자동응답 발송 로직]
        if (replyText !== "") {
            try {
                await axios.post(url, { event: "send", user: talkId, textContent: { text: replyText } }, { headers });
            } catch (err) { console.error("FAQ 답변 발송 실패:", err); }
        } else {
            // 🚨 버튼이 아닌 진짜 고객의 질문만 관리자 대시보드 팝업창에 적재!
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