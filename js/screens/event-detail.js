import { collection, doc, getDoc, getDocs, onSnapshot, addDoc, Timestamp, query, where, orderBy, limit, writeBatch, increment, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// Bank name to code mapping for Paystack
const BANK_CODES = {
  'Opay': '305',
  'OPay': '305',
  'GTBank': '058',
  'GTB': '058',
  'First Bank': '011',
  'FirstBank': '011',
  'UBA': '033',
  'Zenith Bank': '057',
  'Zenith': '057',
  'Access Bank': '044',
  'Access': '044',
  'Wema Bank': '035',
  'Wema': '035',
  'Polaris Bank': '076',
  'Polaris': '076',
  'FCMB': '214',
  'Fidelity': '070',
  'Union Bank': '032',
  'Unity Bank': '215',
  'Sterling Bank': '232',
  'Sterling': '232',
  'Ecobank': '050',
  'Heritage Bank': '030',
  'Keystone': '082',
  'Stanbic IBTC': '221',
  'Standard Chartered': '068',
  'Jaiz Bank': '301',
  'SunTrust': '100',
  'Providus': '101',
  'Titan Paystack': '100039',
  'Titan': '100039'
};

async function getBankCode(bankName) {
  if (!bankName) throw new Error('Bank name is required');
  
  const code = BANK_CODES[bankName];
  if (code) return code;
  
  // Try to fetch from Paystack if not in mapping
  try {
    const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    });
    const data = await response.json();
    if (data.status) {
      const bank = data.data.find(b => 
        b.name.toLowerCase().includes(bankName.toLowerCase()) ||
        bankName.toLowerCase().includes(b.name.toLowerCase())
      );
      if (bank) return bank.code;
    }
  } catch (error) {
    console.error('Failed to fetch bank code:', error);
  }
  
  throw new Error(`Unknown bank: ${bankName}. Please add to BANK_CODES mapping.`);
}

// DEBUG: Check URL parameters - MUST BE FIRST
console.log('URL:', window.location.href);
console.log('Search params:', window.location.search);
const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('id');
console.log('eventId:', eventId);

if (!eventId) {
  window.location.href = 'events.html';
}

// SPEED OPTIMIZATION: Preload critical data immediately
const PRELOADED_DATA = {
  event: null,
  startTime: performance.now()
};

// Preload event data as soon as script loads (don't wait for DOM)
if (eventId) {
  // Start fetching event data immediately
  getDoc(doc(window.db, 'events', eventId)).then(snap => {
    if (snap.exists()) {
      PRELOADED_DATA.event = { id: snap.id, ...snap.data() };
      PRELOADED_DATA.loadTime = performance.now() - PRELOADED_DATA.startTime;
      console.log(`Event preloaded in ${PRELOADED_DATA.loadTime}ms`);
    }
  }).catch(err => console.warn('Preload failed:', err));
}

// Debounce function to prevent excessive re-renders
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Global variables
let currentUser = null;
let currentUserData = null;
let eventData = null;
let fireListener = null;
let map = null;
let marker = null;

// ADD THIS: Audio system for payment notifications
const audioSystem = {
  sounds: {
    rego: null,
    accommodation: null,
    sponsorship: null
  },
  enabled: false,
  init() {
    // Preload sounds
    this.sounds.rego = new Audio('./sounds/event_rego_received.mp3');
    this.sounds.accommodation = new Audio('./sounds/new_accommodation_payment.mp3');
    this.sounds.sponsorship = new Audio('./sounds/new_sponsorship.mp3');
    
    // Preload
    Object.values(this.sounds).forEach(audio => {
      if (audio) audio.preload = 'auto';
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
    const audio = this.sounds[type].cloneNode();
    audio.play().catch(e => console.log('Audio play failed:', e));
  }
};
audioSystem.init();

// DOM Elements
const els = {
  ivEventImage: document.getElementById('ivEventImage'),
  tvEventKennel: document.getElementById('tvEventKennel'),
  tvEventTitle: document.getElementById('tvEventTitle'),
  tvStartDate: document.getElementById('tvStartDate'),
  tvEndDate: document.getElementById('tvEndDate'),
  tvEventRegoFee: document.getElementById('tvEventRegoFee'),
  tvEventAddress: document.getElementById('tvEventAddress'),
  tvSponsorship: document.getElementById('tvSponsorship'),
  tvWhatToExpect: document.getElementById('tvWhatToExpect'),
    tvEventDetails: document.getElementById('tvEventDetails'), // ADD THIS: Event details display

  tvSignedBy: document.getElementById('tvSignedBy'),
  containerAccommodation: document.getElementById('containerAccommodation'),
  btnJoinEvent: document.getElementById('btnJoinEvent'),
  btnNavigateMap: document.getElementById('btnNavigateMap'),
  btnShareEvent: document.getElementById('btnShareEvent'),
  walletBalanceDisplay: document.getElementById('walletBalanceDisplay')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    currentUser = user;
    await loadUserData();
    loadEvent();
  });
});

// Load current user data (including wallet)
async function loadUserData() {
  try {
    const userDoc = await getDoc(doc(window.db, 'users', currentUser.uid));
    if (!userDoc.exists()) {
      console.error('User document not found');
      return;
    }
    currentUserData = userDoc.data();
    updateWalletDisplay();
  } catch (err) {
    console.error('Error loading user data:', err);
  }
}

// Update wallet balance display
function updateWalletDisplay() {
  const balance = currentUserData?.walletBalance || 0;
  const currency = currentUserData?.walletCurrency || 'NGN';
  if (els.walletBalanceDisplay) {
    els.walletBalanceDisplay.textContent = `Wallet: ${formatCurrency(balance, currency)}`;
  }
}

// Load event data - OPTIMIZED with caching and single fetch
let eventCache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60000; // 1 minute cache

async function loadEvent() {
  // Use preloaded data if available
  if (PRELOADED_DATA.event) {
    eventData = PRELOADED_DATA.event;
    populateUI();
    console.log('Using preloaded event data');
  }
  
  const now = Date.now();
  if (eventCache && (now - lastFetchTime < CACHE_DURATION)) {
    if (!PRELOADED_DATA.event) {
      eventData = eventCache;
      populateUI();
    }
    return;
  }
  
  try {
    // Use getDoc for initial load (faster than onSnapshot)
    const snap = await getDoc(doc(window.db, 'events', eventId));
    
    if (!snap.exists()) {
      window.location.href = 'events.html';
      return;
    }
    
    eventData = { id: snap.id, ...snap.data() };
    eventCache = eventData;
    lastFetchTime = now;
    
    populateUI();
    
    // Set up real-time listener ONLY after initial render
    // This prevents blocking the initial page load
    if (!fireListener) {
      fireListener = onSnapshot(doc(window.db, 'events', eventId), (updateSnap) => {
        if (updateSnap.exists()) {
          const newData = { id: updateSnap.id, ...updateSnap.data() };
          // Only update if data actually changed
          if (JSON.stringify(newData) !== JSON.stringify(eventCache)) {
            eventData = newData;
            eventCache = newData;
            lastFetchTime = Date.now();
            populateUI();
          }
        }
      }, { includeMetadataChanges: false }); // Skip metadata changes for speed
    }
  } catch (err) {
    console.error('Error loading event:', err);
    // Fallback to events list on error
    window.location.href = 'events.html';
  }
}

