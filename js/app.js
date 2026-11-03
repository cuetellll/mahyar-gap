/**
 * Mahyar Gap — application controller.
 * Auth, servers, RBAC, text/announcement/forum/voice channels, persistent messaging,
 * reactions, replies, pins, threads, friends/DMs, LiveKit voice/video/screen share.
 */

const PERMISSION_CATALOG = [
  { key: 'ADMINISTRATOR', label: 'Administrator', desc: 'Grants all server permissions. Only the server owner may assign this permission.' },
  { key: 'MANAGE_SERVER', label: 'Manage Server', desc: 'Allows editing server overview settings. Server deletion remains owner-only.' },
  { key: 'MANAGE_ROLES', label: 'Manage Roles', desc: 'Allows creating, editing, deleting, and assigning roles. Privileged roles remain owner-only.' },
  { key: 'MANAGE_CHANNELS', label: 'Manage Channels', desc: 'Allows creating and deleting channels.' },
  { key: 'KICK_MEMBERS', label: 'Kick Members', desc: 'Allows removing members from the server.' },
  { key: 'BAN_MEMBERS', label: 'Ban Members', desc: 'Allows permanently banning users from rejoining the server.' },
  { key: 'MANAGE_MESSAGES', label: 'Manage Messages', desc: 'Allows editing or deleting other members’ messages.' },
  { key: 'SEND_MESSAGES', label: 'Send Messages', desc: 'Allows sending text messages and replies in text channels.' },
  { key: 'CONNECT_VOICE', label: 'Connect to Voice', desc: 'Allows joining voice and video channels.' },
  { key: 'SPEAK_VOICE', label: 'Speak in Voice', desc: 'Allows transmitting microphone audio in voice channels.' },
  { key: 'STREAM_VIDEO', label: 'Video & Screen Share', desc: 'Allows publishing camera and screen tracks in LiveKit voice channels.' },
  { key: 'VIEW_CHANNELS', label: 'View Channels', desc: 'Allows viewing channels and their messages.' },
  { key: 'VIEW_AUDIT_LOG', label: 'View Audit Log', desc: 'Allows viewing administrative audit records.' }
];

const QUICK_EMOJIS = ['🚀', '🔥', '👍', '❤️', '🎉', '⚡', '👀', '💯', '✅', '🎧', '🛡️', '💜'];
const DELEGATED_ACTIONS = new Set([
  'acceptFriendRequest', 'appendEmojiToInput', 'banServerMember', 'blockFriendRow', 'cancelEditMessage', 'cancelReply',
  'changeMediaDevice', 'closeModal', 'closeModalAndStartDm', 'closeThread', 'copyInviteCode', 'createCustomDmConversation',
  'createNewChannel', 'createNewRole', 'createNewServer', 'deleteChannel', 'deleteCurrentServer', 'deleteMessage',
  'endDirectVideoCall', 'handleDisconnectVoice', 'handleToggleCamera', 'handleToggleDeafen', 'handleToggleMute',
  'handleToggleScreenShare', 'insertQuickPhrase', 'joinOrFocusVoiceChannel', 'joinServerByInvite', 'kickServerMember',
  'leaveCurrentServer', 'loadMoreMessages', 'logout', 'markAllNotificationsRead', 'openCreateChannelModal',
  'openFriendsView', 'openModal', 'openThread', 'openUserProfileModal', 'removeFriendRow', 'removePendingAttachment',
  'requestFullscreenStage', 'saveEditedMessage', 'saveRoleChanges', 'saveServerOverview', 'saveUserProfileSettings',
  'selectChannel', 'selectDmConversation', 'selectRoleForEdit', 'selectServer', 'sendFriendRequest',
  'sendFriendRequestById', 'sendMessage', 'sendThreadReply', 'setBlueprintTab', 'setFriendsFilter',
  'setServerSettingsTab', 'startDirectVideoCall', 'startDmWithUser', 'startEditMessage', 'startReply', 'switchToDMs',
  'toggleMemberSidebar', 'toggleMobileDrawer', 'toggleNotificationsPopover', 'togglePinMessage', 'togglePinnedPopover',
  'toggleReaction', 'toggleSelectedMemberRole', 'toggleTheme', 'updateSearchQuery', 'toggleEmojiPicker',
  'acceptIncomingCall', 'declineIncomingCall', 'closeContextMenu', 'copyUserId', 'toggleUserLocalMute',
  'setParticipantVolume', 'startDmFromContextMenu', 'selectRegistrationAvatar', 'handleAvatarFileSelect',
  'removeAvatar', 'setTheme', 'setMotion', 'openUserContextMenu'
]);

class MahyarGapApp {
  constructor() {
    this.api = window.pulseAPI;
    this.presenceKnown = false;
    this.lastTypingSent = 0;
    this.state = {
      theme: localStorage.getItem('mahyar_gap_theme') || localStorage.getItem('pulsecord_theme') || 'dark',
      motion: localStorage.getItem('mahyar_gap_motion') || 'full',
      currentUserId: localStorage.getItem('mahyar_gap_current_user_id') || localStorage.getItem('pulsecord_current_user_id') || 'usr_alex',
      onlineUserIds: new Set(),
      typingByContext: new Map(),
      lastRead: this.readLastReadMap(),
      incomingCall: null,
      contextMenu: null,
      mobileDrawerOpen: false,
      avatarDraft: null,
      viewMode: 'server', // 'server' | 'dms'
      activeServerId: 'srv_main',
      activeChannelId: 'chn_general',
      activeDmConversationId: 'dm_alex_elena',
      dmSubView: 'friends', // 'friends' | 'conversation'
      friendsFilter: 'online', // 'online' | 'all' | 'pending' | 'blocked' | 'add'

      // Loaded database tables
      users: [],
      servers: [],
      roles: [],
      serverMembers: [],
      channels: [],
      messages: [],
      directMessages: [],
      friends: [],
      voiceSessions: [],
      auditLogs: [],
      notifications: [],

      // UI state
      replyingToMessage: null,
      editingMessageId: null,
      pendingAttachments: [],
      searchQuery: '',
      messagePageLimit: 25,
      showMemberList: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
      showPinnedPopover: false,
      showNotificationsPopover: false,
      activeThreadMessage: null,
      voiceStageExpanded: false,
      activeCallBanner: null, // For 1-on-1 or Group DM video call

      // Server settings modal state
      activeModal: null,
      serverSettingsTab: 'overview',
      selectedRoleIdForEdit: null,
      blueprintTab: 'prisma'
    };

    this.rtc = new window.PulseWebRTCEngine((rtcState, eventType) => {
      this.onWebRTCStateChange(rtcState, eventType);
    });
    this.api.onEvent(async (packet) => {
      if (!this.api.token() || !this.state.currentUserId) return;
      if (packet?.type === 'socket_connected') {
        if (this.state.channels.some((channel) => channel.id === this.state.activeChannelId)) this.api.joinChannel(this.state.activeChannelId);
        return;
      }
      if (packet?.type === 'presence_update') {
        const ids = Array.isArray(packet.payload?.userIds) ? packet.payload.userIds : [];
        this.state.onlineUserIds = new Set(ids.map(String));
        this.presenceKnown = true;
        this.renderServerRail();
        this.renderLeftSidebar();
        this.renderRightSidebar();
        this.renderUserControlPanel();
        this.renderTopHeader();
        return;
      }
      if (packet?.type === 'typing_update' || packet?.type === 'dm_typing') {
        const contextId = packet.type === 'typing_update' ? packet.payload?.channelId : packet.payload?.conversationId;
        const userId = packet.payload?.userId;
        if (!contextId || !userId || userId === this.state.currentUserId) return;
        const key = packet.type === 'typing_update' ? `channel:${contextId}` : `dm:${contextId}`;
        if (!this.state.typingByContext.has(key)) this.state.typingByContext.set(key, new Map());
        this.state.typingByContext.get(key).set(userId, Date.now());
        this.updateTypingIndicator();
        return;
      }
      if (packet?.type === 'dm_call_started') {
        const conversationId = packet.payload?.conversationId;
        if (!conversationId || packet.payload?.startedBy === this.state.currentUserId) return;
        if (this.rtc.mode === 'dm' && this.rtc.activeDmConversationId === conversationId) return;
        this.state.incomingCall = { conversationId, startedBy: packet.payload.startedBy };
        this.renderMainStage();
        this.showToast(`${this.getUserById(packet.payload.startedBy).display_name || 'Someone'} started a call in a conversation.`, 'info');
        return;
      }
      if (packet?.type === 'dm_call_ended') {
        if (this.state.incomingCall?.conversationId === packet.payload?.conversationId) {
          this.state.incomingCall = null;
          this.renderMainStage();
        }
        return;
      }
      if (packet?.type === 'server_membership_revoked' && packet.payload?.server_id === this.state.activeServerId) {
        if (this.rtc.room || this.rtc.activeChannelId) await this.rtc.leaveVoiceChannel().catch(() => {});
        this.api.joinChannel(null);
        this.state.activeServerId = null;
        this.state.activeChannelId = null;
        this.state.viewMode = 'dms';
        this.state.dmSubView = 'friends';
        await this.loadAllData();
        this.renderAll();
        this.showToast('Your access to this server was removed.', 'error');
        return;
      }
      if (this.applyRealtimePacket(packet)) {
        this.renderAll();
        return;
      }
      await this.loadAllData();
      this.renderAll();
    });
    window.addEventListener('mahyar_gap:auth-expired', () => this.logout());
    window.addEventListener('pulsecord:auth-expired', () => this.logout());
  }

  async init() {
    document.documentElement.setAttribute('data-theme', this.state.theme);
    this.bindGlobalEvents();
    if (!this.api.token()) {
      this.renderAuthScreen();
      return;
    }
    try {
      const user = await this.api.me();
      this.state.currentUserId = user.id;
      localStorage.setItem('mahyar_gap_current_user_id', user.id);
    } catch (err) {
      this.api.logout();
      this.renderAuthScreen(err.message);
      return;
    }
    await this.loadAllData();
    this.api.connectRealtime();
    this.renderAll();
    if (this.state.channels.some((channel) => channel.id === this.state.activeChannelId)) this.api.joinChannel(this.state.activeChannelId);
  }

