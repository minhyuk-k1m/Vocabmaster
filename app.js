/* ========================================
   VocabMaster - App Logic (v4)
   ======================================== */

// ── Storage ──
function getUsers(){const d=localStorage.getItem('vocabmaster_users');return d?JSON.parse(d):{}}
function saveUsers(u){localStorage.setItem('vocabmaster_users',JSON.stringify(u))}
function setCurrentUser(id){sessionStorage.setItem('vocabmaster_current_user',id)}
function getCurrentUser(){return sessionStorage.getItem('vocabmaster_current_user')}
function clearCurrentUser(){sessionStorage.removeItem('vocabmaster_current_user')}
function getNickname(uid){return localStorage.getItem(`vocabmaster_nickname_${uid}`)||''}
function saveNickname(uid,nick){localStorage.setItem(`vocabmaster_nickname_${uid}`,nick)}
function getVocabSets(uid){const d=localStorage.getItem(`vocabmaster_vocabs_${uid}`);return d?JSON.parse(d):[]}
function saveVocabSets(uid,sets){localStorage.setItem(`vocabmaster_vocabs_${uid}`,JSON.stringify(sets))}

// ── Data Sync & Backup System (Zero-Signup) ──
// ntfy.sh: 무료, 무가입, CORS 지원 pub/sub 서비스
const NTFY_BASE_URL = "https://ntfy.sh";
const NTFY_TOPIC_PREFIX = "vocabmaster_sync_";

// XOR Cipher for Client-side encryption using sync code
function xorCipher(text, key) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

// Convert string to Base64 safely handling UTF-8 (Korean characters)
function encryptData(dataObj, code) {
  const jsonStr = JSON.stringify(dataObj);
  const utf8Bytes = encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  });
  const encrypted = xorCipher(utf8Bytes, code);
  return btoa(encrypted);
}

function decryptData(encryptedBase64, code) {
  try {
    const encrypted = atob(encryptedBase64);
    const decryptedBytes = xorCipher(encrypted, code);
    const jsonStr = decodeURIComponent(decryptedBytes.split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Decryption failed:", e);
    return null;
  }
}

// Package all local storage data belonging to all users
function getBackupData() {
  const backup = {
    currentUser: getCurrentUser(),
    users: getUsers(),
    vocabs: {},
    learned: {}
  };
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith("vocabmaster_vocabs_")) {
      const uid = key.replace("vocabmaster_vocabs_", "");
      try {
        backup.vocabs[uid] = JSON.parse(localStorage.getItem(key));
      } catch(e){}
    } else if (key.startsWith("vocabmaster_learned_")) {
      const uid = key.replace("vocabmaster_learned_", "");
      try {
        backup.learned[uid] = JSON.parse(localStorage.getItem(key));
      } catch(e){}
    }
  }
  return backup;
}

// Restore data from backup object
function restoreBackupData(backup) {
  if (!backup || typeof backup !== 'object') return false;
  try {
    if (backup.users) {
      const currentUsers = getUsers();
      const mergedUsers = { ...currentUsers, ...backup.users };
      saveUsers(mergedUsers);
    }
    
    if (backup.vocabs) {
      for (const uid in backup.vocabs) {
        localStorage.setItem(`vocabmaster_vocabs_${uid}`, JSON.stringify(backup.vocabs[uid]));
      }
    }
    
    if (backup.learned) {
      for (const uid in backup.learned) {
        localStorage.setItem(`vocabmaster_learned_${uid}`, JSON.stringify(backup.learned[uid]));
      }
    }

    if (backup.currentUser) {
      sessionStorage.setItem('vocabmaster_current_user', backup.currentUser);
      localStorage.setItem('vocabmaster_current_user', backup.currentUser);
    }
    return true;
  } catch (e) {
    console.error("Restore failed:", e);
    return false;
  }
}

// ── File Export/Import ──
function exportToFile() {
  const data = getBackupData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocabmaster_backup_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("데이터 백업 파일이 저장되었습니다.");
}

function importFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (restoreBackupData(data)) {
        showToast("파일 백업 복구가 완료되었습니다! 3초 후 새로고침합니다.");
        setTimeout(() => location.reload(), 3000);
      } else {
        showToast("올바른 백업 파일 형식이 아닙니다.");
      }
    } catch(err) {
      showToast("파일을 읽는 도중 오류가 발생했습니다.");
    }
  };
  reader.readAsText(file);
}

// ── Cloud 6-Digit Sync (ntfy.sh) ──
async function exportToCloudSync() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const data = getBackupData();
  const encrypted = encryptData(data, code);
  const topic = `${NTFY_TOPIC_PREFIX}${code}`;
  
  // 먼저 클라우드에 전송 시도 (CORS Simple Request를 위해 커스텀 헤더는 제외)
  try {
    const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      body: encrypted
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    showToast("클라우드 전송 실패. 네트워크 상태를 확인하세요.");
    return;
  }

  // 전송 성공 후 코드 표시
  openModal(`
    <h3 class="modal-title">클라우드 동기화 코드 생성</h3>
    <p class="modal-desc">아래의 6자리 코드를 다른 기기에서 입력하면 로그인 및 단어장 정보가 즉시 복구됩니다.</p>
    <div style="font-size: 2.2rem; font-weight: 800; letter-spacing: 0.1em; color: var(--accent); margin: 24px 0; text-align: center;" id="sync-code-display">${code}</div>
    <p class="modal-desc" style="font-size: 0.85rem; color: var(--error);" id="sync-timer-display">유효시간: 12시간</p>
    <div class="modal-actions">
      <button class="modal-btn-cancel" id="modal-sync-close" style="width: 100%;">닫기</button>
    </div>
  `);
  showToast("동기화 코드가 클라우드에 성공적으로 등록되었습니다.");

  document.getElementById('modal-sync-close').addEventListener('click', () => {
    closeModal();
  });
}

async function importFromCloudSync() {
  openModal(`
    <h3 class="modal-title">동기화 코드 입력</h3>
    <p class="modal-desc">다른 기기에서 생성된 6자리 동기화 코드를 입력해 주세요.</p>
    <input type="text" id="input-sync-code" class="modal-input" placeholder="6자리 숫자 입력" maxlength="6" style="text-align: center; font-size: 1.5rem; font-weight: 700; letter-spacing: 0.2em; height: 50px;">
    <div class="modal-actions">
      <button class="modal-btn-cancel" id="modal-import-cancel">취소</button>
      <button class="modal-btn-primary" id="modal-import-confirm">가져오기</button>
    </div>
  `);
  
  const inputEl = document.getElementById('input-sync-code');
  if (inputEl) inputEl.focus();
  
  document.getElementById('modal-import-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-import-confirm').addEventListener('click', async () => {
    const code = inputEl.value.trim();
    if (code.length !== 6 || isNaN(code)) {
      showToast("올바른 6자리 숫자를 입력하세요.");
      return;
    }
    
    const confirmBtn = document.getElementById('modal-import-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = "가져오는 중...";
    const topic = `${NTFY_TOPIC_PREFIX}${code}`;
    
    try {
      // ntfy.sh 폴링: 대기 없이 캐시된 메시지만 즉시 조회 (클럭 스큐와 오작동 방지를 위해 since/t 제거)
      const res = await fetch(`${NTFY_BASE_URL}/${topic}/json?poll=1`);
      if (!res.ok) throw new Error("not_found");
      const text = await res.text();
      const lines = text.trim().split('\n').filter(l => l.length > 0);
      
      if (lines.length === 0) throw new Error("not_found");
      
      // open 이나 keepalive 이벤트가 배열 끝에 있을 수 있으므로, 뒤에서부터 돌며 실제 message를 담은 행을 찾음
      let encrypted = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.event === 'message' && parsed.message) {
            encrypted = parsed.message;
            break;
          }
        } catch (e) {}
      }
      
      if (!encrypted) throw new Error("not_found");
      
      let decrypted = null;
      try {
        decrypted = decryptData(encrypted, code);
      } catch (decErr) {
        throw new Error(`decrypt_failed: ${decErr.message}`);
      }
      
      if (!decrypted) {
        throw new Error("decrypt_failed: 해독 결과가 비어있습니다.");
      }
      
      let restoreSuccess = false;
      try {
        restoreSuccess = restoreBackupData(decrypted);
      } catch (restErr) {
        throw new Error(`restore_failed: ${restErr.message}`);
      }
      
      if (restoreSuccess) {
        closeModal();
        showToast("동기화가 완료되었습니다.");
        
        // 새로고침 없이 즉시 로그인 세션을 활성화하고 메인 화면으로 전이
        const activeUid = decrypted.currentUser;
        if (activeUid) {
          enterMainScreen(activeUid);
        } else {
          showToast("경고: 동기화된 데이터에 활성 로그인 계정 정보가 없습니다.");
        }
      } else {
        throw new Error("restore_failed: 데이터 저장소 복구 함수가 실패했습니다.");
      }
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "가져오기";
      if (err.message === "not_found") {
        showToast("존재하지 않거나 만료된 동기화 코드입니다.");
      } else if (err.message.startsWith("decrypt_failed")) {
        showToast(`데이터 해독 실패: 코드를 다시 확인하세요.`);
      } else {
        showToast(`동기화 실패: ${err.message}`);
      }
    }
  });
}

