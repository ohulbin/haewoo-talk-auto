import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null); // 현재 팝업이 켜진 고객 타겟
  const [webhookList, setWebhookList] = useState([]); // 임시 수신 톡 목록

  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com';

  // 🔄 [새로고침 방어] 컴포넌트 마운트 시 DB에 남아있는 당일 예약 현황 로드
  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations`);
      const data = await res.json();
      setReservedList(data);
    } catch (err) {
      console.error('데이터 로드 실패', err);
    }
  };

  // 📥 JSON 파일 파싱 및 업로드 처리
  const handleJsonUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsedData = JSON.parse(event.target.result);
        
        // 백엔드 업로드 API 호출
        const res = await fetch(`${BACKEND_URL}/api/reservations/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsedData)
        });
        const result = await res.json();
        
        if (result.success) {
          setReservedList(result.data);
          alert('예약 명단이 안전하게 업로드 및 DB 동기화 되었습니다.');
        }
      } catch (err) {
        alert('올바른 JSON 형식이 아닙니다.');
      }
    };
    reader.readAsText(file);
  };

  // 🔗 [팝업 오픈] 수동 연결 창을 켤 때 백엔드에 잡힌 웹훅 기록 긁어오기
  const openMappingPopup = async (user) => {
    setActivePopupUser(user);
    try {
      const res = await fetch(`${BACKEND_URL}/api/webhook-captures`);
      const data = await res.json();
      setWebhookList(data);
    } catch (err) {
      alert('웹훅 리스트를 가져오지 못했습니다.');
    }
  };

  // 🎯 [팝업 매핑 선택] 임시 톡 Id와 매핑 확정 
  const connectTalkId = async (talkId) => {
    if (!activePopupUser) return;
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/scheduler/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activePopupUser._id, talkId: talkId })
      });
      const result = await res.json();

      if (result.success) {
        alert(`${activePopupUser.name}님 발송 예약이 완료되었으며 단골 장부에 등록되었습니다.`);
        setActivePopupUser(null);
        fetchReservations(); // 리스트 새로고침
      }
    } catch (err) {
      alert('매핑 처리 중 서버 통신 에러가 발생했습니다.');
    }
  };

  // ❌ [수동 취소] 스케줄 취소 버튼 액션
  const cancelTask = async (id, name) => {
    if (!window.confirm(`${name}님의 수령안내 알림톡 예약을 취소하시겠습니까?`)) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations/${id}/cancel`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        alert('발송 예약이 취소되었습니다.');
        fetchReservations();
      }
    } catch (err) {
      alert('취소 처리 실패');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>해우렌탈 무인 알림톡 통합 관제소 (MongoDB 요람)</h2>
      
      <div style={{ marginBottom: '20px', padding: '15px', background: '#f0f2f5', borderRadius: '8px' }}>
        <label style={{ fontWeight: 'bold' }}>📅 네이버폼 당일 예약 JSON 명단 등록: </label>
        <input type="file" accept=".json" onChange={handleJsonUpload} style={{ marginLeft: '10px' }} />
      </div>

      <table border="1" cellPadding="10" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
        <thead>
          <tr style={{ background: '#e2e8f0' }}>
            <th>고객명</th>
            <th>연락처</th>
            <th>대여 예정시간</th>
            <th>네이버 톡톡 고유 ID</th>
            <th>현재 상태</th>
            <th>제어 플러그</th>
          </tr>
        </thead>
        <tbody>
          {reservedList.length === 0 ? (
            <tr><td colSpan="6">등록된 대기 명단이 없습니다. JSON 파일을 업로드해 주세요.</td></tr>
          ) : (
            reservedList.map((user) => (
              <tr key={user._id}>
                <td>{user.name}</td>
                <td>{user.phone}</td>
                <td>{new Date(user.reservationTime).toLocaleString('ko-KR')}</td>
                <td style={{ color: user.talkId ? 'blue' : 'gray', fontWeight: user.talkId ? 'bold' : 'normal' }}>
                  {user.talkId || '❌ 미연동 (장부 없음)'}
                </td>
                <td>
                  <span style={{
                    padding: '3px 8px', borderRadius: '4px', color: '#fff', fontSize: '12px',
                    background: user.status === 'SENT' ? '#22c55e' : user.status === 'SCHEDULED' ? '#3b82f6' : user.status === 'CANCELLED' ? '#ef4444' : '#64748b'
                  }}>
                    {user.status}
                  </span>
                </td>
                <td>
                  {!user.talkId && user.status === 'READY' && (
                    <button onClick={() => openMappingPopup(user)} style={{ background: '#eab308', color: '#000', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', marginRight: '5px' }}>
                      🔗 ID 매핑하기
                    </button>
                  )}
                  {user.status === 'SCHEDULED' && (
                    <button onClick={() => cancelTask(user._id, user.name)} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
                      🛑 발송 취소
                    </button>
                  )}
                  {user.status === 'SENT' && <span>✅ 전송완료됨</span>}
                  {user.status === 'CANCELLED' && <span style={{ color: 'red' }}>취소된 예약</span>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* 팝업창 모달 레이어 구조 */}
      {activePopupUser && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: '#fff', padding: '25px', borderRadius: '8px', width: '500px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3>🎯 톡톡 고유 ID 수동 매핑 팝업</h3>
            <p style={{ color: '#2563eb' }}>대상자: <b>{activePopupUser.name}</b> ({activePopupUser.phone})</p>
            <p style={{ fontSize: '13px', color: '#64748b' }}>네이버 파트너센터 채팅창 시간대와 내용을 대조해 아래에서 올바른 고객을 매치해 주세요.</p>
            
            <hr />
            
            <div style={{ marginTop: '15px' }}>
              {webhookList.length === 0 ? (
                <p style={{ color: 'red', fontSize: '14px' }}>임시 보관함에 들어온 최신 톡 데이터가 없습니다. 고객이 톡을 한마디라도 보내야 트랩에 감지됩니다.</p>
              ) : (
                webhookList.map((chat) => (
                  <div key={chat._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #e2e8f0', fontSize: '13px' }}>
                    <div style={{ textAlign: 'left', width: '70%' }}>
                      <div style={{ fontWeight: 'bold', color: '#475569' }}>ID: {chat.talkId.substring(0, 12)}...</div>
                      <div style={{ color: '#0f172a', background: '#f1f5f9', padding: '5px', borderRadius: '4px', marginTop: '3px' }}>💬 {chat.lastMessage}</div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(chat.receivedAt).toLocaleTimeString()}</span>
                    </div>
                    <button onClick={() => connectTalkId(chat.talkId)} style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
                      선택 🔗
                    </button>
                  </div>
                ))
              )}
            </div>

            <button onClick={() => setActivePopupUser(null)} style={{ marginTop: '20px', width: '100%', padding: '10px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              닫기 (창 닫기)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;