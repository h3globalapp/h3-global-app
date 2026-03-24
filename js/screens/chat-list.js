import { 
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { initWebPushNotifications, initCapacitorPushNotifications } from '../firebase-config.js';

const chatList = {
  db: null,
  user: null,
  conversations: [],
  kennelListeners: [],
  dmListeners: [],
  unsubscribe: null,
  userData: null,
  allUsers: [],
  allKennels: [],
  
   // Cache control
  _loadingConversations: false,
  _renderTimeout: null,

init(user, db) {
  console.log('=== chatList.init() called ===');
  this.user = user;
  this.db = db;
  
  // UNLOCK AUDIO IMMEDIATELY - this was in your original code
  this.unlockAudioForChat();
  
  // Check if we have cached conversations for instant render
  const cached = sessionStorage.getItem('chat_conversations');
  if (cached) {
    try {
      this.conversations = JSON.parse(cached);
      this.render();
      console.log('Rendered', this.conversations.length, 'cached conversations');
    } catch (e) {
      console.error('Failed to parse cached conversations');
    }
  }
  
  this.loadUserData();
  this.setupSearchListeners();
  this.setupNewChatButton();
},

unlockAudioForChat() {
  // Mark that we're in chat context - allows sounds to play
  sessionStorage.setItem('chat_active', 'true');
  
  // Try immediate unlock
  const unlock = () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    const silent = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAA==');
    silent.play().then(() => {
      console.log('🔊 Chat audio unlocked');
      if (window.chatApp) window.chatApp._audioUnlocked = true;
      
      // Play sound for existing unreads after short delay
      setTimeout(() => this.playSoundsForUnread(), 500);
    }).catch(() => {
      // If blocked, unlock will happen on first click anywhere
    });
  };
  
  // Try now
  unlock();
  
  // Also try on any interaction (backup)
  const onFirstInteraction = () => {
    if (!window.chatApp?._audioUnlocked) {
      unlock();
    }
    document.removeEventListener('click', onFirstInteraction);
    document.removeEventListener('touchstart', onFirstInteraction);
  };
  
  document.addEventListener('click', onFirstInteraction, { once: true });
  document.addEventListener('touchstart', onFirstInteraction, { once: true });
},

  playSoundsForUnread() {
    // Play sound for all conversations with unread messages
    let totalUnread = 0;
    this.conversations.forEach(conv => {
      if (conv.unread > 0) {
        totalUnread += conv.unread;
      }
    });
    
    if (totalUnread > 0 && window.chatApp?._audioUnlocked) {
      console.log('🔔 Playing catch-up sound for', totalUnread, 'unread messages');
      // Play sound once for all accumulated messages
      window.chatApp.playNotificationSound();
    }
  },

  // Legacy search function for HTML onclick compatibility
  search(query) {
    this.filterConversations(query);
  },

  // Legacy showNewChat function for HTML onclick compatibility  
  showNewChat() {
    this.showNewChatDialog();
  },

  // Setup search bar to filter existing conversations
  setupSearchListeners() {
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', this.debounce((e) => {
      const query = e.target.value.trim().toLowerCase();
      this.filterConversations(query);
    }, 300));

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        this.render();
      }
    });
  },

  // Filter existing conversations by name
  filterConversations(query) {
    if (!query) {
      this.render();
      return;
    }

    const filtered = this.conversations.filter(conv => 
      conv.name.toLowerCase().includes(query)
    );

    const container = document.getElementById('conversations-list');
    if (!container) return;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔍</div>
          <p>No conversations found</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(conv => {
      if (conv.type === 'dm') {
        return this.renderDmItem(conv);
      } else {
        return this.renderGroupItem(conv);
      }
    }).join('');
  },

  // Setup the plus/new chat button
  setupNewChatButton() {
    const newChatBtn = document.querySelector('.new-chat-btn') || document.getElementById('new-chat-btn');
    if (!newChatBtn) return;

    newChatBtn.addEventListener('click', () => {
      this.showNewChatDialog();
    });
  },

  // Show dialog with tabs for Users and Kennels
  showNewChatDialog() {
    const existing = document.getElementById('new-chat-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'new-chat-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: sans-serif;
    `;

    dialog.innerHTML = `
      <div style="
        background: white;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        border-radius: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e0e0e0;
        ">
          <h2 style="margin: 0; font-size: 20px;">New Chat</h2>
          <button id="close-dialog" style="
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
          ">×</button>
        </div>
        
        <div style="
          display: flex;
          border-bottom: 1px solid #e0e0e0;
        ">
          <button id="tab-users" class="dialog-tab active" style="
            flex: 1;
            padding: 12px;
            border: none;
            background: #f5f5f5;
            cursor: pointer;
            font-weight: bold;
          ">Users</button>
          <button id="tab-kennels" class="dialog-tab" style="
            flex: 1;
            padding: 12px;
            border: none;
            background: white;
            cursor: pointer;
          ">Kennels</button>
        </div>
        
        <div style="padding: 16px; border-bottom: 1px solid #e0e0e0;">
          <input type="text" id="dialog-search" placeholder="Search..." style="
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 24px;
            font-size: 16px;
            box-sizing: border-box;
          ">
        </div>
        
        <div id="dialog-content" style="
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        ">
          <!-- Content loaded here -->
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('close-dialog').addEventListener('click', () => dialog.remove());
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });

    const usersTab = document.getElementById('tab-users');
    const kennelsTab = document.getElementById('tab-kennels');
    
    usersTab.addEventListener('click', () => {
      usersTab.style.background = '#f5f5f5';
      usersTab.style.fontWeight = 'bold';
      kennelsTab.style.background = 'white';
      kennelsTab.style.fontWeight = 'normal';
      this.loadUsersList();
    });

    kennelsTab.addEventListener('click', () => {
      kennelsTab.style.background = '#f5f5f5';
      kennelsTab.style.fontWeight = 'bold';
      usersTab.style.background = 'white';
      usersTab.style.fontWeight = 'normal';
      this.loadKennelsList();
    });

    const searchInput = document.getElementById('dialog-search');
    searchInput.addEventListener('input', this.debounce((e) => {
      const query = e.target.value.trim().toLowerCase();
      const activeTab = usersTab.style.fontWeight === 'bold' ? 'users' : 'kennels';
      if (activeTab === 'users') {
        this.filterUsersList(query);
      } else {
        this.filterKennelsList(query);
      }
    }, 300));

    this.loadUsersList();
  },

  // Load all users for the dialog
  async loadUsersList() {
    const content = document.getElementById('dialog-content');
    if (!content) return;

    content.innerHTML = '<div style="text-align: center; padding: 20px;">Loading users...</div>';

    try {
      const usersSnap = await getDocs(query(
        collection(this.db, 'users'),
        orderBy('hashHandleLower'),
        limit(50)
      ));

      this.allUsers = usersSnap.docs
        .filter(doc => doc.id !== this.user.uid)
        .map(doc => ({
          id: doc.id,
          handle: doc.data().hashHandle || 'Unknown',
          picUrl: doc.data().profilePicUrl || '',
          hashHandleLower: doc.data().hashHandleLower || ''
        }));

      this.renderUsersList(this.allUsers);
    } catch (error) {
      console.error('Error loading users:', error);
      content.innerHTML = '<div style="text-align: center; padding: 20px; color: red;">Error loading users</div>';
    }
  },

 // In renderUsersList - change class to 'user-search-item'
