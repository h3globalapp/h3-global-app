import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from '../firebase-config.js';

/* ---------- VOICE NAVIGATION ---------- */
class VoiceNavigator {
  constructor() {
    this.enabled = localStorage.getItem('voice_nav_enabled') !== 'false';
    this.queue = [];
    this.speaking = false;
    this.lastAnnouncement = '';
    this.announcementCooldown = 5000;
    this.lastAnnouncementTime = 0;
    this.nativeTTS = null;
    this.synth = null;
    
    console.log('=== VOICE NAV INIT ===');
    this.initTTS();
  }
  
   async initTTS() {
    // Check for community TTS plugin (without optional chaining)
    var capacitor = window.Capacitor;
    var plugins = capacitor && capacitor.Plugins;
    var tts = plugins && plugins.TextToSpeech;
    
    if (tts) {
      this.nativeTTS = tts;
      console.log('Community TTS plugin found');
      return;
    }
    
    // Fallback to Web Speech
    if ('speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      console.log('Web Speech API available');
    } else {
      console.error('No TTS available');
    }
  }
    
    enable() {
    this.enabled = true;
    localStorage.setItem('voice_nav_enabled', 'true');
  }

  disable() {
    this.enabled = false;
    if (this.nativeTTS) {
      try { this.nativeTTS.stop(); } catch(e) {}
    } else if (this.synth) {
      this.synth.cancel();
    }
    localStorage.setItem('voice_nav_enabled', 'false');
  }

  toggle() {
    this.enabled ? this.disable() : this.enable();
    return this.enabled;
  }

  async speak(text, priority = 'normal') {
    console.log('=== SPEAK CALLED ===');
    console.log('text:', text, 'enabled:', this.enabled);
    console.log('nativeTTS:', !!this.nativeTTS, 'synth:', !!this.synth);

    if (!this.enabled) {
      console.log('SPEAK BLOCKED: not enabled');
      return;
    }

    // Avoid duplicate announcements within cooldown
    const now = Date.now();
    if (text === this.lastAnnouncement && (now - this.lastAnnouncementTime) < this.announcementCooldown) {
      console.log('SPEAK BLOCKED: duplicate within cooldown');
      return;
    }

    // High priority cancels current speech
    if (priority === 'high') {
      if (this.nativeTTS) {
        try { await this.nativeTTS.stop(); } catch(e) {}
      } else if (this.synth) {
        this.synth.cancel();
      }
      this.queue = [];
    }

    this.queue.push({ text, priority });
    await this.processQueue();
  }

  async processQueue() {
    console.log('=== PROCESS QUEUE ===', 'speaking:', this.speaking, 'queue:', this.queue.length);
    
    if (this.speaking || !this.queue.length) return;

    const item = this.queue.shift();
    
    try {
      this.speaking = true;
      this.lastAnnouncement = item.text;
      this.lastAnnouncementTime = Date.now();
      
      if (this.nativeTTS) {
        // Use native Capacitor TTS
        console.log('Using native TTS for:', item.text);
        await this.nativeTTS.speak({
          text: item.text,
          lang: 'en-US',
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'ambient'
        });
        console.log('Native TTS completed');
        
      } else if (this.synth) {
        // Use Web Speech API
        console.log('Using web TTS for:', item.text);
        await this.speakWeb(item.text);
        
      } else {
        console.error('No TTS method available');
        // Try to re-initialize as last resort
        await this.initTTS();
        if (this.nativeTTS || this.synth) {
          console.log('Re-initialized TTS, retrying...');
          this.queue.unshift(item);
        }
      }
      
    } catch (e) {
      console.error('TTS error:', e);
    } finally {
      this.speaking = false;
      setTimeout(() => this.processQueue(), 100);
    }
  }

  speakWeb(text) {
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      
      // Force voices to load on Android
      let voices = this.synth.getVoices();
      if (!voices.length) {
        // Voices not loaded yet, wait
        this.synth.onvoiceschanged = () => {
          voices = this.synth.getVoices();
          const enVoice = voices.find(v => v.lang && v.lang.startsWith('en'));
          if (enVoice) utterance.voice = enVoice;
        };
      } else {
        const enVoice = voices.find(v => v.lang && v.lang.startsWith('en'));
        if (enVoice) utterance.voice = enVoice;
      }

      utterance.onend = () => {
        console.log('Web TTS completed');
        resolve();
      };
      utterance.onerror = (e) => {
        console.error('Web TTS error:', e.error || e);
        reject(e);
      };

      this.synth.speak(utterance);
      
      // Android sometimes needs this hack to start speaking
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        setInterval(() => {
          if (this.synth.paused) this.synth.resume();
        }, 100);
      }
    });
  }

  // Navigation-specific announcements
  announceNavigationStart(mode) {
    const modeText = mode === 'DRIVING' ? 'driving' : mode === 'WALKING' ? 'walking' : 'joining pack';
    this.speak(`Starting ${modeText} navigation.`, 'high');
  }

  announceArrival() {
    this.speak('You have arrived at your destination. Navigation complete.', 'high');
  }

  announceReroute(reason) {
    this.speak(`Re-routing. ${reason || 'Finding new route.'}`, 'high');
  }

  announceOffRoute(minutes) {
    this.speak(`You are approximately ${Math.round(minutes)} minutes off route.`, 'normal');
  }

  announcePackUpdate(distance) {
    const distText = distance < 1000 ? `${Math.round(distance)} meters` : `${(distance/1000).toFixed(1)} kilometers`;
    this.speak(`Pack is ${distText} ahead.`, 'normal');
  }

  announceTrailStart() {
    this.speak('Trail started. Hare tracking active.', 'high');
  }

  announceTrailEnd() {
    this.speak('Trail end reached. Trail saved.', 'high');
  }

  announceTrackingStart() {
    this.speak('Tracking started. On on!', 'high');
  }

  announceTrackingStop() {
    this.speak('Tracking stopped.', 'normal');
  }
}


