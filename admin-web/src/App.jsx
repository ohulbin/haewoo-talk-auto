import React, { useState, useEffect } from 'react';

const styles = {
  container: { padding: '24px 32px', backgroundColor: '#F1F5F9', minHeight: '100vh', fontFamily: "'Pretendard', sans-serif", color: '#1E293B' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  title: { fontSize: '24px', fontWeight: '900', color: '#1E40AF', margin: 0, letterSpacing: '-0.5px' },
  uploadLabel: { 
    display: 'inline-flex', alignItems: 'center', gap: '6px', backgroundColor: '#2563EB', color: '#fff', 
    padding: '10px 16px', borderRadius: '10px', fontWeight: '700', fontSize: '13px', cursor: 'pointer'
  },
  fileInput: { display: 'none' },
  card: { backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', padding: '20px' },
  // 💡 가로 스크롤 완전 제거 + 완벽한 원화면 압축 픽스드 스타일 구조화
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }, 
  th: { padding: '12px 6px', borderBottom: '2px solid #E2E8F0', color: '#64748B', fontWeight: '700', fontSize: '13px', textAlign: 'center', whiteSpace: 'nowrap' },
  td: { padding: '12px 6px', borderBottom: '1px solid #F1F5F9', fontSize: '13px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  badge: (status) => ({
    padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '800', color: '#fff', display: 'inline-block',
    backgroundColor: status === 'SENT' ? '#10B981' : status === 'SCHEDULED' ? '#3B82F6' : status === 'CANCELLED' ? '#EF4444' : '#64748B'
  }),
  actionBtn: (color) => ({
    padding: '4px 8px', borderRadius: '6px', border: 'none', fontWeight: '700', fontSize: '11px', cursor: 'pointer',
    backgroundColor: color === 'blue' ? '#EFF6FF' : color === 'red' ? '#FEF2F2' : '#F8FAFC',
    color: color === 'blue' ? '#2563EB' : color === 'red' ? '#DC2626' : '#64748B',
    border: `1px solid ${color === 'blue' ? '#BFDBFE' : color === 'red' ? '#FECACA' : '#E2E8F0'}`,
    margin: '0 1px'
  }),
  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: '#fff', padding: '24px', borderRadius: '20px', width: '420px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' },
  scrollArea: { maxHeight: '340px', overflowY: 'auto', paddingRight: '4px', marginTop: '12px' }, 
  chatItem: { backgroundColor: '#F8FAFC', padding: '12px', borderRadius: '10px', marginBottom: '8px', border: '1px solid #E2E8F0' },
  searchInput: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', marginBottom: '8px', outline: 'none', fontSize: '13px' }
};

const statusMap = { READY: '대기중', SCHEDULED: '발송예약', SENT: '발송완료', FAILED: '실패', CANCELLED: '취소됨' };

