/* ===========================================================================
   로얄패밀리 골프동호회 · 앱 보강 모듈 (app-enhance.js)
   기존 index.html 은 건드리지 않고, 아래 한 줄만 추가하면 동작합니다.
       <script src="app-enhance.js?v=9" defer></script>

   담당 기능
   1) 서비스워커 등록 → 오프라인 실행 / 캐시 자동 갱신
   2) 홈 화면 설치 배너(beforeinstallprompt)
   3) 최신 데이터 자동 감지 → "새 데이터가 있습니다 · 새로고침" 알림
   4) 로그인 5회 실패 시 60초 입력 잠금 (서버 잠금과 별개의 1차 방어)
   모든 기능은 실패해도 앱 동작에 영향을 주지 않도록 try/catch 로 감쌌습니다.
   =========================================================================== */
(function () {
  'use strict';

  var API = localStorage.getItem('mcd.api') ||
    'https://script.google.com/macros/s/AKfycbzRV8p79_wzRO2xjBLRTHVqdi6houqaPl-FvhidIEgW1m0hZH5v0D2LN03s3KNYrQoVKQ/exec';
  var ACC_KEY = 'golf.access';
  var POLL_MS = 180000;        // 3분마다 (탭이 보일 때만)
  var LOCK_FAILS = 5;          // 연속 실패 허용 횟수
  var LOCK_MS = 60000;         // 잠금 시간
  var LS_FAIL = 'royal.fails';
  var LS_LOCK = 'royal.lock';

  function $(id) { return document.getElementById(id); }
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- 공통 스타일 (앱 CSS와 충돌하지 않도록 접두사 고정) ---------- */
  function injectStyle() {
    if (document.getElementById('royal-style')) return;
    var css = ''
      + '#royal-bar{position:fixed;left:12px;right:12px;top:12px;z-index:9999;display:none;align-items:center;gap:10px;'
      + 'padding:12px 14px;border-radius:14px;background:#0C3B2E;color:#F4F1E6;font:600 15px/1.35 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;'
      + 'box-shadow:0 12px 30px rgba(0,0,0,.28);border:1px solid rgba(201,162,39,.55)}'
      + '#royal-bar .rb-txt{flex:1}'
      + '#royal-bar button{border:0;border-radius:10px;padding:9px 14px;font-weight:800;font-size:14px;cursor:pointer}'
      + '#royal-bar .rb-go{background:#E7CE86;color:#0C3B2E}'
      + '#royal-bar .rb-x{background:transparent;color:#9FB6AB;font-weight:700;padding:9px 6px}'
      + '#royal-install{position:fixed;right:16px;bottom:86px;z-index:9998;display:none;align-items:center;gap:8px;'
      + 'padding:11px 15px;border-radius:999px;background:#E7CE86;color:#0C3B2E;font:800 14px/1 -apple-system,"Apple SD Gothic Neo",sans-serif;'
      + 'box-shadow:0 10px 24px rgba(0,0,0,.3);border:0;cursor:pointer}'
      + '#royal-install .ri-ic{font-size:15px}'
      + '@media (display-mode: standalone){#royal-install{display:none !important}}';
    var s = document.createElement('style');
    s.id = 'royal-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- 토스트 바 ---------- */
  var barClose = 0;
  function bar(msg, actionText, onAction, opts) {
    try {
      injectStyle();
      var el = $('royal-bar');
      if (!el) {
        el = document.createElement('div');
        el.id = 'royal-bar';
        document.body.appendChild(el);
      }
      el.innerHTML = '';
      var txt = document.createElement('div');
      txt.className = 'rb-txt';
      txt.textContent = msg;
      el.appendChild(txt);
      if (actionText) {
        var go = document.createElement('button');
        go.className = 'rb-go';
        go.type = 'button';
        go.textContent = actionText;
        go.addEventListener('click', function () { hide(); try { onAction(); } catch (e) {} });
        el.appendChild(go);
      }
      var x = document.createElement('button');
      x.className = 'rb-x';
      x.type = 'button';
      x.textContent = '닫기';
      x.addEventListener('click', hide);
      el.appendChild(x);
      el.style.display = 'flex';
      if (!(opts && opts.sticky)) {
        var my = ++barClose;
        setTimeout(function () { if (my === barClose) hide(); }, (opts && opts.ms) || 12000);
      }
      function hide() { barClose++; if (el) el.style.display = 'none'; }
    } catch (e) {}
  }

  /* ---------- 1) 서비스워커 ---------- */
  try {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
      });
    }
  } catch (e) {}

  /* ---------- 2) 설치 배너 ---------- */
  var deferredPrompt = null;
  var standalone = false;
  try {
    standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  } catch (e) {}

  function showInstallBtn() {
    try {
      if (standalone) return;
      injectStyle();
      var b = $('royal-install');
      if (!b) {
        b = document.createElement('button');
        b.id = 'royal-install';
        b.type = 'button';
        b.innerHTML = '<span class="ri-ic">＋</span><span>앱 설치</span>';
        b.addEventListener('click', function () {
          if (!deferredPrompt) { bar('Safari는 공유 → 홈 화면에 추가로 설치합니다.', null, null, { ms: 9000 }); return; }
          deferredPrompt.prompt();
          deferredPrompt.userChoice.then(function () { deferredPrompt = null; b.style.display = 'none'; });
        });
        document.body.appendChild(b);
      }
      b.style.display = 'flex';
    } catch (e) {}
  }

  try {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      ready(showInstallBtn);
    });
    window.addEventListener('appinstalled', function () {
      var b = $('royal-install');
      if (b) b.style.display = 'none';
      deferredPrompt = null;
    });
  } catch (e) {}

  /* ---------- 3) 최신 데이터 자동 감지 ---------- */
  var lastSig = null;
  var busy = false;
  var prompted = false;

  function sigOf(s) {           // FNV-1a 32bit
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h.toString(16);
  }

  function isGateVisible() {
    var g = $('gate');
    if (!g) return false;
    var st = window.getComputedStyle(g);
    return st.display !== 'none' && st.visibility !== 'hidden';
  }

  function fetchData(token) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'mt.api', params: { fn: 'getData', args: [token] } })
    }).then(function (r) { return r.json(); });
  }

  function checkFresh() {
    try {
      if (busy) return;
      var token = read(ACC_KEY) || '';
      if (!token) return;
      if (document.visibilityState === 'hidden') return;
      if (isGateVisible()) return;
      busy = true;
      fetchData(token).then(function (data) {
        busy = false;
        if (!data || typeof data !== 'object') return;
        if (data.ok === false || data.error) return;
        var sig = sigOf(JSON.stringify(data));
        if (lastSig === null) { lastSig = sig; return; }
        if (sig !== lastSig && !prompted) {
          lastSig = sig;
          prompted = true;
          bar('새 데이터가 등록되었습니다.', '새로고침', function () {
            try { location.reload(); } catch (e) {}
          }, { sticky: true });
        }
      }).catch(function () { busy = false; });
    } catch (e) { busy = false; }
  }

  try {
    ready(function () {
      setTimeout(function () { if (!isGateVisible()) checkFresh(); }, 4000);
      setInterval(function () { if (!isGateVisible()) checkFresh(); }, POLL_MS);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && !isGateVisible()) checkFresh();
      });
      window.addEventListener('online', function () { checkFresh(); });
      window.addEventListener('offline', function () {
        bar('오프라인 상태입니다 · 저장된 화면으로 계속 사용할 수 있습니다.', null, null, { ms: 6000 });
      });
    });
  } catch (e) {}

  /* ---------- 4) 로그인 실패 잠금 ---------- */
  function fails() { return parseInt(read(LS_FAIL) || '0', 10) || 0; }
  function lockUntil() { return parseInt(read(LS_LOCK) || '0', 10) || 0; }
  function clearFails() { store(LS_FAIL, '0'); }

  function enforceLock() {
    try {
      var form = $('gForm'), err = $('gErr'), inp = $('gCode'), btn = $('gGo');
      if (!form) return;
      var left = lockUntil() - Date.now();
      if (left > 0) {
        if (inp) inp.disabled = true;
        if (btn) btn.disabled = true;
        if (err) err.textContent = '시도 횟수 초과 · ' + Math.ceil(left / 1000) + '초 후 다시 시도하세요';
        setTimeout(enforceLock, 1000);
      } else if (lockUntil()) {
        store(LS_LOCK, '0');
        if (inp) inp.disabled = false;
        if (btn) btn.disabled = false;
        if (err && /시도 횟수 초과/.test(err.textContent || '')) err.textContent = '';
      }
    } catch (e) {}
  }

  try {
    ready(function () {
      var err = $('gErr');
      if (err) {
        var obs = new MutationObserver(function () {
          var t = err.textContent || '';
          if (/올바르지 않습니다/.test(t)) {
            var n = fails() + 1;
            if (n >= LOCK_FAILS) {
              store(LS_LOCK, String(Date.now() + LOCK_MS));
              store(LS_FAIL, '0');
              enforceLock();
            } else {
              store(LS_FAIL, String(n));
              if (n >= 3) bar('비밀번호를 ' + (LOCK_FAILS - n) + '회 더 틀리면 1분간 입력이 잠깁니다.', null, null, { ms: 6000 });
            }
          }
        });
        obs.observe(err, { childList: true, characterData: true, subtree: true });
      }
      enforceLock();
      // 로그인 성공 상태면 실패 카운트 초기화
      setInterval(function () { if (read(ACC_KEY) && !isGateVisible()) clearFails(); }, 15000);
    });
  } catch (e) {}

  /* ---------- 외부에서 쓸 수 있는 최소 API ---------- */
  window.RoyalEnhance = {
    checkFresh: checkFresh,
    notify: bar,
    version: 'v9-2026-11-06'
  };
})();
