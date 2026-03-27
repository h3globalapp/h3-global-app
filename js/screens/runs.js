import { 
    collection, 
    doc, 
    getDoc, 
    getDocs, 
    setDoc, 
    deleteDoc, 
    Timestamp, 
    query, 
    where, 
    orderBy, 
    limit, 
    onSnapshot, 
    writeBatch, 
    increment, 
    arrayUnion,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";
import { functions } from '../firebase-config.js';
// Make functions available globally
window.functions = functions;

// Global variables
let currentUserId = null;
let userRole = "";
let currentUserKennelId = "";
let currentState = "";
let currentUserData = null;
const joinedRunIds = new Set();
let joinedRunIdToday = null;
const dateFormatter = new Intl.DateTimeFormat('en-CA');
const todayDateString = dateFormatter.format(new Date());
const runsList = [];
let runsListeners = [];
let selectedRunForPayment = null;
let lastTapTime = 0;
const DOUBLE_TAP_DELTA = 300; // milliseconds
let runToDelete = null;

// ADD THIS: Audio system for payment notifications
const audioSystem = {
  sounds: {
    rego: null,
    sponsorship: null
  },
  enabled: false,
  init() {
    // Preload sounds
  this.sounds.rego = new Audio('./sounds/run_rego_received.mp3');
    this.sounds.sponsorship = new Audio('./sounds/new_sponsorship.mp3');
    
    // Preload
    Object.values(this.sounds).forEach(audio => {
      if (audio) audio.preload = 'auto';
    });
    
    // Handle missing files silently
    Object.entries(this.sounds).forEach(([key, audio]) => {
      if (audio) {
        audio.onerror = () => {
          console.warn(`Sound file not found: ${audio.src}`);
          this.sounds[key] = null;
        };
      }
    });
    
    // Enable on first interaction
    const enable = () => {
      this.enabled = true;
      document.removeEventListener('click', enable);
      document.removeEventListener('touchstart', enable);
    };
    document.addEventListener('click', enable);
    document.addEventListener('touchstart', enable);
  },
  play(type) {
    if (!this.enabled || !this.sounds[type]) return;
    if (this.sounds[type].error) {
      console.log(`Sound ${type} not available`);
      return;
    }
    const audio = this.sounds[type].cloneNode();
    audio.play().catch(e => console.log('Audio play failed:', e));
  }
};
audioSystem.init();

// DOM Elements
const els = {
  tvHeader: document.getElementById('tvHeader'),
  btnAddRun: document.getElementById('btnAddRun'),
  runsList: document.getElementById('runsList'),
  emptyState: document.getElementById('emptyState'),
  progressBarLoading: document.getElementById('progressBarLoading'),
  
  // Dialogs
  runDetailsDialog: document.getElementById('runDetailsDialog'),
  detailImage: document.getElementById('detailImage'),
  detailInfo: document.getElementById('detailInfo'),
  btnNavigate: document.getElementById('btnNavigate'),
  btnCloseDetails: document.getElementById('btnCloseDetails'),
  
  // Payment dialog
  paymentDialog: document.getElementById('paymentDialog'),
  paymentContent: document.getElementById('paymentContent'),
  
  deleteDialog: document.getElementById('deleteDialog'),
  deleteMessage: document.getElementById('deleteMessage'),
  btnCancelDelete: document.getElementById('btnCancelDelete'),
  btnConfirmDelete: document.getElementById('btnConfirmDelete')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupBottomNavListeners();
  initApp();
});

function setupEventListeners() {
  els.btnAddRun.onclick = () => {
    window.location.href = 'add-run.html';
  };
  
  els.btnCloseDetails.onclick = () => {
    els.runDetailsDialog.classList.add('hidden');
  };
  
  // Navigate button - builds URL like Kotlin version
  els.btnNavigate.onclick = () => {
    const run = els.btnNavigate.dataset.runId ? runsList.find(r => r.runId === els.btnNavigate.dataset.runId) : null;
    if (!run) return;
    
    // Check if user has joined this run - if so, use history ID
    const historyId = run.historyId || localStorage.getItem('currentRunId') || run.runId;
    
    // Match Kotlin: destination_lat, destination_lng, runId, kennelId, currentState, fromRunsActivity, isTopLevelRuns
    const params = new URLSearchParams({
      destination_lat: run.lat,
      destination_lng: run.lng,
      runId: historyId,
      kennelId: run.kennelId || '',
      currentState: run.state || currentState || '',
      fromRunsActivity: 'true',
      isTopLevelRuns: 'true'
    });
    
    window.location.href = `trail.html?${params.toString()}`;
  };
  
  // Delete dialog
  els.btnCancelDelete.onclick = () => {
    els.deleteDialog.classList.add('hidden');
    runToDelete = null;
  };
  els.btnConfirmDelete.onclick = confirmDeleteRun;
}

function closePaymentDialog() {
  els.paymentDialog.classList.add('hidden');
  els.paymentContent.innerHTML = '';
  selectedRunForPayment = null;
}

async function initApp() {
  setLoading(true);
  
  onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    
    currentUserId = user.uid;
    
    try {
      const userDoc = await getDoc(doc(window.db, 'users', currentUserId));
      const userData = userDoc.data();
      
      currentUserData = userData;
	 
      userRole = userData?.role || '';
      currentUserKennelId = userData?.kennel || '';
      
      // Show Add Run button for Tier 1/2 (like Kotlin)
      if (userRole.includes('Tier 1') || userRole.includes('Tier 2')) {
        els.btnAddRun.classList.remove('hidden');
      }
      
      await detectCurrentLocation();
      
    } catch (err) {
      console.error('Error initializing app:', err);
      alert('Error loading data. Please try again.');
    } finally {
      setLoading(false);
    }
  });
}

// Background location refresh - doesn't block UI
async function refreshLocationInBackground() {
  try {
    if (!navigator.geolocation) return;
    
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60000
      });
    });
    
    const { latitude, longitude } = position.coords;
    
    // Use secure Cloud Function instead of direct API
    const reverseGeocode = httpsCallable(window.functions, 'reverseGeocode');
    const result = await reverseGeocode({ 
      latitude: latitude, 
      longitude: longitude 
    });
    
    const newState = result.data.state;
    
    if (!newState) return;
    
    // Normalize state name
    const normalizedState = newState.replace(/\s+State$/i, '').trim();
    
    // Only update if state changed
    if (normalizedState !== currentState) {
      console.log('State changed from', currentState, 'to', normalizedState);
      currentState = normalizedState;
      sessionStorage.setItem('cachedState', currentState);
      sessionStorage.setItem('cachedStateTime', Date.now().toString());
      
      // Restart listeners with new state
      startListeningToRuns();
      els.tvHeader.textContent = `Runs in ${currentState}`;
    }
  } catch (err) {
    console.log('Background location refresh failed:', err);
    // Silent fail - user already has cached state
  }
}

