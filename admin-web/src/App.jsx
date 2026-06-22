import React, { useState, useEffect } from 'react';

// 💡 [UI 개편] 토스(Toss) 스타일 컬러 팔레트
const theme = {
  bg: '#F2F4F6',          
  surface: '#FFFFFF',     
  textMain: '#191F28',    
  textSub: '#4E5968',     
  textMute: '#8B95A1',    
  primary: '#3182F6',     
  primaryLight: '#E8F3FF',
  success: '#31B46E',     
  successLight: '#E4F4EC',
  danger: '#F04452',      
  dangerLight: '#FEECEF',
  border: '#E5E8EB'
};

const styles = {
  container: { padding: '32px 40px', backgroundColor: theme.bg, minHeight: '100vh', fontFamily: "'Pretendard', sans-serif", color: theme.textMain, position: 'relative' },
  
  headerContainer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' },
  title: { fontSize: '26px', fontWeight: '800', color: theme.textMain, margin: 0, letterSpacing: '-0.6px' },
  logoutBtn: { fontSize: '12px', color: theme.textMute, fontWeight: '600', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', backgroundColor: theme.surface, border: `1px solid ${theme.border}`, transition: 'all 0.2s' },

  dropZone: (isDragging) => ({
    padding: '10px 18px',
    backgroundColor: isDragging ? theme.primaryLight : theme.surface,
    border: `2px dashed ${isDragging ? theme.primary : '#D1D5DB'}`,
    borderRadius: '12px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
    fontSize: '14px',
    fontWeight: '700',
    color: theme.textMain
  }),
  
  summaryContainer: { display: 'flex', gap: '20px', marginBottom: '28px' },
  summaryBox: {
    padding: '16px 20px', backgroundColor: theme.surface, borderRadius: '18px', 
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)', flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: 'default'
  },
  summaryLabel: { fontSize: '14px', color: theme.textSub, fontWeight: '600', letterSpacing: '-0.3px' },
  summaryValue: (color) => ({ fontSize: '24px', fontWeight: '800', color: color, letterSpacing: '-0.5px' }),

  card: { backgroundColor: theme.surface, borderRadius: '24px', boxShadow: '0 4px 24px rgba(0, 0, 0, 0.04)', padding: '24px', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }, 
  th: { padding: '16px 8px', borderBottom: `2px solid ${theme.border}`, color: theme.textMute, fontWeight: '600', fontSize: '14px', textAlign: 'center', whiteSpace: 'nowrap' },
  td: { padding: '18px 8px', borderBottom: `1px solid ${theme.bg}`, fontSize: '14px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: theme.textSub },
  
  // 💡 [수정] 배지 색상을 꽉 찬 원색 배경 + 흰색 글씨로 변경하여 가독성 및 직관성 극대화
  badge: (status) => {
    let bg;
    const text = '#FFFFFF'; // 글씨는 모두 흰색으로 통일
    
    if (status === 'SENT') { bg = theme.success; } // 꽉 찬 초록
    else if (status === 'SCHEDULED') { bg = theme.primary; } // 꽉 찬 파랑
    else if (status === 'CANCELLED') { bg = theme.danger; } // 꽉 찬 빨강
    else { bg = '#8B95A1'; } // READY (대기중) - 차분하고 진한 회색
    
    return {
      padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', color: text, backgroundColor: bg, display: 'inline-block'
    };
  },
  
  actionBtn: (color) => {
    let bg, text;
    if (color === 'blue') { bg = theme.primaryLight; text = theme.primary; }
    else if (color === 'red') { bg = theme.dangerLight; text = theme.danger; }
    else { bg = theme.bg; text = theme.textSub; }
    return {
      padding: '8px 12px', borderRadius: '10px', border: 'none', fontWeight: '700', fontSize: '12px', cursor: 'pointer',
      backgroundColor: bg, color: text, margin: '0 3px', transition: 'all 0.2s ease'
    };
  },

  modalOverlay: { position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalContent: { backgroundColor: theme.surface, padding: '32px', borderRadius: '24px', width: '440px', boxShadow: '0 24px 48px rgba(0,0,0,0.12)' },
  
  floatingAssignee: {
    position: 'absolute',
    bottom: '24px', 
    left: '24px',   
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    zIndex: 100,
    transition: 'transform 0.2s ease',
  },
  assigneeLabel: {
    backgroundColor: '#FFFFFF',
    padding: '4px 10px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    fontSize: '11px',
    fontWeight: '700',
    color: '#6B7684'
  },
  assigneeBtn: (isAssigned) => ({
    padding: '8px 16px',
    borderRadius: '20px',
    border: isAssigned ? 'none' : '1.5px dashed #3182F6',
    backgroundColor: isAssigned ? '#3182F6' : '#FFFFFF',
    color: isAssigned ? '#FFFFFF' : '#3182F6',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    transition: 'all 0.2s ease'
  }),

  loginContainer: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg, fontFamily: "'Pretendard', sans-serif" },
  loginBox: { backgroundColor: theme.surface, padding: '48px', borderRadius: '28px', boxShadow: '0 12px 32px rgba(0,0,0,0.05)', width: '360px', display: 'flex', flexDirection: 'column', gap: '16px' },
  inputField: { padding: '16px', borderRadius: '14px', border: 'none', backgroundColor: theme.bg, fontSize: '15px', outline: 'none', fontWeight: '500', transition: 'box-shadow 0.2s ease' },
  loginBtn: { padding: '16px', borderRadius: '14px', backgroundColor: theme.primary, color: '#fff', border: 'none', fontWeight: '800', fontSize: '16px', cursor: 'pointer', marginTop: '16px', transition: 'background 0.2s ease' },
  checkboxRow: { display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: theme.textSub, alignItems: 'center', fontWeight: '500' }
};

const statusMap = { READY: '대기중', SCHEDULED: '발송예약', SENT: '발송완료', FAILED: '실패', CANCELLED: '취소됨' };

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [saveId, setSaveId] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);

  const [reservedList, setReservedList] = useState([]);
  const [activePopupUser, setActivePopupUser] = useState(null);
  const [webhookList, setWebhookList] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [assigneeName, setAssigneeName] = useState('');
  
  // ⭐ [추가됨] 체크된 명단의 ID를 담는 배열 상태
  const [selectedIds, setSelectedIds] = useState([]);

  const BACKEND_URL = 'https://haewoo-talk-auto.onrender.com';

  useEffect(() => {
    const isAuto = localStorage.getItem('hw_autoLogin') === 'true';
    const saved = localStorage.getItem('hw_savedId');
    if (saved) { setLoginId(saved); setSaveId(true); }
    if (isAuto) { setIsAuthenticated(true); setAutoLogin(true); }

    const savedAssignee = localStorage.getItem('hw_assignee');
    if (savedAssignee) setAssigneeName(savedAssignee);
  }, []);

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

  const processFile = (file) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      let extracted = [];
      let accessoryLockerPw = "";
      
      try {
        const data = JSON.parse(event.target.result);
        const uniqueCombinedSet = new Set();
        accessoryLockerPw = data.lockers?.["3"]?.[0]?.pw || "";

        for (const lockerKey in data.lockers) {
          const items = data.lockers[lockerKey];
          if (!Array.isArray(items)) continue;

          items.forEach(item => {
            if (item.status === 'reserved' && item.contact) {
              if (!item.startDate || !item.startTime || item.startTime.trim() === "") return;

              const combinedKey = `${item.contact}_${lockerKey}`;

              if (!uniqueCombinedSet.has(combinedKey)) {
                // 현재 화면(reservedList)에 이미 'SENT' 상태로 존재하는 예약이라면?
                // 서버로 보낼 업로드 배열에 아예 포함시키지 않고 스킵합니다!
                const isAlreadySent = reservedList.some(
                  r => r.phone === item.contact && r.lockerId === lockerKey && r.status === 'SENT'
                );
                
                if (isAlreadySent) {
                  return; // forEach문 안에서 return은 continue와 같음 (추출 스킵)
                }

                uniqueCombinedSet.add(combinedKey);
                const dt = `${item.startDate}T${item.startTime}:00+09:00`;
                extracted.push({
                  name: item.name,
                  phone: item.contact,
                  reservationTime: dt,
                  lockerId: lockerKey, 
                  pw: item.pw,
                  accessories: item.accessories || [],
                  equipment: item.item || "" 
                });
              }
            }
          });
        }
      } catch (err) { return alert('파일 해석 실패. 올바른 JSON 파일인지 확인해주세요.'); }

      if (extracted.length === 0) return alert('불러올 예약 데이터가 없습니다. (시간 누락 데이터 점검 요망)');

      try {
        const res = await fetch(`${BACKEND_URL}/api/reservations/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reservations: extracted, accessoryLockerPw })
        });

        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
          setReservedList(result.data);
          alert(`✅ 성공적으로 ${extracted.length}건의 예약 명단이 업로드되었습니다.`);
        }
      } catch (e) { alert(e.message); }
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e) => {
    processFile(e.target.files[0]);
    e.target.value = null; 
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const fetchReservations = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reservations`);
      const data = await res.json();
      if (Array.isArray(data)) setReservedList(data);
    } catch (e) {}
  };

  const fetchWebhookList = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/webhook-captures`);
      const data = await res.json();
      if (Array.isArray(data)) setWebhookList(data);
    } catch (e) {}
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

  const deleteWebhook = async (id) => {
    if (window.confirm('이 문의 내역을 수신함에서 영구 삭제하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/webhook-captures/${id}`, { method: 'DELETE' });
      fetchWebhookList(); 
    }
  };

  const cancelTask = async (id) => {
    if (window.confirm('발송 예약을 취소하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/reservations/${id}/cancel`, { method: 'POST' });
      fetchReservations();
    }
  };

  // 기존 삭제 기능은 그대로 유지하되, 현재 개별 삭제 버튼은 주석/삭제 처리됨.
  const deleteTask = async (id) => {
    if (window.confirm('명단에서 완전히 삭제하시겠습니까?')) {
      await fetch(`${BACKEND_URL}/api/reservations/${id}`, { method: 'DELETE' });
      fetchReservations();
    }
  };

  const handleAssigneeClick = () => {
    const name = window.prompt('담당자 이름을 입력해주세요.\n(입력창을 비우고 확인을 누르면 담당자가 해제됩니다.)', assigneeName);
    
    if (name !== null) { 
      const trimmedName = name.trim();
      setAssigneeName(trimmedName);
      
      if (trimmedName) {
        localStorage.setItem('hw_assignee', trimmedName);
      } else {
        localStorage.removeItem('hw_assignee');
      }
    }
  };

  // ⭐ [추가됨] 체크박스 전체 선택 / 해제 토글 핸들러
  const handleToggleSelectAll = (e) => {
    if (e.target.checked) {
      // safeReservedList의 모든 ID를 배열로 맵핑해서 넣음
      setSelectedIds(safeReservedList.map(u => u._id));
    } else {
      setSelectedIds([]);
    }
  };

  // ⭐ [추가됨] 개별 체크박스 토글 핸들러
  const handleToggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // ⭐ [추가됨] 선택된 명단 일괄 삭제 핸들러 (기존 DELETE API를 Promise.all로 병렬 요청)
  const handleDeleteSelected = async () => {
    if (!window.confirm(`선택한 ${selectedIds.length}개의 명단을 완전히 삭제하시겠습니까?`)) return;

    try {
      await Promise.all(
        selectedIds.map(id => fetch(`${BACKEND_URL}/api/reservations/${id}`, { method: 'DELETE' }))
      );
      setSelectedIds([]); // 삭제 후 선택 초기화
      fetchReservations(); // 명단 새로고침
    } catch (e) {
      alert("일괄 삭제 중 오류가 발생했습니다.");
    }
  };

  const safeReservedList = Array.isArray(reservedList) ? reservedList : [];
  const safeWebhookList = Array.isArray(webhookList) ? webhookList : [];

  const filteredWebhook = safeWebhookList.filter(c => c?.lastMessage?.includes(searchTerm));
  const sentCount = safeReservedList.filter(u => u.status === 'SENT').length;
  const scheduledCount = safeReservedList.filter(u => u.status === 'SCHEDULED').length;
  const readyCount = safeReservedList.filter(u => u.status === 'READY').length;
  const cancelledCount = safeReservedList.filter(u => u.status === 'CANCELLED').length;

  if (!isAuthenticated) {
    return (
      <div style={styles.loginContainer}>
        <style>{`
          .input-focus:focus { box-shadow: 0 0 0 2px #3182F6 inset; }
          .btn-hover:hover { background: #1B64DA !important; }
        `}</style>
        <form style={styles.loginBox} onSubmit={handleLoginSubmit}>
          <h2 style={{ color: theme.textMain, textAlign: 'center', margin: '0 0 16px 0', fontWeight: '800', fontSize: '22px', letterSpacing: '-0.5px' }}>
            해우카메라<br/><span style={{ color: theme.primary }}>오토 스케줄러</span>
          </h2>
          <input 
            type="text" placeholder="아이디" style={styles.inputField} className="input-focus"
            value={loginId} onChange={e => setLoginId(e.target.value)} required 
          />
          <input 
            type="password" placeholder="비밀번호" style={styles.inputField} className="input-focus"
            value={loginPw} onChange={e => setLoginPw(e.target.value)} required 
          />
          <div style={styles.checkboxRow}>
            <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
              <input type="checkbox" checked={saveId} onChange={e => setSaveId(e.target.checked)} style={{accentColor: theme.primary, width: '16px', height: '16px'}} />
              아이디 저장
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
              <input type="checkbox" checked={autoLogin} onChange={e => setAutoLogin(e.target.checked)} style={{accentColor: theme.primary, width: '16px', height: '16px'}} />
              자동 로그인
            </label>
          </div>
          <button type="submit" style={styles.loginBtn} className="btn-hover">시작하기</button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes modalFade { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animated-modal { animation: modalFade 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .hover-row { transition: background-color 0.2s ease; }
        .hover-row:hover { background-color: #F9FAFB; }
        .hover-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.06) !important; }
        .btn-action:hover { filter: brightness(0.95); transform: scale(0.98); }
        .input-focus:focus { box-shadow: 0 0 0 2px #3182F6 inset; }
        .logout-btn:hover { background-color: #FEECEF !important; color: #F04452 !important; border-color: #F04452 !important; }
        .floating-hover:hover { transform: translateY(-4px); }
        .dropzone-hover:hover { border-color: ${theme.primary} !important; color: ${theme.primary} !important; }
        
        ::-webkit-scrollbar { display: none; }
        * { -ms-overflow-style: none; scrollbar-width: none; }
        
        /* ⭐ [추가됨] 플로팅 삭제 버튼 애니메이션 CSS (토스 스타일 개선) */
        .floating-delete-bar {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%) translateY(150px);
          background-color: #333D4B;
          color: #FFFFFF;
          padding: 14px 20px 14px 28px;
          border-radius: 32px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
          display: flex;
          align-items: center;
          gap: 24px;
          transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease;
          z-index: 1000;
          opacity: 0;
          backdrop-filter: blur(8px);
        }
        .floating-delete-bar.show {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
      `}</style>

      <header style={styles.headerContainer}>
        <h1 style={styles.title}>Haewoo Auto Schedule <span style={{fontSize: '20px', color: theme.textMute, fontWeight: '600'}}>(합정점)</span></h1>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={styles.dropZone(isDragging)}
            className="dropzone-hover"
          >
            명단 업로드
            <input type="file" accept=".json" onChange={handleFileInput} style={{ display: 'none' }} />
          </label>
          <span onClick={handleLogout} style={styles.logoutBtn} className="logout-btn">로그아웃</span>
        </div>
      </header>

      <div style={styles.summaryContainer}>
        <div style={styles.summaryBox} className="hover-card">
          <span style={styles.summaryLabel}>발송완료</span>
          <span style={styles.summaryValue(theme.success)}>{sentCount}명</span>
        </div>
        <div style={styles.summaryBox} className="hover-card">
          <span style={styles.summaryLabel}>발송예약</span>
          <span style={styles.summaryValue(theme.primary)}>{scheduledCount}명</span>
        </div>
        <div style={styles.summaryBox} className="hover-card">
          <span style={styles.summaryLabel}>대기중</span>
          <span style={styles.summaryValue(theme.textMain)}>{readyCount}명</span>
        </div>
        <div style={styles.summaryBox} className="hover-card">
          <span style={styles.summaryLabel}>취소됨</span>
          <span style={styles.summaryValue(theme.danger)}>{cancelledCount}명</span>
        </div>
      </div>

      <div style={styles.card}>
        <table style={styles.table}>
          <thead>
            <tr>
              {/* ⭐ [추가됨] 전체 선택 체크박스 열 */}
              <th style={{...styles.th, width: '4%'}}>
                <input 
                  type="checkbox" 
                  checked={selectedIds.length === safeReservedList.length && safeReservedList.length > 0} 
                  onChange={handleToggleSelectAll} 
                  style={{cursor: 'pointer', accentColor: theme.primary, width: '16px', height: '16px'}}
                />
              </th>
              <th style={{...styles.th, width: '7%'}}>고객명</th>
              <th style={{...styles.th, width: '11%'}}>연락처</th>
              <th style={{...styles.th, width: '14%'}}>예약 시간</th>
              <th style={{...styles.th, width: '15%'}}>대여 기기</th>
              <th style={{...styles.th, width: '12%'}}>악세사리</th>
              <th style={{...styles.th, width: '9%'}}>보관함(비번)</th>
              <th style={{...styles.th, width: '10%'}}>톡톡 ID</th>
              <th style={{...styles.th, width: '7%'}}>상태</th>
              <th style={{...styles.th, width: '11%'}}>관리</th> 
            </tr>
          </thead>
          <tbody>
            {safeReservedList.map(u => {
              const displayEquipment = u.equipment || '-';
              const displayAccessories = Array.isArray(u.accessories) && u.accessories.length > 0 ? u.accessories.join(', ') : '-';
              
            return (
              <tr 
                key={u._id} 
                className="hover-row"
                onClick={() => handleToggleSelect(u._id)} // 💡 행 클릭 시 체크 토글
                style={{ cursor: 'pointer' }} // 💡 클릭 가능한 영역임을 마우스 커서로 표시
              >
                {/* ⭐ [추가됨] 개별 체크박스 */}
                <td style={styles.td}>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(u._id)} 
                    onChange={() => handleToggleSelect(u._id)} 
                    onClick={(e) => e.stopPropagation()} // 💡 체크박스 직접 클릭 시 이벤트 중복 실행 방지
                    style={{cursor: 'pointer', accentColor: theme.primary, width: '16px', height: '16px'}}
                  />
                </td>
                <td style={{...styles.td, fontWeight: '700', color: theme.textMain}}>{u.name || '이름없음'}</td>
                <td style={styles.td}>{u.phone}</td>
                <td style={{...styles.td, fontWeight: '500'}}>{new Date(u.reservationTime).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                
                <td style={styles.td} title={displayEquipment}>{displayEquipment}</td>
                <td style={{...styles.td, color: theme.textMute}} title={displayAccessories}>{displayAccessories}</td>

                <td style={{...styles.td, fontWeight: '700', color: theme.textMain}}>
                  {Number(u.lockerId) >= 10000 ? '외부 보관' : `${u.lockerId}번`} <span style={{color: theme.textMute, fontWeight: '500'}}>({u.pw})</span>
                </td>

                <td style={{...styles.td, fontSize: '13px', color: theme.textMute}} title={u.talkId}>
                  {u.talkId ? u.talkId.substring(0, 12) + '...' : '미연동'}
                </td>
                <td style={styles.td}>
                  <span style={styles.badge(u.status)}>{statusMap[u.status]}</span>
                </td>
                
                <td style={{...styles.td, overflow: 'visible', textOverflow: 'clip'}}>
                  {u.status !== 'SENT' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); openPopup(u); }} // 💡 관리 버튼 클릭 시 행(Row) 선택되는 현상 방지
                      style={styles.actionBtn('blue')} 
                      className="btn-action"
                    >
                      {u.talkId ? '변경' : '연결'}
                    </button>
                  )}
                  {u.status === 'SCHEDULED' && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); cancelTask(u._id); }} // 💡 관리 버튼 클릭 시 행(Row) 선택되는 현상 방지
                      style={styles.actionBtn('red')} 
                      className="btn-action"
                    >
                      취소
                    </button>
                  )}
                  {/* ⭐ 기존 단건 삭제 버튼은 제거되었습니다. */}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {activePopupUser && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent} className="animated-modal">
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: theme.textMain, fontSize: '18px', fontWeight: '800', letterSpacing: '-0.5px' }}>
                고객 ID 매칭: <span style={{ color: theme.primary }}>{activePopupUser.name}</span>
              </h3>
              <span style={{ fontSize: '13px', fontWeight: '700', color: theme.primary, backgroundColor: theme.primaryLight, padding: '4px 10px', borderRadius: '12px' }}>
                총 {filteredWebhook.length}건
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
              <input 
                style={{
                  width: '75%', padding: '12px 20px', borderRadius: '30px', border: '1px solid #E5E8EB',
                  backgroundColor: '#F9FAFB', color: theme.textMain, outline: 'none', fontSize: '14px', fontWeight: '500',
                  textAlign: 'center', transition: 'all 0.2s ease'
                }}
                className="input-focus"
                placeholder="🔍 메시지 내용 검색..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <div style={{ maxHeight: '400px', overflowY: 'auto', overflowX: 'hidden' }}>
              {filteredWebhook.map(c => (
                <div key={c._id} style={{ backgroundColor: theme.bg, padding: '18px', borderRadius: '16px', marginBottom: '12px', border: 'none' }}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
                    <span style={{fontSize: '12px', color: theme.textMute, fontWeight: '600'}}>
                      {(() => {
                        const d = new Date(c.receivedAt);
                        const days = ['일', '월', '화', '수', '목', '금', '토'];
                        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}(${days[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                      })()}
                    </span>
                    <div>
                      <button onClick={() => connectId(c.talkId)} style={styles.actionBtn('blue')} className="btn-action">매칭</button>
                      <button onClick={() => deleteWebhook(c._id)} style={styles.actionBtn('gray')} className="btn-action">삭제</button>
                    </div>
                  </div>
                  
                  <div style={{fontSize: '14.5px', fontWeight: '500', color: theme.textMain, lineHeight: '1.5', textAlign: 'left', wordBreak: 'keep-all', whiteSpace: 'pre-wrap'}}>
                    {c.lastMessage}
                  </div>
                </div>
              ))}
            </div>
            
            <button onClick={() => setActivePopupUser(null)} style={{width: '100%', marginTop: '20px', padding: '16px', border: 'none', borderRadius: '14px', fontWeight: '700', cursor: 'pointer', background: '#E5E8EB', color: theme.textSub, fontSize: '15px'}} className="btn-action">닫기</button>
          </div>
        </div>
      )}

      {/* ⭐ [추가됨] 플로팅 일괄 삭제 버튼 */}
      <div className={`floating-delete-bar ${selectedIds.length > 0 ? 'show' : ''}`}>
        <span style={{fontWeight: '700', fontSize: '15px', letterSpacing: '-0.3px'}}>
          {selectedIds.length}개 선택됨
        </span>
        <button 
          onClick={handleDeleteSelected}
          style={{
            backgroundColor: theme.danger, color: '#FFFFFF', border: 'none', 
            padding: '12px 24px', borderRadius: '24px', fontWeight: '700', 
            fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(240, 68, 82, 0.3)',
            transition: 'all 0.2s ease', letterSpacing: '-0.3px'
          }}
          className="btn-action"
        >
          일괄 삭제
        </button>
      </div>

    </div>
  );
}

export default App;