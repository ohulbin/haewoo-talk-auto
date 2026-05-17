import React, { useState, useEffect } from 'react';

const styles = {
  container: { padding: '40px 60px', backgroundColor: '#F8FAFC', minHeight: '100vh', fontFamily: "'Pretendard', -apple-system, sans-serif", color: '#0F172A' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' },
  title: { fontSize: '32px', fontWeight: '800', color: '#1E3A8A', margin: 0 },
  uploadWrapper: { position: 'relative', display: 'inline-block' },
  uploadLabel: { display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#EFF6FF', color: '#2563EB', padding: '14px 24px', borderRadius: '24px', fontWeight: '700', fontSize: '15px', cursor: 'pointer', border: '2px dashed #93C5FD' },
  fileInput: { display: 'none' }, 
  card: { backgroundColor: '#FFFFFF', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)', padding: '30px' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '10px' },
  th: { padding: '18px 15px', textAlign: 'center', fontWeight: '700', color: '#64748B', borderBottom: '2px solid #F1F5F9', fontSize: '14px' },
  td: { padding: '20px 15px', borderBottom: '1px solid #F8FAFC', textAlign: 'center', fontSize: '15px', color: '#334155' },
  badge: (status) => ({
    padding: '8px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', color: '#fff', display: 'inline-block',
    backgroundColor: status === 'SENT' ? '#10B981' : status === 'SCHEDULED' ? '#3B82F6' : status === 'CANCELLED' ? '#F43F5E' : '#94A3B8'
  }),
  btnPrimary: { backgroundColor: '#2563EB', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' },
  btnWarning: { backgroundColor: '#F59E0B', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' },
  btnCancel: { backgroundColor: '#FFF1F2', color: '#E11D48', border: 'none', padding: '8px 16px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', marginLeft: '6px', fontSize: '13px' },
  btnDelete: { backgroundColor: '#F1F5F9', color: '#64748B', border: '1px solid #CBD5E1', padding: '8px 16px', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', marginLeft: '6px', fontSize: '13px' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#FFFFFF', padding: '40px', borderRadius: '32px', width: '500px' },
  chatItem: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px', borderRadius: '16px', backgroundColor: '#F8FAFC', marginBottom: '12px', border: '1px solid #E2E8F0' }
};

// 💡 상태값을 한국어로 변환하는 헬퍼 함수
const translateStatus = (status) => {
  switch(status) {
    case 'READY': return '대기중';
    case 'SCHEDULED': return '발송예약';
    case 'SENT': return '발송완료';
    case 'FAILED': return '발송실패';
    case 'CANCELLED': return '예약취소';
    default: return status;
  }
};

function App() {
  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null);
  const [webhookList, setWebhookList] = useState([]);

  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com'; 

  useEffect(() => { fetchReservations(); }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations`);
      const data = await res.json();
      setReservedList(data);
    } catch (err) { console.error(err); }
  };

  const handleJsonUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      let extractedUsers = [];
      try {
        const parsedData = JSON.parse(event.target.result);
        if (!parsedData.lockers) return alert('올바른 파일이 아닙니다.');

        const phoneSet = new Set(); 
        for (const lockerId in parsedData.lockers) {
          const items = parsedData.lockers[lockerId];
          if (!items || !Array.isArray(items)) continue;
          
          for (const item of items) {
            if (item.status === 'reserved' && !phoneSet.has(item.contact)) {
                phoneSet.add(item.contact);
                
                // 💡 [타임존 핵심 해결] 한국 시간(+09:00)임을 서버에 강제로 명시!
                const dateTimeStr = `${item.startDate}T${item.startTime}:00+09:00`;
                
                extractedUsers.push({
                  name: item.name,
                  phone: item.contact,
                  reservationTime: dateTimeStr,
                  lockerId: lockerId, 
                  pw: item.pw         
                });
            }
          }
        }
      } catch (err) { return alert('JSON 해석 오류'); }

      if (extractedUsers.length === 0) return alert('대기 고객이 없습니다.');

      try {
        const res = await fetch(`${BACKEND_URL}/api/reservations/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extractedUsers)
        });
        const result = await res.json();
        if (result.success) setReservedList(result.data);
      } catch (err) { alert('서버 연결 실패'); }
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

  // 💡 [신규 추가] 데이터를 UI와 DB에서 통째로 날려버리는 기능
  const deleteTask = async (id) => {
    if (!window.confirm('이 예약을 명단에서 완전히 삭제하시겠습니까? (장부 데이터는 유지됩니다)')) return;
    await fetch(`${BACKEND_URL}/api/reservations/${id}`, { method: 'DELETE' });
    fetchReservations();
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Haewoo AutoDesk</h1>
        <div style={styles.uploadWrapper}>
          <label htmlFor="jsonUpload" style={styles.uploadLabel}>☁️ 명단 업로드</label>
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
                
                {/* 💡 이모지, 방 글자 삭제 및 심플 텍스트 반영 */}
                <td style={styles.td}>{user.lockerId} ({user.pw})</td>
                
                <td style={styles.td}>
                  {user.talkId ? (
                    <span style={{color: '#334155', fontWeight: '600', fontSize: '13px', whiteSpace: 'nowrap'}}>
                      {user.talkId.substring(0, 15)}...
                    </span>
                  ) : (
                    <span style={{color: '#94A3B8', fontSize: '13px'}}>미연동</span>
                  )}
                </td>
                <td style={styles.td}>
                  <span style={styles.badge(user.status)}>{translateStatus(user.status)}</span>
                </td>
                <td style={styles.td}>
                  {user.status !== 'SENT' && (
                    <button onClick={() => openMappingPopup(user)} style={user.talkId ? styles.btnWarning : styles.btnPrimary}>
                      {user.talkId ? 'ID 변경' : 'ID 연결'}
                    </button>
                  )}
                  {user.status === 'SCHEDULED' && (
                    <button onClick={() => cancelTask(user._id)} style={styles.btnCancel}>취소</button>
                  )}
                  {/* 💡 우측 끝에 삭제 버튼 추가 */}
                  <button onClick={() => deleteTask(user._id)} style={styles.btnDelete}>삭제</button>
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
            <p style={{color: '#64748B', marginBottom: '25px'}}>대상: <strong>{activePopupUser.name}</strong></p>
            
            <div style={{maxHeight: '400px', overflowY: 'auto', marginBottom: '20px'}}>
              {webhookList.length === 0 ? (
                <p style={{textAlign: 'center', padding: '40px', color: '#94A3B8'}}>수집된 대화가 없습니다.</p>
              ) : (
                webhookList.map(chat => (
                  <div key={chat._id} style={styles.chatItem}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                      <span style={{fontSize: '12px', color: '#94A3B8'}}>{new Date(chat.receivedAt).toLocaleTimeString()}</span>
                      <button onClick={() => connectTalkId(chat.talkId)} style={styles.btnPrimary}>선택</button>
                    </div>
                    <div style={{fontWeight: '500', color: '#334155'}}>{chat.lastMessage}</div>
                  </div>
                ))
              )}
            </div>
            <button onClick={() => setActivePopupUser(null)} style={{width: '100%', padding: '16px', borderRadius: '16px', border: 'none', background: '#F1F5F9', cursor: 'pointer', fontWeight: '800'}}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;