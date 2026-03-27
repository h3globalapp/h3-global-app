// ==========================================
// BADGE UPDATE HANDLER - Add at very top of file
// ==========================================

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'UPDATE_BADGE') {
    // Update app icon badge
    const count = event.data.count;
    
    // Use Badging API if available
    if ('setAppBadge' in self) {
      if (count > 0) {
        self.setAppBadge(count).catch(e => console.log('SW badge error:', e));
      } else {
        self.clearAppBadge().catch(e => console.log('SW badge error:', e));
      }
    }
  }
});

const CACHE_NAME = 'h3-chat-v5'; // Bumped from your v4

const urlsToCache = [
  './',
  './index.html',
  './chat.html',
  './runs.html',
  './events.html',
  './songs.html',
  './trail.html',
  './personal.html',
  './business-hub.html',
  './login.html',
  './signup.html',
 // './paywall.html',
  './css/base.css',
 './icons/ic_chat.png',
  './icon-192x192.png',
  './icon-512x512.png'
];

// ==================== CORE SERVICE WORKER ====================

self.addEventListener('install', event => {
  console.log('SW: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('SW: Caching files');
        return Promise.all(
          urlsToCache.map(url => 
            fetch(url).then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
              console.log('SW: Failed to cache', url);
            }).catch(err => {
              console.log('SW: Error caching', url, err);
            })
          )
        );
      })
      .then(() => {
        console.log('SW: Skip waiting');
        self.skipWaiting();
      })
  );
});

self.addEventListener('activate', event => {
  console.log('SW: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // SKIP Firebase/Firestore/Google requests - let browser handle natively
  if (url.hostname.includes('firebase') || 
      url.hostname.includes('googleapis') ||
      url.hostname.includes('google')) {
    return; // Don't intercept at all
  }
  
  // Handle all other requests
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) return response;
        return fetch(event.request).catch(err => {
          console.log('SW fetch failed:', event.request.url, err);
          throw err;
        });
      })
  );
});

// ==================== FIREBASE MESSAGING (WEB ONLY) ====================

const isCapacitor = typeof self !== 'undefined' && 
  (self.location.protocol === 'capacitor:' || 
   self.location.hostname === 'localhost' && /Capacitor/.test(navigator.userAgent));

if (!isCapacitor) {
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

    firebase.initializeApp({
      apiKey: "AIzaSyBhhU-vo9qmMKETOdjgz24JrsRv-rojUBc",
      authDomain: "h3-global-app.firebaseapp.com",
      projectId: "h3-global-app",
      storageBucket: "h3-global-app.firebasestorage.app",
      messagingSenderId: "174897234240",
      appId: "1:174897234240:web:74612994c432f410843aa5"
    });

    const messaging = firebase.messaging();

    // ==================== BACKGROUND MESSAGE HANDLER WITH SOUND ====================
    messaging.onBackgroundMessage((payload) => {
      console.log('SW: Background message received:', payload);
      
      const notificationTitle = payload.notification?.title || 'New Message';
      
      // CRITICAL: These options enable sound and vibration
      const notificationOptions = {
        body: payload.notification?.body || 'You have a new message',
        icon: './icons/ic_chat.png',
        badge: './icons/ic_chat.png',
        tag: payload.data?.dmId || payload.data?.kennelId || 'chat-message',
        data: { 
          url: payload.data?.url || './chat.html',
          dmId: payload.data?.dmId,
          kennelId: payload.data?.kennelId,
          type: payload.data?.type || 'dm'
        },
        // ==================== SOUND CONFIGURATION ====================
        // These properties enable device sound
        silent: false,                    // false = allow sound
        requireInteraction: false,        // Auto-dismiss after a while
        vibrate: [200, 100, 200],        // Vibration pattern (ms)
        // Android specific
        actions: [
          {
            action: 'open',
            title: 'Open'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ]
      };

      // Show notification with sound
      const notificationPromise = self.registration.showNotification(
        notificationTitle, 
        notificationOptions
      );

      // Attempt to play sound via Audio API (for browsers that support it in SW)
      // Note: Service Workers have limited audio support, so we rely mainly on 
      // the notification system's default sound via silent: false
      
      return notificationPromise;
    });

    console.log('SW: Firebase Messaging initialized with sound support');

  } catch (error) {
    console.log('SW: Firebase Messaging not available', error);
  }
} else {
  console.log('SW: Running in Capacitor - skipping Firebase Messaging');
}

// ==================== NOTIFICATION CLICK HANDLING ====================

self.addEventListener('notificationclick', event => {
  console.log('SW: Notification clicked', event);
  event.notification.close();
  
  const url = event.notification.data?.url || './chat.html';
  const dmId = event.notification.data?.dmId;
  const kennelId = event.notification.data?.kennelId;
  
  // Build target URL with parameters
  let targetUrl = url;
  if (dmId) targetUrl += `?dm=${dmId}`;
  if (kennelId) targetUrl += `${dmId ? '&' : '?'}kennel=${kennelId}`;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Try to focus existing window
        for (const client of clientList) {
          if (client.url.includes('/chat.html') && 'focus' in client) {
            // Post message to client to navigate to specific chat
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              dmId: dmId,
              kennelId: kennelId
            });
            return client.focus();
          }
        }
        // Open new window if none exists
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      })
  );
});

// ==================== PUSH EVENT (Fallback for non-FCM) ====================
// This handles standard Web Push if FCM isn't available

self.addEventListener('push', event => {
  console.log('SW: Push event received', event);
  
  if (!event.data) return;
  
  try {
    const payload = event.data.json();
    
    const title = payload.title || 'New Message';
    const options = {
      body: payload.body || 'You have a new message',
      icon: './icons/ic_chat.png',
      badge: './icons/ic_chat.png',
      tag: payload.tag || 'push-message',
      data: payload.data || {},
      silent: false,
      vibrate: [200, 100, 200],
      requireInteraction: false
    };
    
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (e) {
    // If not JSON, show generic notification
    event.waitUntil(
      self.registration.showNotification('New Message', {
        body: event.data.text(),
        icon: './icons/ic_chat.png',
        silent: false,
        vibrate: [200, 100, 200]
      })
    );
  }
});

// ==========================================
// CLIENT CONTROL HANDLING
// ==========================================

self.addEventListener('message', (event) => {
  // Handle claim control request
  if (event.data?.type === 'CLAIM_CONTROL') {
    self.clients.claim();
    console.log('SW: Claimed control of clients');
  }
});
