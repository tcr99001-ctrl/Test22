'use client';

import React, { useState, useEffect } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, doc, setDoc, onSnapshot, collection, updateDoc, deleteDoc, getDoc 
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  Play, Eye, EyeOff, Users, CheckCircle2, Crown, 
  Sword, Shield, ThumbsUp, ThumbsDown, AlertCircle, 
  Link as LinkIcon, Sparkles, Scroll, Skull, Lock, Zap,
  ChevronRight, XCircle
} from 'lucide-react';

// ==================================================================
// [필수] 사용자님의 Firebase 설정값
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

try {
  if (!getApps().length) {
    firebaseApp = initializeApp(firebaseConfig);
  } else {
    firebaseApp = getApps()[0];
  }
  db = getFirestore(firebaseApp);
  auth = getAuth(firebaseApp);
} catch (e) { console.error("Firebase Init Error:", e); }

// --- Game Logic Constants ---
const QUEST_RULES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4], 
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

// 역할 분배 함수 (개발자 모드 고려 X - 메인 함수에서 처리)
function distributeRoles(count) {
  let good = [], evil = [];
  if (count === 5) { good=['멀린','시민','시민']; evil=['암살자','모르가나']; }
  else if (count === 6) { good=['멀린','퍼시벌','시민','시민']; evil=['암살자','모르가나']; }
  else if (count === 7) { good=['멀린','퍼시벌','시민','시민']; evil=['암살자','모르가나','오베론']; }
  else {
    good=['멀린','퍼시벌','시민','시민','시민']; evil=['암살자','모르가나','미니언'];
    while(good.length+evil.length < count) (good.length+evil.length)%2===0 ? good.push('시민') : evil.push('미니언');
  }
  const roles = [...good, ...evil];
  for(let i=roles.length-1; i>0; i--){
    const j=Math.floor(Math.random()*(i+1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

const vibrate = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(50);
  }
};

// --- Main Component ---
export default function AvalonGame() {
  const [user, setUser] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [roomData, setRoomData] = useState(null);
  const [players, setPlayers] = useState([]);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [error, setError] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);
  const [isDevMode, setIsDevMode] = useState(false);

  const isJoined = user && players.some(p => p.id === user.uid);
  const isHost = roomData?.hostId === user?.uid;

  // Initial Setup
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if(p.get('room')) setRoomCode(p.get('room').toUpperCase());
    }
  }, []);

  useEffect(() => {
    if(!auth) return;
    const unsub = onAuthStateChanged(auth, u => {
      if(u) setUser(u);
      else signInAnonymously(auth).catch(console.error);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if(!user || !roomCode || roomCode.length!==4 || !db) return;
    const unsubRoom = onSnapshot(doc(db,'rooms',roomCode), s => setRoomData(s.exists()?s.data():null));
    const unsubPlayers = onSnapshot(collection(db,'rooms',roomCode,'players'), s => {
      const list=[]; s.forEach(d=>list.push({id:d.id, ...d.data()}));
      setPlayers(list);
    });
    return () => { unsubRoom(); unsubPlayers(); };
  }, [user, roomCode]);

  // Presence & Cleanup
  useEffect(() => {
    if(!isJoined || !roomCode || !user) return;
    const heartbeat = async () => { try { await updateDoc(doc(db,'rooms',roomCode,'players',user.uid), { lastActive: Date.now() }); } catch(e){} };
    heartbeat();
    const timer = setInterval(heartbeat, 5000);
    return () => clearInterval(timer);
  }, [isJoined, roomCode, user]);

  useEffect(() => {
    if(!isHost || !players.length) return;
    const cleaner = setInterval(() => {
      const now = Date.now();
      players.forEach(async p => {
        if(p.lastActive && now - p.lastActive > 20000) { try { await deleteDoc(doc(db,'rooms',roomCode,'players',p.id)); } catch(e){} }
      });
    }, 10000);
    return () => clearInterval(cleaner);
  }, [isHost, players, roomCode]);

  // Actions
  const handleCreate = async () => {
    if(!playerName) return setError("이름을 입력하세요");
    vibrate();
    const code = Math.random().toString(36).substring(2,6).toUpperCase();
    await setDoc(doc(db,'rooms',code), {
      hostId: user.uid, status: 'lobby', phase: 'team_building',
      questScores: [null,null,null,null,null], currentQuestIndex: 0,
      leaderIndex: 0, votes: {}, questVotes: {}, currentTeam: [],
      createdAt: Date.now()
    });
    await setDoc(doc(db,'rooms',code,'players',user.uid), { name: playerName, joinedAt: Date.now(), lastActive: Date.now() });
    setRoomCode(code);
  };

  const handleJoin = async () => {
    if(!playerName || roomCode.length!==4) return setError("정보를 확인하세요");
    vibrate();
    const snap = await getDoc(doc(db,'rooms',roomCode));
    if(!snap.exists()) return setError("방이 존재하지 않습니다");
    await setDoc(doc(db,'rooms',roomCode,'players',user.uid), { name: playerName, joinedAt: Date.now(), lastActive: Date.now() });
  };

  // ★ [수정] 게임 시작 로직 (개발자 모드 버그 수정)
  const handleStart = async () => {
    vibrate();
    const count = players.length;
    let finalRoles = [];
    let finalRules = [];

    if (isDevMode) {
      // 개발자 모드: 인원수 무관, 역할 랜덤, 퀘스트 인원 1명 고정
      const testRolesPool = ['멀린', '암살자', '퍼시벌', '모르가나', '시민', '미니언'];
      // 현재 인원수만큼 랜덤 역할을 뽑습니다.
      finalRoles = Array(count).fill(null).map(() => testRolesPool[Math.floor(Math.random() * testRolesPool.length)]);
      finalRules = [1, 1, 1, 1, 1]; // 테스트용 룰 (1명만 필요)
    } else {
      if (count < 5) return setError("최소 5명이 필요합니다.");
      finalRoles = distributeRoles(count);
      finalRules = QUEST_RULES[count];
    }

    const updates = players.map((p,i) => {
      const r = finalRoles[i];
      const evil = ['암살자','모르가나','오베론','미니언','모드레드'].includes(r);
      return updateDoc(doc(db,'rooms',roomCode,'players',p.id), { role:r, isEvil:evil });
    });
    await Promise.all(updates);
    
    await updateDoc(doc(db,'rooms',roomCode), { 
      status: 'playing', 
      questRules: finalRules, 
      leaderIndex: 0, 
      isDevMode: isDevMode,
      playerCount: count // 투표 집계 시 필요하므로 저장
    });
  };

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}?room=${roomCode}`;
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

  const getMyData = () => {
    if(!user || !players.length) return null;
    const me = players.find(p=>p.id===user.uid);
    if(!me?.role) return null;
    let info = "";
    const evils = players.filter(p=>p.isEvil && p.role!=='오베론' && p.role!=='모드레드').map(p=>p.name).join(', ');
    const merlins = players.filter(p=>['멀린','모르가나'].includes(p.role)).map(p=>p.name).join(', ');
    
    if(me.role==='멀린') info=`악의 하수인: ${evils}`;
    else if(me.role==='퍼시벌') info=`멀린 후보: ${merlins}`;
    else if(me.isEvil && me.role!=='오베론') info=`동료 악당: ${evils}`;
    else info="당신은 정의로운 아서 왕의 기사입니다.";
    return { ...me, info };
  };
  const myData = getMyData();

  // --- Render ---
  if(!user) return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-950 text-white font-sans gap-4">
      <div className="w-12 h-12 border-4 border-slate-800 border-t-amber-500 rounded-full animate-spin"></div>
      <p className="text-amber-500 font-bold tracking-widest text-xs uppercase animate-pulse">Connecting...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-500/30 overflow-x-hidden relative">
      
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[800px] h-[800px] bg-indigo-900/20 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-20%] right-[-20%] w-[800px] h-[800px] bg-amber-900/10 rounded-full blur-[120px] animate-pulse delay-1000"></div>
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-10"></div>
      </div>

      <div className="relative mx-auto max-w-lg min-h-screen flex flex-col p-6 z-10">
        
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-amber-500 to-amber-700 rounded-lg shadow-lg shadow-amber-500/20">
              <Sword size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-amber-100 to-amber-500">AVALON</h1>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em]">The Resistance</p>
            </div>
          </div>
          {isJoined && roomCode && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Room Code</span>
              <span className="font-mono text-xl font-black text-amber-500 tracking-wider">{roomCode}</span>
            </div>
          )}
        </header>

        {/* Error Toast */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-4 backdrop-blur-md">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm font-bold text-red-200">{error}</p>
            <button onClick={()=>setError(null)} className="ml-auto text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* 1. Entrance */}
        {!isJoined && (
          <div className="my-auto animate-in fade-in zoom-in-95 duration-700">
            <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 p-8 rounded-[2rem] shadow-2xl space-y-6">
              <div className="text-center pb-4 border-b border-white/5">
                <h2 className="text-2xl font-black text-white mb-2">원탁의 기사단</h2>
                <p className="text-slate-400 text-sm">성스러운 임무를 수행할 준비가 되셨습니까?</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase ml-2">닉네임</label>
                  <input 
                    value={playerName} 
                    onChange={e=>setPlayerName(e.target.value)} 
                    placeholder="기사님의 이름" 
                    className="w-full mt-1 bg-black/40 border border-white/10 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 rounded-xl px-5 py-4 text-lg font-bold text-white placeholder-slate-600 outline-none transition-all"
                  />
                </div>

                {!roomCode && (
                  <button 
                    onClick={handleCreate} 
                    className="w-full bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white py-4 rounded-xl font-black text-lg shadow-lg shadow-amber-900/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Sparkles size={18} /> 새로운 원정대 결성
                  </button>
                )}

                <div className="flex gap-3">
                  <input 
                    value={roomCode} 
                    onChange={e=>setRoomCode(e.target.value.toUpperCase())} 
                    placeholder="코드" 
                    maxLength={4}
                    className="flex-1 bg-black/40 border border-white/10 focus:border-indigo-500 rounded-xl text-center font-mono font-black text-xl uppercase outline-none transition-all"
                  />
                  <button 
                    onClick={handleJoin} 
                    className="flex-[1.5] bg-slate-800 hover:bg-slate-700 text-white py-4 rounded-xl font-bold text-lg border border-white/5 transition-all active:scale-[0.98]"
                  >
                    입장하기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. Lobby */}
        {isJoined && roomData?.status === 'lobby' && (
          <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-8 duration-500">
            <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-6 rounded-[2rem] border border-white/5 relative overflow-hidden mb-4 shadow-xl">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Users size={80} /></div>
              <p className="text-indigo-300 text-xs font-bold uppercase tracking-widest mb-1">Waiting for Knights</p>
              <h2 className="text-4xl font-black text-white">{players.length} <span className="text-xl text-slate-500">/ 10</span></h2>
              {isDevMode && <div className="mt-2 inline-flex items-center gap-1 bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold border border-red-500/30"><Zap size={10}/> DEV MODE ON</div>}
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-slate-900/40 border border-white/5 rounded-[2rem] p-4 backdrop-blur-sm">
              <div className="flex justify-between items-center mb-4 px-2">
                <span className="text-xs font-bold text-slate-500 uppercase">Participants</span>
                <button onClick={copyInviteLink} className="text-xs font-bold text-amber-500 flex items-center gap-1 bg-amber-500/10 px-3 py-1.5 rounded-full hover:bg-amber-500/20 transition-colors">
                  {copyStatus==='link' ? <CheckCircle2 size={12}/> : <LinkIcon size={12}/>} 초대 링크
                </button>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {players.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full ${p.id===roomData.hostId ? 'bg-amber-500 shadow-[0_0_8px_orange]' : 'bg-emerald-500'}`}></div>
                      <span className="font-bold text-slate-200">{p.name}</span>
                    </div>
                    {p.id===roomData.hostId && <Crown size={14} className="text-amber-500" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isHost ? (
                <>
                  <button 
                    onClick={handleStart}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-emerald-900/20 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                  >
                    <Play fill="currentColor" size={20}/> 게임 시작
                  </button>
                  <div 
                    onClick={() => setIsDevMode(!isDevMode)}
                    className="text-center text-[10px] text-slate-600 font-bold uppercase tracking-widest cursor-pointer hover:text-slate-400 transition-colors"
                  >
                    {isDevMode ? "Dev Mode Enabled" : "Min 5 Players Required"}
                  </div>
                </>
              ) : (
                <div className="p-4 bg-slate-800/50 rounded-xl border border-dashed border-slate-700 text-center">
                  <p className="text-xs font-bold text-slate-500 animate-pulse">방장의 시작을 기다리고 있습니다...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. Game Play */}
        {isJoined && roomData?.status === 'playing' && myData && (
          <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-8 duration-700">
            
            {/* Score Track */}
            <div className="bg-slate-900/50 border border-white/5 p-4 rounded-3xl backdrop-blur-md">
              <div className="flex justify-between items-center relative">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-800 -z-10"></div>
                {roomData.questScores.map((s,i) => (
                  <div key={i} className={`relative flex flex-col items-center gap-1 transition-all duration-500 ${i===roomData.currentQuestIndex ? 'scale-110' : 'opacity-70'}`}>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-2 shadow-lg transition-all z-10
                      ${s===true ? 'bg-blue-600 border-blue-400 text-white' : 
                        s===false ? 'bg-rose-600 border-rose-400 text-white' : 
                        i===roomData.currentQuestIndex ? 'bg-slate-900 border-amber-500 text-amber-500 ring-2 ring-amber-500/20' : 
                        'bg-slate-900 border-slate-700 text-slate-600'}`}>
                      {s===true ? <Shield size={16}/> : s===false ? <Sword size={16}/> : i+1}
                    </div>
                    <span className="text-[9px] font-bold text-slate-500 bg-slate-950 px-1.5 rounded">{roomData.questRules[i]}인</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Identity Card (Flip Effect) */}
            <div className="perspective-1000 h-[200px] w-full cursor-pointer group" onClick={() => { vibrate(); setIsCardFlipped(!isCardFlipped); }}>
              <div className={`relative w-full h-full duration-500 preserve-3d transition-transform ${isCardFlipped ? 'rotate-y-180' : ''}`} style={{ transformStyle: 'preserve-3d', transform: isCardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
                {/* Front */}
                <div className="absolute w-full h-full backface-hidden bg-gradient-to-br from-slate-800 to-slate-900 rounded-[2rem] border border-slate-700 flex flex-col items-center justify-center shadow-2xl p-6 group-hover:border-slate-600 transition-colors">
                  <div className="w-16 h-16 bg-slate-950 rounded-full flex items-center justify-center mb-4 border border-slate-800 shadow-inner">
                    <Lock size={24} className="text-slate-500" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-300">신분 확인</h3>
                  <p className="text-xs text-slate-500 mt-2 uppercase tracking-widest font-bold">Tap to Reveal Identity</p>
                </div>
                {/* Back */}
                <div className={`absolute w-full h-full backface-hidden bg-gradient-to-br rounded-[2rem] border flex flex-col items-center justify-center shadow-2xl p-6 text-center ${myData.isEvil ? 'from-rose-950 to-slate-950 border-rose-500/30' : 'from-blue-950 to-slate-950 border-blue-500/30'}`} style={{ transform: 'rotateY(180deg)' }}>
                  <div className={`text-xs font-bold uppercase tracking-[0.3em] mb-2 ${myData.isEvil ? 'text-rose-500' : 'text-blue-500'}`}>Your Role</div>
                  <h2 className={`text-4xl font-black mb-4 drop-shadow-lg ${myData.isEvil ? 'text-rose-500' : 'text-blue-400'}`}>{myData.role}</h2>
                  <div className={`text-xs font-medium px-4 py-2 rounded-lg border bg-black/20 ${myData.isEvil ? 'text-rose-200 border-rose-500/20' : 'text-blue-200 border-blue-500/20'}`}>{myData.info}</div>
                </div>
              </div>
            </div>

            {/* Leader Badge */}
            <div className="flex items-center justify-center gap-2">
              <div className="bg-amber-500/10 border border-amber-500/20 px-4 py-1.5 rounded-full flex items-center gap-2">
                <Crown size={14} className="text-amber-500" />
                <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Leader</span>
                <span className="text-sm font-bold text-white">{players[roomData.leaderIndex]?.name}</span>
              </div>
            </div>

            {/* Game Phases */}
            <div className="bg-slate-900/60 border border-white/5 p-1 rounded-[2.5rem] backdrop-blur-xl shadow-2xl">
              <div className="bg-slate-950/80 rounded-[2.3rem] p-6 border border-white/5 min-h-[220px] flex flex-col justify-center">
                {roomData.phase === 'team_building' && (
                  <TeamBuilding roomCode={roomCode} players={players} roomData={roomData} user={user} isLeader={players[roomData.leaderIndex]?.id===user.uid} vibrate={vibrate} />
                )}
                {roomData.phase === 'voting' && (
                  <Voting roomCode={roomCode} roomData={roomData} user={user} vibrate={vibrate} />
                )}
                {roomData.phase === 'quest' && (
                  <Quest roomCode={roomCode} roomData={roomData} user={user} myRole={myData.role} vibrate={vibrate} />
                )}
                {roomData.phase === 'assassin' && (
                   <div className="text-center space-y-4 animate-in zoom-in">
                     <div className="inline-block p-4 bg-rose-500/10 rounded-full mb-2 border border-rose-500/30"><Skull size={40} className="text-rose-500"/></div>
                     <h2 className="text-2xl font-black text-rose-500 uppercase">Assassin Phase</h2>
                     <p className="text-sm text-slate-400">악의 세력은 멀린을 찾아 암살하세요.</p>
                   </div>
                )}
                {roomData.status === 'evil_win' && (
                  <div className="text-center animate-in bounce-in">
                    <h2 className="text-4xl font-black text-rose-600 mb-2 drop-shadow-[0_0_10px_rgba(225,29,72,0.5)]">EVIL WINS</h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">The Kingdom has fallen</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub Components ---

function TeamBuilding({ roomCode, players, roomData, user, isLeader, vibrate }) {
  const [selected, setSelected] = useState([]);
  const need = roomData.questRules[roomData.currentQuestIndex];
  
  const toggle = (id) => {
    if(!isLeader) return;
    vibrate();
    if(selected.includes(id)) setSelected(selected.filter(i=>i!==id));
    else if(selected.length < need) setSelected([...selected, id]);
  };
  
  const submit = async () => {
    if(selected.length!==need) return;
    vibrate();
    await updateDoc(doc(db,'rooms',roomCode), { phase:'voting', currentTeam:selected, votes:{} });
  };

  return (
    <div className="space-y-5 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center">
        <h3 className="text-lg font-black text-white">원정대 선발</h3>
        <p className="text-xs text-indigo-400 font-bold uppercase mt-1">Select {need} Knights</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {players.map(p => {
          const isSel = selected.includes(p.id);
          return (
            <div key={p.id} onClick={()=>toggle(p.id)} className={`p-3 rounded-xl border flex items-center justify-between transition-all duration-200 ${isSel ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/20 scale-[1.02]' : 'bg-slate-800 border-slate-700 text-slate-400'} ${isLeader?'cursor-pointer active:scale-95':'opacity-50'}`}>
              <span className="text-sm font-bold">{p.name}</span>
              {isSel && <CheckCircle2 size={16}/>}
            </div>
          )
        })}
      </div>
      {isLeader ? (
        <button onClick={submit} disabled={selected.length!==need} className="w-full bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-600 text-white py-4 rounded-xl font-bold mt-2 shadow-lg transition-all active:scale-95">
          원정대 제안 승인
        </button>
      ) : <p className="text-center text-xs text-slate-500 font-bold mt-4 animate-pulse">리더가 원정대를 선발 중입니다...</p>}
    </div>
  );
}

function Voting({ roomCode, roomData, user, vibrate }) {
  const voted = roomData.votes?.[user.uid] !== undefined;
  
  const vote = async (appr) => {
    vibrate();
    const newVotes = { ...roomData.votes, [user.uid]: appr };
    if(Object.keys(newVotes).length === roomData.playerCount) {
      const y = Object.values(newVotes).filter(v=>v).length;
      if(y > Object.values(newVotes).length/2) {
        await updateDoc(doc(db,'rooms',roomCode), { votes:newVotes, phase:'quest', questVotes:{} });
      } else {
        await updateDoc(doc(db,'rooms',roomCode), { votes:newVotes, phase:'team_building', leaderIndex:(roomData.leaderIndex+1)%roomData.playerCount });
      }
    } else {
      await updateDoc(doc(db,'rooms',roomCode), { [`votes.${user.uid}`]: appr });
    }
  };

  if(voted) return (
    <div className="text-center py-10 space-y-3">
      <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mx-auto animate-pulse"><Scroll className="text-slate-600"/></div>
      <p className="text-sm text-slate-500 font-bold">다른 기사들의 투표를 기다리는 중...</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in zoom-in duration-300">
      <div className="text-center">
        <h3 className="text-lg font-black text-white">원정 승인 투표</h3>
        <p className="text-xs text-slate-500 font-bold uppercase mt-1">Accept or Reject Proposal</p>
      </div>
      
      <div className="flex justify-center gap-2 mb-4">
        {roomData.currentTeam.map(uid => (
             <div key={uid} className="w-8 h-8 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center text-xs text-white font-bold shadow-md"><Users size={12}/></div>
        ))}
      </div>

      <div className="flex gap-3">
        <button onClick={()=>vote(true)} className="flex-1 bg-slate-800 hover:bg-emerald-900/30 border border-slate-700 hover:border-emerald-500/50 p-5 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 group">
          <ThumbsUp size={28} className="text-slate-500 group-hover:text-emerald-500 transition-colors"/>
          <span className="text-sm font-bold text-slate-400 group-hover:text-emerald-400">승인</span>
        </button>
        <button onClick={()=>vote(false)} className="flex-1 bg-slate-800 hover:bg-rose-900/30 border border-slate-700 hover:border-rose-500/50 p-5 rounded-2xl flex flex-col items-center gap-2 transition-all active:scale-95 group">
          <ThumbsDown size={28} className="text-slate-500 group-hover:text-rose-500 transition-colors"/>
          <span className="text-sm font-bold text-slate-400 group-hover:text-rose-400">거부</span>
        </button>
      </div>
    </div>
  );
}

function Quest({ roomCode, roomData, user, myRole, vibrate }) {
  const isMember = roomData.currentTeam.includes(user.uid);
  const acted = roomData.questVotes?.[user.uid] !== undefined;
  
  const action = async (success) => {
    vibrate();
    const newVotes = { ...roomData.questVotes, [user.uid]: success };
    if(Object.keys(newVotes).length === roomData.currentTeam.length) {
      const fails = Object.values(newVotes).filter(v=>!v).length;
      const isFail = fails >= 1; 
      const newScores = [...roomData.questScores];
      newScores[roomData.currentQuestIndex] = !isFail;
      const sTotal = newScores.filter(s=>s===true).length;
      const fTotal = newScores.filter(s=>s===false).length;
      let ph = 'team_building'; let st = 'playing';
      if(sTotal>=3) { ph='assassin'; st='assassin_phase'; }
      if(fTotal>=3) { ph='game_over'; st='evil_win'; }
      await updateDoc(doc(db,'rooms',roomCode), {
        questVotes: newVotes, questScores: newScores, currentQuestIndex: roomData.currentQuestIndex+1,
        phase: ph, status: st, leaderIndex: (roomData.leaderIndex+1)%roomData.playerCount
      });
    } else {
      await updateDoc(doc(db,'rooms',roomCode), { [`questVotes.${user.uid}`]: success });
    }
  };

  if(!isMember) return <div className="text-center py-12 text-slate-500 font-bold text-sm opacity-60">⚔️ 원정대가 임무를 수행 중입니다...</div>;
  if(acted) return <div className="text-center py-12 text-slate-500 font-bold text-sm">⏳ 결과를 기다리는 중...</div>;

  const isEvil = ['암살자','모르가나','미니언','오베론','모드레드'].includes(myRole);
  
  return (
    <div className="space-y-6 animate-in zoom-in duration-300">
      <div className="text-center">
        <h3 className="text-lg font-black text-white">임무 수행</h3>
        <p className="text-xs text-slate-500 font-bold uppercase mt-1">Determine the Fate</p>
      </div>
      <div className="flex gap-4">
        <button onClick={()=>action(true)} className="flex-1 bg-slate-800 hover:bg-blue-600 border border-slate-700 hover:border-blue-500 p-6 rounded-2xl flex flex-col items-center gap-3 transition-all active:scale-95 group">
          <Shield size={32} className="text-blue-500 group-hover:text-white"/>
          <span className="font-black text-blue-400 group-hover:text-white">성공</span>
        </button>
        {isEvil && (
          <button onClick={()=>action(false)} className="flex-1 bg-slate-800 hover:bg-rose-600 border border-slate-700 hover:border-rose-500 p-6 rounded-2xl flex flex-col items-center gap-3 transition-all active:scale-95 group">
            <Sword size={32} className="text-rose-500 group-hover:text-white"/>
            <span className="font-black text-rose-400 group-hover:text-white">실패</span>
          </button>
        )}
      </div>
      {!isEvil && <p className="text-center text-[10px] text-slate-600 font-bold mt-2">* 선의 세력은 '성공'만 선택 가능합니다.</p>}
    </div>
  );
                      }
