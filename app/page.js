'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, deleteDoc, getDoc, arrayUnion 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Play, Users, Crown, Copy, CheckCircle2, Link as LinkIcon, 
  Share2, AlertCircle, Palette, Eraser, Trash2, RefreshCw, PenTool, Check
} from 'lucide-react';

// ==================================================================
// [완료] 기존에 사용하시던 Firebase 설정값을 적용했습니다.
// ==================================================================
const firebaseConfig = {
  apiKey: "AIzaSyBPd5xk9UseJf79GTZogckQmKKwwogneco",
  authDomain: "test-4305d.firebaseapp.com",
  projectId: "test-4305d",
  storageBucket: "test-4305d.firebasestorage.app",
  messagingSenderId: "402376205992",
  appId: "1:402376205992:web:be662592fa4d5f0efb849d"
};

// --- Firebase Init ---
let firebaseApp;
let db;
let auth;
let initError = null;

try {
  if (!getApps().length) {
    firebaseApp = initializeApp(firebaseConfig);
  } else {
    firebaseApp = getApps()[0];
  }
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (e) { 
  console.error("Firebase Init Error:", e);
  initError = e.message;
}

// --- 게임 데이터 ---
const WORDS = ["사과", "자동차", "안경", "나무", "고양이", "집", "비행기", "시계", "우산", "피자", "자전거", "해바라기"];

// --- 헬퍼 함수 ---
const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function DrawingLiarGame() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(initError);
  const [copyStatus, setCopyStatus] = useState(null);
  
  // 캔버스 관련 상태
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef([]); // 현재 긋고 있는 선의 좌표들 (임시 저장)

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;

  // --- 1. 초기화 및 인증 ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if(p.get('room')) setRoomCode(p.get('room').toUpperCase());
    }
  }, []);

  useEffect(() => {
    if(!auth) {
      if(!initError) setError("Firebase 인증 객체가 없습니다. 설정을 확인하세요.");
      return;
    }
    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(e => setError("로그인 실패: " + e.message));
    });
    return () => unsub();
  }, []);

  // --- 2. 데이터 동기화 (방 정보 & 캔버스 데이터) ---
  useEffect(() => {
    if(!user || !roomCode || roomCode.length!==4 || !db) return;
    
    const unsubRoom = onSnapshot(doc(db,'rooms',roomCode), s => {
      if(s.exists()) {
        const data = s.data();
        setRoomData(data);
      } else setRoomData(null);
    });

    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- 3. 캔버스 렌더링 로직 (상대 좌표 -> 픽셀 변환) ---
  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roomData?.strokes) return;

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    // 캔버스 초기화
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Firestore에 저장된 모든 선 그리기
    roomData.strokes.forEach(stroke => {
      if (stroke.points.length < 1) return;
      
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;

      // [핵심] 저장된 0.0~1.0 좌표를 현재 캔버스 크기(px)로 변환
      const startX = stroke.points[0].x * width;
      const startY = stroke.points[0].y * height;
      
      ctx.moveTo(startX, startY);

      for (let i = 1; i < stroke.points.length; i++) {
        const x = stroke.points[i].x * width;
        const y = stroke.points[i].y * height;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }, [roomData?.strokes]);

  // 데이터가 바뀔 때마다 다시 그리기
  useEffect(() => {
    drawStrokes();
  }, [drawStrokes, roomData?.strokes]);

  // 창 크기 변경 시 캔버스 사이즈 조절 및 다시 그리기
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas && canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientWidth; // 정사각형 유지
        drawStrokes();
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // 초기 실행
    return () => window.removeEventListener('resize', handleResize);
  }, [drawStrokes]);


  // --- 4. 그리기 이벤트 핸들러 (최적화 적용) ---
  
  // 좌표 계산 함수: 화면상의 픽셀 좌표를 0.0 ~ 1.0 상대 좌표로 변환
  const getRelativePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // 터치 이벤트와 마우스 이벤트 구분 처리
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  const startDrawing = (e) => {
    if (roomData?.status !== 'playing') return;
    setIsDrawing(true);
    // 현재 패스를 초기화하고 시작점 추가
    const pos = getRelativePos(e);
    currentPath.current = [pos];
  };

  const draw = (e) => {
    if (!isDrawing || !canvasRef.current) return;
    e.preventDefault(); // 스크롤 방지

    const pos = getRelativePos(e);
    currentPath.current.push(pos);

    // [UX] 내 화면에는 즉시 그려서 반응성 확보 (서버 통신 전)
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;

    const points = currentPath.current;
    if (points.length >= 2) {
      const prevPos = points[points.length - 2];
      ctx.beginPath();
      ctx.moveTo(prevPos.x * width, prevPos.y * height);
      ctx.lineTo(pos.x * width, pos.y * height);
      ctx.stroke();
    }
  };

  const endDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    // [최적화] MouseUp 시점에 한 번만 Firestore에 저장 (Write 비용 절약)
    if (currentPath.current.length > 0) {
      const newStroke = {
        color,
        lineWidth,
        points: currentPath.current
      };

      try {
        await updateDoc(doc(db, 'rooms', roomCode), {
          strokes: arrayUnion(newStroke)
        });
      } catch (e) { console.error("Save failed", e); }
    }
    currentPath.current = [];
  };

  // 캔버스 전체 지우기 (방장 전용)
  const clearCanvas = async () => {
    if (window.confirm("모든 그림을 지우시겠습니까?")) {
      await updateDoc(doc(db, 'rooms', roomCode), { strokes: [] });
    }
  };

  // --- 접속 관리 (Heartbeat) ---
  useEffect(() => {
    if(!isJoined || !roomCode || !user) return;
    const hb = async () => { try { await updateDoc(doc(db,'rooms',roomCode,'players',user.uid), { lastActive: Date.now() }); } catch(e){} };
    hb();
    const t = setInterval(hb, 5000);
    return () => clearInterval(t);
  }, [isJoined, roomCode, user]);

  useEffect(() => {
    if(!isHost || !players.length) return;
    const cl = setInterval(() => {
      const now = Date.now();
      players.forEach(async p => {
        if(p.lastActive && now - p.lastActive > 20000) try { await deleteDoc(doc(db,'rooms',roomCode,'players',p.id)); } catch(e){}
      });
    }, 10000);
    return () => clearInterval(cl);
  }, [isHost, players, roomCode]);

  // --- 게임 로직 ---
  const handleCreate = async () => {
    if(!playerName) return setError("이름을 입력하세요");
    vibrate();
    const code = Math.random().toString(36).substring(2,6).toUpperCase();
    await setDoc(doc(db,'rooms',code), {
      hostId: user.uid, status: 'lobby', 
      keyword: '', liarId: '', strokes: [],
      createdAt: Date.now()
    });
    await setDoc(doc(db,'rooms',code,'players',user.uid), { name: playerName, joinedAt: Date.now(), lastActive: Date.now() });
    setRoomCode(code);
  };

  const handleJoin = async () => {
    if(!playerName || roomCode.length!==4) return setError("정보를 확인하세요");
    vibrate();
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방이 없습니다");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, joinedAt: Date.now(), lastActive: Date.now() });
  };

  const handleStart = async () => {
    if(players.length < 3) return setError("최소 3명 필요");
    vibrate();
    const randomWord = WORDS[Math.floor(Math.random() * WORDS.length)];
    const randomLiar = players[Math.floor(Math.random() * players.length)].id;

    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'playing',
      keyword: randomWord,
      liarId: randomLiar,
      strokes: [] // 캔버스 초기화
    });
  };

  const handleEndGame = async () => {
    if(!isHost) return;
    vibrate();
    await updateDoc(doc(db,'rooms',roomCode), { status: 'result' }); // 결과 공개 단계
  };

  const handleReset = async () => {
    if(!isHost) return;
    await updateDoc(doc(db,'rooms',roomCode), { status: 'lobby', strokes: [], keyword: '', liarId: '' });
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}?room=${roomCode}`;
    const el = document.createElement('textarea');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setCopyStatus('link');
    setTimeout(() => setCopyStatus(null), 2000);
    vibrate();
  };

  // --- 렌더링 헬퍼 ---
  const myRoleInfo = () => {
    if (!roomData || roomData.status === 'lobby') return null;
    const isLiar = roomData.liarId === user.uid;
    return {
      isLiar,
      text: isLiar ? "당신은 라이어입니다" : `제시어: ${roomData.keyword}`,
      sub: isLiar ? "친구들의 그림을 보고 따라 그리세요!" : "라이어가 눈치채지 못하게 그리세요!"
    };
  };
  const role = myRoleInfo();

  if (error) return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-50 text-red-500 font-bold p-6 text-center">
      <AlertCircle size={40} className="mb-4"/>
      <p>{error}</p>
      <button onClick={()=>window.location.reload()} className="mt-4 bg-slate-200 px-4 py-2 rounded text-black">새로고침</button>
    </div>
  );

  if(!user) return <div className="h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans selection:bg-blue-100 relative">
      
      {/* --- UI: Header --- */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl text-blue-600">
            <Palette size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-800">DRAWING LIAR</h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Real-time Canvas</p>
          </div>
        </div>
        {isJoined && roomCode && (
          <div className="bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
            <span className="font-mono font-black text-slate-500">{roomCode}</span>
          </div>
        )}
      </header>

      {/* --- SCENE 1: ENTRANCE --- */}
      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-10 animate-in fade-in zoom-in-95">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-black text-slate-800">아티스트 등록</h2>
              <p className="text-slate-400 text-sm mt-1">그림 실력을 뽐낼 준비가 되셨나요?</p>
            </div>
            
            <input 
              value={playerName} onChange={e=>setPlayerName(e.target.value)} 
              placeholder="닉네임" 
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 text-lg font-bold outline-none focus:ring-2 focus:ring-blue-200 transition-all"
            />
            
            {!roomCode && (
              <button onClick={handleCreate} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-200 transition-all active:scale-95">
                방 만들기
              </button>
            )}

            <div className="flex gap-3">
              <input 
                value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} 
                placeholder="코드" maxLength={4}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl text-center font-mono font-black text-xl outline-none focus:ring-2 focus:ring-blue-200"
              />
              <button onClick={handleJoin} className="flex-[1.5] bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                입장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SCENE 2: LOBBY --- */}
      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100 flex justify-between items-center">
            <div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Waiting Artists</p>
              <h2 className="text-4xl font-black text-slate-800">{players.length} <span className="text-xl text-slate-300">/ 10</span></h2>
            </div>
            <div className="p-4 bg-slate-50 rounded-full"><Users size={32} className="text-slate-400"/></div>
          </div>

          <div className="bg-white border border-slate-100 rounded-[2rem] p-4 shadow-sm min-h-[300px] flex flex-col">
            <div className="flex justify-between items-center mb-4 px-2">
              <span className="text-xs font-bold text-slate-400 uppercase">Participants</span>
              <button onClick={copyInviteLink} className="text-[10px] font-bold text-blue-500 bg-blue-50 px-3 py-1.5 rounded-full flex gap-1">
                {copyStatus==='link' ? <CheckCircle2 size={12}/> : <LinkIcon size={12}/>} 초대 링크
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {players.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className={`font-bold ${p.id===user.uid ? 'text-blue-600' : 'text-slate-600'}`}>{p.name}</span>
                  {p.id===roomData.hostId && <Crown size={16} className="text-amber-500" />}
                </div>
              ))}
            </div>
          </div>

          {isHost ? (
            <button onClick={handleStart} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-95 transition-all">
              <Play size={24} fill="currentColor"/> 게임 시작
            </button>
          ) : (
            <div className="text-center text-slate-400 text-sm font-bold animate-pulse py-4">방장의 시작을 기다리는 중...</div>
          )}
        </div>
      )}

      {/* --- SCENE 3: GAMEPLAY (CANVAS) --- */}
      {isJoined && (roomData?.status === 'playing' || roomData?.status === 'result') && role && (
        <div className="flex flex-col h-[calc(100vh-80px)] p-4 max-w-lg mx-auto">
          
          {/* Status Bar */}
          <div className={`mb-4 p-4 rounded-2xl shadow-sm border flex justify-between items-center ${role.isLiar ? 'bg-red-50 border-red-100' : 'bg-white border-slate-200'}`}>
            <div>
              <h2 className={`text-xl font-black ${role.isLiar ? 'text-red-500' : 'text-slate-800'}`}>
                {roomData.status === 'result' ? `정답: ${roomData.keyword}` : role.text}
              </h2>
              <p className="text-xs text-slate-400 font-bold">{roomData.status === 'result' ? (role.isLiar ? '당신의 승리인가요?' : '라이어를 찾았나요?') : role.sub}</p>
            </div>
            {roomData.status === 'playing' && (
              <div className="px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-full animate-pulse">
                LIVE
              </div>
            )}
          </div>

          {/* Canvas Container */}
          <div className="relative flex-1 bg-white rounded-3xl shadow-inner border-4 border-slate-200 overflow-hidden touch-none">
            <canvas
              ref={canvasRef}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={endDrawing}
              onMouseLeave={endDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={endDrawing}
              className="w-full h-full cursor-crosshair touch-none"
              style={{ touchAction: 'none' }} 
            />
            
            {/* Toolbar (Floating) */}
            {roomData.status === 'playing' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-xl border border-slate-200 flex gap-2">
                <button onClick={()=>setColor('#000000')} className={`p-3 rounded-xl transition-all ${color==='#000000' ? 'bg-slate-900 ring-2 ring-slate-900' : 'hover:bg-slate-100'}`}>
                  <div className="w-4 h-4 bg-black rounded-full"></div>
                </button>
                <button onClick={()=>setColor('#ef4444')} className={`p-3 rounded-xl transition-all ${color==='#ef4444' ? 'bg-red-100 ring-2 ring-red-500' : 'hover:bg-slate-100'}`}>
                  <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                </button>
                <button onClick={()=>setColor('#3b82f6')} className={`p-3 rounded-xl transition-all ${color==='#3b82f6' ? 'bg-blue-100 ring-2 ring-blue-500' : 'hover:bg-slate-100'}`}>
                  <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                </button>
                <div className="w-px h-8 bg-slate-200 my-auto mx-1"></div>
                <button onClick={()=>setColor('#ffffff')} className={`p-3 rounded-xl transition-all ${color==='#ffffff' ? 'bg-slate-200 ring-2 ring-slate-400' : 'hover:bg-slate-100'}`}>
                  <Eraser size={20} className="text-slate-600"/>
                </button>
                {isHost && (
                  <button onClick={clearCanvas} className="p-3 rounded-xl hover:bg-red-50 text-red-500">
                    <Trash2 size={20}/>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          <div className="mt-4">
            {isHost && roomData.status === 'playing' && (
              <button onClick={handleEndGame} className="w-full bg-slate-800 text-white py-4 rounded-2xl font-bold shadow-lg">
                그림 그리기 종료 & 결과 확인
              </button>
            )}
            {isHost && roomData.status === 'result' && (
              <button onClick={handleReset} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2">
                <RefreshCw size={20}/> 대기실로 돌아가기
              </button>
            )}
          </div>
        </div>
      )}

    </div>
  );
      }
