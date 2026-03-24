import { 
  collection,
  doc,
  query,
  orderBy,
  limit,
  limitToLast,
  onSnapshot,
  addDoc,
  Timestamp,
  where,
  getDocs,
  startAfter,
  endBefore,
  getDoc,
  updateDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const chatScreen = {
  db: null,
  user: null,
  messagesUnsubscribe: null,
  currentMessages: [],
  oldestMessage: null,
  isLoadingMore: false,
  hasMoreMessages: true,
  scrollHandler: null, // Store scroll handler reference
  currentChatId: null, // Track current chat for scroll listener
  currentChatType: null,
  currentKennelPath: null,

  init(user, db) {
    this.user = user;
    this.db = db;
  },

  // WHATSAPP-STYLE: Load messages in ASC order (oldest first)
  async loadMessages(chatId, type, kennelPath = null) {
    // Clean up any existing listener
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = null;
    }
    
    // Remove existing scroll listener
    this.removeScrollListener();
    
    // Reset state
    this.currentMessages = [];
    this.oldestMessage = null;
    this.hasMoreMessages = true;
    this.isLoadingMore = false;
    this.currentChatId = chatId;
    this.currentChatType = type;
    this.currentKennelPath = kennelPath;

    const container = document.getElementById('messages-container');
    if (container) {
      container.innerHTML = '';
      // Show loading spinner
      container.innerHTML = '<div class="messages-loading" style="text-align:center;padding:20px;"><div class="spinner"></div></div>';
    }

    const collectionPath = type === 'dm' ? 
      `dms/${chatId}/messages` : 
      `${kennelPath}/chat_groups/default/messages`;

    // WHATSAPP-STYLE: Query ASC with limitToLast (newest N messages, but in ASC order)
    const q = query(
      collection(this.db, collectionPath),
      orderBy('timestamp', 'asc'),
      limitToLast(50)
    );

    // Use onSnapshot for real-time updates
    this.messagesUnsubscribe = onSnapshot(q, (snapshot) => {
      // Skip if this is just local cache (wait for server confirmation)
      if (snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
        return;
      }

      // Get all messages from snapshot in order
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Store oldest timestamp for pagination
      if (messages.length > 0) {
        this.oldestMessage = messages[0].timestamp;
      }

      // Check if we might have more older messages
      this.hasMoreMessages = messages.length === 50;

      // Replace entire message list (WhatsApp-style)
      this.currentMessages = messages;
      
      // Render all messages (replace mode)
      this.renderMessages(messages, false);
      
      // Scroll to bottom on initial load
      this.scrollToBottom();
      
      // Remove loading spinner
      const spinner = container?.querySelector('.messages-loading');
      if (spinner) spinner.remove();
    }, (error) => {
      console.error('Message listener error:', error);
    });
  },

  // Setup scroll listener for pagination (pull up to load more)
  setupScrollListener(chatId, type, kennelPath = null) {
    const container = document.getElementById('messages-container');
    if (!container) return;

    // Remove any existing listener first
    this.removeScrollListener();

    // Store parameters for the handler
    this.currentChatId = chatId;
    this.currentChatType = type;
    this.currentKennelPath = kennelPath;

    // Create scroll handler
    this.scrollHandler = () => {
      // If scrolled near top (within 100px), load older messages
      if (container.scrollTop < 100 && this.hasMoreMessages && !this.isLoadingMore) {
        this.loadOlderMessages(chatId, type, kennelPath);
      }
    };

    // Add scroll listener with debounce
    let scrollTimeout;
    container.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (this.scrollHandler) {
          this.scrollHandler();
        }
      }, 150);
    });
  },

  // Remove scroll listener
  removeScrollListener() {
    // We can't easily remove the anonymous scroll listener from container
    // So we'll just null out the handler which prevents execution
    this.scrollHandler = null;
  },

  // WHATSAPP-STYLE: Load older messages when scrolling up
  async loadOlderMessages(chatId, type, kennelPath = null) {
    if (this.isLoadingMore || !this.hasMoreMessages || !this.oldestMessage) {
      return;
    }

    this.isLoadingMore = true;
    
    const container = document.getElementById('messages-container');
    const scrollHeightBefore = container?.scrollHeight || 0;

    const collectionPath = type === 'dm' ? 
      `dms/${chatId}/messages` : 
      `${kennelPath}/chat_groups/default/messages`;

    // Query messages BEFORE the oldest we have
    const q = query(
      collection(this.db, collectionPath),
      orderBy('timestamp', 'asc'),
      endBefore(this.oldestMessage),
      limitToLast(50)
    );

    try {
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        this.hasMoreMessages = false;
        this.isLoadingMore = false;
        return;
      }

      const olderMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Update oldest pointer
      this.oldestMessage = olderMessages[0].timestamp;
      this.hasMoreMessages = olderMessages.length === 50;

      // WHATSAPP-STYLE: Prepend to beginning of array
      this.currentMessages = [...olderMessages, ...this.currentMessages];

      // Render only the older messages at the top (prepend mode)
      this.renderMessages(olderMessages, 'prepend');

      // Maintain scroll position so user doesn't jump
      if (container) {
        const scrollHeightAfter = container.scrollHeight;
        container.scrollTop = scrollHeightAfter - scrollHeightBefore;
      }

    } catch (error) {
      console.error('Error loading older messages:', error);
    } finally {
      this.isLoadingMore = false;
    }
  },

  renderMessages(messages, mode = 'replace') {
    const container = document.getElementById('messages-container');
    if (!container || messages.length === 0) return;

    const lastSeenTimestamp = parseInt(container.dataset.lastSeen) || 0;
    let lastDate = null;
    let html = '';
    let hasShownNewSeparator = false;

    // If prepending, check existing first message's date to avoid duplicates
    if (mode === 'prepend') {
      const firstExisting = container.querySelector('.message');
      if (firstExisting) {
        const existingDateHeader = firstExisting.previousElementSibling;
        if (existingDateHeader?.classList.contains('date-header')) {
          lastDate = existingDateHeader.querySelector('span')?.textContent;
        }
      }
    }

    messages.forEach((msg) => {
      const isMe = msg.senderId === this.user.uid;
      const time = this.formatTime(msg.timestamp);
      const date = this.formatDate(msg.timestamp);
      const msgTimestamp = msg.timestamp?.toMillis?.() || msg.timestamp || 0;
      
      // Date header (only if different from last)
      if (date !== lastDate) {
        lastDate = date;
        html += `<div class="date-header"><span>${date}</span></div>`;
      }
      
      // "New Messages" separator
      if (!hasShownNewSeparator && !isMe && msgTimestamp > lastSeenTimestamp) {
        html += `<div class="new-messages-separator"><span>New Messages</span></div>`;
        hasShownNewSeparator = true;
      }
      
      const isUnread = !isMe && msgTimestamp > lastSeenTimestamp;
      html += this.createMessageHtml(msg, isMe, time, isUnread);
    });

    // Insert based on mode
    if (mode === 'prepend') {
      container.insertAdjacentHTML('afterbegin', html);
    } else if (mode === 'append') {
      container.insertAdjacentHTML('beforeend', html);
    } else {
      container.innerHTML = html;
    }

    this.setupMessageInteractions();
  },

  // YOUR ORIGINAL createMessageHtml - PRESERVED EXACTLY
  createMessageHtml(msg, isMe, time, isUnread = false) {
    // ADD THIS CHECK FIRST - For system receipts
    if (msg.isSystemMessage && msg.messageType === 'receipt') {
      return this.createReceiptHtml(msg);
    }
    const type = msg.messageType || 'text';
    const isGroupChat = window.chatApp.currentChat?.type === 'group';
    let content = '';

    switch (type) {
      case 'image':
        content = `<img src="${msg.mediaUrl}" class="message-media" onclick="window.chatApp.viewMedia('${msg.mediaUrl}', 'image')" loading="lazy">`;
        break;
      case 'video':
        content = `<video src="${msg.mediaUrl}" class="message-media" controls></video>`;
        break;
      case 'voice':
      case 'audio':
        content = `
          <div class="message-voice" onclick="window.chatApp.playAudio('${msg.mediaUrl}')">
            <button class="voice-play-btn">▶</button>
            <div class="voice-wave"></div>
            <span class="voice-duration">0:30</span>
          </div>
        `;
        break;
      case 'file':
        content = `<a href="${msg.mediaUrl}" target="_blank" class="message-file">📄 ${msg.content || 'File'}</a>`;
        break;
      case 'sticker':
        content = `<img src="${msg.mediaUrl}" class="message-media" style="max-width: 120px;">`;
        break;
      default:
        content = `<div class="message-content">${this.escapeHtml(msg.content || '')}</div>`;
    }

    let replyHtml = '';
    if (msg.replyTo) {
      replyHtml = `
        <div class="reply-quote">
          <div class="reply-sender">${msg.replyTo.senderName || 'Unknown'}</div>
          <div class="reply-text">${this.escapeHtml(msg.replyTo.content || 'Media')}</div>
        </div>
      `;
    }

    // Create sender info for group chats (only for received messages)
    let senderHtml = '';
    if (isGroupChat && !isMe) {
      const senderName = msg.senderName || 'Unknown';
      const senderPic = msg.senderPic || '';
      senderHtml = `
        <div class="message-sender" style="
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 6px;
          font-size: 12px;
          color: #666;
          font-weight: 500;
        ">
          <img src="${senderPic}" 
               style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover; border: 1px solid #ddd;"
               onerror="this.style.display='none'">
          <span>${this.escapeHtml(senderName)}</span>
        </div>
      `;
    }

    const readStatus = isMe ? 
      `<span class="read-status ${msg.readBy?.length > 1 ? 'read' : ''}">✓✓</span>` : '';

    const unreadClass = isUnread ? 'unread-message' : '';

    return `
      <div class="message ${isMe ? 'sent' : 'received'} ${unreadClass}" data-id="${msg.id}" data-sender="${msg.senderId}" style="position: relative; touch-action: pan-y;">
        <div class="message-select-handle" data-message-id="${msg.id}">☐</div>
        <button class="message-actions-btn" onclick="event.stopPropagation(); chatApp.showMessageMenu('${msg.id}')" title="More">⋮</button>
        <div class="message-bubble">
          ${senderHtml}
          ${replyHtml}
          ${content}
          <div class="message-footer">
            <span class="message-time">${time}</span>
            ${readStatus}
          </div>
        </div>
      </div>
    `;
  },

  // YOUR ORIGINAL createReceiptHtml - PRESERVED EXACTLY
  createReceiptHtml(msg) {
    const data = msg.receiptData || {};
    const status = data.status || 'success';
    const isFailed = status === 'failed';
    
    let timeStr = data.timestamp || '';
    if (msg.timestamp) {
      const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
      timeStr = date.toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    }
    
    const statusColor = isFailed ? '#d63031' : '#00b894';
    const statusIcon = isFailed ? '⚠️' : '✓';
    const statusText = isFailed ? 'FAILED' : 'SUCCESSFUL';
    
    return `
      <div class="message system-receipt ${status}" data-id="${msg.id}" data-sender="${msg.senderId}" style="align-self: center; max-width: 320px; width: 90%; margin: 12px auto; background: white; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: linear-gradient(135deg, #FF6D00 0%, #FF8F00 100%); color: white;">
          <img src="${msg.senderPic || 'icons/h3_logo.svg'}" 
               style="width: 32px; height: 32px; border-radius: 8px; object-fit: cover; background: white; padding: 2px;" 
               alt="H3 Global" 
               onerror="this.src='icons/h3_logo.svg'">
          <span style="font-size: 14px; font-weight: 600;">${msg.senderName || 'H3 Global Wallet'}</span>
        </div>
        
        <div style="padding: 20px; text-align: center;">
          <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: ${statusColor}15; color: ${statusColor}; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px;">
            <span>${statusIcon}</span>
            <span>${statusText}</span>
          </div>
          
          <div style="font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">${data.title || 'Transaction'}</div>
          
          <div style="font-size: 32px; font-weight: 800; color: #2d3436; margin-bottom: 20px;">
            <span style="font-size: 20px; color: #FF6D00; vertical-align: top; margin-right: 2px;">₦</span>${(data.amount || 0).toLocaleString()}
          </div>
          
          <div style="text-align: left; background: #f8f9fa; padding: 16px; border-radius: 12px; margin-bottom: 16px;">
            ${data.transactionId ? `<div style="font-size: 12px; color: #666; margin-bottom: 8px; font-family: 'Courier New', monospace; word-break: break-all;"><span style="color: #999;">Ref:</span> ${data.transactionId}</div>` : ''}
            ${data.transferCode ? `<div style="font-size: 12px; color: #666; margin-bottom: 8px; font-family: 'Courier New', monospace; word-break: break-all;"><span style="color: #999;">Code:</span> ${data.transferCode}</div>` : ''}
            ${data.reference ? `<div style="font-size: 12px; color: #666; margin-bottom: 8px; font-family: 'Courier New', monospace; word-break: break-all;"><span style="color: #999;">Ref:</span> ${data.reference}</div>` : ''}
            ${data.bankName ? `<div style="font-size: 12px; color: #666; margin-bottom: 8px;"><span style="color: #999;">Bank:</span> ${data.bankName}</div>` : ''}
            ${data.accountNumber ? `<div style="font-size: 12px; color: #666; margin-bottom: 8px; font-family: 'Courier New', monospace;"><span style="color: #999;">Acct:</span> ****${data.accountNumber.slice(-4)}</div>` : ''}
            ${data.failureReason ? `<div style="font-size: 12px; color: #d63031; font-weight: 600; margin-bottom: 8px; padding: 8px; background: #ff767515; border-radius: 6px; border-left: 3px solid #d63031;"><span style="color: #999;">Error:</span> ${data.failureReason}</div>` : ''}
            ${data.newBalance !== undefined ? `<div style="font-size: 12px; color: #00b894; font-weight: 600; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ddd;"><span style="color: #999;">New Balance:</span> ₦${data.newBalance.toLocaleString()}</div>` : ''}
          </div>
          
          <div style="font-size: 11px; color: #999;">${timeStr}</div>
          
          <div style="display: inline-flex; align-items: center; gap: 6px; margin-top: 12px; padding: 6px 12px; background: #00b894; color: white; border-radius: 20px; font-size: 11px; font-weight: 600;">
            <span>🔒</span>
            <span>SECURED BY H3 GLOBAL</span>
          </div>
        </div>
      </div>
    `;
  },

  // YOUR ORIGINAL setupMessageInteractions - PRESERVED EXACTLY
  setupMessageInteractions() {
    document.querySelectorAll('.message').forEach(msg => {
      // Skip system receipts
      if (msg.classList.contains('system-receipt')) {
        msg.dataset.initialized = 'true';
        return;
      }
      
      // Skip if already initialized
      if (msg.dataset.initialized === 'true') return;
      msg.dataset.initialized = 'true';

      let pressTimer = null;
      let isLongPress = false;
      let touchStartY = 0;
      let touchStartX = 0;
      let hasMoved = false;

      // Prevent default context menu
      msg.addEventListener('contextmenu', (e) => {
        if (window.chatApp.isSelectionMode) {
          e.preventDefault();
          return false;
        }
      });

      const startPress = (e) => {
        if (e.target.closest('.message-actions-btn')) return;
        if (e.target.tagName === 'A' || e.target.closest('.message-media') || e.target.closest('video')) return;

        const touch = e.touches ? e.touches[0] : e;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        hasMoved = false;
        isLongPress = false;

        msg.classList.add('pressing');

        pressTimer = setTimeout(() => {
          if (!hasMoved) {
            isLongPress = true;
            msg.classList.remove('pressing');
            
            const ripple = document.createElement('div');
            ripple.className = 'message-ripple';
            const rect = msg.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);
            ripple.style.width = ripple.style.height = size + 'px';
            ripple.style.left = (touch.clientX - rect.left - size/2) + 'px';
            ripple.style.top = (touch.clientY - rect.top - size/2) + 'px';
            msg.appendChild(ripple);
            setTimeout(() => ripple.remove(), 400);

            window.chatApp.handleLongPress(msg);
            
            if (window.getSelection) {
              window.getSelection().removeAllRanges();
            }
          }
        }, 400);
      };

      const movePress = (e) => {
        if (!pressTimer) return;
        
        const touch = e.touches ? e.touches[0] : e;
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        
        if (deltaX > 10 || deltaY > 10) {
          hasMoved = true;
          clearTimeout(pressTimer);
          pressTimer = null;
          msg.classList.remove('pressing');
        }
      };

      const endPress = (e) => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        msg.classList.remove('pressing');

        if (!isLongPress && !hasMoved) {
          if (window.chatApp.isSelectionMode) {
            e.preventDefault();
            e.stopPropagation();
            window.chatApp.toggleMessageSelection(msg);
          }
        }
        
        isLongPress = false;
      };

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
        msg.classList.remove('pressing');
        isLongPress = false;
      };

      msg.addEventListener('touchstart', startPress, { passive: true, capture: false });
      msg.addEventListener('touchmove', movePress, { passive: true });
      msg.addEventListener('touchend', endPress, { passive: true });
      msg.addEventListener('touchcancel', cancelPress, { passive: true });

      msg.addEventListener('mousedown', startPress);
      msg.addEventListener('mousemove', movePress);
      msg.addEventListener('mouseup', endPress);
      msg.addEventListener('mouseleave', cancelPress);

      const handle = msg.querySelector('.message-select-handle');
      if (handle) {
        handle.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          window.chatApp.toggleMessageSelection(msg);
        });
      }

      // Swipe to reply
      let swipeStartX = 0;
      let isSwiping = false;

      msg.addEventListener('touchstart', (e) => {
        if (window.chatApp.isSelectionMode) return;
        if (e.target.closest('.message-actions-btn')) return;
        
        swipeStartX = e.touches[0].clientX;
        isSwiping = false;
      }, { passive: true });

      msg.addEventListener('touchmove', (e) => {
        if (window.chatApp.isSelectionMode) return;
        if (!swipeStartX) return;
        
        const currentX = e.touches[0].clientX;
        const deltaX = currentX - swipeStartX;
        
        if (deltaX > 20 && deltaX < 100) {
          isSwiping = true;
          const resistance = 0.6;
          msg.style.transform = `translateX(${deltaX * resistance}px)`;
          
          let indicator = msg.querySelector('.swipe-reply-indicator');
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'swipe-reply-indicator';
            indicator.innerHTML = '↩️';
            indicator.style.cssText = `
              position: absolute;
              left: -50px;
              top: 50%;
              transform: translateY(-50%);
              width: 40px;
              height: 40px;
              background: #00C853;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 20px;
              opacity: 0;
              transition: opacity 0.2s;
            `;
            msg.appendChild(indicator);
          }
          
          const progress = Math.min((deltaX - 20) / 60, 1);
          indicator.style.opacity = progress;
          indicator.style.left = (-50 + (progress * 10)) + 'px';
        }
      }, { passive: true });

      msg.addEventListener('touchend', (e) => {
        if (!isSwiping) {
          swipeStartX = 0;
          return;
        }
        
        const currentX = e.changedTouches[0].clientX;
        const deltaX = currentX - swipeStartX;
        
        if (deltaX > 60) {
          const messageId = msg.dataset.id;
          const messageData = this.currentMessages.find(m => m.id === messageId);
          if (messageData && window.messages) {
            window.messages.setReply(messageData);
          }
        }
        
        msg.style.transform = '';
        const indicator = msg.querySelector('.swipe-reply-indicator');
        if (indicator) {
          indicator.style.opacity = '0';
          setTimeout(() => indicator.remove(), 200);
        }
        
        isSwiping = false;
        swipeStartX = 0;
      });
    });
  },

  showMessageToolbar(messageEl) {
    const toolbar = document.getElementById('floating-toolbar');
    const rect = messageEl.getBoundingClientRect();
    toolbar.style.top = `${rect.top - 60}px`;
    toolbar.classList.add('show');
    window.chatApp.selectedMessage = messageEl.dataset.id;
    setTimeout(() => toolbar.classList.remove('show'), 3000);
  },

  scrollToBottom() {
    const scrollable = document.querySelector('.chat-screen-view.active .scrollable') || 
                       document.getElementById('messages-container');
    if (scrollable) {
      scrollable.scrollTo({
        top: scrollable.scrollHeight,
        behavior: 'auto'
      });
    }
  },

  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  formatDate(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === now.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  },

  searchMessages(term) {
    const messages = document.querySelectorAll('.message');
    messages.forEach(msg => {
      const content = msg.querySelector('.message-content')?.textContent || '';
      if (content.toLowerCase().includes(term.toLowerCase())) {
        msg.style.backgroundColor = '#FFF3E0';
        setTimeout(() => msg.style.backgroundColor = '', 2000);
      }
    });
  },

  cleanup() {
    console.log('[CLEANUP] cleanup() called');
    
    if (this.messagesUnsubscribe) {
      this.messagesUnsubscribe();
      this.messagesUnsubscribe = null;
    }
    
    this.removeScrollListener();
    
    this.currentMessages = [];
    this.oldestMessage = null;
    this.hasMoreMessages = true;
    this.isLoadingMore = false;
    this.currentChatId = null;
    this.currentChatType = null;
    this.currentKennelPath = null;
    
    const container = document.getElementById('messages-container');
    if (container) {
      container.innerHTML = '';
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

export { chatScreen };
window.chatScreen = chatScreen;