async function detectCurrentLocation() {
  // Check for cached location first (less than 1 hour old)
  const CACHE_DURATION = 3600000; // 1 hour
  const cachedState = sessionStorage.getItem('cachedState');
  const cachedAt = parseInt(sessionStorage.getItem('cachedStateTime') || '0');
  const cacheAge = Date.now() - cachedAt;
  
  if (cachedState && cacheAge < CACHE_DURATION) {
    console.log('Using cached state:', cachedState, '(age:', Math.round(cacheAge/60000), 'minutes)');
    currentState = cachedState;
    els.tvHeader.textContent = `Runs in ${currentState}`;
    startListeningToRuns();
    return;
  }
  
  if (!navigator.geolocation) {
    alert('Geolocation not supported');
    return;
  }
  
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      });
    });
    
    const { latitude, longitude } = position.coords;
    console.log('GPS coordinates:', latitude, longitude);
    
    // Use secure Cloud Function instead of direct API call
    const reverseGeocode = httpsCallable(window.functions, 'reverseGeocode');
    const result = await reverseGeocode({ 
      latitude: latitude, 
      longitude: longitude 
    });
    
    const state = result.data.state;
    
    if (!state) {
      throw new Error('Could not determine state from location');
    }
    
    // Remove "State" suffix for consistency
    currentState = state.replace(/\s+State$/i, '').trim();
    
    // Cache the result
    sessionStorage.setItem('cachedState', currentState);
    sessionStorage.setItem('cachedStateTime', Date.now().toString());
    
    console.log('Location detected:', currentState);
    els.tvHeader.textContent = `Runs in ${currentState}`;
    startListeningToRuns();
    
  } catch (err) {
    console.error('Error detecting location:', err);
    
    // Try cached state as fallback
    const cachedState = sessionStorage.getItem('cachedState');
    if (cachedState) {
      console.log('Using cached state after error:', cachedState);
      currentState = cachedState;
      els.tvHeader.textContent = `Runs in ${currentState}`;
      startListeningToRuns();
    } else {
      // Final fallback: use user's profile state
      try {
        const userDoc = await getDoc(doc(window.db, 'users', currentUserId));
        const userState = userDoc.data()?.state;
        if (userState) {
          currentState = userState.replace(/\s+State$/i, '').trim();
          els.tvHeader.textContent = `Runs in ${currentState}`;
          startListeningToRuns();
        } else {
          alert('Unable to get location. Please enable location services.');
        }
      } catch (profileErr) {
        alert('Unable to get location. Please enable location services.');
      }
    }
  }
}

// Start listening to runs for the current state with real-time updates
// MATCHES KOTLIN: Automatically recycles past runs
function startListeningToRuns() {
  // Clear any existing listeners to prevent memory leaks
  runsListeners.forEach(unsubscribe => unsubscribe());
  runsListeners = [];
  
  // Clear existing runs
  runsList.length = 0;
  
  if (!currentState) {
    console.log('No current state, skipping listener setup');
    return;
  }
  
  setLoading(true);
  
  // Query runs for current state - order by date ascending
  const runsQuery = query(
    collection(window.db, 'runs'),
    where('state', '==', currentState),
    orderBy('date', 'asc')
  );
  
  // Set up real-time listener
  const unsubscribe = onSnapshot(runsQuery, async (snapshot) => {
    console.log(`Received ${snapshot.docs.length} runs from Firestore`);
    
    const toRecycleIds = [];
    const newRuns = [];
    const kennelsWithRunsToday = new Set();
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const runDate = data.date || '';
      
      // KOTLIN BEHAVIOR: Check if run date has passed
      if (runDate < todayDateString) {
        // Run is in the past - mark for recycling (like Kotlin)
        toRecycleIds.push({ id: doc.id, data: data });
      } else {
        // Run is today or future - add to display list
        newRuns.push({
          runId: doc.id,
          ...data
        });
        
        // Track kennels with runs today for Add Run button state
        if (runDate === todayDateString) {
          kennelsWithRunsToday.add(data.kennel || '');
        }
      }
    });
    
    // Update Add Run button state (like Kotlin)
    if (els.btnAddRun) {
      const hasRunToday = kennelsWithRunsToday.has(currentUserKennelId);
      els.btnAddRun.disabled = hasRunToday;
      els.btnAddRun.style.opacity = hasRunToday ? '0.4' : '1';
    }
    
    // KOTLIN BEHAVIOR: Recycle past runs automatically
    if (toRecycleIds.length > 0) {
      console.log(`Recycling ${toRecycleIds.length} past runs`);
      for (const { id, data } of toRecycleIds) {
        await recycleById(id, data);
      }
    }
    
    // Check joined status for each run
    const runsWithStatus = await Promise.all(
      newRuns.map(async (run) => {
        const joined = await checkIfJoined(run.runId, run.date);
        return { ...run, joined };
      })
    );
    
    // Update global runs list
    runsList.length = 0;
    runsList.push(...runsWithStatus);
    
    // Render the list
    renderRunsList();
    setLoading(false);
    
  }, (error) => {
    console.error('Error listening to runs:', error);
    setLoading(false);
    alert('Error loading runs. Please refresh the page.');
  });
  
  runsListeners.push(unsubscribe);
  
  // Set up background location refresh every 5 minutes
  if (window.locationRefreshInterval) {
    clearInterval(window.locationRefreshInterval);
  }
  window.locationRefreshInterval = setInterval(refreshLocationInBackground, 300000);
}

// KOTLIN MATCH: recycleById function
async function recycleById(runId, runData) {
  try {
    const runDay = runData.runDay || 'Thursday';
    const cadence = runData.cadence || 'weekly';
    const runDate = runData.date;
    const oldNumber = runData.runNumber || 0;
    
    const nextDate = calculateNextOccurrence(runDay, cadence, runDate);
    
    const updates = {
      runNumber: oldNumber + 1,
      date: nextDate,
      address: 'TBA',
      lat: 0,
      lng: 0,
      hare: ''
    };
    
    await updateDoc(doc(window.db, 'runs', runId), updates);
    console.log(`Recycled run ${runId}: new date ${nextDate}, new number ${updates.runNumber}`);
    
  } catch (error) {
    console.error(`Error recycling run ${runId}:`, error);
  }
}

