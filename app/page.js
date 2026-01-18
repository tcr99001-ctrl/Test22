'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, deleteDoc, getDoc, arrayUnion 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Play, Users, Crown, CheckCircle2, Link as LinkIcon, 
  Palette, Eraser, Trash2, RefreshCw, AlertCircle, Timer,
  PenTool, Vote, Gavel, Search, Smile
} from 'lucide-react';

// ==================================================================
// [필수] Firebase 설정값 (기존 값 유지)
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
  if (!getApps().length) firebaseApp = initializeApp(firebaseConfig);
  else firebaseApp = getApps()[0];
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (e) { 
  initError = e.message;
}

// --- Constants ---
const WORDS = ["사과", "자동차", "안경", "나무", "고양이", "집", "비행기", "시계", "우산", "피자", "자전거", "해바라기", "스마트폰", "운동화", "아이스크림"];
const TURN_DURATION = 15; // 턴당 15초

const vibrate = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30); };

export default function TurnBasedDrawingLiar() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState(initError);
  const [copyStatus, setCopyStatus] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [guessInput, setGuessInput] = useState('');

  // Canvas Refs
  const canvasRef = useRef(null);
  const [color, setColor] = useState('#000000');
  const [lineWidth, setLineWidth] = useState(5);
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPath = useRef([]);

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;

  // --- Auth & Initial URL Check ---
  useEffect(() => {
    // 1. URL에서 방 코드 감지 (가장 먼저 실행)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const codeFromUrl = params.get('room');
      if (codeFromUrl && codeFromUrl.length === 4) {
        setRoomCode(codeFromUrl.toUpperCase());
      }
    }

    // 2. 인증 시작
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(e => setError("로그인 실패: "+e.message));
    });
    return () => unsub();
  }, []);

  // --- Data Sync ---
  useEffect(() => {
    if(!user || !roomCode || roomCode.length!==4 || !db) return;
    
    // 방 데이터 구독
    const unsubRoom = onSnapshot(doc(db,'rooms',roomCode), s => {
      if(s.exists()) {
        const data = s.data();
        setRoomData(data);
        // 타이머 동기화
        if (data.status === 'playing' && data.turnEndTime) {
          const diff = Math.ceil((data.turnEndTime - Date.now()) / 1000);
          setTimeLeft(diff > 0 ? diff : 0);
        }
      } else {
        setRoomData(null);
      }
    });

    // 플레이어 목록 구독
    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // --- Game Loop (Host Only) ---
  useEffect(() => {
    if (!isHost || !roomData || roomData.status !== 'playing') return;

    const interval = setInterval(async () => {
      const now = Date.now();
      if (now >= roomData.turnEndTime) {
        const nextIndex = roomData.currentTurnIndex + 1;
        if (nextIndex >= roomData.turnOrder.length) {
          await updateDoc(doc(db, 'rooms', roomCode), { status: 'voting', votes: {}, turnEndTime: 0 });
        } else {
          await updateDoc(doc(db, 'rooms', roomCode), { currentTurnIndex: nextIndex, turnEndTime: now + (TURN_DURATION * 1000) });
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isHost, roomData, roomCode]);

  // --- Client Timer ---
  useEffect(() => {
    if (roomData?.status === 'playing' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(p => Math.max(0, p - 1)), 1000);
      return () => clearInterval(timer);
    }
  }, [roomData?.status, timeLeft]);

  // --- Canvas Logic ---
  const drawStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roomData?.strokes) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    roomData.strokes.forEach(stroke => {
      if (stroke.points.length < 1) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.lineWidth;
      const startX = stroke.points[0].x * width;
      const startY = stroke.points[0].y * height;
      ctx.moveTo(startX, startY);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x * width, stroke.points[i].y * height);
      }
      ctx.stroke();
    });
  }, [roomData?.strokes]);

  useEffect(() => { drawStrokes(); }, [drawStrokes, roomData?.strokes]);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas && canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientWidth; 
        drawStrokes();
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); 
    return () => window.removeEventListener('resize', handleResize);
  }, [drawStrokes]);

  const getRelativePos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const isMyTurn = roomData?.status === 'playing' && roomData?.turnOrder?.[roomData.currentTurnIndex] === user?.uid;

  const startDrawing = (e) => {
    if (!isMyTurn) return;
    setIsDrawing(true);
    currentPath.current = [getRelativePos(e)];
  };

  const draw = (e) => {
    if (!isDrawing || !canvasRef.current) return;
    e.preventDefault(); 
    const pos = getRelativePos(e);
    currentPath.current.push(pos);
    const ctx = canvasRef.current.getContext('2d');
    const { width, height } = canvasRef.current;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    const prev = currentPath.current[currentPath.current.length - 2];
    if (prev) {
      ctx.beginPath();
      ctx.moveTo(prev.x * width, prev.y * height);
      ctx.lineTo(pos.x * width, pos.y * height);
      ctx.stroke();
    }
  };

  const endDrawing = async () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPath.current.length > 0) {
      try {
        await updateDoc(doc(db, 'rooms', roomCode), {
          strokes: arrayUnion({ color, lineWidth, points: currentPath.current })
        });
      } catch (e) {}
    }
    currentPath.current = [];
  };

  const clearCanvas = async () => {
    if (isHost || isMyTurn) {
      if (confirm("지우시겠습니까?")) await updateDoc(doc(db, 'rooms', roomCode), { strokes: [] });
    }
  };

  // --- Actions ---
  const handleCreate = async () => {
    if(!playerName) return setError("이름 입력 필요");
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
    if(!playerName || roomCode.length!==4) return setError("정보 확인 필요");
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방 없음");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, joinedAt: Date.now(), lastActive: Date.now() });
  };

  const handleStart = async () => {
    if(players.length < 3) return setError("최소 3명 필요");
    vibrate();
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const liar = players[Math.floor(Math.random() * players.length)].id;
    const turnOrder = players.map(p => p.id).sort(() => Math.random() - 0.5);

    await updateDoc(doc(db,'rooms',roomCode), {
      status: 'playing', keyword: word, liarId: liar, strokes: [],
      turnOrder: turnOrder, currentTurnIndex: 0, turnEndTime: Date.now() + (TURN_DURATION * 1000)
    });
  };

  const handleVote = async (targetId) => {
    if (roomData.votes?.[user.uid]) return;
    const newVotes = { ...roomData.votes, [user.uid]: targetId };
    
    if (Object.keys(newVotes).length === players.length) {
      const counts = {};
      Object.values(newVotes).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
      let maxVotes = 0;
      let votedUser = null;
      Object.entries(counts).forEach(([id, count]) => {
        if (count > maxVotes) { maxVotes = count; votedUser = id; }
        else if (count === maxVotes) votedUser = null;
      });

      if (votedUser === roomData.liarId) {
        await updateDoc(doc(db, 'rooms', roomCode), { status: 'liar_guess', votes: newVotes });
      } else {
        await updateDoc(doc(db, 'rooms', roomCode), { status: 'result', winner: 'liar', reason: 'vote_fail' });
      }
    } else {
      await updateDoc(doc(db, 'rooms', roomCode), { [`votes.${user.uid}`]: targetId });
    }
  };

  const submitLiarGuess = async () => {
    const isCorrect = guessInput.trim() === roomData.keyword;
    await updateDoc(doc(db, 'rooms', roomCode), {
      status: 'result', winner: isCorrect ? 'liar' : 'citizen', reason: isCorrect ? 'guess_success' : 'guess_fail'
    });
  };

  const handleReset = async () => await updateDoc(doc(db,'rooms',roomCode), { status: 'lobby', strokes: [], keyword: '', liarId: '' });

  // ★ [수정됨] 링크 복사 로직 (완벽한 절대 경로 생성)
  const copyInviteLink = () => {
    if (typeof window === 'undefined') return;
    
    // 1. 현재 주소에서 쿼리스트링 제거 (순수 도메인+경로만 추출)
    const baseUrl = window.location.href.split('?')[0];
    // 2. 방 코드 붙이기
    const inviteUrl = `${baseUrl}?room=${roomCode}`;
    
    // 3. 복사 실행
    const el = document.createElement('textarea');
    el.value = inviteUrl;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    
    setCopyStatus('link');
    setTimeout(() => setCopyStatus(null), 2000);
    vibrate();
  };

  // --- Render Helpers ---
  const myRoleInfo = () => {
    if (!roomData || roomData.status === 'lobby') return null;
    const isLiar = roomData.liarId === user.uid;
    return {
      isLiar,
      text: isLiar ? "당신은 라이어" : `제시어: ${roomData.keyword}`,
      sub: isLiar ? "들키지 말고 따라 그리세요!" : "라이어가 모르게 그리세요!"
    };
  };
  const role = myRoleInfo();

  const getCurrentDrawerName = () => {
    if (!roomData?.turnOrder) return "";
    const currentUid = roomData.turnOrder[roomData.currentTurnIndex];
    return players.find(p => p.id === currentUid)?.name || "Unknown";
  };

  if(!user) return <div className="h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans relative">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-xl text-blue-600"><Palette size={24}/></div>
          <div><h1 className="text-xl font-black">DRAWING LIAR</h1></div>
        </div>
        {isJoined && roomCode && <div className="bg-slate-100 px-3 py-1 rounded font-black text-slate-500">{roomCode}</div>}
      </header>

      {!isJoined && (
        <div className="p-6 max-w-md mx-auto mt-10 bg-white rounded-3xl shadow-xl space-y-6 animate-in fade-in">
          <h2 className="text-2xl font-black text-center">게임 입장</h2>
          <input value={playerName} onChange={e=>setPlayerName(e.target.value)} placeholder="닉네임" className="w-full bg-slate-50 border p-4 rounded-xl font-bold"/>
          
          {/* 방 코드가 없으면(새로고침 등) 방 만들기 버튼 표시, 있으면 입장 버튼 강조 */}
          {!roomCode && <button onClick={handleCreate} className="w-full bg-blue-600 text-white p-4 rounded-xl font-bold shadow-lg">방 만들기</button>}
          
          <div className="flex gap-2">
            <input 
              value={roomCode} 
              onChange={e=>setRoomCode(e.target.value.toUpperCase())} 
              placeholder="CODE" 
              className="flex-1 bg-slate-50 border p-4 rounded-xl text-center font-bold"
            />
            <button onClick={handleJoin} className="flex-1 bg-slate-800 text-white p-4 rounded-xl font-bold">입장</button>
          </div>
        </div>
      )}

      {isJoined && roomData?.status === 'lobby' && (
        <div className="p-6 max-w-md mx-auto space-y-6">
          <div className="bg-white p-6 rounded-[2rem] shadow-xl flex justify-between items-center">
            <div><p className="text-slate-400 text-xs font-bold">Waiting</p><h2 className="text-4xl font-black">{players.length} / 10</h2></div>
            <Users size={32} className="text-slate-300"/>
          </div>
          <div className="bg-white p-4 rounded-[2rem] min-h-[300px] flex flex-col">
            <div className="flex justify-between px-2 mb-2">
              <span className="font-bold text-slate-400 text-xs">Players</span>
              <button onClick={copyInviteLink} className="text-xs text-blue-500 font-bold bg-blue-50 px-2 py-1 rounded flex gap-1">{copyStatus==='link'?<CheckCircle2 size={12}/>:<LinkIcon size={12}/>} Link</button>
            </div>
            <div className="space-y-2 overflow-y-auto flex-1">
              {players.map(p=><div key={p.id} className="flex justify-between p-3 bg-slate-50 rounded-xl"><span className={p.id===user.uid?'text-blue-600 font-bold':'font-bold'}>{p.name}</span>{p.id===roomData.hostId&&<Crown size={16} className="text-amber-500"/>}</div>)}
            </div>
          </div>
          {isHost ? <button onClick={handleStart} className="w-full bg-blue-600 text-white p-5 rounded-2xl font-black shadow-xl flex justify-center gap-2"><Play size={24}/> 게임 시작</button> : <div className="text-center text-slate-400 font-bold animate-pulse">대기 중...</div>}
        </div>
      )}

      {isJoined && roomData?.status === 'playing' && role && (
        <div className="flex flex-col h-[calc(100vh-80px)] p-4 max-w-lg mx-auto">
          <div className={`mb-3 p-4 rounded-2xl border flex flex-col gap-2 ${role.isLiar?'bg-red-50 border-red-200':'bg-white border-slate-200'}`}>
            <div className="flex justify-between items-center">
              <div><h2 className={`text-xl font-black ${role.isLiar?'text-red-500':'text-slate-800'}`}>{role.text}</h2><p className="text-xs text-slate-400 font-bold">{role.sub}</p></div>
              <div className="text-center">
                <div className="text-2xl font-black font-mono text-slate-700 flex items-center gap-1"><Timer size={20}/> {timeLeft}s</div>
              </div>
            </div>
            <div className="bg-slate-900 text-white p-2 rounded-lg flex items-center justify-center gap-2 text-sm">
              <PenTool size={14}/> 
              <span>현재 화가: <span className="font-bold text-amber-400">{getCurrentDrawerName()}</span></span>
              {isMyTurn && <span className="ml-2 bg-blue-500 px-2 rounded text-[10px] font-bold">당신 차례!</span>}
            </div>
          </div>

          <div className={`relative flex-1 bg-white rounded-3xl shadow-inner border-4 overflow-hidden touch-none ${isMyTurn ? 'border-blue-400' : 'border-slate-200 opacity-90'}`}>
            {!isMyTurn && <div className="absolute inset-0 z-10 bg-transparent"></div>}
            <canvas ref={canvasRef} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={endDrawing} onMouseLeave={endDrawing} onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={endDrawing} className="w-full h-full cursor-crosshair"/>
            {isMyTurn && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 p-2 rounded-2xl shadow-xl flex gap-2 border">
                {['#000000','#ef4444','#3b82f6'].map(c=><button key={c} onClick={()=>setColor(c)} className={`p-3 rounded-xl ${color===c?'bg-slate-900 ring-2 ring-slate-900':'hover:bg-slate-100'}`}><div className="w-4 h-4 rounded-full" style={{backgroundColor:c}}/></button>)}
                <div className="w-px h-8 bg-slate-200 my-auto"></div>
                <button onClick={()=>setColor('#ffffff')} className={`p-3 rounded-xl ${color==='#ffffff'?'bg-slate-200':''}`}><Eraser size={20}/></button>
                <button onClick={clearCanvas} className="p-3 rounded-xl text-red-500 hover:bg-red-50"><Trash2 size={20}/></button>
              </div>
            )}
          </div>
        </div>
      )}

      {isJoined && roomData?.status === 'voting' && (
        <div className="p-6 max-w-md mx-auto space-y-6 text-center animate-in zoom-in">
          <div className="bg-white p-6 rounded-[2rem] shadow-xl border border-slate-100">
            <h2 className="text-2xl font-black mb-2 text-slate-800 flex items-center justify-center gap-2"><Gavel/> 라이어 투표</h2>
            <p className="text-slate-500 text-sm mb-6">그림이 이상했던 사람을 지목하세요!</p>
            <div className="grid grid-cols-2 gap-3">
              {players.map(p => {
                const isVoted = roomData.votes?.[user.uid] === p.id;
                return (
                  <button 
                    key={p.id} onClick={() => handleVote(p.id)} disabled={roomData.votes?.[user.uid]}
                    className={`p-4 rounded-xl font-bold border-2 transition-all ${isVoted ? 'bg-red-100 border-red-500 text-red-600' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            {roomData.votes?.[user.uid] && <p className="mt-4 text-slate-400 text-sm font-bold animate-pulse">다른 사람들의 투표를 기다리는 중...</p>}
          </div>
        </div>
      )}

      {isJoined && roomData?.status === 'liar_guess' && (
        <div className="p-6 max-w-md mx-auto space-y-6 text-center animate-in zoom-in">
          <div className="bg-red-50 p-8 rounded-[2rem] border-2 border-red-100 shadow-xl">
            <h2 className="text-2xl font-black text-red-600 mb-2">라이어 검거!</h2>
            {role.isLiar ? (
              <>
                <p className="text-red-400 text-sm font-bold mb-6">마지막 기회입니다. 정답을 맞히면 역전승!</p>
                <input value={guessInput} onChange={e=>setGuessInput(e.target.value)} placeholder="정답 입력" className="w-full bg-white border border-red-200 p-4 rounded-xl font-bold text-center mb-4 outline-none focus:ring-2 focus:ring-red-300"/>
                <button onClick={submitLiarGuess} className="w-full bg-red-600 text-white py-4 rounded-xl font-bold shadow-lg">정답 제출</button>
              </>
            ) : <p className="text-slate-500 font-bold animate-pulse">라이어가 최후의 변론 중입니다...</p>}
          </div>
        </div>
      )}

      {isJoined && roomData?.status === 'result' && (
        <div className="p-6 max-w-md mx-auto text-center animate-in bounce-in">
          <div className={`p-8 rounded-[2rem] shadow-2xl mb-6 border-4 ${roomData.winner === 'citizen' ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
            <h2 className={`text-4xl font-black mb-2 ${roomData.winner === 'citizen' ? 'text-blue-600' : 'text-red-600'}`}>
              {roomData.winner === 'citizen' ? '시민 승리!' : '라이어 승리!'}
            </h2>
            <p className="text-slate-500 font-bold text-lg mb-6">
              {roomData.reason === 'vote_fail' && "엄한 사람을 잡았습니다..."}
              {roomData.reason === 'guess_success' && "라이어가 정답을 맞혔습니다!"}
              {roomData.reason === 'guess_fail' && "라이어가 정답을 틀렸습니다!"}
            </p>
            <div className="bg-white p-4 rounded-xl inline-block border shadow-sm">
              <p className="text-xs text-slate-400 font-bold uppercase mb-1">정답</p>
              <p className="text-2xl font-black text-slate-800">{roomData.keyword}</p>
            </div>
            <div className="mt-4"><p className="text-sm font-bold text-slate-500">라이어: {players.find(p=>p.id===roomData.liarId)?.name}</p></div>
          </div>
          {isHost && <button onClick={handleReset} className="w-full bg-slate-800 text-white py-4 rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2"><RefreshCw/> 대기실로 돌아가기</button>}
        </div>
      )}
    </div>
  );
            }
