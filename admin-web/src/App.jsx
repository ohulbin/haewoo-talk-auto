import React, { useState } from 'react';

function App() {
  const [reservedList, setReservedList] = useState([]);

  // 1. JSON 파일 업로드 및 파싱
  const handleFileUpload = (e) => {
    const fileReader = new FileReader();
    fileReader.readAsText(e.target.files[0], "UTF-8");
    fileReader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        processReservedData(parsed.lockers || {});
      } catch (error) {
        alert("올바른 JSON 파일이 아닙니다.");
      }
    };
  };

  // 2. 예약자 필터링 및 중복 제거
  const processReservedData = (lockers) => {
    const uniqueTargets = {};

    Object.entries(lockers).forEach(([lockerNum, items]) => {
      items.forEach((item) => {
        if (item.status === 'reserved') {
          const key = `${item.name}_${item.contact}_${item.startDate}_${item.startTime}`;
          if (!uniqueTargets[key]) {
            uniqueTargets[key] = {
              id: item.id,
              name: item.name,
              contact: item.contact,
              startDate: item.startDate,
              startTime: item.startTime,
              lockerNum: lockerNum,
              pw: item.pw,
              talkId: '', // 톡톡 ID 입력 칸
              status: '대기 중'
            };
          }
        }
      });
    });
    setReservedList(Object.values(uniqueTargets));
  };

  // 3. 톡톡 ID 수동 입력 처리
  const handleTalkIdChange = (index, value) => {
    const updated = [...reservedList];
    updated[index].talkId = value;
    setReservedList(updated);
  };

  // 4. 백엔드 서버로 발송 스케줄 등록 요청
  const handleRegisterScheduler = async (user, index) => {
    if (!user.talkId) {
      return alert('네이버 톡톡 고유 ID를 먼저 입력해주세요!');
    }

    try {
      // 포트 5000번에서 돌고 있는 우리 백엔드 서버로 전송
      const response = await fetch('http://localhost:5000/api/scheduler/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });

      if (response.ok) {
        alert(`${user.name}님 스케줄 등록 완료!`);
        const updated = [...reservedList];
        updated[index].status = '스케줄 등록됨';
        setReservedList(updated);
      } else {
        alert('서버 등록에 실패했습니다.');
      }
    } catch (error) {
      alert('서버와 연결할 수 없습니다. 백엔드 서버가 켜져 있는지 확인해주세요.');
    }
  };

  return (
    <div style={{ padding: '30px', fontFamily: 'sans-serif' }}>
      <h2>📦 무인 보관함 톡톡 자동 발송 시스템</h2>
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
        <p>1. 대표님 프로그램에서 추출한 <b>JSON 파일</b>을 업로드해주세요.</p>
        <input type="file" accept=".json" onChange={handleFileUpload} />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead>
          <tr style={{ backgroundColor: '#e9ecef' }}>
            <th style={thStyle}>보관함</th>
            <th style={thStyle}>고객명</th>
            <th style={thStyle}>연락처</th>
            <th style={thStyle}>예약 일시</th>
            <th style={thStyle}>비밀번호</th>
            <th style={thStyle}>💬 네이버 톡톡 ID</th>
            <th style={thStyle}>상태</th>
            <th style={thStyle}>액션</th>
          </tr>
        </thead>
        <tbody>
          {reservedList.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ padding: '20px' }}>대기 중인 예약자가 없습니다.</td>
            </tr>
          ) : (
            reservedList.map((user, index) => (
              <tr key={user.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={tdStyle}>{user.lockerNum}번</td>
                <td style={tdStyle}><b>{user.name}</b></td>
                <td style={tdStyle}>{user.contact}</td>
                <td style={tdStyle}>{user.startDate}<br/>{user.startTime}</td>
                <td style={tdStyle}><span style={{color: 'red', fontWeight: 'bold'}}>{user.pw}</span></td>
                <td style={tdStyle}>
                  <input 
                    type="text" 
                    placeholder="W_1234abcd..." 
                    value={user.talkId} 
                    onChange={(e) => handleTalkIdChange(index, e.target.value)}
                    style={{ padding: '5px', width: '90%' }}
                  />
                </td>
                <td style={tdStyle}>
                  <span style={{ 
                    color: user.status === '스케줄 등록됨' ? 'green' : 'gray',
                    fontWeight: 'bold' 
                  }}>{user.status}</span>
                </td>
                <td style={tdStyle}>
                  <button 
                    onClick={() => handleRegisterScheduler(user, index)}
                    style={{ padding: '8px 12px', cursor: 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
                  >
                    스케줄 등록
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// 테이블 스타일용 객체
const thStyle = { padding: '12px', border: '1px solid #ddd' };
const tdStyle = { padding: '12px', border: '1px solid #ddd' };

export default App;