// KOTLIN MATCH: nextOccurrence function
function calculateNextOccurrence(dayName, cadence, fromDate) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDay = days.indexOf(dayName);
  if (targetDay === -1) return fromDate;
  
  const step = cadence.toLowerCase().includes('bi') ? 2 : 
               cadence.toLowerCase().includes('month') ? 4 : 1;
  
  const date = new Date(fromDate);
  do {
    date.setDate(date.getDate() + (step * 7));
  } while (date.getDay() !== targetDay);
  
  return dateFormatter.format(date);
}

async function checkIfJoined(templateId, date) {
  console.log('Checking joined status for:', { templateId, date, currentUserId });
  
  try {
    const historySnap = await getDocs(
      query(
        collection(window.db, 'runsHistory'),
        where('templateId', '==', templateId),
        where('date', '==', date),
        limit(1)
      )
    );
    
    console.log('History query result:', historySnap.empty ? 'empty' : historySnap.docs[0].id);
    
    if (historySnap.empty) return false;
    
    const historyId = historySnap.docs[0].id;
    const joinedDoc = await getDoc(
      doc(window.db, 'runsHistory', historyId, 'joined', currentUserId)
    );
    
    console.log('Joined doc exists:', joinedDoc.exists());
    
    return joinedDoc.exists();
    
  } catch (err) {
    console.error('Error checking joined status:', err);
    return false;
  }
}

async function canDeleteRun(runData) {
  if (!userRole.includes('Tier')) return false;
  return currentUserKennelId === runData.kennel;
}

function renderRunsList() {
  if (runsList.length === 0) {
    els.runsList.innerHTML = '';
    els.emptyState.classList.remove('hidden');
    return;
  }
  
  els.emptyState.classList.add('hidden');
  
   els.runsList.innerHTML = runsList.map(run => `
    <div class="run-card" data-run-id="${run.runId}" data-run-date="${run.date}">
      <div class="run-image">
        <img src="${run.imageUrl || 'images/placeholder_run.png'}" alt="${run.title}" loading="lazy"/>
        ${run.joined ? '<span class="joined-badge">Joined</span>' : '<span class="joined-badge not-joined">Not Joined</span>'}
      </div>
      <div class="run-info">
        <h3>${run.title}</h3>
        <p class="run-meta">🏃 Run #${run.runNumber} | 📅 ${run.runDay || 'Thursday'}</p>
        <p class="run-date">🕐 ${formatDate(run.date)} at ${run.time || 'TBA'}</p>
        <p class="run-location">📍 ${run.address || 'Location TBA'}</p>
        <button class="btn-view-rego" style="background: none; border: none; color: var(--clr-primary); text-decoration: underline; cursor: pointer; font-size: 12px; margin-top: 4px; padding: 0;">📋 View Rego List</button>
      </div>
      <div class="run-actions">
        ${renderActionButtons(run)}
      </div>
    </div>
  `).join('');
  
  // Attach event listeners to each card
  runsList.forEach(run => {
    const card = els.runsList.querySelector(`[data-run-id="${run.runId}"]`);
    if (!card) return;
    
    // Single click handlers for buttons
    const joinBtn = card.querySelector('.btn-join');
    const payOthersBtn = card.querySelector('.btn-pay-others');
    const detailsBtn = card.querySelector('.btn-details');
    
    if (joinBtn) {
      joinBtn.onclick = (e) => {
        e.stopPropagation();
        if (run.date !== todayDateString) {
          alert('You can only join this run on the day of the run: ' + formatDate(run.date));
          return;
        }
        handleJoinClick(run, false);
      };
    }
    
    if (payOthersBtn) {
      payOthersBtn.onclick = (e) => {
        e.stopPropagation();
        if (run.date !== todayDateString) {
          alert('You can only pay for others on the day of the run: ' + formatDate(run.date));
          return;
        }
        handleJoinClick(run, true);
      };
    }
    
    if (detailsBtn) {
      detailsBtn.onclick = (e) => {
        e.stopPropagation();
        showRunDetails(run);
      };
    }
	
	    // View Rego List button handler
    const viewRegoBtn = card.querySelector('.btn-view-rego');
    if (viewRegoBtn) {
      viewRegoBtn.onclick = async (e) => {
        e.stopPropagation();
        await showRegoListDialog(run);
      };
    }
    
    // DOUBLE-TAP handler for admin edit
    if (userRole.includes('Tier 1') || userRole.includes('Tier 2')) {
      card.addEventListener('click', (e) => {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastTapTime;
        
        if (timeDiff < DOUBLE_TAP_DELTA && timeDiff > 0) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = `add-run.html?editRunId=${run.runId}`;
        }
        lastTapTime = currentTime;
      });
    }
  });
}

// No delete button in action buttons (removed as requested)
function renderActionButtons(run) {
  const isToday = run.date === todayDateString;
  
  // Already joined this run - show Pay for Others button instead
  if (run.joined) {
    return `
      <button class="btn-pay-others" style="background-color: #ffc107; color: black;">Pay for Others</button>
      <button class="btn-details">Details</button>
    `;
  }
  
  // Not joined - show Join button (enabled only if today)
  // ADDED: color: #333 to make text visible when disabled
  return `
    <button class="btn-join" ${!isToday ? 'disabled style="opacity:0.6; cursor:not-allowed; color: #333;"' : ''}>
      ${isToday ? 'Join' : 'Available on ' + formatDate(run.date)}
    </button>
    <button class="btn-details">Details</button>
  `;
}
  


function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatCurrency(amount, code) {
  const currency = code && code.length === 3 ? code : 'NGN';
  return new Intl.NumberFormat('en', { 
    style: 'currency', 
    currency 
  }).format(amount || 0);
}

async function handleJoinClick(run, payForOthersOnly = false) {
  // Check if history exists first (run must be set up by admin)
  const historySnap = await getDocs(
    query(
      collection(window.db, 'runsHistory'),
      where('templateId', '==', run.runId),
      where('date', '==', run.date),
      limit(1)
    )
  );
  
  if (historySnap.empty) {
    alert('Run details not set yet. Please check back later.');
    return;
  }
  
  // Already joined this run and not paying for others? Just alert
  if (run.joined && !payForOthersOnly) {
    alert('Already joined this run');
    return;
  }
  
  // Otherwise show payment dialog
  await showJoinDialog(run, payForOthersOnly);
}

