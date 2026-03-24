import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  setDoc,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
// Foreground message handler for web
export function setupForegroundMessageHandler(onMessageReceived) {
  if (isCapacitor || !messaging) return;
  
  import("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js").then(({ onMessage }) => {
    onMessage(messaging, (payload) => {
      console.log('Foreground message received:', payload);
      if (onMessageReceived) onMessageReceived(payload);
    });
  });
}

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

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// NEW: Initialize Firestore with persistence settings
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const storage = getStorage(app);
export const functions = getFunctions(app);

// Messaging placeholder - will be set for web only
let messaging = null;
export { messaging };

const VAPID_KEY = 'BA4bUSJysI9xYMg-QqkQPbXWX5DGUn7oq_TP8dmOJ0QM6IiI18EgPoDuethvV-bUAhsv6ILBXkF1rsYSwUJ2I7k';

// ==================== CAPACITOR PUSH NOTIFICATIONS ====================

export async function initCapacitorPushNotifications(userId) {
  if (!isCapacitor) {
    console.log('Not in Capacitor, skipping native push');
    return null;
  }

  const PN = window.Capacitor?.Plugins?.PushNotifications;
  
  if (!PN) {
    console.log('PushNotifications plugin not found');
    return null;
  }

  try {
    const result = await PN.requestPermissions();
    if (result.receive !== 'granted') {
      console.log('Push permission denied');
      return null;
    }

    await PN.register();

    PN.addListener('registration', async (token) => {
      console.log('FCM Token:', token.value);
      if (userId) {
        await setDoc(doc(db, 'users', userId), { 
          fcmToken: token.value,
          platform: 'capacitor_android'
        }, { merge: true });
      }
    });

    PN.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });

    return true;
  } catch (error) {
    console.error('Push setup error:', error);
    return null;
  }
}

// ==================== WEB PUSH NOTIFICATIONS ====================

export async function initWebPushNotifications(userId) {
  if (isCapacitor) {
    console.log('In Capacitor, use native push instead');
    return null;
  }

  // Lazy load messaging for web
  if (!('serviceWorker' in navigator)) {
    console.log('Service workers not supported');
    return null;
  }

  try {
    const { getMessaging, getToken, onMessage } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js");
    
    // Initialize messaging
    const msg = getMessaging(app);
    
    const registration = await navigator.serviceWorker.register('/js/screens/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const token = await getToken(msg, { 
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token && userId) {
      await setDoc(doc(db, 'users', userId), { 
        fcmToken: token,
        platform: 'web'
      }, { merge: true });
    }

    onMessage(msg, (payload) => {
      console.log('Foreground message:', payload);
    });

    // Export for other uses
    messaging = msg;
    
    return token;
  } catch (error) {
    console.error('Web push error:', error);
    return null;
  }
}



// ==================== AUTH STATE ====================

onAuthStateChanged(auth, async (user) => {
  const currentPage = window.location.pathname.split('/').pop();
  const publicPages = ['login.html', 'signup.html', ''];
  
  // NOT logged in + on protected page → send to login
  if (!user && !publicPages.includes(currentPage)) {
    window.location.href = 'login.html';
    return;
  }
  
  // LOGGED IN + on public page → send to home
  if (user && publicPages.includes(currentPage)) {
    window.location.href = 'index.html';
    return;
  }
  
  // Init push notifications based on platform
  if (user) {
    setTimeout(async () => {
      if (isCapacitor) {
        await initCapacitorPushNotifications(user.uid);
      } else {
        await initWebPushNotifications(user.uid);
      }
    }, 2000);
    
    if (window.chatApp && currentPage === 'chat.html') {
      window.chatApp.init(user);
    }
  }
});