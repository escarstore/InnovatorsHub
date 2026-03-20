// ================================================================
//  InnovatorsHub — Main Application Logic
//  Real production — no synthetic data
//  Supabase auth + backend API
// ================================================================

// ── CONFIG ────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL:    'https://gcnfwwpcvcmrmxefchsb.supabase.co', // ← Replace
  SUPABASE_ANON:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjbmZ3d3BjdmNtcm14ZWZjaHNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTQyNDcsImV4cCI6MjA4OTMzMDI0N30.804xXlRn12A-lZfiS7OT3pKq_WQVp14lSP3MI0H8qqY',              // ← Replace
  API_BASE:        'http://localhost:5000',
  SUBSCRIPTION_PRICE: 25000,
  REFERRAL_DISCOUNT:   5000,
};

// ── SUPABASE CLIENT ────────────────────────────────────────────
const { createClient } = supabase; // from CDN
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON);

// ── APP STATE ──────────────────────────────────────────────────
const App = {
  user:        null,   // Supabase user
  profile:     null,   // DB profile row
  isGuest:     false,
  page:        'landing',
  feedTab:     'for-you',
  chatPartner: null,
  postCursor:  null,
};

// ── UTILITIES ─────────────────────────────────────────────────
function $(s, ctx = document)  { return ctx.querySelector(s); }
function $$(s, ctx = document) { return [...ctx.querySelectorAll(s)]; }

function toast(message, type = 'info', duration = 3500) {
  const container = $('#toast-container');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, duration);
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString('en-UG', { day:'numeric', month:'short' });
}

function formatNumber(n) {
  if (!n) return '0';
  if (n >= 1000) return (n/1000).toFixed(1).replace('.0','') + 'k';
  return String(n);
}

function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || '?';
}

function escapeHtml(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBody(text = '') {
  return escapeHtml(text)
    .replace(/(#\w+)/g, '<span class="hashtag">$1</span>')
    .replace(/\n/g, '<br>');
}

function avatarHTML(profile, size = 'sm') {
  const init = getInitials(profile?.full_name || profile?.name || '');
  const src  = profile?.avatar_url;
  return `<div class="avatar avatar-${size}" style="${profile?.avatar_color ? `background:${profile.avatar_color}20;color:${profile.avatar_color}` : ''}">
    ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(init)}" loading="lazy">` : init}
  </div>`;
}

// API helper
async function api(method, path, body = null) {
  const session = await sb.auth.getSession();
  const token   = session?.data?.session?.access_token;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${CONFIG.API_BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── PAGE ROUTER ────────────────────────────────────────────────
function showPage(name) {
  $$('.page').forEach(p => p.classList.remove('active'));
  const target = $(`#page-${name}`);
  if (target) { target.classList.add('active'); App.page = name; }
  // Update sidebar active state
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
  $$('.mobile-nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
  window.scrollTo(0, 0);
}

// ── SUPABASE AUTH ──────────────────────────────────────────────
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    App.user = session.user;
    await loadProfile();
    enterApp();
  } else {
    showPage('landing');
  }

  // Listen for auth changes
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      App.user = session.user;
      await loadProfile();
      enterApp();
    } else if (event === 'SIGNED_OUT') {
      App.user = null; App.profile = null;
      showPage('landing');
    }
  });
}

async function loadProfile() {
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', App.user.id)
    .single();

  if (data) {
    App.profile = data;
  } else if (error?.code === 'PGRST116') {
    // Profile doesn't exist yet — create it
    const { data: newProfile } = await sb.from('profiles').insert({
      id:        App.user.id,
      full_name: App.user.user_metadata?.full_name || App.user.email.split('@')[0],
      email:     App.user.email,
      avatar_url: App.user.user_metadata?.avatar_url || null,
      ref_code:  App.user.email.split('@')[0].toUpperCase().substring(0,6) + Math.floor(Math.random()*9000+1000),
    }).select().single();
    App.profile = newProfile;
  }
}

function enterApp() {
  updateSidebarProfile();
  showPage('feed');
  loadFeed();
  loadUnreadCounts();
  // Dispatch userLoaded so admin nav items reveal themselves
  window.dispatchEvent(new CustomEvent('userLoaded', { detail: App.profile }));
  // Poll unread counts every 30s
  setInterval(loadUnreadCounts, 30000);
}

// ── GUEST MODE ─────────────────────────────────────────────────
function enterGuest() {
  App.isGuest = true;
  updateSidebarProfile();
  showPage('feed');
  loadFeed();
  // Show guest banner
  $('#guest-banner')?.classList.remove('hidden');
}

// ── SIGN OUT ──────────────────────────────────────────────────
async function signOut() {
  await sb.auth.signOut();
  App.user = null; App.profile = null; App.isGuest = false;
  showPage('landing');
  toast('Signed out successfully', 'info');
}

// ── SIDEBAR PROFILE ────────────────────────────────────────────
function updateSidebarProfile() {
  const p = App.profile;
  const name = App.isGuest ? 'Guest User' : (p?.full_name || App.user?.email || '');
  const sub  = App.isGuest ? 'Browse only' : (p?.is_admin ? '👑 Admin' : (p?.subscription_status === 'active' ? 'Member' : 'Free'));

  $('#sidebar-avatar').innerHTML = App.isGuest
    ? `<div class="avatar avatar-sm" style="background:var(--bg3);color:var(--text3)">?</div>`
    : avatarHTML(p, 'sm');
  $('#sidebar-name').textContent  = name;
  $('#sidebar-role').textContent  = sub;

  // Show/hide admin nav
  if (p?.is_admin) {
    $('#nav-admin-label')?.classList.remove('hidden');
    $('#nav-admin-item')?.classList.remove('hidden');
  }

  // Show/hide member-only nav items
  if (App.isGuest) {
    $$('.member-only-nav').forEach(el => el.classList.add('hidden'));
  }
}

// ── UNREAD COUNTS ──────────────────────────────────────────────
async function loadUnreadCounts() {
  if (!App.user || App.isGuest) return;
  try {
    const [notifs, msgs] = await Promise.all([
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', App.user.id).eq('is_read', false),
      sb.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', App.user.id).eq('is_read', false)
    ]);
    const nc = notifs.count || 0;
    const mc = msgs.count || 0;
    const notifBadge = $('#notif-badge');
    const msgBadge   = $('#msg-badge');
    if (notifBadge) { notifBadge.textContent = nc; notifBadge.classList.toggle('hidden', nc === 0); }
    if (msgBadge)   { msgBadge.textContent = mc;   msgBadge.classList.toggle('hidden', mc === 0); }
  } catch {}
}