const voiceNav = new VoiceNavigator();


/* ---------- Screen Modes ---------- */
const ScreenMode = { IDLE: 0, NAVIGATING: 1, SET_TRAIL: 2, TRACKING: 3 };
let currentMode = ScreenMode.IDLE;

/* ---------- Navigation Constants ---------- */
const REROUTE_THRESHOLD_MINUTES = {
  DRIVING: 5,
  WALKING: 10,
  JOIN_PACK: 5
};

const STOP_NAVIGATION_MINUTES = {
  DRIVING: 30,
  WALKING: 20,
  JOIN_PACK: 20
};

/* ---------- Global State ---------- */
let map, runId, kennelId, currentState, fromRunsActivity = false;
let runLocation = null;
let isHare = false;
let mapReady = false;
let selectedNavMode = null; // 'DRIVING' or 'WALKING'

// Navigation state
let navActive = false;
let navDestination = null;
let navMode = null; // 'DRIVING', 'WALKING', 'JOIN_PACK'
let navStartTime = 0;
let lastNavOrigin = null;
let navWatchId = null;
let navTimeoutId = null;
let directionsRenderer = null;
let directionsService = null;

// Set Trail state (hare)
let trackingHare = false;
let hareStartTime = 0;
let hareDistance = 0;
let lastHareLocation = null;
let hareWatchId = null;
const hareTrailPoints = [];
let harePolyline = null;
let startMarker = null;
let endMarker = null;

// Tracking state (user)
let tracking = false;
let startTimeMillis = 0;
let totalDistance = 0;
let lastLocation = null;
let trailWatchId = null;
const trailPoints = [];
let polyline = null;

// Pack locations
let packListener = null;
const packMarkers = {};
let packClusterMarker = null;

// Keep screen on
let keepScreenOn = false;
let sourceType = 'unknown';

/* ---------- DOM Cache ---------- */
const els = {
  imageProfile: document.getElementById('imageProfile'),
  tvHeaderTitle: document.getElementById('tvHeaderTitle'),
  map: document.getElementById('map'),
  trackingCard: document.getElementById('trackingCard'),
  tvTrackingStats: document.getElementById('tvTrackingStats'),
  btnJoinPack: document.getElementById('btnJoinPack'),
  btnSetTrail: document.getElementById('btnSetTrail'),
  btnStartTracking: document.getElementById('btnStartTracking'),
  bottomNav: document.getElementById('bottomNavigationCard')
};

/* ---------- Entry ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const url = new URLSearchParams(location.search);

  runId = url.get('runId') || url.get('eventId') || localStorage.getItem('currentRunId');
  
  const destLat = parseFloat(url.get('destination_lat'));
  const destLng = parseFloat(url.get('destination_lng'));

  if (!isNaN(destLat) && !isNaN(destLng)) {
    runLocation = { lat: destLat, lng: destLng };
  }

  kennelId = url.get('kennelId');
  currentState = url.get('currentState');
  fromRunsActivity = url.get('fromRunsActivity') === 'true';

  els.btnJoinPack.onclick = () => handleJoinPack();
  els.btnSetTrail.onclick = () => handleSetTrail();
  els.btnStartTracking.onclick = () => handleStartTracking();

  onAuthStateChanged(auth, user => {
    if (!user) { location.href = 'login.html'; return; }
    fetchUserDetails();
    initMap();
  });
  
  });

/* ---------- Map Init ---------- */
window.initMap = () => {
  map = new google.maps.Map(els.map, {
    zoom: 15,
    center: { lat: 9.082, lng: 8.6753 },
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });
  mapReady = true;

  window._realInitMap = () => {
    loadEventOrRun(() => {
      if (fromRunsActivity && runLocation) {
        showNavModeDialog(); // Show Driving/Walking selection first
      } else {
        listenForPackLocations();
      }
    });
  };
  
    
  // Add voice toggle button to map
  const voiceToggleDiv = document.createElement('div');
  voiceToggleDiv.style.cssText = `
    margin: 10px;
    padding: 8px 12px;
    background: ${voiceNav.enabled ? '#4CAF50' : '#666'};
    color: white;
    border-radius: 20px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    z-index: 1000;
  `;
  voiceToggleDiv.textContent = voiceNav.enabled ? '🔊 Voice On' : '🔇 Voice Off';
  voiceToggleDiv.onclick = () => {
    const enabled = voiceNav.toggle();
    voiceToggleDiv.style.background = enabled ? '#4CAF50' : '#666';
    voiceToggleDiv.textContent = enabled ? '🔊 Voice On' : '🔇 Voice Off';
    voiceNav.speak(enabled ? 'Voice navigation enabled.' : 'Voice navigation disabled.', 'high');
  };
  
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(voiceToggleDiv);
  
  if (window.google && window.google.maps) {
    window._realInitMap();
  }
};