// ENHANCED: Show join dialog with separate self/others for rego and sponsorship
async function showJoinDialog(run, payForOthersOnly = false) {  
  if (!currentUserData || !run) return;
  
  selectedRunForPayment = run;
  
  const walletBalance = currentUserData.walletBalance || 0;
  const currency = currentUserData.walletCurrency || 'NGN';
  const regoFee = run.regoFee || 0;
  
  // Get all hash handles for datalist
  const usersSnap = await getDocs(collection(window.db, 'users'));
  const allHashHandles = usersSnap.docs
    .map(d => d.data().hashHandle)
    .filter(h => h && h !== currentUserData.hashHandle)
    .sort();
  
  const dialogHTML = `
    <div class="join-dialog">
      <h3>${payForOthersOnly ? 'Pay for Others' : 'Join Run'}</h3>
      <div class="wallet-info">
        <p>Your Wallet Balance: <strong>${formatCurrency(walletBalance, currency)}</strong></p>
        ${walletBalance <= 0 ? '<p class="warning">Insufficient balance. Please top up.</p>' : ''}
      </div>
      
      <div class="payment-sections">
        <!-- REGO SECTION -->
        <div class="section rego-section">
          <h4>📝 Registration Fee</h4>
          
          ${!payForOthersOnly ? `
          <!-- Self Rego (hidden when paying for others) -->
          <div class="self-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbRegoSelf" checked>
              <span>Pay for myself (${currentUserData.hashHandle || 'You'})</span>
            </label>
            <div id="regoSelfDetails" class="selection-details">
              <p class="fee-display">Fee: ${formatCurrency(regoFee, currency)}</p>
            </div>
          </div>
          ` : ''}
          
          <!-- Others Rego (always shown) -->
          <div class="others-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbRegoOthers" ${payForOthersOnly ? 'checked' : ''}>
              <span>Pay for others</span>
            </label>
            <div id="regoOthersDetails" class="selection-details ${payForOthersOnly ? '' : 'hidden'}">
              <div id="regoOthersList"></div>
              <button type="button" id="btnAddRegoOther" class="btn-add-person">+ Add Person</button>
            </div>
          </div>
        </div>
        
        <!-- SPONSORSHIP SECTION -->
        <div class="section sponsorship-section">
          <h4>🤝 Sponsorship</h4>
          
          ${!payForOthersOnly ? `
          <!-- Self Sponsorship (hidden when paying for others) -->
          <div class="self-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbSponSelf">
              <span>I want to sponsor</span>
            </label>
            <div id="sponSelfDetails" class="selection-details hidden">
              <div class="amount-input">
                <label>Amount: 
                  <input type="number" id="sponSelfAmount" min="0" step="0.01" placeholder="Enter amount">
                </label>
              </div>
            </div>
          </div>
          ` : ''}
          
          <!-- Others Sponsorship (always shown) -->
          <div class="others-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbSponOthers">
              <span>Others want to sponsor</span>
            </label>
            <div id="sponOthersDetails" class="selection-details hidden">
              <div id="sponOthersList"></div>
              <button type="button" id="btnAddSponOther" class="btn-add-person">+ Add Person</button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="total-section">
        <p>Total: <strong id="totalAmount">${formatCurrency(payForOthersOnly ? 0 : regoFee, currency)}</strong></p>
      </div>
      
      ${walletBalance <= 0 ? `
        <div class="topup-section">
          <p>Top up your wallet:</p>
          <div class="virtual-account">
            <p><strong>Bank:</strong> ${currentUserData.titanBankName || 'Wema Bank'}</p>
            <p><strong>Account No:</strong> ${currentUserData.titanAccountNumber || 'N/A'}</p>
            <p><strong>Account Name:</strong> ${currentUserData.titanAccountName || 'N/A'}</p>
          </div>
          <p class="note">Transfer from any bank app. Balance updates automatically.</p>
        </div>
      ` : ''}
      
      <div class="dialog-buttons">
        <button type="button" id="btnCancel" class="btn-secondary">Cancel</button>
        <button type="button" id="btnPay" class="btn-primary" ${walletBalance < (payForOthersOnly ? 0 : regoFee) ? 'disabled' : ''}>
          ${walletBalance < (payForOthersOnly ? 0 : regoFee) ? 'Insufficient Balance' : 'Pay from Wallet'}
        </button>
      </div>
    </div>
  `;
  
  els.paymentContent.innerHTML = dialogHTML;
  els.paymentDialog.classList.remove('hidden');
  
  setupDialogInteractions(run, regoFee, currency, walletBalance, allHashHandles, payForOthersOnly);
}

// Render person selector using datalist (text input with autocomplete)
function renderPersonSelector(hashHandles, uniqueId) {
  const datalistId = `hashers-list-${uniqueId}`;
  return `
    <div class="person-selector">
      <input type="text" list="${datalistId}" class="hasher-input" placeholder="Enter hash handle">
      <datalist id="${datalistId}">
        ${hashHandles.map(h => `<option value="${h}">`).join('')}
      </datalist>
      <button type="button" class="btn-confirm-person">Add</button>
    </div>
  `;
}

