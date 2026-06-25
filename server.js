const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/images', express.static('public'));

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
    accessories: { type: [String], default: [] },
    equipment: { type: String, default: '' }, // 💡 [필수 적용] 기기명 DB 저장 칸
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

const configSchema = new mongoose.Schema({
    accessoryLockerPw: {
        type: String,
        default: ''
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const Config = mongoose.model('Config', configSchema);

// ==========================================
// 3. API 엔드포인트 (누락된 전체 라우터 완벽 복구본)
// ==========================================

// 1. 예약 명단 전체 불러오기 (새로고침 증발 방지)
app.get('/api/reservations', async (req, res) => {
    try {
        const list = await Reservation.find().sort({ reservationTime: 1 });
        res.send(list);
    } catch (error) { res.status(500).send({ success: false, error: error.message }); }
});

// 2. 명단 업로드 (상태값 절대 방어 및 서버 로그 추적 버전)
app.post('/api/reservations/upload', async (req, res) => {
    try {
        const { reservations, accessoryLockerPw } = req.body;
        const incomingUsers = reservations;

        await Config.findOneAndUpdate(
            {},
            { accessoryLockerPw, updatedAt: Date.now() },
            { upsert: true }
        );

        // =========================================================================
        // ⭐ [신규 추가] 자동 동기화 로직: 새 명단에 없는 기존 대기자(READY, SCHEDULED) 완전 삭제
        // =========================================================================
        
        // 1. 방금 업로드된 새 명단의 고유 식별값(연락처+보관함)을 배열로 만듭니다.
        const incomingKeys = incomingUsers.map(u => `${u.phone ? u.phone.trim() : ''}_${u.lockerId ? u.lockerId.trim() : ''}`);

        // 2. DB에서 발송 전인 대기자(READY, SCHEDULED)만 싹 불러옵니다. (SENT, CANCELLED는 제외하여 안전하게 보호)
        const activeReservations = await Reservation.find({ status: { $in: ['READY', 'SCHEDULED'] } });

        for (let dbUser of activeReservations) {
            const dbKey = `${dbUser.phone}_${dbUser.lockerId}`;
            
            // 3. DB에는 대기 중인데, 방금 올린 새 명단에 없다면? -> 예약이 해제된 것!
            if (!incomingKeys.includes(dbKey)) {
                // 상태 변경이 아니라 아예 DB에서 지워버립니다. (화면에서 즉시 사라짐)
                await Reservation.deleteOne({ _id: dbUser._id });
            }
        }
        // =========================================================================

        for (let user of incomingUsers) {
            // 이미 예약 시간이 지난 과거 데이터는 아예 무시
            if (new Date(user.reservationTime) < new Date()) continue;

            // 공백이나 띄어쓰기로 인한 불일치를 막기 위해 강제 트림(trim)
            const safePhone = user.phone ? user.phone.trim() : '';
            const safeLocker = user.lockerId ? user.lockerId.trim() : '';

            // 동일한 번호와 보관함으로 등록된 가장 최근 명단을 하나 찾음
            const existingReservation = await Reservation.findOne({
                phone: safePhone,
                lockerId: safeLocker
            }).sort({ createdAt: -1 });

            if (existingReservation) {
                // 💡 [절대 방어] save() 대신 updateOne()을 사용!
                // Mongoose의 다른 설정이나 톡톡 연동 조건이 개입할 틈을 주지 않고,
                // 오직 '시간, 비밀번호, 악세사리, 기기명' 딱 4가지만 강제로 업데이트함.
                console.log(`[🟢 업데이트 유지] ${user.name} 고객님 명단 발견. 현재 상태(${existingReservation.status})를 그대로 보존합니다.`);
                
                await Reservation.updateOne(
                    { _id: existingReservation._id },
                    {
                        $set: {
                            name: user.name,
                            reservationTime: new Date(user.reservationTime),
                            pw: user.pw,
                            accessories: user.accessories || [],
                            equipment: user.equipment || ''
                        }
                    }
                );
            } else {
                // 💡 [신규 등록] 기존 명단이 아예 없거나, '삭제' 버튼으로 완전히 지운 경우에만 실행
                console.log(`[🔴 신규 등록] ${user.name} 고객님의 기존 명단이 없어 새로 등록합니다.`);
                
                const matchedUser = await TalkUser.findOne({ phone: safePhone });
                const newLog = new Reservation({
                    name: user.name, 
                    phone: safePhone, 
                    reservationTime: new Date(user.reservationTime),
                    lockerId: safeLocker, 
                    pw: user.pw, 
                    accessories: user.accessories || [], 
                    equipment: user.equipment || '', 
                    talkId: matchedUser ? matchedUser.talkId : '', 
                    status: matchedUser ? 'SCHEDULED' : 'READY'   
                });
                await newLog.save();
            }
        }
        
        const updatedList = await Reservation.find().sort({ reservationTime: 1 });
        res.send({ success: true, data: updatedList });
    } catch (error) { 
        console.error("업로드 에러:", error);
        res.status(500).send({ success: false, error: error.message }); 
    }
});

// 3. 웹훅 수신함 불러오기 및 개별 삭제
app.get('/api/webhook-captures', async (req, res) => {
    try {
        const captures = await WebhookCapture.find().sort({ receivedAt: -1 }).limit(500);
        res.send(captures);
    } catch (error) { res.status(500).send({ success: false }); }
});
app.delete('/api/webhook-captures/:id', async (req, res) => {
    try {
        await WebhookCapture.findByIdAndDelete(req.params.id);
        res.send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

// 4. 톡톡 ID 연동 (복수 보관함 동시 일괄 매칭 적용 버전)
app.post('/api/scheduler/register', async (req, res) => {
    try {
        const { id, talkId } = req.body; 
        const order = await Reservation.findById(id);
        if (!order) return res.status(404).send({ success: false });

        await TalkUser.findOneAndUpdate(
            { phone: order.phone }, 
            { name: order.name, phone: order.phone, talkId: talkId, updatedAt: Date.now() },
            { returnDocument: 'after', upsert: true } 
        );

        // 동일 고객(연락처)의 대기중인 모든 보관함을 일괄 연동 처리
        await Reservation.updateMany(
            { phone: order.phone, status: 'READY' },
            { talkId: talkId, status: 'SCHEDULED' }
        );

        order.talkId = talkId;
        if (order.status === 'READY') order.status = 'SCHEDULED';
        await order.save();

        await WebhookCapture.deleteOne({ talkId });
        res.send({ success: true, data: order });
    } catch (error) { res.status(500).send({ success: false }); }
});

// 5. 발송 예약 취소 및 명단 완전 삭제 (버튼 무반응 방지)
app.post('/api/reservations/:id/cancel', async (req, res) => {
    try {
        const order = await Reservation.findById(req.params.id);
        if (order) { order.status = 'CANCELLED'; await order.save(); }
        res.send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});
app.delete('/api/reservations/:id', async (req, res) => {
    try {
        await Reservation.findByIdAndDelete(req.params.id);
        res.send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

// 6. 네이버 웹훅 처리 (채팅 봇 로직)
app.post('/webhook', async (req, res) => {
    // 🚨 [절대 방어] 네이버의 재시도(도배) 폭격을 원천 차단
    res.status(200).send({ success: true });

    try {
        const eventType = req.body.event; 
        const talkId = req.body.user;
        const token = process.env.NAVER_TALK_TOKEN; // (실전 시 꼭 환경변수 확인!)
        const url = 'https://gw.talk.naver.com/chatbot/v1/event';
        const headers = { 'Authorization': token, 'Content-Type': 'application/json;charset=UTF-8' };

        // ==========================================
        // 🛑 갈래 1: 방에 들어왔을 때 (open)
        // ==========================================
        if (eventType === 'open') {
            
            // 💡 [핵심 변경] 상품을 클릭하고 들어온 경우에'만' 상품 카드와 메뉴판을 둘 다 발송합니다.
            if (req.body.options && req.body.options.product) {
                const product = req.body.options.product;
                
                // [1] 상품 카드 발송
                try {
                    await axios.post(url, { event: "send", user: talkId, textContent: { text: "상품을 문의하셨습니다.\n어떤 점이 궁금하신가요? 😊" } }, { headers });
                    // await axios.post(url, {
                    //     event: "send", user: talkId, linkContent: {
                    //         title: product.name, description: `${Number(product.price).toLocaleString()}원`,
                    //         imageUrl: product.imageUrl, linkUrl: product.url
                    //     }
                    // }, { headers });
                } catch (err) { console.error("상품 카드 발송 실패:", err); }

                // [2] 웰컴 캐러셀 발송 (100% 작동 보장되는 1장짜리 5버튼으로 원상 복구)
                const initialFaqPayload = {
                    event: "send", 
                    user: talkId,
                    compositeContent: {
                        compositeList: [{
                            title: "해우카메라 합정점입니다 :)",
                            description: "24시 무인보관함 운영 / 택배X\n\n궁금하신 항목을 아래 버튼에서 선택해 주세요.",
                            buttonList: [
                                { type: "TEXT", data: { title: "주문방법", code: "주문방법" } },
                                { type: "TEXT", data: { title: "스케줄(재고) 문의", code: "스케줄(재고) 문의" } },
                                { type: "TEXT", data: { title: "수령/반납 방법", code: "수령/반납 방법" } },
                                { type: "TEXT", data: { title: "위치/영업시간", code: "위치/영업시간" } },
                                { type: "TEXT", data: { title: "주차안내", code: "주차안내" } }
                            ]
                        }]
                    }
                };
                
                try { await axios.post(url, initialFaqPayload, { headers }); } 
                catch (err) { console.error("캐러셀 발송 에러:", err.response ? err.response.data : err.message); }  
            }
            
            // 상품 없이 그냥 [톡톡하기]로 들어온 경우는 
            // 위 if문에 걸리지 않으므로 아무것도 보내지 않고 조용히 종료됩니다.
            return; 
        }    
        
        // ==========================================
        // 🛑 갈래 2: 고객이 "대화"를 입력했을 때 (send)
        // ==========================================
        if (eventType === 'send' && req.body.textContent) {

    // ==========================================
    // 상품 페이지 → 톡톡하기 → "이 상품을 문의합니다."
    // ==========================================
    if (
        req.body.textContent?.inputType === 'product' &&
        req.body.options?.product
    ) {
        console.log('🔥 상품문의 감지');

        const initialFaqPayload = {
            event: "send",
            user: talkId,
            compositeContent: {
                compositeList: [{
                    title: "해우카메라 합정점입니다 :)",
                    description: "24시 무인보관함 운영 / 택배X\n\n궁금하신 항목을 아래 버튼에서 선택해 주세요.",
                    buttonList: [
                        {
                            type: "TEXT",
                            data: {
                                title: "주문방법",
                                code: "주문방법"
                            }
                        },
                        {
                            type: "TEXT",
                            data: {
                                title: "스케줄(재고) 문의",
                                code: "스케줄(재고) 문의"
                            }
                        },
                        {
                            type: "TEXT",
                            data: {
                                title: "수령/반납 방법",
                                code: "수령/반납 방법"
                            }
                        },
                        {
                            type: "TEXT",
                            data: {
                                title: "위치/영업시간",
                                code: "위치/영업시간"
                            }
                        },
                        {
                            type: "TEXT",
                            data: {
                                title: "주차안내",
                                code: "주차안내"
                            }
                        }
                    ]
                }]
            }
        };

        try {
            const result = await axios.post(
                url,
                initialFaqPayload,
                { headers }
            );

            console.log("✅ FAQ 캐러셀 발송 성공");
            console.log(result.data);
        } catch (err) {
            console.error(
                "❌ FAQ 캐러셀 발송 실패",
                err.response?.data || err.message
            );
        }
    }

    const text = req.body.textContent.text.trim();
    let replyText = "";

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

    else if (text === "스케줄(재고) 문의") {
        replyText = `📝 [스케줄(재고) 문의]

아래의 양식으로 문의 남겨주세요.
(24시간 무인매장, 택배/퀵 불가)

수령 : O월 O일 OO시
반납 : O월 O일 OO시
(00시~24시 / 24시간 표시)

🗨️ 네이버톡톡 상담시간
평일 10~18시 실시간 상담
(그 외 시간 순차적 상담)`;
    }

    else if (text === "수령/반납 방법") {
        replyText = `📦 [수령/반납 방법]

스케줄 상담 후 예약이 확정되면
수령 전 네이버톡톡으로
자세한 안내를 드립니다.

🌟 24시 무인 보관함으로 운영되어
예약 시간 내에는 편하게 이용하실 수 있습니다.`;
    }

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

    else if (text === "주차안내") {
        replyText = `🚗 [주차안내]

📍 서울 마포구 양화로 45
메세나폴리스 지하주차장

✅ 셀프 주차 등록
3시간 무료 주차 가능
(매장 내 QR코드 인식 후
차량번호 뒤 4자리 입력)`;
    }

    if (replyText !== "") {

        try {
            await axios.post(
                url,
                {
                    event: "send",
                    user: talkId,
                    textContent: {
                        text: replyText
                    }
                },
                { headers }
            );
        } catch (err) {
            console.error("자동답변 발송 실패:", err);
        }

    } else {

        // ==========================================
        // 웹훅 캡처 유지
        // ==========================================
        try {
            await WebhookCapture.findOneAndUpdate(
                { talkId: talkId },
                {
                    talkId: talkId,
                    lastMessage: text,
                    receivedAt: Date.now()
                },
                {
                    returnDocument: 'after',
                    upsert: true
                }
            );
        } catch (err) {
            console.error("DB 수집 실패:", err);
        }
    }

    return;
}
} catch (error) {
    console.error("서버 내부 에러:", error);
 }   // try 종료
 
 }); // webhook 종료

// ==========================================
// 4. 네이버 발송 
// ==========================================
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = process.env.NAVER_TALK_TOKEN;
    const headers = { 'Authorization': token, 'Content-Type': 'application/json;charset=UTF-8' };
    // 악세사리 항목 추가 (보조배터리 / 리더기)
    const accessories = task.accessories || [];
    const hasTripodGuide = accessories.some(a => a.includes('삼각대'));
    // const accessoryTypes = [];

    // if (accessories.some(a => a.includes('리더기'))) {
    //     accessoryTypes.push('리더기');
    // }

    // if (accessories.some(a => a.includes('보조배터리'))) {
    //     accessoryTypes.push('보조배터리');
    // }

    // const accessoryType = accessoryTypes.join(', ');
    // const hasAccessoryGuide = accessoryTypes.length > 0;

    const config = await Config.findOne();

const accessoryPw =
    config?.accessoryLockerPw || '확인필요';

    // 10000번 이상 여부를 체크하는 변수를 하나 만들고 적용합니다.
    const displayLocker = Number(task.lockerId) >= 10000 ? '[외부 보관]' : `[${task.lockerId}번] 보관함 (비밀번호 : [${task.pw}])`;
    
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
보관함 정보 : ${displayLocker}
🚨 절대 다이얼 비밀번호를 변경하지 말아주세요.

반납 방법 : 수령 시와 동일한 비밀번호로 문을 열고 반납해 주세요.
* 문이 잘 안 열리거나 안 잠긴다면 꾹 누르면서 다이얼을 돌려주시면 됩니다.

📸 4. 사진 전송 (필수)
수령할 때 1장 / 반납할 때 1장
물품 전체 구성품 사진을 찍어 **톡톡**으로 보내주세요.

⚠️ 장비 및 구성품 확인
장비 및 기본 구성품은 반드시 매장 내에서 직접 확인 부탁드립니다.
무인 운영 특성상 매장 퇴장 후 확인되는 구성품 누락에 대해서는 책임지기 어려운 점 양해 부탁드립니다.

☎️ 비상 연락처 : 010-4607-0732`;

// 캐러셀(슬라이드) 메뉴판 데이터
const chatbotMenuPayload = {
    event: "send",
    user: task.talkId,
    compositeContent: {
        compositeList: [
            {
                title: "해우카메라 합정점",
                description: "24시 무인보관함 운영 / 택배X\n\n궁금하신 항목을 아래 버튼에서 선택해 주세요.",
                buttonList: [
                    {
                        type: "TEXT",
                        data: {
                            title: "주문방법",
                            code: "주문방법"
                        }
                    },
                    {
                        type: "TEXT",
                        data: {
                            title: "스케줄(재고) 문의",
                            code: "스케줄(재고) 문의"
                        }
                    },
                    {
                        type: "TEXT",
                        data: {
                            title: "수령/반납 방법",
                            code: "수령/반납 방법"
                        }
                    },
                    {
                        type: "TEXT",
                        data: {
                            title: "위치/영업시간",
                            code: "위치/영업시간"
                        }
                    },
                    {
                        type: "TEXT",
                        data: {
                            title: "주차안내",
                            code: "주차안내"
                        }
                    }
                ]
            }
        ]
    }
};

try {
    // 무인 보관함 비밀번호 문자 전송
    const response = await axios.post(url, {
        event: "send", user: task.talkId, textContent: { text: messageText }
    }, { headers: headers });

    // 삼각대 발송
if (response.data && response.data.success && hasTripodGuide) {

    const tripodMessage = `삼각대는 외부에 보관되어 직접 1개 수령 후 반납 시 빈자리에 넣어주시고 인증사진 남겨주시면 됩니다.`;

    await axios.post(url, {
        event: "send",
        user: task.talkId,
        textContent: {
            text: tripodMessage
        }
    }, { headers });

    try {

            // 이미지 발송
            await axios.post(url, {
                event: "send",
                user: task.talkId,
                imageContent: {
                    imageUrl: "https://haewoo-talk-auto.onrender.com/images/tripod.jpg"
                }
            }, { headers });

            console.log(`🖼️ 이미지 발송 성공: ${task.name}`);

        } catch (imgError) {

            console.error(
                "🖼️ 이미지 발송 실패:",
                imgError.response?.data || imgError.message
            );

        }
    }
    return response.data.success;
} catch (error) {
    console.error(
        "캐러셀 발송 실패:",
        error.response?.status,
        JSON.stringify(error.response?.data, null, 2)
    );

    return false;
    }
}

app.listen(process.env.PORT || 5000, () => console.log(`🚀 서버 구동 중`));

// ==========================================
// 5. 크론(Cron) 스케줄러 - 1분마다 발송 대상 탐색
// ==========================================
const cron = require('node-cron');

// 💡 1분마다 실행
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        // 타겟 시간: 지금으로부터 정확히 30분 뒤
        const targetTime = new Date(now.getTime() + 30 * 60 * 1000); 

        // 🚨 [핵심 수정] 예약 시간이 '지금 ~ 30분 뒤' 사이로 임박했는데, 상태가 SCHEDULED인 건을 싹 다 찾음!
        // (즉, 30분 전에 딱 맞춰 올리지 않고 13분 전에 지각 업로드/매칭을 해도 즉시 발견해 냄)
        const ordersToProcess = await Reservation.find({
            status: 'SCHEDULED',
            reservationTime: { $lte: targetTime, $gte: now } 
        });

        if (ordersToProcess.length > 0) {
            console.log(`[스케줄러] ${ordersToProcess.length}건의 발송 대상을 발견했습니다.`);
        }

        for (let order of ordersToProcess) {
            console.log(`[발송 시도] ${order.name} 고객님 - 보관함 ${order.lockerId}`);
            
            // 하단에 만들어두신 네이버 톡톡 발송 함수 호출
            const success = await sendTalkMessage(order); 
            
            if (success) {
                // 발송 성공 시 상태를 SENT로 변경하여 중복 발송 영구 차단
                order.status = 'SENT';
                await order.save();
                console.log(`✅ [발송 성공] ${order.name} - 보관함 ${order.lockerId}`);
            } else {
                console.error(`❌ [발송 실패] ${order.name}`);
            }
        }
    } catch (error) {
        console.error("스케줄러 엔진 에러:", error);
    }
});