// Populate UI with event data
const populateUI = () => {
  const e = eventData;
  
  // Basic info
  els.tvEventTitle.textContent = e.title || '';
  els.tvEventKennel.textContent = `${e.kennel}  ·  ${e.state}, ${e.country}`;
  els.tvStartDate.textContent = e.startDate || '';
  els.tvEndDate.textContent = e.endDate || '';
  els.tvEventAddress.textContent = e.address || '';
  els.tvSponsorship.textContent = e.sponsorship || 'N/A';
  els.tvWhatToExpect.textContent = e.whatToExpect || 'N/A';
// ADD THIS: Display event details with emoji and formatting
  els.tvEventDetails.textContent = e.eventDetails || '📋 No details provided';
  
   // Handle signedBy - single object or array
  if (Array.isArray(e.signedBy) && e.signedBy.length > 0) {
    // Collaboration: multiple signers
    const signerTexts = e.signedBy.map(s => 
      s.designation ? `${s.hashHandle} (${s.designation})` : s.hashHandle
    );
    els.tvSignedBy.textContent = signerTexts.join(', ');
  } else if (e.signedBy && typeof e.signedBy === 'object') {
    // Single: object format
    const s = e.signedBy;
    els.tvSignedBy.textContent = s.designation ? `${s.hashHandle} (${s.designation})` : s.hashHandle;
  } else {
    // Legacy: string format
    els.tvSignedBy.textContent = e.signedBy || '';
  }
  
  // Currency - check both new and legacy format
  const currency = e.pricing?.currency || e.currency || 'USD';
  
  // Rego fee - check both new and legacy format
  let regoFee = 0;
  let feeLabel = 'Rego Fee';
  
  if (e.pricing?.regular?.regoFee) {
    const pricing = e.pricing;
    const earlyBird = pricing.earlyBird;
    const now = new Date();
    const earlyBirdDeadline = earlyBird?.deadline ? new Date(earlyBird.deadline) : null;
    const isEarlyBird = earlyBird?.enabled && earlyBirdDeadline && now <= earlyBirdDeadline;
    
    regoFee = isEarlyBird ? earlyBird.regoFee : pricing.regular.regoFee;
    feeLabel = isEarlyBird ? 'Early Bird Rego' : 'Regular Rego';
  } else {
    regoFee = e.regoFee || 0;
  }
  
  els.tvEventRegoFee.textContent = `${feeLabel}: ${formatCurrency(regoFee, currency)}`;
  
  // Accommodation - check both new and legacy format
  const accommodation = e.pricing?.regular?.accommodation || e.accommodation || [];
  renderAccommodation(accommodation, currency);
  
  // Event image - ULTRA OPTIMIZED with lazy loading and intersection observer
  if (els.ivEventImage) {
    // Use Intersection Observer for lazy loading
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            loadEventImage(img, e.imageUrl);
            observer.unobserve(img);
          }
        });
      }, {
        rootMargin: '50px 0px', // Start loading 50px before visible
        threshold: 0.01
      });
      
      imageObserver.observe(els.ivEventImage);
    } else {
      // Fallback for browsers without IntersectionObserver
      loadEventImage(els.ivEventImage, e.imageUrl);
    }
  }
  
  // Setup buttons
  setupButtons();
};

// Separate function for image loading
function loadEventImage(imgElement, imageUrl) {
  if (!imageUrl) {
    imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
    return;
  }
  
  // Use smaller image if available (Firebase Storage can resize via URL params)
  // If using Firebase Storage, append ?w=800 for smaller size
  const optimizedUrl = imageUrl.includes('firebasestorage.googleapis.com') 
    ? `${imageUrl}?alt=media&w=800` 
    : imageUrl;
  
  // Set loading attributes
  imgElement.loading = 'lazy';
  imgElement.decoding = 'async';
  
  // Create new image for preloading
  const preloadImg = new Image();
  
  preloadImg.onload = () => {
    imgElement.src = optimizedUrl;
    imgElement.classList.remove('image-error');
  };
  
  preloadImg.onerror = () => {
    console.warn('Failed to load event image:', imageUrl);
    imgElement.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkVycm9yIExvYWRpbmc8L3RleHQ+PC9zdmc+';
    imgElement.classList.add('image-error');
  };
  
  // Delay loading slightly to prioritize critical content
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      preloadImg.src = optimizedUrl;
    }, { timeout: 1000 });
  } else {
    setTimeout(() => {
      preloadImg.src = optimizedUrl;
    }, 100);
  }
}

// Render accommodation chips - DYNAMIC VERSION
function renderAccommodation(list, currency) {
  // Store raw data and start real-time listener
  currentAccommodationData = list.map(room => ({
    ...room,
    booked: room.booked || 0,
    remaining: room.qty - (room.booked || 0)
  }));
  
  // Start listening for real-time updates
  startAccommodationListener();
  
  // Initial render
  updateAccommodationDisplay(currentAccommodationData, currency);
}

// Setup button listeners
function setupButtons() {
  els.btnShareEvent.onclick = shareEvent;
  els.btnNavigateMap.onclick = navigateToEvent;
  els.btnJoinEvent.onclick = showJoinDialog;
  
  // Back button functionality
  const btnBack = document.getElementById('btnBack');
  if (btnBack) {
    btnBack.onclick = () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = 'events.html';
      }
    };
  }
}

// Format currency
function formatCurrency(amount, code) {
  const currency = code && code.length === 3 ? code : 'USD';
  return new Intl.NumberFormat('en', { 
    style: 'currency', 
    currency 
  }).format(amount || 0);
}

// Share event
function shareEvent() {
  const e = eventData;
  const pricing = e.pricing || {};
  const regular = pricing.regular || {};
  const currency = pricing.currency || 'USD';
  
  const text = `${e.title}
${e.startDate} to ${e.endDate}
📍 ${e.address}
💰 Rego: ${formatCurrency(regular.regoFee, currency)}
🏨 Accommodation available
🤝 ${e.sponsorship || 'No sponsorship info'}
👀 ${e.whatToExpect || 'N/A'}
✍️ Signed by: ${e.signedBy || 'N/A'}`;

  if (navigator.share) {
    navigator.share({ title: e.title, text });
  } else {
    navigator.clipboard.writeText(text);
    alert('Event details copied to clipboard!');
  }
}

// Navigate to event on map
function navigateToEvent() {
  const e = eventData;
  console.log('Event data:', e);
  
  localStorage.setItem('currentRunId', e.id);
  
  const params = new URLSearchParams({
    destination_lat: e.lat,
    destination_lng: e.lng,
    runId: e.id,
    kennelId: e.kennel || '',
    currentState: e.state || '',
    fromRunsActivity: 'true',
    isTopLevelRuns: 'true'
  });
  
  const url = `trail.html?${params.toString()}`;
  console.log('Navigating to URL:', url);
  
  window.location.href = url;
}