function App() {
  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null);
  const [webhookList, setWebhookList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com';

  useEffect(() => { 
    fetchReservations();
    const timer = setInterval(fetchReservations, 5000);
    return () => clearInterval(timer);
  }, []);

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations`);
      const data = await res.json();
      setReservedList(data);
    } catch (e) {}
  };

  const handleJsonUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      let extracted = [];
      try {
        const data = JSON.parse(event.target.result);
        const uniqueCombinedSet = new Set(); 

        for (const lockerKey in data.lockers) {
          const items = data.lockers[lockerKey];
          if (!Array.isArray(items)) continue;

          items.forEach(item => {
            if (item.status === 'reserved' && item.contact) {
              
              // 💡 [시간 누락 완전 방어막] 시작 날짜나 시작 시간이 비어있는 불량 데이터는 스킵 처리!
              if (!item.startDate || !item.startTime || item.startTime.trim() === "") return;

              const combinedKey = `${item.contact}_${lockerKey}`;

              if (!uniqueCombinedSet.has(combinedKey)) {
                uniqueCombinedSet.add(combinedKey);
                const dt = `${item.startDate}T${item.startTime}:00+09:00`;
                extracted.push({
                  name: item.name,
                  phone: item.contact,
                  reservationTime: dt,
                  lockerId: lockerKey, 
                  pw: item.pw
                });
              }
            }
          });
        }
      } catch (err) { return alert('파일 해석 실패'); }

      if (extracted.length === 0) return alert('불러올 예약 데이터가 없습니다. (시간 누락 데이터 점검 요망)');

      try {
        const res = await fetch(`${BACKEND_URL}/api/reservations/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(extracted)
        });
        const result = await res.json();
        if (result.success) setReservedList(result.data);
      } catch (e) { alert('서버 연결 실패'); }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const openPopup = async (user) => {
    setActivePopupUser(user);
    setSearchTerm('');
    const res = await fetch(`${BACKEND_URL}/api/webhook-captures`);
    const data = await res.json();
    setWebhookList(data);
  };

  const connectId = async (tid) => {
    await fetch(`${BACKEND_URL}/api/scheduler/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activePopupUser._id, talkId: tid })
    });
    setActivePopupUser(null);
    fetchReservations();
  };

  const cancelTask = async (id) => {
    if (window.confirm('발송 예약을 취소하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/reservations/${id}/cancel`, { method: 'POST' });
      fetchReservations();
    }
  };

  const deleteTask = async (id) => {
    if (window.confirm('명단에서 완전히 삭제하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/reservations/${id}`, { method: 'DELETE' });
      fetchReservations();
    }
  };

  const filteredWebhook = webhookList.filter(c => c.lastMessage.includes(searchTerm));

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Haewoo Auto Schedule (합정점)</h1>
        <label style={styles.uploadLabel}>
          <span>📤 명단 업로드</span>
          <input type="file" accept=".json" onChange={handleJsonUpload} style={styles.fileInput} />
        </label>
      </header>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              {/* 💡 비율 칼각 할당으로 절대 줄바꿈이나 영역 깨짐이 나지 않도록 정밀 밸런싱 */}
              <th style={{...styles.th, width: '10%'}}>고객명</th>
              <th style={{...styles.th, width: '15%'}}>연락처</th>
              <th style={{...styles.th, width: '22%'}}>예약 시간</th>
              <th style={{...styles.th, width: '13%'}}>보관함(비번)</th>
              <th style={{...styles.th, width: '15%'}}>톡톡 ID</th>
              <th style={{...styles.th, width: '10%'}}>상태</th>
              <th style={{...styles.th, width: '15%'}}>관리</th>
            </tr>
          </thead>
          <tbody>
            {reservedList.map(u => (
              <tr key={u._id}>
                <td style={{...styles.td, fontWeight: '800'}}>{u.name || '이름없음'}</td>
                <td style={styles.td}>{u.phone}</td>
                <td style={styles.td}>{new Date(u.reservationTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td style={{...styles.td, fontWeight: '600'}}>{u.lockerId}번 ({u.pw})</td>
                <td style={{...styles.td, fontSize: '12px', color: '#64748B'}} title={u.talkId}>
                  {u.talkId ? u.talkId.substring(0, 12) + '...' : '미연동'}
                </td>
                <td style={styles.td}>
                  <span style={styles.badge(u.status)}>{statusMap[u.status]}</span>
                </td>
                <td style={styles.td}>
                  {u.status !== 'SENT' && (
                    <button onClick={() => openPopup(u)} style={styles.actionBtn('blue')}>{u.talkId ? '변경' : '연결'}</button>
                  )}
                  {u.status === 'SCHEDULED' && <button onClick={() => cancelTask(u._id)} style={styles.actionBtn('red')}>취소</button>}
                  <button onClick={() => deleteTask(u._id)} style={styles.actionBtn('gray')}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activePopupUser && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h3 style={{marginTop: 0, color: '#1E40AF', fontSize: '16px'}}>고객 ID 매칭: {activePopupUser.name}</h3>
            <input 
              style={styles.searchInput} 
              placeholder="🔍 메시지 내용 검색..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
            />
            <div style={styles.scrollArea}>
              {filteredWebhook.map(c => (
                <div key={c._id} style={styles.chatItem}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <span style={{fontSize: '11px', color: '#94A3B8'}}>{new Date(c.receivedAt).toLocaleTimeString()}</span>
                    <button onClick={() => connectId(c.talkId)} style={styles.actionBtn('blue')}>매칭</button>
                  </div>
                  <div style={{marginTop: '6px', fontSize: '13px', fontWeight: '500'}}>{c.lastMessage}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setActivePopupUser(null)} style={{width: '100%', marginTop: '16px', padding: '10px', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', background: '#F1F5F9', fontSize: '13px'}}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;