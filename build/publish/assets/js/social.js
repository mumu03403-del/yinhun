/*!
 * GinSocial —— 银魂同人 H5 小游戏合集 · 社交模块（可复用抽象层 + UI 面板）
 * ---------------------------------------------------------------------------
 * 设计目标：
 *   - 今天在普通浏览器中即可运行（graceful degraded / 优雅降级模式），不依赖任何后端。
 *   - 当脚本运行在微信小游戏 / 微信 H5 环境（存在全局 wx 对象）时，自动点亮对应能力。
 *   - 绝不伪造好友数据（NO mock/fake friend data）。浏览器模式下只展示诚实的空状态。
 *
 * 公开契约（其它页面已按此对接，必须严格实现）：
 *   window.GinSocial.open(tab)           打开面板；tab = 'rank' | 'invite'；重复调用安全
 *   window.GinSocial.close()             关闭面板
 *   GinSocial.getUserProfile()  -> Promise<{nickname, avatar}>
 *   GinSocial.getLeaderboard() -> Promise<Array<{rank,nickname,avatar,score}>>
 *   GinSocial.shareInvite(title) -> Promise<void>
 *   额外（非契约，供宿主页接线）：GinSocial.enableShareMenu(title)
 */
(function (global) {
  'use strict';

  /* ============================ 常量 / 设计数据 ============================ */

  var STORAGE_KEY = 'gin_social_profile_v1';
  var DEFAULT_INVITE_TITLE = '一起来玩这个银魂小游戏！';

  // 8 个预设头像：纯 CSS 圆角色块 + 单个汉字，无任何网络图片、无 emoji。
  var AVATARS = [
    { kanji: '銀', color: '#9aa7b5' },
    { kanji: '新', color: '#e8c15a' },
    { kanji: '神', color: '#d84a3b' },
    { kanji: '定', color: '#4a7bd8' },
    { kanji: '沖', color: '#3a9b7d' },
    { kanji: '桂', color: '#b56ad8' },
    { kanji: '土', color: '#c8823b' },
    { kanji: '高', color: '#5ac8d8' }
  ];

  /* ============================ 运行期状态 ============================ */

  var panelBuilt = false;
  var isOpen = false;
  var selectedAvatarIdx = 0;       // 资料编辑器中当前选中的头像下标
  var overlayEl = null;            // 遮罩层 DOM
  var currentProfile = null;       // 最近一次 getUserProfile / 保存后的资料缓存

  /* ============================ 环境检测 ============================ */

  function isWeChat() {
    // 守卫：typeof 检查 + 方法存在性检查，避免任何 wx 调用抛错。
    return typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function';
  }

  /* ============================ 工具函数 ============================ */

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 渲染头像瓦片。avatar 可以是：
  //   - number / 数字字符串 -> 预设色块头像（下标）
  //   - http(s) 字符串       -> <img>（微信环境下 wx 返回的头像 URL）
  function avatarTile(avatar, size, extraClass) {
    size = size || 32;
    var cls = 'gs-avatar' + (extraClass ? ' ' + extraClass : '');
    var fontSize = Math.round(size * 0.46);
    var style = 'width:' + size + 'px;height:' + size + 'px;font-size:' + fontSize + 'px;';

    if (typeof avatar === 'number' || (typeof avatar === 'string' && /^\d+$/.test(avatar))) {
      var idx = parseInt(avatar, 10) || 0;
      if (idx < 0 || idx >= AVATARS.length) idx = 0;
      var a = AVATARS[idx];
      return '<span class="' + cls + '" style="' + style + 'background:' + a.color + '">' + a.kanji + '</span>';
    }
    // 外部 URL（如微信头像）——已做属性转义，避免注入。
    return '<img class="' + cls + '" style="' + style + '" src="' + escapeHtml(avatar) + '" alt="">';
  }

  function toast(msg) {
    var t = document.getElementById('gs-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gs-toast';
      t.className = 'gs-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* ============================ 适配器：资料 ============================ */

  // 浏览器（H5）模式：从 localStorage 读取本地资料。
  function localProfile() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        return {
          nickname: typeof p.nickname === 'string' ? p.nickname : '',
          avatar: typeof p.avatarIdx === 'number' ? p.avatarIdx : 0
        };
      }
    } catch (e) { /* 忽略损坏的存储 */ }
    return { nickname: '', avatar: 0 };
  }

  function wxGetProfile() {
    return new Promise(function (resolve) {
      try {
        // 微信：优先 wx.getUserProfile（需用户触发，返回 userInfo）
        if (typeof wx !== 'undefined' && typeof wx.getUserProfile === 'function') {
          wx.getUserProfile({
            desc: '用于展示你的昵称与头像',
            success: function (res) {
              var u = (res && res.userInfo) || {};
              resolve({
                nickname: u.nickName || u.nickname || '',
                avatar: u.avatarUrl || u.avatar || ''
              });
            },
            fail: function () { resolve(localProfile()); }
          });
          return;
        }
        // 兼容旧接口 wx.getUserInfo
        if (typeof wx !== 'undefined' && typeof wx.getUserInfo === 'function') {
          wx.getUserInfo({
            success: function (res) {
              var u = (res && res.userInfo) || {};
              resolve({
                nickname: u.nickName || '',
                avatar: u.avatarUrl || ''
              });
            },
            fail: function () { resolve(localProfile()); }
          });
          return;
        }
      } catch (e) { /* 任何异常都回退到本地资料 */ }
      resolve(localProfile());
    });
  }

  function getUserProfile() {
    var p;
    if (isWeChat()) {
      return wxGetProfile().then(function (prof) { currentProfile = prof; return prof; });
    }
    // 浏览器模式：返回本地资料（可能为空，由 UI 引导用户填写）
    p = localProfile();
    currentProfile = p;
    return Promise.resolve(p);
  }

  /* ============================ 适配器：排行榜 ============================ */

  function wxGetLeaderboard() {
    return new Promise(function (resolve) {
      try {
        // 微信开放数据域路径（官方文档要求）：
        //   1) 需要一个独立的 open-datacontext/index.js 子包（关系链数据域 sandbox）
        //   2) 通过 wx.getOpenDataContext().postMessage(...) 与主域通信
        //   3) 真实好友数据仅在微信关系链数据域内可见，主域拿不到明文
        // 这里只负责「发请求」，不伪造任何好友数据；拿不到就返回 []。
        if (typeof wx !== 'undefined' && typeof wx.getOpenDataContext === 'function') {
          var ctx = wx.getOpenDataContext();
          ctx.postMessage({ action: 'rank' });
        }
      } catch (e) { /* 忽略 */ }
      resolve([]); // 诚实：没有真实数据就返回空数组，由 UI 展示空状态。
    });
  }

  function getLeaderboard() {
    if (isWeChat()) {
      return wxGetLeaderboard(); // 真实好友需 open-datacontext 子包支持，否则为 []
    }
    // 浏览器模式：永远返回 []，UI 展示「微信环境内可查看好友排行（开放数据域）」。
    return Promise.resolve([]);
  }

  /* ============================ 适配器：邀请 / 分享 ============================ */

  function wxShare(title) {
    return new Promise(function (resolve) {
      try {
        if (typeof wx !== 'undefined' && typeof wx.shareAppMessage === 'function') {
          // imageUrl 传空串：宿主页可后续补图；守卫确保异常不抛出。
          wx.shareAppMessage({ title: title, imageUrl: '' });
        }
      } catch (e) { /* 忽略 */ }
      resolve();
    });
  }

  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) { /* 忽略 */ }
  }

  function shareInvite(title) {
    title = title || DEFAULT_INVITE_TITLE;
    if (isWeChat()) {
      return wxShare(title);
    }
    // 浏览器模式：优先 Web Share API，否则复制链接 + toast。
    return new Promise(function (resolve) {
      var url = global.location.href;
      if (typeof navigator !== 'undefined' && navigator.share) {
        navigator.share({ title: title, url: url })
          .then(function () { resolve(); })
          .catch(function () { resolve(); }); // 用户取消也视为完成
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(
            function () { toast('邀请链接已复制'); resolve(); },
            function () { copyFallback(url); toast('邀请链接已复制'); resolve(); }
          );
          return;
        }
      } catch (e) { /* 落到 execCommand 兜底 */ }
      copyFallback(url);
      toast('邀请链接已复制');
      resolve();
    });
  }

  // 额外钩子：供宿主页在微信中启用「转发」菜单并预设转发内容。
  function enableShareMenu(title) {
    try {
      if (typeof wx !== 'undefined' && typeof wx.showShareMenu === 'function') {
        wx.showShareMenu({ menus: ['shareAppMessage'] });
      }
      if (typeof wx !== 'undefined' && typeof wx.onShareAppMessage === 'function') {
        wx.onShareAppMessage(function () {
          return { title: title || DEFAULT_INVITE_TITLE, imageUrl: '' };
        });
      }
    } catch (e) { /* 忽略 */ }
  }

  /* ============================ UI：自包含 CSS ============================ */

  var CSS = '' +
    '.gs-overlay{' +
    '  --bg:#0b0e14;--panel:#141b28;--line:#2a3550;--gold:#e8c15a;--gold2:#ffd23a;' +
    '  --red:#d84a3b;--paper:#f2ead8;--dim:#8a93ad;' +
    '  --serif:"Hiragino Mincho ProN","Yu Mincho","Noto Serif SC","STSong","SimSun",serif;' +
    '  position:fixed;inset:0;z-index:9999;display:none;' +
    '  align-items:center;justify-content:center;' +
    '  background:rgba(4,6,10,.72);' +
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;' +
    '}' +
    '.gs-panel{' +
    '  width:360px;height:460px;max-width:92vw;max-height:88vh;' +
    '  background:var(--panel);border:1px solid var(--gold);border-radius:16px;' +
    '  display:flex;flex-direction:column;overflow:hidden;color:var(--paper);' +
    '  box-shadow:0 18px 60px rgba(0,0,0,.5);' +
    '}' +
    '.gs-header{' +
    '  display:flex;align-items:center;justify-content:space-between;' +
    '  padding:14px 16px;border-bottom:1px solid var(--line);' +
    '}' +
    '.gs-title{font-family:var(--serif);font-size:20px;color:var(--gold);letter-spacing:2px;}' +
    '.gs-close{' +
    '  background:none;border:none;color:var(--dim);font-size:22px;line-height:1;' +
    '  cursor:pointer;padding:4px 8px;border-radius:8px;' +
    '}' +
    '.gs-close:hover,.gs-close:focus{color:var(--paper);outline:none;}' +
    '.gs-tabs{display:flex;gap:8px;padding:0 16px;border-bottom:1px solid var(--line);}' +
    '.gs-tab{' +
    '  background:none;border:none;color:var(--dim);padding:12px 4px;cursor:pointer;' +
    '  font-size:14px;position:relative;font-family:inherit;' +
    '}' +
    '.gs-tab:hover{color:var(--paper);}' +
    '.gs-tab.active{color:var(--gold);}' +
    '.gs-tab.active::after{' +
    '  content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--gold);' +
    '}' +
    '.gs-body{flex:1;overflow:auto;padding:16px;}' +
    '.gs-tabpane{display:none;}' +
    '.gs-tabpane.active{display:block;}' +
    /* 排行：领奖台 */
    '.gs-podium{display:flex;justify-content:center;align-items:flex-end;gap:10px;margin-bottom:14px;}' +
    '.gs-pod{display:flex;flex-direction:column;align-items:center;gap:4px;width:84px;}' +
    '.gs-pod-av{' +
    '  border-radius:12px;display:flex;align-items:center;justify-content:center;' +
    '  font-family:var(--serif);font-weight:700;color:#0b0e14;line-height:1;' +
    '  background:rgba(138,147,173,.18);' +
    '}' +
    '.gs-pod.pod-1 .gs-pod-av{width:56px;height:56px;font-size:26px;}' +
    '.gs-pod.pod-2 .gs-pod-av,.gs-pod.pod-3 .gs-pod-av{width:44px;height:44px;font-size:21px;}' +
    '.gs-pod-empty .gs-pod-av{border:1px dashed var(--line);color:var(--dim);}' +
    '.gs-pod-name{font-size:12px;color:var(--paper);max-width:80px;' +
    '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.gs-pod-score{font-size:12px;color:var(--gold2);font-variant-numeric:tabular-nums;}' +
    /* 空状态 */
    '.gs-empty{' +
    '  text-align:center;color:var(--dim);font-size:13px;line-height:1.6;' +
    '  padding:10px;border:1px dashed var(--line);border-radius:10px;margin-bottom:12px;' +
    '}' +
    /* 列表行 */
    '.gs-row{' +
    '  display:flex;align-items:center;gap:10px;padding:8px 6px;' +
    '  border-bottom:1px solid rgba(42,53,80,.5);' +
    '}' +
    '.gs-rank{' +
    '  width:28px;text-align:center;font-family:var(--serif);color:var(--gold);font-size:18px;' +
    '  flex:0 0 auto;' +
    '}' +
    '.gs-name{' +
    '  flex:1;color:var(--paper);font-size:14px;' +
    '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    '}' +
    '.gs-score{color:var(--gold2);font-variant-numeric:tabular-nums;font-size:14px;flex:0 0 auto;}' +
    '.gs-row-own{background:rgba(232,193,90,.08);border-radius:8px;margin-top:4px;}' +
    /* 头像瓦片（含 img 形态） */
    '.gs-avatar{' +
    '  display:inline-flex;align-items:center;justify-content:center;border-radius:8px;' +
    '  color:#0b0e14;font-family:var(--serif);font-weight:700;flex:0 0 auto;' +
    '  object-fit:cover;' +
    '}' +
    /* 邀请 */
    '.gs-invite-desc{color:var(--dim);font-size:13px;line-height:1.7;margin:0 0 16px;}' +
    '.gs-btn{' +
    '  display:block;width:100%;padding:14px;border:none;border-radius:12px;cursor:pointer;' +
    '  background:linear-gradient(180deg,var(--gold2),var(--gold));color:#0b0e14;' +
    '  font-size:16px;font-weight:700;font-family:inherit;' +
    '}' +
    '.gs-btn:active{transform:translateY(1px);}' +
    '.gs-note{color:var(--dim);font-size:12px;margin:10px 0 0;text-align:center;line-height:1.6;}' +
    /* 我的资料（折叠） */
    '.gs-profile{border-top:1px solid var(--line);margin-top:18px;padding-top:12px;}' +
    '.gs-profile-toggle{' +
    '  cursor:pointer;color:var(--gold);font-size:14px;font-family:var(--serif);' +
    '  list-style:none;outline:none;' +
    '}' +
    '.gs-profile-toggle::-webkit-details-marker{display:none;}' +
    '.gs-profile-toggle::before{content:"▸ ";color:var(--dim);}' +
    '.gs-profile[open] .gs-profile-toggle::before{content:"▾ ";}' +
    '.gs-profile-body{padding-top:12px;}' +
    '.gs-field{margin:10px 0;}' +
    '.gs-label{color:var(--dim);font-size:12px;display:block;margin-bottom:6px;}' +
    '.gs-input{' +
    '  width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);' +
    '  border-radius:8px;color:var(--paper);padding:10px;font-size:14px;font-family:inherit;' +
    '}' +
    '.gs-input:focus{outline:none;border-color:var(--gold);}' +
    '.gs-avatars{display:flex;flex-wrap:wrap;gap:8px;}' +
    '.gs-av-opt{' +
    '  width:40px;height:40px;border-radius:10px;display:flex;align-items:center;' +
    '  justify-content:center;font-family:var(--serif);font-weight:700;color:#0b0e14;' +
    '  cursor:pointer;border:2px solid transparent;box-sizing:border-box;' +
    '}' +
    '.gs-av-opt.sel{border-color:var(--gold2);box-shadow:0 0 0 2px rgba(255,210,58,.3);}' +
    '.gs-save{margin-top:6px;padding:12px;font-size:15px;}' +
    /* toast */
    '.gs-toast{' +
    '  position:fixed;left:50%;bottom:40px;transform:translateX(-50%);' +
    '  background:rgba(20,27,40,.96);border:1px solid var(--gold);color:var(--paper);' +
    '  padding:10px 18px;border-radius:20px;font-size:13px;z-index:10000;' +
    '  opacity:0;transition:opacity .25s;pointer-events:none;' +
    '}' +
    '.gs-toast.show{opacity:1;}';

  /* ============================ UI：面板结构 ============================ */

  var PANEL_HTML = '' +
    '<div class="gs-panel" role="dialog" aria-modal="true" aria-label="好友">' +
      '<div class="gs-header">' +
        '<span class="gs-title">好友</span>' +
        '<button class="gs-close" id="gs-close" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="gs-tabs">' +
        '<button class="gs-tab active" id="gs-tab-rank" data-tab="rank">好友排行</button>' +
        '<button class="gs-tab" id="gs-tab-invite" data-tab="invite">邀请好友</button>' +
      '</div>' +
      '<div class="gs-body">' +
        '<div class="gs-tabpane active" id="gs-pane-rank">' +
          '<div class="gs-podium" id="gs-podium"></div>' +
          '<div class="gs-empty" id="gs-rank-empty">微信环境内可查看好友排行（开放数据域）</div>' +
          '<div class="gs-list" id="gs-rank-list"></div>' +
        '</div>' +
        '<div class="gs-tabpane" id="gs-pane-invite">' +
          '<p class="gs-invite-desc">邀请好友一起玩，组队刷本、比拼战力。' +
            '在微信中可直接转发给好友或群聊。</p>' +
          '<button class="gs-btn" id="gs-invite-btn">立即邀请</button>' +
          '<p class="gs-note">微信环境内将使用微信转发；浏览器中可复制链接分享。</p>' +
          '<details class="gs-profile" id="gs-profile">' +
            '<summary class="gs-profile-toggle">我的资料</summary>' +
            '<div class="gs-profile-body">' +
              '<div class="gs-field">' +
                '<label class="gs-label" for="gs-nick">昵称（最多 12 字）</label>' +
                '<input class="gs-input" id="gs-nick" maxlength="12" placeholder="输入昵称" autocomplete="off">' +
              '</div>' +
              '<div class="gs-field">' +
                '<span class="gs-label">选择头像</span>' +
                '<div class="gs-avatars" id="gs-avatars"></div>' +
              '</div>' +
              '<button class="gs-btn gs-save" id="gs-save-profile">保存资料</button>' +
            '</div>' +
          '</details>' +
        '</div>' +
      '</div>' +
    '</div>';

  /* ============================ UI：渲染逻辑 ============================ */

  function rowHtml(r) {
    return '<div class="gs-row' + (r.own ? ' gs-row-own' : '') + '">' +
      '<span class="gs-rank">' + escapeHtml(r.rank) + '</span>' +
      avatarTile(r.avatar, 32) +
      '<span class="gs-name">' + escapeHtml(r.nickname || '') + '</span>' +
      '<span class="gs-score">' + escapeHtml(String(r.score != null ? r.score : 0)) + '</span>' +
      '</div>';
  }

  function podiumHtml(rows) {
    var slots = [2, 1, 3]; // 展示顺序：亚、冠、季
    return slots.map(function (pos) {
      var r = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].rank === pos) { r = rows[i]; break; }
      }
      if (r) {
        return '<div class="gs-pod pod-' + pos + '">' +
          '<div class="gs-pod-av">' + avatarTile(r.avatar, pos === 1 ? 56 : 44) + '</div>' +
          '<div class="gs-pod-name">' + escapeHtml(r.nickname || '') + '</div>' +
          '<div class="gs-pod-score">' + escapeHtml(String(r.score != null ? r.score : 0)) + '</div>' +
          '</div>';
      }
      return '<div class="gs-pod pod-' + pos + ' gs-pod-empty">' +
        '<div class="gs-pod-av">？</div>' +
        '<div class="gs-pod-name">暂无</div>' +
        '</div>';
    }).join('');
  }

  function renderRank() {
    var podium = document.getElementById('gs-podium');
    var empty = document.getElementById('gs-rank-empty');
    var list = document.getElementById('gs-rank-list');
    if (!podium || !list) return;

    getLeaderboard().then(function (rows) {
      podium.innerHTML = podiumHtml(rows || []);

      var prof = currentProfile || localProfile();
      var ownRow = {
        rank: '—',
        nickname: prof.nickname || '我',
        avatar: prof.avatar,
        score: 0,
        own: true
      };

      if (!rows || !rows.length) {
        if (empty) empty.style.display = '';
        list.innerHTML = rowHtml(ownRow); // 仅展示「自己」这一行，布局可见
      } else {
        if (empty) empty.style.display = 'none';
        var html = '';
        for (var i = 0; i < rows.length; i++) html += rowHtml(rows[i]);
        html += rowHtml(ownRow); // 自己固定在底部
        list.innerHTML = html;
      }
    });
  }

  function buildAvatarOptions() {
    var wrap = document.getElementById('gs-avatars');
    if (!wrap) return;
    wrap.innerHTML = AVATARS.map(function (a, i) {
      return '<span class="gs-av-opt" data-idx="' + i + '" style="background:' + a.color + '">' + a.kanji + '</span>';
    }).join('');
    var opts = wrap.querySelectorAll('.gs-av-opt');
    for (var i = 0; i < opts.length; i++) {
      opts[i].addEventListener('click', function () {
        selectedAvatarIdx = parseInt(this.getAttribute('data-idx'), 10);
        for (var j = 0; j < opts.length; j++) opts[j].classList.remove('sel');
        this.classList.add('sel');
      });
    }
  }

  // 把已保存（或默认）资料同步到资料编辑器，并在首次无资料时自动展开。
  function syncProfileUI() {
    var p = localProfile();
    var nick = document.getElementById('gs-nick');
    if (nick && !nick.value) nick.value = p.nickname || '';
    selectedAvatarIdx = (typeof p.avatar === 'number') ? p.avatar : 0;

    var wrap = document.getElementById('gs-avatars');
    if (wrap) {
      var opts = wrap.querySelectorAll('.gs-av-opt');
      for (var i = 0; i < opts.length; i++) {
        var idx = parseInt(opts[i].getAttribute('data-idx'), 10);
        if (idx === selectedAvatarIdx) opts[i].classList.add('sel');
        else opts[i].classList.remove('sel');
      }
    }
    var details = document.getElementById('gs-profile');
    if (details && !p.nickname) details.setAttribute('open', ''); // 首次无昵称 -> 自动展开表单
  }

  function saveProfile() {
    var nick = document.getElementById('gs-nick');
    var name = (nick && nick.value ? nick.value : '').trim().slice(0, 12);
    if (!name) { toast('请先输入昵称'); if (nick) nick.focus(); return; }
    var data = { nickname: name, avatarIdx: selectedAvatarIdx };
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
    currentProfile = { nickname: name, avatar: selectedAvatarIdx };
    toast('资料已保存');
    renderRank(); // 立即刷新排行里「自己」这行
  }

  /* ============================ UI：标签切换 / 打开 / 关闭 ============================ */

  function switchTab(tab) {
    tab = (tab === 'invite') ? 'invite' : 'rank';
    var tabs = ['rank', 'invite'];
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var btn = document.getElementById('gs-tab-' + t);
      var pane = document.getElementById('gs-pane-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
      if (pane) pane.classList.toggle('active', t === tab);
    }
    if (tab === 'rank') renderRank();
    if (tab === 'invite') syncProfileUI();
  }

  function buildPanel() {
    if (panelBuilt) return;
    var style = document.createElement('style');
    style.id = 'gs-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    overlayEl = document.createElement('div');
    overlayEl.className = 'gs-overlay';
    overlayEl.id = 'gs-overlay';
    overlayEl.innerHTML = PANEL_HTML;
    document.body.appendChild(overlayEl);

    // 关闭按钮
    var closeBtn = document.getElementById('gs-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    // 点击遮罩（非面板）关闭
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) close();
    });
    // 标签
    var rankTab = document.getElementById('gs-tab-rank');
    var inviteTab = document.getElementById('gs-tab-invite');
    if (rankTab) rankTab.addEventListener('click', function () { switchTab('rank'); });
    if (inviteTab) inviteTab.addEventListener('click', function () { switchTab('invite'); });
    // 邀请按钮
    var inviteBtn = document.getElementById('gs-invite-btn');
    if (inviteBtn) inviteBtn.addEventListener('click', function () {
      shareInvite(DEFAULT_INVITE_TITLE);
    });
    // 保存资料
    var saveBtn = document.getElementById('gs-save-profile');
    if (saveBtn) saveBtn.addEventListener('click', saveProfile);

    buildAvatarOptions();

    // Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) close();
    });

    panelBuilt = true;
  }

  function open(tab) {
    if (typeof document === 'undefined') return; // 非浏览器环境直接跳过
    buildPanel();
    if (isOpen) { switchTab(tab); return; } // 重复调用安全：仅切换标签，不重复构建
    isOpen = true;
    overlayEl.style.display = 'flex';
    switchTab(tab);
    syncProfileUI();
    var closeBtn = document.getElementById('gs-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!panelBuilt || !isOpen) return;
    isOpen = false;
    overlayEl.style.display = 'none';
  }

  /* ============================ 导出公共契约 ============================ */

  global.GinSocial = {
    open: open,
    close: close,
    getUserProfile: getUserProfile,
    getLeaderboard: getLeaderboard,
    shareInvite: shareInvite,
    enableShareMenu: enableShareMenu // 额外钩子：宿主页微信转发接线
  };

  // 微信环境：自动为宿主页开启转发菜单（可选，不影响主域运行）。
  if (isWeChat()) {
    enableShareMenu(DEFAULT_INVITE_TITLE);
  }

})(typeof window !== 'undefined' ? window : this);
