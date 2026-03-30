import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  setDoc,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js ";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js ";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js ";

// Capacitor detection
const isCapacitor = typeof window !== 'undefined' && 
  (window.Capacitor !== undefined || 
   (typeof navigator !== 'undefined' && navigator.userAgent.includes('Capacitor')));

console.log('Is Capacitor:', isCapacitor);

const firebaseConfig = {
  apiKey: "AIzaSyBhhU-vo9qmMKETOdjgz24JrsRv-rojUBc",
  authDomain: "h3-global-app.firebaseapp.com",
  projectId: "h3-global-app",
  storageBucket: "h3-global-app.firebasestorage.app",
  messagingSenderId: "174897234240",
  appId: "1:174897234240:web:74612994c432f410843aa5"
};

const GOOGLE_MAPS_API_KEY = "AIzaSyBsY_c16HNeFgfvDIuVhpICAfFX8evggYI";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore setup
let db;
try {
  db = getFirestore(app);
  console.log('Firestore: Using existing instance');
} catch (e) {
  console.log('Firestore: Initializing with persistence');
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
}

export { db, GOOGLE_MAPS_API_KEY };
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Messaging - will be set for web
let messaging = null;
export { messaging };

const VAPID_KEY = 'BA4bUSJysI9xYMg-QqkQPbXWX5DGUn7oq_TP8dmOJ0QM6IiI18EgPoDuethvV-bUAhsv6ILBXkF1rsYSwUJ2I7k';

// ==================== CAPACITOR PUSH ====================
export async function initCapacitorPushNotifications(userId) {
  if (!isCapacitor) return null;
  const PN = window.Capacitor?.Plugins?.PushNotifications;
  if (!PN) return null;

  try {
    const result = await PN.requestPermissions();
    if (result.receive !== 'granted') return null;

    await PN.register();
    PN.addListener('registration', async (token) => {
      if (userId) {
        await setDoc(doc(db, 'users', userId), { 
          fcmToken: token.value,
          platform: 'capacitor_android'
        }, { merge: true });
      }
    });

    return true;
  } catch (error) {
    console.error('Push setup error:', error);
    return null;
  }
}

// ==================== WEB PUSH (FIXED) ====================
export async function initWebPushNotifications(userId) {
  if (isCapacitor) return null;
  if (!('serviceWorker' in navigator)) return null;

  try {
    const { getMessaging, getToken, onMessage } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js ");
    
    const msg = getMessaging(app);
    messaging = msg; // Set the exported variable
    
    // Register service worker
    await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const token = await getToken(msg, { 
      vapidKey: VAPID_KEY
    });

    if (token && userId) {
      await setDoc(doc(db, 'users', userId), { 
        fcmToken: token,
        platform: 'web'
      }, { merge: true });
      console.log('Web FCM token saved:', token);
    }

    // Setup foreground handler here
    onMessage(msg, (payload) => {
      console.log('Foreground message in config:', payload);
      // Dispatch custom event for chat-app.js to catch
      window.dispatchEvent(new CustomEvent('fcm-message', { detail: payload }));
    });

    return token;
  }  catch (error) {
    return null;
  }
}

// ==================== AUTH STATE ====================
// ==================== AUTH STATE ====================
onAuthStateChanged(auth, async (user) => {
  const currentPage = window.location.pathname.split('/').pop();
  const publicPages = ['login.html', 'signup.html', 'verify-otp.html',''];
  
  // DEBUG: Don't redirect if debug flag is set
  if (window.DEBUG_BLOCK_REDIRECT || sessionStorage.getItem('DEBUG_BLOCK_REDIRECT')) {
    console.log('[DEBUG] Auth redirect blocked - DEBUG_BLOCK_REDIRECT is active');
    console.log('[DEBUG] User:', user?.uid);
    console.log('[DEBUG] Current page:', currentPage);
    return;
  }
  
  if (!user && !publicPages.includes(currentPage)) {
    window.location.href = 'login.html';
    return;
  }
  
  if (user && publicPages.includes(currentPage)) {
    window.location.href = 'index.html';
    return;
  }
  
  if (user) {
    setTimeout(async () => {
      if (isCapacitor) {
        await initCapacitorPushNotifications(user.uid);
      } else {
        await initWebPushNotifications(user.uid);
      }
    }, 1000);
    
    if (window.chatApp && currentPage === 'chat.html') {
      window.chatApp.init(user);
    }
  }
});

// Make available globally for pages that need them
window.auth = auth;
window.functions = functions;
window.db = db;
