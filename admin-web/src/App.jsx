// admin-web/src/App.jsx
import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [reservedList, setReservedList] = useState([]);
  const [stats, setStats] = useState({ total: 0, ready: 0, scheduled: 0 });

  // JSON 파싱 및 데이터 정제
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileReader = new FileReader();
    fileReader.readAsText(file, "UTF-8");
    fileReader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const lockers = parsed.lockers || {};
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
                  talkId: '',
                  status: 'READY'
                };
              }
            }
          });
        });

        const list = Object.values(uniqueTargets);
        setReservedList(list);
        updateStats(list);
      } catch (error) {
        alert("올바른 JSON 파일 형식이 아닙니다.");
      }
    };
  };

  const updateStats = (list) => {
    setStats({
      total: list.length,
      ready: list.filter(i => i.status === 'READY').length,
      scheduled: list.filter(i => i.status === 'SCHEDULED').length
    });
  };

  const handleIdChange = (id, val) => {
    const newList = reservedList.map(item => 
      item.id === id ? { ...item, talkId: val } : item
    );
    setReservedList(newList);
  };

  const registerTask = async (user) => {
    if (!user.talkId) return alert('톡톡 고유 ID를 입력해주세요.');

    try {
      // Render 배포 후에는 본인의 backend URL로 변경 필요
      const response = await fetch('https://haewoo-talk-auto.onrender.com/api/scheduler/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });

      if (response.ok) {
        const newList = reservedList.map(item => 
          item.id === user.id ? { ...item, status: 'SCHEDULED' } : item
        );
        setReservedList(newList);
        updateStats(newList);
        alert(`${user.name}님 발송 예약이 완료되었습니다.`);
      }
    } catch (err) {
      alert('서버 연결 실패. 백엔드가 실행 중인지 확인하세요.');
    }
  };

  return (
    <div className="container">
      <header>
        <h1>HAEWOO <span style={{color:'white'}}>TALK-AUTO</span></h1>
        <div className="status-badge status-scheduled">Server Online</div>
      </header>

      <section className="upload-section">
        <label className="upload-label">
          <input type="file" accept=".json" onChange={handleFileUpload} />
          <i className="fa-solid fa-file-circle-plus"></i>
          <p>클릭하여 <b>JSON 백업 파일</b>을 업로드하세요</p>
          <span style={{fontSize:'0.8rem', color:'var(--text-dim)'}}>대표님 프로그램에서 추출한 파일을 넣으시면 됩니다.</span>
        </label>
      </section>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">전체 예약</div>
          <div className="value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="label">ID 미입력</div>
          <div className="value" style={{color:'var(--warning)'}}>{stats.ready}</div>
        </div>
        <div className="stat-card">
          <div className="label">발송 예약됨</div>
          <div className="value" style={{color:'var(--success)'}}>{stats.scheduled}</div>
        </div>
      </div>

      <div className="list-header">
        <h3>예약자 관리 리스트</h3>
        <span style={{color:'var(--text-dim)', fontSize:'0.9rem'}}>총 {reservedList.length}명</span>
      </div>

      <div className="list-container">
        {reservedList.map((user) => (
          <div className="customer-card" key={user.id}>
            <div className="locker-badge">{user.lockerNum}번함</div>
            <div className="info-group">
              <div className="name">{user.name}</div>
              <div className="time">{user.startDate} {user.startTime}</div>
            </div>
            <div className="input-group">
              <input 
                type="text" 
                placeholder="톡톡 ID 입력 (W_...)" 
                value={user.talkId}
                disabled={user.status === 'SCHEDULED'}
                onChange={(e) => handleIdChange(user.id, e.target.value)}
              />
            </div>
            <div className="status-group">
              <div className={`status-badge ${user.status === 'READY' ? 'status-ready' : 'status-scheduled'}`}>
                {user.status === 'READY' ? '대기 중' : '예약 완료'}
              </div>
            </div>
            <button 
              className="btn-submit"
              disabled={user.status === 'SCHEDULED'}
              onClick={() => registerTask(user)}
            >
              {user.status === 'READY' ? '발송 예약' : '완료'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;