// app.js (type=module assumed in index.html)
// Menggunakan Firebase modul via CDN (compat modular)
// Pastikan firebaseConfig.js sudah berisi nilai project-mu
import { firebaseConfig } from './firebaseConfig.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  remove,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';

// inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// elemen global
const headerEl = document.getElementById('app-header');
const mainEl = document.getElementById('app-main');
const footerEl = document.getElementById('app-footer');
const toastContainer = document.getElementById('toast-container');

// simple toast controller
export function showToast(title, msg, timeout = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="title">${escapeHtml(title)}</div><div class="msg">${escapeHtml(msg)}</div>`;
  toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(12px)'; setTimeout(()=>el.remove(), 300); }, timeout);
}

// basic XSS escape
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ---------- ROUTER & UI ---------- */
function renderHeader(user){
  headerEl.innerHTML = '';
  if(!user){
    headerEl.innerHTML = `<div class="header-title">PrivChat</div>
      <div class="header-actions"><button class="btn" id="btn-to-login">Masuk / Daftar</button></div>`;
    document.getElementById('btn-to-login').addEventListener('click', ()=> renderLogin());
  } else {
    headerEl.innerHTML = `<div class="header-title">PrivChat</div>
      <div class="header-actions"><div style="margin-right:8px">${escapeHtml(user.displayName || user.email)}</div>
        <button class="btn" id="btn-logout">Keluar</button></div>`;
    document.getElementById('btn-logout').addEventListener('click', ()=> signOut(auth).then(()=> showToast('Keluar', 'Anda berhasil logout')).catch(e=> showToast('Error', e.message)));
  }
}

function renderFooter(){
  footerEl.innerHTML = `
    <div class="btn" id="nav-beranda"><svg class="icon"><use href="#icon-user"></use></svg>Beranda</div>
    <div class="btn" id="nav-cari"><svg class="icon"><use href="#icon-search"></use></svg>Cari</div>
    <div class="btn" id="nav-setelan"><svg class="icon"><use href="#icon-settings"></use></svg>Setelan</div>`;
  document.getElementById('nav-beranda').addEventListener('click', ()=> loadPage('beranda'));
  document.getElementById('nav-cari').addEventListener('click', ()=> loadPage('pencarian'));
  document.getElementById('nav-setelan').addEventListener('click', ()=> loadPage('setelan'));
}

/* load static halaman dari folder 'halaman' */
async function loadPage(name){
  // pastikan user auth untuk halaman tertentu
  const user = auth.currentUser;
  if(!user){
    renderLogin();
    showToast('Perlindungan', 'Anda harus login untuk mengakses aplikasi');
    return;
  }
  try{
    const res = await fetch(`halaman/${name}.html`);
    if(!res.ok) throw new Error('Halaman tidak ditemukan');
    const html = await res.text();
    mainEl.innerHTML = html;
    // run page-specific init
    if(name === 'beranda') initBeranda();
    if(name === 'chat-user') initChatUser();
    if(name === 'chat-grup') initChatGrup();
    if(name === 'pencarian') initPencarian();
    if(name === 'setelan') initSetelan();
  }catch(e){
    mainEl.innerHTML = `<div class="card">Gagal muat: ${escapeHtml(e.message)}</div>`;
  }
}

/* ---------- AUTH UI & PROTEKSI ---------- */
function renderLogin(){
  headerEl.innerHTML = `<div class="header-title">PrivChat — Masuk</div>`;
  footerEl.innerHTML = '';
  mainEl.innerHTML = `
    <div class="login-wrap card">
      <h3>Masuk atau Daftar</h3>
      <div class="form-row"><input id="email" class="input" placeholder="Email" type="email"></div>
      <div class="form-row"><input id="password" class="input" placeholder="Password" type="password"></div>
      <div style="display:flex;gap:8px">
        <button class="btn" id="btn-login">Masuk</button>
        <button class="btn" id="btn-register">Daftar</button>
      </div>
    </div>`;
  document.getElementById('btn-login').addEventListener('click', async ()=>{
    const email = document.getElementById('email').value.trim();
    const pw = document.getElementById('password').value;
    try{
      await signInWithEmailAndPassword(auth, email, pw);
      showToast('Sukses', 'Berhasil login');
    }catch(err){ showToast('Error', err.message); }
  });
  document.getElementById('btn-register').addEventListener('click', async ()=>{
    const email = document.getElementById('email').value.trim();
    const pw = document.getElementById('password').value;
    if(!email || !pw){ showToast('Perhatian', 'Email & password harus diisi'); return; }
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      // buat profil user di Realtime DB (proteksi rules ada di server)
      const uid = cred.user.uid;
      await set(ref(db, `users/${uid}`), {
        email: email,
        displayName: email.split('@')[0],
        avatar: `profil/userdefault.jpeg`,
        online: true,
        createdAt: Date.now()
      });
      showToast('Sukses', 'Akun dibuat & profil disimpan');
    }catch(err){ showToast('Error', err.message); }
  });
}

/* ---------- PAGE INITS ---------- */
function initBeranda(){
  // tampilkan daftar percakapan sederhana (list conversations where member = uid)
  const uid = auth.currentUser.uid;
  // listen conversations
  const convRef = ref(db, 'conversations');
  onValue(convRef, (snap)=>{
    const map = snap.val() || {};
    const list = Object.entries(map).filter(([id, c])=> c.members && c.members[uid]);
    const el = document.getElementById('beranda-list') || document.createElement('div');
    el.id = 'beranda-list';
    el.innerHTML = '';
    if(list.length === 0) el.innerHTML = '<div class="card">Belum ada percakapan. Gunakan Pencarian untuk mulai chat.</div>';
    list.forEach(([id,c])=>{
      const last = c.lastMessage ? escapeHtml(c.lastMessage.text || '') : '';
      const dom = document.createElement('div'); dom.className = 'card';
      dom.innerHTML = `<strong>${escapeHtml(c.title || 'Percakapan')}</strong><p class="muted">${last}</p><div><button class="btn open-chat" data-id="${id}">Buka</button></div>`;
      el.appendChild(dom);
    });
    document.getElementById('beranda-list')?.replaceWith(el);
    el.querySelectorAll('.open-chat').forEach(b=>b.addEventListener('click', (e)=>{
      const id = e.currentTarget.dataset.id;
      // simpan lastSelectedConversation di localStorage lalu load halaman chat-user
      localStorage.setItem('activeConv', id);
      loadPage('chat-user');
    }));
  });
}

function initChatUser(){
  const uid = auth.currentUser.uid;
  const convId = localStorage.getItem('activeConv');
  if(!convId){ mainEl.innerHTML += '<div class="card">Tidak ada percakapan aktif.</div>'; return; }
  const cw = document.getElementById('chat-window');
  const messagesRef = ref(db, `messages/${convId}`);
  // listen messages (full realtime)
  onValue(messagesRef, (snap)=>{
    const data = snap.val() || {};
    cw.innerHTML = '';
    Object.entries(data).forEach(([mid, msg])=>{
      const div = document.createElement('div');
      div.className = 'bubble ' + (msg.sender === uid ? 'me' : 'you');
      div.innerHTML = `${escapeHtml(msg.text)}<div class="meta">${new Date(msg.timestamp||0).toLocaleTimeString()}</div>`;
      cw.appendChild(div);
    });
    cw.scrollTop = cw.scrollHeight;
  });
  const btn = document.getElementById('btnKirim');
  const inp = document.getElementById('txtPesan');
  btn?.addEventListener('click', async ()=>{
    const text = inp.value.trim();
    if(!text) return;
    const msg = { sender: uid, text, timestamp: Date.now() };
    await push(ref(db, `messages/${convId}`), msg);
    // update lastMessage in conversation
    await update(ref(db, `conversations/${convId}`), { lastMessage: { text, timestamp: Date.now() } });
    inp.value = '';
  });
}

function initChatGrup(){
  // similar to initChatUser but for group
  initChatUser(); // for demo reuse
}

function initPencarian(){
  const q = document.getElementById('q');
  const hasil = document.getElementById('hasil');
  q?.addEventListener('input', async (e)=>{
    const v = e.target.value.trim();
    hasil.innerHTML = '';
    if(!v) return;
    // simple search users by displayName startsWith (client-side scan)
    const usersSnap = ref(db, 'users');
    onValue(usersSnap, (snap)=>{
      const users = snap.val() || {};
      const found = Object.entries(users).filter(([uid,u])=> (u.displayName||'').toLowerCase().includes(v.toLowerCase()));
      if(found.length===0) hasil.innerHTML = '<div class="card">Tidak ditemukan</div>';
      else{
        found.forEach(([uid,u])=>{
          const d = document.createElement('div'); d.className='card';
          d.innerHTML = `<strong>${escapeHtml(u.displayName||u.email)}</strong><div><button class="btn start-chat" data-uid="${uid}">Mulai Chat</button></div>`;
          hasil.appendChild(d);
        });
        hasil.querySelectorAll('.start-chat').forEach(b=> b.addEventListener('click', async (ev)=>{
          const otherUid = ev.currentTarget.dataset.uid;
          const myUid = auth.currentUser.uid;
          // buat conversation (cek jika sudah ada)
          const convRef = ref(db, 'conversations');
          // naive: buat conv baru setiap click (untuk production harus cek duplikasi member pair)
          const newConvRef = push(convRef);
          await set(newConvRef, {
            title: `Chat: ${myUid}_${otherUid}`,
            members: { [myUid]: true, [otherUid]: true },
            createdAt: Date.now()
          });
          const convId = newConvRef.key;
          localStorage.setItem('activeConv', convId);
          showToast('Chat dibuat', 'Percakapan baru berhasil dibuat');
          loadPage('chat-user');
        }));
      }
    }, { onlyOnce: true });
  });
}

function initSetelan(){
  const user = auth.currentUser;
  const nama = document.getElementById('nama');
  const status = document.getElementById('status');
  if(user){ nama.value = user.displayName || ''; }
  document.getElementById('simpanProfil')?.addEventListener('click', async ()=>{
    const newName = nama.value.trim();
    if(newName){
      await update(ref(db, `users/${user.uid}`), { displayName: newName });
      try{ await updateProfile(user, { displayName: newName }); }catch(e){}
      showToast('Profil', 'Nama tampil diperbarui');
    }
  });
}

/* ---------- Presence (online/lastSeen) ---------- */
function setPresence(isOnline){
  const user = auth.currentUser;
  if(!user) return;
  const uref = ref(db, `users/${user.uid}`);
  update(uref, { online: isOnline, lastSeen: Date.now() }).catch(()=>{});
}

/* ---------- AUTH state listener & init ---------- */
onAuthStateChanged(auth, (user)=>{
  renderHeader(user);
  renderFooter();
  if(user){
    // set online
    setPresence(true);
    loadPage('beranda');
    // when window closed/unload set offline
    window.addEventListener('beforeunload', ()=> setPresence(false));
  } else {
    renderLogin();
  }
});