// ── FEED ───────────────────────────────────────────────────────
async function loadFeed(tab = 'for-you', append = false) {
  App.feedTab = tab;
  const container = $('#feed-posts');
  if (!container) return;

  if (!append) {
    container.innerHTML = skeletonPosts(3);
  }

  try {
    let query = sb
      .from('posts')
      .select(`
        id, body, type, media_url, media_name, yt_url, yt_thumbnail, poll_data,
        likes_count, comments_count, created_at,
        profiles:user_id (id, full_name, avatar_url, avatar_color, headline, is_verified)
      `)
      .eq('is_deleted', false)
      .eq('is_flagged', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tab === 'following' && App.user) {
      // Get followed user IDs
      const { data: follows } = await sb
        .from('follows')
        .select('following_id')
        .eq('follower_id', App.user.id);
      const ids = (follows || []).map(f => f.following_id);
      if (ids.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div><h3>No posts yet</h3><p>Follow some innovators to see their posts here.</p></div>`;
        return;
      }
      query = query.in('user_id', ids);
    }

    const { data: posts, error } = await query;
    if (error) throw error;

    if (!append) container.innerHTML = '';

    if (!posts?.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><h3>Nothing here yet</h3><p>Be the first to share something!</p></div>`;
      return;
    }

    // Get user's own reactions
    let myReactions = {};
    if (App.user) {
      const { data: rxns } = await sb
        .from('post_reactions')
        .select('post_id, reaction_type')
        .eq('user_id', App.user.id)
        .in('post_id', posts.map(p => p.id));
      (rxns || []).forEach(r => {
        if (!myReactions[r.post_id]) myReactions[r.post_id] = new Set();
        myReactions[r.post_id].add(r.reaction_type);
      });
    }

    posts.forEach(post => {
      container.insertAdjacentHTML('beforeend', renderPost(post, myReactions[post.id] || new Set()));
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><h3>Could not load posts</h3><p>${err.message}</p></div>`;
  }
}

function skeletonPosts(n) {
  return Array(n).fill('').map(() => `
    <div class="post-card">
      <div class="flex gap-3 mb-3">
        <div class="skeleton sk-avatar"></div>
        <div style="flex:1"><div class="skeleton sk-line medium"></div><div class="skeleton sk-line short mt-2"></div></div>
      </div>
      <div class="skeleton sk-line full"></div><div class="skeleton sk-line full mt-2"></div><div class="skeleton sk-line short mt-2"></div>
    </div>`).join('');
}

function renderPost(post, myRxns = new Set()) {
  const p = post.profiles || {};
  const isLiked = myRxns.has('like');
  const body = formatBody(post.body || '');

  // Media rendering
  let mediaHTML = '';
  if (post.yt_url) {
    const videoId = extractYouTubeId(post.yt_url);
    if (videoId) {
      const thumb = post.yt_thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      mediaHTML = `
        <div class="post-media">
          <div class="yt-thumb" onclick="playYouTube('${videoId}', this)" role="button" tabindex="0">
            <img src="${escapeHtml(thumb)}" alt="Video thumbnail" loading="lazy">
            <div class="yt-play-btn">
              <svg viewBox="0 0 68 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="68" height="48" rx="12" fill="#FF0000" opacity="0.9"/>
                <path d="M28 15L45 24L28 33V15Z" fill="white"/>
              </svg>
            </div>
          </div>
        </div>`;
    }
  } else if (post.media_url) {
    if (post.type === 'image') {
      mediaHTML = `<div class="post-media"><img src="${escapeHtml(post.media_url)}" alt="${escapeHtml(post.media_name || 'Image')}" loading="lazy" style="width:100%;max-height:400px;object-fit:cover;"></div>`;
    } else if (post.type === 'video') {
      mediaHTML = `
        <div class="post-media">
          <video controls preload="metadata" style="width:100%;max-height:450px;border-radius:var(--radius);background:#000">
            <source src="${escapeHtml(post.media_url)}" type="video/mp4">
            Your browser does not support the video tag.
          </video>
        </div>`;
    } else if (post.type === 'resource' || post.type === 'document') {
      const ext = (post.media_name || '').split('.').pop().toLowerCase();
      const docIcons = { pdf: '📄', txt: '📝', doc: '📝', docx: '📝', rtf: '📝' };
      const docIcon = docIcons[ext] || '📁';
      const docLabel = ext ? ext.toUpperCase() + ' Document' : 'Document';
      mediaHTML = `
        <div class="post-media" style="background:var(--bg2);padding:1rem;display:flex;align-items:center;gap:.85rem;border-radius:var(--radius)">
          <div style="font-size:2rem">${docIcon}</div>
          <div style="flex:1;min-width:0"><div class="font-bold text-sm truncate">${escapeHtml(post.media_name || 'Resource')}</div><div class="text-xs text-faint">${docLabel}</div></div>
          <a href="${escapeHtml(post.media_url)}" target="_blank" download class="btn btn-secondary btn-sm">⬇ Download</a>
        </div>`;
    }
  }

  // Poll rendering
  let pollHTML = '';
  if (post.poll_data && post.type === 'poll') {
    const poll = post.poll_data;
    const total = (poll.votes || []).reduce((a, b) => a + b, 0);
    const hasVoted = poll.voted_option !== undefined;
    pollHTML = `
      <div class="poll-box">
        <div class="poll-question">${escapeHtml(poll.question)}</div>
        ${(poll.options || []).map((opt, i) => {
          const pct = total > 0 ? Math.round((poll.votes[i] || 0) / total * 100) : 0;
          return `
            <div class="poll-option${hasVoted ? ' voted' : ''}" onclick="votePoll('${post.id}', ${i})" data-post="${post.id}" data-opt="${i}">
              <div class="poll-fill" style="width:${hasVoted ? pct : 0}%"></div>
              <div class="poll-label"><span>${escapeHtml(opt)}</span>${hasVoted ? `<span class="poll-pct">${pct}%</span>` : ''}</div>
            </div>`;
        }).join('')}
        <div class="text-xs text-faint mt-2">${formatNumber(total)} votes${hasVoted ? '' : ' · Tap to vote'}</div>
      </div>`;
  }

  return `
    <article class="post-card" data-post-id="${post.id}">
      <div class="post-header">
        ${avatarHTML(p, 'md')}
        <div class="post-author-info">
          <div class="post-author-name flex items-center gap-2">
            <span class="cursor-pointer" onclick="viewProfile('${escapeHtml(p.id || '')}')">${escapeHtml(p.full_name || 'Unknown')}</span>
            ${p.is_verified ? '<span title="Verified" style="color:var(--accent)">✓</span>' : ''}
          </div>
          <div class="post-author-meta">
            ${p.headline ? `<span>${escapeHtml(p.headline)}</span><span>·</span>` : ''}
            <span>${formatTime(post.created_at)}</span>
          </div>
        </div>
        <div style="margin-left:auto;display:flex;gap:.35rem;">
          ${App.user && App.user.id !== p.id ? `<button class="btn btn-icon btn-sm" onclick="reportPost('${post.id}')" title="Report">⋯</button>` : ''}
          ${App.profile?.is_admin ? `<button class="btn btn-icon btn-sm" style="color:var(--red)" onclick="adminDeletePost('${post.id}')" title="Delete">🗑</button>` : ''}
        </div>
      </div>

      <div class="post-body">${body}</div>
      ${mediaHTML}
      ${pollHTML}

      <div class="reactions">
        <button class="rxn-btn${isLiked ? ' active' : ''}" onclick="reactPost('${post.id}','like',this)">
          ❤️ <span>${formatNumber(post.likes_count)}</span>
        </button>
        <button class="rxn-btn${myRxns.has('insightful') ? ' active' : ''}" onclick="reactPost('${post.id}','insightful',this)">
          💡 Insightful
        </button>
        <button class="rxn-btn${myRxns.has('fire') ? ' active' : ''}" onclick="reactPost('${post.id}','fire',this)">
          🔥 Fire
        </button>
        <button class="rxn-btn${myRxns.has('collab') ? ' active' : ''}" onclick="reactPost('${post.id}','collab',this)">
          🤝 Collaborate
        </button>
      </div>

      <div class="post-actions">
        <button class="post-action-btn${isLiked ? ' liked' : ''}" onclick="reactPost('${post.id}','like',this)">
          ${isLiked ? '❤️' : '🤍'} <span>${formatNumber(post.likes_count)}</span>
        </button>
        <button class="post-action-btn" onclick="openComments('${post.id}')">
          💬 <span>${formatNumber(post.comments_count)}</span>
        </button>
        <button class="post-action-btn" onclick="shareToWhatsApp('${post.id}','${escapeHtml((post.body||'').substring(0,80))}')">
          📲 Share
        </button>
        <button class="post-action-btn" style="margin-left:auto" onclick="savePost('${post.id}',this)" title="Save">🔖</button>
      </div>
    </article>`;
}

// ── YOUTUBE ────────────────────────────────────────────────────
function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function playYouTube(videoId, thumbEl) {
  thumbEl.outerHTML = `
    <div class="yt-embed">
      <iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen loading="lazy"></iframe>
    </div>`;
}

// ── REACTIONS ──────────────────────────────────────────────────
async function reactPost(postId, type, btn) {
  if (!App.user) { openAuthModal(); return; }
  if (App.isGuest) { promptSignUp(); return; }
  try {
    const { data: existing } = await sb
      .from('post_reactions')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', App.user.id)
      .eq('reaction_type', type)
      .single();

    if (existing) {
      await sb.from('post_reactions').delete().eq('id', existing.id);
      btn.classList.remove('active', 'liked');
    } else {
      await sb.from('post_reactions').insert({ post_id: postId, user_id: App.user.id, reaction_type: type });
      btn.classList.add('active');
      if (type === 'like') btn.classList.add('liked');
    }
  } catch {}
}

// ── POLL VOTE ──────────────────────────────────────────────────
async function votePoll(postId, optionIndex) {
  if (!App.user) { openAuthModal(); return; }
  if (App.isGuest) { promptSignUp(); return; }

  const { data: post } = await sb.from('posts').select('poll_data').eq('id', postId).single();
  if (!post?.poll_data) return;

  const poll = post.poll_data;
  if (poll.voted_option !== undefined) { toast('Already voted!', 'info'); return; }

  poll.votes[optionIndex] = (poll.votes[optionIndex] || 0) + 1;
  poll.voted_option = optionIndex;

  await sb.from('posts').update({ poll_data: poll }).eq('id', postId);

  // Re-render just this post's poll
  const postEl = $(`[data-post-id="${postId}"]`);
  const pollBox = postEl?.querySelector('.poll-box');
  if (pollBox) {
    const total = poll.votes.reduce((a, b) => a + b, 0);
    pollBox.querySelectorAll('.poll-option').forEach((opt, i) => {
      const pct = Math.round((poll.votes[i] || 0) / total * 100);
      opt.classList.add('voted');
      opt.querySelector('.poll-fill').style.width = pct + '%';
      const label = opt.querySelector('.poll-label');
      if (!label.querySelector('.poll-pct')) {
        label.insertAdjacentHTML('beforeend', `<span class="poll-pct">${pct}%</span>`);
      }
    });
    pollBox.querySelector('.text-xs').textContent = `${formatNumber(total)} votes`;
  }
}

// ── CREATE POST ────────────────────────────────────────────────
async function submitPost() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  if (App.profile?.subscription_status !== 'active' && !App.profile?.is_admin) {
    openPaymentModal(); return;
  }

  const textarea = $('#composer-text');
  const body     = textarea?.value.trim();
  if (!body) { toast('Write something first!', 'error'); return; }

  const submitBtn = $('#post-submit-btn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spin">⟳</span> Posting...';

  try {
    const postData = {
      user_id: App.user.id,
      body,
      type: 'text',
    };

    // Check for YouTube link in text
    const ytId = extractYouTubeId(body);
    if (ytId) {
      postData.type = 'video';
      postData.yt_url = `https://youtube.com/watch?v=${ytId}`;
      postData.yt_thumbnail = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }

    // Uploaded file
    if (App._pendingUpload) {
      postData.media_url  = App._pendingUpload.url;
      postData.media_name = App._pendingUpload.name;
      postData.type = App._pendingUpload.type;
      App._pendingUpload = null;
      $('#upload-preview')?.classList.add('hidden');
    }

    // Poll data
    if (App._pendingPoll) {
      postData.poll_data = App._pendingPoll;
      postData.type = 'poll';
      App._pendingPoll = null;
      $('#poll-preview')?.classList.add('hidden');
    }

    const { data, error } = await sb.from('posts').insert(postData).select(`
      id, body, type, media_url, media_name, yt_url, yt_thumbnail, poll_data,
      likes_count, comments_count, created_at,
      profiles:user_id (id, full_name, avatar_url, avatar_color, headline, is_verified)
    `).single();

    if (error) throw error;

    textarea.value = '';
    textarea.style.height = '';
    $('#feed-posts').insertAdjacentHTML('afterbegin', renderPost(data, new Set()));
    toast('Post published! 🚀', 'success');

    // Award points
    await sb.from('profiles').update({ points: (App.profile.points || 0) + 10 }).eq('id', App.user.id);

  } catch (err) {
    toast('Failed to publish: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Post';
  }
}

// ── FILE UPLOAD (Supabase Storage) ─────────────────────────────
async function uploadFile(file, bucket = 'uploads') {
  if (!file) return null;
  const ext  = file.name.split('.').pop();
  const path = `${App.user.id}/${Date.now()}.${ext}`;
  const { data, error } = await sb.storage.from(bucket).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path);
  return { url: publicUrl, name: file.name, path };
}

async function handleFileSelect(input) {
  const file = input.files?.[0];
  if (!file) return;

  const maxMB = 50;
  if (file.size > maxMB * 1024 * 1024) { toast(`File too large (max ${maxMB}MB)`, 'error'); return; }

  const isPDF   = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  const ext = file.name.split('.').pop().toLowerCase();
  const isText  = ['txt', 'rtf'].includes(ext);
  const isDoc   = ['doc', 'docx'].includes(ext);

  const supportedTypes = isPDF || isImage || isVideo || isText || isDoc;
  if (!supportedTypes) { toast('Unsupported file type. Allowed: images, videos, PDFs, text/doc files.', 'error'); return; }

  const btn = $('#upload-btn');
  btn.innerHTML = '<span class="spin">⟳</span> Uploading...';
  btn.disabled = true;

  try {
    let bucket = 'uploads';
    let fileType = 'image';
    let icon = '🖼️';

    if (isPDF) {
      bucket = 'resources'; fileType = 'resource'; icon = '📄';
    } else if (isVideo) {
      bucket = 'uploads'; fileType = 'video'; icon = '🎬';
    } else if (isText || isDoc) {
      bucket = 'resources'; fileType = 'document'; icon = '📝';
    }

    const result = await uploadFile(file, bucket);
    App._pendingUpload = { url: result.url, name: file.name, type: fileType };

    const preview = $('#upload-preview');
    if (preview) {
      preview.classList.remove('hidden');
      let previewContent = '';
      if (isImage) {
        const imgUrl = URL.createObjectURL(file);
        previewContent = `<img src="${imgUrl}" style="max-height:80px;border-radius:6px;object-fit:cover" alt="preview">`;
      } else if (isVideo) {
        previewContent = `<video src="${URL.createObjectURL(file)}" style="max-height:80px;border-radius:6px" muted></video>`;
      }
      preview.innerHTML = `
        <div class="flex items-center gap-2 p-2 rounded border" style="border-color:var(--border)">
          ${previewContent || `<span style="font-size:1.5rem">${icon}</span>`}
          <span class="text-sm truncate" style="flex:1">${escapeHtml(file.name)}</span>
          <span class="text-xs text-faint">${(file.size / 1024 / 1024).toFixed(1)}MB</span>
          <button class="btn btn-icon btn-sm" onclick="cancelUpload()" title="Remove">✕</button>
        </div>`;
    }
    toast('File ready to post ✓', 'success');
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
  } finally {
    btn.textContent = '📎';
    btn.disabled = false;
    input.value = '';
  }
}

function cancelUpload() {
  App._pendingUpload = null;
  $('#upload-preview')?.classList.add('hidden');
}

// ── POLL CREATOR ───────────────────────────────────────────────
function openPollCreator() {
  openModal('modal-poll-creator');
}

function confirmPoll() {
  const question = $('#poll-question-input')?.value.trim();
  const opts = $$('.poll-option-input').map(i => i.value.trim()).filter(Boolean);
  if (!question) { toast('Enter a question', 'error'); return; }
  if (opts.length < 2) { toast('Add at least 2 options', 'error'); return; }

  App._pendingPoll = { question, options: opts, votes: opts.map(() => 0) };

  const preview = $('#poll-preview');
  if (preview) {
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <div class="poll-box" style="margin-bottom:0">
        <div class="poll-question">${escapeHtml(question)}</div>
        ${opts.map(o => `<div class="poll-option"><div class="poll-label"><span>${escapeHtml(o)}</span></div></div>`).join('')}
        <button class="btn btn-icon btn-sm mt-2" onclick="cancelPoll()" title="Remove poll">✕ Remove poll</button>
      </div>`;
  }

  closeModal('modal-poll-creator');
  toast('Poll added ✓', 'success');
}

function cancelPoll() {
  App._pendingPoll = null;
  $('#poll-preview')?.classList.add('hidden');
}

function addPollOption() {
  const container = $('#poll-options-container');
  const count = $$('.poll-option-input').length;
  if (count >= 5) { toast('Max 5 options', 'info'); return; }
  container.insertAdjacentHTML('beforeend', `
    <input class="form-control poll-option-input mt-2" placeholder="Option ${count + 1}" maxlength="80">`);
}

// ── SAVE POST ──────────────────────────────────────────────────
async function savePost(postId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const { data: existing } = await sb.from('saved_posts').select('id').eq('user_id', App.user.id).eq('post_id', postId).single();
  if (existing) {
    await sb.from('saved_posts').delete().eq('id', existing.id);
    btn.style.opacity = '0.4';
    toast('Post unsaved', 'info');
  } else {
    await sb.from('saved_posts').insert({ user_id: App.user.id, post_id: postId });
    btn.style.opacity = '1';
    btn.style.color = 'var(--accent)';
    toast('Post saved 🔖', 'success');
  }
}

// ── SHARE ─────────────────────────────────────────────────────
function shareToWhatsApp(postId, preview) {
  const text = `🇺🇬 Check this out on InnovatorsHub:\n\n"${preview}..."\n\nView at: ${window.location.origin}/post/${postId}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

// ── REPORT POST ────────────────────────────────────────────────
async function reportPost(postId) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const type = prompt('Report reason (nudity/spam/abuse/misinformation):');
  if (!type) return;
  await sb.from('reports').insert({ reporter_id: App.user.id, reported_post_id: postId, report_type: type, description: '' });
  await sb.from('posts').update({ is_flagged: true }).eq('id', postId);
  toast('Report submitted. Admin will review.', 'success');
}

// ── COMMENTS ──────────────────────────────────────────────────
async function openComments(postId) {
  openModal('modal-comments');
  const container = $('#comments-list');
  container.innerHTML = '<div class="skeleton sk-line full mt-2"></div><div class="skeleton sk-line full mt-2"></div>';
  $('#comments-post-id').value = postId;

  const { data: comments } = await sb
    .from('comments')
    .select('*, profiles:user_id(id, full_name, avatar_url, avatar_color)')
    .eq('post_id', postId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });

  container.innerHTML = '';
  if (!comments?.length) {
    container.innerHTML = '<div class="text-faint text-sm p-4 text-center">No comments yet. Be first!</div>';
    return;
  }

  comments.forEach(c => {
    const p = c.profiles || {};
    container.insertAdjacentHTML('beforeend', `
      <div class="flex gap-3 py-3" style="border-bottom:1px solid var(--border)">
        ${avatarHTML(p, 'sm')}
        <div style="flex:1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm">${escapeHtml(p.full_name || 'Unknown')}</span>
            <span class="text-xs text-faint">${formatTime(c.created_at)}</span>
          </div>
          <p class="text-sm mt-1">${formatBody(c.body)}</p>
        </div>
      </div>`);
  });
}

async function submitComment() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const postId = $('#comments-post-id')?.value;
  const body   = $('#comment-input')?.value.trim();
  if (!body) return;

  const { error } = await sb.from('comments').insert({ post_id: postId, user_id: App.user.id, body });
  if (error) { toast(error.message, 'error'); return; }

  $('#comment-input').value = '';
  toast('Comment added ✓', 'success');
  await openComments(postId);
}

// ── COURSES PAGE ───────────────────────────────────────────────
async function loadCourses() {
  const container = $('#courses-grid');
  if (!container) return;

  container.innerHTML = skeletonCourses(4);

  try {
    const { data: courses, error } = await sb
      .from('courses')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    container.innerHTML = '';
    if (!courses?.length) {
      container.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎓</div><h3>No courses yet</h3><p>Admin will add courses soon.</p></div>';
      return;
    }

    courses.forEach(course => {
      const ytId = course.yt_url ? extractYouTubeId(course.yt_url) : null;
      const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : course.thumbnail_url;

      container.insertAdjacentHTML('beforeend', `
        <div class="course-card" onclick="openCourse('${course.id}')">
          <div class="course-thumb">
            ${thumb
              ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(course.title)}" loading="lazy">`
              : `<div class="course-thumb-placeholder">${course.icon || '🎓'}</div>`}
          </div>
          <div class="course-body">
            <div class="course-title">${escapeHtml(course.title)}</div>
            <div class="course-meta">
              ${course.instructor ? `<span>👤 ${escapeHtml(course.instructor)}</span>` : ''}
              ${course.duration ? `<span>⏱ ${escapeHtml(course.duration)}</span>` : ''}
              ${course.level ? `<span class="badge badge-neutral">${escapeHtml(course.level)}</span>` : ''}
            </div>
            <p class="text-sm text-muted" style="margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
              ${escapeHtml(course.description || '')}
            </p>
          </div>
        </div>`);
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>${err.message}</p></div>`;
  }
}

function skeletonCourses(n) {
  return `<div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem">
    ${Array(n).fill('').map(() => `<div class="card"><div class="skeleton" style="aspect-ratio:16/9"></div><div class="p-4"><div class="skeleton sk-line medium"></div><div class="skeleton sk-line short mt-2"></div></div></div>`).join('')}
  </div>`;
}

async function openCourse(courseId) {
  const { data: course } = await sb.from('courses').select('*').eq('id', courseId).single();
  if (!course) return;

  const ytId = course.yt_url ? extractYouTubeId(course.yt_url) : null;
  const modal = $('#modal-course-viewer');
  const title = $('#course-viewer-title');
  const player = $('#course-viewer-player');
  const desc = $('#course-viewer-desc');

  title.textContent = course.title;
  desc.textContent  = course.description || '';

  if (ytId) {
    player.innerHTML = `<div class="yt-embed"><iframe src="https://www.youtube.com/embed/${ytId}?rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  } else if (course.yt_url) {
    player.innerHTML = `<div class="yt-embed"><iframe src="${escapeHtml(course.yt_url)}" allowfullscreen></iframe></div>`;
  } else {
    player.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎓</div><p>No video available</p></div>';
  }

  openModal('modal-course-viewer');
}

// ── RESOURCES PAGE ─────────────────────────────────────────────
async function loadResources(type = '') {
  const container = $('#resources-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton sk-line full"></div><div class="skeleton sk-line full mt-2"></div>';

  try {
    let query = sb
      .from('resources')
      .select('*, profiles:user_id(id, full_name)')
      .eq('is_approved', true)
      .order('created_at', { ascending: false });
    if (type) query = query.eq('file_type', type);

    const { data: resources, error } = await query;
    if (error) throw error;

    container.innerHTML = '';
    if (!resources?.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📚</div><h3>No resources yet</h3><p>Be the first to upload a resource!</p></div>';
      return;
    }

    resources.forEach(r => {
      const p = r.profiles || {};
      const icons = { pdf: '📄', video: '🎬', zip: '🗜️', doc: '📝' };
      container.insertAdjacentHTML('beforeend', `
        <div class="card card-hover" style="margin-bottom:.75rem">
          <div class="p-4 flex gap-3 items-start">
            <div style="font-size:2rem">${icons[r.file_type] || '📁'}</div>
            <div style="flex:1;min-width:0">
              <div class="font-bold truncate">${escapeHtml(r.title)}</div>
              <p class="text-sm mt-1" style="margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(r.description || '')}</p>
              <div class="flex items-center gap-3 mt-2 text-xs text-faint">
                <span class="badge badge-neutral">${(r.file_type || 'file').toUpperCase()}</span>
                ${r.file_size_mb ? `<span>${r.file_size_mb}MB</span>` : ''}
                <span>⬇ ${formatNumber(r.downloads_count)} downloads</span>
                <span>by ${escapeHtml(p.full_name || 'Unknown')}</span>
              </div>
            </div>
            <a href="${escapeHtml(r.file_url)}" target="_blank" download
               class="btn btn-secondary btn-sm" onclick="trackDownload('${r.id}')">
              ⬇ Download
            </a>
          </div>
        </div>`);
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
  }
}

async function trackDownload(resourceId) {
  await sb.from('resources').update({ downloads_count: sb.rpc('increment', { id: resourceId }) }).eq('id', resourceId).catch(() => {});
}

// Resource upload form
async function submitResource() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  if (App.profile?.subscription_status !== 'active' && !App.profile?.is_admin) { openPaymentModal(); return; }

  const title = $('#resource-title')?.value.trim();
  const desc  = $('#resource-desc')?.value.trim();
  const file  = $('#resource-file')?.files?.[0];
  if (!title || !file) { toast('Title and file are required', 'error'); return; }

  const btn = $('#resource-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⟳</span> Uploading...';

  try {
    const result = await uploadFile(file, 'resources');
    const ext = file.name.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'mov', 'webm', 'avi'];
    const docExts   = ['txt', 'doc', 'docx', 'rtf'];
    const fileType = ext === 'pdf' ? 'pdf' : videoExts.includes(ext) ? 'video' : ext === 'zip' ? 'zip' : docExts.includes(ext) ? 'doc' : 'doc';

    await sb.from('resources').insert({
      user_id:     App.user.id,
      title, description: desc,
      file_url:    result.url,
      file_name:   file.name,
      file_type:   fileType,
      file_size_mb: +(file.size / 1024 / 1024).toFixed(2),
    });

    closeModal('modal-upload-resource');
    toast('Resource uploaded! ✓', 'success');
    loadResources();
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

// ── PROFILE PAGE ───────────────────────────────────────────────
async function viewProfile(userId) {
  if (!userId) return;
  showPage('profile');

  // Show skeleton
  $('#profile-content').innerHTML = `
    <div class="profile-banner"></div>
    <div class="profile-info"><div class="skeleton sk-avatar" style="width:96px;height:96px;border-radius:50%"></div></div>`;

  const [profileRes, postsRes, followersRes, followingRes] = await Promise.all([
    sb.from('profiles').select('*').eq('id', userId).single(),
    sb.from('posts').select('id,body,type,media_url,yt_url,likes_count,comments_count,created_at,profiles:user_id(id,full_name,avatar_url,headline)').eq('user_id', userId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(10),
    sb.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
    sb.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);

  const profile = profileRes.data;
  if (!profile) { showPage('feed'); return; }

  // Is current user following this profile?
  let isFollowing = false;
  let canMessage  = false;
  if (App.user && App.user.id !== userId) {
    const { data: follow } = await sb.from('follows').select('id').eq('follower_id', App.user.id).eq('following_id', userId).single();
    isFollowing = !!follow;
    // Can message only if following
    canMessage = isFollowing;
  }

  const isSelf = App.user?.id === userId;

  // Social links
  const socials = profile.social_links || {};
  const socialHTML = Object.entries(socials).filter(([k,v]) => v).map(([platform, url]) => {
    const icons = { linkedin: '💼', github: '🐙', twitter: '𝕏', website: '🌐', youtube: '▶️', instagram: '📸' };
    return `<a href="${escapeHtml(url)}" target="_blank" class="social-link">${icons[platform] || '🔗'} ${platform}</a>`;
  }).join('');

  $('#profile-content').innerHTML = `
    <div class="profile-banner"></div>
    <div class="profile-info">
      <div class="profile-avatar-row">
        ${avatarHTML(profile, 'xl')}
        <div class="flex gap-2">
          ${isSelf
            ? `<button class="btn btn-secondary btn-sm" onclick="openEditProfile()">Edit Profile</button>`
            : `
              ${App.user && !App.isGuest
                ? `<button class="btn btn-secondary btn-sm follow-btn${isFollowing ? ' following' : ''}" id="follow-btn-main"
                    onclick="toggleFollow('${userId}', this)">
                    ${isFollowing ? 'Following' : 'Follow'}
                  </button>
                  ${canMessage
                    ? `<button class="btn btn-primary btn-sm" onclick="openChat('${userId}','${escapeHtml(profile.full_name)}')">Message</button>`
                    : `<button class="btn btn-secondary btn-sm" disabled title="Follow to message">Message</button>`
                  }`
                : `<button class="btn btn-primary btn-sm" onclick="openAuthModal()">Follow</button>`
              }`
          }
        </div>
      </div>
      <div class="profile-name">${escapeHtml(profile.full_name || '')}</div>
      ${profile.headline ? `<div class="profile-headline">${escapeHtml(profile.headline)}</div>` : ''}
      ${profile.bio ? `<p style="font-size:.9rem;color:var(--text2);margin:.5rem 0">${escapeHtml(profile.bio)}</p>` : ''}
      ${socialHTML ? `<div class="social-links">${socialHTML}</div>` : ''}
      <div class="profile-stats mt-4">
        <div class="profile-stat"><div class="profile-stat-num">${postsRes.data?.length || 0}</div><div class="profile-stat-label">Posts</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${followersRes.count || 0}</div><div class="profile-stat-label">Followers</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${followingRes.count || 0}</div><div class="profile-stat-label">Following</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${formatNumber(profile.points || 0)}</div><div class="profile-stat-label">Points</div></div>
      </div>
    </div>
    <div class="profile-tabs">
      <div class="profile-tab active" onclick="switchProfileTab('posts','${userId}',this)">Posts</div>
      <div class="profile-tab" onclick="switchProfileTab('about','${userId}',this)">About</div>
    </div>
    <div id="profile-tab-content">
      ${(postsRes.data || []).map(p => renderPost(p, new Set())).join('') || '<div class="empty-state"><div class="empty-state-icon">📝</div><h3>No posts yet</h3></div>'}
    </div>`;
}

async function switchProfileTab(tab, userId, el) {
  $$('.profile-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const content = $('#profile-tab-content');

  if (tab === 'posts') {
    const { data: posts } = await sb.from('posts').select('*, profiles:user_id(id,full_name,avatar_url,headline)').eq('user_id', userId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(10);
    content.innerHTML = (posts || []).map(p => renderPost(p, new Set())).join('') || '<div class="empty-state"><div class="empty-state-icon">📝</div><h3>No posts yet</h3></div>';
  } else if (tab === 'about') {
    const { data: profile } = await sb.from('profiles').select('*').eq('id', userId).single();
    const socials = profile?.social_links || {};
    content.innerHTML = `
      <div class="p-6">
        ${profile?.bio ? `<div class="mb-4"><h3 class="mb-2">About</h3><p>${escapeHtml(profile.bio)}</p></div>` : ''}
        ${profile?.sector ? `<div class="mb-3"><span class="label">Sector</span><div class="mt-1">${escapeHtml(profile.sector)}</div></div>` : ''}
        ${profile?.location ? `<div class="mb-3"><span class="label">Location</span><div class="mt-1">📍 ${escapeHtml(profile.location)}</div></div>` : ''}
        ${Object.keys(socials).length ? `
          <div class="mb-3">
            <span class="label">Links</span>
            <div class="social-links mt-2">
              ${Object.entries(socials).filter(([,v])=>v).map(([k,v])=>`<a href="${escapeHtml(v)}" target="_blank" class="social-link">🔗 ${k}</a>`).join('')}
            </div>
          </div>` : ''}
      </div>`;
  }
}

// ── FOLLOW/UNFOLLOW ─────────────────────────────────────────────
async function toggleFollow(userId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }

  const isFollowing = btn.classList.contains('following');

  if (isFollowing) {
    await sb.from('follows').delete().eq('follower_id', App.user.id).eq('following_id', userId);
    btn.classList.remove('following');
    btn.textContent = 'Follow';
    toast('Unfollowed', 'info');
  } else {
    await sb.from('follows').insert({ follower_id: App.user.id, following_id: userId });
    btn.classList.add('following');
    btn.textContent = 'Following';
    toast('Following! 👋', 'success');

    // Notify
    const { data: myProfile } = await sb.from('profiles').select('full_name').eq('id', App.user.id).single();
    await sb.from('notifications').insert({
      user_id: userId, type: 'follow',
      title: 'New Follower',
      body: `${myProfile?.full_name || 'Someone'} started following you.`
    }).catch(() => {});
  }
}

// ── MESSAGES ──────────────────────────────────────────────────
async function loadMessages() {
  const list = $('#conv-list');
  if (!list) return;
  if (!App.user || App.isGuest) {
    list.innerHTML = '<div class="empty-state p-6 text-center"><div class="empty-state-icon">💬</div><h3>Sign in to message</h3></div>';
    return;
  }

  list.innerHTML = '<div class="p-4"><div class="skeleton sk-line medium"></div><div class="skeleton sk-line short mt-2"></div></div>';

  // Get conversations: all users the current user has exchanged messages with
  const { data: sent }     = await sb.from('messages').select('receiver_id').eq('sender_id', App.user.id);
  const { data: received } = await sb.from('messages').select('sender_id').eq('receiver_id', App.user.id);

  const partnerIds = [...new Set([
    ...(sent || []).map(m => m.receiver_id),
    ...(received || []).map(m => m.sender_id)
  ])].filter(id => id !== App.user.id);

  if (!partnerIds.length) {
    list.innerHTML = `<div class="empty-state p-6 text-center"><div class="empty-state-icon">💬</div><h3>No messages yet</h3><p class="text-sm">Follow someone and send them a message.</p></div>`;
    return;
  }

  const { data: partners } = await sb.from('profiles').select('id, full_name, avatar_url, avatar_color, headline').in('id', partnerIds);

  list.innerHTML = '';
  for (const partner of (partners || [])) {
    const { data: lastMsg } = await sb.from('messages')
      .select('body, created_at, sender_id, is_read')
      .or(`and(sender_id.eq.${App.user.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${App.user.id})`)
      .order('created_at', { ascending: false }).limit(1).single();

    const unread = lastMsg && !lastMsg.is_read && lastMsg.sender_id !== App.user.id;

    list.insertAdjacentHTML('beforeend', `
      <div class="conv-item${unread ? ' unread' : ''}" onclick="openChat('${partner.id}','${escapeHtml(partner.full_name)}')">
        ${avatarHTML(partner, 'md')}
        <div class="conv-info">
          <div class="conv-name">${escapeHtml(partner.full_name || '')}</div>
          <div class="conv-preview">${lastMsg ? escapeHtml(lastMsg.body.substring(0,45)) : 'Start a conversation'}</div>
        </div>
        <div class="conv-meta">
          ${lastMsg ? `<span class="conv-time">${formatTime(lastMsg.created_at)}</span>` : ''}
          ${unread ? '<div class="conv-unread-dot"></div>' : ''}
        </div>
      </div>`);
  }
}

async function openChat(partnerId, partnerName) {
  App.chatPartner = partnerId;
  showPage('messages');

  $$('.conv-item').forEach(c => c.classList.remove('active'));
  $(`[onclick*="${partnerId}"]`)?.classList.add('active');

  const chatArea = $('#chat-area');
  const { data: partner } = await sb.from('profiles').select('*').eq('id', partnerId).single();

  // Check if current user follows partner (required to message)
  const { data: follow } = await sb.from('follows').select('id').eq('follower_id', App.user.id).eq('following_id', partnerId).single();

  if (!follow) {
    chatArea.innerHTML = `
      <div class="chat-header">${avatarHTML(partner,'md')}<div><div class="font-bold">${escapeHtml(partner?.full_name||'')}</div></div></div>
      <div class="chat-empty"><div style="font-size:2.5rem">🔒</div><h3>Follow to message</h3><p class="text-sm text-faint">You need to follow ${escapeHtml(partner?.full_name||'')} to send a message.</p><button class="btn btn-primary mt-4" onclick="toggleFollow('${partnerId}', this)">Follow</button></div>`;
    return;
  }

  chatArea.innerHTML = `
    <div class="chat-header">
      ${avatarHTML(partner, 'md')}
      <div style="flex:1;cursor:pointer" onclick="viewProfile('${partnerId}')">
        <div class="font-bold">${escapeHtml(partner?.full_name || '')}</div>
        <div class="text-xs text-faint">${escapeHtml(partner?.headline || '')}</div>
      </div>
      <button class="btn btn-icon" onclick="viewProfile('${partnerId}')">👤</button>
    </div>
    <div class="chat-messages" id="chat-msgs"><div class="empty-state"><div class="empty-state-icon" style="font-size:2rem">💬</div><p>Loading...</p></div></div>
    <div class="chat-input-bar">
      <textarea class="chat-input" id="chat-msg-input" placeholder="Type a message..." rows="1"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
      <button class="btn btn-primary" onclick="sendMessage()">Send</button>
    </div>`;

  await loadChatMessages(partnerId);

  // Mark messages as read
  await sb.from('messages').update({ is_read: true }).eq('receiver_id', App.user.id).eq('sender_id', partnerId);
  loadUnreadCounts();
}

async function loadChatMessages(partnerId) {
  const container = $('#chat-msgs');
  if (!container) return;

  const { data: messages } = await sb
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${App.user.id},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${App.user.id})`)
    .order('created_at', { ascending: true });

  container.innerHTML = '';

  if (!messages?.length) {
    container.innerHTML = '<div class="chat-empty"><div style="font-size:2rem">👋</div><p class="text-sm">Say hello!</p></div>';
    return;
  }

  let lastDate = '';
  messages.forEach(msg => {
    const msgDate = new Date(msg.created_at).toLocaleDateString();
    if (msgDate !== lastDate) {
      container.insertAdjacentHTML('beforeend', `<div class="text-center text-xs text-faint py-2">${msgDate}</div>`);
      lastDate = msgDate;
    }
    const isMe = msg.sender_id === App.user.id;
    container.insertAdjacentHTML('beforeend', `
      <div class="bubble ${isMe ? 'me' : 'them'}">
        <div class="bubble-text">${escapeHtml(msg.body)}</div>
        <div class="bubble-time">${formatTime(msg.created_at)}</div>
      </div>`);
  });

  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = $('#chat-msg-input');
  const body  = input?.value.trim();
  if (!body || !App.chatPartner) return;

  input.value = '';
  input.style.height = 'auto';

  const { data: msg, error } = await sb.from('messages').insert({
    sender_id: App.user.id, receiver_id: App.chatPartner, body
  }).select().single();

  if (error) { toast('Failed to send', 'error'); return; }

  const container = $('#chat-msgs');
  const emptyState = container?.querySelector('.chat-empty');
  if (emptyState) emptyState.remove();

  container?.insertAdjacentHTML('beforeend', `
    <div class="bubble me">
      <div class="bubble-text">${escapeHtml(body)}</div>
      <div class="bubble-time">just now</div>
    </div>`);

  container.scrollTop = container.scrollHeight;

  // Notify recipient
  await sb.from('notifications').insert({
    user_id: App.chatPartner, type: 'message',
    title: 'New Message',
    body: `${App.profile?.full_name || 'Someone'}: ${body.substring(0, 60)}`
  }).catch(() => {});
}

// ── NOTIFICATIONS PAGE ─────────────────────────────────────────
async function loadNotifications() {
  const container = $('#notifs-list');
  if (!container) return;
  if (!App.user || App.isGuest) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔔</div><h3>Sign in to see notifications</h3></div>';
    return;
  }

  container.innerHTML = '<div class="p-4"><div class="skeleton sk-line medium"></div></div>';

  const { data: notifs } = await sb.from('notifications')
    .select('*').eq('user_id', App.user.id)
    .order('created_at', { ascending: false }).limit(50);

  // Mark all as read
  await sb.from('notifications').update({ is_read: true }).eq('user_id', App.user.id);
  loadUnreadCounts();

  container.innerHTML = '';
  if (!notifs?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔔</div><h3>All clear!</h3><p>No notifications yet.</p></div>';
    return;
  }

  const icons = { follow: '👤', like: '❤️', comment: '💬', message: '📩', mention: '@', payment: '💳', thread_reply: '🧵', referral_reward: '🎁' };

  notifs.forEach(n => {
    container.insertAdjacentHTML('beforeend', `
      <div class="flex gap-3 items-start px-4 py-3${!n.is_read ? ' unr' : ''}" style="border-bottom:1px solid var(--border)">
        <div class="avatar avatar-sm" style="background:var(--accent-l);color:var(--accent)">${icons[n.type] || '🔔'}</div>
        <div style="flex:1">
          <div class="font-bold text-sm">${escapeHtml(n.title)}</div>
          <div class="text-sm text-muted">${escapeHtml(n.body)}</div>
          <div class="text-xs text-faint mt-1">${formatTime(n.created_at)}</div>
        </div>
        ${!n.is_read ? '<div class="conv-unread-dot" style="margin-top:.4rem"></div>' : ''}
      </div>`);
  });
}

// ── EXPLORE / SEARCH ───────────────────────────────────────────
async function handleSearch(query) {
  const q = query.trim();
  if (!q) { loadFeed(); return; }

  const container = $('#explore-results');
  if (!container) return;
  container.innerHTML = skeletonPosts(3);

  const { data: posts } = await sb
    .from('posts')
    .select('*, profiles:user_id(id,full_name,avatar_url,headline)')
    .ilike('body', `%${q}%`)
    .eq('is_deleted', false).eq('is_flagged', false)
    .order('created_at', { ascending: false }).limit(30);

  container.innerHTML = '';
  if (!posts?.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><h3>No results for "${escapeHtml(q)}"</h3></div>`;
    return;
  }
  posts.forEach(p => container.insertAdjacentHTML('beforeend', renderPost(p, new Set())));
}

// ── EDIT PROFILE ───────────────────────────────────────────────
function openEditProfile() {
  if (!App.profile) return;
  const p = App.profile;
  const socials = p.social_links || {};

  $('#edit-name').value     = p.full_name || '';
  $('#edit-headline').value = p.headline  || '';
  $('#edit-bio').value      = p.bio       || '';
  $('#edit-location').value = p.location  || '';
  $('#edit-sector').value   = p.sector    || '';
  $('#edit-linkedin').value = socials.linkedin  || '';
  $('#edit-github').value   = socials.github    || '';
  $('#edit-twitter').value  = socials.twitter   || '';
  $('#edit-website').value  = socials.website   || '';
  openModal('modal-edit-profile');
}

async function submitEditProfile() {
  const btn = $('#edit-profile-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin">⟳</span>';

  try {
    const updates = {
      full_name: $('#edit-name')?.value.trim(),
      headline:  $('#edit-headline')?.value.trim(),
      bio:       $('#edit-bio')?.value.trim(),
      location:  $('#edit-location')?.value.trim(),
      sector:    $('#edit-sector')?.value,
      social_links: {
        linkedin:  $('#edit-linkedin')?.value.trim() || null,
        github:    $('#edit-github')?.value.trim()   || null,
        twitter:   $('#edit-twitter')?.value.trim()  || null,
        website:   $('#edit-website')?.value.trim()  || null,
      }
    };

    const { error } = await sb.from('profiles').update(updates).eq('id', App.user.id);
    if (error) throw error;

    App.profile = { ...App.profile, ...updates };
    updateSidebarProfile();
    closeModal('modal-edit-profile');
    toast('Profile updated ✓', 'success');
    viewProfile(App.user.id);

  } catch (err) {
    toast('Update failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

// ── AVATAR UPLOAD ──────────────────────────────────────────────
async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file || !file.type.startsWith('image/')) { toast('Please select an image', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image too large (max 5MB)', 'error'); return; }

  try {
    const result = await uploadFile(file, 'avatars');
    await sb.from('profiles').update({ avatar_url: result.url }).eq('id', App.user.id);
    App.profile.avatar_url = result.url;
    toast('Avatar updated ✓', 'success');
  } catch (err) {
    toast('Upload failed: ' + err.message, 'error');
  }
}

// ── ADMIN DELETE POST ──────────────────────────────────────────
async function adminDeletePost(postId) {
  if (!App.profile?.is_admin) return;
  if (!confirm('Delete this post permanently?')) return;
  await sb.from('posts').update({ is_deleted: true }).eq('id', postId);
  $(`[data-post-id="${postId}"]`)?.remove();
  toast('Post deleted', 'success');
}

// ── MODAL HELPERS ──────────────────────────────────────────────
function openModal(id)  { const m = $('#' + id); if (m) { m.classList.add('open'); m.querySelector('.modal')?.focus?.(); } }
function closeModal(id) { const m = $('#' + id); if (m) m.classList.remove('open'); }
function closeModalOnBg(e) { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); }

function openAuthModal() { openModal('modal-auth'); switchAuthTab('login'); }

function switchAuthTab(tab) {
  $$('.auth-tab-content').forEach(el => el.classList.add('hidden'));
  $(`#auth-${tab}`)?.classList.remove('hidden');
  $$('.auth-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

function promptSignUp() {
  openAuthModal();
  toast('Create a free account to interact!', 'info');
}

function openPaymentModal() {
  openModal('modal-payment');
}

// ── SUPABASE AUTH FORMS ────────────────────────────────────────
async function submitLogin() {
  const email    = $('#login-email')?.value.trim();
  const password = $('#login-password')?.value;
  const btn      = $('#login-btn');
  const err      = $('#login-error');

  if (!email || !password) { err.textContent = 'Email and password required'; return; }
  err.textContent = '';
  btn.disabled = true; btn.innerHTML = '<span class="spin">⟳</span> Signing in...';

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    err.textContent = error.message;
    btn.disabled = false; btn.textContent = 'Sign In';
  } else {
    closeModal('modal-auth');
    toast('Welcome back! 👋', 'success');
  }
}

async function submitSignup() {
  const name     = $('#signup-name')?.value.trim();
  const email    = $('#signup-email')?.value.trim();
  const password = $('#signup-password')?.value;
  const btn      = $('#signup-btn');
  const err      = $('#signup-error');

  if (!name || !email || !password) { err.textContent = 'All fields required'; return; }
  if (password.length < 8) { err.textContent = 'Password must be at least 8 characters'; return; }
  err.textContent = '';
  btn.disabled = true; btn.innerHTML = '<span class="spin">⟳</span> Creating account...';

  const { error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (error) {
    err.textContent = error.message;
    btn.disabled = false; btn.textContent = 'Create Account';
  } else {
    closeModal('modal-auth');
    toast('Account created! Check your email to verify. 📧', 'success');
  }
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast(error.message, 'error');
}

async function signInWithGitHub() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: window.location.origin }
  });
  if (error) toast(error.message, 'error');
}

// ── PAYMENT FLOW ───────────────────────────────────────────────
let payMethod = 'MTN';

function selectPayMethod(method) {
  payMethod = method;
  $$('.pay-method-card').forEach(c => c.className = 'pay-method-card');
  const card = $(`#pay-method-${method.toLowerCase()}`);
  if (card) card.classList.add(`selected-${method.toLowerCase()}`);
  $('#pay-phone-label').textContent = `${method} Phone Number`;
}

async function initiatePayment() {
  if (!App.user) { openAuthModal(); return; }
  const phone    = $('#pay-phone-input')?.value.trim();
  const refCode  = $('#pay-ref-code')?.value.trim();
  const btn      = $('#pay-submit-btn');

  if (!phone) { toast('Enter your phone number', 'error'); return; }

  btn.disabled = true; btn.innerHTML = '<span class="spin">⟳</span> Sending prompt...';

  try {
    const data = await api('POST', '/api/payments/initiate', { paymentMethod: payMethod, phone, referralCode: refCode });
    toast(`Payment prompt sent to ${phone}. Enter your ${payMethod} PIN! 📱`, 'success');

    // Show polling screen
    $('#pay-form-step').classList.add('hidden');
    $('#pay-polling-step').classList.remove('hidden');

    // Poll until confirmed
    await api('GET', `/api/payments/status/${data.subscriptionId}`)
      .then(() => pollPaymentStatus(data.subscriptionId));

  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Payment Prompt →';
  }
}

async function pollPaymentStatus(subscriptionId) {
  let attempts = 0;
  const maxAttempts = 36;

  const poll = async () => {
    attempts++;
    try {
      const result = await api('GET', `/api/payments/status/${subscriptionId}`);

      if (result.isPaid) {
        closeModal('modal-payment');
        App.profile.subscription_status = 'active';
        toast('🎉 Subscription activated! Welcome to InnovatorsHub!', 'success');
        updateSidebarProfile();
        return;
      }
      if (result.status === 'failed') {
        $('#pay-polling-step').classList.add('hidden');
        $('#pay-form-step').classList.remove('hidden');
        $('#pay-submit-btn').disabled = false;
        $('#pay-submit-btn').textContent = 'Try Again';
        toast('Payment failed or declined. Please try again.', 'error');
        return;
      }
      if (attempts < maxAttempts) setTimeout(poll, 5000);
      else { toast('Payment timeout. Try again.', 'error'); }
    } catch { if (attempts < maxAttempts) setTimeout(poll, 5000); }
  };

  setTimeout(poll, 5000);
}

// ── STARTUP PAGE ───────────────────────────────────────────────
async function loadStartups() {
  const container = $('#startups-grid');
  if (!container) return;
  container.innerHTML = '<div class="skeleton sk-line full"></div><div class="skeleton sk-line full mt-2"></div>';

  const { data: startups } = await sb.from('startups').select('*, profiles:user_id(id,full_name)').eq('is_approved', true).order('created_at', { ascending: false });

  container.innerHTML = '';
  if (!startups?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🚀</div><h3>No startups yet</h3><p>Be the first to list your startup!</p></div>';
    return;
  }

  const stages = { idea: { label: 'Idea', cls: 'badge-amber' }, 'pre-seed': { label: 'Pre-Seed', cls: 'badge-neutral' }, seed: { label: 'Seed', cls: 'badge-green' }, 'series-a': { label: 'Series A', cls: 'badge-accent' } };

  startups.forEach(s => {
    const st = stages[s.stage] || { label: s.stage, cls: 'badge-neutral' };
    container.insertAdjacentHTML('beforeend', `
      <div class="card card-hover">
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div style="width:48px;height:48px;border-radius:var(--radius);background:var(--bg2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0">${s.logo_emoji || '🚀'}</div>
            <div style="flex:1;min-width:0">
              <div class="font-display font-bold">${escapeHtml(s.name)}</div>
              <div class="text-sm text-muted truncate">${escapeHtml(s.tagline)}</div>
            </div>
            <span class="badge ${st.cls}">${st.label}</span>
          </div>
          <p class="text-sm mt-3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0">${escapeHtml(s.description || '')}</p>
          <div class="flex items-center gap-3 mt-3 text-xs text-faint">
            <span>📍 ${escapeHtml(s.location || '')}</span>
            <span>• ${escapeHtml(s.sector || '')}</span>
            ${s.website ? `<a href="${escapeHtml(s.website)}" target="_blank" class="text-accent" style="margin-left:auto">Website →</a>` : ''}
          </div>
        </div>
      </div>`);
  });
}

// ── DISCUSSIONS ────────────────────────────────────────────────
async function loadDiscussions() {
  const container = $('#discussions-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton sk-line full"></div>';

  const { data: threads } = await sb
    .from('threads')
    .select('*, profiles:user_id(id,full_name,avatar_url,avatar_color)')
    .eq('is_deleted', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(30);

  container.innerHTML = '';
  if (!threads?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🧵</div><h3>No discussions yet</h3><p>Start the first thread!</p></div>';
    return;
  }

  threads.forEach(t => {
    const p = t.profiles || {};
    container.insertAdjacentHTML('beforeend', `
      <div class="card card-hover" style="margin-bottom:.75rem" onclick="openThread('${t.id}')">
        <div class="p-4">
          <div class="flex items-start gap-3">
            ${avatarHTML(p, 'sm')}
            <div style="flex:1;min-width:0">
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-neutral">${escapeHtml(t.category || 'General')}</span>
                ${t.is_pinned ? '<span class="badge badge-accent">📌 Pinned</span>' : ''}
              </div>
              <div class="font-bold" style="line-height:1.35">${escapeHtml(t.title)}</div>
              <div class="flex items-center gap-3 mt-2 text-xs text-faint">
                <span>${escapeHtml(p.full_name || '')}</span>
                <span>·</span>
                <span>💬 ${formatNumber(t.replies_count)}</span>
                <span>👁 ${formatNumber(t.views_count)}</span>
                <span>·</span>
                <span>${formatTime(t.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>`);
  });
}

async function openThread(threadId) {
  openModal('modal-thread-view');
  const body = $('#thread-modal-body');
  body.innerHTML = '<div class="skeleton sk-line full"></div>';
  $('#thread-id-input').value = threadId;

  const { data: thread } = await sb.from('threads').select('*, profiles:user_id(id,full_name,avatar_url,avatar_color)').eq('id', threadId).single();
  const { data: replies } = await sb.from('thread_replies').select('*, profiles:user_id(id,full_name,avatar_url,avatar_color)').eq('thread_id', threadId).eq('is_deleted', false).order('created_at', { ascending: true });

  // Increment views
  await sb.from('threads').update({ views_count: (thread?.views_count || 0) + 1 }).eq('id', threadId);

  const p = thread?.profiles || {};
  body.innerHTML = `
    <div class="flex gap-3 items-start mb-3">
      ${avatarHTML(p, 'md')}
      <div style="flex:1">
        <div class="flex items-center gap-2">
          <span class="font-bold">${escapeHtml(p.full_name || '')}</span>
          <span class="badge badge-neutral">${escapeHtml(thread?.category || 'General')}</span>
        </div>
        <div class="text-xs text-faint mt-1">${formatTime(thread?.created_at)}</div>
      </div>
    </div>
    <h3 style="margin-bottom:.75rem;line-height:1.35">${escapeHtml(thread?.title || '')}</h3>
    <p style="margin-bottom:1.25rem;color:var(--text)">${formatBody(thread?.body || '')}</p>
    <div class="divider"></div>
    <div style="font-size:.82rem;font-weight:600;color:var(--text3);margin:.75rem 0">${formatNumber(replies?.length || 0)} REPLIES</div>
    ${(replies || []).map(r => {
      const rp = r.profiles || {};
      return `<div class="flex gap-3 items-start py-3" style="border-bottom:1px solid var(--border)">
        ${avatarHTML(rp, 'sm')}
        <div style="flex:1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm">${escapeHtml(rp.full_name || '')}</span>
            <span class="text-xs text-faint">${formatTime(r.created_at)}</span>
          </div>
          <div class="text-sm mt-1">${formatBody(r.body)}</div>
        </div>
      </div>`;
    }).join('')}`;
}

async function submitThreadReply() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const threadId = $('#thread-id-input')?.value;
  const body     = $('#thread-reply-input')?.value.trim();
  if (!body) return;

  const { error } = await sb.from('thread_replies').insert({ thread_id: threadId, user_id: App.user.id, body });
  if (error) { toast(error.message, 'error'); return; }

  await sb.from('threads').update({ replies_count: sb.rpc('increment_col', { col: 'replies_count', id: threadId }) }).eq('id', threadId).catch(() => {});
  $('#thread-reply-input').value = '';
  toast('Reply posted ✓', 'success');
  await openThread(threadId);
}

async function submitNewThread() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  if (App.profile?.subscription_status !== 'active' && !App.profile?.is_admin) { openPaymentModal(); return; }

  const title    = $('#new-thread-title')?.value.trim();
  const body     = $('#new-thread-body')?.value.trim();
  const category = $('#new-thread-category')?.value;
  if (!title || !body) { toast('Title and description required', 'error'); return; }

  const { data: thread, error } = await sb.from('threads').insert({ user_id: App.user.id, title, body, category: category || 'General' }).select().single();
  if (error) { toast(error.message, 'error'); return; }

  closeModal('modal-new-thread');
  $('#new-thread-title').value = '';
  $('#new-thread-body').value  = '';
  toast('Thread posted! 🧵', 'success');
  loadDiscussions();
}

// ── EVENT LISTENERS ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAuth();

  // Auto-resize composer
  $('#composer-text')?.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });
});