/* ---------- Navigation Mode Dialog ---------- */
function showNavModeDialog() {
  // Create overlay instead of dialog for better control
  const overlay = document.createElement('div');
  overlay.style.cssText = `
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
    font-family: system-ui, sans-serif;
  `;
  
  overlay.innerHTML = `
    <div style="
      background: white;
      border-radius: 28px;
      padding: 24px;
      min-width: 280px;
      max-width: 320px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    ">
      <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">Choose Navigation Mode</h2>
      <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">How are you getting to the run?</p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="btnDriving" style="
          padding: 16px;
          border: 2px solid #2196F3;
          border-radius: 12px;
          background: #fff;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 12px;
        ">
          <span style="font-size: 24px;">🚗</span>
          <div style="text-align: left;">
            <div>Driving</div>
            <div style="font-size: 12px; color: #666; font-weight: normal;">Blue route, 5 min re-route</div>
          </div>
        </button>
        <button id="btnWalking" style="
          padding: 16px;
          border: 2px solid #FF8C00;
          border-radius: 12px;
          background: #fff;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 12px;
        ">
          <span style="font-size: 24px;">🚶</span>
          <div style="text-align: left;">
            <div>Walking</div>
            <div style="font-size: 12px; color: #666; font-weight: normal;">Orange dotted, 10 min re-route</div>
          </div>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Simple click handlers - remove immediately
  overlay.querySelector('#btnDriving').onclick = () => {
    selectedNavMode = 'DRIVING';
    overlay.remove(); // Remove immediately
    startNavigationToRun();
  };
  
  overlay.querySelector('#btnWalking').onclick = () => {
    selectedNavMode = 'WALKING';
    overlay.remove(); // Remove immediately
    startNavigationToRun();
  };
  
  // Close on background click
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  };
}

/* ---------- Load Event or Run ---------- */
const loadEventOrRun = async (onLoaded) => {
  if (!runId) return onLoaded?.();

  try {
    const eventSnap = await getDoc(doc(db, 'events', runId));
    if (eventSnap.exists()) {
      sourceType = 'event';
      const eventData = eventSnap.data();
      if (!runLocation && eventData.lat && eventData.lng) {
        runLocation = { lat: eventData.lat, lng: eventData.lng };
      }
      kennelId = eventData.kennel || kennelId;
      currentState = eventData.state || currentState;
      const uid = auth.currentUser.uid;
      isHare = eventData.createdBy === uid;
      onLoaded?.();
      return;
    }
  } catch (e) { console.log('Not found in events'); }

  try {
    const runSnap = await getDoc(doc(db, 'runs', runId));
    if (runSnap.exists()) {
      sourceType = 'run';
      const runData = runSnap.data();
      if (!runLocation && runData.lat && runData.lng && (runData.lat !== 0 || runData.lng !== 0)) {
        runLocation = { lat: runData.lat, lng: runData.lng };
      }
      const uid = auth.currentUser.uid;
      const hareUid = runData.hareUid;
      const hareName = runData.hare;
      const currentName = auth.currentUser.displayName;
      isHare = (hareUid && hareUid === uid) || (hareName && hareName === currentName);
      onLoaded?.();
      return;
    }
  } catch (e) { console.log('Not found in runs'); }

  console.error('Could not find event or run:', runId);
  onLoaded?.();
};

/* ---------- Navigation to Run Location ---------- */
const startNavigationToRun = () => {
  if (!runLocation) return Toast.makeText('No destination set');
  
  getCurrentLocation(pos => {
    map.setCenter(pos);
    map.setZoom(17);
    startRealtimeNavTo(runLocation, selectedNavMode);
  });
};

const startRealtimeNavTo = (dest, mode) => {
	 // ADD THIS LOG
  console.log('=== START NAV ===');
  console.log('mode:', mode, 'dest:', dest);
  if (currentMode === ScreenMode.SET_TRAIL) {
    if (!confirm('Stop setting trail? Unsaved trail will be lost.')) return;
    stopHareTracking();
    clearAllMapObjects();
  }

  if (currentMode === ScreenMode.TRACKING) {
    // Tracking can run parallel, no need to stop
  }

  setKeepScreenOn(true);
  clearAllMapObjects();
  
  currentMode = ScreenMode.NAVIGATING;
  navActive = true;
  navDestination = dest;
  navMode = mode;
  navStartTime = Date.now();
  lastNavOrigin = null;
  voiceNav.announceNavigationStart(mode);
    console.log('Called announceNavigationStart');

  getCurrentLocation(pos => {
    lastNavOrigin = pos;
    drawRoute(pos, dest, mode);
    
    if (navWatchId) navigator.geolocation.clearWatch(navWatchId);
    navWatchId = navigator.geolocation.watchPosition(
      p => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        map.setCenter(here);
        
        // Check if too far off route (time-based)
        checkOffRoute(here, dest, mode);
        
        // Re-route if needed
        const timeOffRoute = calculateTimeOffRoute(here, dest);
        const threshold = mode === 'DRIVING' ? REROUTE_THRESHOLD_MINUTES.DRIVING : REROUTE_THRESHOLD_MINUTES.WALKING;
        
        if (timeOffRoute > threshold) {
          lastNavOrigin = here;
          drawRoute(here, dest, mode);
        }
        
        checkArrival(dest);
      },
      e => console.warn('Nav watch error:', e),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
    );
  });

  Toast.makeText(`Starting ${mode.toLowerCase()} navigation…`);
};

/* ---------- Route Drawing ---------- */
const drawRoute = (origin, dest, mode) => {
  if (!directionsService) directionsService = new google.maps.DirectionsService();
  
  // Always create fresh renderer to ensure styles apply
  if (directionsRenderer) {
    directionsRenderer.setMap(null);
  }
  
  const isDotted = mode === 'WALKING';
  const color = mode === 'DRIVING' ? '#0000FF' : '#FF8C00';
  
  directionsRenderer = new google.maps.DirectionsRenderer({
    map: map,
    suppressMarkers: true,
    preserveViewport: true,
    polylineOptions: {
      strokeColor: color,
      strokeOpacity: 1,
      strokeWeight: isDotted ? 10 : 12,
      icons: isDotted ? [{
        icon: {
          path: 'M 0,-1 0,1',
          strokeOpacity: 1,
          scale: 3
        },
        offset: '0',
        repeat: '15px'
      }] : []
    }
  });

  const request = {
    origin: origin,
    destination: dest,
    travelMode: mode === 'DRIVING' ? google.maps.TravelMode.DRIVING : google.maps.TravelMode.WALKING
  };

  directionsService.route(request, (result, status) => {
    if (status === google.maps.DirectionsStatus.OK) {
      directionsRenderer.setDirections(result);
      // Announce route info
      if (result.routes && result.routes[0] && result.routes[0].legs[0]) {
        const leg = result.routes[0].legs[0];
        const duration = Math.round(leg.duration.value / 60);
        const distance = (leg.distance.value / 1000).toFixed(1);
        voiceNav.speak(`Route found. ${distance} kilometers, approximately ${duration} minutes.`, 'normal');
      }
    } else {
      voiceNav.announceReroute('Route calculation failed. Using direct line.');
      drawFallbackRoute(origin, dest, color, isDotted);
    }
  });
};

const drawFallbackRoute = (origin, dest, color, isDotted) => {
  if (directionsRenderer) {
    directionsRenderer.setMap(null);
    directionsRenderer = null;
  }
  
  const path = [origin, dest];
  const polyline = new google.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: color,
    strokeOpacity: 1,
    strokeWeight: isDotted ? 10 : 12,
    icons: isDotted ? [{
      icon: { 
        path: 'M 0,-1 0,1', 
        strokeOpacity: 1, 
        scale: 3 
      },
      offset: '0',
      repeat: '15px'
    }] : []
  });
  polyline.setMap(map);
};

/* ---------- Join Pack Navigation ---------- */
const handleJoinPack = () => {
  // Check if navigation already active
  if (navActive) {
    if (!confirm('Stop current navigation and join pack?')) return;
    stopRealtimeNav();
    clearAllMapObjects();
  }

  if (currentMode === ScreenMode.SET_TRAIL) {
    if (!confirm('Stop setting trail? Unsaved trail will be lost.')) return;
    stopHareTracking();
    clearAllMapObjects();
  }

  navigateToPackCluster();
};

const navigateToPackCluster = async () => {
  if (!runId) return Toast.makeText('No run selected');

  let joinedRef = sourceType === 'event'
    ? collection(db, 'events', runId, 'joined')
    : collection(db, 'runs', runId, 'joined');

  const joinedSnap = await getDocs(joinedRef);
  const uids = joinedSnap.docs.map(d => d.id);

  if (!uids.length) return Toast.makeText('No joined users yet');

  const unsub = onSnapshot(collection(db, 'pack_locations'), async snap => {
    const points = snap.docs
      .filter(d => uids.includes(d.id))
      .map(d => ({ lat: d.data().lat, lng: d.data().lng }));

    if (!points.length) return Toast.makeText('No live positions yet');
    const center = averageLatLng(points);

    if (packClusterMarker) packClusterMarker.setMap(null);
    packClusterMarker = new google.maps.Marker({ 
      position: center, 
      map, 
      title: 'Pack',
      icon: { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png' }
    });

    getCurrentLocation(user => {
      startJoinPackNavigation(user, center);
    });
  });

  packListener = unsub;
};

const startJoinPackNavigation = (origin, dest) => {
  setKeepScreenOn(true);
  clearAllMapObjects();
  
  currentMode = ScreenMode.NAVIGATING;
  navActive = true;
  navDestination = dest;
  navMode = 'JOIN_PACK';
  navStartTime = Date.now();
  lastNavOrigin = origin;
  voiceNav.announceNavigationStart('JOIN_PACK');

  // Green dotted line for join pack
  const polyline = new google.maps.Polyline({
    path: [origin, dest],
    geodesic: true,
    strokeColor: '#00FF00',
    strokeOpacity: 1,
    strokeWeight: 10,
    icons: [{
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
      offset: '0',
      repeat: '15px'
    }]
  });
  polyline.setMap(map);

  if (navWatchId) navigator.geolocation.clearWatch(navWatchId);
  navWatchId = navigator.geolocation.watchPosition(
    p => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      map.setCenter(here);
      
      // Update polyline
      polyline.setPath([here, dest]);
      
      // Check re-route (5 min threshold) and stop (20 min)
      checkOffRoute(here, dest, 'JOIN_PACK');
      
      const timeOffRoute = calculateTimeOffRoute(here, dest);
      if (timeOffRoute > REROUTE_THRESHOLD_MINUTES.JOIN_PACK) {
        // Re-center to pack
        const newCenter = averageLatLng([here, dest]);
        packClusterMarker.setPosition(newCenter);
        polyline.setPath([here, newCenter]);
      }
    },
    e => console.warn('Join pack watch error:', e),
    { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
  );

  Toast.makeText('Navigating to pack…');
};

  
  // Add periodic pack distance announcements
  const packUpdateInterval = setInterval(() => {
    if (!navActive || navMode !== 'JOIN_PACK') {
      clearInterval(packUpdateInterval);
      return;
    }
    
    navigator.geolocation.getCurrentPosition(p => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      const distance = haversine(here, dest);
      if (distance > 50) { // Only announce if not arrived
        voiceNav.announcePackUpdate(distance);
      }
    });
  }, 30000); // Every 30 seconds

/* ---------- Set Trail (Hare) ---------- */
const handleSetTrail = () => {
  // Must stop any navigation first
  if (navActive) {
    if (!confirm('Stop navigation to set trail?')) return;
    stopRealtimeNav();
    clearAllMapObjects();
  }

  // Must stop tracking first (shared display)
  if (tracking) {
    if (!confirm('Stop tracking to set trail?')) return;
    stopUserTrailMode();
    clearAllMapObjects();
  }

  checkHareJoinedBeforeSetTrail();
};

function checkHareJoinedBeforeSetTrail() {
  const historyId = runId;
  if (!historyId) {
    Toast.makeText('No run selected');
    return;
  }
  
  const uid = auth.currentUser?.uid;
  if (!uid) {
    Toast.makeText('Not logged in');
    return;
  }

  const joinedRef = doc(db, 'runsHistory', historyId, 'joined', uid);
  
  getDoc(joinedRef).then(joinedDoc => {
    if (!joinedDoc.exists()) {
      Toast.makeText('You must join the run before setting a trail');
      return;
    }

    return getDoc(doc(db, 'users', uid));
  }).then(userDoc => {
    if (!userDoc) return;
    
    const userData = userDoc.data();
    const myHandle = userData?.hashHandle?.trim() || '';
    
    if (!myHandle) {
      Toast.makeText('No hash handle found for your account');
      return;
    }

    return getDoc(doc(db, 'runsHistory', historyId)).then(histDoc => ({ histDoc, myHandle }));
  }).then(result => {
    if (!result) return;
    
    const { histDoc, myHandle } = result;
    const histData = histDoc.data();
    const hareField = histData?.hare || '';
    const handles = hareField.split(',').map(h => h.trim()).filter(Boolean);
    
    const isUserHare = handles.includes(myHandle) || isHare;
    
    if (!isUserHare) {
      Toast.makeText('Must be hare to set trail');
      return;
    }
    
    showSetTrailDialog();
  }).catch(error => {
    console.error('checkHareJoinedBeforeSetTrail error:', error);
    Toast.makeText('Unable to verify hare status');
  });
}

function showSetTrailDialog() {
  const dlg = document.createElement('dialog');
  dlg.style.cssText = `
    border: none;
    border-radius: 28px;
    padding: 0;
    min-width: 312px;
    max-width: 360px;
    font-family: system-ui, sans-serif;
    background: #f3edf7;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  `;
  
  dlg.innerHTML = `
    <div style="padding: 24px 24px 16px 24px;">
      <h2 style="margin: 0; font-size: 24px; font-weight: 400; color: #1d1b20;">Set Trail</h2>
      <p style="margin: 16px 0 0 0; color: #49454f; font-size: 14px;">
        Tap Start Point to set the beginning of the trail, then End Point when finished.
      </p>
    </div>
    <div style="padding: 0 24px 24px 24px; display: flex; flex-direction: column; gap: 8px;">
      <button id="btnStartPoint" style="
        padding: 12px 16px;
        border: 1px solid #79747e;
        border-radius: 20px;
        background: #f3edf7;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #6750a4;
      ">Start Point</button>
      <button id="btnEndPoint" style="
        padding: 12px 16px;
        border: 1px solid #79747e;
        border-radius: 20px;
        background: #f3edf7;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        color: #6750a4;
      ">End Point</button>
      <button id="btnCancelTrail" style="
        padding: 12px 16px;
        border: none;
        border-radius: 20px;
        background: transparent;
        color: #6750a4;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        margin-top: 8px;
      ">Cancel</button>
    </div>
  `;
  
  document.body.appendChild(dlg);
  dlg.showModal();
  
  dlg.querySelector('#btnStartPoint').onclick = () => {
    dlg.close();
    dlg.remove();
    setTrailStartPoint();
  };
  
  dlg.querySelector('#btnEndPoint').onclick = () => {
    dlg.close();
    dlg.remove();
    setTrailEndPoint();
  };
  
  dlg.querySelector('#btnCancelTrail').onclick = () => {
    dlg.close();
    dlg.remove();
  };
  
  dlg.onclick = (e) => {
    if (e.target === dlg) {
      dlg.close();
      dlg.remove();
    }
  };
}