function initSyncSettingsListeners() {
  const btnSyncExport = document.getElementById('btn-sync-export');
  const btnSyncImport = document.getElementById('btn-sync-import');
  const btnFileExport = document.getElementById('btn-file-export');
  const btnFileImportTrigger = document.getElementById('btn-file-import-trigger');
  const fileImportInput = document.getElementById('file-import-input');
  const loginSyncBtn = document.getElementById('login-sync-btn');

  if (btnSyncExport) btnSyncExport.addEventListener('click', exportToCloudSync);
  if (btnSyncImport) btnSyncImport.addEventListener('click', importFromCloudSync);
  if (loginSyncBtn) loginSyncBtn.addEventListener('click', importFromCloudSync);
  if (btnFileExport) btnFileExport.addEventListener('click', exportToFile);
  if (btnFileImportTrigger && fileImportInput) {
    btnFileImportTrigger.addEventListener('click', () => fileImportInput.click());
    fileImportInput.addEventListener('change', (e) => importFromFile(e.target.files[0]));
  }
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

// ── Learned Words Tracker ──
function recordLearnedWord(wordText) {
  const uid = getCurrentUser();
  if(!uid) return;
  const today = new Date().toISOString().split('T')[0];
  const key = `vocabmaster_learned_${uid}`;
  const data = localStorage.getItem(key);
  let list = data ? JSON.parse(data) : [];
  const exists = list.some(item => item.word.toLowerCase() === wordText.toLowerCase() && item.date === today);
  if(!exists) {
    list.push({word: wordText, date: today});
    localStorage.setItem(key, JSON.stringify(list));
  }
}

function getTodayLearnedCount() {
  const uid = getCurrentUser();
  if(!uid) return 0;
  const today = new Date().toISOString().split('T')[0];
  const key = `vocabmaster_learned_${uid}`;
  const data = localStorage.getItem(key);
  if(!data) return 0;
  const list = JSON.parse(data);
  const todayList = list.filter(item => item.date === today);
  const uniqueWords = new Set(todayList.map(item => item.word.toLowerCase()));
  return uniqueWords.size;
}

let studyCountTimer = null;
function animateStudyCount() {
  const container = document.getElementById('home-study-count');
  if(!container) return;
  
  clearInterval(studyCountTimer);
  const count = getTodayLearnedCount();
  if(count === 0) {
    container.innerHTML = `<span class="go-study-text">어서 빨리 첫 단어를 배우러 가요!</span>`;
    return;
  }
  
  let current = 0;
  container.innerHTML = `오늘 <span class="number-highlight" id="anim-num">0</span>개의 단어를 학습했어요!`;
  const numEl = document.getElementById('anim-num');
  
  const duration = 1000; // 1s
  const stepTime = Math.max(Math.floor(duration / count), 30);
  
  studyCountTimer = setInterval(() => {
    current++;
    if(numEl) numEl.textContent = current;
    if(current >= count) {
      clearInterval(studyCountTimer);
    }
  }, stepTime);
}

// ── Text Bold Helpers ──
function boldWordInEnglish(sentence, word) {
  const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`\\b(${escaped}[a-z]*)\\b`, 'gi');
  return sentence.replace(regex, '<strong>$1</strong>');
}

function boldWordInKorean(sentence, meaning) {
  const escaped = meaning.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(${escaped}[가-힣]*)`, 'g');
  return sentence.replace(regex, '<strong>$1</strong>');
}


// ── Screen / Page ──
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const t=document.getElementById(id);t.style.display='none';void t.offsetHeight;t.style.display='';t.classList.add('active');
}
let currentPage='home';
function showPage(pid){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const t=document.getElementById('page-'+pid);
  if(t){t.style.display='none';void t.offsetHeight;t.style.display='';t.classList.add('active')}
  currentPage=pid;
  document.querySelectorAll('.menu-item[data-page]').forEach(i=>i.classList.remove('active'));
  const mi=document.querySelector(`.menu-item[data-page="${pid}"]`);if(mi)mi.classList.add('active');
  if(pid==='home') animateStudyCount();
}

// ── Toast ──
let toastT;
function showToast(msg){
  let t=document.querySelector('.toast');
  if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}
  clearTimeout(toastT);t.textContent=msg;t.classList.add('show');
  toastT=setTimeout(()=>t.classList.remove('show'),2500);
}
function shakeElement(el){el.classList.remove('shake');void el.offsetHeight;el.classList.add('shake')}

// ── Sound Effects ──
function playCorrectSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),g=ctx.createGain();
    osc.connect(g);g.connect(ctx.destination);osc.type='sine';
    osc.frequency.setValueAtTime(523.25,ctx.currentTime);
    osc.frequency.setValueAtTime(659.25,ctx.currentTime+.1);
    osc.frequency.setValueAtTime(783.99,ctx.currentTime+.2);
    g.gain.setValueAtTime(.25,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.01,ctx.currentTime+.45);
    osc.start(ctx.currentTime);osc.stop(ctx.currentTime+.45);
  }catch(e){}
}
function playWrongSound(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator(),g=ctx.createGain();
    osc.connect(g);g.connect(ctx.destination);osc.type='square';
    osc.frequency.setValueAtTime(250,ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(150,ctx.currentTime+.25);
    g.gain.setValueAtTime(.15,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.01,ctx.currentTime+.35);
    osc.start(ctx.currentTime);osc.stop(ctx.currentTime+.35);
  }catch(e){}
}

// ── TTS (Text-to-Speech) ──
function speak(text, lang='en-US'){
  if(!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);
  u.lang=lang;u.rate=0.9;u.pitch=1;
  window.speechSynthesis.speak(u);
}
let speakTimeout = null;
function speakCard(card, speakMeaning = true){
  if(speakTimeout) clearTimeout(speakTimeout);
  speak(card.word,'en-US');
  if(speakMeaning) {
    speakTimeout = setTimeout(()=>speak(card.meaning,'ko-KR'),1000);
  }
}

// ── Modal System ──
const modalOverlay=document.getElementById('modal-overlay');
const modalBox=document.getElementById('modal-box');
function openModal(html){modalBox.innerHTML=html;modalOverlay.classList.add('open')}
function closeModal(){modalOverlay.classList.remove('open')}
modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)closeModal()});

// ── Translation Suggestions ──
const suggestCache={};
let suggestAbort=null;
async function fetchSuggestions(word){
  if(!word||word.length<2)return[];
  const key=word.toLowerCase();
  if(suggestCache[key])return suggestCache[key];
  try{
    if(suggestAbort)suggestAbort.abort();
    suggestAbort=new AbortController();
    const res=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ko`,{signal:suggestAbort.signal});
    const data=await res.json();
    const results=new Set();

    function addCleaned(str){
      if(!str)return;
      const parts = str.split(/[,;\/\(\)]/);
      parts.forEach(p => {
        const clean = p.trim();
        if(clean && clean.length > 0 && !/^[A-Za-z\s]+$/.test(clean) && !results.has(clean)){
          results.add(clean);
        }
      });
    }

    if(data.responseData&&data.responseData.translatedText){
      addCleaned(data.responseData.translatedText);
    }
    if(data.matches){
      for(const m of data.matches){
        if(results.size>=5)break;
        addCleaned(m.translation);
      }
    }
    const arr=[...results].slice(0,3);
    suggestCache[key]=arr;
    return arr;
  }catch(e){return[]}
}


// ── Login ──
const loginForm=document.getElementById('login-form'),loginIdInput=document.getElementById('login-id'),loginPwInput=document.getElementById('login-pw'),loginError=document.getElementById('login-error');
loginForm.addEventListener('submit',e=>{
  e.preventDefault();loginError.textContent='';
  const id=loginIdInput.value.trim(),pw=loginPwInput.value;
  if(!id||!pw){loginError.textContent='아이디와 비밀번호를 모두 입력하세요.';shakeElement(loginForm);return}
  const users=getUsers();
  if(!users[id]){loginError.textContent='존재하지 않는 아이디입니다.';shakeElement(loginForm);loginIdInput.focus();return}
  if(users[id]!==pw){loginError.textContent='비밀번호가 일치하지 않습니다.';shakeElement(loginForm);loginPwInput.value='';loginPwInput.focus();return}
  setCurrentUser(id);loginForm.reset();loginError.textContent='';enterMainScreen(id);
});

