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
  searchInput: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', marginBottom: '8px', outline: 'none', fontSize: '13px' },
  
  // 💡 [신규] 로그인 페이지 전용 스타일
  loginContainer: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#F1F5F9', fontFamily: "'Pretendard', sans-serif" },
  loginBox: { backgroundColor: '#fff', padding: '40px', borderRadius: '24px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', width: '320px', display: 'flex', flexDirection: 'column', gap: '16px' },
  inputField: { padding: '14px', borderRadius: '12px', border: '1px solid #CBD5E1', fontSize: '14px', outline: 'none' },
  loginBtn: { padding: '14px', borderRadius: '12px', backgroundColor: '#2563EB', color: '#fff', border: 'none', fontWeight: '800', fontSize: '15px', cursor: 'pointer', marginTop: '10px' },
  checkboxRow: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#64748B', alignItems: 'center' }
};

const statusMap = { READY: '대기중', SCHEDULED: '발송예약', SENT: '발송완료', FAILED: '실패', CANCELLED: '취소됨' };

function App() {
  // --- Auth States ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [saveId, setSaveId] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  // --- Data States ---
  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null);
  const [webhookList, setWebhookList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com';

  // 💡 [신규] 초기 로드 시 자동로그인 및 아이디 저장 체크
  useEffect(() => {
    const isAuto = localStorage.getItem('hw_autoLogin') === 'true';
    const saved = localStorage.getItem('hw_savedId');
    
    if (saved) {
      setLoginId(saved);
      setSaveId(true);
    }
    if (isAuto) {
      setIsAuthenticated(true);
      setAutoLogin(true);
    }
  }, []);

  // 대시보드 진입 후 주기적 데이터 페칭
  useEffect(() => { 
    if (!isAuthenticated) return;
    
    fetchReservations();
    const timer = setInterval(fetchReservations, 5000);
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (loginId === 'haewoo' && loginPw === 'haewoo12!') {
      setIsAuthenticated(true);
      
      if (saveId) localStorage.setItem('hw_savedId', loginId);
      else localStorage.removeItem('hw_savedId');

      if (autoLogin) localStorage.setItem('hw_autoLogin', 'true');
      else localStorage.removeItem('hw_autoLogin');
      
    } else {
      alert('아이디 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoginPw('');
    localStorage.removeItem('hw_autoLogin');
  };

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
      let accessoryLockerPw = "";
      
      try {
        const data = JSON.parse(event.target.result);
        const uniqueCombinedSet = new Set();
        const accessoryLockerPw =
          data.lockers?.["3"]?.[0]?.pw || "";

        for (const lockerKey in data.lockers) {
          const items = data.lockers[lockerKey];
          if (!Array.isArray(items)) continue;

          items.forEach(item => {
            if (item.status === 'reserved' && item.contact) {
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
                  pw: item.pw,
                  accessories: item.accessories || []
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
          body: JSON.stringify({
            reservations: extracted,
            accessoryLockerPw
          })
        });
        console.log('응답코드:', res.status);

        const result = await res.json();
        if (result.success) setReservedList(result.data);
      } catch (e) { 
        console.error(e);
        alert(e.message); 
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const fetchWebhookList = async () => {
    const res = await fetch(`${BACKEND_URL}/api/webhook-captures`);
    const data = await res.json();
    setWebhookList(data);
  };

  const openPopup = (user) => {
    setActivePopupUser(user);
    setSearchTerm('');
    fetchWebhookList();
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

  // 💡 [신규] 웹훅 삭제 및 팝업창 실시간 리렌더링
  const deleteWebhook = async (id) => {
    if (window.confirm('이 문의 내역을 수신함에서 영구 삭제하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/webhook-captures/${id}`, { method: 'DELETE' });
      fetchWebhookList(); // 팝업창 닫지 않고 리스트만 즉시 새로고침
    }
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

  // ------------------ 렌더링 영역 ------------------ //

  // 로그인되지 않은 상태면 로그인 폼 렌더링
  if (!isAuthenticated) {
    return (
      <div style={styles.loginContainer}>
        <form style={styles.loginBox} onSubmit={handleLoginSubmit}>
        <h2 style={{ color: '#1E40AF', textAlign: 'center', margin: '0 0 10px 0', fontWeight: 'bold' }}>Haewoo Auto Schedule</h2>
          <input 
            type="text" placeholder="아이디" style={styles.inputField} 
            value={loginId} onChange={e => setLoginId(e.target.value)} required 
          />
          <input 
            type="password" placeholder="비밀번호" style={styles.inputField} 
            value={loginPw} onChange={e => setLoginPw(e.target.value)} required 
          />
          <div style={styles.checkboxRow}>
            <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'}}>
              <input type="checkbox" checked={saveId} onChange={e => setSaveId(e.target.checked)} />
              아이디 저장
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer'}}>
              <input type="checkbox" checked={autoLogin} onChange={e => setAutoLogin(e.target.checked)} />
              자동 로그인
            </label>
          </div>
          <button type="submit" style={styles.loginBtn}>로그인</button>
        </form>
      </div>
    );
  }

  // 로그인 성공 시 대시보드 렌더링
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{display: 'flex', alignItems: 'baseline', gap: '16px'}}>
          <h1 style={styles.title}>Haewoo Auto Schedule (합정점)</h1>
          <span onClick={handleLogout} style={{fontSize: '13px', color: '#64748B', fontWeight: '600', cursor: 'pointer', textDecoration: 'underline'}}>로그아웃</span>
        </div>
        <label style={styles.uploadLabel}>
          <span>📤 명단 업로드</span>
          <input type="file" accept=".json" onChange={handleJsonUpload} style={styles.fileInput} />
        </label>
      </header>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
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
                    <span style={{fontSize: '11px', color: '#94A3B8'}}>
  {(() => {
    const d = new Date(c.receivedAt);
    const days = ['일', '월', '화', '수', '목', '금', '토'];

    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })()}
</span>
                    <div>
                      {/* 💡 [신규] 매칭 버튼 옆에 회색 삭제 버튼 추가 */}
                      <button onClick={() => connectId(c.talkId)} style={styles.actionBtn('blue')}>매칭</button>
                      <button onClick={() => deleteWebhook(c._id)} style={styles.actionBtn('gray')}>삭제</button>
                    </div>
                  </div>
                  <div style={{marginTop: '6px', fontSize: '13px', fontWeight: '500'}}>{c.lastMessage}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setActivePopupUser(null)} style={{width: '100%', marginTop: '16px', padding: '10px', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', background: '#ffffff', fontSize: '13px'}}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;