renderUsersList(users) {
  const content = document.getElementById('dialog-content');
  if (!content) return;

  if (users.length === 0) {
    content.innerHTML = '<div style="text-align: center; padding: 20px;">No users found</div>';
    return;
  }

  content.innerHTML = users.map(user => `
    <div class="user-search-item" data-user-id="${user.id}" data-user-handle="${this.escapeJs(user.handle)}" style="
      display: flex;
      align-items: center;
      padding: 12px;
      cursor: pointer;
      border-radius: 8px;
    " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='white'">
      <img src="${user.picUrl || this.createPlaceholder(user.handle)}" 
           style="width: 48px; height: 48px; border-radius: 50%; margin-right: 12px; object-fit: cover;">
      <div>
        <div style="font-weight: bold; font-size: 16px;">${this.escapeHtml(user.handle)}</div>
        <div style="font-size: 14px; color: #666;">Tap to start conversation</div>
      </div>
    </div>
  `).join('');

  // Use specific class selector to avoid conflicts
  content.querySelectorAll('.user-search-item').forEach(item => {
    item.addEventListener('click', () => {
      const userId = item.dataset.userId;
      const userHandle = item.dataset.userHandle;
      // Don't rely on lookup, use data directly from element
      this.startDm(userId, userHandle);
      document.getElementById('new-chat-dialog')?.remove();
    });
  });
},