// Setup dialog interactions
function setupDialogInteractions(run, regoFee, currency, walletBalance, allHashHandles, payForOthersOnly = false) {
  // Toggle sections
  const toggles = [
    { cb: '#cbRegoOthers', details: '#regoOthersDetails' },
    { cb: '#cbSponOthers', details: '#sponOthersDetails' }
  ];
  
  // Only add self toggles if not pay for others only
  if (!payForOthersOnly) {
    toggles.unshift(
      { cb: '#cbRegoSelf', details: '#regoSelfDetails' },
      { cb: '#cbSponSelf', details: '#sponSelfDetails' }
    );
  }
  
  toggles.forEach(({ cb, details }) => {
    const checkbox = document.querySelector(cb);
    const detailsEl = document.querySelector(details);
    if (checkbox && detailsEl) {
      checkbox.onchange = () => {
        detailsEl.classList.toggle('hidden', !checkbox.checked);
        updateTotal();
      };
    }
  });
  
  // Add Rego Other
  let regoOtherCount = 0;
  document.getElementById('btnAddRegoOther').onclick = () => {
    const container = document.getElementById('regoOthersList');
    const id = `rego-${regoOtherCount++}`;
    
    const div = document.createElement('div');
    div.className = 'other-person-row';
    div.dataset.id = id;
    div.innerHTML = `
      <div class="person-header">
        ${renderPersonSelector(allHashHandles, id)}
        <button type="button" class="btn-remove-person">×</button>
      </div>
      <div class="person-details hidden">
        <p class="fee-display">Fee: ${formatCurrency(regoFee, currency)}</p>
      </div>
    `;
    
    setupPersonSelector(div, updateTotal);
    div.querySelector('.btn-remove-person').onclick = () => {
      div.remove();
      updateTotal();
    };
    
    container.appendChild(div);
  };
  
  // Add Sponsorship Other
  let sponOtherCount = 0;
  document.getElementById('btnAddSponOther').onclick = () => {
    const container = document.getElementById('sponOthersList');
    const id = `spon-${sponOtherCount++}`;
    
    const div = document.createElement('div');
    div.className = 'other-person-row';
    div.dataset.id = id;
    div.innerHTML = `
      <div class="person-header">
        ${renderPersonSelector(allHashHandles, id)}
        <button type="button" class="btn-remove-person">×</button>
      </div>
      <div class="person-details hidden">
        <div class="amount-input">
          <label>Amount: 
            <input type="number" class="spon-amount" min="0" step="0.01" placeholder="Enter amount">
          </label>
        </div>
      </div>
    `;
    
    setupPersonSelector(div, updateTotal);
    
    // Add change handler for amount input
    const amountInput = div.querySelector('.spon-amount');
    if (amountInput) {
      amountInput.addEventListener('input', updateTotal);
      amountInput.addEventListener('change', updateTotal);
    }
    
    div.querySelector('.btn-remove-person').onclick = () => {
      div.remove();
      updateTotal();
    };
    
    container.appendChild(div);
  };
  
  // Self sponsorship amount change
  const sponSelfAmount = document.getElementById('sponSelfAmount');
  if (sponSelfAmount) {
    sponSelfAmount.addEventListener('input', updateTotal);
    sponSelfAmount.addEventListener('change', updateTotal);
  }
  
  // Cancel button
  document.getElementById('btnCancel').onclick = () => closePaymentDialog();
  
  // Pay button
  document.getElementById('btnPay').onclick = async () => {
    await processPayment(run);
  };
  
  // Initial total
  updateTotal();
  
  // Calculate and update total
  function updateTotal() {
    let total = 0;
    
    // Rego Self (only if element exists)
    const cbRegoSelf = document.getElementById('cbRegoSelf');
    if (cbRegoSelf && cbRegoSelf.checked) {
      total += regoFee || 0;
    }
    
    // Rego Others
    document.querySelectorAll('#regoOthersList .other-person-row').forEach(row => {
      if (row.dataset.hasher) {
        total += regoFee || 0;
      }
    });
    
    // Sponsorship Self (only if element exists)
    const cbSponSelf = document.getElementById('cbSponSelf');
    if (cbSponSelf && cbSponSelf.checked) {
      const amt = parseFloat(document.getElementById('sponSelfAmount')?.value || 0);
      total += amt;
    }
    
    // Sponsorship Others
    document.querySelectorAll('#sponOthersList .other-person-row').forEach(row => {
      if (row.dataset.hasher) {
        const amt = parseFloat(row.querySelector('.spon-amount')?.value || 0);
        total += amt;
      }
    });
    
    // Update display
    const totalDisplay = document.getElementById('totalAmount');
    if (totalDisplay) {
      totalDisplay.textContent = formatCurrency(total, currency);
    }
    
    // Enable/disable pay button
    const btnPay = document.getElementById('btnPay');
    if (btnPay) {
      btnPay.disabled = total <= 0 || walletBalance < total;
      btnPay.textContent = walletBalance < total ? 'Insufficient Balance' : 'Pay from Wallet';
    }
  }
}

// Setup person selector - for datalist approach
function setupPersonSelector(container, onChange) {
  const input = container.querySelector('.hasher-input');
  const confirmBtn = container.querySelector('.btn-confirm-person');
  const details = container.querySelector('.person-details');
  
  if (!input || !confirmBtn) {
    console.error('Person selector elements not found:', { input, confirmBtn });
    return;
  }
  
  confirmBtn.onclick = () => {
    const hasher = input.value.trim();
    if (hasher) {
      const row = container.closest('.other-person-row');
      row.dataset.hasher = hasher;
      details.classList.remove('hidden');
      input.disabled = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Added';
      
      if (typeof onChange === 'function') {
        onChange();
      }
    }
  };
  
  // Allow Enter key to confirm
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmBtn.click();
    }
  });
}

