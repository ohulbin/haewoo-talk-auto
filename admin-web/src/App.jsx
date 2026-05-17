import React, { useState, useEffect } from 'react';

const styles = {
  container: { padding: '40px 60px', backgroundColor: '#F8FAFC', minHeight: '100vh', fontFamily: "'Pretendard', -apple-system, sans-serif", color: '#0F172A' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' },
  title: { fontSize: '32px', fontWeight: '800', color: '#1E3A8A', margin: 0, letterSpacing: '-0.5px' },
  uploadWrapper: { position: 'relative', display: 'inline-block' },
  uploadLabel: { 
    display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#EFF6FF', color: '#2563EB', 
    padding: '14px 24px', borderRadius: '24px', fontWeight: '700', fontSize: '15px', cursor: 'pointer',
    border: '2px dashed #93C5FD', transition: 'all 0.2s'
  },
  fileInput: { display: 'none' }, 
  card: { backgroundColor: '#FFFFFF', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)', padding: '30px' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '10px' },
  th: { padding: '18px 15px', textAlign: 'center', fontWeight: '700', color: '#64748B', borderBottom: '2px solid #F1F5F9', fontSize: '14px' },
  td: { padding: '20px 15px', borderBottom: '1px solid #F8FAFC', textAlign: 'center', fontSize: '15px', color: '#334155' },
  badge: (status) => ({
    padding: '8px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', color: '#fff', display: 'inline-block',
    backgroundColor: status === 'SENT' ? '#10B981' : status === 'SCHEDULED' ? '#3B82F6' : status === 'CANCELLED' ? '#F43F5E' : '#94A3B8',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
  }),
  btnPrimary: { backgroundColor: '#2563EB', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '16px', fontWeight: '700', cursor: 'pointer' },
  btnWarning: { backgroundColor: '#F59E0B', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '16px', fontWeight: '700', cursor: 'pointer' },
  btnCancel: { backgroundColor: '#FFF1F2', color: '#E11D48', border: 'none', padding: '10px 20px', borderRadius: '16px', fontWeight: '700', cursor: 'pointer', marginLeft: '6px' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#FFFFFF', padding: '40px', borderRadius: '32px', width: '500px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' },
  chatItem: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px', borderRadius: '16px', backgroundColor: '#F8FAFC', marginBottom: '12px', border: '1px solid #E2E8F0' }
};

function App() {
  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null);
  const [webhookList, setWebhookList] = useState([]);

  // 💡 로컬 테스트 배포용 상태 세팅 (Render 올리실땐 다시 Render 주소로 교체!)
  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com'; 

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations`);
      const data = await res.json();
      setReservedList(data);
    } catch (err) {
      console.error('데이터 조회 실패', err);
    }
  };

  const handleJsonUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      let extractedUsers = [];
      try {
        const parsedData = JSON.parse(event.target.result);
        if (!parsedData.lockers) {
          alert('올바른 보관함 데이터 파일이 아닙니다.');
          return;
        }

        const phoneSet = new Set(); 
        for (const lockerId in parsedData.lockers) {
          const items = parsedData.lockers[lockerId];
          if (!items || !Array.isArray(items)) continue;
          
          for (const item of items) {
            if (item.status === 'reserved') {
              if (!phoneSet.has(item.contact)) {
                phoneSet.add(item.contact);
                
                const dateTimeStr = `${item.startDate}T${item.startTime}:00`;
                extractedUsers.push({
                  name: item.name,
                  phone: item.contact,
                  reservationTime: dateTimeStr,
                  lockerId: lockerId, // 💡 백엔드가 요구하는 보관함 번호 추출 주입
                  pw: item.pw         // 💡 백엔드가 요구하는 비밀번호 추출 주입
                });
              }
            }
          }
        }
      } catch (err) {
        alert('JSON 파일 해석 오류');
        return;
      }

      if (extractedUsers.length === 0) {
        alert('발송 대기(reserved) 상태인 고객이 없습니다.');
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/reservations/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extractedUsers)
        });
        const result = await res.json();
        if (result.success) {
          setReservedList(result.data);
          alert(`총 ${extractedUsers.length}명의 예약 명단 로드 완료!`);
        }
      } catch (err) {
        alert('백엔드 서버와 연결 끊김');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const openMappingPopup = async (user) => {
    setActivePopupUser(user);
    const res = await fetch(`${BACKEND_URL}/api/webhook-captures`);
    const data = await res.json();
    setWebhookList(data);
  };

  const connectTalkId = async (talkId) => {
    const res = await fetch(`${BACKEND_URL}/api/scheduler/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activePopupUser._id, talkId: talkId })
    });
    const result = await res.json();
    if (result.success) {
      setActivePopupUser(null);
      fetchReservations();
    }
  };

  const cancelTask = async (id) => {
    if (!window.confirm('발송 예약을 취소할까요?')) return;
    await fetch(`${BACKEND_URL}/api/reservations/${id}/cancel`, { method: 'POST' });
    fetchReservations();
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Haewoo AutoDesk</h1>
        <div style={styles.uploadWrapper}>
          <label htmlFor="jsonUpload" style={styles.uploadLabel}>
            <span style={{fontSize: '20px'}}>☁️</span> JSON 명단 업로드
          </label>
          <input id="jsonUpload" type="file" accept=".json" onChange={handleJsonUpload} style={styles.fileInput} />
        </div>
      </header>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>고객명</th>
              <th style={styles.th}>연락처</th>
              <th style={styles.th}>예약 시간</th>
              <th style={styles.th}>보관함/비번</th>
              <th style={styles.th}>톡톡 ID</th>
              <th style={styles.th}>상태</th>
              <th style={styles.th}>관리 액션</th>
            </tr>
          </thead>
          <tbody>
            {reservedList.map((user) => (
              <tr key={user._id}>
                <td style={{...styles.td, fontWeight: '800'}}>{user.name}</td>
                <td style={styles.td}>{user.phone}</td>
                <td style={styles.td}>{new Date(user.reservationTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                {/* 보관함 정보 매핑 상태 시각화 추가 */}
                <td style={styles.td}>📦 {user.lockerId}번 방 ({user.pw})</td>
                <td style={styles.td}>
                  {user.talkId ? (
                    <span style={{color: '#2563EB', fontWeight: '800', background: '#DBEAFE', padding: '6px 12px', borderRadius: '12px'}}>✅ {user.talkId.substring(0,8)}...</span>
                  ) : (
                    <span style={{color: '#94A3B8'}}>미연동</span>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.badge(user.status)}>{user.status}</span>
                </td>
                <td style={styles.td}>
                  {/* 💡 [핵심 구현] 전송 완료가 아닌 대상을 조건으로 ID 연결 및 🔄 ID 변경 기능 통합 지원 */}
                  {user.status !== 'SENT' && (
                    <button 
                      onClick={() => openMappingPopup(user)} 
                      style={user.talkId ? styles.btnWarning : styles.btnPrimary}
                    >
                      {user.talkId ? '🔄 ID 변경' : 'ID 연결 🔗'}
                    </button>
                  )}
                  {user.status === 'SCHEDULED' && (
                    <button onClick={() => cancelTask(user._id)} style={styles.btnCancel}>취소 🛑</button>
                  )}
                  {user.status === 'SENT' && <span style={{color: '#10B981', fontWeight: '800'}}>전송완료됨</span>}
                  {user.status === 'CANCELLED' && <span style={{color: '#94A3B8'}}>취소된 예약</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activePopupUser && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h2 style={{color: '#1E3A8A', margin: '0 0 10px 0', fontSize: '24px'}}>수동 ID 매칭</h2>
            <p style={{color: '#64748B', marginBottom: '25px'}}>대상: <strong style={{color: '#0F172A'}}>{activePopupUser.name}</strong> ({activePopupUser.phone})</p>
            
            <div style={{maxHeight: '400px', overflowY: 'auto', marginBottom: '20px'}}>
              {webhookList.length === 0 ? (
                <div style={{textAlign: 'center', padding: '40px', color: '#94A3B8'}}>
                  <span style={{fontSize: '40px', display: 'block', marginBottom: '10px'}}>📭</span>
                  수집된 톡 대화가 없습니다.
                </div>
              ) : (
                webhookList.map(chat => (
                  <div key={chat._id} style={styles.chatItem}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <span style={{fontSize: '12px', color: '#94A3B8', fontWeight: '600'}}>{new Date(chat.receivedAt).toLocaleTimeString()}</span>
                      <button onClick={() => connectTalkId(chat.talkId)} style={{...styles.btnPrimary, padding: '6px 14px', fontSize: '13px'}}>선택</button>
                    </div>
                    <div style={{fontWeight: '500', color: '#334155'}}>{chat.lastMessage}</div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setActivePopupUser(null)} style={{width: '100%', padding: '16px', borderRadius: '16px', border: 'none', background: '#F1F5F9', color: '#475569', cursor: 'pointer', fontWeight: '800', fontSize: '15px'}}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;