// In renderKennelsInContainer - change class to 'kennel-search-item'
renderKennelsInContainer(kennels, container) {
  if (kennels.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px;">No kennels found</div>';
    return;
  }

  container.innerHTML = kennels.map(kennel => {
    const isJoined = kennel.joined;
    const avatarSrc = kennel.logoUrl 
      ? kennel.logoUrl 
      : this.createPlaceholder(kennel.name.charAt(0), '#4CAF50');
    
    return `
      <div class="kennel-search-item" 
           data-kennel-path="${this.escapeJs(kennel.path)}" 
           data-kennel-name="${this.escapeJs(kennel.name)}"
           data-kennel-joined="${isJoined}"
           data-kennel-logo="${this.escapeJs(kennel.logoUrl || '')}"
           style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        cursor: pointer;
        border-radius: 8px;
        border-bottom: 1px solid #eee;
      " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='white'">
        <div style="display: flex; align-items: center;">
          <img src="${avatarSrc}" 
               style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-right: 12px; border: 2px solid #4CAF50;"
               onerror="this.src='${this.createPlaceholder(kennel.name.charAt(0), '#4CAF50')}'">
          <div>
            <div style="font-weight: bold; font-size: 16px;">${this.escapeHtml(kennel.name)}</div>
            <div style="font-size: 14px; color: #666;">${this.escapeHtml(kennel.state)}, ${this.escapeHtml(kennel.country)}</div>
          </div>
        </div>
        ${isJoined ? 
          '<span class="joined-badge" style="color: #4CAF50; font-size: 14px;">✓ Joined</span>' : 
          '<button class="join-btn" style="padding: 8px 16px; background: #FF6D00; color: white; border: none; border-radius: 16px; cursor: pointer;">Join</button>'
        }
      </div>
    `;
  }).join('');

  // Use specific class selector
  container.querySelectorAll('.kennel-search-item').forEach(item => {
    const joinBtn = item.querySelector('.join-btn');
    const kennelPath = item.dataset.kennelPath;
    const kennelName = item.dataset.kennelName;
    const isJoined = item.dataset.kennelJoined === 'true';
    const logoUrl = item.dataset.kennelLogo || '';
    
    if (joinBtn) {
      // Not joined - join button click
      joinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const kennel = this.allKennels.find(k => k.path === kennelPath);
        if (kennel) {
          this.showJoinKennelDialog(kennel);
        }
      });
    }
    
    // Row click - different behavior based on joined status
    item.addEventListener('click', (e) => {
      if (e.target === joinBtn || joinBtn?.contains(e.target)) return;
      
      if (isJoined) {
        // Open group chat
        const kennelId = kennelPath.replace(/\//g, '_');
        if (window.chatApp) {
          window.chatApp.openGroupChat(kennelId, kennelName, kennelPath, logoUrl, 0);
          document.getElementById('new-chat-dialog')?.remove();
        }
      } else {
        // Show join dialog
        const kennel = this.allKennels.find(k => k.path === kennelPath);
        if (kennel) {
          this.showJoinKennelDialog(kennel);
        }
      }
    });
  });
},

  filterUsersList(query) {
    if (!query) {
      this.renderUsersList(this.allUsers);
      return;
    }

    const filtered = this.allUsers.filter(user => 
      user.hashHandleLower?.includes(query) || 
      user.handle.toLowerCase().includes(query)
    );

    this.renderUsersList(filtered);
  },

  // FIXED: Load kennels with correct path format
// In showNewChatDialog, change the kennels tab content to show selectors first
async loadKennelsList() {
  const content = document.getElementById('dialog-content');
  if (!content) return;

  // Show country/state selectors first
  content.innerHTML = `
    <div style="padding: 16px;">
      <select id="country-select" style="width: 100%; padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #ddd;">
        <option value="">Select Country...</option>
      </select>
      <select id="state-select" style="width: 100%; padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #ddd; display: none;">
        <option value="">Select State...</option>
      </select>
      <div id="kennels-list" style="margin-top: 16px;"></div>
    </div>
  `;

  // Load only countries first
  const countriesSnap = await getDocs(collection(this.db, 'locations'));
  const countrySelect = document.getElementById('country-select');
  
  countriesSnap.docs.forEach(doc => {
    const option = document.createElement('option');
    option.value = doc.id;
    option.textContent = doc.id;
    countrySelect.appendChild(option);
  });

  // Handle country selection
  countrySelect.addEventListener('change', async (e) => {
    const country = e.target.value;
    if (!country) return;

    const stateSelect = document.getElementById('state-select');
    stateSelect.style.display = 'block';
    stateSelect.innerHTML = '<option value="">Select State...</option>';

    const statesSnap = await getDocs(collection(this.db, 'locations', country, 'states'));
    statesSnap.docs.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.id;
      stateSelect.appendChild(option);
    });
  });

  // Handle state selection
  document.getElementById('state-select').addEventListener('change', async (e) => {
    const country = document.getElementById('country-select').value;
    const state = e.target.value;
    if (!country || !state) return;

    const kennelsList = document.getElementById('kennels-list');
    kennelsList.innerHTML = '<div style="text-align: center; padding: 20px;">Loading kennels...</div>';

    const kennelsSnap = await getDocs(collection(this.db, 'locations', country, 'states', state, 'kennels'));
    
    if (kennelsSnap.empty) {
      kennelsList.innerHTML = '<div style="text-align: center; padding: 20px;">No kennels found in this state</div>';
      return;
    }

    // FIX: Fetch full kennel data including logoUrl
    const kennels = [];
    for (const docSnap of kennelsSnap.docs) {
      const kennelData = docSnap.data();
      kennels.push({
        id: docSnap.id,
        name: docSnap.id,
        path: `locations/${country}/states/${state}/kennels/${docSnap.id}`,
        country: country,
        state: state,
        logoUrl: kennelData.logoUrl || null, // <-- ADD THIS LINE
        joined: this.userData?.joinedKennels?.includes(`locations/${country}/states/${state}/kennels/${docSnap.id}`) || false
      });
    }

    this.allKennels = kennels;
    this.renderKennelsInContainer(kennels, kennelsList);
  });
},

