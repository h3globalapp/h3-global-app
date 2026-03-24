import { auth, db, functions } from '../firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  Timestamp,
  query,
  orderBy,
  limit,
  where,
  getDocs,
  startAfter
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

import { chatList } from './chat-list.js';
import { chatScreen } from './chat-screen.js';
import { messages } from './messages.js';

const chatApp = {
  currentUser: null,
  currentView: 'list',
  currentChat: null,
  unsubscribers: [],
  selectedMessage: null,
  initialized: false,
  currentChatLastSeen: 0,
    _queuedSound: false, // Track if we missed playing a sound due to lock

  
  // WhatsApp-style selection
  selectedMessages: new Set(),
  isSelectionMode: false,
  longPressTimer: null,
  swipeState: {
    startX: 0,
    currentX: 0,
    messageEl: null,
    isSwiping: false
  },
  
  // Audio notification
  // Sound Library System
  soundLibrary: {
    default: {
      name: 'Default Pop',
      url: 'https://actions.google.com/sounds/v1/cartoon/pop.ogg'
    },
    bell: {
      name: 'Bell',
      url: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'
    },
    chime: {
      name: 'Chime',
      url: 'https://actions.google.com/sounds/v1/alarms/beep_medium.ogg'
    },
    glass: {
      name: 'Glass',
      url: 'https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg'
    },
    droplet: {
      name: 'Droplet',
      url: 'https://actions.google.com/sounds/v1/water/droplet.ogg'
    },
    notification: {
      name: 'Notification',
      url: 'https://actions.google.com/sounds/v1/alarms/notification.ogg'
    },
    digital: {
      name: 'Digital',
      url: 'https://actions.google.com/sounds/v1/alarms/digital_watch_alarm.ogg'
    },
    coin: {
      name: 'Coin',
      url: 'https://actions.google.com/sounds/v1/cartoon/coin.ogg'
    }
  },

  currentSound: null,
  notificationSound: null,

  initSoundSystem() {
    // Load saved preference or use default
    const savedSoundKey = localStorage.getItem('notification_sound_key') || 'default';
    this.setSound(savedSoundKey, false); // false = don't play test sound on init
  },

  setSound(soundKey, playTest = true) {
    const soundConfig = this.soundLibrary[soundKey];
    if (!soundConfig) return false;

    // Create new audio element
    this.notificationSound = new Audio(soundConfig.url);
    this.notificationSound.preload = 'auto';
    this.currentSound = soundKey;
    
    // Save preference
    localStorage.setItem('notification_sound_key', soundKey);
    
    // Play test sound if requested
    if (playTest) {
      this.notificationSound.currentTime = 0;
      this.notificationSound.play().catch(e => console.log('Test sound failed:', e));
    }
    
    return true;
  },

  getCurrentSoundName() {
    return this.soundLibrary[this.currentSound]?.name || 'Default';
  },

  // IMPROVED: More aggressive audio unlock
  unlockAudio() {
    if (this._audioUnlocked) return;
    
    console.log('👆 Unlocking audio...');
    
    // Try multiple unlock strategies
    const unlockStrategies = [
      // Strategy 1: Silent audio
      () => {
        const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==');
        silent.volume = 0.01;
        return silent.play();
      },
      // Strategy 2: Actual notification sound at zero volume
      () => {
        if (this.notificationSound) {
          this.notificationSound.volume = 0;
          this.notificationSound.currentTime = 0;
          return this.notificationSound.play();
        }
        return Promise.reject('No notification sound');
      }
    ];
    
    // Try each strategy
    let unlocked = false;
    unlockStrategies.forEach((strategy, index) => {
      if (unlocked) return;
      
      strategy()
        .then(() => {
          if (!unlocked) {
            unlocked = true;
            this._audioUnlocked = true;
            console.log('🔊 Audio unlocked via strategy', index + 1);
            // Restore volume
            if (this.notificationSound) this.notificationSound.volume = 1;
          }
        })
        .catch(e => {
          console.log('⚠️ Unlock strategy', index + 1, 'failed:', e.message);
        });
    });
  },

  // IMPROVED: Better handling of locked audio with visual feedback
  playNotificationSound() {
	  // If locked, queue the sound for after unlock
    if (!this._audioUnlocked) {
      this._queuedSound = true;
    }
    console.log('🎵 playNotificationSound called, unlocked:', this._audioUnlocked);
    
    if (!this.notificationSound) {
      console.log('⚠️ No notificationSound, initializing...');
      this.initSoundSystem();
    }
    
    if (!this.notificationSound) {
      console.error('❌ Failed to create notificationSound');
      return;
    }
    
    this.notificationSound.currentTime = 0;
    
    // If unlocked, play immediately
    if (this._audioUnlocked) {
      console.log('▶️ Audio unlocked, playing now...');
      this.notificationSound.play()
        .then(() => console.log('✅ Sound played successfully!'))
        .catch(e => {
          console.error('❌ Play failed:', e.message);
          if (e.name === 'NotAllowedError') {
            this._audioUnlocked = false;
            // Retry with unlock
            this.showUnlockPrompt();
          }
        });
      return;
    }
    
    // Audio is locked - show visual notification and queue sound
    console.log('🔒 Audio locked - showing visual notification');
    this.showUnlockPrompt();
  },

  showUnlockPrompt() {
    // Only show once per session
    if (sessionStorage.getItem('audio_unlock_shown')) return;
    sessionStorage.setItem('audio_unlock_shown', 'true');
    
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 24px;">🔔</span>
        <div>
          <div style="font-weight: 600;">Tap to enable sounds</div>
          <div style="font-size: 12px; opacity: 0.9;">Click anywhere to unlock notifications</div>
        </div>
      </div>
    `;
    toast.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #FF6D00;
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      font-family: sans-serif;
      font-size: 14px;
      cursor: pointer;
      animation: slideDown 0.3s ease;
      min-width: 280px;
    `;
    
    // Add animation styles if not present
    if (!document.getElementById('toast-anim-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-anim-styles';
      style.textContent = `
        @keyframes slideDown {
          from { transform: translate(-50%, -20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Unlock and play on any interaction
    const unlockAndPlay = (e) => {
      // Don't trigger if clicking inside the toast itself (let it bubble)
      this.unlockAudio();
      
      // Try to play any queued sounds
      setTimeout(() => {
        if (this._audioUnlocked) {
          this.notificationSound.currentTime = 0;
          this.notificationSound.play().catch(() => {});
        }
      }, 100);
      
      // Remove toast
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
      
      // Remove listeners
      document.removeEventListener('click', unlockAndPlay);
      document.removeEventListener('touchstart', unlockAndPlay);
    };
    
    // Add listeners with capture to catch any interaction
    document.addEventListener('click', unlockAndPlay, { once: true, capture: true });
    document.addEventListener('touchstart', unlockAndPlay, { once: true, capture: true });
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }
    }, 10000);
  },

  async init(user) {
    if (this.initialized) return;
    this.initialized = true;
    
    this.currentUser = user;
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._init());
    } else {
      this._init();
    }
  },

  async _init() {
    await this.loadUserProfile();
    chatList.init(this.currentUser, db);
    chatScreen.init(this.currentUser, db);
    messages.init(this.currentUser, db);
    this.setupGlobalListeners();
    this.setupOverflowMenus();
    this.setupInputListeners();
    this.setupNotificationListeners(); // Setup real-time notifications
    this.setupForegroundNotifications(); // Setup FCM foreground handler
    
    // Initialize sound system
    this.initSoundSystem();
    
    // CRITICAL: Unlock audio on first user interaction - MULTIPLE EARLY LISTENERS
    this._audioUnlocked = false;
    
    const handleFirstInteraction = (e) => {
      console.log('👆 First user interaction detected:', e.type);
      this.unlockAudio();
      
      // Also try to immediately play if there was a queued sound
      if (this._queuedSound) {
        setTimeout(() => this.playNotificationSound(), 50);
        this._queuedSound = false;
      }
    };
    
    // Multiple listeners for different interaction types - all with capture
    const interactionEvents = ['click', 'touchstart', 'touchend', 'mousedown', 'keydown'];
    interactionEvents.forEach(event => {
      document.addEventListener(event, handleFirstInteraction, { 
        once: true, 
        capture: true 
      });
    });
    
    // Also listen on window for page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this._audioUnlocked) {
        // Try to unlock when user returns to tab
        this.unlockAudio();
      }
    });
  },
  
  setupInputListeners() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const voiceBtn = document.getElementById('voice-btn');

    if (input) {
      input.addEventListener('input', () => {
        const hasText = input.value.trim().length > 0;
        sendBtn?.classList.toggle('hidden', !hasText);
        voiceBtn?.classList.toggle('hidden', hasText);
      });
    }
  },

  // Show in-app toast notification
  showPopMessage(title = 'New message', body = '') {
    const toast = document.createElement('div');
    toast.innerHTML = `<strong>${title}</strong>${body ? '<br>' + body : ''}`;
    toast.style.cssText = 'position:fixed;top:80px;right:16px;background:#333;color:#fff;padding:12px 16px;border-radius:8px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;font-size:14px;max-width:300px;animation:slideIn 0.3s ease;';
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  },

  // Setup FCM foreground message handler
  setupForegroundNotifications() {
    window.addEventListener('fcm-message', (event) => {
      const payload = event.detail;
      console.log('ChatApp received foreground message:', payload);
      
      // Play sound for ALL foreground messages (except own)
      // Note: FCM messages from your own device shouldn't arrive via onMessage
      this.playNotificationSound();
      
      // Show toast only if not currently viewing the specific chat
      const dmId = payload.data?.dmId;
      const kennelId = payload.data?.kennelId;
      
      const isViewingDm = dmId && this.currentChat?.id === dmId && this.currentChat?.type === 'dm';
      const isViewingKennel = kennelId && this.currentChat?.kennelPath?.includes(kennelId);
      
      if (!isViewingDm && !isViewingKennel) {
        this.showPopMessage(
          payload.notification?.title || 'New Message',
          payload.notification?.body || ''
        );
      }
      
      // Refresh chat list
      if (chatList.refresh) {
        chatList.refresh();
      }
    });
  },

  // Setup real-time listeners for new messages (for in-app audio)
  setupNotificationListeners() {
    const uid = this.currentUser.uid;
    console.log('🔔 setupNotificationListeners called for uid:', uid);
    
    // Listen to all DM rooms for new messages
    const dmQuery = query(
      collection(db, 'dms'),
      where('participants', 'array-contains', uid)
    );
    
    console.log('📡 Setting up DM listener...');
    
    const dmUnsub = onSnapshot(dmQuery, (snapshot) => {
      console.log('📨 DM snapshot received, changes:', snapshot.docChanges().length);
      
      snapshot.docChanges().forEach((change) => {
        console.log('📝 DM change type:', change.type, 'doc id:', change.doc.id);
        if (change.type === 'modified' || change.type === 'added') {
          this.checkDmForNewMessages(change.doc.id, uid);
        }
      });
    }, (error) => {
      console.error('❌ DM listener error:', error);
    });
    
    this.unsubscribers.push(dmUnsub);
    
    // Listen to user document for joined kennels changes
    const userRef = doc(db, 'users', uid);
    const userUnsub = onSnapshot(userRef, (doc) => {
      const userData = doc.data();
      const joinedKennels = userData?.joinedKennels || [];
      
      console.log('👤 User data updated, joined kennels:', joinedKennels.length);
      
      // Setup listeners for each kennel
      joinedKennels.forEach(kennelPath => {
        this.setupKennelNotificationListener(kennelPath, uid);
      });
    });
    
    this.unsubscribers.push(userUnsub);
  },

  // Track which kennel listeners we've already set up
  kennelNotificationUnsubscribers: new Map(),

  setupKennelNotificationListener(kennelPath, uid) {
    // Avoid duplicate listeners
    if (this.kennelNotificationUnsubscribers.has(kennelPath)) {
      console.log('⚠️ Already listening to kennel:', kennelPath);
      return;
    }
    
    console.log('📡 Setting up kennel listener for:', kennelPath);
    
    const messagesRef = collection(db, kennelPath, 'chat_groups', 'default', 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
    
    const unsub = onSnapshot(q, (snapshot) => {
      console.log('📨 Kennel snapshot for', kennelPath, 'changes:', snapshot.docChanges().length);
      
      if (snapshot.empty) {
        console.log('⚠️ No messages in kennel');
        return;
      }
      
      if (snapshot.docChanges().length === 0) {
        console.log('⚠️ No document changes (initial load)');
        return;
      }
      
      const latestMsg = snapshot.docs[0].data();
      const msgTime = latestMsg.timestamp?.toMillis?.() || 0;
      
      console.log('📨 Group message:', {
        senderId: latestMsg.senderId,
        senderName: latestMsg.senderName,
        content: latestMsg.content?.substring(0, 30),
        time: new Date(msgTime).toLocaleTimeString()
      });
      
      // Don't notify for own messages
      if (latestMsg.senderId === uid) {
        console.log('🚫 Skipping - own message');
        return;
      }
      
      // Check if this is actually new
      const lastCheckedKey = `kennel_sound_${kennelPath}`;
      const lastChecked = parseInt(sessionStorage.getItem(lastCheckedKey) || '0');
      
      console.log('⏰ Time check:', {
        msgTime: msgTime,
        lastChecked: lastChecked,
        isNew: msgTime > lastChecked
      });
      
      if (msgTime <= lastChecked) {
        console.log('🚫 Skipping - old message');
        return;
      }
      
      // Update last checked time
      sessionStorage.setItem(lastCheckedKey, msgTime.toString());
      
      // CRITICAL FIX: Check currentView, not just currentChat
      const isInChatList = this.currentView === 'list' || !this.currentChat;
      const isCurrentlyViewingThisKennel = this.currentChat?.kennelPath === kennelPath;
      
      console.log('👁️ Viewing check:', {
        currentView: this.currentView,
        currentKennelPath: this.currentChat?.kennelPath,
        isInChatList: isInChatList,
        isCurrentlyViewingThisKennel: isCurrentlyViewingThisKennel
      });
      
      if (isInChatList || !isCurrentlyViewingThisKennel) {
        console.log('🔔 PLAYING SOUND for new group message!');
        this.playNotificationSound();
        
        // Only show popup if not viewing this specific group
        if (!isCurrentlyViewingThisKennel) {
          const sanitizedPath = kennelPath.replace(/\//g, '_');
          getDoc(doc(db, 'users', uid)).then(userDoc => {
            const userData = userDoc.data();
            const lastSeen = userData?.lastSeenGroups?.[sanitizedPath]?.toMillis?.() || 0;
            
            if (msgTime > lastSeen) {
              this.showPopMessage(
                `New message in ${latestMsg.senderName || 'group'}`,
                latestMsg.content?.substring(0, 50) || 'Media message'
              );
            }
          });
        }
      } else {
        console.log('🚫 Not playing sound - currently viewing this group');
      }
    }, (error) => {
      console.error('❌ Kennel listener error:', error);
    });
    
    this.kennelNotificationUnsubscribers.set(kennelPath, unsub);
    this.unsubscribers.push(unsub);
  },

  async checkDmForNewMessages(dmId, uid) {
    console.log('🔍 checkDmForNewMessages called for dmId:', dmId);
    
    // Get last message
    const messagesRef = collection(db, 'dms', dmId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(1));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      console.log('⚠️ No messages found in DM');
      return;
    }
    
    const lastMsg = snap.docs[0].data();
    const lastMsgTime = lastMsg.timestamp?.toMillis?.() || 0;
    
    console.log('📨 Last message:', {
      senderId: lastMsg.senderId,
      senderName: lastMsg.senderName,
      content: lastMsg.content?.substring(0, 30),
      time: new Date(lastMsgTime).toLocaleTimeString()
    });
    
    // Don't notify for own messages
    if (lastMsg.senderId === uid) {
      console.log('🚫 Skipping - own message');
      return;
    }
    
    // Check if this is actually new
    const lastCheckedKey = `dm_sound_${dmId}`;
    const lastChecked = parseInt(sessionStorage.getItem(lastCheckedKey) || '0');
    
    console.log('⏰ Time check:', {
      lastMsgTime: lastMsgTime,
      lastChecked: lastChecked,
      isNew: lastMsgTime > lastChecked
    });
    
    if (lastMsgTime <= lastChecked) {
      console.log('🚫 Skipping - old message (already played)');
      return;
    }
    
    // Update last checked time
    sessionStorage.setItem(lastCheckedKey, lastMsgTime.toString());
    
    // CRITICAL FIX: Check if we're actually in chat list view, not just if currentChat is null
    const isInChatList = this.currentView === 'list' || !this.currentChat;
    const isCurrentlyViewingThisDm = this.currentChat?.id === dmId && this.currentChat?.type === 'dm';
    
    console.log('👁️ Viewing check:', {
      currentView: this.currentView,
      currentChatId: this.currentChat?.id,
      currentChatType: this.currentChat?.type,
      isInChatList: isInChatList,
      isCurrentlyViewingThisDm: isCurrentlyViewingThisDm
    });
    
    // Play sound if in chat list OR viewing a different chat
    if (isInChatList || !isCurrentlyViewingThisDm) {
      console.log('🔔 PLAYING SOUND for new DM!');
      this.playNotificationSound();
      
      // Only show popup if not viewing this specific chat
      if (!isCurrentlyViewingThisDm) {
        this.showPopMessage(
          `Message from ${lastMsg.senderName || 'Unknown'}`,
          lastMsg.content?.substring(0, 50) || 'Media message'
        );
      }
    } else {
      console.log('🚫 Not playing sound - currently viewing this chat');
    }
  },

  async loadUserProfile() {
    const userRef = doc(db, 'users', this.currentUser.uid);
    const userSnap = await getDoc(userRef);
    const data = userSnap.data();
    
    const avatar = document.getElementById('my-avatar-list');
    if (avatar && data?.profilePicUrl) {
      avatar.src = data.profilePicUrl;
    }
  },

  setupGlobalListeners() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.app-bar') && !e.target.closest('.overflow-menu')) {
        document.querySelectorAll('.overflow-menu').forEach(m => m.classList.add('hidden'));
      }
      if (!e.target.closest('.attach-btn') && !e.target.closest('.attach-panel')) {
        document.getElementById('attach-panel')?.classList.remove('show');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.currentView === 'chat') {
        this.backToList();
      }
    });
  },

  setupOverflowMenus() {


    // CHAT SCREEN overflow menu (chat header) - Styled, no "More Options..."
    document.getElementById('chatOverflowBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('chatOverflowMenu');
      
      // Styled menu matching app design - NO "More Options..."
      menu.innerHTML = `
        <div style="
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          min-width: 200px;
          overflow: hidden;
        ">
          <div class="chat-overflow-item" data-action="search" style="
            padding: 14px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 15px;
            color: #333;
            transition: background 0.2s;
            border-bottom: 1px solid #f0f0f0;
          " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
            <span style="font-size: 18px; width: 24px; text-align: center;">🔍</span>
            <span>Search in Chat</span>
          </div>
          
          <div class="chat-overflow-item" data-action="sound" style="
            padding: 14px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 15px;
            color: #333;
            transition: background 0.2s;
            border-bottom: 1px solid #f0f0f0;
          " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
            <span style="font-size: 18px; width: 24px; text-align: center;">🔔</span>
            <span>Change Sound</span>
          </div>
          
          <div class="chat-overflow-item" data-action="mute" style="
            padding: 14px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 15px;
            color: #333;
            transition: background 0.2s;
            border-bottom: 1px solid #f0f0f0;
          " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">
            <span style="font-size: 18px; width: 24px; text-align: center;">🔕</span>
            <span>Mute Notifications</span>
          </div>
          
          <div class="chat-overflow-item" data-action="clear" style="
            padding: 14px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 15px;
            color: #d32f2f;
            transition: background 0.2s;
          " onmouseover="this.style.background='#ffebee'" onmouseout="this.style.background='transparent'">
            <span style="font-size: 18px; width: 24px; text-align: center;">🗑</span>
            <span>Clear Chat</span>
          </div>
        </div>
      `;
      
      // Add click handlers
      menu.querySelectorAll('.chat-overflow-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = item.dataset.action;
          this.handleChatScreenOverflowAction(action);
          menu.classList.add('hidden');
        });
      });
      
      menu.classList.toggle('hidden');
    });
  },
  
  handleChatScreenOverflowAction(action) {
    switch(action) {
      case 'search':
        this.searchInChat();
        break;
      case 'mute':
        this.muteChat();
        break;
      case 'clear':
        this.clearChat();
        break;
      case 'sound':
        this.showSoundSelector();
        break;
      case 'more':
        this.showMoreMenu();
        break;
    }
  },
  
  showSoundSelector() {
    const existing = document.getElementById('sound-selector-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'sound-selector-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const soundOptions = Object.entries(this.soundLibrary).map(([key, sound]) => {
      const isSelected = this.currentSound === key;
      return `
        <div class="sound-option-row" data-sound="${key}" style="
          display: flex;
          align-items: center;
          padding: 16px;
          margin: 8px 0;
          background: ${isSelected ? '#FFF3E0' : 'white'};
          border-radius: 12px;
          cursor: pointer;
          border: 2px solid ${isSelected ? '#FF6D00' : '#e0e0e0'};
          transition: all 0.2s ease;
        ">
          <div class="radio-circle" style="
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid ${isSelected ? '#FF6D00' : '#999'};
            background: ${isSelected ? '#FF6D00' : 'white'};
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 12px;
            flex-shrink: 0;
          ">
            ${isSelected ? '<div style="width: 10px; height: 10px; background: white; border-radius: 50%;"></div>' : ''}
          </div>
          
          <div style="flex: 1; display: flex; flex-direction: column;">
            <span style="font-weight: 600; font-size: 16px; color: #333;">${sound.name}</span>
            <span style="font-size: 12px; color: #666; margin-top: 2px;">
              ${isSelected ? 'Currently selected' : 'Tap to select'}
            </span>
          </div>
          
          <button class="play-sound-btn" data-sound="${key}" style="
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #FF6D00;
            color: white;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
            transition: transform 0.1s;
          " onclick="event.stopPropagation();">▶</button>
        </div>
      `;
    }).join('');

    dialog.innerHTML = `
      <div style="
        background: #f5f5f5;
        width: 90%;
        max-width: 400px;
        max-height: 80vh;
        border-radius: 20px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          background: white;
          border-bottom: 1px solid #e0e0e0;
        ">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="
              width: 40px;
              height: 40px;
              border-radius: 50%;
              background: #FF6D00;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 20px;
            ">🔔</div>
            <div>
              <h2 style="margin: 0; font-size: 20px; color: #333; font-weight: 600;">Change Sound</h2>
              <p style="margin: 0; font-size: 13px; color: #666;">Select notification sound</p>
            </div>
          </div>
          <button id="close-sound-dialog" style="
            background: none;
            border: none;
            font-size: 28px;
            cursor: pointer;
            color: #999;
            padding: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s;
          " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='none'">×</button>
        </div>
        
        <div style="flex: 1; overflow-y: auto; padding: 16px;">
          ${soundOptions}
        </div>
        
        <div style="
          padding: 16px 20px;
          background: white;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span style="font-size: 14px; color: #666;">
            Current: <strong style="color: #FF6D00;">${this.getCurrentSoundName()}</strong>
          </span>
          <button id="done-btn" style="
            padding: 10px 24px;
            background: #FF6D00;
            color: white;
            border: none;
            border-radius: 20px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
          ">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('close-sound-dialog').addEventListener('click', () => dialog.remove());
    document.getElementById('done-btn').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

    dialog.querySelectorAll('.play-sound-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const soundKey = btn.dataset.sound;
        const previewAudio = new Audio(this.soundLibrary[soundKey].url);
        previewAudio.currentTime = 0;
        previewAudio.play().catch(err => {
          console.log('Preview play failed:', err);
          this.showToast('Could not play sound', 'error');
        });
        btn.innerHTML = '♪';
        btn.style.background = '#4CAF50';
        setTimeout(() => {
          btn.innerHTML = '▶';
          btn.style.background = '#FF6D00';
        }, 1000);
      });
    });

    dialog.querySelectorAll('.sound-option-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.play-sound-btn')) return;
        const soundKey = row.dataset.sound;
        if (this.setSound(soundKey, false)) {
          dialog.remove();
          this.showSoundSelector();
          this.showToast(`Sound: ${this.soundLibrary[soundKey].name}`);
        }
      });
    });
  },

  async openDmChat(dmId, name, otherUid, otherPic, myPic, lastSeen = 0) {
    console.log('=== openDmChat called ===', { dmId, name, otherUid });
    
    this.currentChatLastSeen = parseInt(lastSeen) || 0;
    
    const listView = document.getElementById('chat-list-view');
    const chatView = document.getElementById('chat-screen-view');
    
    if (!listView || !chatView) {
      console.error('View elements not found in DOM');
      return;
    }

    this.currentChat = {
      id: dmId,
      type: 'dm',
      name: name,
      otherUid: otherUid,
      otherPic: otherPic,
      myPic: myPic
    };

    const headerAvatars = document.getElementById('header-avatars');
    if (headerAvatars) {
      headerAvatars.className = 'header-avatars dm-style';
      headerAvatars.innerHTML = `
        <img src="${otherPic || this.createPlaceholder('?')}" alt="Other" onerror="this.src='${this.createPlaceholder('?')}'">
        <div class="swap-icon">⇆</div>
        <img src="${myPic || this.createPlaceholder('Me')}" alt="Me" onerror="this.src='${this.createPlaceholder('Me')}'">
      `;
    }

    const chatName = document.getElementById('chat-name');
    const chatStatus = document.getElementById('chat-status');
    if (chatName) chatName.textContent = name;
    if (chatStatus) chatStatus.textContent = 'online';

    await chatScreen.loadMessages(dmId, 'dm');
	chatScreen.setupScrollListener(dmId, 'dm'); // Add this
    this.switchView('chat');
    this.setupTypingListener(dmId, 'dm', otherUid);
    
    const newChatBtn = document.querySelector('.new-chat-btn');
    if (newChatBtn) newChatBtn.classList.add('hidden');
  },

  async openGroupChat(kennelId, name, kennelPath, icon, lastSeen = 0) {
    const listView = document.getElementById('chat-list-view');
    const chatView = document.getElementById('chat-screen-view');
    
    if (!listView || !chatView) {
      console.error('View elements not found in DOM');
      return;
    }

    this.currentChatLastSeen = parseInt(lastSeen) || 0;

    this.currentChat = {
      id: kennelId,
      type: 'group',
      name: name,
      kennelPath: kennelPath,
      icon: icon
    };

    const headerAvatars = document.getElementById('header-avatars');
    if (headerAvatars) {
      headerAvatars.className = 'header-avatars group-style';
      headerAvatars.innerHTML = `
        <img src="${icon || this.createPlaceholder(name[0], '#4CAF50')}" alt="${name}">
      `;
    }

    const chatName = document.getElementById('chat-name');
    const chatStatus = document.getElementById('chat-status');
    if (chatName) chatName.textContent = name;
    if (chatStatus) chatStatus.textContent = '12 members';

    await chatScreen.loadMessages(kennelId, 'group', kennelPath);
	  chatScreen.setupScrollListener(kennelId, 'group', kennelPath); // Add this
    this.switchView('chat');
    
    const newChatBtn = document.querySelector('.new-chat-btn');
    if (newChatBtn) newChatBtn.classList.remove('hidden');
  },

  setupTypingListener(chatId, type, otherUid) {
    const collectionName = type === 'dm' ? 'dms' : 'kennels';
    const chatRef = doc(db, collectionName, chatId);
    
    const unsub = onSnapshot(chatRef, (doc) => {
      const data = doc.data();
      const isTyping = data?.typing?.[otherUid] || false;
      const indicator = document.getElementById('typing-indicator');
      if (indicator) {
        indicator.classList.toggle('hidden', !isTyping);
      }
      if (isTyping) chatScreen.scrollToBottom();
    });
    
    this.unsubscribers.push(unsub);
  },

  switchView(view) {
    console.log('Switching to view:', view);
    this.currentView = view;
    
    const listView = document.getElementById('chat-list-view');
    const chatView = document.getElementById('chat-screen-view');
    
    if (!listView || !chatView) {
      console.error('View elements missing');
      return;
    }
    
    listView.classList.remove('active');
    chatView.classList.remove('active');
    
    if (view === 'list') {
      listView.classList.add('active');
    } else if (view === 'chat') {
      chatView.classList.add('active');
      this.renderMessagesWithSeparator();
    }
  },

  renderMessagesWithSeparator() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    container.dataset.lastSeen = this.currentChatLastSeen;
  },