  renderAuthScreen(message = '') {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="auth-shell fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <form id="auth-form" class="auth-card w-full max-w-md p-7 space-y-4 text-white my-auto">
          <div class="flex items-center gap-3">
            <div class="auth-logo">MG</div>
            <div>
              <h1 class="text-2xl font-extrabold tracking-tight">Mahyar <span class="bg-clip-text text-transparent" style="background-image: linear-gradient(120deg, #a78bfa, #22d3ee)">Gap</span></h1>
              <p class="text-xs text-white/55 mt-0.5">Talk, share and stay close — real-time channels, calls and presence.</p>
            </div>
          </div>

          <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
            <div id="auth-avatar-preview" class="w-14 h-14 rounded-full overflow-hidden bg-white/10 grid place-items-center text-lg font-bold shrink-0">MG</div>
            <div class="min-w-0">
              <label class="auth-secondary inline-flex items-center gap-1.5 cursor-pointer text-[11px] px-2.5 py-1.5">
                <i class="fa-solid fa-image"></i> Choose avatar
                <input id="auth-avatar-input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-action="selectRegistrationAvatar" data-action-event="change" data-action-args="[]" />
              </label>
              <p class="text-[10px] text-white/45 mt-1">Optional. Cropped to a square and stored with your account.</p>
            </div>
          </div>

          <p id="auth-error" class="${message ? '' : 'hidden'} text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">${this.escapeHtml(message)}</p>

          <div class="grid grid-cols-1 gap-3">
            <label class="block text-[11px] font-semibold text-white/60">Username <span class="text-white/35 font-normal">(3-32 characters)</span>
              <input id="auth-username" autocomplete="username" class="auth-input" placeholder="your_username" />
            </label>
            <label class="block text-[11px] font-semibold text-white/60">Display name
              <input id="auth-display" autocomplete="name" class="auth-input" placeholder="How others see you" />
            </label>
            <label class="block text-[11px] font-semibold text-white/60">Email
              <input id="auth-email" type="email" required autocomplete="email" class="auth-input" placeholder="you@example.com" />
            </label>
            <label class="block text-[11px] font-semibold text-white/60">Password <span class="text-white/35 font-normal">(12+ characters)</span>
              <input id="auth-password" type="password" minlength="12" required autocomplete="current-password" class="auth-input" placeholder="••••••••••••" />
            </label>
          </div>

          <div class="flex gap-2 pt-1">
            <button type="submit" data-auth-mode="login" class="auth-primary flex-1">Sign in</button>
            <button type="submit" data-auth-mode="register" class="auth-secondary flex-1">Create account</button>
          </div>
          <p class="text-[10px] text-white/35 text-center">Secure sessions • LiveKit-powered voice, video and screen share</p>
        </form>
      </div>
    `;
    const form = document.getElementById('auth-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const mode = event.submitter?.dataset.authMode || 'login';
      const errorEl = document.getElementById('auth-error');
      errorEl.classList.add('hidden');
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      try {
        const user = mode === 'register'
          ? await this.api.register({ username: document.getElementById('auth-username').value.trim(), display_name: document.getElementById('auth-display').value.trim() || document.getElementById('auth-username').value.trim(), email, password, avatar_url: this.state.avatarDraft || undefined })
          : await this.api.login(email, password);
        this.state.currentUserId = user.id;
        this.state.avatarDraft = null;
        localStorage.setItem('mahyar_gap_current_user_id', user.id);
        await this.loadAllData();
        this.api.connectRealtime();
        this.bindGlobalEvents();
        this.renderAll();
        if (this.state.channels.some((channel) => channel.id === this.state.activeChannelId)) this.api.joinChannel(this.state.activeChannelId);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  readLastReadMap() {
    try {
      const parsed = JSON.parse(localStorage.getItem('mahyar_gap_last_read') || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const clean = {};
      for (const [id, stamp] of Object.entries(parsed)) {
        const value = Number(stamp);
        if (id && Number.isFinite(value)) clean[id] = value;
      }
      return clean;
    } catch (_) { return {}; }
  }

  saveLastReadMap() {
    try { localStorage.setItem('mahyar_gap_last_read', JSON.stringify(this.state.lastRead)); } catch (_) { /* storage may be blocked */ }
  }

  markChannelRead(channelId) {
    if (!channelId) return;
    this.state.lastRead[channelId] = Date.now();
    this.saveLastReadMap();
    this.renderLeftSidebar();
    this.renderServerRail();
    this.updateDocumentTitle();
  }

  getUnreadCount(channelId) {
    const since = this.state.lastRead[channelId] || 0;
    return this.state.messages.filter((m) => m.channel_id === channelId && m.user_id !== this.state.currentUserId && new Date(m.timestamp_iso || m.created_at || 0).getTime() > since).length;
  }

  getServerUnread(serverId) {
    return this.state.channels.filter((c) => c.server_id === serverId).reduce((total, channel) => total + this.getUnreadCount(channel.id), 0);
  }

  updateDocumentTitle() {
    const channelUnread = this.state.channels.reduce((total, channel) => total + this.getUnreadCount(channel.id), 0);
    document.title = channelUnread > 0 ? `(${channelUnread}) Mahyar Gap` : 'Mahyar Gap — Talk, share and stay close';
  }

  effectiveStatus(user) {
    if (!user) return 'offline';
    const stored = this.safeStatus(user.status);
    if (!this.presenceKnown) return stored;
    if (!this.state.onlineUserIds.has(user.id)) return 'offline';
    return stored === 'idle' || stored === 'dnd' ? stored : 'online';
  }

  async loadAllData() {
    try {
      const [
        users,
        servers,
        roles,
        serverMembers,
        channels,
        messages,
        directMessages,
        friends,
        voiceSessions,
        auditLogs,
        notifications
      ] = await Promise.all([
        this.api.list('users', { limit: 100 }),
        this.api.list('servers', { limit: 100 }),
        this.api.list('roles', { limit: 100 }),
        this.api.list('server_members', { limit: 200 }),
        this.api.list('channels', { limit: 200 }),
        this.api.list('messages', { limit: 200 }),
        this.api.list('direct_messages', { limit: 200 }),
        this.api.list('friends', { limit: 100 }),
        this.api.list('voice_sessions', { limit: 100 }),
        this.api.list('audit_logs', { limit: 100 }),
        this.api.list('notifications', { limit: 100 })
      ]);

      this.state.users = users;
      this.state.servers = servers;
      this.state.roles = roles;
      this.state.serverMembers = serverMembers;
      this.state.channels = channels.sort((a, b) => (a.position || 0) - (b.position || 0));
      this.state.messages = messages.sort((a, b) => new Date(a.timestamp_iso || a.created_at || 0) - new Date(b.timestamp_iso || b.created_at || 0));
      this.state.directMessages = directMessages.sort((a, b) => new Date(a.timestamp_iso || a.created_at || 0) - new Date(b.timestamp_iso || b.created_at || 0));
      this.state.friends = friends.map((friend) => friend.status === 'pending'
        ? { ...friend, status: friend.friend_id === this.state.currentUserId ? 'pending_incoming' : 'pending_outgoing' }
        : friend);
      this.state.voiceSessions = voiceSessions;
      this.state.auditLogs = auditLogs.sort((a, b) => new Date(b.timestamp_iso || b.created_at || 0) - new Date(a.timestamp_iso || a.created_at || 0));
      this.state.notifications = notifications.sort((a, b) => new Date(b.timestamp_iso || b.created_at || 0) - new Date(a.timestamp_iso || a.created_at || 0));

      // Validate currentUserId exists
      if (!this.state.users.some((u) => u.id === this.state.currentUserId) && this.state.users.length > 0) {
        this.state.currentUserId = this.state.users[0].id;
        localStorage.setItem('mahyar_gap_current_user_id', this.state.currentUserId);
      }

      // Ensure activeServerId is one the user belongs to
      const myServers = this.getMyServers();
      if (myServers.length > 0 && !myServers.some((s) => s.id === this.state.activeServerId)) {
        this.state.activeServerId = myServers[0].id;
      }

      // Ensure activeChannelId belongs to activeServerId
      const srvChannels = this.state.channels.filter((c) => c.server_id === this.state.activeServerId);
      if (srvChannels.length > 0 && !srvChannels.some((c) => c.id === this.state.activeChannelId)) {
        this.state.activeChannelId = srvChannels[0].id;
      }
    } catch (err) {
      console.error('Failed loading tables:', err);
      this.showToast('Database synchronization warning: ' + err.message, 'error');
    }
  }

  applyRealtimePacket(packet) {
    const type = packet?.type;
    const payload = packet?.payload;
    const supported = new Set(['message_new', 'message_updated', 'message_deleted', 'direct_message_new', 'direct_message_updated', 'direct_message_deleted', 'voice_updated']);
    if (!payload || !supported.has(type)) return false;

    const isDirect = type.startsWith('direct_message_');
    const isVoice = type === 'voice_updated';
    const collection = isDirect ? this.state.directMessages : isVoice ? this.state.voiceSessions : this.state.messages;
    if (type.endsWith('_deleted') || (isVoice && payload.removed)) {
      const remaining = isVoice && payload.removed
        ? collection.filter((row) => !(row.channel_id === payload.channel_id && row.user_id === payload.user_id))
        : collection.filter((row) => row.id !== payload.id);
      if (isDirect) this.state.directMessages = remaining;
      else if (isVoice) this.state.voiceSessions = remaining;
      else this.state.messages = remaining;
      return true;
    }

    if (type === 'message_new' && payload.channel_id === this.state.activeChannelId && document.hasFocus()) this.markChannelRead(payload.channel_id);
    const index = collection.findIndex((row) => row.id === payload.id);
    const next = index < 0
      ? [...collection, payload]
      : collection.map((row, rowIndex) => rowIndex === index ? { ...row, ...payload } : row);
    if (isDirect) this.state.directMessages = next;
    else if (isVoice) this.state.voiceSessions = next;
    else this.state.messages = next;
    return true;
  }

  // =========================================================================
  // Helper Getters & RBAC Permission Evaluator
  // =========================================================================

  getCurrentUser() {
    const found = this.state.users.find((u) => u.id === this.state.currentUserId) || this.state.users[0];
    if (found) return { ...found, status: this.effectiveStatus(found) };
    return {
      id: 'usr_alex',
      username: 'alex_rivera',
      display_name: 'Alex Rivera',
      discriminator: '0001',
      status: 'offline',
      avatar_color: '#7C5CFF',
      avatar_icon: 'fa-user-astronaut'
    };
  }

  getUserById(userId) {
    const found = this.state.users.find((u) => u.id === userId);
    if (found) return { ...found, status: this.effectiveStatus(found) };
    return {
      id: userId,
      username: 'unknown_user',
      display_name: 'Unknown User',
      discriminator: '0000',
      status: 'offline',
      avatar_color: '#80848e',
      avatar_icon: 'fa-user'
    };
  }

  /** Avatar markup shared by every surface: uploaded image when present, initials otherwise. */
  avatarHtml(user, options = {}) {
    const size = options.size || 'w-9 h-9';
    const text = options.text || 'text-sm';
    const showStatus = Boolean(options.status);
    const name = (user && (user.display_name || user.username)) || 'Member';
    const color = this.safeColor(user && user.avatar_color, '#7C5CFF');
    const initials = String(name).trim().slice(0, 1).toUpperCase() || 'M';
    const avatarUrl = user && typeof user.avatar_url === 'string' && /^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(user.avatar_url) ? user.avatar_url : '';
    const ring = options.ring ? ` ${options.ring}` : '';
    return `<div class="avatar-frame ${size} rounded-full ${ring} ${text} font-bold text-white relative overflow-hidden" style="background-color: ${color}" data-user-identity="${this.escapeAttr(user ? user.id : '')}">${avatarUrl ? `<img class="avatar-img" src="${this.escapeAttr(avatarUrl)}" alt="${this.escapeAttr(name)}" loading="lazy" />` : `<span aria-hidden="true">${this.escapeHtml(initials)}</span>`}${showStatus ? `<span class="status-dot status-${this.safeStatus(user && user.status)} absolute -bottom-0.5 -right-0.5"></span>` : ''}</div>`;
  }

  safeColor(value, fallback) {
    const color = String(value || '');
    return /^#[\da-f]{3,8}$/i.test(color) || /^var\(--[a-z\d-]+\)$/i.test(color) ? color : fallback;
  }

  safeIcon(value, fallback = 'fa-user') {
    const icon = String(value || '');
    return /^fa-[a-z\d-]{1,64}$/i.test(icon) ? icon : fallback;
  }

  safeStatus(value) {
    const status = String(value || '').toLowerCase();
    return ['online', 'idle', 'offline', 'dnd'].includes(status) ? status : 'offline';
  }

  getMyServers() {
    const memberServerIds = new Set(
      this.state.serverMembers
        .filter((m) => m.user_id === this.state.currentUserId)
        .map((m) => m.server_id)
    );
    return this.state.servers.filter((s) => memberServerIds.has(s.id) || s.owner_id === this.state.currentUserId);
  }

  getActiveServer() {
    return this.state.servers.find((s) => s.id === this.state.activeServerId) || this.state.servers[0];
  }

  getActiveChannel() {
    return this.state.channels.find((c) => c.id === this.state.activeChannelId) || null;
  }

  /** Live identities from LiveKit, or an empty list when this client is not in that room. */
  getLiveVoiceParticipantIds(channelId) {
    if (!this.rtc.room || this.rtc.mode !== 'voice' || this.rtc.activeChannelId !== channelId || this.rtc.connectionStatus !== 'connected') return [];
    return [this.rtc.room.localParticipant.identity, ...Array.from(this.rtc.room.remoteParticipants.keys())];
  }

  /**
   * Voice presence for a channel. When this client is connected to the room, LiveKit is the
   * source of truth. Otherwise the persisted join/leave rows are shown (never fabricated users).
   */
  getVoiceParticipants(channelId) {
    const sessions = this.state.voiceSessions.filter((session) => session.channel_id === channelId);
    const liveIds = this.getLiveVoiceParticipantIds(channelId);
    if (!liveIds.length) {
      return sessions.map((session) => ({
        ...session,
        muted: Boolean(session.muted),
        deafened: Boolean(session.deafened),
        video_enabled: Boolean(session.video_enabled),
        screen_sharing: Boolean(session.screen_sharing),
        live: false
      }));
    }
    return liveIds.map((identity) => {
      const session = sessions.find((row) => row.user_id === identity);
      const meta = this.rtc.getParticipantState(identity);
      return {
        id: session ? session.id : `live_${identity}`,
        user_id: identity,
        channel_id: channelId,
        muted: meta ? meta.muted : Boolean(session && session.muted),
        deafened: Boolean(session && session.deafened),
        video_enabled: meta ? meta.camera : Boolean(session && session.video_enabled),
        screen_sharing: meta ? meta.screen : Boolean(session && session.screen_sharing),
        speaking: meta ? meta.speaking : false,
        quality: meta ? meta.quality : 'unknown',
        live: true
      };
    });
  }

  getUserRolesInServer(userId, serverId) {
    const membership = this.state.serverMembers.find((m) => m.server_id === serverId && m.user_id === userId);
    const roleIds = membership && Array.isArray(membership.role_ids) ? membership.role_ids : [];
    const roles = this.state.roles
      .filter((r) => r.server_id === serverId && (roleIds.includes(r.id) || r.name === '@everyone'))
      .sort((a, b) => (b.position || 0) - (a.position || 0));
    return roles;
  }

  hasPermission(permissionKey, serverId = this.state.activeServerId, userId = this.state.currentUserId) {
    const server = this.state.servers.find((s) => s.id === serverId);
    if (!server) return false;
    if (server.owner_id === userId) return true;
    const roles = this.getUserRolesInServer(userId, serverId);
    for (const r of roles) {
      const perms = Array.isArray(r.permissions) ? r.permissions : [];
      if (perms.includes('ADMINISTRATOR') || perms.includes(permissionKey)) {
        return true;
      }
    }
    return false;
  }

  getHighestRoleColor(userId, serverId) {
    const roles = this.getUserRolesInServer(userId, serverId);
    for (const r of roles) {
      if (r.color && r.name !== '@everyone') return r.color;
    }
    return null;
  }

  // =========================================================================
  // Rendering Orchestrator
  // =========================================================================

  renderAll() {
    document.documentElement.setAttribute('data-theme', this.state.theme);
    document.documentElement.setAttribute('data-motion', this.state.motion === 'reduced' ? 'reduced' : 'full');
    this.applyMobileDrawerState();
    this.renderServerRail();
    this.renderLeftSidebar();
    this.renderTopHeader();
    this.renderMainStage();
    this.renderRightSidebar();
    this.renderUserControlPanel();
    this.renderVoiceConnectionBar();
    this.renderModals();
    this.renderContextMenu();
    this.updateDocumentTitle();
  }

  renderServerRail() {
    const container = document.getElementById('server-rail-list');
    if (!container) return;

    const myServers = this.getMyServers();
    const unreadNotifs = this.state.notifications.filter((n) => n.user_id === this.state.currentUserId && !n.read).length;
    const pendingFriends = this.state.friends.filter(
      (f) => f.status === 'pending_incoming'
    ).length;

    let html = `
      <div class="server-item ${this.state.viewMode === 'dms' ? 'active' : ''}" data-action="switchToDMs" title="Direct Messages & Friends">
        <span class="server-pill"></span>
        <div class="server-icon-btn ${this.state.viewMode === 'dms' ? 'bg-[#7C5CFF] text-white' : 'bg-sidebar text-primary-token hover:bg-[#7C5CFF] hover:text-white'} relative">
          <i class="fa-solid fa-comments text-lg"></i>
          ${(pendingFriends + unreadNotifs) > 0 ? `<span class="absolute -bottom-1 -right-1 bg-[#F23F43] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-[#1e1f22]">${pendingFriends + unreadNotifs}</span>` : ''}
        </div>
      </div>
      <div class="w-8 h-[2px] bg-white/10 rounded-full mx-auto my-2"></div>
    `;

    myServers.forEach((srv) => {
      const isActive = this.state.viewMode === 'server' && this.state.activeServerId === srv.id;
      const activeVoiceCount = this.rtc.activeServerId === srv.id ? this.getLiveVoiceParticipantIds(this.rtc.activeChannelId).length : 0;
      const unread = this.getServerUnread(srv.id);
      html += `
        <div class="server-item ${isActive ? 'active' : ''}" data-action="selectServer" data-action-args="${this.encodeActionArgs([srv.id])}" title="${this.escapeHtml(srv.name)}${unread ? ` — ${unread} unread` : ''}">
          <span class="server-pill"></span>
          <div class="server-icon-btn text-white relative" style="background-color: ${this.safeColor(srv.icon_color, '#7C5CFF')}">
            <span>${this.escapeHtml((srv.icon_text || srv.name.slice(0, 2)).toUpperCase())}</span>
            ${activeVoiceCount > 0 ? `<span class="absolute -top-1 -right-1 w-4 h-4 bg-[#23A55A] text-white text-[9px] flex items-center justify-center rounded-full border-2 border-[#1e1f22]" title="${activeVoiceCount} in voice"><i class="fa-solid fa-volume-high"></i></span>` : ''}
            ${unread > 0 ? `<span class="absolute -bottom-1 -right-1 min-w-4 h-4 px-1 bg-[#22D3EE] text-[#07131a] text-[9px] font-bold flex items-center justify-center rounded-full border-2 border-[#1e1f22]" title="${unread} unread messages">${unread > 9 ? '9+' : unread}</span>` : ''}
          </div>
        </div>
      `;
    });

    html += `
      <div class="server-item" data-action="openModal" data-action-args="${this.encodeActionArgs(['createJoinServer'])}" title="Create or Join a Server">
        <span class="server-pill"></span>
        <div class="server-icon-btn bg-sidebar text-[#23A55A] hover:bg-[#23A55A] hover:text-white">
          <i class="fa-solid fa-plus text-lg"></i>
        </div>
      </div>
      <div class="server-item" data-action="openModal" data-action-args="${this.encodeActionArgs(['railwayBlueprint'])}" title="GitHub & Railway Production Architecture">
        <span class="server-pill"></span>
        <div class="server-icon-btn bg-sidebar text-[#7C5CFF] hover:bg-[#7C5CFF] hover:text-white">
          <i class="fa-solid fa-train-subway text-base"></i>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  renderLeftSidebar() {
    const headerEl = document.getElementById('sidebar-header');
    const bodyEl = document.getElementById('sidebar-body');
    if (!headerEl || !bodyEl) return;

    if (this.state.viewMode === 'dms') {
      headerEl.innerHTML = `
        <button data-action="switchToDMs" class="w-full bg-input text-muted-token hover:text-primary-token text-xs px-2.5 py-1.5 rounded flex items-center justify-between transition">
          <span><i class="fa-solid fa-magnifying-glass mr-2"></i>Find or start a conversation</span>
          <kbd class="text-[10px] bg-black/20 px-1.5 py-0.5 rounded">Ctrl+K</kbd>
        </button>
      `;

      const pendingCount = this.state.friends.filter(
        (f) => f.user_id === this.state.currentUserId && f.status === 'pending_incoming'
      ).length;

      // Group DM conversations involving current user
      const conversationsMap = new Map();
      this.state.directMessages.forEach((dm) => {
        const parts = Array.isArray(dm.participant_ids) ? dm.participant_ids : [];
        if (parts.includes(this.state.currentUserId)) {
          conversationsMap.set(dm.conversation_id, dm);
        }
      });

      let dmListHtml = `
        <div class="p-2 space-y-1">
          <div class="channel-item ${this.state.dmSubView === 'friends' ? 'active' : ''}" data-action="openFriendsView">
            <div class="flex items-center gap-3">
              <i class="fa-solid fa-user-group w-5 text-center"></i>
              <span>Friends & Requests</span>
            </div>
            ${pendingCount > 0 ? `<span class="bg-[#F23F43] text-white text-[11px] font-bold px-1.5 py-0.2 rounded-full">${pendingCount}</span>` : ''}
          </div>
          <div class="channel-item" data-action="openModal" data-action-args="${this.encodeActionArgs(['railwayBlueprint'])}">
            <div class="flex items-center gap-3">
              <i class="fa-solid fa-cloud-arrow-up w-5 text-center text-[#7C5CFF]"></i>
              <span>Railway & Architecture</span>
            </div>
            <span class="text-[10px] bg-[#7C5CFF]/20 text-[#7C5CFF] px-1.5 py-0.5 rounded font-semibold">PRO</span>
          </div>
        </div>

        <div class="px-4 pt-3 pb-1 flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-muted-token">
          <span>Direct Messages</span>
          <button data-action="openModal" data-action-args="${this.encodeActionArgs(['newDmModal'])}" class="hover:text-primary-token" title="Create DM or Group DM">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
        <div class="space-y-0.5 px-1 pb-4">
      `;

      Array.from(conversationsMap.values()).forEach((conv) => {
        const isSelected = this.state.dmSubView === 'conversation' && this.state.activeDmConversationId === conv.conversation_id;
        const parts = Array.isArray(conv.participant_ids) ? conv.participant_ids : [];
        const otherIds = parts.filter((id) => id !== this.state.currentUserId);
        let title = conv.group_name;
        let subStatus = `${parts.length} Members`;
        let avatarColor = '#7C5CFF';
        let avatarIcon = 'fa-users';
        let statusClass = 'status-online';

        if (!conv.is_group && otherIds.length > 0) {
          const peer = this.getUserById(otherIds[0]);
          title = peer.display_name || peer.username;
          subStatus = peer.custom_status || peer.status;
          avatarColor = this.safeColor(peer.avatar_color, '#7C5CFF');
          avatarIcon = this.safeIcon(peer.avatar_icon, 'fa-user');
          statusClass = `status-${this.safeStatus(peer.status)}`;
        }

        dmListHtml += `
          <div class="channel-item ${isSelected ? 'active' : ''}" data-action="selectDmConversation" data-action-args="${this.encodeActionArgs([conv.conversation_id])}">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="relative w-8 h-8 rounded-full flex items-center justify-center text-white text-xs shrink-0" style="background-color: ${avatarColor}">
                <i class="fa-solid ${avatarIcon}"></i>
                <span class="status-dot ${statusClass} absolute -bottom-0.5 -right-0.5"></span>
              </div>
              <div class="truncate">
                <div class="text-sm font-medium truncate text-primary-token">${this.escapeHtml(title)}</div>
                <div class="text-[11px] text-muted-token truncate">${this.escapeHtml(subStatus)}</div>
              </div>
            </div>
          </div>
        `;
      });

      dmListHtml += `</div>`;
      bodyEl.innerHTML = dmListHtml;
      return;
    }

    // Server mode left sidebar
    const srv = this.getActiveServer();
    if (!srv) return;

    const canManageServer = this.hasPermission('MANAGE_SERVER', srv.id);
    const canManageChannels = this.hasPermission('MANAGE_CHANNELS', srv.id);

    headerEl.innerHTML = `
      <div class="flex items-center justify-between w-full">
        <button data-action="openModal" data-action-args="${this.encodeActionArgs(['serverSettings'])}" class="flex items-center gap-2 font-bold text-sm text-primary-token truncate hover:opacity-90">
          <span class="truncate">${this.escapeHtml(srv.name)}</span>
          <i class="fa-solid fa-chevron-down text-xs text-muted-token"></i>
        </button>
        <div class="flex items-center gap-1">
          <button data-action="openModal" data-action-args="${this.encodeActionArgs(['inviteModal'])}" class="p-1.5 text-muted-token hover:text-primary-token rounded hover:bg-white/5" title="Invite People">
            <i class="fa-solid fa-user-plus text-xs"></i>
          </button>
          ${canManageServer ? `
          <button data-action="openModal" data-action-args="${this.encodeActionArgs(['serverSettings'])}" class="p-1.5 text-muted-token hover:text-primary-token rounded hover:bg-white/5" title="Server Settings & RBAC">
            <i class="fa-solid fa-sliders text-xs"></i>
          </button>` : ''}
        </div>
      </div>
    `;

    const srvChannels = this.state.channels.filter((c) => c.server_id === srv.id);
    const categories = {};
    srvChannels.forEach((c) => {
      const cat = c.category || 'CHANNELS';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(c);
    });

    let html = `
      <div class="px-3 pt-2.5 pb-1">
        <div class="bg-elevated/80 border border-subtle rounded-lg p-2.5 text-xs flex items-center justify-between">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-[#23A55A] shrink-0"></span>
            <span class="text-secondary-token truncate">Region: <strong class="text-primary-token">${this.escapeHtml(srv.region || 'us-east-railway')}</strong></span>
          </div>
          <button data-action="openModal" data-action-args="${this.encodeActionArgs(['inviteModal'])}" class="text-[11px] text-[#7C5CFF] hover:underline font-semibold shrink-0">Invite</button>
        </div>
      </div>
    `;

    Object.entries(categories).forEach(([catName, chList]) => {
      html += `
        <div class="mt-3">
          <div class="px-3 py-1 flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-muted-token">
            <span class="truncate"><i class="fa-solid fa-angle-down mr-1"></i>${this.escapeHtml(catName)}</span>
            ${canManageChannels ? `
              <button data-action="openCreateChannelModal" data-action-args="${this.encodeActionArgs([catName])}" class="hover:text-primary-token" title="Create Channel in ${this.escapeAttr(catName)}">
                <i class="fa-solid fa-plus"></i>
              </button>
            ` : ''}
          </div>
      `;

      chList.forEach((ch) => {
        const isActive = this.state.activeChannelId === ch.id;
        let iconHtml = '<i class="fa-solid fa-hashtag text-sm w-4 text-center opacity-75"></i>';
        if (ch.type === 'voice') iconHtml = '<i class="fa-solid fa-volume-high text-xs w-4 text-center text-[#23A55A]"></i>';
        else if (ch.type === 'announcement') iconHtml = '<i class="fa-solid fa-bullhorn text-xs w-4 text-center text-[#F0B232]"></i>';
        else if (ch.type === 'forum') iconHtml = '<i class="fa-solid fa-comments text-xs w-4 text-center text-[#7C5CFF]"></i>';

        const voiceUsers = ch.type === 'voice' ? this.getVoiceParticipants(ch.id) : [];
        const unread = this.getUnreadCount(ch.id);

        html += `
          <div>
            <div class="channel-item ${isActive ? 'active' : ''}" data-action="selectChannel" data-action-args="${this.encodeActionArgs([ch.id])}">
              <div class="flex items-center gap-2 min-w-0">
                ${iconHtml}
                <span class="truncate ${unread > 0 && !isActive ? 'text-primary-token font-semibold' : ''}">${this.escapeHtml(ch.name)}</span>
                ${unread > 0 && !isActive ? `<span class="mg-unread-dot shrink-0" title="${unread} unread"></span>` : ''}
              </div>
              <div class="flex items-center gap-1">
                ${ch.type === 'voice' ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-black/20 text-muted-token">${voiceUsers.length}</span>` : ''}
                ${canManageChannels ? `
                  <button data-action="deleteChannel" data-action-args="${this.encodeActionArgs([ch.id])}" data-stop-click="true" class="opacity-0 group-hover:opacity-100 hover:text-[#F23F43] text-[11px] px-1" title="Delete Channel">
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                ` : ''}
              </div>
            </div>
        `;

        // Render connected voice members right under voice channel
        if (ch.type === 'voice' && voiceUsers.length > 0) {
          html += `<div class="pl-7 pr-3 py-1 space-y-1">`;
          voiceUsers.forEach((vs) => {
            const u = this.getUserById(vs.user_id);
            const isLocal = vs.user_id === this.state.currentUserId && this.rtc.activeChannelId === ch.id;
            const speaking = isLocal ? this.rtc.isSpeaking : vs.speaking;
            const videoOn = isLocal ? this.rtc.isVideoEnabled : vs.video_enabled;
            const screenOn = isLocal ? this.rtc.isScreenSharing : vs.screen_sharing;
            const muted = isLocal ? this.rtc.isMuted : vs.muted;

            html += `
              <div class="voice-member-row ${speaking ? 'is-speaking' : ''}" data-action="selectChannel" data-action-args="${this.encodeActionArgs([ch.id])}" data-user-identity="${this.escapeAttr(u.id)}" title="Right-click for volume and user actions">
                <div class="flex items-center gap-2 min-w-0">
                  ${this.avatarHtml(u, { size: 'w-5 h-5', text: 'text-[10px]', ring: speaking ? 'avatar-speaking' : '' })}
                  <span class="truncate text-secondary-token">${this.escapeHtml(u.display_name || u.username)}</span>
                </div>
                <div class="flex items-center gap-1.5 text-[10px]">
                  ${screenOn ? '<span class="bg-[#F23F43] text-white px-1 rounded font-bold">LIVE</span>' : ''}
                  ${videoOn ? '<i class="fa-solid fa-video text-[#23A55A]"></i>' : ''}
                  ${muted ? '<i class="fa-solid fa-microphone-slash text-[#F23F43]"></i>' : ''}
                </div>
              </div>
            `;
          });
          html += `</div>`;
        }

        html += `</div>`;
      });

      html += `</div>`;
    });

    bodyEl.innerHTML = html;
  }

  renderTopHeader() {
    const header = document.getElementById('main-top-header');
    if (!header) return;

    const unreadNotifs = this.state.notifications.filter((n) => n.user_id === this.state.currentUserId && !n.read);

    if (this.state.viewMode === 'dms') {
      if (this.state.dmSubView === 'friends') {
        header.innerHTML = `
          <div class="flex items-center gap-3 overflow-x-auto">
            <button data-action="toggleMobileDrawer" class="md:hidden text-secondary-token hover:text-primary-token">
              <i class="fa-solid fa-bars"></i>
            </button>
            <div class="flex items-center gap-2 font-bold text-primary-token pr-3 border-r border-subtle">
              <i class="fa-solid fa-user-group text-muted-token"></i>
              <span>Friends</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs font-medium">
              <button data-action="setFriendsFilter" data-action-args="${this.encodeActionArgs(['online'])}" class="px-2.5 py-1 rounded ${this.state.friendsFilter === 'online' ? 'bg-white/15 text-primary-token font-semibold' : 'text-secondary-token hover:bg-white/5'}">Online</button>
              <button data-action="setFriendsFilter" data-action-args="${this.encodeActionArgs(['all'])}" class="px-2.5 py-1 rounded ${this.state.friendsFilter === 'all' ? 'bg-white/15 text-primary-token font-semibold' : 'text-secondary-token hover:bg-white/5'}">All</button>
              <button data-action="setFriendsFilter" data-action-args="${this.encodeActionArgs(['pending'])}" class="px-2.5 py-1 rounded ${this.state.friendsFilter === 'pending' ? 'bg-white/15 text-primary-token font-semibold' : 'text-secondary-token hover:bg-white/5'}">Pending</button>
              <button data-action="setFriendsFilter" data-action-args="${this.encodeActionArgs(['blocked'])}" class="px-2.5 py-1 rounded ${this.state.friendsFilter === 'blocked' ? 'bg-white/15 text-primary-token font-semibold' : 'text-secondary-token hover:bg-white/5'}">Blocked</button>
              <button data-action="setFriendsFilter" data-action-args="${this.encodeActionArgs(['add'])}" class="px-2.5 py-1 rounded bg-[#23A55A] text-white font-semibold">Add Friend</button>
            </div>
          </div>
          ${this.renderHeaderRightTools(unreadNotifs)}
        `;
      } else {
        // Active DM Conversation Header
        const dms = this.state.directMessages.filter((d) => d.conversation_id === this.state.activeDmConversationId);
        const first = dms[0];
        let title = 'Direct Message';
        let status = 'online';
        if (first) {
          const parts = Array.isArray(first.participant_ids) ? first.participant_ids : [];
          const others = parts.filter((id) => id !== this.state.currentUserId);
          if (first.is_group) {
            title = first.group_name || 'Group Conversation';
          } else if (others.length > 0) {
            const peer = this.getUserById(others[0]);
            title = peer.display_name || peer.username;
            status = peer.status || 'online';
          }
        }
        header.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0">
            <button data-action="toggleMobileDrawer" class="md:hidden text-secondary-token hover:text-primary-token">
              <i class="fa-solid fa-bars"></i>
            </button>
            <span class="text-muted-token font-bold">@</span>
            <span class="font-bold text-primary-token truncate">${this.escapeHtml(title)}</span>
            <span class="status-dot status-${this.safeStatus(status)}"></span>
          </div>
          <div class="flex items-center gap-2">
            <button data-action="startDirectVideoCall" data-action-args="${this.encodeActionArgs([this.state.activeDmConversationId, false])}" class="px-2.5 py-1 rounded bg-white/10 hover:bg-[#23A55A] hover:text-white text-xs font-medium text-secondary-token transition" title="Start Voice Call">
              <i class="fa-solid fa-phone mr-1"></i>Voice Call
            </button>
            <button data-action="startDirectVideoCall" data-action-args="${this.encodeActionArgs([this.state.activeDmConversationId, true])}" class="px-2.5 py-1 rounded bg-white/10 hover:bg-[#7C5CFF] hover:text-white text-xs font-medium text-secondary-token transition" title="Start Video Call">
              <i class="fa-solid fa-video mr-1"></i>Video Call
            </button>
            ${this.renderHeaderRightTools(unreadNotifs)}
          </div>
        `;
      }
      return;
    }

    // Server Channel Header
    const ch = this.getActiveChannel();
    if (!ch) return;

    let icon = '<i class="fa-solid fa-hashtag text-muted-token"></i>';
    if (ch.type === 'voice') icon = '<i class="fa-solid fa-volume-high text-[#23A55A]"></i>';
    else if (ch.type === 'announcement') icon = '<i class="fa-solid fa-bullhorn text-[#F0B232]"></i>';
    else if (ch.type === 'forum') icon = '<i class="fa-solid fa-comments text-[#7C5CFF]"></i>';

    const pinnedCount = this.state.messages.filter((m) => m.channel_id === ch.id && m.pinned).length;

    header.innerHTML = `
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        <button data-action="toggleMobileDrawer" class="md:hidden text-secondary-token hover:text-primary-token">
          <i class="fa-solid fa-bars"></i>
        </button>
        ${icon}
        <span class="font-bold text-sm text-primary-token shrink-0">${this.escapeHtml(ch.name)}</span>
        ${ch.topic ? `<span class="hidden sm:inline-block text-muted-token text-xs border-l border-subtle pl-3 truncate">${this.escapeHtml(ch.topic)}</span>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${ch.type === 'voice' ? `
          <button data-action="joinOrFocusVoiceChannel" data-action-args="${this.encodeActionArgs([ch.id])}" class="px-2.5 py-1 rounded bg-[#23A55A] hover:bg-[#1e8e4c] text-white text-xs font-semibold flex items-center gap-1.5">
            <i class="fa-solid fa-headset"></i>
            <span>${this.rtc.activeChannelId === ch.id ? 'Connected' : 'Join Voice'}</span>
          </button>
        ` : ''}
        <button data-action="togglePinnedPopover" class="relative p-1.5 text-secondary-token hover:text-primary-token rounded hover:bg-white/5" title="Pinned Messages (${pinnedCount})">
          <i class="fa-solid fa-thumbtack text-sm"></i>
          ${pinnedCount > 0 ? `<span class="absolute -top-1 -right-1 bg-[#7C5CFF] text-white text-[9px] font-bold px-1 rounded-full">${pinnedCount}</span>` : ''}
        </button>
        <div class="relative hidden sm:block">
          <input
            type="text"
            value="${this.escapeAttr(this.state.searchQuery)}"
            data-action="updateSearchQuery" data-action-event="input" data-action-args="${this.encodeActionArgs([{ __pulsecordEventValue: true }])}"
            placeholder="Search messages..."
            class="bg-input text-xs text-primary-token rounded px-2.5 py-1 pr-7 w-36 focus:w-52 transition-all outline-none border border-transparent focus:border-[#7C5CFF]"
          />
          <i class="fa-solid fa-magnifying-glass text-[11px] text-muted-token absolute right-2.5 top-2"></i>
        </div>
        ${this.renderHeaderRightTools(unreadNotifs)}
      </div>
    `;
  }

  renderHeaderRightTools(unreadNotifs) {
    return `
      <div class="flex items-center gap-1.5">
        <button data-action="toggleTheme" class="p-1.5 text-secondary-token hover:text-primary-token rounded hover:bg-white/5" title="Toggle Dark/Light Theme">
          <i class="fa-solid ${this.state.theme === 'dark' ? 'fa-sun text-[#FEE75C]' : 'fa-moon text-[#7C5CFF]'} text-sm"></i>
        </button>
        <button data-action="toggleNotificationsPopover" class="relative p-1.5 text-secondary-token hover:text-primary-token rounded hover:bg-white/5" title="Notifications">
          <i class="fa-solid fa-bell text-sm"></i>
          ${unreadNotifs.length > 0 ? `<span class="absolute -top-0.5 -right-0.5 bg-[#F23F43] text-white text-[9px] font-bold px-1 rounded-full">${unreadNotifs.length}</span>` : ''}
        </button>
        <button data-action="openModal" data-action-args="${this.encodeActionArgs(['railwayBlueprint'])}" class="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#7C5CFF]/15 hover:bg-[#7C5CFF] text-[#7C5CFF] hover:text-white text-xs font-semibold transition" title="Inspect Prisma Schema, Dockerfile & Railway Config">
          <i class="fa-solid fa-code-branch"></i>
          <span>Railway & DB</span>
        </button>
        <button data-action="toggleMemberSidebar" class="p-1.5 ${this.state.showMemberList ? 'text-primary-token bg-white/10' : 'text-secondary-token'} hover:text-primary-token rounded" title="Toggle Member List">
          <i class="fa-solid fa-users text-sm"></i>
        </button>
      </div>
    `;
  }

  renderMainStage() {
    const stage = document.getElementById('main-stage-container');
    if (!stage) return;
    const callBanner = this.renderIncomingCallBanner();

    // 1. If in DMs -> Friends tab
    if (this.state.viewMode === 'dms' && this.state.dmSubView === 'friends') {
      stage.innerHTML = callBanner + this.renderFriendsDirectoryStage();
      return;
    }

    // 2. If in DMs -> Active DM conversation
    if (this.state.viewMode === 'dms' && this.state.dmSubView === 'conversation') {
      stage.innerHTML = callBanner + this.renderDmConversationStage();
      this.attachLiveVideoStreams();
      this.updateTypingIndicator();
      return;
    }

    // 3. Server Channel view
    const ch = this.getActiveChannel();
    if (!ch) {
      stage.innerHTML = `<div class="flex-1 flex items-center justify-center text-muted-token">Select a channel to start communicating.</div>`;
      return;
    }

    // Check if voice channel or if user is connected to this voice channel
    const isVoiceChannel = ch.type === 'voice';
    const showVoiceTheater = isVoiceChannel || (this.rtc.activeChannelId === ch.id && this.state.voiceStageExpanded);

    let html = callBanner + `<div class="flex flex-col h-full overflow-hidden">`;

    if (showVoiceTheater) {
      html += this.renderVoiceAndVideoTheater(ch);
    }

    // Also render text chat (or collapsible chat below voice stage)
    html += this.renderChannelMessagesArea(ch, showVoiceTheater);
    html += `</div>`;

    stage.innerHTML = html;
    this.attachLiveVideoStreams();
    this.updateTypingIndicator();
  }

  renderVoiceAndVideoTheater(channel) {
    const isConnectedHere = this.rtc.mode === 'voice' && this.rtc.activeChannelId === channel.id;
    const me = this.getCurrentUser();
    const hasScreenShare = (isConnectedHere && this.rtc.isScreenSharing) || Array.from(this.rtc.remoteVideoTracks.keys()).some((key) => key.startsWith('screen:'));
    const participants = this.getVoiceParticipants(channel.id);

    return `
      <div id="voice-theater-stage" class="voice-theater-stage bg-[#111214] border-b border-subtle p-4 flex flex-col justify-between ${channel.type === 'voice' ? 'h-[58%]' : 'h-[48%]'} shrink-0 relative">
        <!-- Top Stage Status Bar -->
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <span class="px-2 py-0.5 rounded ${this.rtc.connectionStatus === 'connected' ? 'bg-[#23A55A]/20 text-[#23A55A]' : 'bg-white/10 text-gray-300'} text-xs font-bold flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full ${this.rtc.connectionStatus === 'connected' ? 'bg-[#23A55A]' : 'bg-gray-400'}"></span>
              ${this.rtc.connectionStatus === 'connected' ? 'LIVEKIT CONNECTED' : this.rtc.connectionStatus === 'connecting' || this.rtc.connectionStatus === 'reconnecting' ? 'CONNECTING TO LIVEKIT' : 'NOT CONNECTED'}
            </span>
            <h3 class="text-sm font-bold text-white">${this.escapeHtml(channel.name)}</h3>
            <span class="text-xs text-gray-400">• Real-time media appears only after connection succeeds</span>
          </div>
          <div class="flex items-center gap-2">
            <button data-action="openModal" data-action-args="${this.encodeActionArgs(['mediaDevicesModal'])}" class="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs flex items-center gap-1.5" title="Select Microphone, Speaker & Camera">
              <i class="fa-solid fa-gear"></i>
              <span>Audio/Video Devices</span>
            </button>
            <button data-action="requestFullscreenStage" class="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs" title="Full Screen">
              <i class="fa-solid fa-expand"></i>
            </button>
          </div>
        </div>

        <div class="voice-participant-strip" aria-label="People currently in voice">
          <div class="flex items-center gap-2 shrink-0">
            <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#23A55A]/15 text-[#23A55A]"><i class="fa-solid fa-headphones text-xs"></i></span>
            <div>
              <div class="text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">In voice</div>
              <div class="text-sm font-bold text-white">${participants.length} ${participants.length === 1 ? 'person' : 'people'}</div>
            </div>
          </div>
          <div class="voice-participant-chips">
            ${participants.length ? participants.map((p) => {
              const u = this.getUserById(p.user_id);
              const isLocal = p.user_id === me.id && isConnectedHere;
              const speaking = isLocal ? this.rtc.isSpeaking : Boolean(p.speaking);
              const volume = this.rtc.getUserVolume(u.id);
              return `<div class="voice-participant-chip ${speaking ? 'is-speaking' : ''}" data-user-identity="${this.escapeAttr(u.id)}" title="${this.escapeAttr(u.display_name || u.username)}${isLocal ? ' (You)' : ''} — right-click for volume">
                ${this.avatarHtml(u, { size: 'w-7 h-7', text: 'text-[11px]', status: true })}
                <span class="max-w-28 truncate">${this.escapeHtml(u.display_name || u.username)}${isLocal ? ' (You)' : ''}</span>
                ${speaking ? '<i class="fa-solid fa-volume-high text-[#23A55A] text-[10px]"></i>' : ''}
                ${volume === 0 ? '<i class="fa-solid fa-volume-xmark text-[#FF5F6D] text-[10px]" title="Muted for you"></i>' : volume !== 100 ? `<span class="text-[9px] text-[#22D3EE]">${volume}%</span>` : ''}
              </div>`;
            }).join('') : '<span class="text-xs text-white/45">Nobody is connected yet. Join the room to start talking.</span>'}
          </div>
        </div>

        <!-- Participant Video & Screen Share Grid -->
        <div id="webrtc-stage-grid" class="video-stage-grid ${hasScreenShare ? 'has-screen-share' : ''} flex-1 overflow-y-auto my-1">
          ${this.rtc.isScreenSharing && isConnectedHere ? `
            <div class="video-tile screen-share-tile featured-screen-share speaking-ring">
              <video id="local-screen-video" autoplay playsinline muted></video>
              <div class="absolute top-3 left-3 bg-[#F23F43] text-white text-[11px] font-bold px-2 py-0.5 rounded flex items-center gap-1.5 shadow">
                <i class="fa-solid fa-desktop"></i>
                <span>${this.escapeHtml(me.display_name)} — Screen Share</span>
              </div>
              <span class="absolute top-3 right-3 bg-black/70 text-white/75 text-[10px] px-2 py-1 rounded-full">Your screen</span>
              <button data-action="handleToggleScreenShare" class="absolute bottom-3 right-3 bg-black/75 hover:bg-[#F23F43] text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition">
                Stop Sharing
              </button>
            </div>
          ` : ''}

          ${Array.from(this.rtc.remoteVideoTracks.keys()).filter((key) => key.startsWith('screen:')).map((key) => {
            const userId = key.slice('screen:'.length);
            const u = this.getUserById(userId);
            return `<div class="video-tile screen-share-tile featured-screen-share"><video id="remote-screen-${this.escapeAttr(u.id)}" data-remote-identity="${this.escapeAttr(u.id)}" data-remote-source="screen" autoplay playsinline class="w-full h-full object-contain absolute inset-0"></video><div class="absolute top-3 left-3 bg-black/70 text-white text-xs px-2 py-1 rounded flex items-center gap-1.5"><i class="fa-solid fa-desktop text-[#F23F43]"></i>${this.escapeHtml(u.display_name || u.username)} — Screen Share</div><button data-action="requestFullscreenStage" class="absolute bottom-3 right-3 bg-black/75 hover:bg-[#7C5CFF] text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition"><i class="fa-solid fa-expand mr-1"></i>Focus</button></div>`;
          }).join('')}

          ${participants.map((p) => {
            const u = this.getUserById(p.user_id);
            const isLocal = p.user_id === me.id && isConnectedHere;
            const speaking = isLocal ? this.rtc.isSpeaking : Boolean(p.speaking);
            const videoOn = isLocal ? this.rtc.isVideoEnabled : this.rtc.remoteVideoTracks.has(`camera:${u.id}`);
            const muted = isLocal ? this.rtc.isMuted : p.muted;
            const deafened = isLocal ? this.rtc.isDeafened : p.deafened;
            const localVolume = this.rtc.getUserVolume(u.id);

            return `
              <div class="video-tile ${speaking ? 'speaking-ring' : ''}" data-user-identity="${this.escapeAttr(u.id)}" title="Right-click for volume and user actions">
                ${isLocal && videoOn ? `<video id="local-camera-video" autoplay playsinline muted></video>` : ''}
                ${!isLocal && videoOn ? `<video id="remote-camera-${this.escapeAttr(u.id)}" data-remote-identity="${this.escapeAttr(u.id)}" data-remote-source="camera" autoplay playsinline class="w-full h-full object-cover absolute inset-0"></video>` : ''}
                ${!videoOn ? this.avatarHtml(u, { size: 'w-16 h-16', text: 'text-2xl', ring: speaking ? 'avatar-speaking' : '' }) : ''}
                <div class="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none">
                  <span class="bg-black/70 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-md flex items-center gap-1.5">
                    ${speaking ? '<span class="w-2 h-2 rounded-full bg-[#23A55A]"></span>' : ''}
                    ${this.escapeHtml(u.display_name || u.username)} ${isLocal ? '(You)' : ''}
                  </span>
                  <div class="flex items-center gap-1">
                    ${videoOn ? '<span class="bg-[#23A55A]/90 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">CAM</span>' : ''}
                    ${muted ? '<span class="bg-[#F23F43] text-white p-1 rounded text-[10px]"><i class="fa-solid fa-microphone-slash"></i></span>' : ''}
                    ${deafened ? '<span class="bg-[#F23F43] text-white p-1 rounded text-[10px]"><i class="fa-solid fa-ear-deaf"></i></span>' : ''}
                    ${!isLocal && localVolume === 0 ? '<span class="bg-[#0d0f16] text-white p-1 rounded text-[10px]" title="Muted for you"><i class="fa-solid fa-volume-xmark"></i></span>' : ''}
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Bottom Voice/Video/Screen-Share Action Dock -->
        <div class="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-center gap-2.5">
          ${!isConnectedHere ? `
            <button data-action="joinOrFocusVoiceChannel" data-action-args="${this.encodeActionArgs([channel.id, false])}" class="px-4 py-2 rounded-lg bg-[#23A55A] hover:bg-[#1e8e4c] text-white text-xs font-bold flex items-center gap-2 shadow-lg">
              <i class="fa-solid fa-phone-volume"></i>
              <span>Join Voice Channel</span>
            </button>
            <button data-action="joinOrFocusVoiceChannel" data-action-args="${this.encodeActionArgs([channel.id, true])}" class="px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-bold flex items-center gap-2 shadow-lg">
              <i class="fa-solid fa-video"></i>
              <span>Join with Camera</span>
            </button>
          ` : `
            <button data-action="handleToggleMute" class="px-3.5 py-2 rounded-lg ${this.rtc.isMuted ? 'bg-[#F23F43] text-white' : 'bg-white/10 hover:bg-white/20 text-white'} text-xs font-semibold flex items-center gap-2 transition">
              <i class="fa-solid ${this.rtc.isMuted ? 'fa-microphone-slash' : 'fa-microphone'}"></i>
              <span>${this.rtc.isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
            </button>
            <button data-action="handleToggleDeafen" class="px-3.5 py-2 rounded-lg ${this.rtc.isDeafened ? 'bg-[#F23F43] text-white' : 'bg-white/10 hover:bg-white/20 text-white'} text-xs font-semibold flex items-center gap-2 transition">
              <i class="fa-solid ${this.rtc.isDeafened ? 'fa-ear-deaf' : 'fa-headphones'}"></i>
              <span>${this.rtc.isDeafened ? 'Undeafen' : 'Deafen'}</span>
            </button>
            <button data-action="handleToggleCamera" class="px-3.5 py-2 rounded-lg ${this.rtc.isVideoEnabled ? 'bg-[#23A55A] text-white' : 'bg-white/10 hover:bg-white/20 text-white'} text-xs font-semibold flex items-center gap-2 transition">
              <i class="fa-solid fa-video"></i>
              <span>${this.rtc.isVideoEnabled ? 'Camera On' : 'Turn On Camera'}</span>
            </button>
            <button data-action="handleToggleScreenShare" class="px-3.5 py-2 rounded-lg ${this.rtc.isScreenSharing ? 'bg-[#7C5CFF] text-white' : 'bg-white/10 hover:bg-white/20 text-white'} text-xs font-semibold flex items-center gap-2 transition">
              <i class="fa-solid fa-desktop"></i>
              <span>${this.rtc.isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}</span>
            </button>
            <button data-action="handleDisconnectVoice" class="px-4 py-2 rounded-lg bg-[#F23F43] hover:bg-[#d63034] text-white text-xs font-bold flex items-center gap-2">
              <i class="fa-solid fa-phone-slash"></i>
              <span>Disconnect</span>
            </button>
          `}
        </div>
      </div>
    `;
  }

  renderChannelMessagesArea(channel, compactHeight = false) {
    const allChannelMsgs = this.state.messages.filter((m) => {
      if (m.channel_id !== channel.id) return false;
      if (this.state.searchQuery.trim()) {
        const q = this.state.searchQuery.toLowerCase();
        const u = this.getUserById(m.user_id);
        return (
          (m.content || '').toLowerCase().includes(q) ||
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q)
        );
      }
      return true;
    });

    const totalCount = allChannelMsgs.length;
    const visibleMsgs = allChannelMsgs.slice(-this.state.messagePageLimit);
    const hasMore = totalCount > visibleMsgs.length;

    return `
      <div class="flex-1 flex overflow-hidden relative">
        <!-- Main Scrollable Message Stream -->
        <div class="flex-1 flex flex-col h-full overflow-hidden">
          <div id="messages-scroll-viewport" class="flex-1 overflow-y-auto py-4 space-y-1">
            <!-- Channel Welcome Banner -->
            ${!compactHeight ? `
              <div class="px-4 pb-4 mb-2 border-b border-subtle">
                <div class="w-12 h-12 rounded-full bg-elevated flex items-center justify-center text-primary-token text-xl mb-2">
                  <i class="fa-solid ${channel.type === 'voice' ? 'fa-volume-high text-[#23A55A]' : channel.type === 'announcement' ? 'fa-bullhorn text-[#F0B232]' : 'fa-hashtag'}"></i>
                </div>
                <h2 class="text-xl font-extrabold text-primary-token">Welcome to #${this.escapeHtml(channel.name)}!</h2>
                <p class="text-xs text-muted-token mt-1">${this.escapeHtml(channel.topic || 'This is the start of the #' + channel.name + ' channel. Messages are persisted in real time.')}</p>
              </div>
            ` : ''}

            ${hasMore ? `
              <div class="text-center py-2">
                <button data-action="loadMoreMessages" class="px-3 py-1 rounded bg-elevated hover:bg-white/10 text-xs text-[#7C5CFF] font-semibold">
                  Load Earlier Messages (${totalCount - visibleMsgs.length} older)
                </button>
              </div>
            ` : ''}

            ${visibleMsgs.map((msg) => this.renderSingleMessageRow(msg, false)).join('')}
          </div>

          <!-- Composer Bar -->
          ${this.renderMessageComposer(channel.name, false)}
        </div>

        <!-- Optional Active Thread Drawer -->
        ${this.state.activeThreadMessage ? this.renderThreadDrawer() : ''}

        <!-- Optional Pinned Messages Popover -->
        ${this.state.showPinnedPopover ? this.renderPinnedMessagesPopover(channel.id) : ''}

        <!-- Optional Notifications Popover -->
        ${this.state.showNotificationsPopover ? this.renderNotificationsPopover() : ''}
      </div>
    `;
  }

  renderSingleMessageRow(msg, isDm = false) {
    const author = this.getUserById(msg.user_id || msg.sender_id);
    const me = this.getCurrentUser();
    const isMine = (msg.user_id || msg.sender_id) === me.id;
    const canManageMessages = !isDm && this.hasPermission('MANAGE_MESSAGES', this.state.activeServerId);
    const roleColor = !isDm ? this.getHighestRoleColor(author.id, this.state.activeServerId) : null;

    // Check if mentioned
    const mentions = Array.isArray(msg.mentions) ? msg.mentions : [];
    const isMentioned = mentions.includes(me.id) || mentions.includes('@everyone') || (msg.content || '').includes(`@${me.username}`);

    // Reply lookup
    let replyBannerHtml = '';
    if (msg.reply_to_id) {
      const pool = isDm ? this.state.directMessages : this.state.messages;
      const parent = pool.find((m) => m.id === msg.reply_to_id);
      if (parent) {
        const pUser = this.getUserById(parent.user_id || parent.sender_id);
        replyBannerHtml = `
          <div class="flex items-center gap-1.5 text-xs text-muted-token mb-1 pl-3 border-l-2 border-[#7C5CFF]/60 truncate">
            <i class="fa-solid fa-reply fa-flip-horizontal text-[10px]"></i>
            <span class="font-semibold text-secondary-token">@${this.escapeHtml(pUser.display_name || pUser.username)}</span>
            <span class="truncate opacity-80">${this.escapeHtml((parent.content || '').slice(0, 70))}</span>
          </div>
        `;
      }
    }

    // Parse reactions
    let reactionsObj = {};
    try {
      reactionsObj = msg.reactions_json ? JSON.parse(msg.reactions_json) : {};
    } catch (_) {
      reactionsObj = {};
    }

    // Parse attachments
    let attachmentsArr = [];
    try {
      attachmentsArr = msg.attachments_json ? JSON.parse(msg.attachments_json) : [];
    } catch (_) {
      attachmentsArr = [];
    }

    const isEditingThis = this.state.editingMessageId === msg.id;

    return `
      <div class="message-row group ${isMentioned ? 'mentioned' : ''}" id="msg-row-${msg.id}">
        ${replyBannerHtml}
        <div class="flex items-start gap-3">
          <div data-action="openUserProfileModal" data-action-args="${this.encodeActionArgs([author.id])}" class="shrink-0 mt-0.5 cursor-pointer hover:opacity-90">
            ${this.avatarHtml(author, { size: 'w-9 h-9', text: 'text-sm' })}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 flex-wrap">
              <span data-action="openUserProfileModal" data-action-args="${this.encodeActionArgs([author.id])}" class="font-semibold text-sm hover:underline cursor-pointer" style="color: ${this.safeColor(roleColor, 'var(--text-primary)')}">
                ${this.escapeHtml(author.display_name || author.username)}
              </span>
              ${author.username === 'mahyar_bot' ? '<span class="bg-[#7C5CFF] text-white text-[9px] font-bold px-1.5 py-0.5 rounded">APP</span>' : ''}
              <span class="text-[11px] text-muted-token">${this.formatTimestamp(msg.timestamp_iso || msg.created_at)}</span>
              ${msg.edited ? '<span class="text-[10px] text-muted-token">(edited)</span>' : ''}
              ${msg.pinned ? '<span class="text-[10px] text-[#F0B232] font-semibold"><i class="fa-solid fa-thumbtack mr-1"></i>Pinned</span>' : ''}
            </div>

            ${isEditingThis ? `
              <div class="mt-1.5">
                <input
                  id="edit-input-${msg.id}"
                  type="text"
                  value="${this.escapeAttr(msg.content || '')}"
                  data-key-action="edit-message" data-key-action-args="${this.encodeActionArgs([msg.id, isDm])}"
                  class="w-full bg-input text-primary-token text-sm px-3 py-1.5 rounded border border-[#7C5CFF] outline-none"
                />
                <div class="text-[11px] text-muted-token mt-1">
                  escape to <button data-action="cancelEditMessage" class="text-[#7C5CFF] hover:underline">cancel</button> • enter to <button data-action="saveEditedMessage" data-action-args="${this.encodeActionArgs([msg.id, isDm])}" class="text-[#7C5CFF] hover:underline">save</button>
                </div>
              </div>
            ` : `
              <div class="text-sm text-secondary-token leading-relaxed break-words mt-0.5">
                ${this.formatMessageContent(msg.content || '')}
              </div>
            `}

            <!-- Attachments -->
            ${attachmentsArr.length > 0 ? `
              <div class="mt-2 flex flex-wrap gap-2">
                ${attachmentsArr.map((att) => `
                  <a href="${this.escapeAttr(att.url || att.reference || '#')}" target="_blank" rel="noopener" class="flex items-center gap-2.5 bg-elevated border border-subtle hover:border-[#7C5CFF] px-3 py-2 rounded-lg text-xs transition">
                    <i class="fa-solid fa-file-code text-[#7C5CFF] text-base"></i>
                    <div>
                      <div class="font-semibold text-primary-token">${this.escapeHtml(att.name || att.original_filename || 'attachment')}</div>
                      <div class="text-[10px] text-muted-token">${this.escapeHtml(att.size || '')} • Click to open/download</div>
                    </div>
                  </a>
                `).join('')}
              </div>
            ` : ''}

            <!-- Thread Pill -->
            ${msg.thread_name ? `
              <div data-action="openThread" data-action-args="${this.encodeActionArgs([msg.id])}" class="mt-2 inline-flex items-center gap-2 bg-elevated hover:bg-white/10 border border-subtle px-2.5 py-1 rounded-md text-xs text-[#7C5CFF] font-semibold cursor-pointer">
                <i class="fa-solid fa-comments"></i>
                <span>Thread: ${this.escapeHtml(msg.thread_name)}</span>
                <i class="fa-solid fa-chevron-right text-[10px]"></i>
              </div>
            ` : ''}

            <!-- Emoji Reactions Bar -->
            ${Object.keys(reactionsObj).length > 0 ? `
              <div class="flex flex-wrap gap-1.5 mt-2">
                ${Object.entries(reactionsObj).map(([emoji, userIds]) => {
                  const list = Array.isArray(userIds) ? userIds : [];
                  if (list.length === 0) return '';
                  const iReacted = list.includes(me.id);
                  return `
                    <button
                      data-action="toggleReaction" data-action-args="${this.encodeActionArgs([msg.id, emoji, isDm])}"
                      class="px-2 py-0.5 rounded-md text-xs flex items-center gap-1 border transition ${iReacted ? 'bg-[#7C5CFF]/20 border-[#7C5CFF] text-primary-token font-semibold' : 'bg-elevated border-subtle text-secondary-token hover:border-white/25'}"
                    >
                      <span>${emoji}</span>
                      <span>${list.length}</span>
                    </button>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Floating Hover Action Toolbar -->
        <div class="message-actions items-center px-1 py-0.5 gap-0.5">
          ${QUICK_EMOJIS.slice(0, 4).map((em) => `
            <button data-action="toggleReaction" data-action-args="${this.encodeActionArgs([msg.id, em, isDm])}" class="p-1.5 hover:bg-white/10 rounded text-xs" title="React ${em}">${em}</button>
          `).join('')}
          <button data-action="startReply" data-action-args="${this.encodeActionArgs([msg.id, isDm])}" class="p-1.5 text-secondary-token hover:text-primary-token hover:bg-white/10 rounded text-xs" title="Reply">
            <i class="fa-solid fa-reply"></i>
          </button>
          ${!isDm ? `
            <button data-action="openThread" data-action-args="${this.encodeActionArgs([msg.id])}" class="p-1.5 text-secondary-token hover:text-primary-token hover:bg-white/10 rounded text-xs" title="Open or Create Thread">
              <i class="fa-solid fa-comments"></i>
            </button>
          ` : ''}
          ${(isMine || canManageMessages) ? `
            <button data-action="togglePinMessage" data-action-args="${this.encodeActionArgs([msg.id, isDm])}" class="p-1.5 text-secondary-token hover:text-[#F0B232] hover:bg-white/10 rounded text-xs" title="${msg.pinned ? 'Unpin Message' : 'Pin Message'}">
              <i class="fa-solid fa-thumbtack"></i>
            </button>
          ` : ''}
          ${isMine ? `
            <button data-action="startEditMessage" data-action-args="${this.encodeActionArgs([msg.id])}" class="p-1.5 text-secondary-token hover:text-primary-token hover:bg-white/10 rounded text-xs" title="Edit Message">
              <i class="fa-solid fa-pen"></i>
            </button>
          ` : ''}
          ${(isMine || canManageMessages) ? `
            <button data-action="deleteMessage" data-action-args="${this.encodeActionArgs([msg.id, isDm])}" class="p-1.5 text-secondary-token hover:text-[#F23F43] hover:bg-white/10 rounded text-xs" title="Delete Message">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderMessageComposer(targetName, isDm = false) {
    const replyMsg = this.state.replyingToMessage;
    return `
      <div class="px-4 pb-4 pt-1 shrink-0">
        <div id="typing-indicator" class="typing-indicator" aria-live="polite"></div>
        ${replyMsg ? `
          <div class="bg-elevated border-t border-x border-subtle rounded-t-lg px-3 py-1.5 flex items-center justify-between text-xs">
            <span class="text-secondary-token truncate">
              Replying to <strong class="text-primary-token">@${this.escapeHtml(this.getUserById(replyMsg.user_id || replyMsg.sender_id).display_name)}</strong>: ${this.escapeHtml((replyMsg.content || '').slice(0, 60))}
            </span>
            <button data-action="cancelReply" class="text-muted-token hover:text-primary-token ml-2">
              <i class="fa-solid fa-circle-xmark"></i>
            </button>
          </div>
        ` : ''}

        ${this.state.pendingAttachments.length > 0 ? `
          <div class="bg-elevated border-t border-x border-subtle px-3 py-2 flex flex-wrap gap-2">
            ${this.state.pendingAttachments.map((att, idx) => `
              <div class="flex items-center gap-2 bg-input px-2.5 py-1 rounded text-xs">
                <i class="fa-solid fa-paperclip text-[#7C5CFF]"></i>
                <span class="text-primary-token font-medium">${this.escapeHtml(att.name)}</span>
                <button data-action="removePendingAttachment" data-action-args="${this.encodeActionArgs([idx])}" class="text-muted-token hover:text-[#F23F43]">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="composer-box ${replyMsg || this.state.pendingAttachments.length > 0 ? 'rounded-b-xl' : ''} px-2.5 py-2 flex items-center gap-1.5">
          <button data-action="insertQuickPhrase" class="composer-action" title="Insert a quick phrase" aria-label="Insert a quick phrase">
            <i class="fa-solid fa-bolt text-sm"></i>
          </button>
          <input
            id="main-chat-input"
            type="text"
            placeholder="Message ${isDm ? '@' : '#'}${this.escapeAttr(targetName)}"
            aria-label="Message input"
            autocomplete="off"
            data-typing-context="${isDm ? 'dm' : 'channel'}"
            data-key-action="send-message" data-key-action-args="${this.encodeActionArgs([isDm])}"
            class="flex-1 bg-transparent text-sm text-primary-token outline-none placeholder:text-muted-token px-1"
          />
          <div class="relative group">
            <button data-action="toggleEmojiPicker" aria-expanded="false" class="composer-action" title="Insert Emoji" aria-label="Insert emoji">
              <i class="fa-solid fa-face-smile text-base"></i>
            </button>
            <div data-emoji-picker class="hidden group-hover:flex absolute bottom-11 right-0 bg-floating border border-subtle rounded-xl p-2 shadow-xl gap-1.5 z-30">
              ${QUICK_EMOJIS.slice(0, 6).map((em) => `
                <button data-action="appendEmojiToInput" data-action-args="${this.encodeActionArgs([em])}" class="hover:scale-125 transition text-base p-1">${em}</button>
              `).join('')}
            </div>
          </div>
          <button data-action="sendMessage" data-action-args="${this.encodeActionArgs([isDm])}" class="composer-send" aria-label="Send message">
            <span>Send</span>
            <i class="fa-solid fa-paper-plane text-[11px]"></i>
          </button>
        </div>
        <div class="text-[10px] text-muted-token mt-1.5 px-1.5 flex items-center justify-between">
          <span>Enter to send • Shift + Enter for a new line</span>
          <span class="hidden sm:inline">Right-click a voice participant for individual volume</span>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Friends & Direct Messages Stage
  // =========================================================================

  renderFriendsDirectoryStage() {
    const me = this.getCurrentUser();
    const myFriendRows = this.state.friends.filter((f) => f.user_id === me.id || f.friend_id === me.id);

    if (this.state.friendsFilter === 'add') {
      return `
        <div class="p-6 max-w-2xl">
          <h2 class="text-base font-bold uppercase tracking-wide text-primary-token">Add Friend</h2>
          <p class="text-xs text-muted-token mt-1">Enter the username of a registered account to send a friend request.</p>
          <div class="mt-4 flex items-center gap-2 bg-input p-2 rounded-lg border border-subtle focus-within:border-[#7C5CFF]">
            <input id="add-friend-input" type="text" placeholder="Enter a username..." class="flex-1 bg-transparent text-sm text-primary-token outline-none px-2" />
            <button data-action="sendFriendRequest" class="bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-semibold px-4 py-2 rounded-md">
              Send Friend Request
            </button>
          </div>

          <h3 class="text-xs font-bold uppercase tracking-wider text-muted-token mt-8 mb-3">Suggested Community Members</h3>
          <div class="space-y-2">
            ${this.state.users.filter((u) => u.id !== me.id).map((u) => `
              <div class="flex items-center justify-between p-3 rounded-lg bg-elevated border border-subtle">
                <div class="flex items-center gap-3">
                  <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm" style="background-color: ${this.safeColor(u.avatar_color, '#7C5CFF')}">
                    <i class="fa-solid ${this.safeIcon(u.avatar_icon, 'fa-user')}"></i>
                  </div>
                  <div>
                    <div class="text-sm font-semibold text-primary-token">${this.escapeHtml(u.display_name)} <span class="text-xs text-muted-token">#${this.escapeHtml(u.discriminator || '0001')}</span></div>
                    <div class="text-xs text-muted-token">${this.escapeHtml(u.bio || '')}</div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button data-action="startDmWithUser" data-action-args="${this.encodeActionArgs([u.id])}" class="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs font-semibold text-primary-token">Message</button>
                  <button data-action="sendFriendRequestById" data-action-args="${this.encodeActionArgs([u.id])}" class="px-3 py-1.5 rounded bg-[#23A55A] hover:bg-[#1e8e4c] text-xs font-semibold text-white">Add Friend</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const filtered = myFriendRows.filter((row) => {
      const peerId = row.user_id === me.id ? row.friend_id : row.user_id;
      const peer = this.getUserById(peerId);
      if (this.state.friendsFilter === 'online') {
        return row.status === 'accepted' && peer.status !== 'offline';
      }
      if (this.state.friendsFilter === 'all') {
        return row.status === 'accepted';
      }
      if (this.state.friendsFilter === 'pending') {
        return row.status === 'pending_incoming' || row.status === 'pending_outgoing';
      }
      if (this.state.friendsFilter === 'blocked') {
        return row.status === 'blocked';
      }
      return true;
    });

    return `
      <div class="p-6 flex-1 overflow-y-auto">
        <div class="text-xs font-bold uppercase tracking-wider text-muted-token mb-4">
          ${this.state.friendsFilter.toUpperCase()} — ${filtered.length}
        </div>
        ${filtered.length === 0 ? `
          <div class="text-center py-16 text-muted-token text-sm">
            No records in this filter view. Click <strong>Add Friend</strong> above to connect with teammates!
          </div>
        ` : `
          <div class="space-y-2">
            ${filtered.map((row) => {
              const peerId = row.user_id === me.id ? row.friend_id : row.user_id;
              const peer = this.getUserById(peerId);
              return `
                <div class="flex items-center justify-between p-3 rounded-lg bg-elevated/70 hover:bg-elevated border border-subtle transition">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="relative w-10 h-10 rounded-full flex items-center justify-center text-white text-sm shrink-0" style="background-color: ${this.safeColor(peer.avatar_color, '#7C5CFF')}">
                      <i class="fa-solid ${this.safeIcon(peer.avatar_icon, 'fa-user')}"></i>
                      <span class="status-dot status-${this.safeStatus(peer.status)} absolute -bottom-0.5 -right-0.5"></span>
                    </div>
                    <div class="truncate">
                      <div class="text-sm font-bold text-primary-token">${this.escapeHtml(peer.display_name || peer.username)} <span class="text-xs font-normal text-muted-token">@${this.escapeHtml(peer.username)}</span></div>
                      <div class="text-xs text-muted-token truncate">${this.escapeHtml(peer.custom_status || peer.status)}</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    ${row.status === 'pending_incoming' ? `
                      <button data-action="acceptFriendRequest" data-action-args="${this.encodeActionArgs([row.id])}" class="px-3 py-1.5 rounded bg-[#23A55A] text-white text-xs font-semibold">Accept</button>
                      <button data-action="removeFriendRow" data-action-args="${this.encodeActionArgs([row.id])}" class="px-3 py-1.5 rounded bg-[#F23F43] text-white text-xs font-semibold">Ignore</button>
                    ` : `
                      <button data-action="startDmWithUser" data-action-args="${this.encodeActionArgs([peer.id])}" class="p-2 rounded-full bg-input hover:bg-[#7C5CFF] hover:text-white text-secondary-token" title="Message">
                        <i class="fa-solid fa-message text-xs"></i>
                      </button>
                      <button data-action="startDmWithUser" data-action-args="${this.encodeActionArgs([peer.id, true])}" class="p-2 rounded-full bg-input hover:bg-[#23A55A] hover:text-white text-secondary-token" title="Start Video Call">
                        <i class="fa-solid fa-video text-xs"></i>
                      </button>
                      <button data-action="blockFriendRow" data-action-args="${this.encodeActionArgs([row.id])}" class="p-2 rounded-full bg-input hover:bg-[#F23F43] hover:text-white text-secondary-token" title="Block User">
                        <i class="fa-solid fa-ban text-xs"></i>
                      </button>
                      <button data-action="removeFriendRow" data-action-args="${this.encodeActionArgs([row.id])}" class="p-2 rounded-full bg-input hover:bg-[#F23F43] hover:text-white text-secondary-token" title="Remove Friend">
                        <i class="fa-solid fa-user-xmark text-xs"></i>
                      </button>
                    `}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  renderDmConversationStage() {
    const convId = this.state.activeDmConversationId;
    const convMsgs = this.state.directMessages.filter((d) => d.conversation_id === convId);
    const first = convMsgs[0];
    let title = 'Direct Message';
    if (first) {
      if (first.is_group) title = first.group_name || 'Group DM';
      else {
        const other = (first.participant_ids || []).find((id) => id !== this.state.currentUserId);
        if (other) title = this.getUserById(other).display_name;
      }
    }

    const inCall = this.rtc.mode === 'dm' && this.rtc.activeDmConversationId === convId && Boolean(this.rtc.room);
    const callParticipants = inCall
      ? [this.rtc.room.localParticipant.identity, ...Array.from(this.rtc.room.remoteParticipants.keys())]
      : [];
    const me = this.getCurrentUser();
    const remoteScreens = Array.from(this.rtc.remoteVideoTracks.keys()).filter((key) => key.startsWith('screen:'));

    return `
      <div class="flex flex-col h-full overflow-hidden">
        ${inCall ? `
          <div class="voice-theater-stage border-b border-subtle p-4 flex flex-col gap-3 shrink-0" style="max-height: 58%">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span class="text-xs font-bold flex items-center gap-2 text-[#2DD4A7]">
                <span class="w-2 h-2 rounded-full bg-[#2DD4A7] animate-pulse"></span>
                LIVE CALL — ${this.escapeHtml(title)}
                <span class="text-white/50 font-medium">• ${callParticipants.length} connected</span>
              </span>
              <button data-action="endDirectVideoCall" class="px-3 py-1.5 rounded-lg bg-[#FF5F6D] hover:brightness-110 text-white text-xs font-bold">
                <i class="fa-solid fa-phone-slash mr-1"></i>Leave Call
              </button>
            </div>
            <div class="video-stage-grid flex-1 overflow-y-auto">
              ${remoteScreens.map((key) => {
                const identity = key.slice('screen:'.length);
                const u = this.getUserById(identity);
                return `<div class="video-tile screen-share-tile featured-screen-share" data-user-identity="${this.escapeAttr(identity)}">
                  <video id="remote-screen-${this.escapeAttr(identity)}" data-remote-identity="${this.escapeAttr(identity)}" data-remote-source="screen" autoplay playsinline class="w-full h-full object-contain absolute inset-0"></video>
                  <span class="absolute top-3 left-3 bg-black/70 text-white text-xs px-2 py-1 rounded">${this.escapeHtml(u.display_name || u.username)} — Screen</span>
                </div>`;
              }).join('')}
              ${callParticipants.map((identity) => {
                const u = this.getUserById(identity);
                const isLocal = identity === me.id;
                const meta = this.rtc.getParticipantState(identity) || {};
                const videoOn = isLocal ? this.rtc.isVideoEnabled : this.rtc.remoteVideoTracks.has(`camera:${identity}`);
                const speaking = isLocal ? this.rtc.isSpeaking : Boolean(meta.speaking);
                return `<div class="video-tile ${speaking ? 'speaking-ring' : ''}" data-user-identity="${this.escapeAttr(identity)}" title="Right-click for volume and user actions">
                  ${isLocal && videoOn ? '<video id="local-camera-video" autoplay playsinline muted></video>' : ''}
                  ${!isLocal && videoOn ? `<video id="remote-camera-${this.escapeAttr(identity)}" data-remote-identity="${this.escapeAttr(identity)}" data-remote-source="camera" autoplay playsinline class="w-full h-full object-cover absolute inset-0"></video>` : ''}
                  ${!videoOn ? this.avatarHtml(u, { size: 'w-16 h-16', text: 'text-2xl', ring: speaking ? 'avatar-speaking' : '' }) : ''}
                  <div class="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <span class="bg-black/70 text-white text-xs px-2 py-0.5 rounded">${this.escapeHtml(u.display_name || u.username)}${isLocal ? ' (You)' : ''}</span>
                    <span class="flex items-center gap-1">${meta.muted || (isLocal && this.rtc.isMuted) ? '<span class="bg-[#FF5F6D] text-white p-1 rounded text-[10px]"><i class="fa-solid fa-microphone-slash"></i></span>' : ''}</span>
                  </div>
                </div>`;
              }).join('')}
              ${callParticipants.length < 2 ? `<div class="video-tile" style="grid-column: 1 / -1">
                <div class="text-center px-6 text-white/70">
                  <i class="fa-solid fa-phone-volume text-2xl mb-2 text-[#7C5CFF]"></i>
                  <div class="text-sm font-semibold text-white">Waiting for others to join…</div>
                  <div class="text-[11px] mt-1">Others can join from this conversation's call buttons.</div>
                </div>
              </div>` : ''}
            </div>
            <div class="flex items-center justify-center gap-2 flex-wrap">
              <button data-action="handleToggleMute" class="px-3 py-1.5 rounded-lg ${this.rtc.isMuted ? 'bg-[#FF5F6D]' : 'bg-white/10 hover:bg-white/20'} text-white text-xs font-semibold">
                <i class="fa-solid ${this.rtc.isMuted ? 'fa-microphone-slash' : 'fa-microphone'} mr-1"></i>${this.rtc.isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button data-action="handleToggleDeafen" class="px-3 py-1.5 rounded-lg ${this.rtc.isDeafened ? 'bg-[#FF5F6D]' : 'bg-white/10 hover:bg-white/20'} text-white text-xs font-semibold">
                <i class="fa-solid fa-headphones mr-1"></i>${this.rtc.isDeafened ? 'Undeafen' : 'Deafen'}
              </button>
              <button data-action="handleToggleCamera" class="px-3 py-1.5 rounded-lg ${this.rtc.isVideoEnabled ? 'bg-[#2DD4A7] text-[#07131a]' : 'bg-white/10 hover:bg-white/20'} text-white text-xs font-semibold">
                <i class="fa-solid fa-video mr-1"></i>Camera
              </button>
              <button data-action="handleToggleScreenShare" class="px-3 py-1.5 rounded-lg ${this.rtc.isScreenSharing ? 'bg-[#7C5CFF]' : 'bg-white/10 hover:bg-white/20'} text-white text-xs font-semibold">
                <i class="fa-solid fa-desktop mr-1"></i>${this.rtc.isScreenSharing ? 'Stop Share' : 'Share Screen'}
              </button>
            </div>
          </div>
        ` : ''}

        <div class="flex-1 overflow-y-auto py-4 space-y-1">
          ${convMsgs.length === 0 ? '<div class="px-6 py-10 text-center text-sm text-muted-token">No messages in this conversation yet.</div>' : convMsgs.map((m) => this.renderSingleMessageRow(m, true)).join('')}
        </div>
        ${this.renderMessageComposer(title, true)}
      </div>
    `;
  }

  renderIncomingCallBanner() {
    const call = this.state.incomingCall;
    if (!call) return '';
    const caller = this.getUserById(call.startedBy);
    return `
      <div class="mx-4 mt-3 p-3 rounded-xl border border-[#2DD4A7]/40 bg-[#2DD4A7]/10 flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2.5 min-w-0">
          ${this.avatarHtml(caller, { size: 'w-9 h-9', text: 'text-xs' })}
          <div class="min-w-0">
            <div class="text-sm font-bold text-primary-token truncate">${this.escapeHtml(caller.display_name || caller.username)} is calling</div>
            <div class="text-[11px] text-muted-token">Incoming voice call in this conversation</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button data-action="acceptIncomingCall" class="px-3 py-1.5 rounded-lg bg-[#2DD4A7] text-[#07131a] text-xs font-bold">Join Call</button>
          <button data-action="declineIncomingCall" class="px-3 py-1.5 rounded-lg bg-white/10 text-primary-token text-xs font-semibold">Dismiss</button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Right Member List Sidebar & User Control Bar
  // =========================================================================

  renderRightSidebar() {
    const el = document.getElementById('right-member-sidebar');
    if (!el) return;
    const activeVoiceChannelId = this.rtc.activeChannelId;
    const liveVoiceIds = activeVoiceChannelId ? this.getLiveVoiceParticipantIds(activeVoiceChannelId) : [];

    if (!this.state.showMemberList) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');

    if (this.state.viewMode === 'dms') {
      // Show Active Now & Architecture Status in DMs
      el.innerHTML = `
        <div class="p-4 space-y-4">
          <h3 class="text-xs font-bold uppercase tracking-wider text-muted-token">Live Voice Participants</h3>
          ${liveVoiceIds.map((userId) => {
            const u = this.getUserById(userId);
            const ch = this.state.channels.find((c) => c.id === activeVoiceChannelId);
            return `
              <div class="p-3 rounded-lg bg-elevated border border-subtle space-y-1.5">
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs" style="background-color: ${this.safeColor(u.avatar_color, '#7C5CFF')}">
                    <i class="fa-solid ${this.safeIcon(u.avatar_icon, 'fa-user')}"></i>
                  </div>
                  <div class="min-w-0">
                    <div class="text-xs font-bold text-primary-token truncate">${this.escapeHtml(u.display_name)}</div>
                    <div class="text-[11px] text-[#23A55A] truncate"><i class="fa-solid fa-volume-high mr-1"></i>${this.escapeHtml(ch ? ch.name : 'Voice Room')}</div>
                  </div>
                </div>
              </div>
            `;
          }).join('') || '<p class="text-[11px] text-muted-token">Join a voice channel to see its live participants here.</p>'}

          <div class="p-3 rounded-lg bg-elevated border border-subtle space-y-2">
            <div class="text-xs font-bold text-primary-token">Deployment status</div>
            <div class="text-[11px] text-muted-token">Verify the Railway health endpoint and test a real two-user voice room. This panel does not report remote service health.</div>
            <button data-action="openModal" data-action-args="${this.encodeActionArgs(['railwayBlueprint'])}" class="w-full mt-1 py-1.5 rounded bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-semibold">
              Inspect Deployment Files
            </button>
          </div>
        </div>
      `;
      return;
    }

    const srv = this.getActiveServer();
    if (!srv) return;

    const members = this.state.serverMembers.filter((m) => m.server_id === srv.id);
    const roles = this.state.roles
      .filter((r) => r.server_id === srv.id && r.hoist)
      .sort((a, b) => (b.position || 0) - (a.position || 0));

    const assignedMemberIds = new Set();
    let html = `<div class="p-3 space-y-4">`;

    roles.forEach((role) => {
      const roleMembers = members.filter((m) => {
        const rIds = Array.isArray(m.role_ids) ? m.role_ids : [];
        if (rIds.includes(role.id) && !assignedMemberIds.has(m.user_id)) {
          assignedMemberIds.add(m.user_id);
          return true;
        }
        return false;
      });

      if (roleMembers.length > 0) {
        html += `
          <div>
            <div class="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-token">
              ${this.escapeHtml(role.name)} — ${roleMembers.length}
            </div>
            <div class="space-y-0.5">
              ${roleMembers.map((m) => this.renderMemberListItem(m, role.color)).join('')}
            </div>
          </div>
        `;
      }
    });

    const remaining = members.filter((m) => !assignedMemberIds.has(m.user_id));
    if (remaining.length > 0) {
      html += `
        <div>
          <div class="px-2 mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-token">
            Members — ${remaining.length}
          </div>
          <div class="space-y-0.5">
            ${remaining.map((m) => this.renderMemberListItem(m, null)).join('')}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    el.innerHTML = html;
  }

  renderMemberListItem(memberRow, roleColor) {
    const u = this.getUserById(memberRow.user_id);
    const server = this.getActiveServer();
    const roles = this.state.roles.filter((role) => role.server_id === server?.id && role.name !== '@everyone');
    const canManageRoles = this.hasPermission('MANAGE_ROLES', server?.id) && memberRow.user_id !== server?.owner_id;
    return `
      <div data-action="openUserProfileModal" data-action-args="${this.encodeActionArgs([u.id])}" data-user-identity="${this.escapeAttr(u.id)}" class="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/5 cursor-pointer transition">
        ${this.avatarHtml(u, { size: 'w-8 h-8', text: 'text-xs', status: true })}
        <div class="min-w-0 flex-1">
          <div class="text-xs font-semibold truncate" style="color: ${this.safeColor(roleColor, 'var(--text-primary)')}">
            ${this.escapeHtml(memberRow.nickname || u.display_name || u.username)}
          </div>
          ${u.custom_status ? `<div class="text-[10px] text-muted-token truncate">${this.escapeHtml(u.custom_status)}</div>` : ''}
        </div>
        ${canManageRoles ? `<div class="flex items-center gap-1" data-stop-click="true"><select id="member-role-${this.escapeAttr(memberRow.id)}" title="Choose a role to add or remove" class="max-w-24 text-[10px] bg-input text-primary-token rounded p-1"><option value="">Choose role</option>${roles.map((role) => `<option value="${this.escapeAttr(role.id)}">${(memberRow.role_ids || []).includes(role.id) ? '✓ ' : ''}${this.escapeHtml(role.name)}</option>`).join('')}</select><button data-action="toggleSelectedMemberRole" data-action-args="${this.encodeActionArgs([memberRow.id])}" data-stop-click="true" class="text-[9px] bg-white/10 px-1.5 py-1 rounded" title="Toggle selected role">Set</button></div>` : ''}
      </div>
    `;
  }

  renderUserControlPanel() {
    const panel = document.getElementById('user-control-panel');
    if (!panel) return;
    const me = this.getCurrentUser();

    panel.innerHTML = `
      <div class="flex items-center justify-between gap-2 px-2 py-1.5 bg-elevated border-t border-subtle">
        <div data-action="openModal" data-action-args="${this.encodeActionArgs(['userSettings'])}" class="flex items-center gap-2 min-w-0 p-1 rounded hover:bg-white/5 cursor-pointer flex-1" title="Account, Status & Session Switcher">
          ${this.avatarHtml(me, { size: 'w-8 h-8', text: 'text-xs', status: true, ring: this.rtc.isSpeaking ? 'avatar-speaking' : '' })}
          <div class="min-w-0">
            <div class="text-xs font-bold text-primary-token truncate">${this.escapeHtml(me.display_name || me.username)}</div>
            <div class="text-[10px] text-muted-token truncate">${this.escapeHtml(me.custom_status || '#' + (me.discriminator || '0001'))}</div>
          </div>
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <button data-action="handleToggleMute" class="p-1.5 rounded hover:bg-white/10 ${this.rtc.isMuted ? 'text-[#F23F43]' : 'text-secondary-token hover:text-primary-token'}" title="${this.rtc.isMuted ? 'Unmute' : 'Mute'}">
            <i class="fa-solid ${this.rtc.isMuted ? 'fa-microphone-slash' : 'fa-microphone'} text-xs"></i>
          </button>
          <button data-action="handleToggleDeafen" class="p-1.5 rounded hover:bg-white/10 ${this.rtc.isDeafened ? 'text-[#F23F43]' : 'text-secondary-token hover:text-primary-token'}" title="${this.rtc.isDeafened ? 'Undeafen' : 'Deafen'}">
            <i class="fa-solid ${this.rtc.isDeafened ? 'fa-ear-deaf' : 'fa-headphones'} text-xs"></i>
          </button>
          <button data-action="openModal" data-action-args="${this.encodeActionArgs(['userSettings'])}" class="p-1.5 rounded hover:bg-white/10 text-secondary-token hover:text-primary-token" title="User Settings & Account Switcher">
            <i class="fa-solid fa-gear text-xs"></i>
          </button>
        </div>
      </div>
    `;
  }

  renderVoiceConnectionBar() {
    const bar = document.getElementById('voice-connection-status-bar');
    if (!bar) return;

    if (!this.rtc.activeChannelId) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }

    bar.classList.remove('hidden');
    const ch = this.state.channels.find((c) => c.id === this.rtc.activeChannelId);
    const srv = this.state.servers.find((s) => s.id === this.rtc.activeServerId);

    bar.innerHTML = `
      <div class="px-3 py-2 bg-[#111214] border-t border-subtle text-xs space-y-2">
        <div class="flex items-center justify-between">
          <div class="min-w-0">
            <div class="font-bold ${this.rtc.connectionStatus === 'connected' ? 'text-[#23A55A]' : 'text-[#F0B232]'} flex items-center gap-1.5">
              <i class="fa-solid ${this.rtc.connectionStatus === 'connected' ? 'fa-signal' : 'fa-rotate'}"></i>
              <span>${this.rtc.connectionStatus === 'connected' ? 'Voice Connected' : this.rtc.connectionStatus === 'reconnecting' ? 'Reconnecting…' : this.rtc.connectionStatus === 'connecting' ? 'Connecting…' : 'Voice Disconnected'}</span>
            </div>
            <div data-action="selectChannel" data-action-args="${this.encodeActionArgs([this.rtc.activeChannelId])}" class="text-[11px] text-gray-400 hover:underline cursor-pointer truncate">
              ${this.escapeHtml(ch ? ch.name : 'Voice')} / ${this.escapeHtml(srv ? srv.name : '')}
            </div>
          </div>
          <button data-action="handleDisconnectVoice" class="p-1.5 rounded hover:bg-[#F23F43]/20 text-[#F23F43]" title="Disconnect Voice">
            <i class="fa-solid fa-phone-slash"></i>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button data-action="handleToggleCamera" class="py-1 px-2 rounded ${this.rtc.isVideoEnabled ? 'bg-[#23A55A] text-white' : 'bg-white/10 text-gray-200 hover:bg-white/15'} font-semibold flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-video"></i>
            <span>Video</span>
          </button>
          <button data-action="handleToggleScreenShare" class="py-1 px-2 rounded ${this.rtc.isScreenSharing ? 'bg-[#7C5CFF] text-white' : 'bg-white/10 text-gray-200 hover:bg-white/15'} font-semibold flex items-center justify-center gap-1.5">
            <i class="fa-solid fa-desktop"></i>
            <span>Screen</span>
          </button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Popovers & Drawers (Thread, Pinned, Notifications)
  // =========================================================================

  renderThreadDrawer() {
    const parent = this.state.activeThreadMessage;
    if (!parent) return '';
    const author = this.getUserById(parent.user_id);
    const replies = this.state.messages.filter((m) => m.reply_to_id === parent.id);

    return `
      <div class="w-80 sm:w-96 bg-sidebar border-l border-subtle flex flex-col h-full shrink-0 z-20">
        <div class="p-3 border-b border-subtle flex items-center justify-between">
          <div class="flex items-center gap-2 font-bold text-sm text-primary-token truncate">
            <i class="fa-solid fa-comments text-[#7C5CFF]"></i>
            <span class="truncate">${this.escapeHtml(parent.thread_name || 'Thread Discussion')}</span>
          </div>
          <button data-action="closeThread" class="text-muted-token hover:text-primary-token">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-3">
          <div class="p-3 rounded-lg bg-elevated border border-subtle">
            <div class="text-xs font-bold text-primary-token">${this.escapeHtml(author.display_name)}</div>
            <div class="text-xs text-secondary-token mt-1">${this.formatMessageContent(parent.content || '')}</div>
          </div>
          <div class="text-[11px] font-bold uppercase tracking-wider text-muted-token">${replies.length} Thread Replies</div>
          ${replies.map((r) => {
            const ru = this.getUserById(r.user_id);
            return `
              <div class="p-2.5 rounded bg-elevated/60 border border-subtle">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-primary-token">${this.escapeHtml(ru.display_name)}</span>
                  <span class="text-[10px] text-muted-token">${this.formatTimestamp(r.timestamp_iso)}</span>
                </div>
                <div class="text-xs text-secondary-token mt-1">${this.formatMessageContent(r.content || '')}</div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="p-3 border-t border-subtle flex gap-2">
          <input id="thread-reply-input" type="text" placeholder="Reply in thread..." data-key-action="thread-reply" data-key-action-args="${this.encodeActionArgs([parent.id])}" class="flex-1 bg-input text-xs text-primary-token px-3 py-2 rounded outline-none" />
          <button data-action="sendThreadReply" data-action-args="${this.encodeActionArgs([parent.id])}" class="bg-[#7C5CFF] text-white text-xs font-semibold px-3 py-2 rounded">Send</button>
        </div>
      </div>
    `;
  }

  renderPinnedMessagesPopover(channelId) {
    const pinned = this.state.messages.filter((m) => m.channel_id === channelId && m.pinned);
    return `
      <div class="absolute top-2 right-4 w-80 sm:w-96 bg-floating border border-subtle rounded-xl shadow-2xl z-30 overflow-hidden">
        <div class="px-4 py-3 bg-elevated border-b border-subtle flex items-center justify-between">
          <span class="font-bold text-xs uppercase tracking-wider text-primary-token"><i class="fa-solid fa-thumbtack text-[#F0B232] mr-1.5"></i>Pinned Messages (${pinned.length})</span>
          <button data-action="togglePinnedPopover" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="max-h-80 overflow-y-auto p-3 space-y-2">
          ${pinned.length === 0 ? `<div class="text-xs text-muted-token py-6 text-center">No pinned messages in this channel yet.</div>` : pinned.map((m) => {
            const u = this.getUserById(m.user_id);
            return `
              <div class="p-3 rounded-lg bg-elevated border border-subtle space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-primary-token">${this.escapeHtml(u.display_name)}</span>
                  <button data-action="togglePinMessage" data-action-args="${this.encodeActionArgs([m.id, false])}" class="text-[10px] text-[#F23F43] hover:underline">Unpin</button>
                </div>
                <div class="text-xs text-secondary-token">${this.formatMessageContent(m.content || '')}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  renderNotificationsPopover() {
    const myNotifs = this.state.notifications.filter((n) => n.user_id === this.state.currentUserId);
    return `
      <div class="absolute top-2 right-4 w-80 sm:w-96 bg-floating border border-subtle rounded-xl shadow-2xl z-30 overflow-hidden">
        <div class="px-4 py-3 bg-elevated border-b border-subtle flex items-center justify-between">
          <span class="font-bold text-xs uppercase tracking-wider text-primary-token"><i class="fa-solid fa-bell text-[#7C5CFF] mr-1.5"></i>Inbox & Notifications</span>
          <div class="flex items-center gap-2">
            <button data-action="markAllNotificationsRead" class="text-[11px] text-[#7C5CFF] hover:underline">Mark all read</button>
            <button data-action="toggleNotificationsPopover" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </div>
        <div class="max-h-80 overflow-y-auto p-3 space-y-2">
          ${myNotifs.length === 0 ? `<div class="text-xs text-muted-token py-6 text-center">All caught up!</div>` : myNotifs.map((n) => `
            <div class="p-3 rounded-lg ${n.read ? 'bg-elevated/50 opacity-70' : 'bg-elevated border-l-2 border-[#7C5CFF]'} text-xs space-y-1">
              <div class="font-bold text-primary-token">${this.escapeHtml(n.title)}</div>
              <div class="text-secondary-token">${this.escapeHtml(n.body)}</div>
              <div class="text-[10px] text-muted-token">${this.formatTimestamp(n.timestamp_iso)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Modals (Server Settings/RBAC/AuditLog, Create/Join Server, User/Auth, Railway Blueprint)
  // =========================================================================

  renderModals() {
    const root = document.getElementById('modal-root');
    if (!root) return;
    if (!this.state.activeModal) {
      root.innerHTML = '';
      return;
    }

    if (this.state.activeModal === 'createJoinServer') {
      root.innerHTML = this.renderCreateJoinServerModal();
    } else if (this.state.activeModal === 'serverSettings') {
      root.innerHTML = this.renderServerSettingsModal();
    } else if (this.state.activeModal === 'inviteModal') {
      root.innerHTML = this.renderInviteModal();
    } else if (this.state.activeModal === 'userSettings') {
      root.innerHTML = this.renderUserSettingsModal();
    } else if (this.state.activeModal === 'railwayBlueprint') {
      root.innerHTML = this.renderRailwayBlueprintModal();
    } else if (this.state.activeModal === 'mediaDevicesModal') {
      root.innerHTML = this.renderMediaDevicesModal();
    } else if (this.state.activeModal === 'newDmModal') {
      root.innerHTML = this.renderNewDmModal();
    } else if (this.state.activeModal.startsWith('profile:')) {
      const uid = this.state.activeModal.split(':')[1];
      root.innerHTML = this.renderUserProfileModal(uid);
    } else if (this.state.activeModal.startsWith('createChannel:')) {
      const cat = this.state.activeModal.slice('createChannel:'.length);
      root.innerHTML = this.renderCreateChannelModal(cat);
    } else {
      root.innerHTML = '';
    }
  }

  renderCreateJoinServerModal() {
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-md w-full p-6 shadow-2xl space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-extrabold text-primary-token">Create or Join a Server</h3>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="space-y-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-muted-token">Create a New Server</h4>
            <input id="new-server-name" type="text" placeholder="Server Name (e.g. WebRTC Systems Lab)" class="w-full bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle outline-none" />
            <input id="new-server-desc" type="text" placeholder="Short description..." class="w-full bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle outline-none" />
            <button data-action="createNewServer" class="w-full bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-bold py-2.5 rounded-lg">
              Create Server
            </button>
          </div>

          <div class="border-t border-subtle pt-4 space-y-3">
            <h4 class="text-xs font-bold uppercase tracking-wider text-muted-token">Join via Invite Code</h4>
            <p class="text-xs text-muted-token">Ask a server member for its invite code, or open <strong class="text-primary-token">Invite People</strong> from a server you already belong to.</p>
            <div class="flex gap-2">
              <input id="join-invite-code" type="text" placeholder="Enter invite code..." class="flex-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle outline-none" />
              <button data-action="joinServerByInvite" class="bg-[#23A55A] hover:bg-[#1e8e4c] text-white text-xs font-bold px-4 py-2 rounded-lg">
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderServerSettingsModal() {
    const srv = this.getActiveServer();
    if (!srv) return '';
    const tab = this.state.serverSettingsTab;
    const srvRoles = this.state.roles.filter((r) => r.server_id === srv.id).sort((a, b) => (b.position || 0) - (a.position || 0));
    const srvMembers = this.state.serverMembers.filter((m) => m.server_id === srv.id);
    const srvLogs = this.state.auditLogs.filter((a) => a.server_id === srv.id);

    const selectedRole = srvRoles.find((r) => r.id === this.state.selectedRoleIdForEdit) || srvRoles[0];

    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-4xl w-full h-[82vh] flex overflow-hidden shadow-2xl">
          <!-- Left Tab Navigation -->
          <div class="w-52 bg-elevated p-4 border-r border-subtle flex flex-col justify-between shrink-0">
            <div class="space-y-1">
              <div class="text-[11px] font-bold uppercase tracking-wider text-muted-token px-2 mb-2 truncate">${this.escapeHtml(srv.name)}</div>
              <button data-action="setServerSettingsTab" data-action-args="${this.encodeActionArgs(['overview'])}" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold ${tab === 'overview' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">Overview</button>
              <button data-action="setServerSettingsTab" data-action-args="${this.encodeActionArgs(['roles'])}" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold ${tab === 'roles' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">Roles & Permissions</button>
              <button data-action="setServerSettingsTab" data-action-args="${this.encodeActionArgs(['members'])}" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold ${tab === 'members' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">Members & Moderation</button>
              <button data-action="setServerSettingsTab" data-action-args="${this.encodeActionArgs(['audit'])}" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold ${tab === 'audit' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">Audit Logs (${srvLogs.length})</button>
            </div>
            <div class="space-y-1 border-t border-subtle pt-3">
              <button data-action="leaveCurrentServer" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold text-[#F0B232] hover:bg-white/5">Leave Server</button>
              ${srv.owner_id === this.state.currentUserId ? `
                <button data-action="deleteCurrentServer" class="w-full text-left px-3 py-1.5 rounded text-xs font-semibold text-[#F23F43] hover:bg-white/5">Delete Server</button>
              ` : ''}
            </div>
          </div>

          <!-- Right Content Area -->
          <div class="flex-1 p-6 overflow-y-auto">
            <div class="flex items-center justify-between mb-5">
              <h3 class="text-lg font-extrabold text-primary-token uppercase tracking-wide">${tab}</h3>
              <button data-action="closeModal" class="text-muted-token hover:text-primary-token text-sm"><i class="fa-solid fa-circle-xmark text-lg"></i></button>
            </div>

            ${tab === 'overview' ? `
              <div class="space-y-4 max-w-lg">
                <div>
                  <label class="text-xs font-bold uppercase text-muted-token">Server Name</label>
                  <input id="srv-edit-name" type="text" value="${this.escapeAttr(srv.name)}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
                </div>
                <div>
                  <label class="text-xs font-bold uppercase text-muted-token">Description</label>
                  <input id="srv-edit-desc" type="text" value="${this.escapeAttr(srv.description || '')}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="text-xs font-bold uppercase text-muted-token">Icon Badge Text</label>
                    <input id="srv-edit-icon" type="text" maxlength="3" value="${this.escapeAttr(srv.icon_text || 'PC')}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
                  </div>
                  <div>
                    <label class="text-xs font-bold uppercase text-muted-token">Railway Voice Region</label>
                    <input id="srv-edit-region" type="text" value="${this.escapeAttr(srv.region || 'us-east-railway')}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
                  </div>
                </div>
                <button data-action="saveServerOverview" class="bg-[#23A55A] hover:bg-[#1e8e4c] text-white text-xs font-bold px-5 py-2.5 rounded-lg">
                  Save Changes
                </button>
              </div>
            ` : ''}

            ${tab === 'roles' ? `
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="space-y-2">
                  <button data-action="createNewRole" class="w-full bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-bold py-2 rounded">
                    + Create Role
                  </button>
                  ${srvRoles.map((r) => `
                    <div data-action="selectRoleForEdit" data-action-args="${this.encodeActionArgs([r.id])}" class="p-2.5 rounded cursor-pointer border ${selectedRole && selectedRole.id === r.id ? 'bg-elevated border-[#7C5CFF]' : 'border-subtle hover:bg-white/5'} flex items-center justify-between text-xs">
                      <span class="font-bold flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full" style="background-color: ${this.safeColor(r.color, '#99AAB5')}"></span>
                        ${this.escapeHtml(r.name)}
                      </span>
                      <span class="text-[10px] text-muted-token">#${r.position || 1}</span>
                    </div>
                  `).join('')}
                </div>
                ${selectedRole ? `
                  <div class="md:col-span-2 bg-elevated p-4 rounded-lg border border-subtle space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <label class="text-[11px] font-bold uppercase text-muted-token">Role Name</label>
                        <input id="role-edit-name" type="text" value="${this.escapeAttr(selectedRole.name)}" class="w-full mt-1 bg-input text-xs text-primary-token px-2.5 py-1.5 rounded" />
                      </div>
                      <div>
                        <label class="text-[11px] font-bold uppercase text-muted-token">Hex Color</label>
                        <input id="role-edit-color" type="text" value="${this.escapeAttr(selectedRole.color || '#7C5CFF')}" class="w-full mt-1 bg-input text-xs text-primary-token px-2.5 py-1.5 rounded" />
                      </div>
                    </div>
                    <div class="text-[11px] font-bold uppercase text-muted-token pt-2">Bitfield Permissions</div>
                    <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
                      ${PERMISSION_CATALOG.map((p) => {
                        const has = Array.isArray(selectedRole.permissions) && selectedRole.permissions.includes(p.key);
                        return `
                          <label class="flex items-start justify-between gap-2 p-2 rounded bg-input/60 cursor-pointer">
                            <div>
                              <div class="text-xs font-bold text-primary-token">${p.label}</div>
                              <div class="text-[10px] text-muted-token">${p.desc}</div>
                            </div>
                            <input type="checkbox" class="role-perm-checkbox mt-1" value="${p.key}" ${has ? 'checked' : ''} />
                          </label>
                        `;
                      }).join('')}
                    </div>
                    <button data-action="saveRoleChanges" data-action-args="${this.encodeActionArgs([selectedRole.id])}" class="bg-[#23A55A] text-white text-xs font-bold px-4 py-2 rounded">
                      Save Role & Permissions
                    </button>
                  </div>
                ` : ''}
              </div>
            ` : ''}

            ${tab === 'members' ? `
              <div class="space-y-2">
                ${srvMembers.map((m) => {
                  const u = this.getUserById(m.user_id);
                  return `
                    <div class="p-3 rounded-lg bg-elevated border border-subtle flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs" style="background-color: ${this.safeColor(u.avatar_color, '#7C5CFF')}">
                          <i class="fa-solid ${this.safeIcon(u.avatar_icon, 'fa-user')}"></i>
                        </div>
                        <div>
                          <div class="text-xs font-bold text-primary-token">${this.escapeHtml(u.display_name)} (@${this.escapeHtml(u.username)})</div>
                          <div class="text-[10px] text-muted-token">Joined ${this.formatTimestamp(m.joined_at)}</div>
                        </div>
                      </div>
                      ${u.id !== srv.owner_id ? `
                        <div class="flex items-center gap-2">
                          <button data-action="kickServerMember" data-action-args="${this.encodeActionArgs([m.id, u.display_name])}" class="px-2.5 py-1 rounded bg-[#F0B232]/20 text-[#F0B232] text-xs font-semibold">Kick</button>
                          <button data-action="banServerMember" data-action-args="${this.encodeActionArgs([m.id, u.id, u.display_name])}" class="px-2.5 py-1 rounded bg-[#F23F43] text-white text-xs font-semibold">Ban</button>
                        </div>
                      ` : `<span class="text-[10px] bg-[#FEE75C]/20 text-[#FEE75C] px-2 py-0.5 rounded font-bold">SERVER OWNER</span>`}
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}

            ${tab === 'audit' ? `
              <div class="space-y-2">
                ${srvLogs.map((log) => {
                  const actor = this.getUserById(log.actor_id);
                  return `
                    <div class="p-3 rounded-lg bg-elevated border border-subtle text-xs space-y-1">
                      <div class="flex items-center justify-between">
                        <span class="font-bold text-[#7C5CFF]">[${this.escapeHtml(log.action_type)}] <span class="text-primary-token">${this.escapeHtml(log.target_name || '')}</span></span>
                        <span class="text-[10px] text-muted-token">${this.formatTimestamp(log.timestamp_iso)}</span>
                      </div>
                      <div class="text-secondary-token">${this.escapeHtml(log.details || '')}</div>
                      <div class="text-[10px] text-muted-token">Actor: @${this.escapeHtml(actor.username)}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderUserSettingsModal() {
    const me = this.getCurrentUser();
    const previewAvatar = this.state.avatarDraft || me.avatar_url || '';
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-2xl max-w-2xl w-full p-6 space-y-5 max-h-[88vh] overflow-y-auto">
          <div class="flex items-center justify-between border-b border-subtle pb-3">
            <div>
              <h3 class="text-lg font-extrabold text-primary-token">My Account</h3>
              <p class="text-[11px] text-muted-token">Profile, appearance and session</p>
            </div>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token" aria-label="Close settings"><i class="fa-solid fa-xmark"></i></button>
          </div>

          <div class="flex items-center gap-4 p-3 rounded-xl bg-elevated border border-subtle">
            <div class="w-16 h-16 rounded-full overflow-hidden bg-[#7C5CFF] grid place-items-center text-xl font-bold text-white shrink-0">
              ${previewAvatar ? `<img class="avatar-img" src="${this.escapeAttr(previewAvatar)}" alt="Avatar preview" />` : this.escapeHtml((me.display_name || me.username || 'M').slice(0, 1).toUpperCase())}
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-bold text-primary-token truncate">${this.escapeHtml(me.display_name || me.username)}</div>
              <div class="text-[11px] text-muted-token truncate">@${this.escapeHtml(me.username)}#${this.escapeHtml(me.discriminator || '0001')}</div>
              <div class="flex items-center gap-2 mt-2 flex-wrap">
                <label class="cursor-pointer text-[11px] font-semibold bg-[#7C5CFF] text-white px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                  <i class="fa-solid fa-upload"></i> Upload avatar
                  <input id="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-action="handleAvatarFileSelect" data-action-event="change" data-action-args="[]" />
                </label>
                <button data-action="removeAvatar" class="text-[11px] font-semibold bg-white/10 hover:bg-white/20 text-primary-token px-2.5 py-1.5 rounded-lg">Remove</button>
                <span class="text-[10px] text-muted-token">PNG / JPEG / WebP, cropped to 256×256</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="text-[11px] font-bold uppercase text-muted-token">Display Name</label>
              <input id="usr-edit-display" type="text" maxlength="64" value="${this.escapeAttr(me.display_name || '')}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle" />
            </div>
            <div>
              <label class="text-[11px] font-bold uppercase text-muted-token">Presence Status</label>
              <select id="usr-edit-status" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle">
                <option value="online" ${me.status === 'online' ? 'selected' : ''}>Online</option>
                <option value="idle" ${me.status === 'idle' ? 'selected' : ''}>Idle</option>
                <option value="dnd" ${me.status === 'dnd' ? 'selected' : ''}>Do Not Disturb</option>
                <option value="offline" ${me.status === 'offline' ? 'selected' : ''}>Invisible</option>
              </select>
            </div>
            <div class="sm:col-span-2">
              <label class="text-[11px] font-bold uppercase text-muted-token">Custom Status Message</label>
              <input id="usr-edit-custom-status" type="text" maxlength="128" value="${this.escapeAttr(me.custom_status || '')}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle" />
            </div>
            <div class="sm:col-span-2">
              <label class="text-[11px] font-bold uppercase text-muted-token">Bio</label>
              <textarea id="usr-edit-bio" maxlength="280" rows="2" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle resize-none">${this.escapeHtml(me.bio || '')}</textarea>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-subtle pt-4">
            <div>
              <label class="text-[11px] font-bold uppercase text-muted-token">Theme</label>
              <select id="usr-edit-theme" data-action="setTheme" data-action-event="change" data-action-args="${this.encodeActionArgs([{ __pulsecordEventValue: true }])}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle">
                <option value="dark" ${this.state.theme === 'dark' ? 'selected' : ''}>Dark</option>
                <option value="light" ${this.state.theme === 'light' ? 'selected' : ''}>Light</option>
              </select>
            </div>
            <div>
              <label class="text-[11px] font-bold uppercase text-muted-token">Animations</label>
              <select id="usr-edit-motion" data-action="setMotion" data-action-event="change" data-action-args="${this.encodeActionArgs([{ __pulsecordEventValue: true }])}" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-1.5 rounded border border-subtle">
                <option value="full" ${this.state.motion === 'full' ? 'selected' : ''}>Full</option>
                <option value="reduced" ${this.state.motion === 'reduced' ? 'selected' : ''}>Reduced motion</option>
              </select>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-wrap">
            <button data-action="saveUserProfileSettings" class="bg-[#2DD4A7] hover:brightness-105 text-[#07131a] text-xs font-bold px-4 py-2 rounded-lg">Save Profile</button>
            <button data-action="openModal" data-action-args="${this.encodeActionArgs(['mediaDevicesModal'])}" class="bg-white/10 hover:bg-white/20 text-primary-token text-xs font-semibold px-3 py-2 rounded-lg"><i class="fa-solid fa-headphones mr-1"></i>Voice & Video devices</button>
          </div>

          <div class="border-t border-subtle pt-4 flex items-center justify-between gap-3 flex-wrap">
            <div><h4 class="text-xs font-bold uppercase tracking-wider text-muted-token">Authenticated session</h4><p class="text-xs text-secondary-token mt-1">Signed in as ${this.escapeHtml(me.username)}. Password hashes stay server-side.</p></div>
            <button data-action="logout" class="bg-[#FF5F6D] hover:brightness-110 text-white text-xs font-bold px-4 py-2 rounded-lg">Sign out</button>
          </div>
        </div>
      </div>
    `;
  }

  renderInviteModal() {
    const srv = this.getActiveServer();
    if (!srv) return '';
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-primary-token">Invite friends to ${this.escapeHtml(srv.name)}</h3>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <p class="text-xs text-muted-token">Share this invite code so others can join this server immediately:</p>
          <div class="flex items-center gap-2 bg-input p-2 rounded-lg border border-subtle">
            <input id="invite-code-copy" type="text" readonly value="${this.escapeAttr(srv.invite_code || srv.id)}" class="flex-1 bg-transparent text-sm font-mono text-primary-token outline-none px-2" />
            <button data-action="copyInviteCode" data-action-args="${this.encodeActionArgs([srv.invite_code || srv.id])}" class="bg-[#7C5CFF] text-white text-xs font-bold px-4 py-2 rounded">
              Copy
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderCreateChannelModal(categoryName) {
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-primary-token">Create Channel in ${this.escapeHtml(categoryName)}</h3>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div>
            <label class="text-xs font-bold uppercase text-muted-token">Channel Type</label>
            <select id="new-channel-type" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle">
              <option value="text"># Text Channel</option>
              <option value="voice">🔊 Voice & Video / Screen Share Channel</option>
              <option value="announcement">📢 Announcement Channel</option>
              <option value="forum">💬 Forum Channel</option>
            </select>
          </div>
          <div>
            <label class="text-xs font-bold uppercase text-muted-token">Channel Name</label>
            <input id="new-channel-name" type="text" placeholder="e.g. release-notes or pair-debugging" class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
          </div>
          <div>
            <label class="text-xs font-bold uppercase text-muted-token">Channel Topic</label>
            <input id="new-channel-topic" type="text" placeholder="Optional topic description..." class="w-full mt-1 bg-input text-sm text-primary-token px-3 py-2 rounded border border-subtle" />
          </div>
          <button data-action="createNewChannel" data-action-args="${this.encodeActionArgs([categoryName])}" class="w-full bg-[#7C5CFF] hover:bg-[#6B4BE6] text-white text-xs font-bold py-2.5 rounded-lg">
            Create Channel
          </button>
        </div>
      </div>
    `;
  }

  renderMediaDevicesModal() {
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-primary-token">WebRTC Audio & Video Hardware</h3>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="space-y-3 text-xs">
            <div>
              <label class="font-bold uppercase text-muted-token">Microphone Input (Echo Cancellation + Noise Suppression)</label>
              <select id="audio-input-select" data-action="changeMediaDevice" data-action-event="change" data-action-args="${this.encodeActionArgs(['audioinput', { __pulsecordEventValue: true }])}" class="w-full mt-1 bg-input text-primary-token px-3 py-2 rounded border border-subtle">
                <option value="default" ${this.rtc.selectedAudioInput === 'default' ? 'selected' : ''}>Default System Microphone</option>
                ${this.rtc.audioInputs.map((d) => `<option value="${this.escapeAttr(d.deviceId)}" ${this.rtc.selectedAudioInput === d.deviceId ? 'selected' : ''}>${this.escapeHtml(d.label || 'Audio Input')}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="font-bold uppercase text-muted-token">Audio Output Speaker</label>
              <select id="audio-output-select" data-action="changeMediaDevice" data-action-event="change" data-action-args="${this.encodeActionArgs(['audiooutput', { __pulsecordEventValue: true }])}" class="w-full mt-1 bg-input text-primary-token px-3 py-2 rounded border border-subtle">
                <option value="default" ${this.rtc.selectedAudioOutput === 'default' ? 'selected' : ''}>Default System Audio Output</option>
                ${this.rtc.audioOutputs.map((d) => `<option value="${this.escapeAttr(d.deviceId)}" ${this.rtc.selectedAudioOutput === d.deviceId ? 'selected' : ''}>${this.escapeHtml(d.label || 'Audio Output')}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="font-bold uppercase text-muted-token">Camera Video Input</label>
              <select id="video-input-select" data-action="changeMediaDevice" data-action-event="change" data-action-args="${this.encodeActionArgs(['videoinput', { __pulsecordEventValue: true }])}" class="w-full mt-1 bg-input text-primary-token px-3 py-2 rounded border border-subtle">
                <option value="default" ${this.rtc.selectedVideoInput === 'default' ? 'selected' : ''}>Default Camera</option>
                ${this.rtc.videoInputs.map((d) => `<option value="${this.escapeAttr(d.deviceId)}" ${this.rtc.selectedVideoInput === d.deviceId ? 'selected' : ''}>${this.escapeHtml(d.label || 'Video Camera')}</option>`).join('')}
              </select>
            </div>
          </div>
          <button data-action="closeModal" class="w-full bg-[#23A55A] text-white text-xs font-bold py-2 rounded-lg">Done</button>
        </div>
      </div>
    `;
  }

  renderNewDmModal() {
    const me = this.getCurrentUser();
    const others = this.state.users.filter((u) => u.id !== me.id);
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-base font-bold text-primary-token">Start Direct or Group Conversation</h3>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <input id="new-group-dm-name" type="text" placeholder="Optional Group Name (if selecting 2+ members)" class="w-full bg-input text-xs text-primary-token px-3 py-2 rounded border border-subtle" />
          <div class="space-y-1.5 max-h-56 overflow-y-auto">
            ${others.map((u) => `
              <label class="flex items-center justify-between p-2 rounded bg-elevated cursor-pointer">
                <span class="text-xs font-semibold text-primary-token">${this.escapeHtml(u.display_name)} (@${this.escapeHtml(u.username)})</span>
                <input type="checkbox" class="dm-peer-checkbox" value="${u.id}" />
              </label>
            `).join('')}
          </div>
          <button data-action="createCustomDmConversation" class="w-full bg-[#7C5CFF] text-white text-xs font-bold py-2.5 rounded-lg">
            Open Conversation
          </button>
        </div>
      </div>
    `;
  }

  renderUserProfileModal(userId) {
    const u = this.getUserById(userId);
    const roles = this.getUserRolesInServer(userId, this.state.activeServerId);
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-floating border border-subtle rounded-xl max-w-sm w-full overflow-hidden shadow-2xl">
          <div class="h-20" style="background-color: ${this.safeColor(u.banner_color, this.safeColor(u.avatar_color, '#7C5CFF'))}"></div>
          <div class="px-5 pb-5 relative">
            <div class="w-16 h-16 rounded-full border-4 border-[#111214] flex items-center justify-center text-white text-xl -mt-8 relative" style="background-color: ${this.safeColor(u.avatar_color, '#7C5CFF')}">
              <i class="fa-solid ${this.safeIcon(u.avatar_icon, 'fa-user')}"></i>
              <span class="status-dot status-${this.safeStatus(u.status)} absolute bottom-0 right-0"></span>
            </div>
            <div class="mt-3 flex items-center justify-between">
              <div>
                <h4 class="text-base font-extrabold text-primary-token">${this.escapeHtml(u.display_name)}</h4>
                <div class="text-xs text-muted-token">@${this.escapeHtml(u.username)}#${this.escapeHtml(u.discriminator || '0001')}</div>
              </div>
              <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark"></i></button>
            </div>
            ${u.custom_status ? `<div class="mt-2 text-xs text-secondary-token bg-elevated px-2.5 py-1.5 rounded">${this.escapeHtml(u.custom_status)}</div>` : ''}
            <div class="mt-3 text-xs text-secondary-token">${this.escapeHtml(u.bio || 'No bio set.')}</div>
            <div class="mt-3">
              <div class="text-[10px] font-bold uppercase text-muted-token mb-1">Server Roles</div>
              <div class="flex flex-wrap gap-1">
                ${roles.map((r) => `
                  <span class="text-[10px] px-2 py-0.5 rounded bg-elevated border border-subtle flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full" style="background-color: ${this.safeColor(r.color, '#99AAB5')}"></span>
                    ${this.escapeHtml(r.name)}
                  </span>
                `).join('')}
              </div>
            </div>
            ${u.id !== this.state.currentUserId ? `
              <div class="mt-4 flex gap-2">
                <button data-action="closeModalAndStartDm" data-action-args="${this.encodeActionArgs([u.id])}" class="flex-1 bg-[#7C5CFF] text-white text-xs font-bold py-2 rounded">Send DM</button>
                <button data-action="sendFriendRequestById" data-action-args="${this.encodeActionArgs([u.id])}" class="bg-[#23A55A] text-white text-xs font-bold px-3 py-2 rounded">+ Friend</button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  renderRailwayBlueprintModal() {
    const tab = this.state.blueprintTab || 'prisma';
    return `
      <div class="fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4">
        <div class="bg-sidebar border border-subtle rounded-xl max-w-4xl w-full h-[82vh] flex flex-col overflow-hidden shadow-2xl">
          <div class="px-6 py-4 bg-elevated border-b border-subtle flex items-center justify-between">
            <div>
              <h3 class="text-base font-extrabold text-primary-token flex items-center gap-2">
                <i class="fa-solid fa-train-subway text-[#7C5CFF]"></i>
                <span>GitHub & Railway Production Architecture Package</span>
              </h3>
              <p class="text-xs text-muted-token">All production files below are included directly in this repository for immediate GitHub push & Railway deployment.</p>
            </div>
            <button data-action="closeModal" class="text-muted-token hover:text-primary-token"><i class="fa-solid fa-xmark text-lg"></i></button>
          </div>

          <div class="px-6 py-2 bg-elevated/60 border-b border-subtle flex flex-wrap gap-2 text-xs">
            <button data-action="setBlueprintTab" data-action-args="${this.encodeActionArgs(['prisma'])}" class="px-3 py-1 rounded font-semibold ${tab === 'prisma' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">prisma/schema.prisma (18 Models)</button>
            <button data-action="setBlueprintTab" data-action-args="${this.encodeActionArgs(['railway'])}" class="px-3 py-1 rounded font-semibold ${tab === 'railway' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">railway.json + Dockerfile</button>
            <button data-action="setBlueprintTab" data-action-args="${this.encodeActionArgs(['backend'])}" class="px-3 py-1 rounded font-semibold ${tab === 'backend' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">server/index.ts (Express + Socket.IO + LiveKit SFU)</button>
            <button data-action="setBlueprintTab" data-action-args="${this.encodeActionArgs(['env'])}" class="px-3 py-1 rounded font-semibold ${tab === 'env' ? 'bg-[#7C5CFF] text-white' : 'text-secondary-token hover:bg-white/5'}">.env.example & Healthcheck</button>
          </div>

          <div class="flex-1 overflow-y-auto p-6 bg-[#0d1117] text-gray-200 font-mono text-xs leading-relaxed">
            ${tab === 'prisma' ? `<pre class="whitespace-pre-wrap">datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 18 Prisma models. Some models (Session, FriendRequest, Invitation) are schema foundations,
// not complete end-user workflows:
// User, Session, Server, ServerMember, Role, Permission, Channel, Message,
// Attachment, Reaction, Friend, FriendRequest, DirectMessage, VoiceSession,
// Notification, Invitation, Ban, AuditLog.
// Full file stored at: prisma/schema.prisma in project root.</pre>` : ''}

            ${tab === 'railway' ? `<pre class="whitespace-pre-wrap">// railway.json (Docker build, startup migration, and /api/health probe)
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "npx prisma migrate deploy && node dist/server/index.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}

// Multi-stage Node 20 LTS Alpine Dockerfile stored at: Dockerfile in project root.</pre>` : ''}

            ${tab === 'backend' ? `<pre class="whitespace-pre-wrap">// server/index.ts — Express + Socket.IO + LiveKit token issuer
// Binds dynamically to process.env.PORT (Railway requirement)
// Provides:
//   GET  /api/health       -> PostgreSQL connectivity only
//   POST /api/voice/token  -> LiveKit token (503 unless LiveKit variables are configured)
//   WS   Socket.IO         -> Authenticated message and voice-session events</pre>` : ''}

            ${tab === 'env' ? `<pre class="whitespace-pre-wrap"># .env.example — Railway variables (secret values must be supplied privately)
NODE_ENV=production
DATABASE_URL=(provided by Railway PostgreSQL)
JWT_ACCESS_SECRET=(unique random value of at least 32 characters)
BCRYPT_ROUNDS=12
LIVEKIT_URL=(LiveKit wss endpoint)
LIVEKIT_API_KEY=(LiveKit server API key)
LIVEKIT_API_SECRET=(LiveKit server secret)</pre>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Interactive Actions & Mutations (Persisted via Table API)
  // =========================================================================

  switchToDMs() {
    this.state.viewMode = 'dms';
    this.renderAll();
  }

  openFriendsView() {
    this.state.viewMode = 'dms';
    this.state.dmSubView = 'friends';
    this.renderAll();
  }

  setFriendsFilter(filter) {
    this.state.friendsFilter = filter;
    this.renderAll();
  }

  selectDmConversation(convId) {
    this.state.viewMode = 'dms';
    this.state.dmSubView = 'conversation';
    this.state.activeDmConversationId = convId;
    this.renderAll();
  }

  selectServer(serverId) {
    this.state.viewMode = 'server';
    this.state.activeServerId = serverId;
    const srvChannels = this.state.channels.filter((c) => c.server_id === serverId);
    if (srvChannels.length > 0) {
      this.state.activeChannelId = srvChannels[0].id;
    }
    this.state.activeThreadMessage = null;
    this.renderAll();
  }

  async selectChannel(channelId) {
    this.state.activeChannelId = channelId;
    this.state.activeThreadMessage = null;
    this.state.showPinnedPopover = false;
    this.state.mobileDrawerOpen = false;
    this.api.joinChannel(channelId);
    this.markChannelRead(channelId);
    const ch = this.state.channels.find((c) => c.id === channelId);
    if (ch && ch.type === 'voice' && this.rtc.activeChannelId !== channelId) {
      await this.joinOrFocusVoiceChannel(channelId, false);
    } else {
      this.renderAll();
    }
  }

  async joinOrFocusVoiceChannel(channelId, withVideo = false) {
    const ch = this.state.channels.find((c) => c.id === channelId);
    if (!ch) return;
    if (!this.hasPermission('CONNECT_VOICE', ch.server_id)) {
      this.showToast('Missing CONNECT_VOICE permission in this server.', 'error');
      return;
    }
    if (withVideo && !this.hasPermission('STREAM_VIDEO', ch.server_id)) {
      this.showToast('You can join voice, but your role does not allow publishing video.', 'error');
      withVideo = false;
    }

    try {
      this.state.activeChannelId = channelId;
      await this.rtc.joinVoiceChannel(ch.server_id, channelId, { withVideo });
      this.api.joinChannel(channelId);
      await this.syncVoiceSession();
      this.renderAll();
      this.showToast(`Connected to LiveKit voice room: ${ch.name}`, 'success');
    } catch (error) {
      const diagnostics = [];
      if (Array.isArray(error.missingVariables) && error.missingVariables.length) diagnostics.push(`Missing Railway variables: ${error.missingVariables.join(', ')}`);
      if (error.errorId) diagnostics.push(`Reference: ${error.errorId}`);
      this.showToast(`Voice connection failed: ${error.message}${diagnostics.length ? ` (${diagnostics.join('; ')})` : ''}`, 'error');
      this.renderAll();
    }
  }

  async syncVoiceSession() {
    const channelId = this.rtc.activeChannelId;
    if (!channelId) return;
    const existing = this.state.voiceSessions.find((vs) => vs.user_id === this.state.currentUserId && vs.channel_id === channelId);
    const payload = { channel_id: channelId, user_id: this.state.currentUserId, muted: this.rtc.isMuted, deafened: this.rtc.isDeafened, video_enabled: this.rtc.isVideoEnabled, screen_sharing: this.rtc.isScreenSharing };
    // Targeted update only: no full table reload on every mute/deafen toggle.
    const row = existing
      ? await this.api.patch('voice_sessions', existing.id, payload)
      : await this.api.create('voice_sessions', { id: `vs_${this.state.currentUserId}_${channelId}`, ...payload });
    if (row && row.id) {
      const index = this.state.voiceSessions.findIndex((session) => session.id === row.id);
      if (index >= 0) this.state.voiceSessions[index] = { ...this.state.voiceSessions[index], ...row };
      else this.state.voiceSessions.push(row);
    }
  }

  async handleDisconnectVoice() {
    const channelId = this.rtc.activeChannelId;
    await this.rtc.leaveVoiceChannel();
    const existing = this.state.voiceSessions.find((vs) => vs.user_id === this.state.currentUserId && vs.channel_id === channelId);
    if (existing) {
      try {
        await this.api.remove('voice_sessions', existing.id);
        await this.loadAllData();
      } catch (_) {}
    }
    this.renderAll();
    this.showToast('Disconnected from voice channel.', 'info');
  }

  async handleToggleMute() {
    if (!this.rtc.room) return this.showToast('Join a voice channel or start a call first.', 'error');
    try {
      const muted = await this.rtc.toggleMute();
      if (this.rtc.mode === 'voice') await this.syncVoiceSession();
      this.renderAll();
      this.showToast(muted ? 'Microphone muted' : 'Microphone unmuted', 'info');
    } catch (error) { this.showToast(error.message, 'error'); }
  }

  async handleToggleDeafen() {
    if (!this.rtc.room) return this.showToast('Join a voice channel or start a call first.', 'error');
    try {
      const deaf = this.rtc.toggleDeafen();
      if (this.rtc.mode === 'voice') await this.syncVoiceSession();
      this.renderAll();
      this.showToast(deaf ? 'Audio deafened' : 'Audio undeafened', 'info');
    } catch (error) { this.showToast(error.message, 'error'); }
  }

  async handleToggleCamera() {
    // Inside a direct call there is no channel to join; toggle the live room directly.
    if (this.rtc.mode === 'dm' && this.rtc.room) {
      try {
        const res = await this.rtc.toggleCamera();
        this.renderAll();
        this.showToast(res.enabled ? 'Camera on.' : 'Camera turned off.', res.enabled ? 'success' : 'info');
      } catch (error) { this.showToast(`Camera could not be started: ${error.message}`, 'error'); }
      return;
    }
    if (!this.rtc.activeChannelId) {
      const ch = this.state.channels.find((c) => c.server_id === this.state.activeServerId && c.type === 'voice');
      if (ch) await this.joinOrFocusVoiceChannel(ch.id, true);
      else this.showToast('Create or join a voice channel first.', 'error');
      return;
    }
    if (!this.rtc.isVideoEnabled && !this.hasPermission('STREAM_VIDEO', this.state.activeServerId)) return this.showToast('Missing STREAM_VIDEO permission.', 'error');
    try {
      const res = await this.rtc.toggleCamera();
      await this.syncVoiceSession();
      this.renderAll();
      this.showToast(res.enabled ? 'Camera published to the room.' : 'Camera turned off.', res.enabled ? 'success' : 'info');
    } catch (error) { this.showToast(`Camera could not be started: ${error.message}`, 'error'); }
  }

  async handleToggleScreenShare() {
    if (this.rtc.mode === 'dm' && this.rtc.room) {
      try {
        const res = await this.rtc.toggleScreenShare();
        this.renderAll();
        this.showToast(res.sharing ? 'Your screen is being shared.' : 'Screen sharing stopped.', res.sharing ? 'success' : 'info');
      } catch (error) { this.showToast(`Screen sharing could not start: ${error.message}`, 'error'); }
      return;
    }
    if (!this.rtc.activeChannelId) {
      const ch = this.state.channels.find((c) => c.server_id === this.state.activeServerId && c.type === 'voice');
      if (ch) await this.joinOrFocusVoiceChannel(ch.id, false);
    }
    if (!this.rtc.activeChannelId) return this.showToast('Join a voice channel first.', 'error');
    if (!this.rtc.isScreenSharing && !this.hasPermission('STREAM_VIDEO', this.state.activeServerId)) return this.showToast('Missing STREAM_VIDEO permission.', 'error');
    try {
      const res = await this.rtc.toggleScreenShare();
      await this.syncVoiceSession();
      this.renderAll();
      this.showToast(res.sharing ? 'Your screen is being published to the room.' : 'Screen sharing stopped.', res.sharing ? 'success' : 'info');
    } catch (err) {
      this.showToast(`Screen sharing could not start: ${err.message}`, 'error');
    }
  }

  async startDirectVideoCall(convId, withVideo = false) {
    const conversation = this.state.directMessages.find((message) => message.conversation_id === convId);
    if (!conversation) return this.showToast('Start the conversation before calling.', 'error');
    try {
      this.state.incomingCall = null;
      await this.rtc.joinDirectCall(convId, { withVideo: Boolean(withVideo) });
      this.state.activeCallBanner = convId;
      this.state.viewMode = 'dms';
      this.state.dmSubView = 'conversation';
      this.state.activeDmConversationId = convId;
      this.renderAll();
      this.showToast('Call started. Others can join from this conversation.', 'success');
    } catch (error) {
      this.state.activeCallBanner = null;
      this.renderAll();
      this.showToast(`Call could not start: ${error.message}`, 'error');
    }
  }

  async endDirectVideoCall() {
    const conversationId = this.rtc.activeDmConversationId || this.state.activeCallBanner;
    if (this.rtc.mode === 'dm') await this.rtc.leaveVoiceChannel().catch(() => {});
    if (conversationId && this.api.socket?.connected) this.api.socket.emit('dm:call_ended', { conversationId });
    this.state.activeCallBanner = null;
    this.state.incomingCall = null;
    this.renderAll();
  }

  async acceptIncomingCall() {
    const call = this.state.incomingCall;
    if (!call) return;
    await this.startDirectVideoCall(call.conversationId, false);
  }

  declineIncomingCall() {
    this.state.incomingCall = null;
    this.renderMainStage();
  }

  onWebRTCStateChange(_rtcState, eventType) {
    this.renderAll();
    this.attachLiveVideoStreams();
    if (eventType === 'microphone-unavailable') this.showToast('Microphone access failed; you remain connected as a listener.', 'error');
    if (eventType === 'local-track-unpublished' && this.rtc.activeChannelId) this.syncVoiceSession().catch((error) => console.warn('Voice state sync failed:', error));
  }

  attachLiveVideoStreams() {
    const Track = window.PulseLiveKit?.Track;
    if (!Track || !this.rtc.room) return;
    const camVideo = document.getElementById('local-camera-video');
    const camera = this.rtc.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (camVideo && camera && camVideo.dataset.attached !== 'true') { camera.attach(camVideo); camVideo.dataset.attached = 'true'; }
    const screenVideo = document.getElementById('local-screen-video');
    const screen = this.rtc.room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    if (screenVideo && screen && screenVideo.dataset.attached !== 'true') { screen.attach(screenVideo); screenVideo.dataset.attached = 'true'; }
    document.querySelectorAll('[data-remote-identity][data-remote-source]').forEach((video) => this.rtc.attachRemoteVideo(video.dataset.remoteIdentity, video, video.dataset.remoteSource));
  }

  requestFullscreenStage() {
    const stage = document.getElementById('voice-theater-stage') || document.getElementById('webrtc-stage-grid');
    if (stage && stage.requestFullscreen) {
      stage.requestFullscreen().catch(() => {});
    }
  }

  // =========================================================================
  // Messaging CRUD, Reactions, Replies, Pins, Threads & File Uploads
  // =========================================================================

  async sendMessage(isDm = false) {
    const input = document.getElementById('main-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text && this.state.pendingAttachments.length === 0) return;
    if (!isDm && !this.hasPermission('SEND_MESSAGES', this.state.activeServerId)) {
      this.showToast('You do not have SEND_MESSAGES permission in this server.', 'error');
      return;
    }

    const me = this.getCurrentUser();
    const nowIso = new Date().toISOString();
    const attachmentsJson = JSON.stringify(this.state.pendingAttachments);

    const replyId = this.state.replyingToMessage ? this.state.replyingToMessage.id : '';

    try {
      if (isDm) {
        const convId = this.state.activeDmConversationId;
        const existing = this.state.directMessages.find((d) => d.conversation_id === convId);
        const participantIds = existing ? existing.participant_ids : [me.id, 'usr_elena'];
        await this.api.create('direct_messages', {
          id: 'dm_' + Date.now(),
          conversation_id: convId,
          participant_ids: participantIds,
          group_name: existing ? existing.group_name : '',
          is_group: existing ? existing.is_group : false,
          sender_id: me.id,
          content: text,
          reply_to_id: replyId,
          attachments_json: attachmentsJson,
          reactions_json: '{}',
          pinned: false,
          edited: false,
          timestamp_iso: nowIso
        });
      } else {
        const mentions = [];
        this.state.users.forEach((u) => {
          if (text.includes(`@${u.username}`)) mentions.push(u.id);
        });
        if (text.includes('@everyone')) mentions.push('@everyone');

        await this.api.create('messages', {
          id: 'msg_' + Date.now(),
          channel_id: this.state.activeChannelId,
          server_id: this.state.activeServerId,
          user_id: me.id,
          content: text,
          reply_to_id: replyId,
          attachments_json: attachmentsJson,
          reactions_json: '{}',
          pinned: false,
          edited: false,
          thread_name: '',
          mentions,
          timestamp_iso: nowIso
        });
      }

      input.value = '';
      this.state.replyingToMessage = null;
      this.state.pendingAttachments = [];
      await this.loadAllData();
      this.renderAll();
      const viewport = document.getElementById('messages-scroll-viewport');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    } catch (err) {
      this.showToast('Failed to send message: ' + err.message, 'error');
    }
  }

  startReply(msgId, isDm = false) {
    const pool = isDm ? this.state.directMessages : this.state.messages;
    this.state.replyingToMessage = pool.find((m) => m.id === msgId) || null;
    this.renderMainStage();
    const input = document.getElementById('main-chat-input');
    if (input) input.focus();
  }

  cancelReply() {
    this.state.replyingToMessage = null;
    this.renderMainStage();
  }

  startEditMessage(msgId) {
    this.state.editingMessageId = msgId;
    this.renderMainStage();
  }

  cancelEditMessage() {
    this.state.editingMessageId = null;
    this.renderMainStage();
  }

  async saveEditedMessage(msgId, isDm = false) {
    const input = document.getElementById(`edit-input-${msgId}`);
    if (!input) return;
    const newText = input.value.trim();
    if (!newText) return;
    this.state.editingMessageId = null;
    try {
      await this.api.patch(isDm ? 'direct_messages' : 'messages', msgId, {
        content: newText,
        edited: true
      });
      await this.loadAllData();
      this.renderMainStage();
      this.showToast('Message updated', 'success');
    } catch (err) {
      this.showToast('Edit failed: ' + err.message, 'error');
    }
  }

  async deleteMessage(msgId, isDm = false) {
    try {
      await this.api.remove(isDm ? 'direct_messages' : 'messages', msgId);
      await this.loadAllData();
      this.renderMainStage();
      this.showToast('Message deleted', 'info');
    } catch (err) {
      this.showToast('Delete failed: ' + err.message, 'error');
    }
  }

  async togglePinMessage(msgId, isDm = false) {
    const pool = isDm ? this.state.directMessages : this.state.messages;
    const msg = pool.find((m) => m.id === msgId);
    if (!msg) return;
    try {
      await this.api.patch(isDm ? 'direct_messages' : 'messages', msgId, {
        pinned: !msg.pinned
      });
      await this.loadAllData();
      this.renderAll();
      this.showToast(!msg.pinned ? 'Message pinned to channel' : 'Message unpinned', 'success');
    } catch (err) {
      this.showToast('Pin failed: ' + err.message, 'error');
    }
  }

  async toggleReaction(msgId, emoji, isDm = false) {
    const pool = isDm ? this.state.directMessages : this.state.messages;
    const msg = pool.find((m) => m.id === msgId);
    if (!msg) return;
    let reactions = {};
    try {
      reactions = msg.reactions_json ? JSON.parse(msg.reactions_json) : {};
    } catch (_) {}

    const list = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
    const uid = this.state.currentUserId;
    if (list.includes(uid)) {
      reactions[emoji] = list.filter((id) => id !== uid);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...list, uid];
    }

    try {
      await this.api.patch(isDm ? 'direct_messages' : 'messages', msgId, {
        reactions_json: JSON.stringify(reactions)
      });
      await this.loadAllData();
      this.renderMainStage();
    } catch (err) {
      this.showToast('Reaction error: ' + err.message, 'error');
    }
  }

  async openThread(msgId) {
    const msg = this.state.messages.find((m) => m.id === msgId);
    if (!msg) return;
    if (!msg.thread_name) {
      const defaultName = (msg.content || 'Discussion').slice(0, 28) + '...';
      await this.api.patch('messages', msgId, { thread_name: defaultName });
      await this.loadAllData();
    }
    this.state.activeThreadMessage = this.state.messages.find((m) => m.id === msgId);
    this.renderMainStage();
  }

  closeThread() {
    this.state.activeThreadMessage = null;
    this.renderMainStage();
  }

  async sendThreadReply(parentId) {
    const input = document.getElementById('thread-reply-input');
    if (!input || !input.value.trim()) return;
    const content = input.value.trim();
    try {
      await this.api.create('messages', {
        id: 'msg_th_' + Date.now(), channel_id: this.state.activeChannelId,
        user_id: this.state.currentUserId, content, reply_to_id: parentId,
        attachments_json: '[]', reactions_json: '{}', pinned: false, edited: false,
        thread_name: '', mentions: [], timestamp_iso: new Date().toISOString()
      });
      input.value = '';
      await this.loadAllData();
      this.state.activeThreadMessage = this.state.messages.find((m) => m.id === parentId);
      this.renderMainStage();
    } catch (error) { this.showToast(`Reply failed: ${error.message}`, 'error'); }
  }

  async handleFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    event.target.value = '';
    this.showToast(`Attachment storage is not configured; “${file.name}” was not uploaded or attached.`, 'error');
  }

  removePendingAttachment(idx) {
    this.state.pendingAttachments.splice(idx, 1);
    this.renderMainStage();
  }

  insertQuickPhrase() {
    const phrases = ['Nice work!', 'That makes sense.', 'I will take a look.', 'Thanks for the update.', 'Could you share more details?'];
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    const input = document.getElementById('main-chat-input');
    if (input) {
      input.value = (input.value ? input.value + ' ' : '') + phrase;
      input.focus();
    }
  }

  appendEmojiToInput(emoji) {
    const input = document.getElementById('main-chat-input');
    if (input) {
      input.value += emoji;
      input.focus();
    }
  }

  loadMoreMessages() {
    this.state.messagePageLimit += 25;
    this.renderMainStage();
  }

  updateSearchQuery(val) {
    this.state.searchQuery = val;
    this.renderMainStage();
  }

  // =========================================================================
  // Server, Role, Channel & Moderation Management
  // =========================================================================

  async createNewServer() {
    const nameEl = document.getElementById('new-server-name');
    const descEl = document.getElementById('new-server-desc');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      this.showToast('Please enter a server name.', 'error');
      return;
    }
    const srvId = 'srv_' + Date.now();
    let inviteCode = '';
    const iconText = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

    const createdServer = await this.api.create('servers', {
      id: srvId,
      name,
      description: descEl ? descEl.value.trim() : 'A new Mahyar Gap server',
      icon_text: iconText || 'SV',
      icon_color: '#7C5CFF',
      owner_id: this.state.currentUserId,
      region: 'us-east-railway',
      verification_level: 'Medium'
    });
    inviteCode = createdServer.invite_code;

    await this.api.create('roles', {
      id: 'rol_admin_' + Date.now(),
      server_id: srvId,
      name: 'Admin',
      color: '#F47FFF',
      position: 100,
      hoist: true,
      permissions: ['ADMINISTRATOR']
    });

    await this.api.create('server_members', {
      id: 'mem_' + Date.now(),
      server_id: srvId,
      user_id: this.state.currentUserId,
      role_ids: [],
      nickname: this.getCurrentUser().display_name,
      joined_at: new Date().toISOString()
    });

    const genChId = 'chn_gen_' + Date.now();
    await this.api.create('channels', {
      id: genChId,
      server_id: srvId,
      name: 'general',
      category: 'TEXT CHANNELS',
      type: 'text',
      topic: 'General discussion for ' + name,
      position: 1,
      slowmode: 0,
      is_private: false
    });

    await this.api.create('channels', {
      id: 'chn_vc_' + Date.now(),
      server_id: srvId,
      name: 'General Voice & Video',
      category: 'VOICE CHANNELS',
      type: 'voice',
      topic: 'WebRTC Voice & Screen Sharing Room',
      position: 2,
      slowmode: 0,
      is_private: false
    });

    await this.logAudit(srvId, 'SERVER_CREATE', name, `Created server with invite code ${inviteCode}`);
    await this.loadAllData();
    this.state.activeServerId = srvId;
    this.state.activeChannelId = genChId;
    this.state.viewMode = 'server';
    this.closeModal();
    this.renderAll();
    this.showToast(`Server "${name}" created!`, 'success');
  }

  async joinServerByInvite() {
    const input = document.getElementById('join-invite-code');
    const code = input ? input.value.trim().toLowerCase() : '';
    if (!code) return;

    try {
      const invite = await this.api.request(`/api/invites/${encodeURIComponent(code)}`);
      const result = await this.api.request('/api/servers/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: invite.invite_code }) });
      await this.loadAllData();

      this.state.viewMode = 'server';
      this.state.activeServerId = result.server.id;
      this.closeModal();
      this.renderAll();
      this.showToast(`Joined ${result.server.name}!`, 'success');
    } catch (error) { this.showToast(`Could not join server: ${error.message}`, 'error'); }
  }

  async saveServerOverview() {
    const srv = this.getActiveServer();
    if (!srv) return;
    const name = document.getElementById('srv-edit-name')?.value.trim() || srv.name;
    const description = document.getElementById('srv-edit-desc')?.value.trim() || '';
    const icon_text = document.getElementById('srv-edit-icon')?.value.trim() || srv.icon_text;
    const region = document.getElementById('srv-edit-region')?.value.trim() || srv.region;

    await this.api.patch('servers', srv.id, { name, description, icon_text, region });
    await this.logAudit(srv.id, 'SERVER_UPDATE', name, `Updated server overview settings (${region})`);
    await this.loadAllData();
    this.renderAll();
    this.showToast('Server settings saved!', 'success');
  }

  async createNewRole() {
    const srv = this.getActiveServer();
    if (!srv) return;
    const newRole = await this.api.create('roles', {
      id: 'rol_' + Date.now(),
      server_id: srv.id,
      name: 'New Role',
      color: '#57F287',
      position: 25,
      hoist: true,
      permissions: ['SEND_MESSAGES', 'CONNECT_VOICE', 'SPEAK_VOICE']
    });
    await this.logAudit(srv.id, 'ROLE_CREATE', 'New Role', 'Created custom RBAC role');
    await this.loadAllData();
    this.state.selectedRoleIdForEdit = newRole.id;
    this.renderModals();
  }

  selectRoleForEdit(roleId) {
    this.state.selectedRoleIdForEdit = roleId;
    this.renderModals();
  }

  async saveRoleChanges(roleId) {
    const name = document.getElementById('role-edit-name')?.value.trim() || 'Role';
    const color = document.getElementById('role-edit-color')?.value.trim() || '#7C5CFF';
    const perms = Array.from(document.querySelectorAll('.role-perm-checkbox:checked')).map((cb) => cb.value);

    await this.api.patch('roles', roleId, { name, color, permissions: perms });
    await this.logAudit(this.state.activeServerId, 'ROLE_UPDATE', name, `Updated permissions (${perms.length} enabled)`);
    await this.loadAllData();
    this.renderAll();
    this.showToast(`Role "${name}" updated!`, 'success');
  }

  async kickServerMember(memberRowId, displayName) {
    await this.api.remove('server_members', memberRowId);
    await this.logAudit(this.state.activeServerId, 'MEMBER_KICK', displayName, 'Kicked member from server');
    await this.loadAllData();
    this.renderAll();
    this.showToast(`Kicked ${displayName}`, 'info');
  }

  async updateMemberRoles(memberRowId, roleIds) {
    try {
      await this.api.patch('server_members', memberRowId, { role_ids: roleIds });
      await this.loadAllData();
      this.renderAll();
      this.showToast('Member roles updated.', 'success');
    } catch (error) { this.showToast(`Could not update roles: ${error.message}`, 'error'); }
  }

  async toggleMemberRole(memberRowId, roleId) {
    if (!roleId) return this.showToast('Choose a role first.', 'info');
    const member = this.state.serverMembers.find((row) => row.id === memberRowId);
    if (!member) return this.showToast('Member record not found.', 'error');
    const current = Array.isArray(member.role_ids) ? member.role_ids : [];
    const next = current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId];
    await this.updateMemberRoles(memberRowId, next);
  }

  async banServerMember(memberRowId, userId, displayName) {
    const srv = this.getActiveServer();
    if (!srv) return;
    try {
      await this.api.request(`/api/servers/${encodeURIComponent(srv.id)}/bans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, reason: 'Banned by a server moderator' }) });
      await this.loadAllData();
      this.renderAll();
      this.showToast(`Banned ${displayName}`, 'error');
    } catch (error) { this.showToast(`Ban failed: ${error.message}`, 'error'); }
  }

  async leaveCurrentServer() {
    const srv = this.getActiveServer();
    if (!srv) return;
    const row = this.state.serverMembers.find((m) => m.server_id === srv.id && m.user_id === this.state.currentUserId);
    if (row) await this.api.remove('server_members', row.id);
    await this.loadAllData();
    this.closeModal();
    this.renderAll();
    this.showToast(`Left ${srv.name}`, 'info');
  }

  async deleteCurrentServer() {
    const srv = this.getActiveServer();
    if (!srv) return;
    await this.api.remove('servers', srv.id);
    await this.loadAllData();
    this.closeModal();
    this.renderAll();
    this.showToast(`Deleted server ${srv.name}`, 'info');
  }

  openCreateChannelModal(categoryName) {
    this.state.activeModal = 'createChannel:' + categoryName;
    this.renderModals();
  }

  async createNewChannel(categoryName) {
    const type = document.getElementById('new-channel-type')?.value || 'text';
    const rawName = document.getElementById('new-channel-name')?.value.trim() || '';
    const topic = document.getElementById('new-channel-topic')?.value.trim() || '';
    if (!rawName) return;

    const name = type === 'voice' ? rawName : rawName.toLowerCase().replace(/\s+/g, '-');
    const newCh = await this.api.create('channels', {
      id: 'chn_' + Date.now(),
      server_id: this.state.activeServerId,
      name,
      category: categoryName,
      type,
      topic,
      position: this.state.channels.length + 1,
      slowmode: 0,
      is_private: false
    });

    await this.logAudit(this.state.activeServerId, 'CHANNEL_CREATE', name, `Created ${type} channel in ${categoryName}`);
    await this.loadAllData();
    this.state.activeChannelId = newCh.id;
    this.closeModal();
    this.renderAll();
    this.showToast(`Channel #${name} created!`, 'success');
  }

  async deleteChannel(channelId) {
    const ch = this.state.channels.find((c) => c.id === channelId);
    if (!ch) return;
    await this.api.remove('channels', channelId);
    await this.logAudit(this.state.activeServerId, 'CHANNEL_DELETE', ch.name, 'Deleted channel');
    await this.loadAllData();
    this.renderAll();
    this.showToast(`Deleted channel ${ch.name}`, 'info');
  }

  // =========================================================================
  // Friends, DMs & User Account Management
  // =========================================================================

  async sendFriendRequest() {
    const input = document.getElementById('add-friend-input');
    const val = input ? input.value.trim().toLowerCase() : '';
    if (!val) return;
    const target = this.state.users.find(
      (u) => u.username.toLowerCase() === val || (u.display_name || '').toLowerCase() === val
    );
    if (!target) {
      this.showToast('No registered user matched that username.', 'error');
      return;
    }
    await this.sendFriendRequestById(target.id);
  }

  async sendFriendRequestById(targetUserId) {
    if (targetUserId === this.state.currentUserId) return;
    const existing = this.state.friends.find((friend) => (friend.user_id === this.state.currentUserId && friend.friend_id === targetUserId) || (friend.user_id === targetUserId && friend.friend_id === this.state.currentUserId));
    if (existing) return this.showToast('A friend request or connection already exists.', 'info');
    try {
      await this.api.create('friends', { id: 'fr_' + Date.now(), user_id: this.state.currentUserId, friend_id: targetUserId, status: 'pending' });
      await this.loadAllData();
      this.state.friendsFilter = 'pending';
      this.renderAll();
      this.showToast('Friend request sent.', 'success');
    } catch (error) { this.showToast(`Friend request failed: ${error.message}`, 'error'); }
  }

  async acceptFriendRequest(rowId) {
    await this.api.patch('friends', rowId, { status: 'accepted' });
    await this.loadAllData();
    this.renderAll();
    this.showToast('Friend request accepted!', 'success');
  }

  async blockFriendRow(rowId) {
    await this.api.patch('friends', rowId, { status: 'blocked' });
    await this.loadAllData();
    this.renderAll();
    this.showToast('User moved to Blocked list.', 'info');
  }

  async removeFriendRow(rowId) {
    await this.api.remove('friends', rowId);
    await this.loadAllData();
    this.renderAll();
    this.showToast('Removed from friends.', 'info');
  }

  async startDmWithUser(peerId, withVideoCall = false) {
    const meId = this.state.currentUserId;
    const existing = this.state.directMessages.find((d) => {
      if (d.is_group) return false;
      const parts = Array.isArray(d.participant_ids) ? d.participant_ids : [];
      return parts.includes(meId) && parts.includes(peerId);
    });

    let convId = existing ? existing.conversation_id : `dm_${meId}_${peerId}`;
    if (!existing) {
      const peer = this.getUserById(peerId);
      await this.api.create('direct_messages', {
        id: 'dm_' + Date.now(),
        conversation_id: convId,
        participant_ids: [meId, peerId],
        group_name: '',
        is_group: false,
        sender_id: meId,
        content: `Started a direct conversation with @${peer.username}.`,
        reply_to_id: '',
        attachments_json: '[]',
        reactions_json: '{}',
        pinned: false,
        edited: false,
        timestamp_iso: new Date().toISOString()
      });
      await this.loadAllData();
    }

    this.state.viewMode = 'dms';
    this.state.dmSubView = 'conversation';
    this.state.activeDmConversationId = convId;
    if (withVideoCall) {
      await this.startDirectVideoCall(convId, true);
    } else {
      this.renderAll();
    }
  }

  async createCustomDmConversation() {
    const selected = Array.from(document.querySelectorAll('.dm-peer-checkbox:checked')).map((c) => c.value);
    if (selected.length === 0) return;
    const groupName = document.getElementById('new-group-dm-name')?.value.trim() || 'Group Squad DM';
    const isGroup = selected.length > 1;
    const convId = 'dm_custom_' + Date.now();

    await this.api.create('direct_messages', {
      id: 'dm_' + Date.now(),
      conversation_id: convId,
      participant_ids: [this.state.currentUserId, ...selected],
      group_name: isGroup ? groupName : '',
      is_group: isGroup,
      sender_id: this.state.currentUserId,
      content: isGroup ? `Created group conversation **${groupName}**!` : 'Wave hello 👋',
      reply_to_id: '',
      attachments_json: '[]',
      reactions_json: '{}',
      pinned: false,
      edited: false,
      timestamp_iso: new Date().toISOString()
    });

    await this.loadAllData();
    this.closeModal();
    this.selectDmConversation(convId);
  }

  async saveUserProfileSettings() {
    const me = this.getCurrentUser();
    const display_name = document.getElementById('usr-edit-display')?.value.trim() || me.display_name;
    const status = document.getElementById('usr-edit-status')?.value || me.status;
    const custom_status = document.getElementById('usr-edit-custom-status')?.value.trim() || '';
    const bio = document.getElementById('usr-edit-bio')?.value.trim() || '';

    await this.api.patch('users', me.id, { display_name, status, custom_status, bio, ...(this.state.avatarDraft ? { avatar_url: this.state.avatarDraft } : {}) });
    this.state.avatarDraft = null;
    await this.loadAllData();
    this.closeModal();
    this.renderAll();
    this.showToast('Profile and presence updated.', 'success');
  }

  switchAccount(userId) {
    if (userId !== this.state.currentUserId) this.showToast('Account switching is disabled; sign in with that account instead.', 'error');
  }

  async registerNewAccount() {
    this.showToast('Use the Create account action on the sign-in screen.', 'info');
  }

  async logout() {
    const channelId = this.rtc.activeChannelId;
    const voiceSession = this.state.voiceSessions.find((session) => session.user_id === this.state.currentUserId && session.channel_id === channelId);
    if (this.rtc.room || channelId) {
      try { await this.rtc.leaveVoiceChannel(); } catch (_) {}
      if (voiceSession) { try { await this.api.remove('voice_sessions', voiceSession.id); } catch (_) {} }
    }
    this.api.logout();
    localStorage.removeItem('mahyar_gap_current_user_id');
    localStorage.removeItem('pulsecord_current_user_id');
    this.state.currentUserId = null;
    this.state.activeModal = null;
    this.renderAuthScreen();
  }

  async logAudit(serverId, actionType, targetName, details) {
    try {
      await this.api.create('audit_logs', {
        id: 'aud_' + Date.now(),
        server_id: serverId,
        actor_id: this.state.currentUserId,
        action_type: actionType,
        target_name: targetName,
        details,
        timestamp_iso: new Date().toISOString()
      });
    } catch (_) {}
  }

  // =========================================================================
  // UI Controls, Popovers, Theme & Formatting Helpers
  // =========================================================================

  toggleTheme() {
    this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mahyar_gap_theme', this.state.theme);
    this.renderAll();
  }

  toggleMemberSidebar() {
    this.state.showMemberList = !this.state.showMemberList;
    this.renderAll();
  }

  togglePinnedPopover() {
    this.state.showPinnedPopover = !this.state.showPinnedPopover;
    this.state.showNotificationsPopover = false;
    this.renderMainStage();
  }

  toggleNotificationsPopover() {
    this.state.showNotificationsPopover = !this.state.showNotificationsPopover;
    this.state.showPinnedPopover = false;
    this.renderMainStage();
  }

  async markAllNotificationsRead() {
    const unread = this.state.notifications.filter((n) => n.user_id === this.state.currentUserId && !n.read);
    for (const n of unread) {
      await this.api.patch('notifications', n.id, { read: true });
    }
    await this.loadAllData();
    this.renderAll();
  }

  async changeMediaDevice(kind, deviceId) {
    const selected = deviceId || 'default';
    try {
      if (kind === 'audioinput') {
        const previous = this.rtc.selectedAudioInput;
        this.rtc.selectedAudioInput = selected;
        if (this.rtc.room && this.rtc.canSpeak && !await this.rtc.room.switchActiveDevice('audioinput', selected)) { this.rtc.selectedAudioInput = previous; throw new Error('The selected microphone could not be activated.'); }
      } else if (kind === 'audiooutput') {
        const previous = this.rtc.selectedAudioOutput;
        this.rtc.selectedAudioOutput = selected;
        if (this.rtc.room && !await this.rtc.room.switchActiveDevice('audiooutput', selected)) { this.rtc.selectedAudioOutput = previous; throw new Error('This browser could not switch the audio output device.'); }
      } else if (kind === 'videoinput') {
        this.rtc.selectedVideoInput = selected;
        if (this.rtc.room && this.rtc.isVideoEnabled) {
          await this.rtc.toggleCamera(false);
          await this.rtc.toggleCamera(true);
        }
      }
      this.showToast('Device selection updated.', 'success');
    } catch (error) { this.showToast(`Could not switch device: ${error.message}`, 'error'); }
  }

  async openModal(name) {
    if (name === 'mediaDevicesModal') await this.rtc.enumerateHardwareDevices();
    this.state.activeModal = name;
    this.renderModals();
  }

  openUserProfileModal(userId) {
    this.state.activeModal = 'profile:' + userId;
    this.renderModals();
  }

  closeModal() {
    this.state.activeModal = null;
    this.renderModals();
  }

  setServerSettingsTab(tab) {
    this.state.serverSettingsTab = tab;
    this.renderModals();
  }

  setBlueprintTab(tab) {
    this.state.blueprintTab = tab;
    this.renderModals();
  }

  applyMobileDrawerState() {
    const drawer = document.getElementById('left-navigation-wrapper');
    const backdrop = document.getElementById('mobile-drawer-backdrop');
    const open = this.state.mobileDrawerOpen && window.innerWidth < 768;
    if (drawer) drawer.classList.toggle('drawer-open', open);
    if (backdrop) backdrop.classList.toggle('is-visible', open);
  }

  toggleMobileDrawer() {
    this.state.mobileDrawerOpen = !this.state.mobileDrawerOpen;
    this.applyMobileDrawerState();
  }

  bindGlobalEvents() {
    if (this.globalEventsBound) return;
    this.globalEventsBound = true;
    document.addEventListener('click', (event) => this.handleDelegatedClick(event));
    document.addEventListener('input', (event) => this.handleDelegatedDataEvent('input', event));
    document.addEventListener('change', (event) => this.handleDelegatedDataEvent('change', event));
    document.addEventListener('keydown', (event) => this.handleDelegatedKeydown(event));
    document.addEventListener('contextmenu', (event) => {
      const target = event.target?.closest?.('[data-user-identity]');
      if (!target) return;
      const identity = target.dataset.userIdentity;
      if (!identity) return;
      event.preventDefault();
      this.openUserContextMenu(identity, event.clientX, event.clientY);
    });
    // Touch alternative for the participant menu (long press).
    document.addEventListener('touchstart', (event) => {
      const target = event.target?.closest?.('[data-user-identity]');
      if (!target) return;
      const identity = target.dataset.userIdentity;
      const touch = event.touches && event.touches[0];
      if (!identity || !touch) return;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        this.openUserContextMenu(identity, touch.clientX, touch.clientY);
      }, 520);
    }, { passive: true });
    const cancelLongPress = () => clearTimeout(this.longPressTimer);
    document.addEventListener('touchend', cancelLongPress, { passive: true });
    document.addEventListener('touchmove', cancelLongPress, { passive: true });
    window.addEventListener('resize', () => this.applyMobileDrawerState());
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.switchToDMs();
      }
      if (e.key === 'Escape') {
        if (this.state.contextMenu) this.closeContextMenu();
        else if (this.state.activeModal) this.closeModal();
      }
    });
  }

  handleDelegatedClick(event) {
    const origin = event.target?.closest ? event.target : event.target?.parentElement;
    if (!origin) return;
    if (this.state.contextMenu && !origin.closest('.mg-context-menu') && !origin.closest('[data-user-identity]')) this.closeContextMenu();
    const stopper = origin.closest('[data-stop-click="true"]');
    const actionElement = origin.closest('[data-action]');
    if (stopper && (!actionElement || !stopper.contains(actionElement))) {
      event.stopPropagation();
      return;
    }
    if (actionElement && (!actionElement.dataset.actionEvent || actionElement.dataset.actionEvent === 'click')) {
      this.dispatchDelegatedAction(actionElement, event);
    }
    if (stopper) event.stopPropagation();
  }

  handleDelegatedDataEvent(type, event) {
    const origin = event.target?.closest ? event.target : event.target?.parentElement;
    if (type === 'input' && event.target?.id === 'main-chat-input') this.notifyTyping();
    const actionElement = origin?.closest(`[data-action][data-action-event="${type}"]`);
    if (actionElement) this.dispatchDelegatedAction(actionElement, event);
  }

  notifyTyping() {
    const now = Date.now();
    if (now - this.lastTypingSent < 2800) return;
    this.lastTypingSent = now;
    const isDm = this.state.viewMode === 'dms' && this.state.dmSubView === 'conversation';
    this.api.typing(isDm ? null : this.state.activeChannelId, isDm ? this.state.activeDmConversationId : null);
  }

  updateTypingIndicator() {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    const isDm = this.state.viewMode === 'dms' && this.state.dmSubView === 'conversation';
    const key = isDm ? `dm:${this.state.activeDmConversationId}` : `channel:${this.state.activeChannelId}`;
    const map = this.state.typingByContext.get(key);
    const now = Date.now();
    const names = [];
    if (map) {
      for (const [userId, at] of [...map.entries()]) {
        if (now - at > 6000) { map.delete(userId); continue; }
        const user = this.getUserById(userId);
        names.push(user.display_name || user.username);
      }
    }
    el.innerHTML = names.length
      ? `<span class="typing-dots"><span></span><span></span><span></span></span><span>${this.escapeHtml(names.slice(0, 3).join(', '))} ${names.length === 1 ? 'is' : 'are'} typing…</span>`
      : '';
    if (map && map.size) {
      clearTimeout(this.typingRefreshTimer);
      this.typingRefreshTimer = setTimeout(() => this.updateTypingIndicator(), 2500);
    }
  }

  openUserContextMenu(identity, x, y) {
    if (!identity) return;
    this.state.contextMenu = { identity, x: Number(x) || 0, y: Number(y) || 0 };
    this.renderContextMenu();
  }

  closeContextMenu() {
    this.state.contextMenu = null;
    this.renderContextMenu();
  }

  renderContextMenu() {
    const root = document.getElementById('context-menu-root');
    if (!root) return;
    const menu = this.state.contextMenu;
    if (!menu) { root.innerHTML = ''; return; }
    const user = this.getUserById(menu.identity);
    const volume = this.rtc.getUserVolume(user.id);
    const isSelf = user.id === this.state.currentUserId;
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - 274));
    const top = Math.max(8, Math.min(menu.y, window.innerHeight - 340));
    root.innerHTML = `
      <div class="mg-context-menu" role="dialog" aria-label="Member actions" style="left:${left}px; top:${top}px">
        <div class="mg-menu-header flex items-center gap-2.5">
          ${this.avatarHtml(user, { size: 'w-9 h-9', text: 'text-xs', status: true })}
          <div class="min-w-0">
            <div class="text-xs font-bold text-primary-token truncate">${this.escapeHtml(user.display_name || user.username)}</div>
            <div class="text-[10px] text-muted-token truncate">@${this.escapeHtml(user.username)}</div>
          </div>
        </div>
        ${isSelf ? '<div class="px-2 py-2 text-[11px] text-muted-token">This is you. Open another member\u2019s menu to adjust their volume.</div>' : `
          <div class="px-2 py-1.5">
            <div class="flex items-center justify-between text-[11px] text-muted-token mb-1.5">
              <span>User volume</span>
              <span id="user-volume-label" class="text-primary-token font-semibold">${volume}%</span>
            </div>
            <input type="range" min="0" max="200" step="5" value="${volume}" class="mg-volume-slider" style="--volume-pct:${volume / 2}%" aria-label="User volume" data-action="setParticipantVolume" data-action-event="input" data-action-args="${this.encodeActionArgs([user.id, { __pulsecordEventValue: true }])}" />
            <div class="flex justify-between text-[9px] text-muted-token mt-1"><span>0%</span><span>100%</span><span>200%</span></div>
          </div>
          <button class="mg-menu-item" data-action="toggleUserLocalMute" data-action-args="${this.encodeActionArgs([user.id])}">
            <i class="fa-solid ${volume === 0 ? 'fa-volume-high' : 'fa-volume-xmark'} w-4 text-center"></i>${volume === 0 ? 'Unmute for me' : 'Mute for me'}
          </button>
          <div class="mg-menu-sep"></div>
        `}
        <button class="mg-menu-item" data-action="openUserProfileModal" data-action-args="${this.encodeActionArgs([user.id])}"><i class="fa-solid fa-id-badge w-4 text-center"></i>View profile</button>
        ${isSelf ? '' : `<button class="mg-menu-item" data-action="startDmFromContextMenu" data-action-args="${this.encodeActionArgs([user.id])}"><i class="fa-solid fa-message w-4 text-center"></i>Send direct message</button>`}
        <button class="mg-menu-item" data-action="copyUserId" data-action-args="${this.encodeActionArgs([user.id])}"><i class="fa-solid fa-copy w-4 text-center"></i>Copy user ID</button>
        <div class="mg-menu-sep"></div>
        <button class="mg-menu-item" data-action="closeContextMenu"><i class="fa-solid fa-xmark w-4 text-center"></i>Close menu</button>
      </div>
    `;
  }

  setParticipantVolume(identity, value) {
    const volume = this.rtc.setUserVolume(identity, value);
    const label = document.getElementById('user-volume-label');
    if (label) label.textContent = `${volume}%`;
    const slider = document.querySelector('.mg-volume-slider');
    if (slider) slider.style.setProperty('--volume-pct', `${volume / 2}%`);
    this.renderLeftSidebar();
    this.renderVoiceConnectionBar();
    return volume;
  }

  toggleUserLocalMute(identity) {
    const volume = this.rtc.toggleUserMute(identity);
    const user = this.getUserById(identity);
    this.renderLeftSidebar();
    this.showToast(volume === 0 ? `${user.display_name || user.username} muted for you` : `${user.display_name || user.username} audible again`, 'info');
    this.state.contextMenu = { ...this.state.contextMenu, identity };
    this.renderContextMenu();
  }

  async copyUserId(identity) {
    try {
      await navigator.clipboard.writeText(String(identity));
      this.showToast('User ID copied.', 'success');
    } catch (_) {
      this.showToast('Clipboard permission was denied.', 'error');
    }
  }

  startDmFromContextMenu(identity) {
    this.closeContextMenu();
    return this.startDmWithUser(identity);
  }

  setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    this.state.theme = next;
    localStorage.setItem('mahyar_gap_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    this.renderAll();
  }

  setMotion(motion) {
    this.state.motion = motion === 'reduced' ? 'reduced' : 'full';
    localStorage.setItem('mahyar_gap_motion', this.state.motion);
    document.documentElement.setAttribute('data-motion', this.state.motion);
  }

  selectRegistrationAvatar(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    event.target.value = '';
    this.cropAvatarFile(file).then((dataUrl) => {
      this.state.avatarDraft = dataUrl;
      const preview = document.getElementById('auth-avatar-preview');
      if (preview) preview.innerHTML = `<img class="avatar-img" src="${this.escapeAttr(dataUrl)}" alt="Selected avatar" />`;
    }).catch((error) => this.showAuthError(error.message));
  }

  showAuthError(message) {
    const el = document.getElementById('auth-error');
    if (!el) return this.showToast(message, 'error');
    el.textContent = message;
    el.classList.remove('hidden');
  }

  cropAvatarFile(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) return reject(new Error('Choose a PNG, JPEG or WebP image.'));
      if (file.size > 8 * 1024 * 1024) return reject(new Error('Choose an image smaller than 8 MB.'));
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          const side = Math.min(image.width, image.height);
          context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          URL.revokeObjectURL(objectUrl);
          if (dataUrl.length > 380000) return reject(new Error('The cropped image is still too large; choose a simpler photo.'));
          resolve(dataUrl);
        } catch (_) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('This image could not be processed.'));
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('This file is not a readable image.'));
      };
      image.src = objectUrl;
    });
  }

  async handleAvatarFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    event.target.value = '';
    try {
      const dataUrl = await this.cropAvatarFile(file);
      const me = this.getCurrentUser();
      await this.api.patch('users', me.id, { avatar_url: dataUrl });
      this.state.users = this.state.users.map((user) => user.id === me.id ? { ...user, avatar_url: dataUrl } : user);
      this.state.avatarDraft = null;
      this.renderAll();
      this.showToast('Profile picture updated.', 'success');
    } catch (error) { this.showToast(`Avatar upload failed: ${error.message}`, 'error'); }
  }

  async removeAvatar() {
    const me = this.getCurrentUser();
    try {
      await this.api.patch('users', me.id, { avatar_url: null });
      this.state.users = this.state.users.map((user) => user.id === me.id ? { ...user, avatar_url: null } : user);
      this.state.avatarDraft = null;
      this.renderAll();
      this.showToast('Profile picture removed.', 'info');
    } catch (error) { this.showToast(`Could not remove the avatar: ${error.message}`, 'error'); }
  }

  handleDelegatedKeydown(event) {
    const origin = event.target?.closest ? event.target : event.target?.parentElement;
    const input = origin?.closest('[data-key-action]');
    if (!input) return;
    let args;
    try { args = JSON.parse(input.dataset.keyActionArgs || '[]'); }
    catch (error) { console.error('Invalid delegated key-action arguments', error); return; }
    if (!Array.isArray(args)) return;
    if (input.dataset.keyAction === 'send-message' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage(...args);
    } else if (input.dataset.keyAction === 'edit-message') {
      if (event.key === 'Enter') this.saveEditedMessage(...args);
      else if (event.key === 'Escape') this.cancelEditMessage();
    } else if (input.dataset.keyAction === 'thread-reply' && event.key === 'Enter') {
      event.preventDefault();
      this.sendThreadReply(...args);
    }
  }

  dispatchDelegatedAction(element, event) {
    const action = element.dataset.action;
    if (!DELEGATED_ACTIONS.has(action)) return;
    let args;
    try { args = JSON.parse(element.dataset.actionArgs || '[]'); }
    catch (error) { console.error(`Invalid arguments for UI action ${action}`, error); return; }
    if (!Array.isArray(args)) return;
    args = args.map((value) => value && value.__pulsecordEventValue === true ? element.value : value);
    let result;
    try {
      if (action === 'copyInviteCode') {
        result = this.copyInviteCode(args[0]);
      } else if (action === 'closeModalAndStartDm') {
        this.closeModal();
        result = this.startDmWithUser(args[0]);
      } else if (action === 'toggleSelectedMemberRole') {
        const select = document.getElementById(`member-role-${args[0]}`);
        if (!select?.value) return this.showToast('Choose a role first.', 'error');
        result = this.toggleMemberRole(args[0], select.value);
      } else if (action === 'toggleEmojiPicker') {
        const picker = element.parentElement?.querySelector('[data-emoji-picker]');
        if (picker) {
          const opening = picker.classList.contains('hidden');
          picker.classList.toggle('hidden', !opening);
          picker.classList.toggle('flex', opening);
          element.setAttribute('aria-expanded', String(opening));
        }
      } else if (typeof this[action] === 'function') {
        result = this[action](...args);
      } else {
        console.error(`UI action is not implemented: ${action}`);
      }
    } catch (error) {
      console.error(`UI action failed: ${action}`, error);
      this.showToast(error?.message || 'The requested action failed.', 'error');
      return;
    }
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error(`UI action failed: ${action}`, error);
        this.showToast(error?.message || 'The requested action failed.', 'error');
      });
    }
  }

  async copyInviteCode(code) {
    try {
      await navigator.clipboard.writeText(String(code || ''));
      this.showToast('Invite code copied!', 'success');
    } catch (error) {
      this.showToast('Could not copy the invite code. Check clipboard permissions.', 'error');
    }
  }

  formatTimestamp(iso) {
    if (!iso) return 'Today';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatMessageContent(raw) {
    let safe = this.escapeHtml(raw);
    // Bold **text**
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-primary-token">$1</strong>');
    // Inline code `code`
    safe = safe.replace(/`([^`]+)`/g, '<code class="msg-inline-code">$1</code>');
    // Mentions @username
    safe = safe.replace(/(@[a-zA-Z0-9_]+)/g, '<span class="bg-[#7C5CFF]/25 text-[#99aab5] font-semibold px-1 rounded">$1</span>');
    // Newlines
    safe = safe.replace(/\n/g, '<br/>');
    return safe;
  }

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttr(str) {
    return this.escapeHtml(str);
  }

  encodeActionArgs(args) {
    return this.escapeAttr(JSON.stringify(args ?? []));
  }

  escapeJsAttr(value) {
    const literal = JSON.stringify(String(value ?? '')).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return this.escapeHtml(literal);
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    const bg = type === 'error' ? 'bg-[#F23F43]' : type === 'success' ? 'bg-[#23A55A]' : 'bg-[#7C5CFF]';
    el.className = `${bg} text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 transition-all`;
    el.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 250);
    }, 3400);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new MahyarGapApp();
  window.app.init();
});