// New method to render kennels in a specific container
renderKennelsInContainer(kennels, container) {
  if (kennels.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 20px;">No kennels found</div>';
    return;
  }

  container.innerHTML = kennels.map(kennel => {
    const isJoined = kennel.joined;
    // Use logo if available, otherwise use letter placeholder
    const avatarSrc = kennel.logoUrl 
      ? kennel.logoUrl 
      : this.createPlaceholder(kennel.name.charAt(0), '#4CAF50');
    
    return `
      <div class="dialog-item" 
           data-kennel-path="${this.escapeJs(kennel.path)}" 
           data-kennel-name="${this.escapeJs(kennel.name)}"
           data-kennel-joined="${isJoined}"
		        data-kennel-logo="${this.escapeJs(kennel.logoUrl || '')}"

           style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        cursor: pointer;
        border-radius: 8px;
        border-bottom: 1px solid #eee;
      " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='white'">
        <div style="display: flex; align-items: center;">
          <img src="${avatarSrc}" 
               style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; margin-right: 12px; border: 2px solid #4CAF50;"
               onerror="this.src='${this.createPlaceholder(kennel.name.charAt(0), '#4CAF50')}'">
          <div>
            <div style="font-weight: bold; font-size: 16px;">${this.escapeHtml(kennel.name)}</div>
            <div style="font-size: 14px; color: #666;">${this.escapeHtml(kennel.state)}, ${this.escapeHtml(kennel.country)}</div>
          </div>
        </div>
        ${isJoined ? 
          '<span class="joined-badge" style="color: #4CAF50; font-size: 14px;">✓ Joined</span>' : 
          '<button class="join-btn" style="padding: 8px 16px; background: #FF6D00; color: white; border: none; border-radius: 16px; cursor: pointer;">Join</button>'
        }
      </div>
    `;
  }).join('');

  // Add click handlers - FIXED VERSION
  container.querySelectorAll('.dialog-item').forEach(item => {
    const joinBtn = item.querySelector('.join-btn');
    const kennelPath = item.dataset.kennelPath;
    const kennelName = item.dataset.kennelName;
    const isJoined = item.dataset.kennelJoined === 'true';
    
    if (joinBtn) {
      // Not joined - show join dialog
      joinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const kennel = this.allKennels.find(k => k.path === kennelPath);
        if (kennel) {
          this.showJoinKennelDialog(kennel);
        }
      });
      
      // Also make the whole row clickable for non-joined kennels
      item.addEventListener('click', (e) => {
        if (e.target === joinBtn || joinBtn.contains(e.target)) return;
        const kennel = this.allKennels.find(k => k.path === kennelPath);
        if (kennel) {
          this.showJoinKennelDialog(kennel);
        }
      });
    } else {
      // Already joined - open chat
    item.addEventListener('click', () => {
  if (isJoined) {
    const kennelId = kennelPath.replace(/\//g, '_');
    const logoUrl = item.dataset.kennelLogo || '';
    if (window.chatApp) {
      window.chatApp.openGroupChat(kennelId, kennelName, kennelPath, logoUrl, 0);
      document.getElementById('new-chat-dialog')?.remove();
    }
  }
});
    }
  });
},

  renderKennelsList(kennels) {
    const content = document.getElementById('dialog-content');
    if (!content) return;

    if (kennels.length === 0) {
      content.innerHTML = '<div style="text-align: center; padding: 20px;">No kennels found</div>';
      return;
    }

    content.innerHTML = kennels.map(kennel => {
      const isJoined = kennel.joined;
      return `
        <div class="dialog-item" data-kennel-path="${this.escapeJs(kennel.path)}" style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px;
          cursor: pointer;
          border-radius: 8px;
        " onmouseover="this.style.backgroundColor='#f5f5f5'" onmouseout="this.style.backgroundColor='white'">
          <div style="display: flex; align-items: center;">
            <div style="
              width: 48px;
              height: 48px;
              border-radius: 50%;
              background: #4CAF50;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 20px;
              font-weight: bold;
              margin-right: 12px;
            ">${kennel.name.charAt(0).toUpperCase()}</div>
            <div>
              <div style="font-weight: bold; font-size: 16px;">${this.escapeHtml(kennel.name)}</div>
              <div style="font-size: 14px; color: #666;">${this.escapeHtml(kennel.state)}, ${this.escapeHtml(kennel.country)}</div>
            </div>
          </div>
          ${isJoined ? 
            '<span style="color: #4CAF50; font-size: 14px;">✓ Joined</span>' : 
            '<button class="join-btn" style="padding: 8px 16px; background: #FF6D00; color: white; border: none; border-radius: 16px; cursor: pointer;">Join</button>'
          }
        </div>
      `;
    }).join('');

    content.querySelectorAll('.dialog-item').forEach(item => {
      const joinBtn = item.querySelector('.join-btn');
      if (joinBtn) {
        joinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const kennelPath = item.dataset.kennelPath;
          const kennel = this.allKennels.find(k => k.path === kennelPath);
          if (kennel) {
            this.showJoinKennelDialog(kennel);
          }
        });
      } else {
        item.addEventListener('click', () => {
          const kennelPath = item.dataset.kennelPath;
          const kennel = this.allKennels.find(k => k.path === kennelPath);
          if (kennel && kennel.joined) {
            const kennelId = kennel.path.replace(/\//g, '_');
            if (window.chatApp) {
              window.chatApp.openGroupChat(kennelId, kennel.name, kennel.path, null, 0);
              document.getElementById('new-chat-dialog')?.remove();
            }
          }
        });
      }
    });
  },