// Show join event dialog - ENHANCED VERSION with T-shirt and Drink selection
async function showJoinDialog() {
  if (!currentUserData || !eventData) return;
  
  const e = eventData;
  const pricing = e.pricing || {};
  const regular = pricing.regular || {};
  const currency = pricing.currency || 'NGN';
  
  // Check wallet balance
  const walletBalance = currentUserData.walletBalance || 0;
  
  // OPTIMIZATION: Use cached user list instead of fetching all users
  // Store hash handles in memory after first load
  if (!window.cachedHashHandles) {
    try {
      const usersSnap = await getDocs(query(collection(window.db, 'users'), limit(100)));
      window.cachedHashHandles = usersSnap.docs
        .map(d => d.data().hashHandle)
        .filter(h => h && h !== currentUserData.hashHandle)
        .sort();
    } catch (err) {
      window.cachedHashHandles = [];
    }
  }
  const allHashHandles = window.cachedHashHandles;
  
  // Create dialog HTML - OPTIMIZED: Single template literal, no nested functions
  const dialogHTML = `
    <div class="join-dialog">
      <h3>Join Event</h3>
      <div class="wallet-info">
        <p>Your Wallet Balance: <strong>${formatCurrency(walletBalance, currency)}</strong></p>
        ${walletBalance <= 0 ? '<p class="warning">Insufficient balance. Please top up.</p>' : ''}
      </div>
      
      <div class="payment-sections">
        <!-- REGO SECTION -->
        <div class="section rego-section">
          <h4>📝 Registration Fee</h4>
          
          <!-- Self Rego -->
          <div class="self-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbRegoSelf" checked>
              <span>Pay for myself (${currentUserData.hashHandle || 'You'})</span>
            </label>
            <div id="regoSelfDetails" class="selection-details">
              <p class="fee-display">Fee: ${formatCurrency(regular.regoFee || 0, currency)}</p>
              
              <!-- T-SHIRT & DRINK FOR SELF - Only shown when rego is selected -->
              <div class="rego-preferences" id="selfRegoPreferences">
                <p class="required-note">* Required for registration</p>
                
                <div class="preference-row">
                  <label class="required">T-Shirt Size *</label>
                  <div class="radio-group-horizontal" id="selfTshirtGroup">
                    <label><input type="radio" name="selfTshirtSize" value="M" checked><span>M</span></label>
                    <label><input type="radio" name="selfTshirtSize" value="L"><span>L</span></label>
                    <label><input type="radio" name="selfTshirtSize" value="XL"><span>XL</span></label>
                    <label><input type="radio" name="selfTshirtSize" value="XXL"><span>XXL</span></label>
                    <label><input type="radio" name="selfTshirtSize" value="XXXL"><span>XXXL</span></label>
                  </div>
                </div>
                
                <div class="preference-row">
                  <label class="required">Drink Preference *</label>
                  <div class="radio-group-horizontal drink-type-group" id="selfDrinkTypeGroup">
                    <label><input type="radio" name="selfDrinkType" value="beer" checked><span>Beer</span></label>
                    <label><input type="radio" name="selfDrinkType" value="soft"><span>Soft</span></label>
                    <label><input type="radio" name="selfDrinkType" value="malt"><span>Malt</span></label>
                  </div>
                  
                  <select id="selfDrinkBrand" class="drink-brand-select">
                    <optgroup label="Beer" data-type="beer">
                      <option value="Hero">Hero</option>
                      <option value="Heineken">Heineken</option>
                      <option value="Trophy">Trophy</option>
                      <option value="Star">Star</option>
                      <option value="Stout">Stout</option>
                      <option value="Smirnoff Ice">Smirnoff Ice</option>
                      <option value="Star Radler">Star Radler</option>
                      <option value="Desperado">Desperado</option>
                      <option value="Budweiser">Budweiser</option>
                      <option value="Tiger">Tiger</option>
                    </optgroup>
                    <optgroup label="Soft" data-type="soft" disabled hidden>
                      <option value="Coca-Cola">Coca-Cola</option>
                      <option value="Sprite">Sprite</option>
                      <option value="Bigi">Bigi</option>
                      <option value="Fanta">Fanta</option>
                      <option value="Water">Water</option>
                    </optgroup>
                    <optgroup label="Malt" data-type="malt" disabled hidden>
                      <option value="Malt">Malt</option>
                    </optgroup>
                  </select>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Others Rego -->
          <div class="others-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbRegoOthers">
              <span>Pay for others</span>
            </label>
            <div id="regoOthersDetails" class="selection-details hidden">
              <div id="regoOthersList"></div>
              <button type="button" id="btnAddRegoOther" class="btn-add-person">+ Add Person</button>
            </div>
          </div>
        </div>
        
        <!-- ACCOMMODATION SECTION -->
        <div class="section accommodation-section">
          <h4>🛏️ Accommodation</h4>
          
          <!-- Self Accommodation -->
          <div class="self-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbAccSelf">
              <span>Book for myself</span>
            </label>
            <div id="accSelfDetails" class="selection-details hidden">
              ${renderAccommodationSelector('self', regular.accommodation, currency)}
            </div>
          </div>
          
          <!-- Others Accommodation -->
          <div class="others-selection">
            <label class="checkbox-label">
              <input type="checkbox" id="cbAccOthers">
              <span>Book for others</span>
            </label>
            <div id="accOthersDetails" class="selection-details hidden">
              <div id="accOthersList"></div>
              <button type="button" id="btnAddAccOther" class="btn-add-person">+ Add Person</button>
            </div>
          </div>
        </div>
        
        <!-- SPONSORSHIP SECTION -->
        <div class="section sponsorship-section">
          <h4>🤝 Sponsorship</h4>
          
          <!-- Self Sponsorship -->
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
          
          <!-- Others Sponsorship -->
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
        <p>Total: <strong id="totalAmount">${formatCurrency(0, currency)}</strong></p>
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
        <button type="button" id="btnPay" class="btn-primary" ${walletBalance <= 0 ? 'disabled' : ''}>
          Pay from Wallet
        </button>
      </div>
    </div>
  `;
  
  // Create and show dialog - OPTIMIZED: Use DocumentFragment
  const dialog = document.createElement('div');
  dialog.className = 'dialog-overlay';
  dialog.innerHTML = dialogHTML;
  document.body.appendChild(dialog);
  
  // Setup dialog interactions
  setupDialogInteractions(dialog, regular, currency, walletBalance, allHashHandles);
}

