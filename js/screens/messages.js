import { 
  collection,
  doc,
  addDoc,
  updateDoc,
  Timestamp,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { storage, functions } from '../firebase-config.js';

const messages = {
  db: null,
  user: null,
  replyTo: null,

  init(user, db) {
    this.user = user;
    this.db = db;
  },

  async send() {
    const input = document.getElementById('message-input');
    const text = input?.value?.trim();
    if (!text || !window.chatApp.currentChat) return;

    const chat = window.chatApp.currentChat;
    
    try {
      const myUser = await getDoc(doc(this.db, 'users', this.user.uid));
      const myData = myUser.data() || {};

      const message = {
        senderId: this.user.uid,
        senderName: myData.hashHandle || 'Anonymous',
        senderHash: `Hash-${this.user.uid.slice(-4)}`,
        senderPic: myData.profilePicUrl || '',
        messageType: 'text',
        content: text,
        timestamp: Timestamp.now(),
        readBy: [this.user.uid]
      };

      if (this.replyTo) {
        message.replyTo = this.replyTo;
      }

      if (chat.type === 'dm') {
        message.otherUserId = chat.otherUid;
        const msgRef = await addDoc(collection(this.db, 'dms', chat.id, 'messages'), message);
        
        // Send notification
        this.sendPushNotification(chat.otherUid, myData.hashHandle, text, chat.id, msgRef.id);
      } else {
        await addDoc(collection(this.db, chat.kennelPath, 'chat_groups', 'default', 'messages'), message);
      }

      input.value = '';
      input.style.height = 'auto';
      this.clearReply();
    } catch (error) {
      console.error('Error sending message:', error);
    }
  },

  async sendMedia(type, file) {
    const chat = window.chatApp.currentChat;
    if (!chat) return;

    try {
      const storageRef = ref(storage, `chat_media/${chat.id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const myUser = await getDoc(doc(this.db, 'users', this.user.uid));
      const myData = myUser.data() || {};

      const message = {
        senderId: this.user.uid,
        senderName: myData.hashHandle || 'Anonymous',
        senderPic: myData.profilePicUrl || '',
        messageType: type,
        mediaUrl: url,
        content: file.name,
        timestamp: Timestamp.now(),
        readBy: [this.user.uid]
      };

      if (chat.type === 'dm') {
        message.otherUserId = chat.otherUid;
        await addDoc(collection(this.db, 'dms', chat.id, 'messages'), message);
      } else {
        await addDoc(collection(this.db, chat.kennelPath, 'chat_groups', 'default', 'messages'), message);
      }
    } catch (error) {
      console.error('Error sending media:', error);
    }
  },

  async sendPushNotification(toUid, fromName, messageText, dmId, msgId) {
    try {
      const userDoc = await getDoc(doc(this.db, 'users', toUid));
      const fcmToken = userDoc.data()?.fcmToken;
      if (!fcmToken) return;

      const sendNotification = httpsCallable(functions, 'sendChatNotification');
      await sendNotification({
        token: fcmToken,
        title: fromName,
        body: messageText,
        data: { dmId, msgId, type: 'dm' }
      });
    } catch (e) {
      console.error('Push notification failed:', e);
    }
  },

  setReply(msg) {
    const preview = document.getElementById('reply-preview');
    const senderSpan = document.getElementById('reply-sender');
    const textDiv = document.getElementById('reply-text');
    
    if (!preview || !senderSpan || !textDiv) return;
    
    this.replyTo = msg;
    senderSpan.textContent = msg.senderName || 'Unknown';
    
    // Truncate text for preview
    let previewText = msg.content || '';
    if (msg.messageType === 'image') previewText = '📷 Photo';
    else if (msg.messageType === 'video') previewText = '🎥 Video';
    else if (msg.messageType === 'audio' || msg.messageType === 'voice') previewText = '🎵 Audio';
    else if (msg.messageType === 'file') previewText = '📄 File';
    else if (msg.messageType === 'sticker') previewText = '😀 Sticker';
    
    textDiv.textContent = previewText.length > 50 ? previewText.substring(0, 50) + '...' : previewText;
    preview.classList.add('show');
    
    // Focus input
    const input = document.getElementById('message-input');
    if (input) input.focus();
  },

   clearReply() {
    this.replyTo = null;
    const preview = document.getElementById('reply-preview');
    if (preview) preview.classList.remove('show');
  },

};

export { messages };
window.messages = messages;