// ── INJECTED FROM index.html ──────────────────────────────

// ── PAGE NAVIGATION HELPERS ─────────────────────────────────────
function sNav(section) {
  // Update active state on both sidebars and mobile nav
  $$('.nav-item, .mobile-nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === section));

  // Show the right page
  if (section === 'profile-self') {
    if (App.user) { viewProfile(App.user.id); }
    else { openAuthModal(); }
    return;
  }

  // All sections live inside page-feed (single app page)
  showPage('feed');

  // Hide all sections, show the one we need
  $$('[id^="section-"]').forEach(s => s.classList.add('hidden'));
  const target = $(`#section-${section}`);
  if (target) target.classList.remove('hidden');
}

function switchFeedTab(tab, el) {
  $$('.feed-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadFeed(tab);
}

function focusComposer() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  $('section#section-feed').classList.remove('hidden');
  $$('[id^="section-"]').forEach(s => {
    if (s.id !== 'section-feed') s.classList.add('hidden');
  });
  $('#composer-text')?.focus();
  window.scrollTo(0, 0);
}

// ── ADMIN: Add Course ─────────────────────────────────────────
async function submitAddCourse() {
  if (!App.profile?.is_admin) return;
  const title      = $('#course-title')?.value.trim();
  const ytUrl      = $('#course-yt-url')?.value.trim();
  const desc       = $('#course-desc')?.value.trim();
  const instructor = $('#course-instructor')?.value.trim();
  const level      = $('#course-level')?.value;
  const duration   = $('#course-duration')?.value.trim();

  if (!title || !ytUrl) { toast('Title and YouTube URL required', 'error'); return; }

  const ytId = extractYouTubeId(ytUrl);
  const { error } = await sb.from('courses').insert({
    title, yt_url: ytUrl,
    yt_thumbnail: ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null,
    description: desc, instructor, level, duration,
    is_published: true, created_by: App.user.id
  });

  if (error) { toast(error.message, 'error'); return; }
  closeModal('modal-add-course');
  toast('Course added ✓', 'success');
  loadCourses();
}

// ── Events ─────────────────────────────────────────────────────
async function loadEvents() {
  const container = $('#events-list');
  if (!container) return;
  container.innerHTML = '<div class="skeleton sk-line full"></div>';

  const { data: events } = await sb.from('events').select('*').eq('is_active', true).order('event_date', { ascending: true });

  container.innerHTML = '';
  if (!events?.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><h3>No upcoming events</h3><p>Check back soon!</p></div>';
    return;
  }

  let myRSVPs = new Set();
  if (App.user) {
    const { data: rsvps } = await sb.from('event_rsvps').select('event_id').eq('user_id', App.user.id);
    (rsvps || []).forEach(r => myRSVPs.add(r.event_id));
  }

  events.forEach(ev => {
    const d   = new Date(ev.event_date);
    const day = d.getDate();
    const mon = d.toLocaleString('default', { month: 'short' }).toUpperCase();
    const rsvpd = myRSVPs.has(ev.id);
    container.insertAdjacentHTML('beforeend', `
      <div style="display:flex;gap:1rem;padding:1.25rem;border-bottom:1px solid var(--border);align-items:flex-start">
        <div style="background:var(--accent-l);border:1px solid rgba(99,102,241,.2);border-radius:var(--radius);padding:.6rem .8rem;text-align:center;min-width:52px;flex-shrink:0">
          <div style="font-family:var(--font-display);font-size:1.3rem;font-weight:800;color:var(--accent);line-height:1">${day}</div>
          <div style="font-size:.7rem;font-weight:600;color:var(--accent);text-transform:uppercase">${mon}</div>
        </div>
        <div style="flex:1">
          <div style="font-family:var(--font-display);font-weight:700;margin-bottom:.3rem">${escapeHtml(ev.title)}</div>
          <div style="font-size:.82rem;color:var(--text3);display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:.4rem">
            <span>📍 ${escapeHtml(ev.location)}</span>
            <span class="badge ${ev.event_type === 'online' ? 'badge-green' : 'badge-amber'}">${ev.event_type === 'online' ? '🌐 Online' : '🏢 Physical'}</span>
            <span>👥 ${formatNumber(ev.rsvp_count || 0)} going</span>
          </div>
          <p style="font-size:.85rem;color:var(--text2);margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(ev.description || '')}</p>
        </div>
        <button class="btn ${rsvpd ? 'btn-secondary' : 'btn-primary'} btn-sm" style="flex-shrink:0" onclick="toggleEventRSVP('${ev.id}', this)">
          ${rsvpd ? '✓ Going' : 'RSVP'}
        </button>
      </div>`);
  });
}

async function toggleEventRSVP(eventId, btn) {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const { data: existing } = await sb.from('event_rsvps').select('id').eq('event_id', eventId).eq('user_id', App.user.id).single();
  if (existing) {
    await sb.from('event_rsvps').delete().eq('id', existing.id);
    await sb.from('events').update({ rsvp_count: sb.rpc('decrement', {}) }).eq('id', eventId).catch(() => {});
    btn.className = 'btn btn-primary btn-sm'; btn.style.flexShrink = '0'; btn.textContent = 'RSVP';
    toast('RSVP cancelled', 'info');
  } else {
    await sb.from('event_rsvps').insert({ event_id: eventId, user_id: App.user.id });
    btn.className = 'btn btn-secondary btn-sm'; btn.style.flexShrink = '0'; btn.textContent = '✓ Going';
    toast('📅 RSVP confirmed!', 'success');
  }
}

// ── Startup submit ───────────────────────────────────────────
async function submitStartup() {
  if (!App.user || App.isGuest) { openAuthModal(); return; }
  const name     = $('#startup-name')?.value.trim();
  const tagline  = $('#startup-tagline')?.value.trim();
  const desc     = $('#startup-desc')?.value.trim();
  const emoji    = $('#startup-emoji')?.value.trim() || '🚀';
  const sector   = $('#startup-sector')?.value;
  const stage    = $('#startup-stage')?.value;
  const location = $('#startup-location')?.value.trim();
  const website  = $('#startup-website')?.value.trim();

  if (!name || !tagline) { toast('Name and tagline required', 'error'); return; }

  const { error } = await sb.from('startups').insert({
    user_id: App.user.id, name, tagline, description: desc,
    logo_emoji: emoji, sector, stage, location, website: website || null
  });

  if (error) { toast(error.message, 'error'); return; }
  closeModal('modal-add-startup');
  toast('Startup listed! 🚀', 'success');
  loadStartups();
}

// ── Admin Dashboard ──────────────────────────────────────────
async function loadAdminDashboard() {
  if (!App.profile?.is_admin) return;
  $('#add-course-btn')?.classList.remove('hidden');
  $('#add-event-btn')?.classList.remove('hidden');

  const content = $('#admin-content');

  const [users, posts, reports, subs] = await Promise.all([
    sb.from('profiles').select('id', { count: 'exact', head: true }),
    sb.from('posts').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    sb.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('subscriptions').select('amount').eq('status', 'completed'),
  ]);

  const revenue = (subs.data || []).reduce((a, s) => a + (s.amount || 0), 0);

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1rem;margin-bottom:2rem">
      <div class="card p-4"><div class="label">Members</div><div style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:var(--accent)">${users.count || 0}</div></div>
      <div class="card p-4"><div class="label">Posts</div><div style="font-family:var(--font-display);font-size:2rem;font-weight:800">${posts.count || 0}</div></div>
      <div class="card p-4"><div class="label">Pending Reports</div><div style="font-family:var(--font-display);font-size:2rem;font-weight:800;color:var(--red)">${reports.count || 0}</div></div>
      <div class="card p-4"><div class="label">Revenue</div><div style="font-family:var(--font-display);font-size:1.3rem;font-weight:800;color:var(--green)">UGX ${revenue.toLocaleString()}</div></div>
    </div>
    <div class="flex gap-2 flex-wrap mb-4">
      <button class="btn btn-secondary btn-sm" onclick="loadAdminUsers()">Manage Users</button>
      <button class="btn btn-secondary btn-sm" onclick="loadAdminReports()">View Reports</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('modal-add-course')">+ Add Course</button>
      <button class="btn btn-primary btn-sm" onclick="openModal('modal-add-event')">+ Add Event</button>
    </div>
    <div id="admin-sub-content"></div>`;
}

async function loadAdminUsers() {
  const { data: users } = await sb.from('profiles').select('id, full_name, email, subscription_status, status, created_at').order('created_at', { ascending: false }).limit(50);
  const container = $('#admin-sub-content');
  container.innerHTML = `
    <h3 class="mb-3">All Members</h3>
    ${(users || []).map(u => `
      <div class="flex items-center gap-3 p-3 border rounded mb-2">
        <div style="flex:1"><div class="font-bold text-sm">${escapeHtml(u.full_name || '')}</div><div class="text-xs text-faint">${escapeHtml(u.email || '')}</div></div>
        <span class="badge ${u.subscription_status === 'active' ? 'badge-green' : 'badge-neutral'}">${u.subscription_status || 'free'}</span>
        ${u.status === 'suspended' ? '<span class="badge badge-red">Suspended</span>' : ''}
        <div class="flex gap-1">
          ${u.status !== 'suspended' ? `<button class="btn btn-secondary btn-sm" onclick="adminSuspend('${u.id}')">Suspend</button>` : `<button class="btn btn-green btn-sm" onclick="adminReinstate('${u.id}')">Reinstate</button>`}
          <button class="btn btn-danger btn-sm" onclick="adminRemove('${u.id}')">Remove</button>
        </div>
      </div>`).join('')}`;
}

async function loadAdminReports() {
  const { data: reports } = await sb.from('reports').select('*, reporter:reporter_id(full_name), reported_post:reported_post_id(body)').eq('status', 'pending');
  const container = $('#admin-sub-content');
  container.innerHTML = `<h3 class="mb-3">Pending Reports (${reports?.length || 0})</h3>
    ${(reports || []).map(r => `
      <div class="card p-4 mb-2">
        <div class="flex items-center gap-2 mb-2">
          <span class="badge badge-red">${escapeHtml(r.report_type)}</span>
          <span class="text-xs text-faint">by ${escapeHtml(r.reporter?.full_name || 'Unknown')} · ${formatTime(r.created_at)}</span>
        </div>
        ${r.reported_post ? `<div class="text-sm text-muted mb-2 p-2 rounded" style="background:var(--bg2)">"${escapeHtml((r.reported_post.body||'').substring(0,100))}..."</div>` : ''}
        <div class="flex gap-2">
          ${r.reported_post_id ? `<button class="btn btn-danger btn-sm" onclick="adminDeletePostFromReport('${r.reported_post_id}','${r.id}')">Remove Post</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="adminResolveReport('${r.id}')">Dismiss</button>
        </div>
      </div>`).join('') || '<div class="empty-state"><p>No pending reports. ✓</p></div>'}`;
}

async function adminSuspend(uid) {
  if (!confirm('Suspend this user?')) return;
  await sb.from('profiles').update({ status: 'suspended' }).eq('id', uid);
  toast('User suspended', 'success'); loadAdminUsers();
}
async function adminReinstate(uid) {
  await sb.from('profiles').update({ status: 'active' }).eq('id', uid);
  toast('User reinstated', 'success'); loadAdminUsers();
}
async function adminRemove(uid) {
  if (!confirm('Permanently remove this user? This cannot be undone.')) return;
  await sb.from('profiles').update({ status: 'deleted' }).eq('id', uid);
  toast('User removed', 'success'); loadAdminUsers();
}
async function adminDeletePostFromReport(postId, reportId) {
  await sb.from('posts').update({ is_deleted: true }).eq('id', postId);
  await adminResolveReport(reportId);
  toast('Post removed', 'success');
}
async function adminResolveReport(reportId) {
  await sb.from('reports').update({ status: 'resolved', resolved_by: App.user.id, resolved_at: new Date().toISOString() }).eq('id', reportId);
  toast('Report resolved', 'success'); loadAdminReports();
}

// Make admin features visible when logged in as admin
window.addEventListener('userLoaded', (e) => {
  if (e.detail?.is_admin) {
    $('#add-course-btn')?.classList.remove('hidden');
    $('#add-event-btn')?.classList.remove('hidden');
    $('#nav-admin-label')?.classList.remove('hidden');
    $('#nav-admin-item')?.classList.remove('hidden');
  }
});
