/* ========================================
   VocabMaster - App Logic (v4)
   ======================================== */

// ── Storage ──
function getUsers(){const d=localStorage.getItem('vocabmaster_users');return d?JSON.parse(d):{}}
function saveUsers(u){localStorage.setItem('vocabmaster_users',JSON.stringify(u))}
function setCurrentUser(id){sessionStorage.setItem('vocabmaster_current_user',id)}
function getCurrentUser(){return sessionStorage.getItem('vocabmaster_current_user')}
function clearCurrentUser(){sessionStorage.removeItem('vocabmaster_current_user')}
function getVocabSets(uid){const d=localStorage.getItem(`vocabmaster_vocabs_${uid}`);return d?JSON.parse(d):[]}
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
  
  // 먼저 클라우드에 전송 시도
  try {
    const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      body: encrypted,
      headers: {
        'Title': 'VocabMaster Sync',
        'Tags': 'sync'
      }
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
      // ntfy.sh 폴링: 최근 12시간 내 메시지 조회
      const res = await fetch(`${NTFY_BASE_URL}/${topic}/json?poll=1&since=12h`);
      if (!res.ok) throw new Error("not_found");
      const text = await res.text();
      const lines = text.trim().split('\n').filter(l => l.length > 0);
      
      if (lines.length === 0) throw new Error("not_found");
      
      // 가장 최근 메시지 사용
      const lastMsg = JSON.parse(lines[lines.length - 1]);
      const encrypted = lastMsg.message;
      
      if (!encrypted) throw new Error("not_found");
      
      const decrypted = decryptData(encrypted, code);
      if (decrypted && restoreBackupData(decrypted)) {
        closeModal();
        showToast("동기화 완료! 3초 후 앱을 새로고침합니다.");
        setTimeout(() => location.reload(), 3000);
      } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "가져오기";
        showToast("데이터 복구에 실패했습니다. 코드가 맞는지 확인해 주세요.");
      }
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "가져오기";
      if (err.message === "not_found") {
        showToast("존재하지 않거나 만료된 동기화 코드입니다.");
      } else {
        showToast("가져오는 도중 오류가 발생했습니다.");
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

  if (btnSyncExport) btnSyncExport.addEventListener('click', exportToCloudSync);
  if (btnSyncImport) btnSyncImport.addEventListener('click', importFromCloudSync);
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
  document.getElementById('welcome-message').textContent=`환영합니다 ${id}님!`;
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
      showToast('아직 준비 중입니다.');
      return;
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
  if(activeDropdown&&!e.target.closest('.dots-menu-btn')&&!e.target.closest('.dots-dropdown')){activeDropdown.classList.remove('open');activeDropdown=null}
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
      if(activeDropdown&&activeDropdown!==dd){activeDropdown.classList.remove('open')}
      dd.classList.toggle('open');activeDropdown=dd.classList.contains('open')?dd:null;
    });
    // Rename
    card.querySelector('.rename-btn').addEventListener('click',e=>{
      e.stopPropagation();if(activeDropdown){activeDropdown.classList.remove('open');activeDropdown=null}
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
      e.stopPropagation();if(activeDropdown){activeDropdown.classList.remove('open');activeDropdown=null}
      editingSetId=set.id;
      cardEntries=set.cards.map(c=>({word:c.word,meaning:c.meaning}));
      document.getElementById('vocab-set-title').value=set.title;
      currentSetForQuiz=set;
      initCardEditor(true);
      showPage('create-vocab');
    });
    // Delete
    card.querySelector('.delete-btn').addEventListener('click',e=>{
      e.stopPropagation();if(activeDropdown){activeDropdown.classList.remove('open');activeDropdown=null}
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

function generateLocalExamples(word, meaning) {
  return [
    `How do you spell the word "${word}"?`,
    `The teacher explained the meaning of "${word}" in class.`,
    `Please write down "${word}" and its meaning "${meaning}" on your notebook.`
  ];
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
  
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    let apiPos = '';
    let apiExamples = [];
    
    if (data && data[0] && data[0].meanings) {
      const m = data[0].meanings[0];
      if (m) {
        apiPos = posMap[m.partOfSpeech.toLowerCase()] || m.partOfSpeech;
        if (m.definitions) {
          for (const d of m.definitions) {
            if (d.example) {
              apiExamples.push(d.example);
            }
          }
        }
      }
    }
    
    if (apiExamples.length < 2 && data[0] && data[0].meanings) {
      for (let i = 1; i < data[0].meanings.length; i++) {
        const m = data[0].meanings[i];
        if (m && m.definitions) {
          for (const d of m.definitions) {
            if (d.example) {
              apiExamples.push(d.example);
            }
          }
        }
      }
    }

    posBadge.textContent = apiPos || '단어';
    
    examplesDiv.innerHTML = '';
    const finalExamples = apiExamples.slice(0, 3);
    if (finalExamples.length > 0) {
      finalExamples.forEach(ex => {
        examplesDiv.appendChild(createExampleElement(ex, word, meaning));
      });
    } else {
      const fallback = generateLocalExamples(word, meaning);
      fallback.forEach(ex => {
        examplesDiv.appendChild(createExampleElement(ex, word, meaning));
      });
    }
  } catch (e) {
    posBadge.textContent = '단어';
    examplesDiv.innerHTML = '';
    const fallback = generateLocalExamples(word, meaning);
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
      <div class="wd-examples">
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
  if(selected===correct){
    btn.classList.add('correct');
    playCorrectSound();
    const overlay=document.getElementById('learn-correct-overlay');
    document.getElementById('learn-correct-msg').textContent=praiseMessages[Math.floor(Math.random()*praiseMessages.length)];
    overlay.classList.add('show');
    quizAutoTimer=setTimeout(advanceLearn,3000);
  }else{
    btn.classList.add('wrong');
    playWrongSound();
    container.querySelectorAll('.quiz-option').forEach(b=>{if(b.textContent===correct)b.classList.add('correct')});
    setTimeout(()=>{
      const overlay=document.getElementById('learn-correct-overlay');
      document.getElementById('learn-correct-msg').textContent='아쉬워요! 다시 도전해보세요';
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
function showTestQuestion(){
  if(quizIndex>=quizCards.length){showTestResults();return}
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

  const isCorrect=userAnswer.toLowerCase()===correct.toLowerCase();
  testResults.push({card:quizCards[quizIndex],userAnswer,correct:isCorrect,correctAnswer:correct});

  if(isCorrect) {
    recordLearnedWord(quizCards[quizIndex].word);
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
}

// ── Session Restore ──
(function init(){
  initSettingsPageListeners();
  initSyncSettingsListeners();

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
