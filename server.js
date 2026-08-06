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
    receivedAt: { 
        type: Date, 
        default: Date.now,
        expires: '30d' // 💡 데이터 생성 후 30일이 지나면 MongoDB가 백그라운드에서 자동 삭제
    }
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
                
                // const matchedUser = await TalkUser.findOne({ phone: safePhone });
                const newLog = new Reservation({
                    name: user.name, 
                    phone: safePhone, 
                    reservationTime: new Date(user.reservationTime),
                    lockerId: safeLocker, 
                    pw: user.pw, 
                    accessories: user.accessories || [], 
                    equipment: user.equipment || '', 
                    // talkId: matchedUser ? matchedUser.talkId : '', 
                    // status: matchedUser ? 'SCHEDULED' : 'READY'
                    talkId: '', 
                    status: 'READY'   
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
        const captures = await WebhookCapture.find().sort({ receivedAt: -1 }).limit(1000);
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

        // await WebhookCapture.deleteOne({ talkId }); // 수동 매칭 이후에도 수신함 캡쳐 데이터가 사라지지 않도록 변경
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
수령/반납 일자, 시간을
톡톡으로 정확히 말씀주셔야
스케줄 확인이 가능합니다.
⚠️ 미상담 결제 시 통보 없이 취소

2️⃣ 결제
실시간으로 예약을 받고 있으므로
문의 후 바로 결제 해주셔야 합니다.

3️⃣ 전자계약서 작성 & 예약확정
실명 및 신용증명 확인 절차
카카오톡 [픽스]로 발송되며
서류확인 순으로 예약이 확정됩니다.`;
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

* 오시는길 상세페이지에 안내

🕒 [영업시간]
365일 24시간 연중무휴`;
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

    } 
    
    // else {

    //     // ==========================================
    //     // 웹훅 캡처 유지
    //     // ==========================================
    //     try {
    //         await WebhookCapture.findOneAndUpdate(
    //             { talkId: talkId },
    //             {
    //                 talkId: talkId,
    //                 lastMessage: text,
    //                 receivedAt: Date.now()
    //             },
    //             {
    //                 returnDocument: 'after',
    //                 upsert: true
    //             }
    //         );
    //     } catch (err) {
    //         console.error("DB 수집 실패:", err);
    //     }
    // }
    // ==========================================
    // 웹훅 캡처 유지 (자동답변 발생 유무와 상관없이 무조건 캡처)
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
    const hasTripodGuide = accessories.some(a => 
        a.includes('삼각대') && 
        !a.includes('쇼티 삼각대') && 
        !a.includes('미니 삼각대')
        );

    // =========================================================
    // 💡 [수정] 다중 기기 주문 시 모든 기기의 이미지 URL을 담는 로직
    // =========================================================
    // 💡 [추가 방어] 묶음 발송 시 task.formattedLockers 안에 기기명이 들어가므로 두 곳 모두 검사하도록 수정
    const equipmentStr = task.equipment || task.formattedLockers || '';
    const equipmentImageUrls = []; // 여러 장을 담기 위해 배열([ ])로 변경

    // 나머지는 서로 간섭하지 않도록 전부 독립된 'if'문으로 분리합니다.
    if (equipmentStr.includes('스탠바이미 GO')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/standbymego.jpg');
    if (equipmentStr.includes('스탠바이미2')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/standbyme2.jpg');
    if (equipmentStr.includes('파티박스 320')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/partybox320.jpg');
    if (equipmentStr.includes('CP1500')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/cp1500.jpg');
    //if (equipmentStr.includes('아마란')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/amaran300c.jpg');
    //if (equipmentStr.includes('어벤저')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/avenger.jpg');
    if (equipmentStr.includes('브리츠')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/britz.jpg');
    //if (equipmentStr.includes('프리스타일')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/freestyle.jpg');
    //if (equipmentStr.includes('E6')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/e6.jpg');
    //if (equipmentStr.includes('HF65LA')) equipmentImageUrls.push('https://haewoo-talk-auto.onrender.com/images/hf65la.jpg');
    // =========================================================

    const config = await Config.findOne();

    const accessoryPw =
        config?.accessoryLockerPw || '확인필요';

    // 💡 [수정] 스케줄러에서 만든 다중 보관함 텍스트가 있으면 그대로 출력하고, 없다면 단건 포맷으로 방어합니다.
    let displayLockerList = "";
    if (task.formattedLockers) {
        displayLockerList = task.formattedLockers;
    } else {
        const isExternal = Number(task.lockerId) >= 10000;
        displayLockerList = isExternal ? '[외부 보관]' : `[${task.lockerId}번] 보관함 (비밀번호 : [${task.pw}])`;
    }
    
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
${displayLockerList}

🚨 절대 다이얼 비밀번호를 변경하지 말아주세요.

반납 방법 : 수령 시와 동일한 비밀번호로 문을 열고 반납해 주세요.
* 문이 잘 안 열리거나 안 잠긴다면 꾹 누르면서 다이얼을 돌려주시면 됩니다.

📸 4. 사진 전송 (필수)
수령할 때 1장 / 반납할 때 1장
물품 전체 구성품 사진을 찍어 **톡톡**으로 보내주세요.

⚠️ 장비 및 구성품 확인
장비 및 기본 구성품은 반드시 매장 내에서 직접 확인 부탁드립니다.
무인 운영 특성상 매장 퇴장 후 확인되는 구성품 누락에 대해서는 책임지기 어려운 점 양해 부탁드립니다.

☎️ 비상 연락처 : 0507-1463-0833`;

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

    const tripodMessage = `삼각대는 외부에 보관되어 직접 1개 수령 후 반납 시 빈자리에 넣어주시고 인증사진 남겨주시면 됩니다.
    ⚠️수령/반납시 삼각대 플레이트 꼭 확인 부탁드립니다.`;

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

    // =========================================================
    // 💡 [신규] 배열에 담긴 기기 수만큼 반복해서 이미지를 개별 발송하는 로직
    // =========================================================
    if (response.data && response.data.success && equipmentImageUrls.length > 0) {
        // 배열 안에 담긴 이미지 주소를 하나씩 꺼내서 전부 발송합니다.
        for (const imgUrl of equipmentImageUrls) {
            try {
                await axios.post(url, {
                    event: "send",
                    user: task.talkId,
                    imageContent: {
                        imageUrl: imgUrl
                    }
                }, { headers });

                console.log(`🖼️ 기기 이미지 발송 성공: ${task.name} (${imgUrl})`);
            } catch (equipImgError) {
                console.error(
                    "🖼️ 기기 이미지 발송 실패:",
                    equipImgError.response?.data || equipImgError.message
                );
            }
        }
    }
    // =========================================================

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

// 💡 [커스텀 구역] 기기명 단축 사전
// 좌측엔 명단에 적힌 '원래 이름'을, 우측엔 모바일로 나갈 '짧은 이름'을 적어주세요.
// 여기에 없는 기기명은 명단에 적힌 원래 이름 그대로 발송됩니다.
const customDictionary = {
    // ==========================================
    // 스마트폰
    // ==========================================
    "갤럭시 S22 울트라 256GB 단기 12시간 24시간": "S22U",
    "갤럭시 S23 울트라 512GB 단기 12시간 24시간": "S23U",
    "갤럭시 S24 울트라 512GB 단기 12시간 24시간": "S24U",
    "갤럭시 S25 울트라 512GB 단기 12시간 24시간": "S25U",
    "갤럭시 S26 울트라 512GB 단기 12시간 24시간": "S26U",
    "아이폰 17 프로 256GB 12시간 24시간": "아이폰17 pro",
    // ==========================================
    // 캐논 미러리스 크롭 (바디 & 렌즈)
    // ==========================================
    "캐논 EOS R7 미러리스 카메라": "R7",
    "캐논 EOS R50V 14-30mm KIT 카메라": "R50V + 14-30mm",
    "캐논 EOS M50 Mark II + 15-45mm 번들렌즈": "M50 mark2 + 15-45mm",
    "캐논 EOS M200 + 15-45mm 번들렌즈 KIT": "M200 + 15-45mm",
    "캐논 EOS R50 18-45mm KIT 카메라": "R50 + 18-45mm",
    "캐논 EOS M50 + 15-45mm 번들렌즈 KIT": "M50 + 15-45mm",
    "캐논 EOS R10 미러리스 카메라": "R10",
    "캐논 EOS M100 15-45mm KIT 카메라": "M100 + 15-45mm",
    "캐논 RF-S 55-210mm F5-7.1 IS STM": "RF-S 55-210mm",
    "캐논 EF-M 11-22mm F4-5.6 IS STM": "EF-M 11-22mm",
    "캐논 EF-M 32mm F1.4 STM 렌즈": "EF-M 32mm",
    "캐논 EF-M 18-150mm F3.5-6.3 IS STM": "EF-M 18-150mm",
    "캐논 RF-S 10-18mm F4.5-6.3 IS STM": "RF-S 10-18mm",
    "캐논 RF-S 18-150mm F3.5-6.3 IS STM": "RF-S 18-150mm",
    "캐논 EF-M 55-200mm F4.5-6.3 IS STM": "EF-M 55-200mm",
    "캐논 EF-M 22mm F2 STM 렌즈": "EF-M 22mm",
    // ==========================================
    // 캐논 미러리스 풀프레임 (바디 & 렌즈)
    // ==========================================
    "캐논 EOS R6 Mark III R6M3 알육막삼": "R6M3",
    "캐논 EOS R6 V 미러리스 카메라": "R6V",
    "캐논 EOS R5 미러리스 카메라": "R5",
    "캐논 EOS R6 Mark II R6M2 알육막투": "R6M2",
    "캐논 EOS R6 미러리스 카메라": "R6",
    "캐논 EOS R8 미러리스 카메라": "R8",
    "캐논 EOS R 미러리스 카메라": "R",
    "캐논 EOS RP 미러리스 카메라": "RP",
    "캐논 RF 70200 F2.8 L IS USM 알아빠": "RF 70-200mm",
    "RF100-500mm F4.5-7.1L IS 백오백 팬미팅 콘서트": "RF 100-500mm",
    "RF 200-800mm F6.3-9 IS USM 초망원 줌렌즈": "RF 200-800mm",
    "캐논 RF 50mm F1.2 L USM 알오이 렌즈": "RF 50mm",
    "캐논 RF 85mm F1.2 L USM 알만두 렌즈": "RF 85mm",
    "캐논 RF 24-70mm F2.8 L IS 알계륵 렌즈": "RF 24-70mm",
    "캐논 RF 70 200mm F4 L IS USM 알형아": "RF 70-200mm",
    "캐논 RF 100mm F2.8 L MACRO IS 알백마": "RF 100mm",
    "캐논 RF 28-70mm F2.8 IS STM 렌즈": "RF 28-70mm",
    "캐논 RF 50mm F1.4 L VCM 표준 단렌즈": "RF 50mm F1.4",
    "캐논 RF 20-50mm F4 L IS USM PZ 표준 렌즈": "RF 20-50mm",
    "캐논 RF 24-105mm F4L IS USM 렌즈": "RF 24-105mm",
    "캐논 RF 24-240mm F4-6.3 IS USM 렌즈": "RF 24-240mm",
    "캐논 RF 100-400mm F5.6-8 IS USM 알백사": "RF 100-400mm",
    "캐논 RF 24mm F1.8 MACRO IS STM 렌즈": "RF 24mm",
    "캐논 RF 24-105mm F4-7.1 IS STM 렌즈": "RF 24-105mm STM",
    "캐논 RF 85mm F2 Macro IS STM 렌즈": "RF 85mm F2 Macro",
    "캐논 RF 35mm F1.8 MACRO IS STM 렌즈": "RF 35mm F1.8 Macro",
    "캐논 RF 28mm F2.8 STM 렌즈": "RF 28mm F2.8",
    "캐논 RF 24-50mm F4.5-6.3 IS STM": "RF 24-50mm",
    "캐논 RF 50mm F1.8 STM 렌즈": "RF 50mm F1.8",
    "캐논 RF 16mm F2.8 STM 광각 렌즈": "RF 16mm F2.8",

    // ==========================================
    // 소니 미러리스 크롭
    // ==========================================
    "소니 ILME-FX30B FX30 슈퍼 35 시네마 카메라": "FX30",
    "소니 A6700 + 16-50mm 번들렌즈 KIT": "A6700 + 16-50mm",
    "소니 ZV-E10 II 미러리스 카메라 브이로그 유튜브": "ZV-E10 II",
    "소니 A6400+16-50mm 번들렌즈 KIT 24시간": "A6400 + 16-50mm",
    "소니 A6500 + 16-50mm 번들렌즈 KIT": "A6500 + 16-50mm",
    "소니 A6100 + 16-50mm 번들렌즈 KIT": "A6100 + 16-50mm",
    "소니 ZV-E10 미러리스 카메라 브이로그 유튜브": "ZV-E10",
    "소니 A6000 + 16-50mm 번들렌즈 KIT": "A6000 + 16-50mm",
    "탐론 17-70mm F2.8 Di III-A VC RXD": "탐론 17-70mm",
    "소니 E 11mm F1.8 SEL11F18 렌즈": "소니E 11mm F1.8",
    "소니 E 18-135mm F3.5-5.6 SEL18135": "소니E 18-135mm",
    "소니 E 24mm F1.8 SEL24F18Z 칼이사": "소니E 24mm F1.8 칼이사",
    "소니 E 10-18mm F4 SEL1018": "소니E 10-18mm F4",
    "시그마 C 16mm F1.4 DC DN 소니 E 렌즈": "시그마C 16mm F1.4",
    "소니 E PZ 18-105mm F4 G OSS SELP18105G": "소니E PZ 18-105mm F4 G OSS",
    "삼양 8mm F2.8 UMC 소니 E용 렌즈": "삼양 8mm F2.8 UMC",
    "삼양 12mm F2 NCS CS 소니E용 렌즈": "삼양 12mm F2 NCS CS",
    "시그마 30mm F1.4 DC DN 소니 E 삼식이 렌즈": "시그마 30mm F1.4 DC DN",
    "소니 E 35mm F1.8 SEL35F18 카페렌즈": "소니E 35mm F1.8",
    "소니 55-210mm F4.5-6.3 SEL55210": "소니E 55-210mm F4.5-6.3",
    "소니 E 20mm F2.8 SEL20F28 셀카렌즈": "소니E 20mm F2.8",
    "소니 E 30mm F3.5 Macro SEL30M35 렌즈": "소니E 30mm F3.5 Macro",
    "소니 E 50mm F1.8 SEL50F18 여친렌즈": "소니E 50mm F1.8",

    // ==========================================
    // 소니 미러리스 풀프레임
    // ==========================================
    "소니 ILME-FX3A FX3 풀프레임 시네마 캠코더": "FX3",
    "소니 ILME-FX2 FX2 풀프레임 시네마 캠코더": "FX2",
    "소니 ILCE-7M5 A7M5 A7V 미러리스 카메라": "A7V",
    "소니 ILCE-7CR A7CR 카메라 바디": "A7CR",
    "소니 ILCE-7SM3 A7S3 미러리스 카메라 바디": "A7S3",
    "소니 ILCE-7RM4A A7R IV A7R4 바디": "A7R4",
    "소니 ILCE-7CM2 A7C2 A7C II 카메라": "A7C2",
    "소니 ILCE-7M4 A7M4 미러리스 카메라": "A7M4",
    "소니 ILCE-7RM3 A7R3 A7R lll 바디": "A7R3",
    "소니 ILCE-7M3 A7M3 A7M III 바디": "A7M3",
    "소니 ILCE-7C A7C 카메라 바디": "A7C",
    "소니 FE 50mm F1.2 GM SEL50F12GM 오이금": "FE 50mm F1.2 GM",
    "소니 FE 200-600mm F5.6-6.3 G OSS": "FE 200-600mm G OSS",
    "탐론 35-150mm F2-2.8 Di III VXD 소니FE용": "탐론 35-150mm",
    "소니 FE 85mm F1.4 GM II SEL85F14GM2": "FE 85mm F1.4 GM II",
    "FE 24-70mm F2.8 GM II 2470GM2 금계륵2": "FE 24-70mm F2.8 GM II",
    "소니 FE 100-400mm F4.5-5.6 GM OSS 백사금": "FE 100-400mm F4.5-5.6 GM OSS",
    "FE 16-35mm F2.8 GM OSS II SEL1635GM2": "FE 16-35mm F2.8 GM OSS II",
    "소니 FE 70-200mm F2.8 GM II SEL70200GM2": "FE 70-200mm F2.8 GM II",
    "소니 FE 135mm F1.8 GM SEL135F18GM": "FE 135mm F1.8 GM",
    "소니 FE 24-70mm F2.8 GM SEL2470GM 금계륵": "FE 24-70mm F2.8 GM",
    "소니 FE 85mm F1.4 GM SEL85F14GM": "FE 85mm F1.4 GM",
    "소니 FE 70-200mm F2.8 GM OSS SEL70200GM": "FE 70-200mm F2.8 GM OSS",
    "소니 FE 35mm F1.4 GM SEL35F14GM": "FE 35mm F1.4 GM",
    "탐론 50-400mm F4.5-6.3 A067 소니FE용": "탐론 50-400mm",
    "소니 FE 70-200mm F4 G OSS II 70200G2": "FE 70-200mm F4 G OSS II",
    "소니 FE 20-70mm F4 G SEL2070G 렌즈": "FE 20-70mm F4 G",
    "탐론 150-500mm F5-6.7 A057 소니FE용": "탐론 150-500mm",
    "소니 FE 14mm F1.8 GM SEL14F18GM": "FE 14mm F1.8 GM",
    "소니 FE 24-105mm F4 G OSS SEL24105G": "FE 24-105mm F4 G OSS",
    "소니 FE 24mm F1.4 GM SEL24F14GM": "FE 24mm F1.4 GM",
    "소니 FE 16-35mm F2.8 GM SEL1635GM": "FE 16-35mm F2.8 GM",
    "소니 FE 70-200mm F4 G OSS SEL70200G": "FE 70-200mm F4 G OSS",
    "소니 FE 90mm F2.8 Macro G OSS SEL90M28G": "FE 90mm F2.8 Macro G OSS",
    "소니 FE 16-35mm F4 ZA OSS SEL1635Z": "FE 16-35mm F4 ZA OSS",
    "탐론 28-75mm F2.8 Di III G2 소니FE용": "탐론 28-75mm G2",
    "시그마 A 24-70mm F2.8 DG DN 소니FE용": "시그마 A 24-70mm F2.8",
    "시그마 C 100-400mm F5-6.3 DG DN OS 소니FE용": "시그마 C 100-400mm F5-6.3",
    "탐론 17-28mm F2.8 Di III RXD 소니FE용": "탐론 17-28mm F2.8",
    "탐론 20-40mm F2.8 Di III VXD 소니FE용": "탐론 20-40mm F2.8",
    "탐론 28-200mm F2.8-5.6 Di III RXD 소니FE용": "탐론 28-200mm",
    "소니 FE 24-70mm F4 ZA OSS SEL2470Z": "FE 24-70mm F4 ZA OSS",
    "소니 FE 55mm F1.8 ZA SEL55F18Z 렌즈": "FE 55mm F1.8 ZA",
    "소니 FE 24mm F2.8 G SEL24F28G 렌즈": "FE 24mm F2.8 G",
    "소니 FE 50mm F2.5 G SEL50F25G 렌즈": "FE 50mm F2.5 G",
    "소니 FE 85mm F1.8 SEL85F18 렌즈": "FE 85mm F1.8",
    "소니 FE 28mm F2.0 SEL28F20 단렌즈": "FE 28mm F2.0",
    "소니 FE 35mm F1.8 SEL35F18F 렌즈": "FE 35mm F1.8",
    "소니 FE 50mm F1.8 SEL50F18F 렌즈": "FE 50mm F1.8",
    "소니 FE 28-70mm F3.5-5.6 OSS SEL2870": "FE 28-70mm F3.5-5.6 OSS",
    // ==========================================
    // 후지 미러리스 & X시리즈
    // ==========================================
    "후지필름 X-E5 + XF23mm 번들렌즈 KIT": "X-E5 + XF23mm",
    "후지필름 X-T5 카메라 바디": "X-T5",
    "후지필름 X-H2 카메라 바디": "X-H2",
    "후지필름 X-E5 카메라 바디": "X-E5",
    "후지필름 X-T30 III + XF 13-33mm 번들렌즈 KIT": "X-T30 III + XF 13-33mm",
    "후지필름 X-M5 + XF 15-45mm 번들렌즈 KIT": "X-M5 + XF 15-45mm",
    "후지필름 X-S20 카메라 바디": "X-S20",
    "후지필름 X-T30 II + XF 18-55mm 번들렌즈 KIT": "X-T30 II + XF 18-55mm",
    "후지필름 X-T50 카메라 바디": "X-T50",
    "후지필름 X-T4 카메라 바디": "X-T4",
    "후지필름 XF 16-55 II F2.8 R LM WR": "XF 16-55 II F2.8",
    "후지필름 XF 50-140mm F2.8 R LM OIS WR": "XF 50-140mm F2.8",
    "후지필름 XF 8-16mm F2.8 R LM WR 렌즈": "XF 8-16mm F2.8",
    "후지필름 XF 33mm F1.4 R LM WR 렌즈": "XF 33mm F1.4",
    "후지필름 XF 70-300mm F4-5.6 R LM OIS WR": "XF 70-300mm F4-5.6",
    "후지필름 XF 16-55mm F2.8 R LM WR 렌즈": "XF 16-55mm F2.8",
    "후지필름 XF 16-50mm F2.8-4.8 R LM WR": "XF 16-50mm F2.8-4.8",
    "후지필름 XF 18-120mm F4 LM PZ WR 렌즈": "XF 18-120mm F4 LM PZ WR",
    "후지필름 XF 23mm F1.4 R WR LM 렌즈": "XF 23mm F1.4 R WR LM",
    "후지필름 XF 18-55mm F2.8-4 R LM OIS 렌즈": "XF 18-55mm F2.8-4 R LM OIS",
    "후지필름 X100F 필카 감성 카메라": "X100F",
    "후지필름 X half 하프 필카 감성 컴팩트 카메라": "X half",
    "후지필름 X100VI 필카 감성 카메라": "X100VI",
    "후지필름 X100V 필카 감성 카메라": "X100V",
    // ==========================================
    // 캐논 DSLR 크롭
    // ==========================================
    "캐논 EOS 850D + 18-55mm 번들렌즈 KIT": "850D + 18-55mm",
    "캐논 EOS 90D DSLR 고화질 카메라": "90D",
    "캐논 EOS 200D II + 18-55mm 번들렌즈 KIT": "200D II + 18-55mm",
    "캐논 EOS 200D + 18-55mm 번들렌즈 KIT": "200D + 18-55mm",
    "캐논 EOS 800D + 18-55mm 번들렌즈 KIT": "800D + 18-55mm",
    "캐논 EOS 750D + 18-55mm 번들렌즈 KIT": "750D + 18-55mm",
    "캐논 EF-S 10-18mm F4.5-5.6 IS STM": "EF-S 10-18mm",
    "캐논 EF-S 17-55mm F2.8 IS USM 축복렌즈": "EF-S 17-55mm",
    "시그마 A 18-35mm F1.8 DC HSM 캐논용": "시그마 A 18-35mm",
    "캐논 EF-S 24mm F2.8 STM 렌즈": "EF-S 24mm",
    "캐논 EF-S 35mm F2.8 Macro IS STM": "EF-S 35mm F2.8 Macro IS STM",
    "캐논 EF-S 55-250mm F4-5.6 IS 렌즈": "EF-S 55-250mm",
    // ==========================================
    // 캐논 DSLR 풀프레임
    // ==========================================
    "캐논 EOS 5D Mark IV 오막포 4K 고화질 DSLR": "5D Mark IV",
    "캐논 EOS 6D Mark II Mark2 육두막 바디": "6D Mark II",
    "캐논 EOS 5D Mark III Mark3 오막삼": "5D Mark III",
    "캐논 EOS 6D 카메라 바디": "6D",
    "캐논 EF 70-200mm F2.8L IS III USM 새새아빠백통": "EF 70-200mm F2.8L IS III",
    "캐논 EF 100-400mm F4.5-5.6L IS II USM 백사투": "EF 100-400mm F4.5-5.6L IS II",
    "시그마 150-600mm F5-6.3 DG OS HSM 캐논용": "시그마 150-600mm",
    "캐논 EF 70-200mm F2.8L IS II USM 새아빠백통": "EF 70-200mm F2.8L IS II",
    "캐논 EF 50mm F1.2L USM 오이만두 렌즈": "EF 50mm F1.2L",
    "캐논 캐논 EF 85mm F1.2L ll USM 만투 렌즈": "EF 85mm F1.2L II",
    "캐논 EF 24-70mm F2.8L II USM 신계륵": "EF 24-70mm F2.8L II",
    "캐논 EF 70-200mm F2.8L IS USM 아빠백통": "EF 70-200mm F2.8L IS",
    "탐론 SP 70-200mm F2.8 Di VC USD 캐논용 탐아빠": "탐론 SP 70-200mm F2.8 Di VC USD",
    "캐논 EF 24-105mm F4L IS USM 렌즈": "EF 24-105mm F4L IS",
    "캐논 EF 16-35mm F2.8L II USM 렌즈": "EF 16-35mm F2.8L II",
    "캐논 EF 70-200mm F2.8L USM 엄마백통": "EF 70-200mm F2.8L USM",
    "캐논 EF 24-70mm F2.8L USM 구계륵 렌즈": "EF 24-70mm F2.8L USM",
    "시그마 A 35mm F1.4 DG HSM 캐논용 렌즈": "시그마 A 35mm F1.4",
    "캐논 EF 50mm F1.4 USM 쩜사렌즈": "EF 50mm F1.4",
    "캐논 EF 35mm F2 IS USM 사무방 렌즈": "EF 35mm F2 IS USM",
    "캐논 EF 85mm F1.8 USM 애기만두 렌즈": "EF 85mm F1.8",
    "캐논 EF 50mm F1.8 STM 렌즈": "EF 50mm F1.8",
    // ==========================================
    // 캠코더
    // ==========================================
    "소니 AX700 4K 콘서트 팬싸 동영상 12시간 24시간": "AX700",
    "소니 FDR-AX43A 4K 핸디캠 영상 촬영 12시간 24시간": "AX43A",
    "소니 FDR-AXP55 4K 콘서트 팬싸 공연 12시간 24시간": "AXP55",
    "소니 HXR-NX80 4K 영상 촬영 전문 캠코더": "NX80",
    "캐논 G70 4K 20배 콘서트 팬싸 촬영 12시간 24시간": "G70",
    // ==========================================
    // 액션캠
    // ==========================================
    "DJI Osmo Pocket 4P 포켓4P 스탠다드 콤보 브이로그": "Osmo Pocket 4P",
    "DJI 오즈모 액션5 프로 풀패키지 여행 유튜브 촬영": "액션5 풀패키지",
    "인스타360 Ace Pro 2 에이스프로2 스냅샷 세트": "에이스프로2 스냅샷",
    "DJI 오즈모 포켓3 브이로그 유튜브 1일": "오즈모 포켓3",
    "DJI 오즈모 포켓4 브이로그 유튜브 액션캠": "오즈모 포켓4",
    "인스타360 Luna Ultra 표준번들 액션캠": "루나 울트라",
    "DJI Osmo 360 어드벤처 콤보 액션캠 브이로그": "Osmo 360 콤보",
    "DJI Osmo 360 액션캠 브이로그 여행 카메라": "Osmo 360",
    "고프로 히어로 12 브이로그 유튜브 여행 액션캠": "고프로 히어로 12",
    "고프로 히어로 13 브이로그 유튜브 여행 액션캠": "고프로 히어로 13",
    "DJI 오즈모 액션5 프로 어드밴처콤보 유튜브 촬영": "액션5",
    "인스타360 Ace Pro 2 에이스프로2 액션캠": "에이스프로2",
    "인스타360 X5 8K 여행 유튜브 촬영 액션캠": "X5",
    "인스타360 X4 8K 여행 유튜브 촬영 액션캠": "X4",
    " DJI 오즈모 액션6 풀패키지 유튜브 브이로그 촬영 액션캠": "액션6 풀패키지",
    "DJI 오즈모 액션6 어드밴처콤보 액션캠": "액션6",
    "인스타360 Go Ultra 고울트라 표준번들 액션캠": "고울트라 표준번들",
    "인스타360 Go Ultra 고울트라 크리에이터 번들": "고울트라 크리에이터 번들",
    // ==========================================
    // 리코
    // ==========================================
    "리코 GR3X HDF 빈티지 감성 하이엔드 카메라 1일": "GR3X HDF",
    "리코 GR4 하이엔드 감성 빈티지 디카": "GR4",
    "리코 GR3X 하이엔드 소형 카메라": "GR3X",
    "리코 GR3 HDF 빈티지 감성 하이엔드 컴팩트 카메라": "GR3 HDF",
    "리코 GR4 HDF 하이엔드 감성 빈티지 디카": "GR4 HDF",
    "리코 GR3 빈티지 감성 하이엔드 컴팩트 카메라": "GR3",
    "리코 GR2 감성 빈티지 하이엔드 컴팩트 디카 카메라": "GR2",
    // ==========================================
    // 하이엔드
    // ==========================================
    "캐논 파워샷 G7X MARK 3 하이엔드 카메라 1일": "G7X MARK 3",
    "캐논 Powershot ZOOM 파워샷 줌 휴대용 망원 카메라": "Powershot ZOOM",
    "캐논 PowerShot V1 파워샷 브이로그 컴팩트 카메라": "PowerShot V1",
    "소니 RX100M6 / RX100 VI 하이엔드 카메라": "RX100M6",
    "캐논 파워샷 V10 브이로그 유튜브 촬영 카메라": "V10",
    "소니 ZV-1 브이로그 유튜브 하이엔드 카메라": "ZV-1",
    "소니 ZV-1F 브이로그 유튜브 하이엔드 카메라": "ZV-1F",
    "소니 DSC-RX10 VI / RX10M4 초망원 카메라": "RX10M4",
    "소니 ZV1-M2 브이로그 올인원 카메라": "ZV1-M2",
    "소니 RX100M7 / RX100 VII 하이엔드 카메라": "RX100M7",
    "캐논 파워샷 G7X MARK 2 하이엔드 카메라": "G7X MARK 2",
    "파나소닉 루믹스 DC-TZ99 30배 줌 고성능 카메라": "DC-TZ99",
    "라이카 D-LUX 6 디룩스6 하이엔드 카메라": "D-LUX 6",
    "라이카 D-LUX 7 디룩스7 하이엔드 카메라": "D-LUX 7",
    "니콘 쿨픽스 P1000 초망원 하이엔드 카메라": "쿨픽스 P1000",
    // ==========================================
    // 홈마
    // ==========================================
    "캐논 R6 Mark3 + EF100400 백사투 홈마 1일": "R6M3 + 백사투 홈마",
    "캐논 R5 + RF100500 백오백 홈마 세트 1일": "R5 + 백오백 홈마",
    "캐논 R6 Mark3 + RF70200 알아빠 홈마 1일": "R6M3 + 알아빠 홈마",
    "캐논 R6 Mark3 + RF100500 백오백 홈마 12시간 24시간": "R6M3 + 백오백 홈마",
    "캐논 R5 + RF70200 알아빠백통 홈마 세트 1일": "R5 + 알아빠백통 홈마",
    "캐논 R5 + EF100400 백사투 홈마 12시간 24시간": "R5 + 백사투 홈마",
    "캐논 R6 Mark2 + RF100500 백오백 홈마 12시간 24시간": "R6M2 + 백오백 홈마",
    "캐논 R6 Mark2 + RF70200 알아빠 홈마 12시간 24시간": "R6M2 + 알아빠 홈마",
    "캐논 R6 Mark2 + EF100400 백사투 홈마 1일": "R6M2 + 백사투 홈마",
    "캐논 R6 + RF100500 백오백 홈마 세트 1일": "R6 + 백오백 홈마",
    "캐논 R6 Mark3 + RF100400 알백사 홈마 1일": "R6M3 + 알백사 홈마",
    "캐논 R6 + RF70200 알아빠백통 홈마 세트 1일": "R6 + 알아빠백통 홈마",
    "캐논 5D Mark IV+EF100400 오막포 백사투 홈마 12시간": "5D Mark IV + EF100400 홈마",
    "캐논 R6 + EF100400 백사투 홈마 세트 1일": "R6 + EF100400 홈마",
    "캐논 R6 + RF100400 알백사 홈마 세트 1일": "R6 + RF100400 알백사 홈마",
    "캐논 R6 Mark2 + RF100400 알백사 홈마 12시간 24시간": "R6M2 + RF100400 알백사 홈마",
    "캐논 R7 + RF100400 알백사 홈마 12시간 24시간": "R7 + RF100400 알백사 홈마",
    "소니 A7C2 + 100400GM 백사금 홈마 세트 1일": "A7C2 + 100400GM 백사금 홈마",
    "소니 A7M4 + 100400GM 백사금 홈마 12시간 24시간": "A7M4 + 100400GM 백사금 홈마",
    "소니 A7C2 + 70200GM2 홈마 세트 1일": "A7C2 + 70200GM2 홈마",
    "소니 A7M4 + 70200GM2 홈마 12시간 24시간": "A7M4 + 70200GM2 홈마",
    // ==========================================
    // 열화상카메라 및 계측장비
    // ==========================================
    "FLIR ONE PRO 스마트폰 열화상 카메라 C타입": "FLIR ONE PRO C타입",
    "FLIR ONE PRO 스마트폰 열화상 카메라 라이트닝": "FLIR ONE PRO 라이트닝",
    "라돈측정기 + 열화상카메라 + 공기질 측정기 셀프 아파트 사전점검": "라돈측정기 + 열화상카메라 + 공기질 측정기",
    "FLIR E6 플리어 휴대용 열화상 카메라": "FLIR E6",
    "FLIR E5 플리어 휴대용 열화상 카메라": "FLIR E5",
    "FLIR C5 플리어 소형 열화상 카메라": "FLIR C5",
    "FLIR C2 플리어 소형 열화상 카메라": "FLIR C2",
    // ==========================================
    // 빔프로젝터, 파티박스
    // ==========================================
    "앱손 EB-2250U 5000안시 빔프로젝터": "EB-2250U",
    "LG 시네빔 HF85LA 초단초점 빔프로젝터 1일": "HF85LA",
    "LG 시네빔 PU615U 쇼츠 4K 빔프로젝터": "쇼츠",
    "LG 시네빔 단초점 빔프로젝터 HF65LA 1일": "HF65LA",
    "LG전자 시네빔 4K 빔프로젝터 HU70LA": "HU70LA",
    "LG 시네빔 HU710PB 큐브 4K 빔프로젝터": "큐브",
    "삼성 더 프리스타일 휴대용 야외 캠핑 빔프로젝터": "프리스타일",
    "LG 시네빔 PH550 HD 미니 빔프로젝터": "PH550 미니빔",
    "LG 시네빔 PF50KA 빔프로젝터 미니": "PF50KA 미니빔",
    "삼성전자 JBL 파티박스 320 버스킹 행사용 블루투스 스피커": "JBL 파티박스 320",
    "삼성전자 JBL 파티박스 110 버스킹 행사용 블루투스 스피커": "JBL 파티박스 110",
    "삼성전자 JBL 파티박스 710 블루투스 스피커 버스킹 행사용": "JBL 파티박스 710",
    "삼성전자 JBL 파티박스 온더고 블루투스 휴대용 스피커": "JBL 파티박스 온더고",
    "삼성전자 JBL 파티박스 앙코르2 블루투스 휴대용 스피커": "JBL 파티박스 앙코르2",
    // ==========================================
    // 조명, 모니터
    // ==========================================
    "LG 스탠바이미2 행사용 스탠드 티비 모니터 1일": "스탠바이미2",
    "LG 스탠바이미 행사용 스탠드 티비 모니터": "스탠바이미",
    "LG 스탠바이미 GO 캠핑 차박 스마트티비 모니터 행사용": "스탠바이미 GO",
    "룩스패드 43H 투스탠드 세트 방송 촬영 LED 조명": "룩스패드 43H 투스탠드 세트",
    "어퓨처 아마란 레이 360C 방송 스튜디오 촬영 조명": "아마란 레이 360C",
    "어퓨처 아마란 300C 방송 스튜디오 촬영 조명": "아마란 300C",
    "룩스패드 43H 원스탠드 방송 유트브 촬영 LED 조명": "룩스패드 43H 원스탠드",
    "어퓨처 아마란 150C 방송 스튜디오 촬영 조명": "아마란 150C",
    "난라이트 포르자 60C RGB 라이트 조명 스트로브": "난라이트 포르자 60C",
    "캐논 고독스 V860II 카메라 플래시 조명": "V860II",
    "캐논 SPEEDLITE 470EX-AI 스피드라이트": "470EX-AI",
    "캐논 EL5 스피드라이트 카메라 플래시 조명": "EL5",
    "소니 고독스 V100 플래시 스피드라이트 촬영 조명": "V100s",
    "캐논 고독스 V100 플래시 스피드라이트 촬영 조명": "V100c",
    // ==========================================
    // 음향, 마이크
    // ==========================================
    "소니 UWP-D27 2채널 무선 핀 마이크": "UWP-D27",
    "DJI MIC 3 무선 마이크 2TX+1RX+충전 케이스 세트": "DJI MIC 3",
    "젠하이저 MKE600 비디오 카메라용 샷건 마이크": "젠하이저 MKE600",
    "소니 UWP-D21 2채널 무선 핀 마이크": "UWP-D21",
    "JBL AS3 충전식 무선마이크 공연 강연용": "JBL AS3",
    "줌 H6 essential 휴대용 마이크 녹음기 보이스레코더": "줌 H6 essential",
    "DJI MIC 2 무선 마이크 2TX+1RX+충전 케이스 세트": "DJI MIC 2",
    "Rode Video mic ntg 로데 샷건 비디오마이크": "Rode Video mic ntg",
    "소니 ECM-CG60 지향성 샷건 마이크": "ECM-CG60",
    "소니 ICD-TX660 초소형 고성능 휴대용 장시간 녹음기": "TX660",
    // ==========================================
    // 드론, 짐벌
    // ==========================================
    "DJI NEO 2 플라이 모어 콤보 드론": "NEO 2",
    "DJI 로닌 RS5 카메라 짐벌": "로닌 RS5",
    "DJI 로닌 RS4 카메라 짐벌 12시간 24시간": "로닌 RS4",
    "DJI NEO 플라이 모어 콤보 드론": "NEO",
    "DJI 로닌 RS4 미니 카메라 짐벌": "로닌 RS4 미니",
    "DJI 오즈모 모바일7 휴대폰 스마트폰 짐벌": "오즈모 모바일7",
    "인스타360 플로우 2 프로 스마트폰 짐벌": "인스타360 플로우2 프로",
    "DJI 오즈모 모바일6 휴대폰 스마트폰 짐벌": "오즈모 모바일6",
    "DJI 오즈모 모바일4 휴대폰 스마트폰 짐벌": "오즈모 모바일4",
    // ==========================================
    // 파워뱅크
    // ==========================================
    "에코플로우 델타2 올인원 파워뱅크 대용량 차박 캠핑 배터리": "에코플로우 델타2",
    "잭커리 2000 Plus 파워뱅크 대용량 차박 캠핑 배터리": "잭커리 2000 Plus",
    "잭커리 1000v2 파워뱅크 차박 캠핑 배터리 12시간 24시간": "잭커리 1000v2",
    // ==========================================
    // 삼각대, 악세사리
    // ==========================================
    "아이풋티지 코브라3 페달형 카본 4단 모노포드키트": "코브라3",
    "셔틀러 ACE M GS 1002 비디오 촬영 삼각대": "셔틀러",
    "캐논 CP1500 휴대용 포토프린터": "CP1500",
    "캐논 AD-P1 스마트폰 어댑터 USB-C": "AD-P1",
    "맨프로토 비프리 라이브 비디오 카메라 삼각대": "비프리 라이브",
    "시루이 P-224SR 비디오 촬영 모노포드 삼각대": "시루이 P-224SR",
    "어벤져 A2033L C스탠드 그립암 키트 조명 촬영 거치대": "A2033L C스탠드",
    "레오포토 MP-285C 10X 모노포드 카본삼각대": "MP-285C",
    "니시 TRUE COLOR ND-VARIO (ND2-ND32) 가변필터 77mm": "니시 ND-VARIO 77mm",
    "니시 TRUE COLOR ND-VARIO (ND2-ND32) 가변필터 82mm": "니시 ND-VARIO 82mm",
    "스몰리그 3667B+3765 케이지 탑핸들 키트": "스몰리그 3667B+3765",
    "어벤저 A2033L C 스탠드 조명 촬영 거치대": "A2033L C 스탠드",
    // ==========================================
    // 어댑터, 익스텐더
    // ==========================================
    "캐논 익스텐더 EF 2x III Extender": "EF 2x III",
    "캐논 RF 익스텐더 RF 2x Extender": "RF 2x",
    "캐논 EF-EOS R 마운트 어댑터": "EF-EOS R",
    "캐논 EF-EOS M 렌즈 마운트 어댑터": "EF-EOS M"
};

// 💡 1분마다 실행
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const targetTime = new Date(now.getTime() + 30 * 60 * 1000); 

        const ordersToProcess = await Reservation.find({
            status: 'SCHEDULED',
            reservationTime: { $lte: targetTime, $gte: now } 
        });

        if (ordersToProcess.length > 0) {
            console.log(`[스케줄러] ${ordersToProcess.length}건의 발송 대상을 발견했습니다.`);
        }

// [신규 로직] 동일한 톡톡ID(고객)끼리 주문을 배열로 묶어줍니다.
        const groupedOrders = {};
        for (let order of ordersToProcess) {
            if (!groupedOrders[order.talkId]) {
                groupedOrders[order.talkId] = [];
            }
            groupedOrders[order.talkId].push(order);
        }

        // 묶인 그룹별로 1번씩만 반복문을 돌며 발송합니다.
        for (let talkId in groupedOrders) {
            const userOrders = groupedOrders[talkId];
            const firstOrder = userOrders[0];

            // 1. 보관함 텍스트 생성 로직
            const formattedLockers = userOrders.map(o => {
                const isExternal = Number(o.lockerId) >= 10000;
                const lockerStr = isExternal ? '[외부 보관]' : `[${o.lockerId}번] 보관함 (비밀번호 : [${o.pw}])`;
                
                if (userOrders.length === 1) {
                    return lockerStr;
                } else {
                    const rawEquip = o.equipment || '';
                    let shortEquip = rawEquip.split('|').map(item => {
                        const trimmed = item.trim();
                        return customDictionary[trimmed] || trimmed; 
                    }).filter(Boolean).join(', ') || '기본 장비';

                    // 💡 [신규 로직] 포켓3 + 크리에이터 콤보 조건 확인 및 이름 변경
                    // 악세사리에 '크리에이터 콤보'가 포함되어 있는지 확인합니다.
                    const hasCreatorCombo = (o.accessories || []).some(a => typeof a === 'string' && a.includes('크리에이터 콤보'));
                    
                    // 기기명에 '포켓3'가 있고, 콤보 옵션도 있다면 텍스트를 변환합니다.
                    if (shortEquip.includes('포켓3') && hasCreatorCombo) {
                        shortEquip = shortEquip.replace('포켓3', '포켓3 크리에이터 콤보');
                    }

                    return `* ${shortEquip} : ${lockerStr}`;
                }
            }).join('\n');

            // 🚨 [복구 및 강화 완료] 악세사리가 아예 비어있을 때도 에러가 나지 않도록(|| []) 완벽하게 방어했습니다.
            const mergedAccessories = [...new Set(userOrders.flatMap(o => o.accessories || []))];
            
            // 💡 [추가했던 로직] 겉으로는 안 보이지만, 이미지 트리거용으로 원본 기기명을 백업합니다.
            const mergedEquipment = userOrders.map(o => o.equipment || '').join(' | ');

            // 2. 발송할 데이터 조립
            const mergedTask = {
                talkId: talkId,
                name: firstOrder.name,
                formattedLockers: formattedLockers, 
                equipment: mergedEquipment, 
                accessories: mergedAccessories, // 💡 이제 여기서 에러가 나지 않습니다!
                orderIds: userOrders.map(o => o._id) 
            };
            
            // 3. 네이버 톡톡 발송 실행
            const success = await sendTalkMessage(mergedTask); 
            
            if (success) {
                await Reservation.updateMany(
                    { _id: { $in: mergedTask.orderIds } },
                    { $set: { status: 'SENT' } }
                );
                console.log(`✅ [발송 성공 - 묶음] ${mergedTask.name} 고객님`);
            } else {
                console.error(`❌ [발송 실패 - 묶음] ${mergedTask.name} 고객님`);
            }
        }
    } catch (error) {
        console.error("스케줄러 엔진 에러:", error);
    }
});