// ENHANCED: Process payment with client-side batch writes
async function processPayment(run) {
  console.log('processPayment started');
  const btnPay = document.getElementById('btnPay');
  btnPay.disabled = true;
  btnPay.textContent = 'Processing...';
  
  try {
    console.log('Step 1: Gathering data');
    // Gather all data - use optional chaining for self checkboxes that may not exist
    console.log('Step 2: Getting checkbox values');
    const cbRegoSelf = document.getElementById('cbRegoSelf')?.checked || false;
    const cbRegoOthers = document.getElementById('cbRegoOthers').checked;
    const cbSponSelf = document.getElementById('cbSponSelf')?.checked || false;
    const cbSponOthers = document.getElementById('cbSponOthers').checked;
    console.log('Checkboxes:', { cbRegoSelf, cbRegoOthers, cbSponSelf, cbSponOthers });
    
    const currency = currentUserData.walletCurrency || 'NGN';
    const regoFee = run.regoFee || 0;
    
    // Build payment data structure
    let totalAmount = 0;
    
    console.log('Step 3: Building regoData');
    // REGO DATA
    const regoData = {
      self: { selected: false, amount: 0, forHashers: [] },
      others: []
    };
    
    if (cbRegoSelf) {
      regoData.self.selected = true;
      regoData.self.amount = regoFee;
      regoData.self.forHashers = [currentUserData.hashHandle || 'You'];
      totalAmount += regoData.self.amount;
    }
    console.log('Rego data built:', regoData);
    
    if (cbRegoOthers) {
      console.log('Processing rego others, rows found:', document.querySelectorAll('#regoOthersList .other-person-row').length);
      document.querySelectorAll('#regoOthersList .other-person-row').forEach((row, idx) => {
        console.log(`Row ${idx}:`, { hasher: row.dataset.hasher, id: row.dataset.id });
        const hasher = row.dataset.hasher;
        if (hasher) {
          const amount = regoFee;
          regoData.others.push({ hashHandle: hasher, amount });
          totalAmount += amount;
        }
      });
    }
    
    // SPONSORSHIP DATA
    const sponData = {
      self: { selected: false, amount: 0 },
      others: []
    };
    
    if (cbSponSelf) {
      sponData.self.selected = true;
      sponData.self.amount = parseFloat(document.getElementById('sponSelfAmount')?.value || 0);
      totalAmount += sponData.self.amount;
    }
    
    if (cbSponOthers) {
      console.log('Processing spon others, rows found:', document.querySelectorAll('#sponOthersList .other-person-row').length);
      document.querySelectorAll('#sponOthersList .other-person-row').forEach((row, idx) => {
        console.log(`Spon Row ${idx}:`, { hasher: row.dataset.hasher, id: row.dataset.id, amount: row.querySelector('.spon-amount')?.value });
        const hasher = row.dataset.hasher;
        if (hasher) {
          const amount = parseFloat(row.querySelector('.spon-amount')?.value || 0);
          console.log(`Adding sponsor: ${hasher}, amount: ${amount}`);
          sponData.others.push({ hashHandle: hasher, amount });
          totalAmount += amount;
        }
      });
    }
    
    // Verify total
    if (totalAmount <= 0) {
      alert('Please select at least one payment option');
      btnPay.disabled = false;
      btnPay.textContent = 'Pay from Wallet';
      return;
    }
    
    // Verify wallet balance
    const currentBalance = currentUserData.walletBalance || 0;
    if (currentBalance < totalAmount) {
      throw new Error('Insufficient wallet balance');
    }
    
    console.log('Step 4: Getting history ID');
    // Get history ID - this is the ID we need to pass to trail
    const historyId = await getHistoryRunId(run.runId, run.date);
    
    console.log('History ID for payment:', historyId);
    
    // Get kennel info for wallet path
    // Use the fields that ALREADY EXIST on the run document
    const country = run.country || 'Nigeria';
    const state = run.state || currentState;
    const kennelName = run.kennel || '';

    if (!kennelName) {
      throw new Error('Run is missing kennel name');
    }
    
    // Build status string
    const statusParts = [];
    if (regoData.self.selected || regoData.others.length > 0) statusParts.push('Rego');
    if (sponData.self.selected || sponData.others.length > 0) statusParts.push('Sponsorship');
    
    // Create payment request
    const paymentRequestData = {
      userId: currentUserId,
      runId: historyId,
      runDate: run.date,
      historyId: historyId,
      kennel: kennelName,
      country: country,
      state: state,
      type: 'run-payment',
      currency: currency,
      status: statusParts.join(', '),
      createdAt: Timestamp.now(),
      approvedAt: Timestamp.now(),
      
      // Rego
      regoAmount: regoData.self.amount + regoData.others.reduce((s, o) => s + o.amount, 0),
      regoStatus: (regoData.self.selected || regoData.others.length > 0) ? 'Paid' : 'Not Paid',
      regoSelf: regoData.self,
      regoOthers: regoData.others,
      
      // Sponsorship
      sponsorshipAmount: sponData.self.amount + sponData.others.reduce((s, o) => s + o.amount, 0),
      sponsorshipStatus: (sponData.self.selected || sponData.others.length > 0) ? 'Paid' : 'Not Paid',
      sponsorshipSelf: sponData.self,
      sponsorshipOthers: sponData.others,
      
      totalAmount: totalAmount
    };
    
    // Execute batch
    const batch = writeBatch(window.db);
    
    // 1. Update user wallet
    const userRef = doc(window.db, 'users', currentUserId);
    batch.update(userRef, {
      walletBalance: increment(-totalAmount)
    });
    
    // 2. Create payment request
    const paymentRequestRef = doc(collection(window.db, 'paymentRequests'));
    batch.set(paymentRequestRef, paymentRequestData);
    
    // 3. Update run history with payment info - APPEND to arrays, don't replace
    const historyRef = doc(window.db, 'runsHistory', historyId);
    
    // Prepare arrays of new names to add
    const newForHashers = [
      ...(regoData.self.selected ? regoData.self.forHashers : []),
      ...regoData.others.map(o => o.hashHandle)
    ].filter(h => h);
    
    const newSponsors = [
      ...(sponData.self.selected ? [currentUserData.hashHandle] : []),
      ...sponData.others.map(o => o.hashHandle)
    ].filter(h => h);
    
    console.log('Adding to forHashers:', newForHashers);
    console.log('Adding to sponsors:', newSponsors);
    
    // Use arrayUnion to APPEND, not replace
    if (newForHashers.length > 0) {
      batch.update(historyRef, {
        'payments.rego.totalAmount': increment(paymentRequestData.regoAmount),
        'payments.rego.forHashers': arrayUnion(...newForHashers),
        'payments.rego.paidBy': currentUserId,
        'payments.rego.paymentRequestId': paymentRequestRef.id
      });
    }
    
    if (newSponsors.length > 0) {
      batch.update(historyRef, {
        'payments.sponsorship.totalAmount': increment(paymentRequestData.sponsorshipAmount),
        'payments.sponsorship.sponsors': arrayUnion(...newSponsors),
        'payments.sponsorship.paidBy': currentUserId,
        'payments.sponsorship.paymentRequestId': paymentRequestRef.id
      });
    }
    
    // 4. Add user to joined subcollection
    batch.set(doc(window.db, 'runsHistory', historyId, 'joined', currentUserId), {
      userId: currentUserId,
      joinedAt: Timestamp.now(),
      paymentRequestId: paymentRequestRef.id,
      paid: true
    });
    
    // 5. Update kennel wallets
    const walletsRef = doc(window.db, 'locations', country, 'states', state, 'kennels', kennelName, 'wallets', 'main');
    const walletsSnap = await getDoc(walletsRef);
    
    const historyEntry = {
      paymentRequestId: paymentRequestRef.id,
      timestamp: Timestamp.now(),
      userId: currentUserId,
      runId: run.runId,
      historyId: historyId
    };
    
    const walletUpdates = {};
    
    // Rego wallet
    const totalRego = paymentRequestData.regoAmount;
    if (totalRego > 0) {
      if (walletsSnap.exists()) {
        walletUpdates['regoWallet.totalAmount'] = increment(totalRego);
        walletUpdates['regoWallet.history'] = arrayUnion({
          ...historyEntry,
          amount: totalRego,
          forHashers: [
            ...(regoData.self.selected ? regoData.self.forHashers : []),
            ...regoData.others.map(o => o.hashHandle)
          ]
        });
      } else {
        walletUpdates.regoWallet = {
          totalAmount: totalRego,
          history: [{
            ...historyEntry,
            amount: totalRego,
            forHashers: [
              ...(regoData.self.selected ? regoData.self.forHashers : []),
              ...regoData.others.map(o => o.hashHandle)
            ]
          }]
        };
      }
    }
    
    // Sponsorship wallet
    const totalSpon = paymentRequestData.sponsorshipAmount;
    if (totalSpon > 0) {
      if (walletsSnap.exists()) {
        walletUpdates['sponsorshipWallet.totalAmount'] = increment(totalSpon);
        walletUpdates['sponsorshipWallet.history'] = arrayUnion({
          ...historyEntry,
          amount: totalSpon,
          sponsors: [
            ...(sponData.self.selected ? [currentUserData.hashHandle] : []),
            ...sponData.others.map(o => o.hashHandle)
          ]
        });
      } else {
        walletUpdates.sponsorshipWallet = {
          totalAmount: totalSpon,
          history: [{
            ...historyEntry,
            amount: totalSpon,
            sponsors: [
              ...(sponData.self.selected ? [currentUserData.hashHandle] : []),
              ...sponData.others.map(o => o.hashHandle)
            ]
          }]
        };
      }
    }
    
    // Apply wallet updates
    if (Object.keys(walletUpdates).length > 0) {
      if (walletsSnap.exists()) {
        batch.update(walletsRef, walletUpdates);
      } else {
        batch.set(walletsRef, walletUpdates);
      }
    }
	
		// 6. UPDATE USER STATISTICS - ADD THIS
    const kennelKey = run.kennel || 'Unknown';
    batch.update(userRef, {
      totalRuns: increment(1),
      [`kennelStats.${kennelKey}`]: increment(1)
    });	

    console.log('Step 5: About to commit batch');
    await batch.commit();
    console.log('Step 6: Batch committed successfully');
	
	 // ADD THIS: Play success sounds
    if (regoData.self.selected || regoData.others.length > 0) {
      audioSystem.play('rego');
    }
    if (sponData.self.selected || sponData.others.length > 0) {
      audioSystem.play('sponsorship');
    }
    
    // IMPORTANT: Save history ID to localStorage (like Kotlin SharedPreferences)
    localStorage.setItem('currentRunId', historyId);
    console.log('Saved currentRunId to localStorage:', historyId);
    
    console.log('Step 7: Updating local run object');
    // Update local run object so button changes to "Joined"
    const runIndex = runsList.findIndex(r => r.runId === run.runId);
    if (runIndex !== -1) {
      runsList[runIndex].joined = true;
      runsList[runIndex].historyId = historyId;
    }
    console.log('Step 8: Run object updated');
    
    console.log('Step 9: Updating joinedRunIds');
    // Update joined status tracking - allow multiple runs
    joinedRunIds.add(run.runId);
    console.log('Step 10: joinedRunIds updated');
    
    console.log('Step 11: Closing payment dialog');
    // Success
    closePaymentDialog();
    console.log('Step 12: Payment dialog closed');
    
    console.log('Step 13: Showing success dialog');
    showSuccessDialog({
      totalPaid: totalAmount,
      remainingBalance: currentUserData.walletBalance - totalAmount,
      currency: currency,
      registrationId: paymentRequestRef.id,
      historyId: historyId
    });
    console.log('Step 14: Success dialog shown');
    
    console.log('Step 15: Refreshing UI');
    // Refresh UI immediately
    renderRunsList();
    console.log('Step 16: UI refreshed');
    
  } catch (err) {
    console.error('Payment error at step:', err);
    console.error('Error stack:', err.stack);
    alert('Payment failed: ' + err.message);
    btnPay.disabled = false;
    btnPay.textContent = 'Pay from Wallet';
  }
}

