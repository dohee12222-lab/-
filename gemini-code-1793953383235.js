import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, ChevronRight, Lock, LogOut, Settings, BarChart3, RotateCcw, AlertTriangle, ChevronDown } from 'lucide-react';

// === [1. 복사해둔 Supabase 정보 입력] ===
const SUPABASE_URL = "https://qkhywqfhfxvwydvbqbvg.supabase.co"; // 본인 Project URL
const SUPABASE_ANON_KEY = "복사한_anon_key_입력"; // 본인 anon key

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 간이 브라우저 지문 생성 (중복 투표 차단용)
const getFingerprint = () => {
  const raw = `${navigator.userAgent}-${screen.width}x${screen.height}-${navigator.language}-${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return "fp_" + Math.abs(hash);
};

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.pathname.startsWith('/admin'));
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminTab, setAdminTab] = useState('status'); // 'status' | 'settings'

  // 선거 데이터 상태
  const [election, setElection] = useState(null);
  const [loading, setLoading] = useState(true);

  // 모바일 투표자 상태
  const [step, setStep] = useState('home'); // 'home' | 'vote' | 'completed'
  const [currentPollIndex, setCurrentPollIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);

  // 1. Supabase 실시간 데이터 구독 및 로드
  useEffect(() => {
    fetchElectionData();
    checkIfAlreadyVoted();

    // Supabase Realtime 구독 (투표 발생 시 화면 즉시 갱신)
    const channel = supabase
      .channel('election-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'elections' }, (payload) => {
        if (payload.new) setElection(payload.new);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchElectionData = async () => {
    const { data, error } = await supabase.from('elections').select('*').eq('id', 'main').single();
    if (data) setElection(data);
    setLoading(false);
  };

  const checkIfAlreadyVoted = async () => {
    const fp = getFingerprint();
    const localFlag = localStorage.getItem('has_voted_session');
    const { data } = await supabase.from('voter_devices').select('fingerprint').eq('fingerprint', fp).single();
    
    if (data || localFlag) {
      setHasVoted(true);
      setStep('completed');
    }
  };

  // 투표 제출 처리 (익명 유지 & 중복 기록)
  const handleConfirmVote = async () => {
    if (!selectedOptionId || !election) return;

    const fp = getFingerprint();
    // 1. 기기 지문 기록 (중복 투표 차단)
    await supabase.from('voter_devices').insert({ fingerprint: fp });
    localStorage.setItem('has_voted_session', 'true');

    // 2. 익명 카운트 증가 (어떤 사용자인지 기록하지 않음)
    const updatedPolls = election.polls.map((poll, idx) => {
      if (idx === currentPollIndex) {
        return {
          ...poll,
          options: poll.options.map((opt) =>
            opt.id === selectedOptionId ? { ...opt, votes: (opt.votes || 0) + 1 } : opt
          ),
        };
      }
      return poll;
    });

    await supabase.from('elections').update({ polls: updatedPolls }).eq('id', 'main');

    setShowConfirmModal(false);
    setSelectedOptionId(null);

    // 다음 투표 안건으로 이동 or 완료
    if (currentPollIndex < election.polls.length - 1) {
      setCurrentPollIndex((prev) => prev + 1);
    } else {
      setHasVoted(true);
      setStep('completed');
    }
  };

  // 관리자 설정 저장
  const handleSaveAdminSettings = async () => {
    await supabase.from('elections').update({
      title: election.title,
      start_date: election.start_date,
      end_date: election.end_date,
      total_eligible: election.total_eligible,
      polls: election.polls,
    }).eq('id', 'main');
    alert('설정이 저장되었습니다!');
  };

  // 투표 데이터 초기화 (관리자용)
  const handleResetAllVotes = async () => {
    if (!confirm('정말 모든 투표 결과와 기기 기록을 초기화하시겠습니까?')) return;
    await supabase.from('voter_devices').delete().neq('fingerprint', 'none');
    const resetPolls = election.polls.map((p) => ({
      ...p,
      options: p.options.map((o) => ({ ...o, votes: 0 })),
    }));
    await supabase.from('elections').update({ polls: resetPolls }).eq('id', 'main');
    localStorage.removeItem('has_voted_session');
    alert('모든 투표 기록이 초기화되었습니다.');
  };

  if (loading || !election) {
    return <div className="min-h-screen flex items-center justify-center font-bold text-slate-500">데이터를 불러오는 중...</div>;
  }

  const totalVoters = Math.max(...election.polls.map((p) => p.options.reduce((sum, o) => sum + (o.votes || 0), 0)), 0);
  const participationRate = ((totalVoters / (election.total_eligible || 1)) * 100).toFixed(2);

  // =========================================================
  // 1. 관리자 화면 (/admin 접속 시)
  // =========================================================
  if (isAdminRoute) {
    if (!isAdminLoggedIn) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
            <div className="flex justify-center mb-4 text-blue-600"><Lock size={40} /></div>
            <h2 className="text-xl font-bold text-center text-slate-800 mb-2">선거 관리자 인증</h2>
            <p className="text-xs text-center text-slate-400 mb-6">진행자 전용 대시보드입니다.</p>
            <input
              type="password"
              placeholder="관리자 비밀번호 (기본: admin1234)"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 text-sm mb-4 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => {
                if (adminPassword === 'admin1234') setIsAdminLoggedIn(true);
                else alert('비밀번호가 일치하지 않습니다.');
              }}
              className="w-full bg-[#0091ff] hover:bg-blue-600 text-white font-bold py-3 rounded-xl transition"
            >
              로그인
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-100 p-4 md:p-8">
        <header className="max-w-6xl mx-auto flex justify-between items-center bg-white p-5 rounded-2xl shadow-sm border border-slate-200 mb-6">
          <div>
            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Admin Dashboard</span>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800">{election.title}</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setAdminTab(adminTab === 'status' ? 'settings' : 'status')}
              className="px-4 py-2 border rounded-xl text-sm font-semibold flex items-center gap-1.5 hover:bg-slate-50"
            >
              {adminTab === 'status' ? <Settings size={16} /> : <BarChart3 size={16} />}
              {adminTab === 'status' ? '선거 설정' : '실시간 현황'}
            </button>
            <button
              onClick={() => setIsAdminLoggedIn(false)}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold flex items-center gap-1.5"
            >
              <LogOut size={16} /> 로그아웃
            </button>
          </div>
        </header>

        {adminTab === 'status' ? (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
              <h3 className="font-bold text-slate-700 mb-1">현장 투표 참여용 QR</h3>
              <p className="text-xs text-slate-400 mb-6">프로젝터에 띄워 참여자들이 스캔할 수 있도록 하세요</p>
              <div className="p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-inner mb-4">
                <QRCodeSVG value={window.location.origin} size={180} />
              </div>
              <span className="text-xs text-slate-400">{window.location.origin}</span>
            </div>

            <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">실시간 투표 집계 현황</h3>
                  <p className="text-xs text-slate-400">총 {election.total_eligible}명 중 {totalVoters}명 참여 ({participationRate}%)</p>
                </div>
                <button
                  onClick={handleResetAllVotes}
                  className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1"
                >
                  <RotateCcw size={12} /> 데이터 초기화
                </button>
              </div>

              <div className="space-y-6">
                {election.polls.map((poll) => {
                  const pollTotal = poll.options.reduce((s, o) => s + (o.votes || 0), 0);
                  return (
                    <div key={poll.id} className="border border-slate-100 rounded-xl p-4 bg-slate-50/50">
                      <h4 className="font-bold text-slate-700 mb-3 text-sm">{poll.title}</h4>
                      <div className="space-y-2">
                        {poll.options.map((opt) => {
                          const pct = pollTotal > 0 ? ((opt.votes / pollTotal) * 100).toFixed(1) : 0;
                          return (
                            <div key={opt.id}>
                              <div className="flex justify-between text-xs font-semibold mb-1">
                                <span>{opt.name}</span>
                                <span>{opt.votes}표 ({pct}%)</span>
                              </div>
                              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                <div className="bg-[#0091ff] h-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-4">
            <h3 className="font-bold text-lg text-slate-800 mb-4">선거 및 문항 설정</h3>
            <div>
              <label className="text-xs font-bold text-slate-500">선거 제목</label>
              <input
                type="text"
                value={election.title}
                onChange={(e) => setElection({ ...election, title: e.target.value })}
                className="w-full border rounded-xl px-3 py-2 text-sm mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500">시작 일시</label>
                <input
                  type="text"
                  value={election.start_date}
                  onChange={(e) => setElection({ ...election, start_date: e.target.value })}
                  className="w-full border rounded-xl px-3 py-2 text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500">종료 일시</label>
                <input
                  type="text"
                  value={election.end_date}
                  onChange={(e) => setElection({ ...election, end_date: e.target.value })}
                  className="w-full border rounded-xl px-3 py-2 text-sm mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500">총 유권자 수 (정원)</label>
              <input
                type="number"
                value={election.total_eligible}
                onChange={(e) => setElection({ ...election, total_eligible: Number(e.target.value) })}
                className="w-full border rounded-xl px-3 py-2 text-sm mt-1"
              />
            </div>
            <button
              onClick={handleSaveAdminSettings}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl mt-4"
            >
              설정 저장 및 즉시 반영
            </button>
          </div>
        )}
      </div>
    );
  }

  // =========================================================
  // 2. 참여자 모바일 화면 (일반 접속자 루트 '/')
  // =========================================================
  const currentPoll = election.polls[currentPollIndex];

  return (
    <div className="min-h-screen bg-slate-200 flex justify-center">
      <div className="w-full max-w-[420px] bg-slate-50 min-h-screen flex flex-col shadow-2xl relative">
        {/* 네이비 헤더 */}
        <div className="bg-[#0a2540] text-white py-4 px-5 text-center font-bold tracking-tight shadow-md">
          {step === 'vote' ? `[제 ${currentPollIndex + 1} 투표] ${currentPoll.title}` : election.title}
        </div>

        {/* 메인 홈 화면 */}
        {step === 'home' && (
          <div className="flex-1 p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-blue-100">
                <span className="text-[11px] font-bold text-blue-500 border border-blue-400 rounded-full px-2 py-0.5">▷ 투표 시작</span>
                <span className="text-xs font-medium text-slate-600">{election.start_date}</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-red-100">
                <span className="text-[11px] font-bold text-red-500 border border-red-400 rounded-full px-2 py-0.5">□ 투표 종료</span>
                <span className="text-xs font-medium text-slate-600">{election.end_date}</span>
              </div>
            </div>

            {/* 도넛 차트 */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 flex flex-col items-center justify-center">
              <div className="relative w-44 h-44 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#e2e8f0" strokeWidth="12" />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    fill="transparent"
                    stroke="#ff5b60"
                    strokeWidth="12"
                    strokeDasharray="251.2"
                    strokeDashoffset={251.2 - (251.2 * Number(participationRate)) / 100}
                    strokeLinecap="round"
                    className="transition-all duration-1000"
                  />
                </svg>
                <div className="absolute text-center">
                  <div className="text-[12px] font-semibold text-sky-500">실시간 투표율</div>
                  <div className="text-xl font-black text-sky-600">{participationRate}%</div>
                </div>
              </div>
            </div>

            {/* 버튼 그룹 */}
            <div className="grid grid-cols-2 gap-3">
              <button className="bg-[#0091ff] text-white py-3 rounded-xl font-bold text-sm shadow">
                후보자/안건 정보
              </button>
              <button
                onClick={() => setStep('vote')}
                disabled={hasVoted}
                className={`py-3 rounded-xl font-bold text-sm shadow transition ${
                  hasVoted ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-[#0091ff] text-white'
                }`}
              >
                {hasVoted ? '투표 완료됨' : '투표참여'}
              </button>
            </div>

            {/* 하단 안건별 현황 */}
            <div className="space-y-2 pt-2">
              {election.polls.map((poll, idx) => {
                const votes = poll.options.reduce((s, o) => s + (o.votes || 0), 0);
                return (
                  <div key={poll.id} className="bg-white rounded-xl p-3 border border-slate-200 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-slate-500">제 {idx + 1} 투표</div>
                      <div className="text-xs font-bold text-slate-800">{poll.title}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-lime-600 bg-lime-100 px-2 py-0.5 rounded">
                        {votes}명 / {election.total_eligible}명
                      </span>
                      <ChevronDown size={14} className="text-slate-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 투표 기표 화면 */}
        {step === 'vote' && (
          <div className="flex-1 p-5 flex flex-col justify-between">
            <div className="space-y-3">
              {currentPoll.options.map((opt, idx) => {
                const isSelected = selectedOptionId === opt.id;
                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedOptionId(opt.id)}
                    className={`bg-white rounded-2xl p-4 border-2 flex items-center justify-between cursor-pointer transition ${
                      isSelected ? 'border-red-500 shadow-md bg-red-50/10' : 'border-slate-100 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600 text-xs">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-800 text-base">{opt.name}</span>
                    </div>

                    {/* 대한민국 선거 기표 마크 SVG */}
                    <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-red-500 text-red-500' : 'border-slate-300 text-slate-300'}`}>
                      <svg viewBox="0 0 24 24" className="w-6 h-6 fill-none stroke-current stroke-2">
                        <circle cx="12" cy="12" r="9" />
                        <line x1="12" y1="3" x2="12" y2="21" />
                        <line x1="12" y1="12" x2="19" y2="18" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              disabled={!selectedOptionId}
              onClick={() => setShowConfirmModal(true)}
              className={`w-full py-4 rounded-xl font-bold text-base shadow flex items-center justify-center gap-2 ${
                selectedOptionId ? 'bg-[#0091ff] text-white' : 'bg-slate-300 text-slate-400 cursor-not-allowed'
              }`}
            >
              다음 투표 <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* 확인 모달 */}
        {showConfirmModal && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center p-5 z-50">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
              <h4 className="font-bold text-slate-800 text-sm">[{currentPoll.title}]</h4>
              <p className="text-xs text-sky-600 font-semibold leading-relaxed">
                선택하신 후보자가 맞습니까?<br />확인을 누르면 투표가 반영됩니다.
              </p>
              <div className="p-3 border-2 border-blue-400 rounded-xl flex items-center justify-between">
                <span className="font-bold text-slate-800">
                  {currentPoll.options.find((o) => o.id === selectedOptionId)?.name}
                </span>
                <span className="text-red-500 font-bold text-xl">㉦</span>
              </div>
              <div className="space-y-2 pt-2">
                <button
                  onClick={handleConfirmVote}
                  className="w-full bg-[#0091ff] text-white py-3 rounded-xl font-bold text-sm"
                >
                  ○ 네, 맞습니다.
                </button>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="w-full bg-slate-400 text-white py-3 rounded-xl font-bold text-sm"
                >
                  ✕ 아니오, 다시 선택할게요
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 투표 완료 화면 */}
        {step === 'completed' && (
          <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm w-full flex flex-col items-center">
              <CheckCircle2 size={56} className="text-emerald-500 mb-4" />
              <h3 className="text-xl font-extrabold text-slate-800 mb-2">투표 완료</h3>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                성공적으로 투표가 집계되었습니다.<br />동일 기기에서는 중복 투표가 불가합니다.
              </p>
              <button
                onClick={() => setStep('home')}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl font-bold text-sm transition"
              >
                실시간 투표율 확인하기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}