function setTrailStartPoint() {
  if (!navigator.geolocation) {
    Toast.makeText('Geolocation not supported');
    return;
  }

  let callbackFired = false;
  const timeoutId = setTimeout(() => {
    if (!callbackFired) {
      callbackFired = true;
      const mockLatLng = lastLocation || { lat: 9.082, lng: 8.6753 };
      proceedWithStartPoint(mockLatLng);
    }
  }, 5000);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        const latLng = { 
          lat: position.coords.latitude, 
          lng: position.coords.longitude 
        };
        proceedWithStartPoint(latLng);
      }
    },
    (error) => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        const mockLatLng = lastLocation || { lat: 9.082, lng: 8.6753 };
        proceedWithStartPoint(mockLatLng);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function proceedWithStartPoint(latLng) {
  clearAllMapObjects();

  startMarker = new google.maps.Marker({
    position: latLng,
    map,
    title: 'Trail Start',
    icon: { url: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png' }
  });

  hareTrailPoints.length = 0;
  hareTrailPoints.push(latLng);

  if (harePolyline) harePolyline.setMap(null);
  
  harePolyline = new google.maps.Polyline({
    path: hareTrailPoints,
    geodesic: true,
    strokeColor: '#FF00FF',
    strokeWeight: 8
  });
  harePolyline.setMap(map);

  currentMode = ScreenMode.SET_TRAIL;
  trackingHare = true;
  hareStartTime = Date.now();
  hareDistance = 0;
  lastHareLocation = null;
  
  startHareTracking();
  
  map.setCenter(latLng);
  map.setZoom(17);
  
  Toast.makeText('Trail start set — tracking hare.');
    voiceNav.announceTrailStart();
}

function setTrailEndPoint() {
  if (!trackingHare) {
    Toast.makeText('You must set a start point first.');
    return;
  }

  if (!navigator.geolocation) {
    Toast.makeText('Geolocation not supported');
    return;
  }

  let callbackFired = false;
  const timeoutId = setTimeout(() => {
    if (!callbackFired) {
      callbackFired = true;
      const mockLatLng = lastLocation || lastHareLocation || { lat: 9.082, lng: 8.6753 };
      proceedWithEndPoint(mockLatLng);
    }
  }, 5000);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        const latLng = { 
          lat: position.coords.latitude, 
          lng: position.coords.longitude 
        };
        proceedWithEndPoint(latLng);
      }
    },
    (error) => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        const mockLatLng = lastLocation || lastHareLocation || { lat: 9.082, lng: 8.6753 };
        proceedWithEndPoint(mockLatLng);
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function proceedWithEndPoint(latLng) {
  endMarker = new google.maps.Marker({
    position: latLng,
    map,
    title: 'Trail End',
    icon: { url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' }
  });

  stopHareTracking();
  saveTrailPathToFirestore();
  
  currentMode = ScreenMode.IDLE;
  Toast.makeText('Trail end set and saved.');
    voiceNav.announceTrailEnd();
}

const startHareTracking = () => {
  setKeepScreenOn(true);
  if (hareWatchId) navigator.geolocation.clearWatch(hareWatchId);

  hareWatchId = navigator.geolocation.watchPosition(
    p => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      hareTrailPoints.push(here);
      harePolyline.setPath(hareTrailPoints);
      if (lastHareLocation) hareDistance += haversine(lastHareLocation, here);
      lastHareLocation = here;
      updateHareStats();
      map.setCenter(here);
      map.setZoom(17);
    },
    e => console.warn('hare watch', e),
    { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
  );

  updateHareStats();
};

const stopHareTracking = () => {
  setKeepScreenOn(false);
  trackingHare = false;
  if (hareWatchId) navigator.geolocation.clearWatch(hareWatchId);
};

const updateHareStats = () => {
  const durationMin = Math.round((Date.now() - hareStartTime) / 1000 / 60);
  const pace = hareDistance > 0 ? durationMin / (hareDistance / 1000) : 0;
  const distKm = Math.round(hareDistance / 10) / 100;
  els.tvTrackingStats.textContent = `Hare: ${distKm} km | ${durationMin} min | ${pace.toFixed(2)} min/km`;
};

const saveTrailPathToFirestore = async () => {
  if (!runId) return;

  const trailData = hareTrailPoints.map(p => ({ lat: p.lat, lng: p.lng }));
  const start = hareTrailPoints[0];
  const end = hareTrailPoints[hareTrailPoints.length - 1];

  let trailRef = sourceType === 'event'
    ? doc(db, 'events', `${runId}trail`)
    : doc(db, 'runs', `${runId}trail`);

  await setDoc(trailRef, {
    trailPath: trailData,
    trailStart: { lat: start.lat, lng: start.lng },
    trailEnd: { lat: end.lat, lng: end.lng }
  }, { merge: true });
};

/* ---------- User Tracking ---------- */
const handleStartTracking = () => {
  if (currentMode === ScreenMode.SET_TRAIL) {
    if (!confirm('Stop setting trail? Unsaved trail will be lost.')) return;
    stopHareTracking();
    clearAllMapObjects();
  }

  if (!tracking) startUserTrailMode();
  else stopUserTrailMode();
};

const startUserTrailMode = () => {
  if (!navigator.geolocation) return Toast.makeText('Geolocation not supported');

  currentMode = ScreenMode.TRACKING;
  tracking = true;
  startTimeMillis = Date.now();
  trailPoints.length = 0;
  totalDistance = 0;
  lastLocation = null;

  if (polyline) polyline.setMap(null);
  polyline = new google.maps.Polyline({
    path: trailPoints,
    geodesic: true,
    strokeColor: '#2196F3',
    strokeWeight: 8
  });
  polyline.setMap(map);
  setKeepScreenOn(true);

  trailWatchId = navigator.geolocation.watchPosition(
    p => {
      const here = { lat: p.coords.latitude, lng: p.coords.longitude };
      trailPoints.push(here);
      polyline.setPath(trailPoints);
      if (lastLocation) totalDistance += haversine(lastLocation, here);
      lastLocation = here;
      updateTrackingStats();
      map.setCenter(here);
      map.setZoom(17);
    },
    e => console.warn('trail watch', e),
    { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
  );

  els.btnStartTracking.textContent = 'Stop Tracking';
  updateTrackingStats();
    voiceNav.announceTrackingStart();
};

const stopUserTrailMode = () => {
  if (!tracking) return;
  tracking = false;
  currentMode = ScreenMode.IDLE;
  if (trailWatchId) navigator.geolocation.clearWatch(trailWatchId);
  setKeepScreenOn(false);
  updateTrackingStats(true);
  els.btnStartTracking.textContent = 'Start Tracking';
    voiceNav.announceTrackingStop();
};

const updateTrackingStats = (final = false) => {
  const durationMin = Math.round((Date.now() - startTimeMillis) / 1000 / 60);
  const pace = totalDistance > 0 ? durationMin / (totalDistance / 1000) : 0;
  const distKm = Math.round(totalDistance / 10) / 100;

  els.tvTrackingStats.textContent = final
    ? `Tracking Complete\nDistance: ${distKm} km\nTime: ${durationMin} min\nPace: ${pace.toFixed(2)} min/km`
    : `Distance: ${distKm} km\nTime: ${durationMin} min\nPace: ${pace.toFixed(2)} min/km`;
};

/* ---------- Off Route Detection ---------- */
const calculateTimeOffRoute = (currentPos, destination) => {
  // Calculate straight-line distance
  const distance = haversine(currentPos, destination);
  // Estimate time based on mode (rough estimate: 50km/h driving, 5km/h walking)
  const speed = navMode === 'DRIVING' ? 50 : 5; // km/h
  const timeHours = distance / 1000 / speed;
  return timeHours * 60; // minutes
};

const checkOffRoute = (currentPos, destination, mode) => {
  const timeOff = calculateTimeOffRoute(currentPos, destination);
  const stopThreshold = mode === 'DRIVING' ? STOP_NAVIGATION_MINUTES.DRIVING : 
                        mode === 'JOIN_PACK' ? STOP_NAVIGATION_MINUTES.JOIN_PACK : 
                        STOP_NAVIGATION_MINUTES.WALKING;
  
  // Announce if significantly off route but not yet at stop threshold
  if (timeOff > (stopThreshold / 2) && timeOff <= stopThreshold) {
    voiceNav.announceOffRoute(timeOff);
  }
  
  if (timeOff > stopThreshold) {
    voiceNav.announceReroute(`Navigation stopped. You are ${Math.round(timeOff)} minutes off route.`);
    stopRealtimeNav();
    Toast.makeText(`Navigation stopped - you're ${Math.round(timeOff)} minutes off route`);
    return true;
  }
  return false;
};

const checkArrival = dest => {
  if (!navActive) return;
  navigator.geolocation.getCurrentPosition(p => {
    const here = { lat: p.coords.latitude, lng: p.coords.longitude };
    const d = haversine(here, dest);
    if (d <= 30) {
      voiceNav.announceArrival();
      stopRealtimeNav(true);
    }
  });
};

/* ---------- Stop Navigation ---------- */
const stopRealtimeNav = (onArrived = false) => {
  setKeepScreenOn(false);
  navActive = false;
  navMode = null;
  if (navWatchId) navigator.geolocation.clearWatch(navWatchId);
  if (navTimeoutId) clearTimeout(navTimeoutId);
  currentMode = ScreenMode.IDLE;
  
  if (directionsRenderer) {
    directionsRenderer.setMap(null);
    directionsRenderer = null;
  }

  Toast.makeText(onArrived ? 'Arrived at destination' : 'Navigation stopped');
};

/* ---------- Pack Locations Listener ---------- */
const listenForPackLocations = () => {
  if (packListener) packListener();

  packListener = onSnapshot(collection(db, 'pack_locations'), snap => {
    const currentUid = auth.currentUser.uid;
    const positions = [];

    snap.docs.forEach(d => {
      const lat = d.get('lat');
      const lng = d.get('lng');
      if (lat != null && lng != null) {
        positions.push({ uid: d.id, pos: { lat, lng } });
      }
    });

    if (currentMode !== ScreenMode.TRAIL) {
      const ids = positions.map(p => p.uid);

      Object.keys(packMarkers).forEach(uid => {
        if (!ids.includes(uid)) {
          packMarkers[uid].setMap(null);
          delete packMarkers[uid];
        }
      });

      positions.forEach(({ uid, pos }) => {
        if (packMarkers[uid]) {
          packMarkers[uid].setPosition(pos);
        } else {
          packMarkers[uid] = new google.maps.Marker({ 
            position: pos, 
            map, 
            title: 'Runner',
            icon: { url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png' }
          });
        }
      });
    }
  });
};

const averageLatLng = pts => {
  let lat = 0, lng = 0;
  pts.forEach(p => { lat += p.lat; lng += p.lng; });
  const n = pts.length || 1;
  return { lat: lat / n, lng: lng / n };
};

/* ---------- Helpers ---------- */
const getCurrentLocation = cb => {
  let callbackFired = false;
  const timeoutId = setTimeout(() => {
    if (!callbackFired) {
      callbackFired = true;
      cb({ lat: 9.082, lng: 8.6753 });
    }
  }, 2000);

  if (!navigator.geolocation) {
    clearTimeout(timeoutId);
    if (!callbackFired) {
      callbackFired = true;
      cb({ lat: 9.082, lng: 8.6753 });
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    p => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        cb({ lat: p.coords.latitude, lng: p.coords.longitude });
      }
    },
    e => {
      clearTimeout(timeoutId);
      if (!callbackFired) {
        callbackFired = true;
        cb({ lat: 9.082, lng: 8.6753 });
      }
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
  );
};

const haversine = (a, b) => {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180;
  const lb = b.lat * Math.PI / 180;
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(la) * Math.cos(lb);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
};

const setKeepScreenOn = v => {
  keepScreenOn = v;
  if (v && 'wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(e => console.log('Wake lock failed:', e));
  }
};

const clearAllMapObjects = () => {
  if (directionsRenderer) {
    directionsRenderer.setMap(null);
    directionsRenderer = null;
  }
  if (polyline) polyline.setMap(null);
  if (harePolyline) harePolyline.setMap(null);
  if (startMarker) startMarker.setMap(null);
  if (endMarker) endMarker.setMap(null);
  if (packClusterMarker) packClusterMarker.setMap(null);

  Object.values(packMarkers).forEach(m => m.setMap(null));
  for (const k in packMarkers) delete packMarkers[k];
};

const fetchUserDetails = () => {
  const uid = auth.currentUser.uid;
  onSnapshot(doc(db, 'users', uid), snap => {
    if (!snap.exists()) return;
    loadProfilePic(snap.get('profilePicUrl'));
  });
};

const loadProfilePic = url => {
  if (!url) return els.imageProfile.src = 'icons/ic_profile_placeholder.svg';
  els.imageProfile.src = url;
};

const Toast = {
  makeText: txt => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = txt;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
};

/* ---------- Bottom Nav - More Menu (from runs.js) ---------- */
document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
  if (item.dataset.screen === 'more') {
    item.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMoreOptions();
    };
  }
});