function showSuccessDialog(result) {
  const dialog = document.createElement('div');
  dialog.className = 'dialog-overlay';
  dialog.innerHTML = `
    <div class="success-dialog">
      <h2>🎉 ON ON! You're Registered!</h2>
      <div class="success-details">
        <p><strong>Registration confirmed!</strong></p>
        <p>Total Paid: ${formatCurrency(result.totalPaid, result.currency)}</p>
        <p>Remaining Balance: ${formatCurrency(result.remainingBalance, result.currency)}</p>
        <p>Registration ID: ${result.registrationId}</p>
      </div>
      <button type="button" id="btnNavigateToTrail" class="btn-primary" style="margin-right: 10px;">Navigate to Trail</button>
      <button type="button" id="btnDone" class="btn-secondary">ON ON!</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // Navigate to trail button - uses history ID
  dialog.querySelector('#btnNavigateToTrail').onclick = () => {
    const run = selectedRunForPayment;
    if (run) {
      const params = new URLSearchParams({
        destination_lat: run.lat,
        destination_lng: run.lng,
        runId: result.historyId,
        kennelId: run.kennelId || '',
        currentState: run.state || currentState || '',
        fromRunsActivity: 'true',
        isTopLevelRuns: 'true'
      });
      window.location.href = `trail.html?${params.toString()}`;
    }
    dialog.remove();
  };
  
  dialog.querySelector('#btnDone').onclick = () => {
    dialog.remove();
  };
}

// Show Rego List Dialog
async function showRegoListDialog(run) {
  try {
    // Get history ID
    const historyId = await getHistoryRunId(run.runId, run.date);
    
    // Get rego data from history
    const historyDoc = await getDoc(doc(window.db, 'runsHistory', historyId));
    const historyData = historyDoc.data() || {};
    const payments = historyData.payments || {};
    const regoData = payments.rego || {};
    const forHashers = regoData.forHashers || [];
    
    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.innerHTML = `
      <div class="rego-list-dialog" style="background: white; border-radius: 12px; padding: 20px; max-width: 400px; width: 90%; max-height: 70vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 2px solid var(--clr-primary); padding-bottom: 12px;">
          <h3 style="margin: 0; color: var(--clr-primary);">📋 Rego List</h3>
          <button class="btn-close-rego" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
        </div>
        
        <div style="margin-bottom: 12px;">
          <strong>🏃 ${run.title}</strong><br>
          <small>📅 ${formatDate(run.date)} | 🏃 Run #${run.runNumber}</small>
        </div>
        
        ${forHashers.length === 0 ? 
          `<p style="text-align: center; color: #666; padding: 20px;">No hashers registered yet</p>` :
          `<div style="background: #f5f5f5; border-radius: 8px; padding: 12px;">
            <p style="margin: 0 0 8px 0; font-weight: bold; color: var(--clr-primary);">
              🍺 ${forHashers.length} Hasher${forHashers.length !== 1 ? 's' : ''} Registered
            </p>
            <ol style="margin: 0; padding-left: 24px; line-height: 1.8;">
              ${forHashers.map((hasher, idx) => `
                <li style="padding: 4px 0; border-bottom: ${idx < forHashers.length - 1 ? '1px dashed #ddd' : 'none'};">
                  <span style="font-weight: 500;">${hasher}</span>
                </li>
              `).join('')}
            </ol>
          </div>`
        }
        
        <div style="margin-top: 16px; text-align: center;">
          <button class="btn-done-rego" style="background: var(--clr-primary); color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-weight: 500;">ON ON!</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Close handlers
    dialog.querySelector('.btn-close-rego').onclick = () => dialog.remove();
    dialog.querySelector('.btn-done-rego').onclick = () => dialog.remove();
    dialog.onclick = (e) => {
      if (e.target === dialog) dialog.remove();
    };
    
  } catch (err) {
    console.error('Error loading rego list:', err);
    alert('Failed to load rego list');
  }
}
async function handleLeaveClick(run) {
  if (!confirm(`Leave "${run.title}"?`)) return;
  
  try {
    await leaveRun(run.runId);
  } catch (err) {
    console.error('Error leaving run:', err);
    alert('Failed to leave run');
  }
}

