const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // 화면(React)과 데이터 통신을 허용

// 데이터베이스 역할을 할 JSON 파일 경로
const DB_FILE = './database.json';

// DB 파일 읽어오기
function readDB() {
    if (!fs.existsSync(DB_FILE)) return [];
    const data = fs.readFileSync(DB_FILE, 'utf8');
    if (!data.trim()) return [];
    return JSON.parse(data);
}

// DB 파일에 안전하게 저장하기
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 1. 프론트엔드(화면)에서 예약 데이터 받아서 대기열에 등록하는 기능
app.post('/api/scheduler/register', (req, res) => {
    const userData = req.body;
    
    // 예약 시간 기준으로 정확히 1시간 전 시간 계산
    const reservationTime = new Date(`${userData.startDate}T${userData.startTime}:00`);
    const sendTime = new Date(reservationTime.getTime() - (60 * 60 * 1000));
    
    const newTask = {
        ...userData,
        sendTime: sendTime.toISOString(),
        status: 'SCHEDULED' // 발송 대기 상태
    };

    // 기존 데이터 읽어서 새로운 예약자 추가 후 저장
    const currentData = readDB();
    currentData.push(newTask);
    writeDB(currentData);

    console.log(`[등록 완료] ${userData.name}님 - 발송 예정 시간: ${sendTime.toLocaleString()}`);
    res.status(200).json({ success: true, message: '스케줄 등록 완료' });
});

// 2. [핵심] 1분마다 발송 대기열을 체크하는 스케줄러
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const currentData = readDB();
    let isUpdated = false;

    // 대기열에 아무도 없으면 조용히 넘어감
    if (currentData.length > 0) {
        console.log(`[상태 체크] 현재 시간: ${now.toLocaleTimeString()} - 발송 대기열 확인 중...`);
    }

    for (let i = 0; i < currentData.length; i++) {
        const task = currentData[i];
        const sendTime = new Date(task.sendTime);

        // 상태가 대기 중(SCHEDULED) 이고, 지금 시간이 발송 예정 시간을 지났다면!
        if (task.status === 'SCHEDULED' && now >= sendTime) {
            task.status = 'SENDING';
            isUpdated = true;
            writeDB(currentData); // 상태 변경 우선 저장

            // 네이버 톡톡 발송 함수 호출
            const success = await sendTalkMessage(task);
            
            if (success) {
                task.status = 'COMPLETED';
                console.log(`✅ [발송 성공] ${task.name}님에게 안내 완료`);
            } else {
                task.status = 'FAILED';
                console.log(`❌ [발송 실패] ${task.name}님 발송 에러`);
            }
        }
    }

    if (isUpdated) {
        writeDB(currentData); // 결과 최종 저장
    }
});

// 3. 네이버 톡톡 API 통신 함수
async function sendTalkMessage(task) {
    const url = 'https://gw.talk.naver.com/chatbot/v1/event';
    const token = 'iJaGlLZJTC2Fj8iLTRSc'; // 실제 토큰

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
보관함 정보 : [${task.lockerNum}번] 보관함 (비밀번호 : [${task.pw}])
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
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json;charset=UTF-8'
            }
        });
    
        // 네이버가 발송을 거절했다면 왜 거절했는지 로그에 출력!
        if (response.data.success === false) {
            console.log(`❌ [네이버 반환 에러 내역]:`, response.data);
        }

        return response.data.success;

    } catch (error) {
        console.error('❌ API 발송 에러:', error.message);
        return false;
    }
}

// 3.5 [필수] 네이버 톡톡 진짜 고유 ID를 낚아채는 웹훅 트랩
app.post('/webhook', (req, res) => {
    console.log('\n=======================================');
    console.log('🚨 [웹훅 수신] 누군가 톡톡 메시지를 보냈습니다!');
    console.log('👉 [진짜 톡톡 ID]:', req.body.user);
    console.log('💬 [보낸 메시지]:', req.body.textContent ? req.body.textContent.text : '내용 없음');
    console.log('=======================================\n');
    res.send({ success: true });
});

// 4. 서버 구동
const PORT = process.env.PORT || 5000; // 💡 Render가 주는 포트를 최우선으로 사용하도록 변경
app.listen(PORT, () => {
    console.log(`\n🚀 무인점 톡톡 자동화 서버가 실행되었습니다. (포트: ${PORT})`);
    console.log(`⏳ 1분마다 발송 대기열을 체크합니다...\n`);
});