async backToList() {
  console.log('[BACK] backToList() called');
  
  await this.markChatAsRead();
  console.log('[BACK] markChatAsRead done');
  
  console.log('[BACK] Unsubscribing', this.unsubscribers.length, 'listeners');
  this.unsubscribers.forEach(unsub => unsub());
  this.unsubscribers = [];
  
  if (chatScreen) {
    console.log('[BACK] Calling chatScreen.cleanup()');
    chatScreen.cleanup();
  }
  
  console.log('[BACK] Setting currentChat to null');
  this.currentChat = null;
  this.currentChatLastSeen = 0;
  this.selectedMessages.clear();
  this.isSelectionMode = false;
  
  console.log('[BACK] Calling switchView(list)');
  this.switchView('list');
  
  document.querySelector('.new-chat-btn')?.classList.remove('hidden');
  chatList.refresh();
  
  console.log('[BACK] Done');
},

  // ============================================
  // WHATSAPP-STYLE SELECTION & FORWARD
  // ============================================

  enterSelectionMode() {
    this.isSelectionMode = true;
    document.body.classList.add('selection-mode-active');
    document.getElementById('chat-header-normal').style.display = 'none';
    document.getElementById('chat-header-selection').style.display = 'block';
    this.updateSelectionCounter();
    
    // Update all selection handles to show checkbox state
    document.querySelectorAll('.message').forEach(msg => {
      const handle = msg.querySelector('.message-select-handle');
      if (handle) {
        handle.style.display = 'flex';
      }
      
      // Add checkbox if not exists
      if (!msg.querySelector('.message-select-checkbox')) {
        const checkbox = document.createElement('div');
        checkbox.className = 'message-select-checkbox';
        checkbox.innerHTML = '✓';
        msg.appendChild(checkbox);
      }
    });
  },

  exitSelectionMode() {
    this.isSelectionMode = false;
    this.selectedMessages.clear();
    document.body.classList.remove('selection-mode-active');
    document.getElementById('chat-header-normal').style.display = 'block';
    document.getElementById('chat-header-selection').style.display = 'none';
    
    // Remove selection styling
    document.querySelectorAll('.message').forEach(msg => {
      msg.classList.remove('selected');
      const checkbox = msg.querySelector('.message-select-checkbox');
      if (checkbox) checkbox.remove();
      
      const handle = msg.querySelector('.message-select-handle');
      if (handle) {
        handle.classList.remove('selected');
        handle.innerHTML = '☐';
      }
    });
  },

  cancelSelection() {
    this.exitSelectionMode();
  },

  toggleMessageSelection(messageEl) {
    const messageId = messageEl.dataset.id;
    const handle = messageEl.querySelector('.message-select-handle');
    
    if (this.selectedMessages.has(messageId)) {
      this.selectedMessages.delete(messageId);
      messageEl.classList.remove('selected');
      if (handle) {
        handle.classList.remove('selected');
        handle.innerHTML = '☐';
      }
    } else {
      if (!this.isSelectionMode) {
        this.enterSelectionMode();
      }
      this.selectedMessages.add(messageId);
      messageEl.classList.add('selected');
      if (handle) {
        handle.classList.add('selected');
        handle.innerHTML = '✓';
      }
    }
    
    this.updateSelectionCounter();
    
    // Exit if no messages selected
    if (this.selectedMessages.size === 0) {
      this.exitSelectionMode();
    }
  },

  updateSelectionCounter() {
    const count = this.selectedMessages.size;
    const counter = document.getElementById('selection-counter');
    if (counter) {
      counter.textContent = `${count} selected`;
    }
    
    // Show/hide copy button based on text selection
    const messages = this.getSelectedMessagesData();
    const hasText = messages.some(m => m.messageType === 'text' || !m.messageType);
    document.getElementById('copy-btn').style.display = hasText ? 'block' : 'none';
  },

  getSelectedMessagesData() {
    const selected = [];
    document.querySelectorAll('.message.selected').forEach(el => {
      const id = el.dataset.id;
      const msg = chatScreen.currentMessages.find(m => m.id === id);
      if (msg) selected.push(msg);
    });
    return selected;
  },

  // Long press handler
  handleLongPress(messageEl) {
    if ('vibrate' in navigator) {
      navigator.vibrate(50); // Haptic feedback
    }
    this.toggleMessageSelection(messageEl);
  },

  // Swipe to reply handlers
  handleTouchStart(e, messageEl) {
    if (this.isSelectionMode) return;
    
    const touch = e.touches[0];
    this.swipeState = {
      startX: touch.clientX,
      currentX: touch.clientX,
      messageEl: messageEl,
      isSwiping: false
    };
  },

  handleTouchMove(e, messageEl) {
    if (this.isSelectionMode) return;
    
    const touch = e.touches[0];
    this.swipeState.currentX = touch.clientX;
    
    const deltaX = this.swipeState.currentX - this.swipeState.startX;
    
    // Only allow right swipe
    if (deltaX > 0 && deltaX < 100) {
      this.swipeState.isSwiping = true;
      messageEl.style.transform = `translateX(${deltaX}px)`;
      messageEl.classList.add('swiping');
      
      // Show reply indicator at 50px
      if (deltaX > 50 && !messageEl.querySelector('.swipe-reply-indicator')) {
        const indicator = document.createElement('div');
        indicator.className = 'swipe-reply-indicator';
        indicator.innerHTML = '↩️';
        messageEl.appendChild(indicator);
      }
    }
  },

  handleTouchEnd(e, messageEl) {
    if (this.isSelectionMode || !this.swipeState.isSwiping) return;
    
    const deltaX = this.swipeState.currentX - this.swipeState.startX;
    
    // Threshold for reply trigger
    if (deltaX > 60) {
      // Trigger reply
      const messageId = messageEl.dataset.id;
      const msg = chatScreen.currentMessages.find(m => m.id === messageId);
      if (msg) {
        messages.setReply(msg);
      }
    }
    
    // Reset
    messageEl.style.transform = '';
    messageEl.classList.remove('swiping');
    const indicator = messageEl.querySelector('.swipe-reply-indicator');
    if (indicator) indicator.remove();
    
    this.swipeState = { startX: 0, currentX: 0, messageEl: null, isSwiping: false };
  },

  // Action handlers
  replyToSelected() {
    const selected = this.getSelectedMessagesData();
    if (selected.length === 1) {
      messages.setReply(selected[0]);
      this.exitSelectionMode();
    }
  },

  forwardSelected() {
    const selected = this.getSelectedMessagesData();
    if (selected.length === 0) return;
    this.showForwardDialog(selected);
  },

  copySelected() {
    const selected = this.getSelectedMessagesData();
    const textMessages = selected.filter(m => m.messageType === 'text' || !m.messageType);
    
    if (textMessages.length > 0) {
      const text = textMessages.map(m => m.content).join('\n');
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('Copied to clipboard');
        this.exitSelectionMode();
      });
    }
  },

  async deleteSelected() {
    const selected = this.getSelectedMessagesData();
    if (selected.length === 0) return;
    
    if (confirm(`Delete ${selected.length} message(s)?`)) {
      try {
        // Remove from UI immediately
        selected.forEach(msg => {
          const msgEl = document.querySelector(`.message[data-id="${msg.id}"]`);
          if (msgEl) {
            msgEl.style.transition = 'all 0.3s ease';
            msgEl.style.opacity = '0';
            msgEl.style.transform = 'translateX(-100%)';
            setTimeout(() => msgEl.remove(), 300);
          }
          
          // Remove from chatScreen.currentMessages array
          const index = chatScreen.currentMessages.findIndex(m => m.id === msg.id);
          if (index > -1) {
            chatScreen.currentMessages.splice(index, 1);
          }
        });
        
        // Delete from database in background
        const deletePromises = selected.map(async (msg) => {
          let docRef;
          
          if (this.currentChat.type === 'dm') {
            docRef = doc(db, 'dms', this.currentChat.id, 'messages', msg.id);
          } else {
            const pathParts = this.currentChat.kennelPath.split('/');
            docRef = doc(db, ...pathParts, 'chat_groups', 'default', 'messages', msg.id);
          }
          
          return deleteDoc(docRef);
        });
        
        await Promise.all(deletePromises);
        this.showToast(`Deleted ${selected.length} message(s)`);
        this.exitSelectionMode();
      } catch (err) {
        console.error('Error deleting messages:', err);
        this.showToast('Failed to delete messages', 'error');
      }
    }
  },

  infoSelected() {
    const selected = this.getSelectedMessagesData();
    if (selected.length === 1) {
      const msg = selected[0];
      const time = msg.timestamp?.toDate?.() || new Date(msg.timestamp);
      alert(`Sent by: ${msg.senderName || 'Unknown'}\nTime: ${time.toLocaleString()}\nType: ${msg.messageType || 'text'}`);
      this.exitSelectionMode();
    }
  },
  
  // Alternative selection method: Show menu on button click
  showMessageMenu(messageId) {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (!msgEl) return;

    // Create simple menu
    const existing = document.querySelector('.message-context-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.style.cssText = `
      position: fixed;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 8px 0;
      min-width: 180px;
      z-index: 1000;
      font-family: sans-serif;
    `;
    
    const msg = chatScreen.currentMessages.find(m => m.id === messageId);
    
    menu.innerHTML = `
      <div style="padding: 12px 16px; cursor: pointer; hover: background: #f5f5f5;" onclick="chatApp.selectMessageFromMenu('${messageId}'); this.parentElement.remove();">
        <span style="margin-right: 8px;">☐</span> Select
      </div>
      <div style="padding: 12px 16px; cursor: pointer;" onclick="chatApp.quickReply('${messageId}'); this.parentElement.remove();">
        <span style="margin-right: 8px;">↩️</span> Reply
      </div>
      ${msg && (msg.messageType === 'text' || !msg.messageType) ? `
      <div style="padding: 12px 16px; cursor: pointer;" onclick="chatApp.quickCopy('${messageId}'); this.parentElement.remove();">
        <span style="margin-right: 8px;">📋</span> Copy
      </div>
      ` : ''}
      <div style="padding: 12px 16px; cursor: pointer; color: #f44336;" onclick="chatApp.quickDelete('${messageId}'); this.parentElement.remove();">
        <span style="margin-right: 8px;">🗑️</span> Delete
      </div>
    `;
    
    // Position near the message
    const rect = msgEl.getBoundingClientRect();
    menu.style.top = (rect.top + 20) + 'px';
    menu.style.left = (rect.right - 200) + 'px';
    
    document.body.appendChild(menu);
    
    // Remove on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 100);
  },

  selectMessageFromMenu(messageId) {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgEl) {
      this.toggleMessageSelection(msgEl);
    }
  },

  quickReply(messageId) {
    const msg = chatScreen.currentMessages.find(m => m.id === messageId);
    if (msg && window.messages) {
      window.messages.setReply(msg);
    }
  },

  quickCopy(messageId) {
    const msg = chatScreen.currentMessages.find(m => m.id === messageId);
    if (msg && (msg.messageType === 'text' || !msg.messageType)) {
      navigator.clipboard.writeText(msg.content).then(() => {
        this.showToast('Copied to clipboard');
      });
    }
  },

  quickDelete(messageId) {
    if (!confirm('Delete this message?')) return;
    
    const msg = chatScreen.currentMessages.find(m => m.id === messageId);
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    
    if (msg && msgEl) {
      // Animate removal
      msgEl.style.transition = 'all 0.3s';
      msgEl.style.opacity = '0';
      msgEl.style.transform = 'translateX(-100%)';
      setTimeout(() => msgEl.remove(), 300);
      
      // Remove from array
      const index = chatScreen.currentMessages.findIndex(m => m.id === messageId);
      if (index > -1) {
        chatScreen.currentMessages.splice(index, 1);
      }
      
      // Delete from database
      let docRef;
      if (this.currentChat.type === 'dm') {
        docRef = doc(db, 'dms', this.currentChat.id, 'messages', messageId);
      } else {
        const pathParts = this.currentChat.kennelPath.split('/');
        docRef = doc(db, ...pathParts, 'chat_groups', 'default', 'messages', messageId);
      }
      
      deleteDoc(docRef).catch(err => {
        console.error('Delete failed:', err);
        this.showToast('Delete failed', 'error');
      });
    }
  },

  // Forward Dialog
  showForwardDialog(messagesToForward) {
    const existing = document.getElementById('forward-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'forward-dialog-overlay';
    overlay.id = 'forward-dialog';
    
    const selectedRecipients = new Set();
    let activeTab = 'users'; // 'users' or 'groups'

    // Data sources
    const recentDmChats = chatList.conversations.filter(c => c.type === 'dm').map(conv => ({
      id: conv.id,
      type: 'dm',
      name: conv.name,
      avatar: conv.otherPic || this.createPlaceholder(conv.name[0], '#FF6D00'),
      path: `dms/${conv.id}`,
      otherUid: conv.otherUid,
      isRecent: true
    }));

    let allUsers = [];
    let joinedGroups = [];

    // Load users and groups
    const loadData = async () => {
      // Load all users
      try {
        const usersQuery = query(collection(db, 'users'), orderBy('hashHandleLower'), limit(200));
        const usersSnap = await getDocs(usersQuery);
        allUsers = usersSnap.docs
          .filter(d => d.id !== this.currentUser.uid)
          .map(d => ({
            id: d.id,
            type: 'dm',
            name: d.data().hashHandle || 'Unknown',
            avatar: d.data().profilePicUrl || this.createPlaceholder((d.data().hashHandle || '?')[0], '#FF6D00'),
            path: `dms/${[this.currentUser.uid, d.id].sort().join('-')}`,
            otherUid: d.id,
            isRecent: false
          }));
      } catch (e) {
        console.error('Error loading users:', e);
      }

      // Load joined groups from conversations
      joinedGroups = chatList.conversations
        .filter(c => c.type === 'group')
        .map(conv => ({
          id: conv.id,
          type: 'group',
          name: conv.name,
          avatar: conv.icon || this.createPlaceholder(conv.name[0], '#4CAF50'),
          path: conv.kennelPath,
          isRecent: false
        }));

      renderContent();
    };

    const renderRecipientList = (items) => {
      if (items.length === 0) {
        return '<div style="padding: 40px; text-align: center; color: #999;">No items found</div>';
      }
      
      return items.map(item => `
        <div class="forward-item ${selectedRecipients.has(item.id) ? 'selected' : ''}" 
             data-id="${item.id}" 
             data-type="${item.type}"
             data-path="${this.escapeHtml(item.path)}"
             data-name="${this.escapeHtml(item.name)}"
             data-otheruid="${item.otherUid || ''}">
          <img src="${item.avatar}" class="forward-item-avatar ${item.type === 'group' ? 'group' : ''}" onerror="this.src='${this.createPlaceholder(item.name[0], item.type === 'group' ? '#4CAF50' : '#FF6D00')}'">
          <div class="forward-item-info">
            <div class="forward-item-name">${this.escapeHtml(item.name)}</div>
            <div class="forward-item-type">${item.type === 'dm' ? 'User' : 'Group'} ${item.isRecent ? '• Recent' : ''}</div>
          </div>
          <div class="forward-checkbox">${selectedRecipients.has(item.id) ? '✓' : ''}</div>
        </div>
      `).join('');
    };

    const renderContent = () => {
      const contentDiv = document.getElementById('forward-content');
      const searchTerm = document.getElementById('forward-search-input')?.value.trim().toLowerCase() || '';
      
      if (!contentDiv) return;

      if (activeTab === 'users') {
        // Filter users by search
        const filteredRecent = searchTerm ? 
          recentDmChats.filter(u => u.name.toLowerCase().includes(searchTerm)) : 
          recentDmChats;
        
        const filteredAll = searchTerm ? 
          allUsers.filter(u => u.name.toLowerCase().includes(searchTerm) && !recentDmChats.some(r => r.id === u.id)) : 
          allUsers.filter(u => !recentDmChats.some(r => r.id === u.id));

        contentDiv.innerHTML = `
          ${filteredRecent.length > 0 ? `
            <div class="forward-section-title">Recent Chats</div>
            ${renderRecipientList(filteredRecent)}
          ` : ''}
          ${filteredAll.length > 0 ? `
            <div class="forward-section-title">All Users</div>
            ${renderRecipientList(filteredAll)}
          ` : ''}
          ${filteredRecent.length === 0 && filteredAll.length === 0 ? 
            '<div style="padding: 40px; text-align: center; color: #999;">No users found</div>' : ''}
        `;
      } else {
        // Groups tab
        const filteredGroups = searchTerm ? 
          joinedGroups.filter(g => g.name.toLowerCase().includes(searchTerm)) : 
          joinedGroups;

        contentDiv.innerHTML = `
          ${filteredGroups.length > 0 ? `
            <div class="forward-section-title">Joined Groups</div>
            ${renderRecipientList(filteredGroups)}
          ` : `
            <div style="padding: 40px; text-align: center; color: #999;">
              <div style="font-size: 48px; margin-bottom: 16px;">👥</div>
              <p>No joined groups</p>
            </div>
          `}
        `;
      }

      attachItemListeners();
    };

    overlay.innerHTML = `
      <div class="forward-dialog">
        <div class="forward-dialog-header">
          <h3>Forward to</h3>
          <button onclick="document.getElementById('forward-dialog').remove()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">×</button>
        </div>
        
        <div style="display: flex; border-bottom: 1px solid #e0e0e0;">
          <button id="tab-users" style="flex: 1; padding: 16px; border: none; background: ${activeTab === 'users' ? '#f5f5f5' : 'white'}; font-weight: ${activeTab === 'users' ? 'bold' : 'normal'}; cursor: pointer; color: ${activeTab === 'users' ? '#00C853' : '#666'};">Users</button>
          <button id="tab-groups" style="flex: 1; padding: 16px; border: none; background: ${activeTab === 'groups' ? '#f5f5f5' : 'white'}; font-weight: ${activeTab === 'groups' ? 'bold' : 'normal'}; cursor: pointer; color: ${activeTab === 'groups' ? '#00C853' : '#666'};">Groups</button>
        </div>
        
        <div class="forward-search">
          <input type="text" id="forward-search-input" placeholder="Search ${activeTab}...">
        </div>
        
        <div class="forward-content" id="forward-content" style="flex: 1; overflow-y: auto;">
          <div style="padding: 40px; text-align: center; color: #999;">Loading...</div>
        </div>
        
        <div class="forward-footer">
          <span class="forward-count" id="forward-count">0 selected</span>
          <button class="forward-send-btn" id="forward-send-btn" disabled>Send</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Tab switching
    document.getElementById('tab-users').addEventListener('click', () => {
      activeTab = 'users';
      document.getElementById('tab-users').style.background = '#f5f5f5';
      document.getElementById('tab-users').style.fontWeight = 'bold';
      document.getElementById('tab-users').style.color = '#00C853';
      document.getElementById('tab-groups').style.background = 'white';
      document.getElementById('tab-groups').style.fontWeight = 'normal';
      document.getElementById('tab-groups').style.color = '#666';
      document.getElementById('forward-search-input').placeholder = 'Search users...';
      renderContent();
    });

    document.getElementById('tab-groups').addEventListener('click', () => {
      activeTab = 'groups';
      document.getElementById('tab-groups').style.background = '#f5f5f5';
      document.getElementById('tab-groups').style.fontWeight = 'bold';
      document.getElementById('tab-groups').style.color = '#00C853';
      document.getElementById('tab-users').style.background = 'white';
      document.getElementById('tab-users').style.fontWeight = 'normal';
      document.getElementById('tab-users').style.color = '#666';
      document.getElementById('forward-search-input').placeholder = 'Search groups...';
      renderContent();
    });

    // Search handler
    document.getElementById('forward-search-input').addEventListener('input', () => {
      renderContent();
    });

    const attachItemListeners = () => {
      const contentDiv = document.getElementById('forward-content');
      contentDiv.querySelectorAll('.forward-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          
          if (selectedRecipients.has(id)) {
            selectedRecipients.delete(id);
            item.classList.remove('selected');
            item.querySelector('.forward-checkbox').textContent = '';
          } else {
            selectedRecipients.add(id);
            item.classList.add('selected');
            item.querySelector('.forward-checkbox').textContent = '✓';
          }
          
          document.getElementById('forward-count').textContent = `${selectedRecipients.size} selected`;
          document.getElementById('forward-send-btn').disabled = selectedRecipients.size === 0;
        });
      });
    };

    // Send button
    document.getElementById('forward-send-btn').addEventListener('click', async () => {
      if (selectedRecipients.size === 0) return;
      
      const recipientElements = document.querySelectorAll('.forward-item.selected');
      
      for (const el of recipientElements) {
        const type = el.dataset.type;
        const path = el.dataset.path;
        const name = el.dataset.name;
        const otherUid = el.dataset.otheruid;
        
        for (const msg of messagesToForward) {
          const forwardContent = msg.messageType === 'text' || !msg.messageType ? 
            msg.content : 
            `[Forwarded ${msg.messageType} from ${msg.senderName || 'Unknown'}]`;
          
          const forwardData = {
            content: forwardContent,
            senderId: this.currentUser.uid,
            senderName: this.userData?.hashHandle || 'Me',
            senderPic: this.userData?.profilePicUrl || '',
            timestamp: Timestamp.now(),
            messageType: msg.messageType || 'text',
            mediaUrl: msg.mediaUrl || null,
            forwardedFrom: {
              senderName: msg.senderName || 'Unknown',
              originalTimestamp: msg.timestamp,
              originalChat: this.currentChat.name
            }
          };

          let targetPath;
          if (type === 'dm') {
            const dmId = [this.currentUser.uid, otherUid].sort().join('-');
            const dmRef = doc(db, 'dms', dmId);
            const dmSnap = await getDoc(dmRef);
            
            if (!dmSnap.exists()) {
              await setDoc(dmRef, {
                participants: [this.currentUser.uid, otherUid].sort(),
                createdAt: Timestamp.now(),
                typing: { [this.currentUser.uid]: false, [otherUid]: false }
              });
            }
            targetPath = `dms/${dmId}/messages`;
          } else {
            targetPath = `${path}/chat_groups/default/messages`;
          }

          await addDoc(collection(db, targetPath), forwardData);
        }
      }
      
      this.showToast(`Forwarded to ${selectedRecipients.size} chat(s)`);
      overlay.remove();
      this.exitSelectionMode();
    });

    // Load data and render
    loadData();
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  async markChatAsRead() {
    if (!this.currentChat || !this.currentUser) return;
    
    const now = Timestamp.now();
    const userRef = doc(db, 'users', this.currentUser.uid);
    
    if (this.currentChat.type === 'dm') {
      const lastSeenKey = `lastSeen${this.currentChat.id}`;
      await updateDoc(userRef, { [lastSeenKey]: now });
    } else {
      const sanitizedPath = this.currentChat.kennelPath.replace(/\//g, '_');
      await updateDoc(userRef, { [`lastSeenGroups.${sanitizedPath}`]: now });
    }
  },

  toggleAttachPanel() {
    const panel = document.getElementById('attach-panel');
    if (panel) panel.classList.toggle('show');
  },

  toggleEmoji() {
    const existing = document.querySelector('.emoji-picker');
    if (existing) {
      existing.remove();
      return;
    }

    // Complete emoji set organized by categories
    const emojiCategories = {
      'Smileys': ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
      'Gestures': ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','🫵','🫱','🫲','🫸','🫷','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁','👅','👄','🫦','💋','🩸'],
      'People': ['👶','👧','🧒','👦','👩','🧑','👨','👩‍🦱','🧑‍🦱','👨‍🦱','👩‍🦰','🧑‍🦰','👨‍🦰','👱‍♀️','👱','👱‍♂️','👩‍🦳','🧑‍🦳','👨‍🦳','👩‍🦲','🧑‍🦲','👨‍🦲','🧔‍♀️','🧔','🧔‍♂️','👵','🧓','👴','👲','👳‍♀️','👳','👳‍♂️','🧕','👮‍♀️','👮','👮‍♂️','👷‍♀️','👷','👷‍♂️','💂‍♀️','💂','💂‍♂️','🕵️‍♀️','🕵️','🕵️‍♂️','👩‍⚕️','🧑‍⚕️','👨‍⚕️','👩‍🌾','🧑‍🌾','👨‍🌾','👩‍🍳','🧑‍🍳','👨‍🍳','👩‍🎓','🧑‍🎓','👨‍🎓','👩‍🎤','🧑‍🎤','👨‍🎤','👩‍🏫','🧑‍🏫','👨‍🏫','👩‍🏭','🧑‍🏭','👨‍🏭','👩‍💻','🧑‍💻','👨‍💻','👩‍💼','🧑‍💼','👨‍💼','👩‍🔧','🧑‍🔧','👨‍🔧','👩‍🔬','🧑‍🔬','👨‍🔬','👩‍🎨','🧑‍🎨','👨‍🎨','👩‍🚒','🧑‍🚒','👨‍🚒','👩‍✈️','🧑‍✈️','👨‍✈️','👩‍🚀','🧑‍🚀','👨‍🚀','👩‍⚖️','🧑‍⚖️','👨‍⚖️','👰‍♀️','👰','👰‍♂️','🤵‍♀️','🤵','🤵‍♂️','👸','🫅','🤴','🦸‍♀️','🦸','🦸‍♂️','🦹‍♀️','🦹','🦹‍♂️'],
      'Animals': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🦟','🦗','🕷','🕸','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿','🦔','🐾','🐉','🐲','🌵','🎄','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀','🎍','🪴','🎋','🍃','🍂','🍁','🍄','🐚','🪨','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻'],
      'Food': ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🍍','🥝','🥥','🥑','🍆','🥔','🥕','🌽','🌶','🫑','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦀','🦞','🦐','🦑','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🥤','🧋','🧃','🧉','🧊','🥢','🍽','🍴','🥄','🔪','🏺'],
      'Activities': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸','🥌','🎿','⛷','🏂','🪂','🏋️‍♀️','🏋️','🏋️‍♂️','🤼‍♀️','🤼','🤼‍♂️','🤸‍♀️','🤸','🤸‍♂️','⛹️‍♀️','⛹️','⛹️‍♂️','🤺','🤾‍♀️','🤾','🤾‍♂️','🏌️‍♀️','🏌️','🏌️‍♂️','🏇','🧘‍♀️','🧘','🧘‍♂️','🏄‍♀️','🏄','🏄‍♂️','🏊‍♀️','🏊','🏊‍♂️','🤽‍♀️','🤽','🤽‍♂️','🚣‍♀️','🚣','🚣‍♂️','🧗‍♀️','🧗','🧗‍♂️','🚵‍♀️','🚵','🚵‍♂️','🚴‍♀️','🚴','🚴‍♂️','🏆','🥇','🥈','🥉','🏅','🎖','🏵','🎗','🎫','🎟','🎪','🤹‍♀️','🤹','🤹‍♂️','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟','🎯','🎳','🎮','🎰','🧩'],
      'Travel': ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩','💺','🛰','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','⛴','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺','🗿','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛱','🏖','🏝','🏜','🌋','⛰','🏔','🗻','🏕','⛺','🛖','🏠','🏡','🏘','🏚','🏗','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛','⛪','🕌','🕍','🛕','🕋','⛩','🛤','🛣','🗾','🎑','🏞','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙','🌃','🌌','🌉','🌁'],
      'Objects': ['⌚','📱','📲','💻','⌨️','🖥','🖨','🖱','🖲','🕹','🗜','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎️','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🪔','🧯','🛢','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒','🛠','⛏','🪚','🔩','⚙️','🪤','🧱','⛓','🧲','🔫','💣','🧨','🔪','🗡','⚔️','🛡','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','💎','🔔','🔕','📢','📣','📯','🎙','🎚','🎛','🎤','🎧','📻','🎷','🎸','🎹','🎺','🎻','🪕','🥁','🪘','📱','📲','☎️','📞','📟','📠','🔋','🔌','💻','🖥','🖨','⌨️','🖱','🖲','💽','💾','💿','📀','🧮','🎥','🎞','📽','🎬','📺','📷','📸','📹','📼','🔍','🔎','🕯','💡','🔦','🏮','🪔','📔','📕','📖','📗','📘','📙','📚','📓','📒','📃','📜','📄','📰','🗞','📑','🔖','🏷','💰','🪙','💴','💵','💶','💷','💸','💳','🧾','✉️','📧','📨','📩','📤','📥','📦','📫','📪','📬','📭','📮','🗳','✏️','✒️','🖋','🖊','🖌','🖍','📝','💼','📁','📂','🗂','📅','📆','🗒','🗓','📇','📈','📉','📊','📋','📌','📍','📎','🖇','📏','📐','✂️','🗃','🗄','🗑','🔒','🔓','🔏','🔐','🔑','🗝','🔨','🪓','⛏','⚒','🛠','🗡','⚔️','🔫','🪃','🏹','🛡','🪚','🔧','🪛','🔩','⚙️','🗜','⚖️','🦯','🔗','⛓','🪝','🧰','🧲','🪜','⚗️','🧪','🧫','🧬','🔬','🔭','📡','💉','🩸','💊','🩹','🩺','🌡','🚽','🚰','🚿','🛁','🛀','🧴','🧷','🧹','🧺','🧻','🧼','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️','🗿','🪧','🏧','🚮','🚰','♿','🚹','🚺','🚻','🚼','🚾','🛂','🛃','🛄','🛅','⚠️','🚸','⛔','🚫','🚳','🚭','🚯','🚱','🚷','📵','🔞','☢️','☣️','⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','↕️','↔️','↩️','↪️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐','⚛️','🕉️','✡️','☸️','☯️','✝️','☦️','☪️','☮️','🕎','🔯','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎','🔀','🔁','🔂','▶️','⏩','⏭️','⏯️','◀️','⏪','⏮️','🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️','⏏️','🎦','🔅','🔆','📶','📳','📴','♀️','♂️','⚧️','✖️','➕','➖','➗','♾️','‼️','⁉️','❓','❔','❕','❗','〰️','💱','💲','⚕️','♻️','⚜️','🔱','📛','🔰','⭕','✅','☑️','✔️','❌','❎','➰','➿','〽️','✳️','✴️','❇️','©️','®️','™️','#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔠','🔡','🔢','🔣','🔤','🅰️','🆎','🅱️','🆑','🆒','🆓','ℹ️','🆔','Ⓜ️','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚','🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑','🈸','🈴','🈳','㊗️','㊙️','🈺','🈵','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣','📢','💬','💭','🗯','♠️','♣️','♥️','♦️','🃏','🎴','🀄','🕐','🕑','🕒','🕓','🕔','🕕','🕖','🕗','🕘','🕙','🕚','🕛','🕜','🕝','🕞','🕟','🕠','🕡','🕢','🕣','🕤','🕥','🕦','🕧']
    };

    const picker = document.createElement('div');
    picker.className = 'emoji-picker';
    picker.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 1000;
      width: 90%;
      max-width: 400px;
      max-height: 400px;
      display: flex;
      flex-direction: column;
      font-family: sans-serif;
    `;

    // Create tabs and content
    let tabsHtml = '';
    let contentHtml = '';
    
    Object.keys(emojiCategories).forEach((category, index) => {
      const isActive = index === 0;
      tabsHtml += `<button class="emoji-tab ${isActive ? 'active' : ''}" data-category="${category}" style="
        flex: 1;
        padding: 12px;
        border: none;
        background: ${isActive ? '#FF6D00' : '#f5f5f5'};
        color: ${isActive ? 'white' : '#666'};
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s;
      ">${category}</button>`;
      
      contentHtml += `<div class="emoji-category ${isActive ? 'active' : ''}" data-category="${category}" style="
        display: ${isActive ? 'grid' : 'none'};
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
        padding: 12px;
        max-height: 300px;
        overflow-y: auto;
      ">
        ${emojiCategories[category].map(emoji => `
          <button class="emoji-btn" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 8px;
            border-radius: 8px;
            transition: background 0.2s;
          " onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background='transparent'">${emoji}</button>
        `).join('')}
      </div>`;
    });

    picker.innerHTML = `
      <div style="
        display: flex;
        border-bottom: 1px solid #e0e0e0;
        border-radius: 16px 16px 0 0;
        overflow: hidden;
      ">
        ${tabsHtml}
      </div>
      <div style="flex: 1; overflow: hidden;">
        ${contentHtml}
      </div>
      <div style="
        padding: 12px;
        border-top: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span style="font-size: 12px; color: #999;">Select an emoji</span>
        <button id="close-emoji" style="
          background: #f5f5f5;
          border: none;
          padding: 8px 16px;
          border-radius: 12px;
          cursor: pointer;
          font-size: 12px;
        ">Close</button>
      </div>
    `;

    document.body.appendChild(picker);

    // Tab switching
    picker.querySelectorAll('.emoji-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const category = tab.dataset.category;
        
        // Update tabs
        picker.querySelectorAll('.emoji-tab').forEach(t => {
          t.classList.remove('active');
          t.style.background = '#f5f5f5';
          t.style.color = '#666';
        });
        tab.classList.add('active');
        tab.style.background = '#FF6D00';
        tab.style.color = 'white';
        
        // Update content
        picker.querySelectorAll('.emoji-category').forEach(c => {
          c.style.display = c.dataset.category === category ? 'grid' : 'none';
        });
      });
    });

    // Emoji selection
    picker.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('message-input');
        if (input) {
          input.value += btn.textContent;
          input.dispatchEvent(new Event('input')); // Trigger input event for send button
          input.focus();
        }
      });
    });

    // Close button
    document.getElementById('close-emoji').addEventListener('click', () => {
      picker.remove();
    });

    // Close on click outside
    setTimeout(() => {
      const closeOnClickOutside = (e) => {
        if (!picker.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', closeOnClickOutside);
        }
      };
      document.addEventListener('click', closeOnClickOutside);
    }, 100);
  },

  attachPhoto() { this.showFilePicker('image/*', 'image'); },
  attachAudio() { this.showFilePicker('audio/*', 'audio'); },
  attachFile() { this.showFilePicker('*/*', 'file'); },
  attachSticker() {
    const existing = document.querySelector('.sticker-picker');
    if (existing) {
      existing.remove();
      return;
    }

    // Sample sticker set - replace with your actual sticker URLs
    const stickers = [
      { name: 'Happy', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.webp' },
      { name: 'Love', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f496/512.webp' },
      { name: 'Laugh', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f602/512.webp' },
      { name: 'Cool', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f60e/512.webp' },
      { name: 'Think', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f914/512.webp' },
      { name: 'Party', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f389/512.webp' },
      { name: 'Fire', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f525/512.webp' },
      { name: 'Rocket', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f680/512.webp' },
      { name: 'Star', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2b50/512.webp' },
      { name: 'Heart', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/2764_fe0f/512.webp' },
      { name: 'Clap', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44f/512.webp' },
      { name: 'Ok', url: 'https://fonts.gstatic.com/s/e/notoemoji/latest/1f44c/512.webp' }
    ];

    const picker = document.createElement('div');
    picker.className = 'sticker-picker';
    picker.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      z-index: 1000;
      width: 90%;
      max-width: 400px;
      max-height: 350px;
      display: flex;
      flex-direction: column;
      font-family: sans-serif;
    `;

    picker.innerHTML = `
      <div style="
        padding: 16px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span style="font-weight: 600; color: #333;">Stickers</span>
        <button id="close-sticker" style="
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #999;
        ">×</button>
      </div>
      <div style="
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        padding: 16px;
        max-height: 280px;
        overflow-y: auto;
      ">
        ${stickers.map(sticker => `
          <button class="sticker-btn" data-url="${sticker.url}" style="
            background: #f5f5f5;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            padding: 8px;
            transition: transform 0.2s;
          " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
            <img src="${sticker.url}" style="width: 100%; height: auto; border-radius: 8px;" loading="lazy">
          </button>
        `).join('')}
      </div>
    `;

    document.body.appendChild(picker);

    // Sticker selection - send as image message
    picker.querySelectorAll('.sticker-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const stickerUrl = btn.dataset.url;
        
        // Send sticker as image message
        if (window.messages?.sendMedia) {
          // Create a fake file object from URL
          fetch(stickerUrl)
            .then(res => res.blob())
            .then(blob => {
              const file = new File([blob], 'sticker.webp', { type: 'image/webp' });
              window.messages.sendMedia('sticker', file);
              picker.remove();
            })
            .catch(err => {
              console.error('Failed to load sticker:', err);
              this.showToast('Failed to send sticker', 'error');
            });
        } else {
          // Fallback: send as text message with URL
          const input = document.getElementById('message-input');
          if (input) {
            input.value += `[sticker:${stickerUrl}]`;
            input.dispatchEvent(new Event('input'));
            picker.remove();
          }
        }
      });
    });

    // Close button
    document.getElementById('close-sticker').addEventListener('click', () => {
      picker.remove();
    });

    // Close on click outside
    setTimeout(() => {
      const closeOnClickOutside = (e) => {
        if (!picker.contains(e.target)) {
          picker.remove();
          document.removeEventListener('click', closeOnClickOutside);
        }
      };
      document.addEventListener('click', closeOnClickOutside);
    }, 100);
  },

  showFilePicker(accept, type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) messages.sendMedia(type, file);
    };
    input.click();
    this.toggleAttachPanel();
  },

  createPlaceholder(text, color = '#FF6D00') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="65" text-anchor="middle" font-size="45" fill="white" font-family="Arial">${text.charAt(0).toUpperCase()}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  },

  viewMedia(url, type) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:10000;';
    
    if (type === 'image') {
      overlay.innerHTML = `<img src="${url}" style="max-width:90%;max-height:90%;" onclick="this.parentElement.remove()">`;
    } else if (type === 'video') {
      overlay.innerHTML = `<video src="${url}" controls autoplay style="max-width:90%;max-height:90%;"></video>`;
    }
    
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
  },

  playAudio(url) {
    const audio = new Audio(url);
    audio.play().catch(e => console.log('Audio play failed:', e));
  },

  navigate(screen) {
    const urls = { home: 'home.html', runs: 'runs.html', trails: 'trails.html', chat: 'chat.html' };
    if (urls[screen]) window.location.href = urls[screen];
  },

  // ============================================
  // UPDATED: More Menu - EXACTLY LIKE OTHER PAGES
  // ============================================
  showMoreMenu() {
    console.log('Opening more options...');
    const options = [
      'Logout',
      'Business Hub',
      'Personal',
      'Songs',
      'App Tour ON/OFF',
      'Toggle Day/Night',
      'About Hash'
    ];
    
    const dialog = document.createElement('div');
    dialog.className = 'more-dialog';
    dialog.innerHTML = `
      <div class="more-dialog-content">
        <h3>More</h3>
        ${options.map((opt, i) => `<button class="more-option" data-index="${i}">${opt}</button>`).join('')}
        <button class="more-cancel">Cancel</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    dialog.querySelectorAll('.more-option').forEach(btn => {
      btn.onclick = () => {
        const index = parseInt(btn.dataset.index);
        dialog.remove();
        this.handleMoreOption(index);
      };
    });
    
    dialog.querySelector('.more-cancel').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
      if (e.target === dialog) dialog.remove();
    };
  },

  handleMoreOption(index) {
    switch(index) {
      case 0:
        this.logout();
        break;
      case 1:
        window.location.href = 'business-hub.html';
        break;
      case 2:
        window.location.href = 'personal.html';
        break;
      case 3:
        window.location.href = 'songs.html';
        break;
      case 4:
        const wasDisabled = localStorage.getItem('tour_disabled') === 'true';
        localStorage.setItem('tour_disabled', !wasDisabled);
        alert(`Tour ${wasDisabled ? 'enabled' : 'disabled'}`);
        break;
      case 5:
        this.toggleDayNight();
        break;
      case 6:
        this.showAboutHashDialog();
        break;
    }
  },

  toggleDayNight() {
    const isNight = localStorage.getItem('night_mode') === 'true';
    localStorage.setItem('night_mode', !isNight);
    document.body.classList.toggle('night-mode', !isNight);
  },

  async logout() {
    try {
      await signOut(auth);
      window.location.href = 'login.html';
    } catch (error) {
      console.error('Logout error:', error);
    }
  },

  showAboutHashDialog() {
    const modal = document.createElement('div');
    modal.className = 'more-dialog';
    modal.innerHTML = `
      <div class="more-dialog-content" style="max-width: 90%; border-radius: 16px; margin: auto; max-height: 80vh; overflow-y: auto;">
        <div style="padding: 16px;">
          <h2 style="color: var(--clr-primary); margin-bottom: 16px;">About Hash House Harriers</h2>
          <p style="line-height: 1.6; margin-bottom: 12px;">
            <b>HISTORY</b><br>
            The Hash began in December 1938 in Kuala Lumpur, Malaysia. A group of British expats started a Monday-evening run modeled after the old English "paper chase" or "hare & hounds" game. They met at the Selangor Club Chambers—nicknamed the "Hash House" because of its monotonous food—so the club became the "Hash House Harriers." Running, drinking, and singing quickly became the holy trinity. After World War II the idea spread through Commonwealth military bases and eventually exploded worldwide; today there are ~ 2,000 kennels on every continent (yes, including Antarctica).<br><br>

            <b>TRADITIONS & RULES (the short version)</b><br>
            1. There are no rules.<br>
            2. Actually there are—just not many:<br>
            • The hare sets the trail in flour, chalk, paper or eco-markings.<br>
            • Check marks ("checks") send the pack searching for true trail; find it and call "ON-ON!"<br>
            • If you're on a false trail you'll see an "F" or three lines—go back to the check and try again.<br>
            • Never leave a mark that can mislead tomorrow's public.<br>
            • The trail is not a race; the goal is for everyone to finish together.<br>
            • Down-Downs (chugging a beverage) are awarded for sins real, imagined or hilarious.<br>
            • No poofing (skipping the Down-Down) unless pregnancy, allergy or doctor's orders.<br>
            • Respect the land, the authorities, and each other—we are guests everywhere we run.<br><br>

            <b>GOALS OF THE HASH</b><br>
            • Promote physical fitness among our members.<br>
            • Get rid of weekend hangovers.<br>
            • Acquire a good thirst and satisfy it with beer.<br>
            • Persuade the older members that they are not as old as they feel.<br>
            • And above all: have fun, keep it informal, and don't take yourself too seriously.<br><br>

            <b>POSITIONS & RESPONSIBILITIES</b><br>
            <b>Grand Master (GM)</b><br>figurehead, ceremonial leader, keeper of traditions, chief mischief maker.<br><br>
            <b>Religious Adviser (RA)</b><br>runs circle, doles out Down-Downs, maintains song book, keeps order with humor.<br><br>
            <b>Hash Master (HM)</b><br>manages trail schedule, appoints hares, ensures trails happen.<br><br>
            <b>On-Sec (Secretary)</b><br>keeps membership list, handles communications, records minutes if any.<br><br>
            <b>Hare(s)</b><br>sets the week's trail, provides beer stop, sweeps back-markers, marks trail responsibly.<br><br>
            <b>Beer Meister / Hash Cash</b><br>collects fees, buys beer & snacks, balances the books, keeps the fridge stocked.<br><br>
            <b>Hash Horn</b><br>brings music to circle, leads songs, blows horn or whistle when needed.<br><br>
            <b>Hash Flash</b><br>official photographer, uploads photos, preserves blackmail material.
          </p>
        </div>
        <button class="more-cancel" style="margin-top: 16px;">ON-ON</button>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    modal.querySelector('.more-cancel').onclick = () => modal.remove();
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
  },
  
  searchInChat() {
    // Create a custom search dialog instead of using prompt()
    const existing = document.getElementById('search-chat-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'search-chat-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      z-index: 10000;
      padding-top: 100px;
    `;

    dialog.innerHTML = `
      <div style="
        background: white;
        width: 90%;
        max-width: 400px;
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      ">
        <div style="
          display: flex;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #e0e0e0;
          gap: 12px;
        ">
          <span style="font-size: 20px;">🔍</span>
          <input type="text" id="chat-search-input" placeholder="Search in chat..." style="
            flex: 1;
            border: none;
            outline: none;
            font-size: 16px;
          " autofocus>
          <button id="close-search" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #999;
          ">×</button>
        </div>
        <div id="search-results" style="
          max-height: 300px;
          overflow-y: auto;
          padding: 8px;
        "></div>
      </div>
    `;

    document.body.appendChild(dialog);

    const input = document.getElementById('chat-search-input');
    const results = document.getElementById('search-results');
    
    // Focus input
    setTimeout(() => input?.focus(), 100);

    // Close handlers
    document.getElementById('close-search').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    // Search as user types
    input.addEventListener('input', (e) => {
      const term = e.target.value.trim().toLowerCase();
      if (!term) {
        results.innerHTML = '';
        return;
      }

      // Search in current messages
      const messages = document.querySelectorAll('.message');
      let foundCount = 0;
      
      messages.forEach(msg => {
        const content = msg.querySelector('.message-content')?.textContent?.toLowerCase() || '';
        if (content.includes(term)) {
          msg.style.backgroundColor = '#FFF3E0';
          foundCount++;
          
          // Scroll to first match
          if (foundCount === 1) {
            msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          msg.style.backgroundColor = '';
        }
      });

      results.innerHTML = foundCount > 0 ? 
        `<div style="padding: 12px; color: #4CAF50; text-align: center;">${foundCount} message${foundCount !== 1 ? 's' : ''} found</div>` :
        `<div style="padding: 12px; color: #999; text-align: center;">No messages found</div>`;
    });

    // Clear highlights when dialog closes
    dialog.addEventListener('remove', () => {
      document.querySelectorAll('.message').forEach(msg => {
        msg.style.backgroundColor = '';
      });
    });
  },

  muteChat() { alert('Mute notifications for this chat'); },
  
  clearChat() {
    if (!this.currentChat) return;
    
    if (confirm('Clear all messages in this chat? This cannot be undone.')) {
      // Clear from Firestore
      const collectionPath = this.currentChat.type === 'dm' ? 
        `dms/${this.currentChat.id}/messages` : 
        `${this.currentChat.kennelPath}/chat_groups/default/messages`;
      
      // Get all messages and delete them
      getDocs(collection(db, collectionPath))
        .then(snapshot => {
          const deletePromises = snapshot.docs.map(doc => 
            deleteDoc(doc.ref)
          );
          return Promise.all(deletePromises);
        })
        .then(() => {
          // Clear local messages array
          this.currentMessages = [];
          
          // Clear UI
          const container = document.getElementById('messages-container');
          if (container) container.innerHTML = '';
          
          this.showToast('Chat cleared');
        })
        .catch(error => {
          console.error('Error clearing chat:', error);
          this.showToast('Failed to clear chat', 'error');
        });
    }
  },
  
  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#d32f2f' : '#4CAF50'};
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-family: sans-serif;
      font-size: 14px;
      z-index: 10003;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    // Add animation keyframes if not present
    if (!document.getElementById('toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes slideUp {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  },

  playPopSound() {
    this.notificationSound.currentTime = 0;
    this.notificationSound.play().catch(e => console.log('Audio play failed:', e));
  }
};

// Initialize when auth is ready
onAuthStateChanged(auth, (user) => {
  if (user) {
    chatApp.init(user);
  } else {
    window.location.href = 'login.html';
  }
});

window.chatApp = chatApp;
window.app = chatApp;