// ==========================================
// SHARED BADGE SERVICE - Cross-page badge management
// ==========================================

import { db, auth } from '../firebase-config.js';
import { 
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

class BadgeService {
  constructor() {
    this.unreadCounts = {
      chat: 0,
      view_requests: 0,
      new_kennel_requests: 0,
      payment: 0,
      run_payment: 0
    };
    this.chatBreakdown = {
      dms: {},
      groups: {}
    };
    this.unsubscribers = [];
    this.currentUser = null;
    this.userData = null;
    this.isInitialized = false;
    this.userDocRef = null;
    this.lastSeenData = null;
    this.chatUnsubscribers = [];
    this.dmListeners = [];
  }

  async init() {
    if (this.isInitialized) return;
    
    // iOS/macOS requires user interaction before badge works
    // Also helps "wake up" the badging API
    const requestBadgePermission = () => {
      if ('setAppBadge' in navigator) {
        console.log('Unlocking badge API via user interaction...');
        navigator.clearAppBadge().catch(() => {});
      }
    };
    
    // Request on first user interaction (required for iOS)
    const unlockOnInteraction = () => {
      requestBadgePermission();
      document.removeEventListener('click', unlockOnInteraction);
      document.removeEventListener('touchstart', unlockOnInteraction);
    };
    document.addEventListener('click', unlockOnInteraction, { once: true });
    document.addEventListener('touchstart', unlockOnInteraction, { once: true });
    
    return new Promise((resolve) => {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.currentUser = user;
          this.userDocRef = doc(db, 'users', user.uid);
          await this.loadUserData(user.uid);
          this.startAllListeners();
          this.isInitialized = true;
          console.log('BadgeService initialized for user:', user.uid);
        } else {
          this.cleanup();
          this.currentUser = null;
          this.userData = null;
          this.isInitialized = false;
          console.log('BadgeService cleaned up - no user');
        }
        resolve();
      });
    });
  }

  async loadUserData(uid) {
    const userDoc = await getDoc(this.userDocRef);
    if (userDoc.exists()) {
      this.userData = userDoc.data();
      this.lastSeenData = {
        ...this.userData,
        lastSeenGroups: this.userData.lastSeenGroups || {}
      };
    }
  }

  startAllListeners() {
    this.cleanup();
    this.startUnifiedChatListener();
    
    if (this.userData?.kennel) {
      this.startViewRequestsListener();
      this.startPaymentListener();
    }
    
    if (this.userData?.role === 'Tier 1') {
      this.startNewKennelRequestsListener();
    }
  }

  startAllListeners() {
    this.cleanup();
    this.startUnifiedChatListener();
    
    if (this.userData?.kennel) {
      this.startViewRequestsListener();
      this.startPaymentListener();
    }
    
    if (this.userData?.role === 'Tier 1') {
      this.startNewKennelRequestsListener();
    }
  }

  startUnifiedChatListener() {
    if (!this.currentUser) return;
    
    console.log('Starting UNIFIED chat listener');
    
    const userUnsub = onSnapshot(this.userDocRef, (userDoc) => {
      if (userDoc.exists()) {
        const newData = userDoc.data();
        this.userData = newData;
        this.lastSeenData = {
          ...newData,
          lastSeenGroups: newData.lastSeenGroups || {}
        };
        this.refreshChatListeners();
      }
    });
    
    this.unsubscribers.push(userUnsub);
    this.refreshChatListeners();
  }

  refreshChatListeners() {
    this.chatUnsubscribers?.forEach(unsub => unsub());
    this.dmListeners?.forEach(unsub => unsub());
    this.chatUnsubscribers = [];
    this.dmListeners = [];
    
    this.listenToAllDms();
    
    const joinedKennels = this.userData?.joinedKennels || [];
    joinedKennels.forEach(kennelPath => {
      this.listenToKennelGroup(kennelPath);
    });
  }

  listenToAllDms() {
    const dmQuery = query(
      collection(db, 'dms'),
      where('participants', 'array-contains', this.currentUser.uid)
    );

    const unsub = onSnapshot(dmQuery, (dmSnap) => {
      this.dmListeners?.forEach(unsub => unsub());
      this.dmListeners = [];
      
      dmSnap.docs.forEach(dmDoc => {
        const dmId = dmDoc.id;
        
        const msgUnsub = onSnapshot(
          query(
            collection(db, 'dms', dmId, 'messages'),
            orderBy('timestamp', 'desc'),
            limit(50)
          ),
          (msgSnap) => {
            const lastSeenKey = `lastSeen${dmId}`;
            const lastSeen = this.lastSeenData?.[lastSeenKey]?.toMillis?.() || 0;
            
            let unreadCount = 0;
            
            msgSnap.docs.forEach(msgDoc => {
              const msg = msgDoc.data();
              const msgTime = msg.timestamp?.toMillis?.() || 0;
              
              if (msgTime > lastSeen && msg.senderId !== this.currentUser.uid) {
                unreadCount++;
              }
            });
            
            this.chatBreakdown.dms[dmId] = unreadCount;
            this.recalculateTotalChatUnread();
          }
        );
        
        this.dmListeners.push(msgUnsub);
      });
    });
    
    this.chatUnsubscribers.push(unsub);
  }

  listenToKennelGroup(kennelPath) {
    const sanitizedPath = kennelPath.replace(/\//g, '_');
    const messagesRef = collection(db, kennelPath, 'chat_groups', 'default', 'messages');
    
    const unsub = onSnapshot(
      query(messagesRef, orderBy('timestamp', 'desc'), limit(50)),
      (msgSnap) => {
        const lastSeen = this.lastSeenData?.lastSeenGroups?.[sanitizedPath]?.toMillis?.() || 0;
        
        let unreadCount = 0;
        
        msgSnap.docs.forEach(msgDoc => {
          const msg = msgDoc.data();
          const msgTime = msg.timestamp?.toMillis?.() || 0;
          
          if (msgTime > lastSeen && msg.senderId !== this.currentUser.uid) {
            unreadCount++;
          }
        });
        
        this.chatBreakdown.groups[kennelPath] = unreadCount;
        this.recalculateTotalChatUnread();
      }
    );
    
    this.chatUnsubscribers.push(unsub);
  }

  recalculateTotalChatUnread() {
    const dmTotal = Object.values(this.chatBreakdown.dms).reduce((a, b) => a + b, 0);
    const groupTotal = Object.values(this.chatBreakdown.groups).reduce((a, b) => a + b, 0);
    const total = dmTotal + groupTotal;
    
    console.log('Unified unread recalculated:', { dm: dmTotal, group: groupTotal, total });
    this.updateBadge('chat', total);
  }

  // Called by chatList to sync counts
  syncChatUnread(dmCounts, groupCounts) {
    if (dmCounts) this.chatBreakdown.dms = { ...this.chatBreakdown.dms, ...dmCounts };
    if (groupCounts) this.chatBreakdown.groups = { ...this.chatBreakdown.groups, ...groupCounts };
    this.recalculateTotalChatUnread();
  }

  forceRefresh() {
    console.log('Force refreshing badge counts');
    this.refreshChatListeners();
  }

  startViewRequestsListener() {
    const joinReqQuery = query(
      collection(db, 'locations', this.userData.country, 'states', this.userData.state, 'kennels', this.userData.kennel, 'ChatGroups', 'main', 'joinRequests'),
      where('status', '==', 'pending')
    );
    
    const unsub = onSnapshot(joinReqQuery, (snap) => {
      this.updateBadge('view_requests', snap.size);
    });
    
    this.unsubscribers.push(unsub);
  }

  startPaymentListener() {
    const payReqQuery = query(
      collection(db, 'paymentRequests'),
      where('type', '==', 'event-payment'),
      where('status', '==', 'pending'),
      where('kennel', '==', this.userData.kennel)
    );
    
    const unsub = onSnapshot(payReqQuery, (snap) => {
      this.updateBadge('payment', snap.size);
    });
    
    this.unsubscribers.push(unsub);
    
    const runPayQuery = query(
      collection(db, 'paymentRequests'),
      where('type', '==', 'run-payment'),
      where('status', '==', 'pending'),
      where('kennel', '==', this.userData.kennel)
    );
    
    const runUnsub = onSnapshot(runPayQuery, (snap) => {
      this.updateBadge('run_payment', snap.size);
    });
    
    this.unsubscribers.push(runUnsub);
  }

  startNewKennelRequestsListener() {
    const newKennelQuery = query(
      collection(db, 'kennelRequests'),
      where('status', '==', 'pending')
    );
    
    const unsub = onSnapshot(newKennelQuery, (snap) => {
      this.updateBadge('new_kennel_requests', snap.size);
    });
    
    this.unsubscribers.push(unsub);
  }

  updateBadge(type, count) {
    const oldCount = this.unreadCounts[type];
    this.unreadCounts[type] = count;
    
    if (oldCount !== count) {
      this.updateAllDisplays();
    }
  }

   updateAllDisplays() {
    const total = Object.values(this.unreadCounts).reduce((a, b) => a + b, 0);
    
    // Calculate overflow menu total (EXCLUDE chat - it has its own badge)
    const { chat, ...menuCounts } = this.unreadCounts;
    const menuTotal = Object.values(menuCounts).reduce((a, b) => a + b, 0);
    
    this.updateBottomNavChatBadge(this.unreadCounts.chat);
    this.updateOverflowBadge(menuTotal);  // Only menu items, not chat
    this.updateAppIconBadge(total);       // App icon shows everything
    
    window.dispatchEvent(new CustomEvent('badgeupdate', { 
      detail: { counts: { ...this.unreadCounts }, total } 
    }));
  }

  updateBottomNavChatBadge(count) {
    const chatNavItem = document.querySelector('.bottom-nav .nav-item[data-screen="chat"]');
    if (!chatNavItem) return;
    
    chatNavItem.style.position = 'relative';
    
    const existingBadge = chatNavItem.querySelector('.nav-badge');
    if (existingBadge) existingBadge.remove();
    
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.textContent = count > 99 ? '99+' : count;
      
      badge.style.cssText = `
        position: absolute;
        top: -4px;
        right: -4px;
        background: #FF6D00;
        color: white;
        border-radius: 50%;
        min-width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        z-index: 100;
        padding: 0 4px;
      `;
      
      chatNavItem.appendChild(badge);
      console.log(`Bottom nav badge updated: ${count}`);
    }
  }

  updateOverflowBadge(total) {
    const overflowBadge = document.getElementById('badge');
    if (overflowBadge) {
      overflowBadge.textContent = total > 99 ? '99+' : total;
      overflowBadge.classList.toggle('hidden', total === 0);
    }
  }

   updateAppIconBadge(total) {
    console.log('🔔 updateAppIconBadge called with:', total);
    
    // Check API support
    const supportsBadging = 'setAppBadge' in navigator;
    const supportsSW = 'serviceWorker' in navigator;
    const swController = supportsSW ? navigator.serviceWorker.controller : null;
    
    console.log('Platform checks:', {
      supportsBadging,
      supportsSW,
      hasController: !!swController,
      userAgent: navigator.userAgent.substring(0, 50)
    });
    
    // Try Badging API first (works on Android/Windows installed PWAs)
    if (supportsBadging) {
      console.log('Attempting navigator.setAppBadge...');
      const promise = total > 0 
        ? navigator.setAppBadge(total)
        : navigator.clearAppBadge();
        
      promise
        .then(() => console.log('✅ Badge API success'))
        .catch(err => console.error('❌ Badge API failed:', err.name, err.message));
    }
    
    // Also try Service Worker (for iOS/macOS fallback)
    if (swController) {
      console.log('Sending message to SW...');
      swController.postMessage({
        type: 'UPDATE_BADGE',
        count: total
      });
    } else if (supportsSW) {
      console.log('⚠️ SW exists but no controller - page not controlled by SW');
      // Try to get controller to wake up
      navigator.serviceWorker.ready.then(reg => {
        if (reg.active) {
          console.log('SW ready, trying to post to active worker');
          reg.active.postMessage({
            type: 'UPDATE_BADGE',
            count: total
          });
        }
      });
    }
  }

  getTotalCount() {
    return Object.values(this.unreadCounts).reduce((a, b) => a + b, 0);
  }

  getCounts() {
    return { ...this.unreadCounts };
  }

  cleanup() {
    this.unsubscribers.forEach(unsub => typeof unsub === 'function' && unsub());
    this.chatUnsubscribers?.forEach(unsub => typeof unsub === 'function' && unsub());
    this.dmListeners?.forEach(unsub => typeof unsub === 'function' && unsub());
    
    this.unsubscribers = [];
    this.chatUnsubscribers = [];
    this.dmListeners = [];
    
    this.unreadCounts = {
      chat: 0,
      view_requests: 0,
      new_kennel_requests: 0,
      payment: 0,
      run_payment: 0
    };
    this.chatBreakdown = { dms: {}, groups: {} };
  }
}

// Create singleton instance
const badgeService = new BadgeService();

// Export for ES modules
export { badgeService };
export default badgeService;

// Also expose globally for non-module scripts
window.badgeService = badgeService;