// ── Signup ──
const signupForm=document.getElementById('signup-form'),signupIdInput=document.getElementById('signup-id'),signupPwInput=document.getElementById('signup-pw'),signupPwConfirm=document.getElementById('signup-pw-confirm'),signupError=document.getElementById('signup-error'),idCheckMsg=document.getElementById('id-check-msg'),pwMatchMsg=document.getElementById('pw-match-msg');
let idCheckTimeout;
signupIdInput.addEventListener('input',()=>{
  clearTimeout(idCheckTimeout);const id=signupIdInput.value.trim();
  if(!id){idCheckMsg.textContent='';idCheckMsg.className='field-message';return}
  if(id.length<3){idCheckMsg.textContent='아이디는 3자 이상이어야 합니다.';idCheckMsg.className='field-message error';return}
  idCheckTimeout=setTimeout(()=>{const u=getUsers();if(u[id]){idCheckMsg.textContent='이미 사용 중인 아이디입니다.';idCheckMsg.className='field-message error'}else{idCheckMsg.textContent='사용 가능한 아이디입니다.';idCheckMsg.className='field-message success'}},300);
});
function checkPasswordMatch(){
  const pw=signupPwInput.value,pc=signupPwConfirm.value;
  if(!pc){pwMatchMsg.textContent='';pwMatchMsg.className='field-message';return}
  if(pw===pc){pwMatchMsg.textContent='비밀번호가 일치합니다.';pwMatchMsg.className='field-message success'}
  else{pwMatchMsg.textContent='비밀번호가 일치하지 않습니다.';pwMatchMsg.className='field-message error'}
}
signupPwInput.addEventListener('input',checkPasswordMatch);
signupPwConfirm.addEventListener('input',checkPasswordMatch);
signupForm.addEventListener('submit',e=>{
  e.preventDefault();signupError.textContent='';
  const id=signupIdInput.value.trim(),pw=signupPwInput.value,pc=signupPwConfirm.value;
  if(!id||!pw||!pc){signupError.textContent='모든 항목을 입력하세요.';shakeElement(signupForm);return}
  if(id.length<3){signupError.textContent='아이디는 3자 이상이어야 합니다.';shakeElement(signupForm);return}
  if(pw.length<4){signupError.textContent='비밀번호는 4자 이상이어야 합니다.';shakeElement(signupForm);return}
  if(pw!==pc){signupError.textContent='비밀번호가 일치하지 않습니다.';shakeElement(signupForm);return}
  const u=getUsers();if(u[id]){signupError.textContent='이미 사용 중인 아이디입니다.';shakeElement(signupForm);return}
  u[id]=pw;saveUsers(u);signupForm.reset();signupError.textContent='';idCheckMsg.textContent='';idCheckMsg.className='field-message';pwMatchMsg.textContent='';pwMatchMsg.className='field-message';
  showScreen('login-screen');showToast('회원가입이 완료되었습니다! 로그인하세요.');
});

// ── Main Screen ──
function enterMainScreen(id){
  const nick = getNickname(id);
  const displayName = nick ? nick : id;
  document.getElementById('welcome-message').textContent=`환영합니다 ${displayName}님!`;
  applySettings();
  showScreen('main-screen');showPage('home');
}

// ── Hamburger Menu ──
const hamburgerBtn=document.getElementById('hamburger-btn'),slideMenu=document.getElementById('slide-menu'),menuOverlayEl=document.getElementById('menu-overlay');
let menuOpen=false;
function toggleMenu(){menuOpen=!menuOpen;hamburgerBtn.classList.toggle('active',menuOpen);slideMenu.classList.toggle('active',menuOpen);menuOverlayEl.classList.toggle('active',menuOpen);hamburgerBtn.setAttribute('aria-expanded',menuOpen);slideMenu.setAttribute('aria-hidden',!menuOpen);hamburgerBtn.setAttribute('aria-label',menuOpen?'메뉴 닫기':'메뉴 열기')}
function closeMenu(){if(!menuOpen)return;menuOpen=false;hamburgerBtn.classList.remove('active');slideMenu.classList.remove('active');menuOverlayEl.classList.remove('active');hamburgerBtn.setAttribute('aria-expanded','false');slideMenu.setAttribute('aria-hidden','true');hamburgerBtn.setAttribute('aria-label','메뉴 열기')}
hamburgerBtn.addEventListener('click',toggleMenu);
menuOverlayEl.addEventListener('click',closeMenu);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen)closeMenu()});
document.querySelectorAll('.menu-item[data-page]').forEach(item=>{
  item.addEventListener('click',()=>{
    const p=item.dataset.page;
    closeMenu();
    if(p==='mypage'){
      renderMyPage();
    }
    showPage(p);
    if(p==='vocab')renderVocabList();
  });
});
document.getElementById('menu-logout-btn').addEventListener('click',()=>{closeMenu();clearCurrentUser();showScreen('login-screen');showToast('로그아웃되었습니다.')});
document.getElementById('show-signup-btn').addEventListener('click',()=>{loginForm.reset();loginError.textContent='';showScreen('signup-screen')});
document.getElementById('show-login-btn').addEventListener('click',()=>{signupForm.reset();signupError.textContent='';idCheckMsg.textContent='';idCheckMsg.className='field-message';pwMatchMsg.textContent='';pwMatchMsg.className='field-message';showScreen('login-screen')});
document.getElementById('back-to-login-btn').addEventListener('click',()=>{signupForm.reset();signupError.textContent='';idCheckMsg.textContent='';idCheckMsg.className='field-message';pwMatchMsg.textContent='';pwMatchMsg.className='field-message';showScreen('login-screen')});

// ============================================
// VOCAB CRUD
// ============================================
const cardsEditor=document.getElementById('cards-editor');
let cardEntries=[];
let editingSetId=null; // null = create new, string = editing existing

function createCardEntryEl(i,w='',m=''){
  const d=document.createElement('div');d.className='card-entry';d.dataset.index=i;
  d.innerHTML=`
    <div class="card-entry-header"><span class="card-number">카드 ${i+1}</span><button class="btn-delete-card" aria-label="카드 삭제" data-index="${i}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="card-fields">
      <div class="card-field"><label>영단어</label><input type="text" class="card-word-input" placeholder="apple" value="${escapeHtml(w)}" autocomplete="off"></div>
      <div class="card-field"><label>뜻</label><input type="text" class="card-meaning-input" placeholder="사과" value="${escapeHtml(m)}"></div>
    </div>
    <div class="card-suggestions" data-index="${i}"></div>`;
  return d;
}

function renderCardEditor(){
  cardsEditor.innerHTML='';
  cardEntries.forEach((c,i)=>cardsEditor.appendChild(createCardEntryEl(i,c.word,c.meaning)));
  // Attach listeners
  cardsEditor.querySelectorAll('.btn-delete-card').forEach(btn=>{
    btn.addEventListener('click',()=>{const idx=+btn.dataset.index;if(cardEntries.length<=1){showToast('카드는 최소 1개 이상이어야 합니다.');return}cardEntries.splice(idx,1);renderCardEditor()});
  });
  cardsEditor.querySelectorAll('.card-entry').forEach((entry,i)=>{
    const wi=entry.querySelector('.card-word-input');
    const mi=entry.querySelector('.card-meaning-input');
    const sugBox=entry.querySelector('.card-suggestions');
    wi.addEventListener('input',()=>{cardEntries[i].word=wi.value;debounceSuggest(wi.value,i,mi,sugBox)});
    mi.addEventListener('input',()=>{cardEntries[i].meaning=mi.value});
    // Hide suggestions on meaning focus or outside click
    mi.addEventListener('focus',()=>{sugBox.innerHTML=''});
  });
}

let suggestTimers={};
function debounceSuggest(word,idx,meaningInput,sugBox){
  clearTimeout(suggestTimers[idx]);
  if(!word||word.length<2){sugBox.innerHTML='';return}
  suggestTimers[idx]=setTimeout(async()=>{
    const results=await fetchSuggestions(word);
    sugBox.innerHTML='';
    if(!results.length)return;
    results.forEach(r=>{
      const btn=document.createElement('button');btn.className='suggestion-item';btn.type='button';
      btn.textContent=r;
      btn.addEventListener('click',()=>{
        meaningInput.value=r;cardEntries[idx].meaning=r;sugBox.innerHTML='';meaningInput.focus();
      });
      sugBox.appendChild(btn);
    });
  },200);
}


// Hide suggestions when clicking outside
document.addEventListener('click',e=>{
  if(!e.target.closest('.card-entry')){
    document.querySelectorAll('.card-suggestions').forEach(s=>s.innerHTML='');
  }
});

function initCardEditor(isEdit=false){
  if(!isEdit){
    cardEntries=[{word:'',meaning:''},{word:'',meaning:''}];
    document.getElementById('vocab-set-title').value='';
    editingSetId=null;
  }
  // Update header text
  const titleEl=document.querySelector('#page-create-vocab .page-title');
  if(titleEl)titleEl.textContent=isEdit?'단어장 수정':'단어장 만들기';
  renderCardEditor();
}

document.getElementById('add-card-btn').addEventListener('click',()=>{
  cardEntries.push({word:'',meaning:''});renderCardEditor();
  const entries=cardsEditor.querySelectorAll('.card-entry'),last=entries[entries.length-1];
  last.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>last.querySelector('.card-word-input').focus(),350);
});

function goToCreateVocab(){editingSetId=null;initCardEditor(false);showPage('create-vocab')}
document.getElementById('create-vocab-btn').addEventListener('click',goToCreateVocab);
document.getElementById('fab-create-vocab').addEventListener('click',goToCreateVocab);
document.getElementById('back-from-create').addEventListener('click',()=>{
  if(editingSetId&&currentSetForQuiz)openVocabDetail(currentSetForQuiz);
  else showPage('home');
});