function showMoreOptions() {
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
      handleMoreOption(index);
    };
  });
  
  dialog.querySelector('.more-cancel').onclick = () => dialog.remove();
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.remove();
  };
}

function handleMoreOption(index) {
  switch(index) {
    case 0:
      logout();
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
      toggleDayNight();
      break;
    case 6:
      showAboutHashDialog();
      break;
  }
}

function toggleDayNight() {
  const isNight = localStorage.getItem('night_mode') === 'true';
  localStorage.setItem('night_mode', !isNight);
  document.body.classList.toggle('night-mode', !isNight);
}

async function logout() {
  try {
    await signOut(auth);
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Logout error:', error);
  }
}

function showAboutHashDialog() {
  const modal = document.createElement('div');
  modal.className = 'more-dialog';
  modal.innerHTML = `
    <div class="more-dialog-content" style="max-width: 90%; border-radius: 16px; margin: auto; max-height: 80vh; overflow-y: auto;">
      <div style="padding: 16px;">
        <h2 style="color: #ff6b00; margin-bottom: 16px;">About Hash House Harriers</h2>
        <p style="line-height: 1.6; margin-bottom: 12px;">
          <b>HISTORY</b><br>
          The Hash began in December 1938 in Kuala Lumpur, Malaysia...
          [rest of about text from runs.js]
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
}