// Render accommodation selector for a specific person (self or other)
function renderAccommodationSelector(personId, rooms, currency) {
  // Use currentAccommodationData for real-time availability
  const currentRooms = currentAccommodationData.length > 0 ? currentAccommodationData : rooms;
  
  if (!currentRooms || !currentRooms.length) {
    return '<p>No accommodation available</p>';
  }
  
  return `
    <div class="room-selections" data-person="${personId}">
      ${currentRooms.map((room, idx) => {
        const remaining = room.remaining !== undefined ? room.remaining : (room.qty - (room.booked || 0));
        const isSoldOut = remaining <= 0;
        const percentRemaining = (remaining / room.qty) * 100;
        
        // Determine status color for dialog
        let statusColor = '#4caf50'; // Green
        let statusText = `${remaining} available`;
        if (isSoldOut) {
          statusColor = '#d32f2f';
          statusText = 'SOLD OUT';
        } else if (percentRemaining <= 30) {
          statusColor = '#ff6b6b';
          statusText = `Only ${remaining} left!`;
        } else if (percentRemaining <= 50) {
          statusColor = '#ff9800';
          statusText = `${remaining} available`;
        }
        
        return `
        <div class="room-option ${isSoldOut ? 'sold-out' : ''}">
          <label class="checkbox-label ${isSoldOut ? 'disabled' : ''}">
            <input type="checkbox" class="room-checkbox" 
                   data-room-idx="${idx}" 
                   data-type="${room.roomType}" 
                   data-amount="${room.amount}"
                   data-remaining="${remaining}"
                   ${isSoldOut ? 'disabled' : ''}>
            <span>${room.roomType} - ${formatCurrency(room.amount, currency)} / night</span>
            <span class="availability-status" style="color: ${statusColor}; font-weight: ${percentRemaining <= 30 ? 'bold' : 'normal'};">
              ${statusText}
            </span>
          </label>
          <div class="room-details hidden" data-room-idx="${idx}">
            <label>Nights: 
              <select class="nights-select" data-room-idx="${idx}">
                ${Array.from({length: 10}, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}
              </select>
            </label>
            <label>Qty: 
              <input type="number" class="qty-input" data-room-idx="${idx}" 
                     min="1" max="${remaining}" value="1"
                     ${isSoldOut ? 'disabled' : ''}>
            </label>
            ${remaining < 3 ? `<p class="low-availability-warning">⚠️ Only ${remaining} room${remaining !== 1 ? 's' : ''} left!</p>` : ''}
          </div>
        </div>
      `}).join('')}
    </div>
  `;
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

// Setup dialog interactions - OPTIMIZED VERSION
function setupDialogInteractions(dialog, regular, currency, walletBalance, allHashHandles) {
  // OPTIMIZED: Cache selectors for updateTotal
  const totalSelectors = {
    cbRegoSelf: dialog.querySelector('#cbRegoSelf'),
    cbAccSelf: dialog.querySelector('#cbAccSelf'),
    cbSponSelf: dialog.querySelector('#cbSponSelf'),
    sponSelfAmount: dialog.querySelector('#sponSelfAmount'),
    totalDisplay: dialog.querySelector('#totalAmount'),
    btnPay: dialog.querySelector('#btnPay')
  };
  
  // OPTIMIZATION: Single object for all toggle mappings
  const toggleMap = {
    '#cbRegoSelf': '#regoSelfDetails',
    '#cbRegoOthers': '#regoOthersDetails',
    '#cbAccSelf': '#accSelfDetails',
    '#cbAccOthers': '#accOthersDetails',
    '#cbSponSelf': '#sponSelfDetails',
    '#cbSponOthers': '#sponOthersDetails'
  };
  
  // Setup toggles efficiently
  Object.entries(toggleMap).forEach(([cb, details]) => {
    const checkbox = dialog.querySelector(cb);
    const detailsEl = dialog.querySelector(details);
    if (checkbox && detailsEl) {
      checkbox.addEventListener('change', () => {
        detailsEl.classList.toggle('hidden', !checkbox.checked);
        updateTotal();
      }, { passive: true });
    }
  });
  
  // Add person buttons - OPTIMIZED: Single event delegation pattern
  const addButtonHandlers = [
    { btn: '#btnAddRegoOther', container: '#regoOthersList', type: 'rego' },
    { btn: '#btnAddAccOther', container: '#accOthersList', type: 'acc' },
    { btn: '#btnAddSponOther', container: '#sponOthersList', type: 'spon' }
  ];
  
  let counters = { rego: 0, acc: 0, spon: 0 };
  
  addButtonHandlers.forEach(({ btn, container, type }) => {
    const button = dialog.querySelector(btn);
    const cont = dialog.querySelector(container);
    if (!button || !cont) return;
    
    button.addEventListener('click', () => {
      const id = `${type}-${counters[type]++}`;
      const div = document.createElement('div');
      div.className = 'other-person-row';
      div.dataset.id = id;
      
      // Use template based on type
      if (type === 'rego') {
        div.innerHTML = `
          <div class="person-header">
            ${renderPersonSelector(allHashHandles, id)}
            <button type="button" class="btn-remove-person">×</button>
          </div>
          <div class="person-details hidden">
            <p class="fee-display">Fee: ${formatCurrency(regular.regoFee || 0, currency)}</p>
            
            <!-- T-SHIRT & DRINK FOR THIS PERSON - Only for rego -->
            <div class="rego-preferences">
              <p class="required-note">* Required for registration</p>
              
              <div class="preference-row">
                <label class="required">T-Shirt Size *</label>
                <div class="radio-group-horizontal tshirt-group" data-person="${id}">
                  <label><input type="radio" name="tshirtSize_${id}" value="M" checked><span>M</span></label>
                  <label><input type="radio" name="tshirtSize_${id}" value="L"><span>L</span></label>
                  <label><input type="radio" name="tshirtSize_${id}" value="XL"><span>XL</span></label>
                  <label><input type="radio" name="tshirtSize_${id}" value="XXL"><span>XXL</span></label>
                  <label><input type="radio" name="tshirtSize_${id}" value="XXXL"><span>XXXL</span></label>
                </div>
              </div>
              
              <div class="preference-row">
                <label class="required">Drink Preference *</label>
                <div class="radio-group-horizontal drink-type-group" data-person="${id}">
                  <label><input type="radio" name="drinkType_${id}" value="beer" checked class="drink-type-radio"><span>Beer</span></label>
                  <label><input type="radio" name="drinkType_${id}" value="soft" class="drink-type-radio"><span>Soft</span></label>
                  <label><input type="radio" name="drinkType_${id}" value="malt" class="drink-type-radio"><span>Malt</span></label>
                </div>
                
                <select class="drink-brand-select" data-person="${id}">
                  <optgroup label="Beer" data-type="beer">
                    <option value="Hero">Hero</option>
                    <option value="Heineken">Heineken</option>
                    <option value="Trophy">Trophy</option>
                    <option value="Star">Star</option>
                    <option value="Stout">Stout</option>
                    <option value="Smirnoff Ice">Smirnoff Ice</option>
                    <option value="Star Radler">Star Radler</option>
                    <option value="Desperado">Desperado</option>
                    <option value="Budweiser">Budweiser</option>
                    <option value="Tiger">Tiger</option>
                  </optgroup>
                  <optgroup label="Soft" data-type="soft" disabled hidden>
                    <option value="Coca-Cola">Coca-Cola</option>
                    <option value="Sprite">Sprite</option>
                    <option value="Bigi">Bigi</option>
                    <option value="Fanta">Fanta</option>
                    <option value="Water">Water</option>
                  </optgroup>
                  <optgroup label="Malt" data-type="malt" disabled hidden>
                    <option value="Malt">Malt</option>
                  </optgroup>
                </select>
              </div>
            </div>
          </div>
        `;
      } else if (type === 'acc') {
        div.innerHTML = `
          <div class="person-header">
            ${renderPersonSelector(allHashHandles, id)}
            <button type="button" class="btn-remove-person">×</button>
          </div>
          <div class="person-details hidden">
            ${renderAccommodationSelector(id, regular.accommodation, currency)}
          </div>
        `;
      } else {
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
      }
      
      // Setup row
      setupPersonSelector(div, updateTotal);
      
      // Setup drink type switching for this person
      if (type === 'rego') {
        const drinkRadios = div.querySelectorAll(`input[name="drinkType_${id}"]`);
        const brandSelect = div.querySelector(`select[data-person="${id}"]`);
        
        drinkRadios.forEach(radio => {
          radio.addEventListener('change', (e) => {
            const drinkType = e.target.value;
            const optgroups = brandSelect.querySelectorAll('optgroup');
            
            optgroups.forEach(og => {
              if (og.dataset.type === drinkType) {
                og.disabled = false;
                og.hidden = false;
                const firstOption = og.querySelector('option');
                if (firstOption) firstOption.selected = true;
              } else {
                og.disabled = true;
                og.hidden = true;
              }
            });
          });
        });
      }
      
      if (type === 'acc') setupAccommodationSelection(div, id, updateTotal);
      if (type === 'spon') {
        const amtInput = div.querySelector('.spon-amount');
        if (amtInput) {
          amtInput.addEventListener('input', updateTotal, { passive: true });
        }
      }
      
      div.querySelector('.btn-remove-person').addEventListener('click', () => {
        div.remove();
        updateTotal();
      });
      
      cont.appendChild(div);
    });
  });
  
  // Setup self accommodation
  setupAccommodationSelection(dialog, 'self', updateTotal);
  
  // Setup self drink type switching
  const selfDrinkRadios = dialog.querySelectorAll('input[name="selfDrinkType"]');
  const selfBrandSelect = dialog.querySelector('#selfDrinkBrand');
  
  selfDrinkRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const drinkType = e.target.value;
      const optgroups = selfBrandSelect.querySelectorAll('optgroup');
      
      optgroups.forEach(og => {
        if (og.dataset.type === drinkType) {
          og.disabled = false;
          og.hidden = false;
          const firstOption = og.querySelector('option');
          if (firstOption) firstOption.selected = true;
        } else {
          og.disabled = true;
          og.hidden = true;
        }
      });
    });
  });
  
  // Self sponsorship amount
  const sponSelfAmount = dialog.querySelector('#sponSelfAmount');
  if (sponSelfAmount) {
    sponSelfAmount.addEventListener('input', updateTotal, { passive: true });
  }
  
  // Cancel button
  dialog.querySelector('#btnCancel').addEventListener('click', () => dialog.remove());
  
  // Pay button - UPDATED: Captures T-shirt and drink data
  dialog.querySelector('#btnPay').addEventListener('click', async () => {
    await processPayment(dialog, regular, currency);
  });
  
  // Initial total calculation
  updateTotal();
  
  function updateTotal() {
    let total = 0;
    
    // Rego calculations
    if (totalSelectors.cbRegoSelf?.checked) total += regular.regoFee || 0;
    dialog.querySelectorAll('#regoOthersList .other-person-row[data-hasher]').forEach(() => {
      total += regular.regoFee || 0;
    });
    
    // Accommodation calculations
    if (totalSelectors.cbAccSelf?.checked) total += calculateAccommodationTotal(dialog, 'self');
    dialog.querySelectorAll('#accOthersList .other-person-row[data-hasher]').forEach(row => {
      total += calculateAccommodationTotal(row, row.dataset.id);
    });
    
    // Sponsorship calculations
    if (totalSelectors.cbSponSelf?.checked) {
      total += parseFloat(totalSelectors.sponSelfAmount?.value || 0);
    }
    dialog.querySelectorAll('#sponOthersList .other-person-row[data-hasher]').forEach(row => {
      total += parseFloat(row.querySelector('.spon-amount')?.value || 0);
    });
    
    // Update display
    if (totalSelectors.totalDisplay) {
      totalSelectors.totalDisplay.textContent = formatCurrency(total, currency);
    }
    if (totalSelectors.btnPay) {
      totalSelectors.btnPay.disabled = total <= 0 || walletBalance < total;
      totalSelectors.btnPay.textContent = walletBalance < total ? 'Insufficient Balance' : 'Pay from Wallet';
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
      
      // Call onChange if it's a function
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

// Setup accommodation selection for a person
function setupAccommodationSelection(container, personId, updateTotal) {
  const roomCheckboxes = container.querySelectorAll(`[data-person="${personId}"] .room-checkbox, [data-id="${personId}"] .room-checkbox`);
  
  roomCheckboxes.forEach(cb => {
    cb.onchange = () => {
      const roomIdx = cb.dataset.roomIdx;
      const details = container.querySelector(`[data-room-idx="${roomIdx}"].room-details, .room-details[data-room-idx="${roomIdx}"]`);
      if (details) {
        details.classList.toggle('hidden', !cb.checked);
      }
      updateTotal();
    };
  });
  
  const selects = container.querySelectorAll(`[data-person="${personId}"] .nights-select, [data-person="${personId}"] .qty-input, [data-id="${personId}"] .nights-select, [data-id="${personId}"] .qty-input`);
  selects.forEach(el => {
    el.onchange = updateTotal;
  });
}

// Calculate accommodation total for a person
function calculateAccommodationTotal(container, personId) {
  let total = 0;
  const checkboxes = container.querySelectorAll(`[data-person="${personId}"] .room-checkbox:checked, [data-id="${personId}"] .room-checkbox:checked`);
  
  checkboxes.forEach(cb => {
    const roomIdx = cb.dataset.roomIdx;
    const amount = parseFloat(cb.dataset.amount) || 0;
    const nights = parseInt(container.querySelector(`[data-room-idx="${roomIdx}"].nights-select, .nights-select[data-room-idx="${roomIdx}"]`)?.value || 1);
    const qty = parseInt(container.querySelector(`[data-room-idx="${roomIdx}"].qty-input, .qty-input[data-room-idx="${roomIdx}"]`)?.value || 1);
    total += amount * nights * qty;
  });
  
  return total;
}

// Process payment with separate self/others tracking
async function processPayment
(dialog, regular, currency) {
  const btnPay = dialog.querySelector('#btnPay');
  btnPay.disabled = true;
  btnPay.textContent = 'Processing...';
  
  try {
    // Gather all data
    const cbRegoSelf = dialog.querySelector('#cbRegoSelf').checked;
    const cbRegoOthers = dialog.querySelector('#cbRegoOthers').checked;
    const cbAccSelf = dialog.querySelector('#cbAccSelf').checked;
    const cbAccOthers = dialog.querySelector('#cbAccOthers').checked;
    const cbSponSelf = dialog.querySelector('#cbSponSelf').checked;
    const cbSponOthers = dialog.querySelector('#cbSponOthers').checked;
    
    // Build payment data structure
    let totalAmount = 0;
    
    // REGO DATA - T-shirt and Drink only required when paying rego
    const regoData = {
      self: { selected: false, amount: 0, tshirtSize: '', drinkType: '', drinkBrand: '' },
      others: []
    };
    
    // Check if any rego is being paid (self or others)
    const isPayingRegoSelf = cbRegoSelf;
    const isPayingRegoOthers = cbRegoOthers && dialog.querySelectorAll('#regoOthersList .other-person-row[data-hasher]').length > 0;
    const isPayingAnyRego = isPayingRegoSelf || isPayingRegoOthers;
    
    if (cbRegoSelf) {
      regoData.self.selected = true;
      regoData.self.amount = regular.regoFee || 0;
      // CAPTURE SELF PREFERENCES (only validate if paying rego)
      regoData.self.tshirtSize = dialog.querySelector('input[name="selfTshirtSize"]:checked')?.value || 'M';
      regoData.self.drinkType = dialog.querySelector('input[name="selfDrinkType"]:checked')?.value || 'beer';
      regoData.self.drinkBrand = dialog.querySelector('#selfDrinkBrand')?.value || '';
      totalAmount += regoData.self.amount;
    }
    
    if (cbRegoOthers) {
      dialog.querySelectorAll('#regoOthersList .other-person-row').forEach(row => {
        const hasher = row.dataset.hasher;
        const personId = row.dataset.id;
        if (hasher) {
          const amount = regular.regoFee || 0;
          // CAPTURE PER-PERSON PREFERENCES (only if hasher is confirmed)
          const tshirtSize = row.querySelector(`input[name="tshirtSize_${personId}"]:checked`)?.value || 'M';
          const drinkType = row.querySelector(`input[name="drinkType_${personId}"]:checked`)?.value || 'beer';
          const drinkBrand = row.querySelector(`select[data-person="${personId}"]`)?.value || '';
          
          regoData.others.push({ 
            hashHandle: hasher, 
            amount,
            tshirtSize,
            drinkType,
            drinkBrand
          });
          totalAmount += amount;
        }
      });
    }
    
    // VALIDATION: T-shirt and Drink are ONLY required if paying for rego
    // If paying only accommodation/sponsorship without rego, skip this validation
    if (isPayingAnyRego) {
      // Validate self preferences if paying self rego
      if (cbRegoSelf) {
        if (!regoData.self.tshirtSize || !regoData.self.drinkType || !regoData.self.drinkBrand) {
          throw new Error('Please select T-shirt size and drink preference for yourself');
        }
      }
      
      // Validate others preferences if paying for others rego
      if (cbRegoOthers) {
        regoData.others.forEach(other => {
          if (!other.tshirtSize || !other.drinkType || !other.drinkBrand) {
            throw new Error(`Please select T-shirt size and drink preference for ${other.hashHandle}`);
          }
        });
      }
    }
    
    // ACCOMMODATION DATA
    const accData = {
      self: { selected: false, bookings: [], amount: 0 },
      others: []
    };
    
    if (cbAccSelf) {
      accData.self.selected = true;
      accData.self.bookings = getAccommodationBookings(dialog, 'self');
      accData.self.amount = accData.self.bookings.reduce((sum, b) => sum + b.total, 0);
      totalAmount += accData.self.amount;
    }
    
    if (cbAccOthers) {
      dialog.querySelectorAll('#accOthersList .other-person-row').forEach(row => {
        const hasher = row.dataset.hasher;
        if (hasher) {
          const bookings = getAccommodationBookings(row, row.dataset.id);
          const amount = bookings.reduce((sum, b) => sum + b.total, 0);
          accData.others.push({ hashHandle: hasher, bookings, amount });
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
      sponData.self.amount = parseFloat(dialog.querySelector('#sponSelfAmount')?.value || 0);
      totalAmount += sponData.self.amount;
    }
    
    if (cbSponOthers) {
      dialog.querySelectorAll('#sponOthersList .other-person-row').forEach(row => {
        const hasher = row.dataset.hasher;
        if (hasher) {
          const amount = parseFloat(row.querySelector('.spon-amount')?.value || 0);
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
    
	    // ADD THIS: Validate accommodation availability before payment
    if (accData.self.selected || accData.others.length > 0) {
      // Re-fetch current accommodation state to prevent race conditions
      const eventRef = doc(window.db, 'events', eventId);
      const currentEventSnap = await getDoc(eventRef);
      const currentAccData = currentEventSnap.data()?.accommodation || [];
      
      // Validate all bookings against current availability
      const allBookings = [
        ...(accData.self.selected ? accData.self.bookings : []),
        ...accData.others.flatMap(o => o.bookings)
      ];
      
      for (const booking of allBookings) {
        const roomIndex = currentAccommodationData.findIndex(r => r.roomType === booking.roomType);
        if (roomIndex === -1) continue;
        
        const currentRoom = currentAccData[roomIndex];
        const currentBooked = currentRoom?.booked || 0;
        const currentRemaining = currentRoom.qty - currentBooked;
        
        if (booking.qty > currentRemaining) {
          throw new Error(`Sorry, only ${currentRemaining} ${booking.roomType} room${currentRemaining !== 1 ? 's' : ''} left. Someone else just booked. Please refresh and try again.`);
        }
      }
    }
    // Build status string
    const statusParts = [];
    if (regoData.self.selected || regoData.others.length > 0) statusParts.push('Rego Paid');
    if (accData.self.selected || accData.others.length > 0) statusParts.push('Accommodation Paid');
    if (sponData.self.selected || sponData.others.length > 0) statusParts.push('Sponsorship Paid');
    
    // Create payment request with new fields
    const paymentRequestData = {
      userId: currentUser.uid,
      eventId: eventId,
      eventTitle: eventData.title || '',
      kennel: eventData.kennel || '',
      country: eventData.country || '',
      state: eventData.state || '',
      type: 'event-payment',
      currency: currency,
      status: statusParts.join(', '),
      createdAt: Timestamp.now(),
      approvedAt: Timestamp.now(),
      
      // Rego
      regoAmount: regoData.self.amount + regoData.others.reduce((s, o) => s + o.amount, 0),
      regoStatus: (regoData.self.selected || regoData.others.length > 0) ? 'Paid' : 'Not Paid',
      regoSelf: regoData.self,
      regoOthers: regoData.others,
      
      // Accommodation
      accommodationAmount: accData.self.amount + accData.others.reduce((s, o) => s + o.amount, 0),
      accommodationStatus: (accData.self.selected || accData.others.length > 0) ? 'Paid' : 'Not Paid',
      accommodationSelf: accData.self,
      accommodationOthers: accData.others,
      
      // Sponsorship
      sponsorshipAmount: sponData.self.amount + sponData.others.reduce((s, o) => s + o.amount, 0),
      sponsorshipStatus: (sponData.self.selected || sponData.others.length > 0) ? 'Paid' : 'Not Paid',
      sponsorshipSelf: sponData.self,
      sponsorshipOthers: sponData.others,
      
      totalAmount: totalAmount
    };
    
    // Execute batch
 const PLATFORM_FEE = 20; // Fixed 20 Naira fee per transaction

    // Calculate amounts for each category
    const totalRego = regoData.self.amount + regoData.others.reduce((s, o) => s + o.amount, 0);
    const totalAcc = accData.self.amount + accData.others.reduce((s, o) => s + o.amount, 0);
    const totalSpon = sponData.self.amount + sponData.others.reduce((s, o) => s + o.amount, 0);
    
    // Get event account details
    const accountDetails = eventData.accountDetails || {};
    const useSameAccount = accountDetails.useSameAccount !== false; // default true if not set
    
    // Determine recipient accounts for each payment type
    const regoAccount = useSameAccount ? accountDetails.registration : accountDetails.registration;
    const accAccount = useSameAccount ? accountDetails.accommodation : (accountDetails.accommodation || accountDetails.registration);
    const sponAccount = useSameAccount ? accountDetails.sponsorship : (accountDetails.sponsorship || accountDetails.registration);
    
    // Initiate Paystack transfers
    const transfers = [];
    const transferResults = { rego: null, acc: null, spon: null };
    
    // Generate base reference for this payment
    const timestamp = Date.now();
    const baseRef = `H3-EVENT-${eventId}-${timestamp}`;
    
    // Helper function to create transfer recipient and initiate transfer
    async function initiateTransfer(amount, accountData, category, refSuffix) {
      if (!amount || amount <= 0 || !accountData) return null;
      
      const reference = `${baseRef}-${refSuffix}`;
      
      try {
        // Create transfer recipient
        const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'nuban',
            name: accountData.accName,
            account_number: accountData.accNo,
            bank_code: await getBankCode(accountData.bank),
            currency: 'NGN'
          })
        });
        
        const recipientData = await recipientRes.json();
        if (!recipientData.status) {
          throw new Error(`Recipient creation failed: ${recipientData.message}`);
        }
        
        const recipientCode = recipientData.data.recipient_code;
        
        // Initiate transfer
        const transferRes = await fetch('https://api.paystack.co/transfer', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source: 'balance',
            reason: `${category} payment for ${eventData.title}`,
            amount: amount * 100,
            recipient: recipientCode,
            reference: reference
          })
        });
        
        const transferData = await transferRes.json();
        
        return {
          success: transferData.status,
          reference: reference,
          transferCode: transferData.data?.transfer_code || null,
          amount: amount,
          recipient: accountData,
          status: transferData.status ? 'processing' : 'failed',
          error: transferData.status ? null : transferData.message
        };
        
      } catch (error) {
        console.error(`Transfer failed for ${category}:`, error);
        return {
          success: false,
          reference: reference,
          amount: amount,
          recipient: accountData,
          status: 'failed',
          error: error.message
        };
      }
    }
    
    // Execute transfers in parallel
    const [regoTransfer, accTransfer, sponTransfer] = await Promise.all([
      initiateTransfer(totalRego, regoAccount, 'Registration', 'REG'),
      initiateTransfer(totalAcc, accAccount, 'Accommodation', 'ACC'),
      initiateTransfer(totalSpon, sponAccount, 'Sponsorship', 'SPON')
    ]);
    
    transferResults.rego = regoTransfer;
    transferResults.acc = accTransfer;
    transferResults.spon = sponTransfer;
    
    // Create lookup documents for webhook to find these payments
    const lookupPromises = [];
    
    if (regoTransfer?.reference) {
      lookupPromises.push(setDoc(doc(window.db, 'eventPaymentLookups', regoTransfer.reference), {
        paymentRequestId: paymentRequestRef.id,
        eventId: eventId,
        eventTitle: eventData.title,
        payerUid: currentUser.uid,
        payerHandle: currentUserData.hashHandle || 'Unknown',
        totalAmount: totalAmount,
        transferType: 'registration',
        transferAmount: totalRego,
        kennels: eventData.kennels || [],
        mainKennel: eventData.kennel,
        country: eventData.country,
        state: eventData.state,
        isCollaboration: eventData.isCollaboration || false,
        status: 'pending',
        createdAt: Timestamp.now()
      }));
    }
    
    if (accTransfer?.reference) {
      lookupPromises.push(setDoc(doc(window.db, 'eventPaymentLookups', accTransfer.reference), {
        paymentRequestId: paymentRequestRef.id,
        eventId: eventId,
        eventTitle: eventData.title,
        payerUid: currentUser.uid,
        payerHandle: currentUserData.hashHandle || 'Unknown',
        totalAmount: totalAmount,
        transferType: 'accommodation',
        transferAmount: totalAcc,
        kennels: eventData.kennels || [],
        mainKennel: eventData.kennel,
        country: eventData.country,
        state: eventData.state,
        isCollaboration: eventData.isCollaboration || false,
        status: 'pending',
        createdAt: Timestamp.now()
      }));
    }
    
    if (sponTransfer?.reference) {
      lookupPromises.push(setDoc(doc(window.db, 'eventPaymentLookups', sponTransfer.reference), {
        paymentRequestId: paymentRequestRef.id,
        eventId: eventId,
        eventTitle: eventData.title,
        payerUid: currentUser.uid,
        payerHandle: currentUserData.hashHandle || 'Unknown',
        totalAmount: totalAmount,
        transferType: 'sponsorship',
        transferAmount: totalSpon,
        kennels: eventData.kennels || [],
        mainKennel: eventData.kennel,
        country: eventData.country,
        state: eventData.state,
        isCollaboration: eventData.isCollaboration || false,
        status: 'pending',
        createdAt: Timestamp.now()
      }));
    }
    
    await Promise.all(lookupPromises);
    
    transferResults.rego = regoTransfer;
    transferResults.acc = accTransfer;
    transferResults.spon = sponTransfer;
    
    // Check if any transfers failed
    const failedTransfers = [regoTransfer, accTransfer, sponTransfer].filter(t => t && !t.success);
    if (failedTransfers.length > 0) {
      throw new Error(`Transfer failed: ${failedTransfers.map(t => `${t.error}`).join(', ')}`);
    }
    
    // Build batch operations
    const batch = writeBatch(window.db);
    
    // Update user wallet (deduct total + platform fee)
    const userRef = doc(window.db, 'users', currentUser.uid);
    batch.update(userRef, {
      walletBalance: increment(-(totalAmount + PLATFORM_FEE))
    });
    
    // Update payment request data with transfer info
    const paymentRequestDataWithTransfers = {
      ...paymentRequestData,
      platformFee: PLATFORM_FEE,
      totalDeducted: totalAmount + PLATFORM_FEE,
      transfers: {
        registration: transferResults.rego,
        accommodation: transferResults.acc,
        sponsorship: transferResults.spon
      }
    };
    
    // Create payment request
    const paymentRequestRef = doc(collection(window.db, 'paymentRequests'));
    batch.set(paymentRequestRef, paymentRequestDataWithTransfers);
    
    // Update event document accommodation booked counts (KEEP THIS)
    const accommodationUpdates = {};
    const bookingCounts = {};
    const allBookings = [
      ...(accData.self.selected ? accData.self.bookings : []),
      ...accData.others.flatMap(o => o.bookings)
    ];
    
    allBookings.forEach(booking => {
      const roomIndex = currentAccommodationData.findIndex(r => r.roomType === booking.roomType);
      if (roomIndex !== -1) {
        bookingCounts[roomIndex] = (bookingCounts[roomIndex] || 0) + booking.qty;
      }
    });
    
    Object.entries(bookingCounts).forEach(([roomIndex, qty]) => {
      accommodationUpdates[`pricing.regular.accommodation.${roomIndex}.booked`] = increment(qty);
    });
    
    if (Object.keys(accommodationUpdates).length > 0) {
      const eventRef = doc(window.db, 'events', eventId);
      batch.update(eventRef, accommodationUpdates);
    }
    
    await batch.commit();
    
    // Update local state
    currentUserData.walletBalance = currentBalance - totalAmount;
    updateWalletDisplay();
	
	    // ADD THIS: Play success sounds
    if (regoData.self.selected || regoData.others.length > 0) {
      audioSystem.play('rego');
    }
    if (accData.self.selected || accData.others.length > 0) {
      audioSystem.play('accommodation');
    }
    if (sponData.self.selected || sponData.others.length > 0) {
      audioSystem.play('sponsorship');
    }
    
       showSuccessDialog({
      totalPaid: totalAmount,
      platformFee: PLATFORM_FEE,
      totalDeducted: totalAmount + PLATFORM_FEE,
      remainingBalance: currentUserData.walletBalance,
      currency: currency,
      registrationId: paymentRequestRef.id,
      dmReceipt: true // ADD THIS
    });
    
  } catch (err) {
    console.error('Payment error:', err);
    alert('Payment failed: ' + err.message);
    btnPay.disabled = false;
    btnPay.textContent = 'Pay from Wallet';
  }
}

// Get accommodation bookings for a person
function getAccommodationBookings(container, personId) {
  const bookings = [];
  const checkboxes = container.querySelectorAll(`[data-person="${personId}"] .room-checkbox:checked, [data-id="${personId}"] .room-checkbox:checked`);
  
  checkboxes.forEach(cb => {
    const roomIdx = cb.dataset.roomIdx;
    const roomType = cb.dataset.type;
    const amountPerNight = parseFloat(cb.dataset.amount) || 0;
    const nights = parseInt(container.querySelector(`[data-room-idx="${roomIdx}"].nights-select, .nights-select[data-room-idx="${roomIdx}"]`)?.value || 1);
    const qty = parseInt(container.querySelector(`[data-room-idx="${roomIdx}"].qty-input, .qty-input[data-room-idx="${roomIdx}"]`)?.value || 1);
    
    bookings.push({
      roomType,
      nights,
      qty,
      amountPerNight,
      total: amountPerNight * nights * qty
    });
  });
  
  return bookings;
}

// Show success dialog
function showSuccessDialog(result) {
  const dialog = document.createElement('div');
  dialog.className = 'dialog-overlay';
  
  // ADD THIS BLOCK
  const dmMessage = result.dmReceipt ? `
    <div style="background: #FFF3E0; padding: 12px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #FF6D00;">
      <p style="margin: 0; color: #E65100; font-size: 14px;">
        📬 <strong>Check your DMs!</strong><br>
        Your payment receipt will be sent via DM within 2-3 minutes once transfers are confirmed.
      </p>
    </div>
  ` : '';
  
  dialog.innerHTML = `
    <div class="success-dialog">
      <h2>🎉 ON ON! You're Registered!</h2>
      <div class="success-details">
        <p><strong>Registration confirmed!</strong></p>
        <p>Total Paid: ${formatCurrency(result.totalPaid, result.currency)}</p>
        <p>Remaining Balance: ${formatCurrency(result.remainingBalance, result.currency)}</p>
        <p>Registration ID: ${result.registrationId}</p>
      </div>
      <button type="button" id="btnDone" class="btn-primary">ON ON!</button>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  dialog.querySelector('#btnDone').onclick = () => {
    dialog.remove();
    window.location.reload();
  };
}

// ADD THIS: Real-time accommodation availability listener
let accommodationListener = null;
let currentAccommodationData = []; // Store with booked counts

function startAccommodationListener() {
  if (!eventId) return;
  
  const eventRef = doc(window.db, 'events', eventId);
  
  accommodationListener = onSnapshot(eventRef, (snap) => {
    if (!snap.exists()) return;
    
    const data = snap.data();
    
    // EXACT SAME as join dialog - pricing.regular.accommodation
    const regular = data.pricing?.regular || {};
    const accommodation = regular.accommodation || [];
    const currency = data.pricing?.currency || 'NGN';
	
	
    
    if (!accommodation || accommodation.length === 0) {
      currentAccommodationData = [];
      updateAccommodationDisplay([], currency);
      return;
    }
    
    // Update with real-time booked counts
    currentAccommodationData = accommodation.map(room => ({
      ...room,
      booked: room.booked || 0,
      remaining: room.qty - (room.booked || 0)
    }));
    
    // Update main page UI
    updateAccommodationDisplay(currentAccommodationData, currency);
    
    // Detect external payments for sound
    detectExternalPayment(data);
  });
}

function updateAccommodationDisplay(rooms, currency) {
  const container = els.containerAccommodation;
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!rooms || rooms.length === 0) {
    container.innerHTML = '<div class="chip">No accommodation available</div>';
    return;
  }
  
  rooms.forEach((room, index) => {
    const chip = document.createElement('div');
    chip.className = 'accommodation-chip';
    chip.dataset.roomIndex = index;
    chip.dataset.roomType = room.roomType;
    
    // Calculate availability percentage
    const remaining = room.remaining;
    const total = room.qty;
    const percentRemaining = (remaining / total) * 100;
    
    // Determine color using SAME logic as join dialog
    let indicatorColor;
    if (remaining === 0) {
      indicatorColor = '#d32f2f'; // Dark Red - Sold out
    } else if (percentRemaining <= 30) {
      indicatorColor = '#ff6b6b'; // Light Red - Critical
    } else if (percentRemaining <= 50) {
      indicatorColor = '#ff9800'; // Orange - Warning
    } else {
      indicatorColor = '#4caf50'; // Green - Good
    }
    
    // HORIZONTAL LAYOUT with round indicator
    chip.innerHTML = `
      <div class="accommodation-row" style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
        <!-- ROUND COLORED INDICATOR -->
        <div class="availability-dot" 
             style="width: 12px; height: 12px; border-radius: 50%; background-color: ${indicatorColor}; flex-shrink: 0;">
        </div>
        
        <!-- ROOM INFO - HORIZONTAL -->
        <div class="room-info" style="display: flex; flex: 1; justify-content: space-between; align-items: center;">
          <span class="room-type" style="font-weight: 500;">${room.roomType}</span>
          <span class="room-price" style="color: #666;">${formatCurrency(room.amount, currency)} / night</span>
          <span class="room-availability" style="color: ${indicatorColor}; font-weight: ${percentRemaining <= 30 ? 'bold' : 'normal'};">
            ${remaining === 0 ? 'SOLD OUT' : 
              percentRemaining <= 30 ? `Only ${remaining} left!` : 
              `${remaining} available`}
          </span>
        </div>
      </div>
    `;
    
    container.appendChild(chip);
  });
}

// Track last known state to detect external payments
let lastKnownAccommodationState = null;

function detectExternalPayment(currentData) {
  if (!lastKnownAccommodationState) {
    lastKnownAccommodationState = JSON.stringify(currentData.accommodation);
    return;
  }
  
  const currentState = JSON.stringify(currentData.accommodation);
  if (currentState !== lastKnownAccommodationState) {
    // Something changed - check if it was an increase in booked count
    const currentAcc = currentData.accommodation || [];
    const lastAcc = JSON.parse(lastKnownAccommodationState);
    
    currentAcc.forEach((room, idx) => {
      const lastRoom = lastAcc[idx];
      if (lastRoom && (room.booked || 0) > (lastRoom.booked || 0)) {
        // Someone else booked this room type!
        console.log(`External booking detected: ${room.roomType}`);
        audioSystem.play('accommodation');
      }
    });
    
    lastKnownAccommodationState = currentState;
  }
}

// Cleanup on page unload
window.onbeforeunload = () => {
  if (fireListener) {
    fireListener();
  }
};