document.getElementById('save-vocab-btn').addEventListener('click',()=>{
  const title=document.getElementById('vocab-set-title').value.trim();
  if(!title){showToast('단어장 이름을 입력하세요.');document.getElementById('vocab-set-title').focus();return}
  const valid=cardEntries.filter(c=>c.word.trim()&&c.meaning.trim());
  if(!valid.length){showToast('최소 1개 이상의 카드를 작성하세요.');return}
  const uid=getCurrentUser(),sets=getVocabSets(uid);

  if(editingSetId){
    // Update existing
    const idx=sets.findIndex(s=>s.id===editingSetId);
    if(idx!==-1){
      sets[idx].title=title;sets[idx].cards=valid;
      saveVocabSets(uid,sets);showToast('단어장이 수정되었습니다!');
      currentSetForQuiz=sets[idx];openVocabDetail(sets[idx]);
    }
  }else{
    // Create new
    const ns={id:Date.now().toString(36)+Math.random().toString(36).substr(2,4),title,cards:valid,createdAt:new Date().toISOString()};
    sets.push(ns);saveVocabSets(uid,sets);showToast(`"${title}" 단어장이 저장되었습니다!`);
    currentSetForQuiz=ns;openVocabDetail(ns);
  }
  editingSetId=null;
});

// ── Vocab List with options ──
let activeDropdown=null;
document.addEventListener('click',e=>{
  if(activeDropdown&&!e.target.closest('.dots-menu-btn')&&!e.target.closest('.dots-dropdown')){
    activeDropdown.classList.remove('open');
    const parentCard = activeDropdown.closest('.vocab-set-card');
    if (parentCard) parentCard.classList.remove('has-dropdown');
    activeDropdown=null;
  }
});

function renderVocabList(){
  const uid=getCurrentUser(),sets=getVocabSets(uid);
  const vl=document.getElementById('vocab-list'),ev=document.getElementById('empty-vocab');
  vl.innerHTML='';
  if(!sets.length){ev.style.display='';return}
  ev.style.display='none';
  sets.forEach((set,idx)=>{
    const card=document.createElement('div');card.className='vocab-set-card';
    card.innerHTML=`<h3>${escapeHtml(set.title)}</h3><span class="vocab-count">${set.cards.length}개의 단어</span>
      <button class="dots-menu-btn" data-idx="${idx}" aria-label="옵션"><span class="dot"></span><span class="dot"></span><span class="dot"></span></button>
      <div class="dots-dropdown" id="dropdown-${idx}">
        <button class="rename-btn" data-idx="${idx}">이름 수정</button>
        <button class="edit-words-btn" data-idx="${idx}">단어 수정하기</button>
        <button class="delete-btn danger" data-idx="${idx}">삭제하기</button>
      </div>`;
    card.addEventListener('click',e=>{if(e.target.closest('.dots-menu-btn')||e.target.closest('.dots-dropdown'))return;openVocabDetail(set)});
    card.querySelector('.dots-menu-btn').addEventListener('click',e=>{
      e.stopPropagation();const dd=card.querySelector('.dots-dropdown');
      if(activeDropdown&&activeDropdown!==dd){
        activeDropdown.classList.remove('open');
        const parentCard = activeDropdown.closest('.vocab-set-card');
        if (parentCard) parentCard.classList.remove('has-dropdown');
      }
      dd.classList.toggle('open');
      card.classList.toggle('has-dropdown', dd.classList.contains('open'));
      activeDropdown=dd.classList.contains('open')?dd:null;
    });
    // Rename
    card.querySelector('.rename-btn').addEventListener('click',e=>{
      e.stopPropagation();
      if(activeDropdown){
        activeDropdown.classList.remove('open');
        const parentCard = activeDropdown.closest('.vocab-set-card');
        if (parentCard) parentCard.classList.remove('has-dropdown');
        activeDropdown=null;
      }
      openModal(`<h3 class="modal-title">이름 수정</h3><input type="text" class="modal-input" id="rename-input" value="${escapeHtml(set.title)}" maxlength="50"><div class="modal-actions"><button class="modal-btn-cancel" id="modal-cancel">취소</button><button class="modal-btn-primary" id="modal-confirm">변경</button></div>`);
      const ri=document.getElementById('rename-input');ri.focus();ri.select();
      document.getElementById('modal-cancel').addEventListener('click',closeModal);
      document.getElementById('modal-confirm').addEventListener('click',()=>{
        const nv=ri.value.trim();if(!nv){showToast('이름을 입력하세요.');return}
        const s2=getVocabSets(uid);s2[idx].title=nv;saveVocabSets(uid,s2);closeModal();renderVocabList();showToast('이름이 변경되었습니다.');
      });
    });
    // Edit words
    card.querySelector('.edit-words-btn').addEventListener('click',e=>{
      e.stopPropagation();
      if(activeDropdown){
        activeDropdown.classList.remove('open');
        const parentCard = activeDropdown.closest('.vocab-set-card');
        if (parentCard) parentCard.classList.remove('has-dropdown');
        activeDropdown=null;
      }
      editingSetId=set.id;
      cardEntries=set.cards.map(c=>({word:c.word,meaning:c.meaning}));
      document.getElementById('vocab-set-title').value=set.title;
      currentSetForQuiz=set;
      initCardEditor(true);
      showPage('create-vocab');
    });
    // Delete
    card.querySelector('.delete-btn').addEventListener('click',e=>{
      e.stopPropagation();
      if(activeDropdown){
        activeDropdown.classList.remove('open');
        const parentCard = activeDropdown.closest('.vocab-set-card');
        if (parentCard) parentCard.classList.remove('has-dropdown');
        activeDropdown=null;
      }
      openModal(`<h3 class="modal-title">정말 삭제하시겠습니까?</h3><p class="modal-desc">한 번 삭제할 시 복구 할 수 없습니다.</p><div class="modal-actions"><button class="modal-btn-cancel" id="modal-cancel">아니오</button><button class="modal-btn-danger" id="modal-confirm">예</button></div>`);
      document.getElementById('modal-cancel').addEventListener('click',closeModal);
      document.getElementById('modal-confirm').addEventListener('click',()=>{
        const s2=getVocabSets(uid);s2.splice(idx,1);saveVocabSets(uid,s2);closeModal();renderVocabList();showToast('단어장이 삭제되었습니다.');
      });
    });
    vl.appendChild(card);
  });
}

// ── Vocab Detail / Carousel ──
const posMap = {
  'noun': '명사',
  'verb': '동사',
  'adjective': '형용사',
  'adverb': '부사',
  'pronoun': '대명사',
  'preposition': '전치사',
  'conjunction': '접속사',
  'interjection': '감탄사',
  'plural': '명사(복수)'
};

const localThesaurus = {
  'happy': {
    syn: ['glad', 'cheerful', 'content', 'delighted', 'joyful'],
    ant: ['sad', 'gloomy', 'miserable', 'unhappy', 'depressed']
  },
  'sad': {
    syn: ['unhappy', 'gloomy', 'sorrowful', 'depressed', 'down'],
    ant: ['happy', 'glad', 'cheerful', 'joyful', 'content']
  },
  'big': {
    syn: ['large', 'huge', 'giant', 'massive', 'enormous'],
    ant: ['small', 'little', 'tiny', 'miniature']
  },
  'small': {
    syn: ['little', 'tiny', 'petite', 'miniature'],
    ant: ['big', 'large', 'huge', 'giant']
  },
  'good': {
    syn: ['excellent', 'fine', 'wonderful', 'pleasant', 'great'],
    ant: ['bad', 'poor', 'terrible', 'awful', 'evil']
  },
  'bad': {
    syn: ['poor', 'terrible', 'awful', 'evil', 'nasty'],
    ant: ['good', 'excellent', 'fine', 'pleasant', 'great']
  },
  'challenge': {
    syn: ['test', 'problem', 'dare', 'trial', 'obstacle'],
    ant: ['ease', 'security', 'facility', 'peace']
  },
  'easy': {
    syn: ['simple', 'effortless', 'painless', 'smooth'],
    ant: ['hard', 'difficult', 'tough', 'demanding']
  },
  'hard': {
    syn: ['difficult', 'tough', 'solid', 'firm', 'harsh'],
    ant: ['easy', 'simple', 'soft', 'gentle']
  },
  'fast': {
    syn: ['quick', 'rapid', 'swift', 'speedy', 'brisk'],
    ant: ['slow', 'sluggish', 'leisurely', 'delayed']
  },
  'slow': {
    syn: ['sluggish', 'leisurely', 'delayed', 'gradual'],
    ant: ['fast', 'quick', 'rapid', 'swift', 'speedy']
  }
};

function checkKoreanFuzzyMatch(userAnswer, correctMeaning) {
  // 1. Exact match
  const cleanUser = userAnswer.replace(/\s+/g, '').toLowerCase();
  const cleanCorrect = correctMeaning.replace(/\s+/g, '').toLowerCase();
  if (cleanUser === cleanCorrect) {
    return { isCorrect: true, isFuzzy: false };
  }
  
  // 2. Remove parentheses content (e.g. "사과(과일)" -> "사과")
  const removeParens = (str) => str.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  const noParensUser = removeParens(cleanUser);
  const noParensCorrect = removeParens(cleanCorrect);
  if (noParensUser && noParensCorrect && noParensUser === noParensCorrect) {
    return { isCorrect: true, isFuzzy: true };
  }

  // 3. Split by separators
  const separators = /[,;/|~.\s+]+/;
  const correctParts = removeParens(correctMeaning)
    .split(separators)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
  
  const userParts = removeParens(userAnswer)
    .split(separators)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
    
  // Check if any user part matches any correct part
  let matched = false;
  for (const uPart of userParts) {
    for (const cPart of correctParts) {
      if (uPart === cPart) {
        matched = true;
        break;
      }
      if (cPart.length >= 2 && uPart.length >= 2 && (cPart.includes(uPart) || uPart.includes(cPart))) {
        matched = true;
        break;
      }
    }
    if (matched) break;
  }
  
  if (matched) {
    return { isCorrect: true, isFuzzy: true };
  }
  
  return { isCorrect: false, isFuzzy: false };
}