async function leaveRun(runId) {
  const run = runsList.find(r => r.runId === runId);
  if (!run) return;
  
  const historySnap = await getDocs(
    query(
      collection(window.db, 'runsHistory'),
      where('templateId', '==', runId),
      where('date', '==', run.date),
      limit(1)
    )
  );
  
  if (historySnap.empty) return;
  
  const historyId = historySnap.docs[0].id;
  await deleteDoc(doc(window.db, 'runsHistory', historyId, 'joined', currentUserId));
  
  // Clear from localStorage if it matches
  const savedRunId = localStorage.getItem('currentRunId');
  if (savedRunId === historyId) {
    localStorage.removeItem('currentRunId');
  }
  
  // Update local tracking
  joinedRunIds.delete(runId);
  if (joinedRunIdToday === runId) {
    joinedRunIdToday = null;
  }
  
  renderRunsList();
}

function showRunDetails(run) {
  els.detailImage.src = run.imageUrl || 'images/placeholder_run.png';
  els.detailInfo.innerHTML = `
    <h3>${run.title}</h3>
    <p><strong>🏃 Run Number:</strong> ${run.runNumber}</p>
    <p><strong>📅 Date:</strong> ${formatDate(run.date)}</p>
    <p><strong>🕐 Time:</strong> ${run.time || 'TBA'}</p>
    <p><strong>📍 Location:</strong> ${run.address || 'Unknown'}</p>
    <p><strong>💰 Rego Fee:</strong> ${formatCurrency(run.regoFee, 'NGN')}</p>
    <p><strong>🎯 Trail Type:</strong> ${run.trailType || 'N/A'}</p>
    <p><strong>👤 Hare:</strong> ${run.hare || 'N/A'}</p>
  `;
  
  els.btnNavigate.dataset.runId = run.runId;
  els.runDetailsDialog.classList.remove('hidden');
}

function showDeleteDialog(run) {
  runToDelete = run;
  els.deleteMessage.textContent = `Permanently remove '${run.title}'?`;
  els.deleteDialog.classList.remove('hidden');
}

async function confirmDeleteRun() {
  if (!runToDelete) return;
  
  try {
    await deleteDoc(doc(window.db, 'runs', runToDelete.runId));
    
    const index = runsList.findIndex(r => r.runId === runToDelete.runId);
    if (index !== -1) {
      runsList.splice(index, 1);
      renderRunsList();
    }
    
    alert('Run deleted');
    
  } catch (err) {
    console.error('Error deleting run:', err);
    alert('Delete failed');
  } finally {
    els.deleteDialog.classList.add('hidden');
    runToDelete = null;
  }
}

function updateAddRunButton() {
  const hasRunToday = runsList.some(r => 
    r.kennelId === currentUserKennelId && r.date === todayDateString
  );
  
  els.btnAddRun.disabled = hasRunToday;
  els.btnAddRun.style.opacity = hasRunToday ? '0.4' : '1';
}

function setLoading(isLoading) {
  if (isLoading) {
    els.progressBarLoading.classList.remove('hidden');
  } else {
    els.progressBarLoading.classList.add('hidden');
  }
}

// NEW: Get or create history run ID (matches Kotlin historyRunId function)
async function getHistoryRunId(templateId, date) {
  try {
    // Try to find existing history document
    const historySnap = await getDocs(
      query(
        collection(window.db, 'runsHistory'),
        where('templateId', '==', templateId),
        where('date', '==', date),
        limit(1)
      )
    );
    
    if (!historySnap.empty) {
      return historySnap.docs[0].id;
    }
    
    // Not found - create it (like Kotlin does)
    const templateDoc = await getDoc(doc(window.db, 'runs', templateId));
    const template = templateDoc.data();
    
    const newHistoryRef = doc(collection(window.db, 'runsHistory'));
    const historyData = {
      templateId: templateId,
      kennel: template?.kennel || '',
      state: template?.state || '',
      title: template?.title || '',
      runNumber: template?.runNumber || 0,
      date: date,
      time: template?.time || '',
      address: template?.address || '',
      lat: template?.lat || 0,
      lng: template?.lng || 0,
      regoFee: template?.regoFee || 0,
      trailType: template?.trailType || '',
      hare: template?.hare || '',
      imageUrl: template?.imageUrl || '',
      createdAt: Timestamp.now(),
      accNo: template?.accNo || '',
      accName: template?.accName || '',
      bank: template?.bank || ''
    };
    
    await setDoc(newHistoryRef, historyData);
    return newHistoryRef.id;
    
  } catch (error) {
    console.error('Error getting history run ID:', error);
    return `${templateId}_${date}`;
  }
}

// ============================================
// BOTTOM NAVIGATION - EXACTLY LIKE PERSONAL PAGE
// ============================================

function setupBottomNavListeners() {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      const screen = item.dataset.screen;
      if (screen) {
        handleBottomNav(screen);
      }
    };
  });
}

function handleBottomNav(screen) {
  switch(screen) {
    case 'home':
      window.location.href = 'index.html';
      break;
    case 'runs':
      // Already on runs
      break;
    case 'trails':
      window.location.href = 'trail.html';
      break;
    case 'chat':
      window.location.href = 'chat.html';
      break;
    case 'more':
      showMoreOptions();
      break;
  }
}

function showMoreOptions() {
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
    await signOut(window.auth);
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
}