filterKennelsList(query) {
  const container = document.getElementById('kennels-list');
  if (!container) return;
  
  if (!query) {
    this.renderKennelsInContainer(this.allKennels, container);
    return;
  }

  const filtered = this.allKennels.filter(kennel => 
    kennel.name.toLowerCase().includes(query) ||
    kennel.state.toLowerCase().includes(query) ||
    kennel.country.toLowerCase().includes(query)
  );

  this.renderKennelsInContainer(filtered, container);
},

  showJoinKennelDialog(kennel) {
    const existing = document.getElementById('join-kennel-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'join-kennel-dialog';
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
      font-family: sans-serif;
    `;

    dialog.innerHTML = `
      <div style="
        background: white;
        width: 90%;
        max-width: 400px;
        border-radius: 16px;
        padding: 24px;
        text-align: center;
      ">
        <h3 style="margin: 0 0 8px 0; font-size: 20px;">Join ${this.escapeHtml(kennel.name)}?</h3>
        <p style="color: #666; margin: 0 0 20px 0;">A request will be sent to the kennel admin for approval.</p>
        
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="cancel-join" style="
            padding: 12px 24px;
            border: 1px solid #ddd;
            background: white;
            border-radius: 24px;
            cursor: pointer;
            font-size: 16px;
          ">Cancel</button>
          
          <button id="confirm-join" style="
            padding: 12px 24px;
            border: none;
            background: #FF6D00;
            color: white;
            border-radius: 24px;
            cursor: pointer;
            font-size: 16px;
          ">Send Request</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('cancel-join').addEventListener('click', () => {
      dialog.remove();
    });

    document.getElementById('confirm-join').addEventListener('click', async () => {
      await this.sendJoinRequest(kennel);
      dialog.remove();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.remove();
    });
  },

  async sendJoinRequest(kennel) {
    try {
      const uid = this.user.uid;
      
      // Create join request in the kennel's joinRequests collection
const requestRef = doc(this.db, kennel.path, 'ChatGroups', 'main', 'joinRequests', uid);
      await setDoc(requestRef, {
        uid: uid,
        status: 'pending',
        timestamp: Timestamp.now(),
        userName: this.userData?.hashHandle || 'Unknown',
        userPic: this.userData?.profilePicUrl || ''
      });

      // Get kennel admin and send notification
      const kennelSnap = await getDoc(doc(this.db, kennel.path));
      const kennelData = kennelSnap.data() || {};
      const adminId = kennelData.adminId || kennelData.createdBy;

      if (adminId) {
        const notificationRef = doc(this.db, 'users', adminId, 'notifications', `join_${uid}_${kennel.id}`);
        await setDoc(notificationRef, {
          type: 'join_request',
          title: 'New Join Request',
          body: `${this.userData?.hashHandle || 'Someone'} wants to join ${kennel.name}`,
          kennelPath: kennel.path,
          kennelName: kennel.name,
          requesterId: uid,
          requesterName: this.userData?.hashHandle || 'Unknown',
          timestamp: Timestamp.now(),
          read: false
        });
      }

      this.showToast('Join request sent! Waiting for admin approval.');
      this.loadKennelsList();
    } catch (error) {
      console.error('Error sending join request:', error);
      this.showToast('Error sending request. Please try again.', 'error');
    }
  },

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#d32f2f' : '#4CAF50'};
      color: white;
      padding: 12px 24px;
      border-radius: 24px;
      font-family: sans-serif;
      font-size: 14px;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },

  async loadUserData() {
    // Prevent duplicate loads within 30 seconds
    if (this._loadingConversations) {
      console.log('Already loading conversations, skipping');
      return;
    }
    
    const lastLoad = sessionStorage.getItem('chat_last_load');
    if (lastLoad && Date.now() - parseInt(lastLoad) < 30000) {
      console.log('Using cached conversations, last load was', Date.now() - parseInt(lastLoad), 'ms ago');
      // Still set up listener for real-time updates, but don't reload immediately
    }
    
    this._loadingConversations = true;
    const userRef = doc(this.db, 'users', this.user.uid);
    
    onSnapshot(userRef, async (userDoc) => {
      if (!userDoc.exists()) {
        console.error('User document does not exist');
        this._loadingConversations = false;
        return;
      }
      
      this.userData = userDoc.data();
      
      if (!this.userData.lastSeenGroups) {
        await updateDoc(userRef, { lastSeenGroups: {} });
        this.userData.lastSeenGroups = {};
      }
      
      // Only load if not already loaded recently
      const lastLoad = sessionStorage.getItem('chat_last_load');
      const shouldLoad = !lastLoad || Date.now() - parseInt(lastLoad) > 30000;
      
      if (shouldLoad || this.conversations.length === 0) {
        this.loadConversations();
        this.loadUserKennels();
        sessionStorage.setItem('chat_last_load', Date.now().toString());
      }
      
      this._loadingConversations = false;
    });
  },

  async loadConversations() {
    console.log('=== loadConversations() called ===');
    const dmQuery = query(
      collection(this.db, 'dms'),
      where('participants', 'array-contains', this.user.uid)
    );

    this.unsubscribe = onSnapshot(dmQuery, async (snapshot) => {
      console.log('DM snapshot received, count:', snapshot.docs.length);
      
      this.dmListeners.forEach(unsub => unsub());
      this.dmListeners = [];

      const dmConversations = [];
      
      for (const dmDoc of snapshot.docs) {
        const dmData = dmDoc.data();
        const otherUid = dmData.participants.find(uid => uid !== this.user.uid);
        if (!otherUid) continue;

        const otherUser = await getDoc(doc(this.db, 'users', otherUid));
        const otherData = otherUser.data() || {};

        const lastSeenKey = `lastSeen${dmDoc.id}`;
        const lastSeen = this.userData?.[lastSeenKey] || Timestamp.fromDate(new Date(0));

        const messagesRef = collection(this.db, 'dms', dmDoc.id, 'messages');
        const unsub = onSnapshot(
          query(messagesRef, orderBy('timestamp', 'desc'), limit(20)),
          (msgSnap) => {
            const lastSeenMs = lastSeen?.toMillis?.() || 0;
            let unreadCount = 0;
            let newMessagesCount = 0;
            const messages = [];
            
            msgSnap.docs.forEach(doc => {
              const msg = doc.data();
              messages.push(msg);
              const msgTimeMs = msg.timestamp?.toMillis?.() || 0;
              if (msgTimeMs > lastSeenMs && msg.senderId !== this.user.uid) {
                unreadCount++;
              }
              
              // Check for truly new messages (not on first load)
              const lastTrackedTime = this.trackLastMessageTime(dmDoc.id, 0);
              if (msgTimeMs > lastTrackedTime && msg.senderId !== this.user.uid) {
                newMessagesCount++;
                this.trackLastMessageTime(dmDoc.id, msgTimeMs);
              }
            });

            // Play sound for unread messages
            if (unreadCount > 0 && window.chatApp?._audioUnlocked) {
              const isFirstLoad = !sessionStorage.getItem(`dm_loaded_${dmDoc.id}`);
              if (isFirstLoad || newMessagesCount > 0) {
                console.log('🔔 Playing sound for', unreadCount, 'unread DM messages');
                window.chatApp.playNotificationSound();
                sessionStorage.setItem(`dm_loaded_${dmDoc.id}`, 'true');
              }
            }

            const existingIndex = dmConversations.findIndex(c => c.id === dmDoc.id);
            const conv = {
              id: dmDoc.id,
              type: 'dm',
              name: otherData.hashHandle || 'Unknown',
              otherUid: otherUid,
              otherPic: otherData.profilePicUrl || null,
              myPic: this.userData?.profilePicUrl || null,
              lastMessage: messages[0] ? this.formatLastMessage(messages[0]) : 'No messages yet',
              lastTime: messages[0]?.timestamp,
              unread: unreadCount,
              typing: dmData.typing?.[otherUid] || false,
              lastSeen: lastSeen
            };

            if (existingIndex >= 0) {
              dmConversations[existingIndex] = conv;
            } else {
              dmConversations.push(conv);
            }

            this.conversations = [...dmConversations, ...this.conversations.filter(c => c.type === 'group')];
            this.sortAndRender();
          }
        );

        this.dmListeners.push(unsub);
      }
    });
  },

  async loadUserKennels() {
    console.log('=== loadUserKennels() called ===');
    
    if (!this.userData) {
      console.log('Waiting for user data...');
      return;
    }

    let joinedKennels = this.userData.joinedKennels || [];
    
    if (joinedKennels.length === 0) {
      const country = this.userData.country;
      const state = this.userData.state;
      const kennel = this.userData.kennel;
      
      if (country && state && kennel) {
        const kennelPath = `locations/${country}/states/${state}/kennels/${kennel}`;
        console.log('Auto-adding default kennel:', kennelPath);
        
        const userRef = doc(this.db, 'users', this.user.uid);
        await updateDoc(userRef, {
          joinedKennels: [kennelPath]
        });
        
        joinedKennels = [kennelPath];
        this.userData.joinedKennels = joinedKennels;
      } else {
        console.warn('Missing country, state, or kennel in user profile');
        return;
      }
    }

    this.kennelListeners.forEach(unsub => unsub());
    this.kennelListeners = [];

    for (const kennelPath of joinedKennels) {
      const pathParts = kennelPath.split('/');
      const kennelName = pathParts[pathParts.length - 1];
      const kennelId = kennelPath.replace(/\//g, '_');
      
      const sanitizedPath = kennelPath.replace(/\//g, '_');

      // Fetch kennel document to get logo
      let kennelLogoUrl = null;
      try {
        const kennelDoc = await getDoc(doc(this.db, kennelPath));
        if (kennelDoc.exists()) {
          kennelLogoUrl = kennelDoc.data().logoUrl || null;
        }
      } catch (err) {
        console.error('Error fetching kennel logo:', err);
      }

      const messagesRef = collection(this.db, kennelPath, 'chat_groups', 'default', 'messages');
      
      const unsub = onSnapshot(
        query(messagesRef, orderBy('timestamp', 'desc'), limit(20)),
        (msgSnap) => {
          const freshLastSeen = this.userData?.lastSeenGroups?.[sanitizedPath] || Timestamp.fromDate(new Date(0));
          const lastSeenMs = freshLastSeen?.toMillis?.() || 0;
          
          let unreadCount = 0;
          let newMessagesCount = 0;
          const messages = [];
          
          msgSnap.docs.forEach(doc => {
            const msg = doc.data();
            messages.push(msg);
            const msgTimeMs = msg.timestamp?.toMillis?.() || 0;
            if (msgTimeMs > lastSeenMs && msg.senderId !== this.user.uid) {
              unreadCount++;
            }
            
            // Check for truly new messages
            const lastTrackedTime = this.trackLastMessageTime(kennelId, 0);
            if (msgTimeMs > lastTrackedTime && msg.senderId !== this.user.uid) {
              newMessagesCount++;
              this.trackLastMessageTime(kennelId, msgTimeMs);
            }
          });

          // Play sound for new messages
          if (newMessagesCount > 0 && this.shouldPlaySound(kennelId, 'group')) {
            console.log('🔔 Playing sound for', newMessagesCount, 'new group message(s)');
            window.chatApp?.playNotificationSound();
          }

          const groupConv = {
            id: kennelId,
            type: 'group',
            kennelPath: kennelPath,
            name: kennelName,
            icon: kennelLogoUrl,
            lastMessage: messages[0] ? this.formatLastMessage(messages[0]) : 'No messages yet',
            lastTime: messages[0]?.timestamp || Timestamp.now(),
            unread: unreadCount,
            typing: false,
            lastSeen: freshLastSeen
          };

          const existingIndex = this.conversations.findIndex(c => c.id === kennelId);
          if (existingIndex >= 0) {
            this.conversations[existingIndex] = groupConv;
          } else {
            this.conversations.push(groupConv);
          }

          this.sortAndRender();
        }
      );

      this.kennelListeners.push(unsub);
    }
  },

  formatLastMessage(msg) {
    if (!msg) return 'No messages yet';
    switch (msg.messageType || 'text') {
      case 'image': return '📷 Photo';
      case 'video': return '🎥 Video';
      case 'audio': return '🎵 Audio';
      case 'voice': return '🎤 Voice message';
      case 'file': return '📄 File';
      case 'sticker': return '😀 Sticker';
      default: return msg.content || '';
    }
  },

   sortAndRender() {
    this.conversations.sort((a, b) => {
      const timeA = a.lastTime?.toMillis?.() || 0;
      const timeB = b.lastTime?.toMillis?.() || 0;
      return timeB - timeA;
    });
    
    // Debounce render to batch rapid updates
    if (this._renderTimeout) clearTimeout(this._renderTimeout);
    this._renderTimeout = setTimeout(() => {
      this.render();
      // Cache for instant reload
      try {
        sessionStorage.setItem('chat_conversations', JSON.stringify(this.conversations));
      } catch (e) {
        console.error('Failed to cache conversations');
      }
    }, 100);
  },

  render() {
    const container = document.getElementById('conversations-list');
    if (!container) return;

    if (this.conversations.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <p>No conversations yet</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.conversations.map(conv => {
      if (conv.type === 'dm') {
        return this.renderDmItem(conv);
      } else {
        return this.renderGroupItem(conv);
      }
    }).join('');
  },

    renderDmItem(conv) {
    // Use profile pic if available and not empty, otherwise use placeholder
    const otherAvatar = (conv.otherPic && conv.otherPic.trim() !== '') 
      ? conv.otherPic 
      : this.createPlaceholder(conv.name.charAt(0), '#FF6D00');
    
    const myAvatar = (conv.myPic && conv.myPic.trim() !== '') 
      ? conv.myPic 
      : this.createPlaceholder('Me', '#4CAF50');
    
    return `
      <div class="conversation-item ${conv.unread > 0 ? 'unread' : ''}" 
           onclick="window.chatApp && window.chatApp.openDmChat('${conv.id}', '${this.escapeJs(conv.name)}', '${conv.otherUid}', '${conv.otherPic || ''}', '${conv.myPic || ''}', '${conv.lastSeen?.toMillis?.() || 0}')">
        <div class="conversation-avatar">
          <div class="dm-avatars">
            <img src="${otherAvatar}" alt="${this.escapeHtml(conv.name)}" onerror="this.src='${this.createPlaceholder(conv.name.charAt(0), '#FF6D00')}'">
            <img src="${myAvatar}" alt="Me" onerror="this.src='${this.createPlaceholder('Me', '#4CAF50')}'">
          </div>
          <div class="swap-icon-small">⇆</div>
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${this.escapeHtml(conv.name)}</div>
          <div class="conversation-preview ${conv.typing ? 'typing' : ''}">
            ${conv.typing ? 'typing...' : this.escapeHtml(conv.lastMessage)}
          </div>
        </div>
        <div class="conversation-meta">
          <div class="conversation-time">${this.formatTime(conv.lastTime)}</div>
          ${conv.unread > 0 ? `<div class="unread-badge">${conv.unread > 99 ? '99+' : conv.unread}</div>` : ''}
        </div>
      </div>
    `;
  },

   renderGroupItem(conv) {
    // Use kennel logo if available, otherwise create placeholder from first letter
    const avatarSrc = conv.icon || this.createPlaceholder(conv.name.charAt(0), '#4CAF50');
    
    return `
      <div class="conversation-item ${conv.unread > 0 ? 'unread' : ''}" 
           onclick="window.chatApp && window.chatApp.openGroupChat('${conv.id}', '${this.escapeJs(conv.name)}', '${this.escapeJs(conv.kennelPath)}', '${conv.icon || ''}', '${conv.lastSeen?.toMillis?.() || 0}')">
        <div class="conversation-avatar">
          <img src="${avatarSrc}" alt="${this.escapeHtml(conv.name)}" 
               style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #4CAF50;"
               onerror="this.src='${this.createPlaceholder(conv.name.charAt(0), '#4CAF50')}'">
        </div>
        <div class="conversation-info">
          <div class="conversation-name">${this.escapeHtml(conv.name)}</div>
          <div class="conversation-preview">
            ${this.escapeHtml(conv.lastMessage)}
          </div>
        </div>
        <div class="conversation-meta">
          <div class="conversation-time">${this.formatTime(conv.lastTime)}</div>
          ${conv.unread > 0 ? `<div class="unread-badge">${conv.unread > 99 ? '99+' : conv.unread}</div>` : ''}
        </div>
      </div>
    `;
  },

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  createPlaceholder(text, color = '#FF6D00') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${color}"/><text x="50" y="65" text-anchor="middle" font-size="45" fill="white" font-family="Arial">${text.charAt(0).toUpperCase()}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeJs(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  shouldPlaySound(convId, convType) {
    // Don't play if chatApp isn't available
    if (!window.chatApp) return false;
    
    // Don't play if we're currently viewing this specific chat
    if (window.chatApp.currentView === 'chat' && window.chatApp.currentChat) {
      const isViewingDm = convType === 'dm' && window.chatApp.currentChat.id === convId;
      const isViewingGroup = convType === 'group' && window.chatApp.currentChat.id === convId;
      if (isViewingDm || isViewingGroup) return false;
    }
    
    // Don't play if app just initialized (first 2 seconds)
    const appInitTime = parseInt(sessionStorage.getItem('chat_app_init_time') || '0');
    if (Date.now() - appInitTime < 2000) return false;
    
    return true;
  },

  trackLastMessageTime(convId, msgTime) {
    const key = `last_msg_time_${convId}`;
    const lastTime = parseInt(sessionStorage.getItem(key) || '0');
    if (msgTime > 0) {
      sessionStorage.setItem(key, msgTime.toString());
    }
    return lastTime;
  },

  async startDm(otherUid, otherName) {
    try {
      const myUid = this.user.uid;
      const dmId = [myUid, otherUid].sort().join('-');
      const dmRef = doc(this.db, 'dms', dmId);
      const dmSnap = await getDoc(dmRef);

      if (!dmSnap.exists()) {
        await setDoc(dmRef, {
          participants: [myUid, otherUid].sort(),
          createdAt: Timestamp.now(),
          typing: { [myUid]: false, [otherUid]: false }
        });
      }

      const myUser = await getDoc(doc(this.db, 'users', myUid));
      const myData = myUser.data();
      
      const otherUser = await getDoc(doc(this.db, 'users', otherUid));
      const otherData = otherUser.data();

      if (window.chatApp) {
        window.chatApp.openDmChat(dmId, otherName, otherUid, otherData?.profilePicUrl, myData?.profilePicUrl, 0);
      }
    } catch (error) {
      console.error('Error starting DM:', error);
    }
  },

  refresh() {
    this.loadUserData();
  }
};

export { chatList };
window.chatList = chatList;