function checkEnglishFuzzyMatch(userAnswer, correctWord) {
  const cleanUser = userAnswer.trim().toLowerCase();
  const cleanCorrect = correctWord.trim().toLowerCase();
  if (cleanUser === cleanCorrect) {
    return { isCorrect: true, isFuzzy: false };
  }
  
  const separators = /[,;/|.\s+]+/;
  const correctParts = correctWord.split(separators).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
  const userParts = userAnswer.split(separators).map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
  
  for (const uPart of userParts) {
    if (correctParts.includes(uPart)) {
      return { isCorrect: true, isFuzzy: true };
    }
  }
  return { isCorrect: false, isFuzzy: false };
}

function generateDifficultyBasedExamples(word, meaning, pos, age) {
  const cleanPos = (pos || 'noun').toLowerCase();
  
  if (age <= 13) { // Elementary
    if (cleanPos.includes('verb') || cleanPos.includes('동사')) {
      return [
        `I want to ${word} with you today.`,
        `She can ${word} very well.`
      ];
    } else if (cleanPos.includes('adj') || cleanPos.includes('형용사')) {
      return [
        `Look at that ${word} dog!`,
        `This is a ${word} story.`
      ];
    } else { // Noun
      return [
        `I like this ${word} so much.`,
        `There is a ${word} on the desk.`
      ];
    }
  } else if (age <= 16) { // Middle School
    if (cleanPos.includes('verb') || cleanPos.includes('동사')) {
      return [
        `We should ${word} our skills to improve.`,
        `He decided to ${word} the invitation.`
      ];
    } else if (cleanPos.includes('adj') || cleanPos.includes('형용사')) {
      return [
        `It is important to stay ${word} during challenges.`,
        `The teacher gave a ${word} explanation of the topic.`
      ];
    } else { // Noun
      return [
        `The student solved the problem with this ${word}.`,
        `She has a strong interest in this ${word}.`
      ];
    }
  } else if (age <= 19) { // High School
    if (cleanPos.includes('verb') || cleanPos.includes('동사')) {
      return [
        `The company plans to ${word} new strategies next year.`,
        `How do you intend to ${word} this difficult problem?`
      ];
    } else if (cleanPos.includes('adj') || cleanPos.includes('형용사')) {
      return [
        `The research provides a ${word} perspective on history.`,
        `His behavior had a ${word} influence on the team.`
      ];
    } else { // Noun
      return [
        `They are discussing the political impact of the ${word}.`,
        `The experiment confirmed the existence of the ${word}.`
      ];
    }
  } else { // Adult
    if (cleanPos.includes('verb') || cleanPos.includes('동사')) {
      return [
        `The local government must ${word} measures to curb inflation.`,
        `Such actions may severely ${word} the bilateral relationship.`
      ];
    } else if (cleanPos.includes('adj') || cleanPos.includes('형용사')) {
      return [
        `The committee reached a ${word} agreement after long debates.`,
        `Her explanation was highly ${word} and persuasive.`
      ];
    } else { // Noun
      return [
        `The main objective is to analyze the structural integrity of the ${word}.`,
        `The concept of ${word} remains a central topic in modern philosophy.`
      ];
    }
  }
}

function createExampleElement(ex, word, meaning) {
  const item = document.createElement('div');
  item.className = 'wd-example-item';
  item.style.cursor = 'pointer';
  
  let formattedEng = ex.trim();
  formattedEng = formattedEng.charAt(0).toUpperCase() + formattedEng.slice(1);
  const boldEng = boldWordInEnglish(formattedEng, word);
  item.innerHTML = boldEng;
  
  let isTranslated = false;
  let translatedText = '';
  
  item.addEventListener('click', async () => {
    if (isTranslated) {
      item.innerHTML = boldEng;
      isTranslated = false;
    } else {
      if (!translatedText) {
        item.style.opacity = '0.5';
        try {
          const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(ex)}&langpair=en|ko`);
          const data = await res.json();
          if (data && data.responseData && data.responseData.translatedText) {
            translatedText = data.responseData.translatedText.trim();
          }
        } catch (err) {}
        item.style.opacity = '1';
      }
      
      if (translatedText) {
        const boldKor = boldWordInKorean(translatedText, meaning);
        item.innerHTML = boldKor;
        isTranslated = true;
      } else {
        showToast('번역을 가져오지 못했습니다.');
      }
    }
  });
  
  return item;
}

async function loadCardDetails(card, cardEl) {
  const word = card.word.trim();
  const meaning = card.meaning.trim();
  const posBadge = cardEl.querySelector('.wd-pos');
  const examplesDiv = cardEl.querySelector('.wd-examples');
  
  const synRow = cardEl.querySelector('.wd-synonyms-row');
  const synList = cardEl.querySelector('.wd-synonyms-list');
  const antRow = cardEl.querySelector('.wd-antonyms-row');
  const antList = cardEl.querySelector('.wd-antonyms-list');
  
  const uid = getCurrentUser();
  const age = parseInt(localStorage.getItem(`vocabmaster_setting_age_${uid}`)) || 15;
  
  // Setup age difficulty boundaries
  let maxWordLen = 100;
  let maxCount = 5;
  if (age <= 13) {
    maxWordLen = 6;
    maxCount = 3;
  } else if (age <= 16) {
    maxWordLen = 8;
    maxCount = 4;
  } else if (age <= 19) {
    maxWordLen = 10;
    maxCount = 5;
  }
  
  const filterList = (list) => {
    return list
      .filter(w => w.length <= maxWordLen && !w.includes(' ') && w.toLowerCase() !== word.toLowerCase())
      .slice(0, maxCount);
  };
  
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    let apiPos = '';
    let apiExamples = [];
    let apiSyns = [];
    let apiAnts = [];
    
    if (data && data[0] && data[0].meanings) {
      data[0].meanings.forEach(m => {
        if (!apiPos) {
          apiPos = posMap[m.partOfSpeech.toLowerCase()] || m.partOfSpeech;
        }
        if (m.synonyms) apiSyns.push(...m.synonyms);
        if (m.antonyms) apiAnts.push(...m.antonyms);
        
        if (m.definitions) {
          m.definitions.forEach(d => {
            if (d.example) apiExamples.push(d.example);
            if (d.synonyms) apiSyns.push(...d.synonyms);
            if (d.antonyms) apiAnts.push(...d.antonyms);
          });
        }
      });
    }
    
    // Deduplicate
    apiSyns = [...new Set(apiSyns)];
    apiAnts = [...new Set(apiAnts)];
    
    // Local Thesaurus Fallback
    const thes = localThesaurus[word.toLowerCase()];
    if (apiSyns.length === 0 && thes && thes.syn) apiSyns = thes.syn;
    if (apiAnts.length === 0 && thes && thes.ant) apiAnts = thes.ant;
    
    const finalSyns = filterList(apiSyns);
    const finalAnts = filterList(apiAnts);
    
    if (finalSyns.length > 0) {
      synList.textContent = finalSyns.join(', ');
      synRow.style.display = 'block';
    } else {
      synRow.style.display = 'none';
    }
    
    if (finalAnts.length > 0) {
      antList.textContent = finalAnts.join(', ');
      antRow.style.display = 'block';
    } else {
      antRow.style.display = 'none';
    }
    
    posBadge.textContent = apiPos || '단어';
    
    // Filter examples by age difficulty
    let apiFilteredExamples = [];
    if (age <= 13) {
      apiFilteredExamples = apiExamples.filter(ex => ex.length < 45);
    } else if (age <= 16) {
      apiFilteredExamples = apiExamples.filter(ex => ex.length >= 30 && ex.length <= 70);
    } else if (age <= 19) {
      apiFilteredExamples = apiExamples.filter(ex => ex.length >= 45 && ex.length <= 110);
    } else {
      apiFilteredExamples = apiExamples;
    }
    
    if (apiFilteredExamples.length === 0) {
      apiFilteredExamples = apiExamples;
    }
    
    examplesDiv.innerHTML = '';
    const finalExamples = apiFilteredExamples.slice(0, 3);
    if (finalExamples.length > 0) {
      finalExamples.forEach(ex => {
        examplesDiv.appendChild(createExampleElement(ex, word, meaning));
      });
    } else {
      const fallback = generateDifficultyBasedExamples(word, meaning, apiPos, age);
      fallback.forEach(ex => {
        examplesDiv.appendChild(createExampleElement(ex, word, meaning));
      });
    }
  } catch (e) {
    posBadge.textContent = '단어';
    
    // Fallback thesaurus
    let fallbackSyns = [];
    let fallbackAnts = [];
    const thes = localThesaurus[word.toLowerCase()];
    if (thes) {
      fallbackSyns = thes.syn || [];
      fallbackAnts = thes.ant || [];
    }
    
    const finalSyns = filterList(fallbackSyns);
    const finalAnts = filterList(fallbackAnts);
    
    if (finalSyns.length > 0) {
      synList.textContent = finalSyns.join(', ');
      synRow.style.display = 'block';
    } else {
      synRow.style.display = 'none';
    }
    
    if (finalAnts.length > 0) {
      antList.textContent = finalAnts.join(', ');
      antRow.style.display = 'block';
    } else {
      antRow.style.display = 'none';
    }
    
    examplesDiv.innerHTML = '';
    const fallback = generateDifficultyBasedExamples(word, meaning, '단어', age);
    fallback.forEach(ex => {
      examplesDiv.appendChild(createExampleElement(ex, word, meaning));
    });
  }
}

function renderWordDetailList(cards) {
  const container = document.getElementById('word-detail-list');
  container.innerHTML = '';
  
  cards.forEach((card) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'word-detail-card';
    cardEl.innerHTML = `
      <div class="wd-header">
        <div class="wd-word-group">
          <span class="wd-word">${escapeHtml(card.word)}</span>
          <span class="wd-pos">로딩 중...</span>
        </div>
        <div class="wd-action-group">
          <button class="wd-icon-btn speaker-btn-wd" aria-label="발음 듣기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
          <a href="https://en.dict.naver.com/#/search?query=${encodeURIComponent(card.word)}" target="_blank" class="wd-icon-btn naver-btn-wd" aria-label="네이버 사전 바로가기">N</a>
        </div>
      </div>
      <div class="wd-meaning">${escapeHtml(card.meaning)}</div>
      
      <!-- Synonyms & Antonyms -->
      <div class="wd-relations" style="margin-top: 10px; font-size: 0.88rem; display: flex; flex-direction: column; gap: 6px;">
        <div class="wd-synonyms-row" style="display: none;">
          <span style="font-weight: 700; color: var(--success); margin-right: 8px;">유의어:</span>
          <span class="wd-synonyms-list" style="color: var(--text-primary);"></span>
        </div>
        <div class="wd-antonyms-row" style="display: none;">
          <span style="font-weight: 700; color: var(--error); margin-right: 8px;">반의어:</span>
          <span class="wd-antonyms-list" style="color: var(--text-primary);"></span>
        </div>
      </div>

      <div class="wd-examples" style="margin-top: 14px;">
        <div class="wd-example-item" style="opacity: 0.5;">예문을 불러오는 중...</div>
      </div>
    `;
    
    cardEl.querySelector('.speaker-btn-wd').addEventListener('click', () => {
      speakCard(card, true);
    });
    
    container.appendChild(cardEl);
    loadCardDetails(card, cardEl);
  });
}

let carouselIndex=0,carouselCards=[],meaningVisible=[],currentSetForQuiz=null;
function openVocabDetail(set){
  currentSetForQuiz=set;
  document.getElementById('detail-title').textContent=set.title;
  carouselCards=set.cards;carouselIndex=0;meaningVisible=carouselCards.map(()=>false);
  renderCarousel();
  renderWordDetailList(set.cards);
  showPage('vocab-detail');
}
function renderCarousel(){
  const track=document.getElementById('carousel-track');track.innerHTML='';
  carouselCards.forEach((c,i)=>{
    const el=document.createElement('div');el.className='carousel-card';
    el.innerHTML=`
      <button class="speaker-btn" data-idx="${i}" aria-label="발음 듣기">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      </button>
      <div class="card-word">${escapeHtml(c.word)}</div>
      <div class="card-meaning ${meaningVisible[i]?'':'hidden'}">${escapeHtml(c.meaning)}</div>
      <div class="card-tap-hint">탭하여 뜻 ${meaningVisible[i]?'숨기기':'보기'}</div>`;
    // Speaker click
    el.querySelector('.speaker-btn').addEventListener('click',e=>{e.stopPropagation();speakCard(c, meaningVisible[i])});
    // Card body click → toggle meaning
    el.addEventListener('click',e=>{if(e.target.closest('.speaker-btn'))return;meaningVisible[i]=!meaningVisible[i];renderCarousel();updateCarouselPos()});
    track.appendChild(el);
  });
  updateCarouselPos();updateCarouselInd();
}
function updateCarouselPos(){document.getElementById('carousel-track').style.transform=`translateX(-${carouselIndex*100}%)`}
function updateCarouselInd(){
  document.getElementById('carousel-indicator').textContent=`${carouselIndex+1} / ${carouselCards.length}`;
  document.getElementById('carousel-prev').disabled=carouselIndex===0;
  document.getElementById('carousel-next').disabled=carouselIndex===carouselCards.length-1;
}
document.getElementById('carousel-prev').addEventListener('click',()=>{if(carouselIndex>0){carouselIndex--;updateCarouselPos();updateCarouselInd()}});
document.getElementById('carousel-next').addEventListener('click',()=>{if(carouselIndex<carouselCards.length-1){carouselIndex++;updateCarouselPos();updateCarouselInd()}});
document.getElementById('back-from-detail').addEventListener('click',()=>{renderVocabList();showPage('vocab')});
document.getElementById('action-flashcard').addEventListener('click',()=>showToast('단어 카드 기능은 준비 중입니다.'));

// ============================================
// LEARNING & TEST MODE
// ============================================
let quizType='learn';
let quizMode='en-to-kr';
let quizCards=[];
let quizIndex=0;
let quizAutoTimer=null;
let testResults=[];
let hintEnabled=false;

const dummyKr=['물건','행동','상태','결과','방법','과정','기능','종류','부분','의미','내용','형태','구조','가치','원인'];
const dummyEn=['gather','resolve','obtain','pursue','embrace','derive','conduct','enhance','sustain','clarify','emerge','restore','combine','allocate','devote'];

function shuffleArray(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

function generateOptions(correctAnswer,allCards,field,count=5){
  const others=allCards.filter(c=>c[field]!==correctAnswer).map(c=>c[field]);
  let pool=shuffleArray(others).slice(0,count-1);
  const dummies=field==='meaning'?dummyKr:dummyEn;
  let di=0;
  while(pool.length<count-1){
    const c=dummies[di%dummies.length];
    if(c!==correctAnswer&&!pool.includes(c))pool.push(c);
    di++;if(di>30)break;
  }
  pool.push(correctAnswer);
  return shuffleArray(pool);
}

// ── Mode Select ──
document.getElementById('action-learn').addEventListener('click',()=>{
  quizType='learn';
  document.getElementById('mode-select-title').textContent='학습 모드 선택';
  document.getElementById('hint-toggle-wrap').style.display='none';
  showPage('mode-select');
});
document.getElementById('action-test').addEventListener('click',()=>{
  quizType='test';
  document.getElementById('mode-select-title').textContent='테스트 모드 선택';
  document.getElementById('hint-toggle-wrap').style.display='';
  document.getElementById('hint-toggle').checked=false;
  showPage('mode-select');
});
document.getElementById('action-view-results').addEventListener('click',()=>{
  const uid=getCurrentUser();
  if(!uid||!currentSetForQuiz)return;
  const key=`vocabmaster_test_history_${uid}_${currentSetForQuiz.id}`;
  const historyData=localStorage.getItem(key);
  const history=historyData?JSON.parse(historyData):[];
  if(!history.length){
    showToast('아직 이 단어장에 대한 테스트 기록이 없습니다.');
    return;
  }
  
  let listHtml = '';
  history.forEach((test, idx) => {
    listHtml += `
      <div class="history-item" data-idx="${idx}" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: var(--bg-secondary); border: 1.5px solid var(--border-color); border-radius: 12px; cursor: pointer; transition: all 0.2s; margin-bottom: 8px;">
        <div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">
          <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">${test.date}</span>
          <span style="font-size: 0.8rem; color: var(--text-secondary);">총 ${test.total}문제</span>
        </div>
        <div style="font-weight: 800; font-size: 1.1rem; color: var(--success);">
          ${test.score} / ${test.total}
        </div>
      </div>
    `;
  });
  
  openModal(`
    <h3 class="modal-title" style="margin-bottom: 8px;">이전 테스트 기록</h3>
    <p class="modal-desc" style="margin-bottom: 20px; font-size: 0.85rem; color: var(--text-secondary);">테스트 결과를 선택하면 당시 결과창으로 이동하여 복습할 수 있습니다.</p>
    <div style="max-height: 260px; overflow-y: auto; padding-right: 4px;" id="history-list-container">
      ${listHtml}
    </div>
    <div class="modal-actions" style="margin-top: 20px;">
      <button class="modal-btn-cancel" id="modal-history-close" style="width: 100%;">닫기</button>
    </div>
  `);
  
  document.getElementById('modal-history-close').addEventListener('click', closeModal);
  
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.idx);
      const selectedTest = history[idx];
      closeModal();
      testResults = selectedTest.results;
      quizType = 'test';
      showTestResults();
    });
  });
});
document.getElementById('back-from-mode').addEventListener('click',()=>{
  if(currentSetForQuiz)openVocabDetail(currentSetForQuiz);else showPage('home');
});

document.querySelectorAll('.mode-card').forEach(btn=>{
  btn.addEventListener('click',()=>{
    quizMode=btn.dataset.mode;
    hintEnabled=document.getElementById('hint-toggle').checked;
    startQuiz();
  });
});

function startQuiz(){
  quizCards=shuffleArray(currentSetForQuiz.cards).map(c=>{
    let dir;
    if(quizMode==='en-to-kr')dir='en-to-kr';
    else if(quizMode==='kr-to-en')dir='kr-to-en';
    else dir=Math.random()<.5?'en-to-kr':'kr-to-en';
    return{...c,direction:dir};
  });
  quizIndex=0;testResults=[];
  if(quizType==='learn')showLearnQuestion();
  else showTestQuestion();
}

// ============================================
// LEARN MODE (객관식, 즉시 피드백)
// ============================================
const praiseMessages=['정답입니다!','잘했어요!','훌륭하네요!','대단해요!','완벽해요!'];

function showLearnQuestion(){
  if(quizIndex>=quizCards.length){showToast('학습 완료! 수고하셨습니다 🎉');openVocabDetail(currentSetForQuiz);return}
  showPage('learn-quiz');
  const card=quizCards[quizIndex];
  const isEnToKr=card.direction==='en-to-kr';
  document.getElementById('learn-label').textContent=isEnToKr?'다음 영단어의 뜻은?':'다음 뜻에 해당하는 영단어는?';
  document.getElementById('learn-question').textContent=isEnToKr?card.word:card.meaning;
  document.getElementById('learn-correct-overlay').classList.remove('show');
  clearTimeout(quizAutoTimer);

  const correctAnswer=isEnToKr?card.meaning:card.word;
  const optionField=isEnToKr?'meaning':'word';
  const pct=(quizIndex/quizCards.length*100).toFixed(0);
  document.getElementById('learn-progress-fill').style.width=pct+'%';
  document.getElementById('learn-progress-text').textContent=`${quizIndex+1} / ${quizCards.length}`;

  const optContainer=document.getElementById('learn-options');optContainer.innerHTML='';
  const opts=generateOptions(correctAnswer,currentSetForQuiz.cards,optionField);
  opts.forEach(opt=>{
    const btn=document.createElement('button');btn.className='quiz-option';btn.textContent=opt;
    btn.addEventListener('click',()=>handleLearnAnswer(btn,opt,correctAnswer,optContainer));
    optContainer.appendChild(btn);
  });
}

function handleLearnAnswer(btn,selected,correct,container){
  container.querySelectorAll('.quiz-option').forEach(b=>{b.disabled=true;b.style.pointerEvents='none'});
  const correctIcon = document.getElementById('learn-correct-icon');
  const wrongIcon = document.getElementById('learn-wrong-icon');
  const msgEl = document.getElementById('learn-correct-msg');
  const overlay = document.getElementById('learn-correct-overlay');

  if(selected===correct){
    btn.classList.add('correct');
    playCorrectSound();
    if (correctIcon) correctIcon.style.display = 'block';
    if (wrongIcon) wrongIcon.style.display = 'none';
    if (msgEl) {
      msgEl.textContent = praiseMessages[Math.floor(Math.random() * praiseMessages.length)];
      msgEl.style.color = 'var(--success)';
    }
    overlay.classList.add('show');
    quizAutoTimer=setTimeout(advanceLearn,3000);
  }else{
    btn.classList.add('wrong');
    playWrongSound();
    container.querySelectorAll('.quiz-option').forEach(b=>{if(b.textContent===correct)b.classList.add('correct')});
    setTimeout(()=>{
      if (correctIcon) correctIcon.style.display = 'none';
      if (wrongIcon) wrongIcon.style.display = 'block';
      if (msgEl) {
        msgEl.textContent = '아쉬워요! 다시 도전해보세요';
        msgEl.style.color = 'var(--error)';
      }
      overlay.classList.add('show');
      quizAutoTimer=setTimeout(advanceLearn,3000);
    },800);
  }
}

function advanceLearn(){clearTimeout(quizAutoTimer);quizIndex++;showLearnQuestion()}
document.getElementById('learn-next-btn').addEventListener('click',advanceLearn);

// ============================================
// TEST MODE (주관식, 결과는 마지막에만)
// ============================================
function saveTestToHistory() {
  const uid = getCurrentUser();
  if (!uid || !currentSetForQuiz) return;
  const setId = currentSetForQuiz.id;
  
  const score = testResults.filter(r => r.correct).length;
  const total = testResults.length;
  
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  
  const key = `vocabmaster_test_history_${uid}_${setId}`;
  const historyData = localStorage.getItem(key);
  const history = historyData ? JSON.parse(historyData) : [];
  
  history.unshift({
    id: 'test_' + Date.now(),
    date: dateStr,
    score: score,
    total: total,
    results: testResults
  });
  
  if (history.length > 20) {
    history.pop();
  }
  
  localStorage.setItem(key, JSON.stringify(history));
}

function showTestQuestion(){
  if(quizIndex>=quizCards.length){
    saveTestToHistory();
    showTestResults();
    return;
  }
  showPage('test-quiz');
  const card=quizCards[quizIndex];
  const isEnToKr=card.direction==='en-to-kr';
  document.getElementById('test-label').textContent=isEnToKr?'다음 영단어의 뜻을 입력하세요':'다음 뜻에 해당하는 영단어를 입력하세요';
  document.getElementById('test-question').textContent=isEnToKr?card.word:card.meaning;

  const pct=(quizIndex/quizCards.length*100).toFixed(0);
  document.getElementById('test-progress-fill').style.width=pct+'%';
  document.getElementById('test-progress-text').textContent=`${quizIndex+1} / ${quizCards.length}`;

  const input=document.getElementById('test-answer-input');
  const hintChar=document.getElementById('test-hint-char');
  const feedback=document.getElementById('test-feedback');
  const correctAnswer=isEnToKr?card.meaning:card.word;

  input.value='';input.disabled=false;
  feedback.textContent='';feedback.className='test-feedback';
  document.getElementById('test-submit-btn').textContent='확인';
  document.getElementById('test-submit-btn').disabled=false;
  input.placeholder='정답을 입력하세요';

  // Hint: only for kr-to-en (guess English word)
  const showHint=hintEnabled&&card.direction==='kr-to-en'&&correctAnswer.length>0;
  if(showHint){
    hintChar.textContent=correctAnswer[0];
    hintChar.classList.add('hidden'); // hidden initially, show on focus
  }else{
    hintChar.textContent='';
    hintChar.classList.add('hidden');
  }

  // Remove old listeners by cloning
  const newInput=input.cloneNode(true);
  input.parentNode.replaceChild(newInput,input);

  newInput.addEventListener('focus',()=>{
    newInput.placeholder='';
    if(showHint&&!newInput.value)hintChar.classList.remove('hidden');
  });
  newInput.addEventListener('blur',()=>{
    if(!newInput.value){
      newInput.placeholder='정답을 입력하세요';
      hintChar.classList.add('hidden');
    }
  });
  newInput.addEventListener('input',()=>{
    if(newInput.value.length>0)hintChar.classList.add('hidden');
    else if(showHint)hintChar.classList.remove('hidden');
  });
  newInput.addEventListener('keydown',e=>{if(e.key==='Enter')handleTestSubmit()});

  newInput.dataset.correct=correctAnswer;
  setTimeout(()=>newInput.focus(),300);
}

document.getElementById('test-submit-btn').addEventListener('click',handleTestSubmit);

function handleTestSubmit(){
  const input=document.getElementById('test-answer-input');
  const userAnswer=input.value.trim();
  const correct=input.dataset.correct;
  if(!userAnswer){showToast('정답을 입력하세요.');input.focus();return}

  const card = quizCards[quizIndex];
  const isEnToKr = card.direction === 'en-to-kr';
  let matchResult;
  if (isEnToKr) {
    matchResult = checkKoreanFuzzyMatch(userAnswer, correct);
  } else {
    matchResult = checkEnglishFuzzyMatch(userAnswer, correct);
  }

  testResults.push({
    card: card,
    userAnswer,
    correct: matchResult.isCorrect,
    isFuzzy: matchResult.isFuzzy,
    correctAnswer: correct
  });

  if(matchResult.isCorrect) {
    recordLearnedWord(card.word);
  }

  // No feedback — immediately go to next
  quizIndex++;
  showTestQuestion();
}

// ── Test Results ──
function showTestResults(){
  showPage('test-result');
  const total=testResults.length;
  const correctCount=testResults.filter(r=>r.correct).length;
  const wrongOnes=testResults.filter(r=>!r.correct);
  const fuzzyOnes=testResults.filter(r=>r.correct && r.isFuzzy);

  document.getElementById('result-score-num').textContent=correctCount;
  document.getElementById('result-score-total').textContent=`/ ${total}`;

  const pct=total?Math.round(correctCount/total*100):0;
  const circle=document.getElementById('result-score-circle');
  if(pct===100)circle.style.borderColor='var(--success)';
  else if(pct>=70)circle.style.borderColor='#f0ad4e';
  else circle.style.borderColor='var(--error)';

  if(pct===100)document.getElementById('result-title').textContent='완벽해요! 🎉';
  else if(pct>=70)document.getElementById('result-title').textContent='수고하셨습니다!';
  else document.getElementById('result-title').textContent='조금 더 노력해볼까요?';

  // 1. Wrong list
  const wrongSection=document.getElementById('result-wrong-section');
  const wrongList=document.getElementById('result-wrong-list');
  wrongList.innerHTML='';

  if(wrongOnes.length>0){
    wrongSection.style.display='';
    wrongOnes.forEach(r=>{
      const isEnToKr=r.card.direction==='en-to-kr';
      const word=isEnToKr?r.card.word:r.card.meaning;
      const answer=r.correctAnswer;
      const item=document.createElement('div');item.className='result-wrong-item';
      item.innerHTML=`<span class="rw-word">${escapeHtml(word)}</span><span class="rw-answer">정답: ${escapeHtml(answer)} <span style="opacity:0.6; font-size:0.85em; margin-left:6px">(입력: ${escapeHtml(r.userAnswer)})</span></span>`;
      wrongList.appendChild(item);
    });
  }else{
    wrongSection.style.display='none';
  }

  // 2. Fuzzy list ("맞혔지만 다시 볼 단어")
  const fuzzySection=document.getElementById('result-fuzzy-section');
  const fuzzyList=document.getElementById('result-fuzzy-list');
  fuzzyList.innerHTML='';

  if(fuzzyOnes.length>0){
    fuzzySection.style.display='';
    fuzzyOnes.forEach(r=>{
      const isEnToKr=r.card.direction==='en-to-kr';
      const word=isEnToKr?r.card.word:r.card.meaning;
      const answer=r.correctAnswer;
      const item=document.createElement('div');item.className='result-fuzzy-item';
      item.innerHTML=`<span class="rw-word">${escapeHtml(word)}</span><span class="rw-answer">정답: ${escapeHtml(answer)} <span style="opacity:0.6; font-size:0.85em; margin-left:6px">(입력: ${escapeHtml(r.userAnswer)})</span></span>`;
      fuzzyList.appendChild(item);
    });
  }else{
    fuzzySection.style.display='none';
  }
}

document.getElementById('result-retry-btn').addEventListener('click',()=>{
  const wrongCards=testResults.filter(r=>!r.correct).map(r=>r.card);
  if(!wrongCards.length)return;
  quizCards=shuffleArray(wrongCards);
  quizIndex=0;testResults=[];
  if(quizType==='test')showTestQuestion();else showLearnQuestion();
});

document.getElementById('result-back-btn').addEventListener('click',()=>{
  if(currentSetForQuiz)openVocabDetail(currentSetForQuiz);else showPage('home');
});

// ── Settings Handler ──
function applySettings() {
  const uid = getCurrentUser();
  if(!uid) return;

  // 1. Theme
  const theme = localStorage.getItem(`vocabmaster_setting_theme_${uid}`) || 'system';
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  if (theme === 'light') document.documentElement.classList.add('theme-light');
  else if (theme === 'dark') document.documentElement.classList.add('theme-dark');

  // Update theme control active button in settings page
  const themeControl = document.getElementById('theme-control');
  if (themeControl) {
    themeControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === theme);
    });
  }

  // 2. Word Size
  const size = localStorage.getItem(`vocabmaster_setting_size_${uid}`) || 'medium';
  let carouselSize = '2rem';
  let listSize = '1.2rem';
  if (size === 'small') {
    carouselSize = '1.6rem';
    listSize = '1.05rem';
  } else if (size === 'large') {
    carouselSize = '2.4rem';
    listSize = '1.35rem';
  }
  document.documentElement.style.setProperty('--word-size-carousel', carouselSize);
  document.documentElement.style.setProperty('--word-size-list', listSize);

  // Update size control active button in settings page
  const sizeControl = document.getElementById('size-control');
  if (sizeControl) {
    sizeControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === size);
    });
  }

  // 3. Font
  const font = localStorage.getItem(`vocabmaster_setting_font_${uid}`) || 'system';
  let fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  if (font === 'noto') fontFamily = "'Noto Sans KR', sans-serif";
  else if (font === 'inter') fontFamily = "'Inter', sans-serif";
  else if (font === 'serif') fontFamily = "Georgia, 'Noto Serif KR', serif";
  else if (font === 'nanum') fontFamily = "'Nanum Gothic', sans-serif";
  document.documentElement.style.setProperty('--font-family-app', fontFamily);

  // Update select value in settings page
  const fontSelect = document.getElementById('font-select');
  if (fontSelect) fontSelect.value = font;

  // 4. Age Setting
  const age = localStorage.getItem(`vocabmaster_setting_age_${uid}`) || '15';
  const ageRange = document.getElementById('age-range');
  const ageVal = document.getElementById('age-val');
  if (ageRange) ageRange.value = age;
  if (ageVal) ageVal.textContent = `${age} 세`;
}

function initSettingsPageListeners() {
  // Theme segmented control
  const themeControl = document.getElementById('theme-control');
  if (themeControl) {
    themeControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = getCurrentUser();
        if(!uid) return;
        localStorage.setItem(`vocabmaster_setting_theme_${uid}`, btn.dataset.value);
        applySettings();
        showToast('테마 설정이 변경되었습니다.');
      });
    });
  }

  // Size segmented control
  const sizeControl = document.getElementById('size-control');
  if (sizeControl) {
    sizeControl.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = getCurrentUser();
        if(!uid) return;
        localStorage.setItem(`vocabmaster_setting_size_${uid}`, btn.dataset.value);
        applySettings();
        showToast('단어 크기 설정이 변경되었습니다.');
      });
    });
  }

  // Font select dropdown
  const fontSelect = document.getElementById('font-select');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      const uid = getCurrentUser();
      if(!uid) return;
      localStorage.setItem(`vocabmaster_setting_font_${uid}`, fontSelect.value);
      applySettings();
      showToast('글꼴 설정이 변경되었습니다.');
    });
  }

  // Age range input change
  const ageRange = document.getElementById('age-range');
  const ageVal = document.getElementById('age-val');
  if (ageRange && ageVal) {
    ageRange.addEventListener('input', () => {
      const uid = getCurrentUser();
      if(!uid) return;
      ageVal.textContent = `${ageRange.value} 세`;
      localStorage.setItem(`vocabmaster_setting_age_${uid}`, ageRange.value);
      
      // Also refresh the word list details view to dynamically update examples/synonyms if the user is currently viewing a wordbook details page
      if (currentSetForQuiz) {
        renderWordDetailList(currentSetForQuiz.cards);
      }
    });
  }
}

function renderMyPage() {
  const cur = getCurrentUser();
  if (!cur) return;
  document.getElementById('mypage-username-display').textContent = cur;
  document.getElementById('mypage-nickname-input').value = getNickname(cur);
  
  const pwForm = document.getElementById('mypage-pw-form');
  if (pwForm) pwForm.reset();
  const pwError = document.getElementById('mypage-pw-error');
  if (pwError) {
    pwError.textContent = '';
    pwError.style.display = 'none';
  }
}

function initMyPageListeners() {
  const saveNickBtn = document.getElementById('mypage-nickname-save-btn');
  if (saveNickBtn) {
    saveNickBtn.addEventListener('click', () => {
      const cur = getCurrentUser();
      if (!cur) return;
      const nick = document.getElementById('mypage-nickname-input').value.trim();
      saveNickname(cur, nick);
      const displayName = nick ? nick : cur;
      document.getElementById('welcome-message').textContent = `환영합니다 ${displayName}님!`;
      showToast("닉네임이 저장되었습니다.");
    });
  }

  const pwForm = document.getElementById('mypage-pw-form');
  if (pwForm) {
    pwForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const cur = getCurrentUser();
      if (!cur) return;
      
      const curPw = document.getElementById('mypage-current-pw').value;
      const newPw = document.getElementById('mypage-new-pw').value;
      const confirmPw = document.getElementById('mypage-confirm-pw').value;
      const pwError = document.getElementById('mypage-pw-error');
      
      if (pwError) {
        pwError.textContent = '';
        pwError.style.display = 'none';
      }
      
      // 1. One month validation
      const lastChanged = localStorage.getItem(`vocabmaster_pw_last_changed_${cur}`);
      if (lastChanged) {
        const diff = Date.now() - parseInt(lastChanged, 10);
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        if (diff < thirtyDays) {
          const nextChangeDate = new Date(parseInt(lastChanged, 10) + thirtyDays);
          const y = nextChangeDate.getFullYear();
          const m = String(nextChangeDate.getMonth() + 1).padStart(2, '0');
          const d = String(nextChangeDate.getDate()).padStart(2, '0');
          if (pwError) {
            pwError.textContent = `비밀번호는 한 달에 한 번만 수정할 수 있습니다. (변경 가능일: ${y}-${m}-${d})`;
            pwError.style.display = 'block';
          }
          return;
        }
      }
      
      // 2. Validate current password
      const users = getUsers();
      if (users[cur] !== curPw) {
        if (pwError) {
          pwError.textContent = "현재 비밀번호가 일치하지 않습니다.";
          pwError.style.display = 'block';
        }
        return;
      }
      
      // 3. Validate confirm password
      if (newPw !== confirmPw) {
        if (pwError) {
          pwError.textContent = "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.";
          pwError.style.display = 'block';
        }
        return;
      }
      
      // 4. Update password
      users[cur] = newPw;
      saveUsers(users);
      localStorage.setItem(`vocabmaster_pw_last_changed_${cur}`, Date.now().toString());
      
      pwForm.reset();
      showToast("비밀번호가 안전하게 수정되었습니다.");
    });
  }
}

// ── Session Restore ──
(function init(){
  initSettingsPageListeners();
  initSyncSettingsListeners();
  initMyPageListeners();

  const cur=getCurrentUser();
  if(cur){
    const u=getUsers();
    if(u[cur]){
      enterMainScreen(cur);
      applySettings();
      return;
    }
    clearCurrentUser();
  }
  showScreen('login-screen');
})();
